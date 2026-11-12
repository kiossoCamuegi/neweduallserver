// CACHE-OPT v1
// Módulo de cache da Eduall: SQLite (por defeito) com Redis opcional + fallback automático.
//
// Melhorias desta versão:
//  - Stats e hits em memória, gravados em lote (sem escritas SQLite por pedido)
//  - Histórico desligado por defeito (só grava erros), também em lote
//  - Single-flight no eduallWithCache (um stampede vira uma só query)
//  - SQLite: busy_timeout, cleanup com comparação ISO correta, LIKE escapado, eviction por tamanho
//  - Redis: valor cru (sem KEEPTTL), hits à parte, ping que reconecta
//  - Fallback: ao recuperar o Redis, limpa Redis e SQLite (evita dados velhos)
//  - eduallInvalidate paralelo e com contagem

const path = require('path');
const fsPromises = require('fs').promises;
const sqlite3 = require('sqlite3');
const { open } = require('sqlite');

// =======================================================================
// CONSTANTES E HELPERS
// =======================================================================

const CACHE_DIR = path.join(__dirname, '../cache');
// Stats + histórico ficam sempre em SQLite (leve), independente do driver dos dados.
const META_DB_PATH = path.join(CACHE_DIR, 'cache_meta.db');

// ID único desta instância do módulo. Se aparecerem IDs diferentes nos logs,
// o módulo está a ser carregado duas vezes (require com caminhos diferentes).
const MODULE_INSTANCE_ID = Math.random().toString(36).slice(2, 8);

const MAX_PENDING_HITS = 10000;
const MAX_HISTORY_BUFFER = 2000;

// Teto de TTL (default 5 min). Evita que uma família sem invalidação
// continue a mostrar dados antigos durante 1 hora. 0 = sem teto.
const CACHE_MAX_TTL_SECONDS = Number(process.env.CACHE_MAX_TTL || 300);

// Interruptor de segurança: CACHE_ENABLED=false repõe o comportamento antigo
// (sem cache) sem alterar código. Útil se aparecer um dado desatualizado.
const CACHE_ENABLED =
  String(process.env.CACHE_ENABLED || 'true').toLowerCase() !== 'false';

async function ensureDir(dir) {
  try {
    await fsPromises.mkdir(dir, { recursive: true });
  } catch (err) {
    console.warn('⚠️ Erro ao criar diretório de cache:', err.message);
  }
}

// Converte "academic_level:*" em padrão LIKE seguro: escapa \ % _ e depois * -> %
function toLikePattern(pattern) {
  return String(pattern).replace(/[\\%_]/g, '\\$&').replace(/\*/g, '%');
}

// =======================================================================
// SQLITE ADAPTER
// =======================================================================

class SQLiteAdapter {
  constructor(options = {}) {
    this.dbPath = options.dbPath || path.join(CACHE_DIR, 'cache.db');
    this.maxBytes = options.maxBytes || 500 * 1024 * 1024;
    this.db = null;
    this.driverName = 'sqlite';
    this.pendingHits = new Map(); // key -> hits ainda não gravados
    this._flushing = false;
    this._setCount = 0;
  }

  async connect() {
    await ensureDir(path.dirname(this.dbPath));

    this.db = await open({ filename: this.dbPath, driver: sqlite3.Database });

    await this.db.exec('PRAGMA journal_mode = WAL');
    await this.db.exec('PRAGMA synchronous = NORMAL');
    // Com PM2 em cluster, vários processos escrevem no mesmo ficheiro.
    // Sem isto aparece SQLITE_BUSY em vez de esperar pelo lock.
    await this.db.exec('PRAGMA busy_timeout = 5000');

    await this.db.exec(`
      CREATE TABLE IF NOT EXISTS eduall_cache_data (
        ed_id INTEGER PRIMARY KEY AUTOINCREMENT,
        ed_key TEXT UNIQUE NOT NULL,
        ed_value LONGTEXT NOT NULL,
        ed_ttl INTEGER NOT NULL,
        ed_created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        ed_expires_at DATETIME NOT NULL,
        ed_hits INTEGER DEFAULT 0,
        ed_last_accessed DATETIME DEFAULT CURRENT_TIMESTAMP,
        ed_size_bytes INTEGER DEFAULT 0
      );

      CREATE INDEX IF NOT EXISTS idx_eduall_cache_expires ON eduall_cache_data(ed_expires_at);
      CREATE INDEX IF NOT EXISTS idx_eduall_cache_hits ON eduall_cache_data(ed_hits DESC);
      CREATE INDEX IF NOT EXISTS idx_eduall_cache_accessed ON eduall_cache_data(ed_last_accessed);
    `);
    // Nota: ed_key já tem índice próprio por causa do UNIQUE.

    return this;
  }

  _addHit(key) {
    if (this.pendingHits.size >= MAX_PENDING_HITS && !this.pendingHits.has(key)) return;
    this.pendingHits.set(key, (this.pendingHits.get(key) || 0) + 1);
  }

  // Grava os hits acumulados numa só transação (chamado pelo flush periódico)
  async flushHits() {
    if (!this.db || this._flushing || this.pendingHits.size === 0) return;
    this._flushing = true;

    const batch = this.pendingHits;
    this.pendingHits = new Map();

    try {
      await this.db.exec('BEGIN IMMEDIATE');
      try {
        for (const [key, n] of batch) {
          await this.db.run(
            'UPDATE eduall_cache_data SET ed_hits = ed_hits + ?, ed_last_accessed = CURRENT_TIMESTAMP WHERE ed_key = ?',
            [n, key]
          );
        }
        await this.db.exec('COMMIT');
      } catch (err) {
        await this.db.exec('ROLLBACK').catch(() => {});
        throw err;
      }
    } catch (err) {
      // devolve os hits para tentar no próximo flush
      for (const [key, n] of batch) {
        this.pendingHits.set(key, (this.pendingHits.get(key) || 0) + n);
      }
    } finally {
      this._flushing = false;
    }
  }

  async set(key, valueJson, ttlSeconds, sizeBytes) {
    const expiresAt = new Date(Date.now() + ttlSeconds * 1000).toISOString();
    this.pendingHits.delete(key);

    await this.db.run(
      `INSERT OR REPLACE INTO eduall_cache_data
         (ed_key, ed_value, ed_ttl, ed_expires_at, ed_size_bytes, ed_hits, ed_created_at, ed_last_accessed)
       VALUES (?, ?, ?, ?, ?, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      [key, valueJson, ttlSeconds, expiresAt, sizeBytes]
    );

    // Verifica o limite de tamanho de vez em quando, sem bloquear o pedido
    this._setCount += 1;
    if (this._setCount % 500 === 0) {
      this.enforceMaxSize().catch(() => {});
    }

    return true;
  }

  async get(key) {
    const row = await this.db.get(
      'SELECT ed_value, ed_expires_at, ed_hits FROM eduall_cache_data WHERE ed_key = ?',
      [key]
    );

    if (!row) return null;

    if (new Date(row.ed_expires_at).getTime() <= Date.now()) {
      await this.del(key);
      return { expired: true };
    }

    // Sem UPDATE por leitura: os hits são acumulados em memória
    this._addHit(key);

    return { value: row.ed_value, hits: row.ed_hits + (this.pendingHits.get(key) || 0) };
  }

  async del(key) {
    this.pendingHits.delete(key);
    const result = await this.db.run('DELETE FROM eduall_cache_data WHERE ed_key = ?', [key]);
    return result.changes > 0;
  }

  async clear(pattern = '*') {
    if (pattern === '*') {
      this.pendingHits.clear();
      const result = await this.db.run('DELETE FROM eduall_cache_data');
      return result.changes;
    }

    const result = await this.db.run(
      "DELETE FROM eduall_cache_data WHERE ed_key LIKE ? ESCAPE '\\'",
      [toLikePattern(pattern)]
    );
    return result.changes;
  }

  async keys(pattern = '*') {
    if (pattern === '*') {
      const rows = await this.db.all('SELECT ed_key FROM eduall_cache_data');
      return rows.map((r) => r.ed_key);
    }

    const rows = await this.db.all(
      "SELECT ed_key FROM eduall_cache_data WHERE ed_key LIKE ? ESCAPE '\\'",
      [toLikePattern(pattern)]
    );
    return rows.map((r) => r.ed_key);
  }

  async countAndSize() {
    const row = await this.db.get(
      'SELECT COUNT(*) AS count, SUM(ed_size_bytes) AS total_bytes FROM eduall_cache_data'
    );
    return { count: row.count || 0, total_bytes: row.total_bytes || 0 };
  }

  async topKeys(limit = 10) {
    await this.flushHits();
    const rows = await this.db.all(
      `SELECT ed_key, ed_hits, ed_size_bytes, ed_expires_at
       FROM eduall_cache_data
       ORDER BY ed_hits DESC
       LIMIT ?`,
      [limit]
    );
    // Formato igual ao do RedisAdapter
    return rows.map((r) => ({
      key: r.ed_key,
      hits: r.ed_hits,
      size_bytes: r.ed_size_bytes,
      expires_at: r.ed_expires_at,
    }));
  }

  // Apaga as entradas mais antigas (por último acesso) até ficar a 80% do limite
  async enforceMaxSize() {
    await this.flushHits();

    const { total_bytes } = await this.countAndSize();
    if (total_bytes <= this.maxBytes) return 0;

    const target = this.maxBytes * 0.8;
    let remaining = total_bytes;
    let removed = 0;

    while (remaining > target) {
      const rows = await this.db.all(
        'SELECT ed_id, ed_size_bytes FROM eduall_cache_data ORDER BY ed_last_accessed ASC, ed_id ASC LIMIT 500'
      );
      if (rows.length === 0) break;

      const ids = [];
      for (const r of rows) {
        ids.push(r.ed_id);
        remaining -= r.ed_size_bytes || 0;
        if (remaining <= target) break;
      }

      await this.db.run(
        `DELETE FROM eduall_cache_data WHERE ed_id IN (${ids.map(() => '?').join(',')})`,
        ids
      );
      removed += ids.length;
    }

    return removed;
  }

  async cleanupExpired() {
    // ed_expires_at está em ISO ('...T...Z'); comparar com CURRENT_TIMESTAMP ('... ...')
    // falha porque 'T' > ' '. Por isso comparamos com ISO também.
    const result = await this.db.run(
      'DELETE FROM eduall_cache_data WHERE ed_expires_at < ?',
      [new Date().toISOString()]
    );
    const evicted = await this.enforceMaxSize();
    return result.changes + evicted;
  }

  async close() {
    if (this.db) {
      await this.flushHits();
      await this.db.close();
      this.db = null;
    }
  }
}

// =======================================================================
// REDIS ADAPTER
// =======================================================================

class RedisAdapter {
  constructor(options = {}) {
    this.options = options;
    this.prefix = options.prefix || 'cache:';
    // Hash fora do prefixo, para os padrões "cache:*" não o apanharem
    this.hitsKey = `meta:${this.prefix}hits`;
    this.client = null;
    this.driverName = 'redis';
  }

  _connectionOptions() {
    return {
      lazyConnect: true,          // não liga automaticamente no construtor
      connectTimeout: 2000,       // não deixa o arranque da app à espera
      maxRetriesPerRequest: 1,    // falha rápido em vez de ficar preso
      retryStrategy: () => null,  // sem retries automáticos (o FallbackAdapter trata disso)
      enableOfflineQueue: false,  // não acumula comandos enquanto está offline
    };
  }

  async connect() {
    let Redis;
    try {
      // eslint-disable-next-line global-require
      Redis = require('ioredis');
    } catch (err) {
      throw new Error(
        "Driver 'redis' ativo mas o pacote 'ioredis' não está instalado. Corre: npm install ioredis"
      );
    }

    this.client = this.options.url
      ? new Redis(this.options.url, this._connectionOptions())
      : new Redis({
          host: this.options.host || '127.0.0.1',
          port: this.options.port || 6379,
          password: this.options.password,
          db: this.options.db || 0,
          ...this._connectionOptions(),
        });

    // Sem isto, um erro de ligação rebenta o Node (unhandled 'error' event).
    this.client.on('error', () => {});

    await this.client.connect();
    await this.client.ping();

    return this;
  }

  async ping() {
    // Com retryStrategy null, o ioredis fica em 'end' depois de cair e não reconecta sozinho
    if (this.client.status === 'end' || this.client.status === 'wait') {
      await this.client.connect();
    }
    await this.client.ping();
  }

  _key(key) {
    return `${this.prefix}${key}`;
  }

  async set(key, valueJson, ttlSeconds) {
    // Valor cru + EX. Sem envelope e sem KEEPTTL (que podia recriar chaves já invalidadas).
    await this.client.set(this._key(key), valueJson, 'EX', ttlSeconds);
    return true;
  }

  async get(key) {
    const raw = await this.client.get(this._key(key));
    if (raw === null) return null;

    // fire-and-forget: contar hits não pode atrasar nem falhar a leitura
    this.client.hincrby(this.hitsKey, key, 1).catch(() => {});

    return { value: raw, hits: 0 };
  }

  async del(key) {
    const removed = await this.client.del(this._key(key));
    this.client.hdel(this.hitsKey, key).catch(() => {});
    return removed > 0;
  }

  async clear(pattern = '*') {
    const matched = await this._scanKeys(this._key(pattern));
    if (matched.length === 0) return 0;

    for (let i = 0; i < matched.length; i += 500) {
      const chunk = matched.slice(i, i + 500);
      await this.client.del(...chunk);
      this.client.hdel(this.hitsKey, ...chunk.map((k) => k.slice(this.prefix.length))).catch(() => {});
    }
    return matched.length;
  }

  async keys(pattern = '*') {
    const matched = await this._scanKeys(this._key(pattern));
    return matched.map((k) => k.slice(this.prefix.length));
  }

  async _scanKeys(matchPattern) {
    let cursor = '0';
    const found = [];
    do {
      const [nextCursor, batch] = await this.client.scan(cursor, 'MATCH', matchPattern, 'COUNT', 200);
      cursor = nextCursor;
      found.push(...batch);
    } while (cursor !== '0');
    return found;
  }

  async countAndSize() {
    const allKeys = await this._scanKeys(this._key('*'));
    let totalBytes = 0;

    for (let i = 0; i < allKeys.length; i += 500) {
      const chunk = allKeys.slice(i, i + 500);
      const results = await this.client.pipeline(chunk.map((k) => ['strlen', k])).exec();
      for (const [err, len] of results) {
        if (!err) totalBytes += len;
      }
    }

    return { count: allKeys.length, total_bytes: totalBytes };
  }

  async topKeys(limit = 10) {
    const hits = await this.client.hgetall(this.hitsKey);
    const candidates = Object.entries(hits)
      .map(([key, n]) => ({ key, hits: Number(n) }))
      .sort((a, b) => b.hits - a.hits)
      .slice(0, limit * 3);

    if (candidates.length === 0) return [];

    const commands = candidates.flatMap((c) => [
      ['strlen', this._key(c.key)],
      ['pttl', this._key(c.key)],
    ]);
    const results = await this.client.pipeline(commands).exec();

    const items = [];
    candidates.forEach((c, i) => {
      const [, size] = results[i * 2];
      const [, pttl] = results[i * 2 + 1];
      if (pttl === -2) return; // a chave já não existe
      items.push({
        key: c.key,
        hits: c.hits,
        size_bytes: size || 0,
        expires_at: pttl > 0 ? new Date(Date.now() + pttl).toISOString() : null,
      });
    });

    return items.slice(0, limit);
  }

  async cleanupExpired() {
    // O Redis expira chaves automaticamente via TTL nativo.
    return 0;
  }

  async close() {
    if (this.client) this.client.disconnect();
  }
}

// =======================================================================
// FALLBACK ADAPTER (Redis primário, SQLite de recurso)
// =======================================================================

class FallbackAdapter {
  constructor(primary, fallback, { healthCheckIntervalMs = 30000, onLog, onLogError } = {}) {
    this.primary = primary;
    this.fallback = fallback;
    this.primaryHealthy = true;
    this.healthCheckIntervalMs = healthCheckIntervalMs;
    this._healthTimer = null;
    this._log = onLog || (() => {});
    this._logError = onLogError || (() => {});
  }

  get driverName() {
    return this.primaryHealthy ? 'redis' : 'redis (fallback ativo: sqlite)';
  }

  async _run(method, args) {
    if (this.primaryHealthy) {
      try {
        return await this.primary[method](...args);
      } catch (err) {
        this.primaryHealthy = false;
        this._logError(`Redis falhou em '${method}', a usar SQLite como fallback:`, err);
        this._scheduleHealthCheck();
      }
    }
    return this.fallback[method](...args);
  }

  _scheduleHealthCheck() {
    if (this._healthTimer) return;

    this._healthTimer = setTimeout(async () => {
      this._healthTimer = null;
      try {
        await this.primary.ping();
        // Durante a falha, as invalidações só chegaram ao SQLite. O Redis pode ter valores
        // velhos, e o SQLite pode ter valores que vão ficar velhos assim que voltarmos ao Redis.
        // Limpamos os dois antes de voltar.
        await this.primary.clear('*');
        await this.fallback.clear('*');
        this.primaryHealthy = true;
        this._log('Redis voltou a ficar disponível (cache limpa por segurança), a retomar utilização.');
      } catch (err) {
        this._scheduleHealthCheck();
      }
    }, this.healthCheckIntervalMs);

    if (this._healthTimer.unref) this._healthTimer.unref();
  }

  async set(...args) { return this._run('set', args); }
  async get(...args) { return this._run('get', args); }
  async del(...args) { return this._run('del', args); }
  async clear(...args) { return this._run('clear', args); }
  async keys(...args) { return this._run('keys', args); }
  async countAndSize(...args) { return this._run('countAndSize', args); }
  async topKeys(...args) { return this._run('topKeys', args); }
  async cleanupExpired(...args) { return this._run('cleanupExpired', args); }

  async flushHits() {
    if (this.fallback.flushHits) await this.fallback.flushHits();
  }

  async close() {
    if (this._healthTimer) clearTimeout(this._healthTimer);
    try { await this.primary.close(); } catch (err) { /* ignora */ }
    try { await this.fallback.close(); } catch (err) { /* ignora */ }
  }
}

// =======================================================================
// CONFIG E ESTADO
// =======================================================================

let adapter = null;
let metaDb = null;
let cleanupTimer = null;
let flushTimer = null;
let metaFlushing = false;
// Promise da inicialização em curso: chamadas concorrentes esperam pelo mesmo init.
let initPromise = null;

// Single-flight: pedidos simultâneos para a mesma chave partilham a mesma query
const inflight = new Map();

// Stats em memória (gravadas em lote por flushMeta)
const counters = { hit: 0, miss: 0, set: 0, delete: 0 };
const historyBuffer = [];

const config = {
  driver: process.env.CACHE_DRIVER || 'sqlite', // 'sqlite' | 'redis'
  enableLogging: process.env.CACHE_LOGGING === 'true', // um log por pedido tem custo: desligado por defeito
  enableHistory: process.env.CACHE_HISTORY === 'true', // histórico completo; erros são sempre registados
  cleanupInterval: 3600000,
  statsFlushInterval: 10000,
  // Limite de disco da cache (default 200 MB; ajustável por CACHE_MAX_MB).
  maxCacheSize: Number(process.env.CACHE_MAX_MB || 200) * 1024 * 1024,
  redisHealthCheckInterval: 30000,
  redis: {
    url: process.env.REDIS_URL,
    host: process.env.REDIS_HOST,
    port: process.env.REDIS_PORT ? Number(process.env.REDIS_PORT) : undefined,
    password: process.env.REDIS_PASSWORD,
    prefix: 'cache:',
  },
};

console.log(`[CACHE] CacheRoutes.js carregado — instância ${MODULE_INSTANCE_ID} — ${__filename}`);

function eduallLog(message) {
  if (config.enableLogging) {
    console.log(`[${new Date().toISOString()}] [CACHE:${MODULE_INSTANCE_ID}] ${message}`);
  }
}

function eduallLogError(message, err) {
  console.error(`[${new Date().toISOString()}] [CACHE ERROR:${MODULE_INSTANCE_ID}] ${message}`, err);
}

async function eduallCreateAdapter() {
  const sqliteAdapter = await new SQLiteAdapter({
    dbPath: path.join(CACHE_DIR, 'cache.db'),
    maxBytes: config.maxCacheSize,
  }).connect();

  if (config.driver !== 'redis') {
    eduallLog('A usar adapter: SQLite');
    return sqliteAdapter;
  }

  const hasRedisConfig = !!(config.redis.url || config.redis.host);
  if (!hasRedisConfig) {
    eduallLog('CACHE_DRIVER=redis mas sem REDIS_URL/REDIS_HOST definido — a usar SQLite.');
    return sqliteAdapter;
  }

  try {
    const redisAdapter = await new RedisAdapter(config.redis).connect();
    eduallLog('A usar adapter: Redis (com fallback automático para SQLite)');
    // Garante que o SQLite de recurso começa vazio (pode ter dados velhos de um arranque anterior)
    await sqliteAdapter.clear('*');
    return new FallbackAdapter(redisAdapter, sqliteAdapter, {
      healthCheckIntervalMs: config.redisHealthCheckInterval,
      onLog: eduallLog,
      onLogError: eduallLogError,
    });
  } catch (err) {
    eduallLogError('Falha ao ligar ao Redis no arranque, a usar SQLite:', err);
    return sqliteAdapter;
  }
}

async function eduallInitMetaDb() {
  await ensureDir(CACHE_DIR);

  metaDb = await open({ filename: META_DB_PATH, driver: sqlite3.Database });

  await metaDb.exec('PRAGMA journal_mode = WAL');
  await metaDb.exec('PRAGMA busy_timeout = 5000');

  await metaDb.exec(`
    CREATE TABLE IF NOT EXISTS eduall_cache_stats (
      ed_id INTEGER PRIMARY KEY AUTOINCREMENT,
      ed_total_hits INTEGER DEFAULT 0,
      ed_total_misses INTEGER DEFAULT 0,
      ed_total_sets INTEGER DEFAULT 0,
      ed_total_deletes INTEGER DEFAULT 0,
      ed_updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS eduall_cache_history (
      ed_id INTEGER PRIMARY KEY AUTOINCREMENT,
      ed_action TEXT NOT NULL,
      ed_key TEXT NOT NULL,
      ed_status TEXT NOT NULL,
      ed_value_size INTEGER DEFAULT 0,
      ed_execution_time_ms INTEGER DEFAULT 0,
      ed_created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_eduall_history_action ON eduall_cache_history(ed_action);
    CREATE INDEX IF NOT EXISTS idx_eduall_history_key ON eduall_cache_history(ed_key);
    CREATE INDEX IF NOT EXISTS idx_eduall_history_created ON eduall_cache_history(ed_created_at);
  `);

  const check = await metaDb.get('SELECT COUNT(*) AS count FROM eduall_cache_stats');
  if (check.count === 0) {
    await metaDb.run(
      'INSERT INTO eduall_cache_stats (ed_total_hits, ed_total_misses, ed_total_sets, ed_total_deletes) VALUES (0, 0, 0, 0)'
    );
  }
}

// =======================================================================
// STATS E HISTÓRICO (em memória, gravados em lote)
// =======================================================================

function eduallUpdateStats(action, n = 1) {
  if (action in counters && n > 0) counters[action] += n;
}

function eduallRecordHistory(action, key, status, valueSize = 0, executionTime = 0) {
  if (!metaDb) return;
  // Sem histórico por pedido, a não ser que esteja ativo. Erros são sempre guardados.
  if (!config.enableHistory && status !== 'ERROR') return;

  if (historyBuffer.length >= MAX_HISTORY_BUFFER) historyBuffer.shift();
  historyBuffer.push([action, key, status, valueSize, executionTime]);
}

async function flushMeta() {
  if (metaFlushing) return;
  metaFlushing = true;

  try {
    // Hits acumulados do adapter (SQLite)
    if (adapter && adapter.flushHits) await adapter.flushHits();

    if (!metaDb) return;

    const c = { ...counters };
    const hasStats = c.hit || c.miss || c.set || c.delete;
    const history = historyBuffer.splice(0, historyBuffer.length);

    if (hasStats) {
      counters.hit = counters.miss = counters.set = counters.delete = 0;
      try {
        await metaDb.run(
          `UPDATE eduall_cache_stats SET
             ed_total_hits = ed_total_hits + ?,
             ed_total_misses = ed_total_misses + ?,
             ed_total_sets = ed_total_sets + ?,
             ed_total_deletes = ed_total_deletes + ?,
             ed_updated_at = CURRENT_TIMESTAMP
           WHERE ed_id = 1`,
          [c.hit, c.miss, c.set, c.delete]
        );
      } catch (err) {
        for (const k of Object.keys(c)) counters[k] += c[k]; // devolve se falhar
      }
    }

    if (history.length > 0) {
      try {
        await metaDb.exec('BEGIN IMMEDIATE');
        try {
          for (const row of history) {
            await metaDb.run(
              `INSERT INTO eduall_cache_history
                 (ed_action, ed_key, ed_status, ed_value_size, ed_execution_time_ms)
               VALUES (?, ?, ?, ?, ?)`,
              row
            );
          }
          await metaDb.exec('COMMIT');
        } catch (err) {
          await metaDb.exec('ROLLBACK').catch(() => {});
          throw err;
        }
      } catch (err) {
        // Falha silenciosa: o histórico não pode derrubar nada
      }
    }
  } catch (err) {
    eduallLogError('Erro no flush de stats:', err);
  } finally {
    metaFlushing = false;
  }
}

// =======================================================================
// API PÚBLICA
// =======================================================================

async function eduallSet(key, value, ttl = 3600) {
  await eduallReady();
  if (!adapter) {
    eduallLog(`SET ${key} ignorado — cache ainda não inicializada`);
    return false;
  }
  if (value === undefined) return false;

  const startTime = Date.now();
  try {
    const requestedTtl = Math.max(1, Math.floor(Number(ttl) || 3600));
    const ttlSeconds =
      CACHE_MAX_TTL_SECONDS > 0
        ? Math.min(requestedTtl, CACHE_MAX_TTL_SECONDS)
        : requestedTtl;
    const valueJson = JSON.stringify(value);
    const valueSize = Buffer.byteLength(valueJson);

    await adapter.set(key, valueJson, ttlSeconds, valueSize);

    eduallUpdateStats('set');
    eduallRecordHistory('SET', key, 'SUCCESS', valueSize, Date.now() - startTime);
    eduallLog(`SET ${key} (TTL: ${ttlSeconds}s)`);
    return true;
  } catch (err) {
    eduallLogError(`SET ERROR ${key}:`, err);
    eduallRecordHistory('SET', key, 'ERROR', 0, Date.now() - startTime);
    return false;
  }
}

async function eduallGet(key) {
  await eduallReady();
  if (!adapter) {
    eduallLog(`GET ${key} ignorado — cache ainda não inicializada`);
    return null;
  }

  const startTime = Date.now();
  try {
    const result = await adapter.get(key);

    if (result === null) {
      eduallUpdateStats('miss');
      eduallRecordHistory('GET', key, 'MISS', 0, Date.now() - startTime);
      eduallLog(`MISS ${key}`);
      return null;
    }

    if (result.expired) {
      eduallUpdateStats('miss');
      eduallRecordHistory('GET', key, 'EXPIRED', 0, Date.now() - startTime);
      eduallLog(`EXPIRED ${key}`);
      return null;
    }

    eduallUpdateStats('hit');
    eduallRecordHistory('GET', key, 'HIT', Buffer.byteLength(result.value), Date.now() - startTime);
    eduallLog(`HIT ${key}`);
    return JSON.parse(result.value);
  } catch (err) {
    eduallLogError(`GET ERROR ${key}:`, err);
    eduallRecordHistory('GET', key, 'ERROR', 0, Date.now() - startTime);
    return null;
  }
}

async function eduallDel(key) {
  await eduallReady();
  if (!adapter) {
    eduallLog(`DELETE ${key} ignorado — cache ainda não inicializada`);
    return false;
  }

  try {
    const removed = await adapter.del(key);
    if (removed) {
      eduallUpdateStats('delete');
      eduallRecordHistory('DELETE', key, 'SUCCESS', 0, 0);
      eduallLog(`DELETE ${key}`);
    }
    return removed;
  } catch (err) {
    eduallLogError(`DELETE ERROR ${key}:`, err);
    eduallRecordHistory('DELETE', key, 'ERROR', 0, 0);
    return false;
  }
}

async function eduallClear(pattern = '*') {
  await eduallReady();
  if (!adapter) {
    eduallLog(`CLEAR ${pattern} ignorado — cache ainda não inicializada`);
    return 0;
  }

  try {
    const removedCount = await adapter.clear(pattern);
    eduallLog(`CLEAR ${pattern} (${removedCount} chaves removidas)`);
    eduallUpdateStats('delete', removedCount);
    return removedCount;
  } catch (err) {
    eduallLogError(`CLEAR ERROR ${pattern}:`, err);
    return 0;
  }
}

async function eduallKeys(pattern = '*') {
  if (!adapter) {
    eduallLog(`KEYS ${pattern} ignorado — cache ainda não inicializada`);
    return [];
  }

  try {
    return await adapter.keys(pattern);
  } catch (err) {
    eduallLogError(`KEYS ERROR ${pattern}:`, err);
    return [];
  }
}

async function eduallStats() {
  if (!adapter || !metaDb) {
    eduallLog('STATS ignorado — cache ainda não inicializada');
    return null;
  }

  try {
    await flushMeta();

    const dbStats = await metaDb.get('SELECT * FROM eduall_cache_stats LIMIT 1');
    const { count, total_bytes } = await adapter.countAndSize();
    const topKeys = await adapter.topKeys(10);

    const totalHits = dbStats.ed_total_hits || 0;
    const totalMisses = dbStats.ed_total_misses || 0;
    const totalRequests = totalHits + totalMisses;
    const hitRate = totalRequests > 0 ? ((totalHits / totalRequests) * 100).toFixed(2) : 0;

    return {
      driver: adapter.driverName || config.driver,
      total_hits: dbStats.ed_total_hits,
      total_misses: dbStats.ed_total_misses,
      total_sets: dbStats.ed_total_sets,
      total_deletes: dbStats.ed_total_deletes,
      total_keys: count || 0,
      total_size_bytes: total_bytes || 0,
      total_size_mb: ((total_bytes || 0) / 1024 / 1024).toFixed(2),
      hit_rate: hitRate,
      top_keys: topKeys,
      memory_usage_percent: (((total_bytes || 0) / config.maxCacheSize) * 100).toFixed(2),
    };
  } catch (err) {
    eduallLogError('Erro ao obter stats:', err);
    return null;
  }
}

async function eduallHistory(limit = 100) {
  if (!metaDb) {
    eduallLog('HISTORY ignorado — cache ainda não inicializada');
    return [];
  }

  try {
    await flushMeta();
    return await metaDb.all(
      `SELECT ed_action, ed_key, ed_status, ed_value_size, ed_execution_time_ms, ed_created_at
       FROM eduall_cache_history
       ORDER BY ed_id DESC
       LIMIT ?`,
      [limit]
    );
  } catch (err) {
    eduallLogError('Erro ao obter histórico:', err);
    return [];
  }
}

async function eduallCleanup() {
  if (!adapter || !metaDb) {
    eduallLog('CLEANUP ignorado — cache ainda não inicializada');
    return 0;
  }

  try {
    const removed = await adapter.cleanupExpired();
    if (removed > 0) eduallLog(`CLEANUP ${removed} itens removidos (expirados/eviction)`);

    await metaDb.run("DELETE FROM eduall_cache_history WHERE ed_created_at < datetime('now', '-7 days')");

    return removed;
  } catch (err) {
    eduallLogError('Erro no cleanup:', err);
    return 0;
  }
}

function eduallStartTimers() {
  if (!cleanupTimer) {
    cleanupTimer = setInterval(() => { eduallCleanup(); }, config.cleanupInterval);
    if (cleanupTimer.unref) cleanupTimer.unref();
  }
  if (!flushTimer) {
    flushTimer = setInterval(() => { flushMeta(); }, config.statsFlushInterval);
    if (flushTimer.unref) flushTimer.unref();
  }
}

// Cache-aside com single-flight:
// N pedidos simultâneos para a mesma chave fazem UMA só query à base de dados.
async function eduallWithCache(cacheKey, ttl, asyncFn) {
  await eduallReady();
  if (!adapter) {
    eduallLog('Cache não inicializado, a executar sem cache');
    return asyncFn();
  }

  const cached = await eduallGet(cacheKey);
  if (cached !== null) return cached;

  if (inflight.has(cacheKey)) return inflight.get(cacheKey);

  const promise = (async () => {
    const data = await asyncFn();
    // != null (e não truthy): arrays vazios e 0 também são resultados válidos
    if (data != null) await eduallSet(cacheKey, data, ttl);
    return data;
  })().finally(() => inflight.delete(cacheKey));

  inflight.set(cacheKey, promise);
  return promise;
}

// Aceita uma chave, um array de chaves, ou padrões com '*'. Devolve quantas chaves foram removidas.
async function eduallInvalidate(keysInput) {
  await eduallReady();
  if (!adapter) return 0;

  try {
    const keysArray = (Array.isArray(keysInput) ? keysInput : [keysInput]).filter(Boolean);

    const results = await Promise.all(
      keysArray.map(async (key) => {
        // Uma invalidação também cancela a query em curso dessa chave (evita repor valor velho)
        if (!key.includes('*')) inflight.delete(key);
        return key.includes('*') ? eduallClear(key) : (await eduallDel(key) ? 1 : 0);
      })
    );

    return results.reduce((sum, n) => sum + n, 0);
  } catch (err) {
    eduallLogError('Erro ao invalidar cache:', err);
    return 0;
  }
}

async function eduallClose() {
  try {
    if (cleanupTimer) clearInterval(cleanupTimer);
    if (flushTimer) clearInterval(flushTimer);
    cleanupTimer = null;
    flushTimer = null;

    await flushMeta();

    if (adapter) await adapter.close();
    if (metaDb) await metaDb.close();
    adapter = null;
    metaDb = null;
    initPromise = null;
    inflight.clear();
    eduallLog('Cache fechado');
  } catch (err) {
    eduallLogError('Erro ao fechar cache:', err);
  }
}

async function eduallInit(options = {}) {
  // Se já houver uma inicialização em curso (ou concluída), devolve a mesma promise.
  if (initPromise) return initPromise;

  initPromise = (async () => {
    try {
      const { redis, ...rest } = options;
      Object.assign(config, rest);
      if (redis) config.redis = { ...config.redis, ...redis };

      await eduallInitMetaDb();
      adapter = await eduallCreateAdapter();
      eduallStartTimers();

      // Self-test direto no adapter (não conta para stats nem histórico)
      const canaryKey = '__eduall_cache_selftest__';
      const canaryValue = { ok: true, ts: Date.now() };
      await adapter.set(canaryKey, JSON.stringify(canaryValue), 60, 0);
      const readBack = await adapter.get(canaryKey);
      const passed = !!readBack && !readBack.expired && JSON.parse(readBack.value).ok === true;
      await adapter.del(canaryKey);

      if (passed) {
        console.log(`[CACHE:${MODULE_INSTANCE_ID}] ✅ Self-test PASSOU — cache operacional (driver: ${adapter.driverName})`);
      } else {
        eduallLogError('❌ Self-test FALHOU — get/set não bateram certo. Resultado:', readBack);
      }

      return true;
    } catch (err) {
      eduallLogError('Falha ao inicializar cache:', err);
      initPromise = null; // permite tentar de novo mais tarde
      throw err;
    }
  })();

  return initPromise;
}

// Permite a qualquer código esperar pela cache antes de a usar
async function eduallReady() {
  if (initPromise) {
    try {
      await initPromise;
    } catch (err) {
      // Já foi logado em eduallInit
    }
  }
  return !!adapter;
}

// ─────────────────────────────────────────────────────────────────────────
// AUTO-INICIALIZAÇÃO
// Antes, eduallInit() nunca era chamado em nenhum ponto da aplicação: o
// módulo era carregado mas `adapter` ficava null, pelo que TODAS as
// operações de cache eram ignoradas (Get/Set devolviam null/false).
// Iniciar aqui (SQLite por defeito, Redis quando configurado) ativa a
// cache em todo o app. Os timers têm .unref(), por isso não prendem o
// processo em scripts.
// ─────────────────────────────────────────────────────────────────────────
if (CACHE_ENABLED) {
  eduallInit().catch((err) => {
    console.error("[CACHE] Falha ao inicializar:", err && err.message);
  });
} else {
  console.warn("[CACHE] Desativada por CACHE_ENABLED=false");
}

module.exports = {
  eduallInit,
  eduallReady,
  eduallWithCache,
  eduallInvalidate,
  eduallSet,
  eduallGet,
  eduallDel,
  eduallClear,
  eduallStats,
  eduallKeys,
  eduallHistory,
  eduallClose,
  eduallCleanup,
};