const path = require('path');
const fs = require('fs');
const fsPromises = require('fs').promises;  // ← NOVO: fs.promises para async
const sqlite3 = require('sqlite3');
const { open } = require('sqlite');

class SQLiteAdapter {
  constructor(options = {}) {
    this.dbPath = options.dbPath || path.join(__dirname, '../cache/eduall_app_cache.db');
    this.db = null;
    this.driverName = 'sqlite';
  }

  async connect() {
    const dir = path.dirname(this.dbPath);
    
    // Garantir que diretório existe (async, não bloqueia)
    try {
      await fsPromises.stat(dir);
    } catch {
      try {
        await fsPromises.mkdir(dir, { recursive: true });
      } catch (err) {
        console.warn('⚠️ Erro ao criar diretório cache:', err.message);
      }
    }

    this.db = await open({
      filename: this.dbPath,
      driver: sqlite3.Database
    });

    await this.db.exec('PRAGMA journal_mode = WAL');
    await this.db.exec('PRAGMA synchronous = NORMAL');

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

      CREATE INDEX IF NOT EXISTS idx_eduall_cache_key ON eduall_cache_data(ed_key);
      CREATE INDEX IF NOT EXISTS idx_eduall_cache_expires ON eduall_cache_data(ed_expires_at);
      CREATE INDEX IF NOT EXISTS idx_eduall_cache_hits ON eduall_cache_data(ed_hits DESC);
    `);

    return this;
  }

  async set(key, valueJson, ttlSeconds, sizeBytes) {
    const expiresAt = new Date(Date.now() + ttlSeconds * 1000).toISOString();

    await this.db.run(`
      INSERT OR REPLACE INTO eduall_cache_data (ed_key, ed_value, ed_ttl, ed_expires_at, ed_size_bytes, ed_hits, ed_created_at, ed_last_accessed)
      VALUES (?, ?, ?, ?, ?, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    `, [key, valueJson, ttlSeconds, expiresAt, sizeBytes]);

    return true;
  }

  async get(key) {
    const row = await this.db.get(`
      SELECT ed_value, ed_expires_at, ed_hits FROM eduall_cache_data WHERE ed_key = ?
    `, [key]);

    if (!row) return null;

    if (new Date(row.ed_expires_at) < new Date()) {
      await this.del(key);
      return { expired: true };
    }

    await this.db.run(`
      UPDATE eduall_cache_data SET ed_hits = ed_hits + 1, ed_last_accessed = CURRENT_TIMESTAMP WHERE ed_key = ?
    `, [key]);

    return { value: row.ed_value, hits: row.ed_hits + 1 };
  }

  async del(key) {
    const result = await this.db.run('DELETE FROM eduall_cache_data WHERE ed_key = ?', [key]);
    return result.changes > 0;
  }

  async clear(pattern = '*') {
    if (pattern === '*') {
      const result = await this.db.run('DELETE FROM eduall_cache_data');
      return result.changes;
    }

    const sqlPattern = pattern.replace(/\*/g, '%');
    const result = await this.db.run('DELETE FROM eduall_cache_data WHERE ed_key LIKE ?', [sqlPattern]);
    return result.changes;
  }

  async keys(pattern = '*') {
    if (pattern === '*') {
      const rows = await this.db.all('SELECT ed_key FROM eduall_cache_data');
      return rows.map(r => r.ed_key);
    }

    const sqlPattern = pattern.replace(/\*/g, '%');
    const rows = await this.db.all('SELECT ed_key FROM eduall_cache_data WHERE ed_key LIKE ?', [sqlPattern]);
    return rows.map(r => r.ed_key);
  }

  async countAndSize() {
    const row = await this.db.get(`
      SELECT COUNT(*) as count, SUM(ed_size_bytes) as total_bytes FROM eduall_cache_data
    `);
    return { count: row.count || 0, total_bytes: row.total_bytes || 0 };
  }

  async topKeys(limit = 10) {
    return await this.db.all(`
      SELECT ed_key, ed_hits, ed_size_bytes, ed_expires_at
      FROM eduall_cache_data
      ORDER BY ed_hits DESC
      LIMIT ?
    `, [limit]);
  }

  async cleanupExpired() {
    const result = await this.db.run('DELETE FROM eduall_cache_data WHERE ed_expires_at < CURRENT_TIMESTAMP');
    return result.changes;
  }

  async close() {
    if (this.db) await this.db.close();
  }
}

class RedisAdapter {
  constructor(options = {}) {
    this.options = options;
    this.prefix = options.prefix || 'cache:';
    this.client = null;
    this.driverName = 'redis';
  }

  _connectionOptions() {
    return {
      lazyConnect: true,       // não liga automaticamente no construtor
      connectTimeout: 2000,    // não deixa o arranque da app à espera
      maxRetriesPerRequest: 1, // falha rápido em vez de ficar preso
      retryStrategy: () => null, // sem retries automáticos do ioredis
      enableOfflineQueue: false  // não acumula comandos enquanto está offline
    };
  }

  async connect() {
    let Redis;
    try {
      // eslint-disable-next-line global-require
      Redis = require('ioredis');
    } catch (err) {
      throw new Error(
        "Driver 'redis' ativo mas o pacote 'ioredis' não está instalado. " +
        "Corre: npm install ioredis"
      );
    }

    this.client = this.options.url
      ? new Redis(this.options.url, this._connectionOptions())
      : new Redis({
          host: this.options.host || '127.0.0.1',
          port: this.options.port || 6379,
          password: this.options.password,
          db: this.options.db || 0,
          ...this._connectionOptions()
        });

    // Sem isto, um erro de ligação faz o Node rebentar (unhandled 'error' event).
    // Os erros reais de cada comando são apanhados pelo FallbackAdapter.
    this.client.on('error', () => {});

    await this.client.connect();
    await this.client.ping();

    return this;
  }

  async ping() {
    await this.client.ping();
  }

  _key(key) {
    return `${this.prefix}${key}`;
  }

  async set(key, valueJson, ttlSeconds, sizeBytes) {
    const envelope = JSON.stringify({ value: valueJson, hits: 0, size_bytes: sizeBytes });
    await this.client.set(this._key(key), envelope, 'EX', ttlSeconds);
    return true;
  }

  async get(key) {
    const raw = await this.client.get(this._key(key));
    if (raw === null) return null;

    const envelope = JSON.parse(raw);
    envelope.hits += 1;

    const ttl = await this.client.ttl(this._key(key));
    if (ttl > 0) {
      await this.client.set(this._key(key), JSON.stringify(envelope), 'KEEPTTL');
    }

    return { value: envelope.value, hits: envelope.hits };
  }

  async del(key) {
    const removed = await this.client.del(this._key(key));
    return removed > 0;
  }

  async clear(pattern = '*') {
    const matchedKeys = await this._scanKeys(this._key(pattern));
    if (matchedKeys.length === 0) return 0;
    await this.client.del(...matchedKeys);
    return matchedKeys.length;
  }

  async keys(pattern = '*') {
    const matchedKeys = await this._scanKeys(this._key(pattern));
    return matchedKeys.map(k => k.slice(this.prefix.length));
  }

  async _scanKeys(matchPattern) {
    let cursor = '0';
    const found = [];
    do {
      const [nextCursor, batch] = await this.client.scan(cursor, 'MATCH', matchPattern, 'COUNT', 100);
      cursor = nextCursor;
      found.push(...batch);
    } while (cursor !== '0');
    return found;
  }

  async countAndSize() {
    const allKeys = await this._scanKeys(this._key('*'));
    let totalBytes = 0;
    for (const k of allKeys) {
      const raw = await this.client.get(k);
      if (raw) totalBytes += Buffer.byteLength(raw);
    }
    return { count: allKeys.length, total_bytes: totalBytes };
  }

  async topKeys(limit = 10) {
    const allKeys = await this._scanKeys(this._key('*'));
    const items = [];

    for (const k of allKeys) {
      const raw = await this.client.get(k);
      if (!raw) continue;
      const envelope = JSON.parse(raw);
      const ttl = await this.client.ttl(k);
      items.push({
        key: k.slice(this.prefix.length),
        hits: envelope.hits || 0,
        size_bytes: envelope.size_bytes || 0,
        expires_at: ttl > 0 ? new Date(Date.now() + ttl * 1000).toISOString() : null
      });
    }

    return items.sort((a, b) => b.hits - a.hits).slice(0, limit);
  }

  async cleanupExpired() {
    // O Redis expira chaves automaticamente via TTL nativo.
    return 0;
  }

  close() {
    if (this.client) this.client.disconnect();
  }
}

/**
 * FallbackAdapter
 * ---------------
 * Envolve um adapter "primário" (Redis) e um "de recurso" (SQLite).
 * Cada operação tenta primeiro o primário; se falhar, regista o erro,
 * marca o Redis como indisponível, usa o SQLite nessa chamada, e agenda
 * uma tentativa de reconexão em segundo plano.
 */
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
    return await this.fallback[method](...args);
  }

  _scheduleHealthCheck() {
    if (this._healthTimer) return;

    this._healthTimer = setTimeout(async () => {
      this._healthTimer = null;
      try {
        await this.primary.ping();
        this.primaryHealthy = true;
        this._log('Redis voltou a ficar disponível, a retomar utilização.');
      } catch (err) {
        this._scheduleHealthCheck();
      }
    }, this.healthCheckIntervalMs);
  }

  async set(...args) { return this._run('set', args); }
  async get(...args) { return this._run('get', args); }
  async del(...args) { return this._run('del', args); }
  async clear(...args) { return this._run('clear', args); }
  async keys(...args) { return this._run('keys', args); }
  async countAndSize(...args) { return this._run('countAndSize', args); }
  async topKeys(...args) { return this._run('topKeys', args); }
  async cleanupExpired(...args) { return this._run('cleanupExpired', args); }

  async close() {
    if (this._healthTimer) clearTimeout(this._healthTimer);
    try { await this.primary.close(); } catch (err) { /* ignora */ }
    try { await this.fallback.close(); } catch (err) { /* ignora */ }
  }
}

// =======================================================================
// CONFIG
// =======================================================================

const CACHE_DIR = path.join(__dirname, '../cache');
// Stats + histórico ficam sempre em SQLite (leve), independente do
// driver escolhido para os dados de cache em si.
const META_DB_PATH = path.join(CACHE_DIR, 'cache_meta.db');

let adapter = null;
let metaDb = null;
let cleanupTimer = null;
// Promise da inicialização em curso — permite que chamadas concorrentes
// esperem pelo mesmo init em vez de verem adapter/metaDb como null.
let initPromise = null;
// ID único desta instância do módulo. Se aparecerem IDs diferentes nos
// logs de init vs. logs de GET/SET, é sinal de que o módulo está a ser
// carregado duas vezes a partir de caminhos diferentes (ex.: require
// relativo inconsistente, ou dependência duplicada em node_modules).
const MODULE_INSTANCE_ID = Math.random().toString(36).slice(2, 8);
console.log(`[CACHE] CacheRoutes.js carregado — instância ${MODULE_INSTANCE_ID} — ${__filename}`);

const config = {
  driver: process.env.CACHE_DRIVER || 'sqlite', // 'sqlite' | 'redis'
  enableLogging: true,
  cleanupInterval: 3600000,
  maxCacheSize: 500 * 1024 * 1024,
  redisHealthCheckInterval: 30000,
  redis: {
    url: process.env.REDIS_URL,
    host: process.env.REDIS_HOST,
    port: process.env.REDIS_PORT ? Number(process.env.REDIS_PORT) : undefined,
    password: process.env.REDIS_PASSWORD,
    prefix: 'cache:'
  }
};

async function eduallCreateAdapter() {
  const sqliteFallback = await new SQLiteAdapter({ dbPath: path.join(CACHE_DIR, 'cache.db') }).connect();

  if (config.driver !== 'redis') {
    eduallLog('A usar adapter: SQLite');
    return sqliteFallback;
  }

  const hasRedisConfig = !!(config.redis.url || config.redis.host);
  if (!hasRedisConfig) {
    eduallLog("CACHE_DRIVER=redis mas sem REDIS_URL/REDIS_HOST definido — a usar SQLite.");
    return sqliteFallback;
  }

  try {
    const redisAdapter = await new RedisAdapter(config.redis).connect();
    eduallLog('A usar adapter: Redis (com fallback automático para SQLite)');
    return new FallbackAdapter(redisAdapter, sqliteFallback, {
      healthCheckIntervalMs: config.redisHealthCheckInterval,
      onLog: eduallLog,
      onLogError: eduallLogError
    });
  } catch (err) {
    eduallLogError('Falha ao ligar ao Redis no arranque, a usar SQLite:', err);
    return sqliteFallback;
  }
}

async function eduallInitMetaDb() {
  // Garantir que diretório cache existe (async, não bloqueia)
  try {
    await fsPromises.stat(CACHE_DIR);
  } catch {
    try {
      await fsPromises.mkdir(CACHE_DIR, { recursive: true });
    } catch (err) {
      console.warn('⚠️ Erro ao criar CACHE_DIR:', err.message);
    }
  }

  metaDb = await open({
    filename: META_DB_PATH,
    driver: sqlite3.Database
  });

  await metaDb.exec('PRAGMA journal_mode = WAL');

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
  `);

  const check = await metaDb.get('SELECT COUNT(*) as count FROM eduall_cache_stats');
  if (check.count === 0) {
    await metaDb.run(`
      INSERT INTO eduall_cache_stats (ed_total_hits, ed_total_misses, ed_total_sets, ed_total_deletes)
      VALUES (0, 0, 0, 0)
    `);
  }
}

async function eduallUpdateStats(action) {
  const column = {
    set: 'ed_total_sets',
    hit: 'ed_total_hits',
    miss: 'ed_total_misses',
    delete: 'ed_total_deletes'
  }[action];

  if (!column) return;
  if (!metaDb) return;

  try {
    await metaDb.run(`
      UPDATE eduall_cache_stats SET ${column} = ${column} + 1, ed_updated_at = CURRENT_TIMESTAMP WHERE ed_id = 1
    `);
  } catch (err) {
    eduallLogError('Erro ao atualizar stats:', err);
  }
}

async function eduallRecordHistory(action, key, status, valueSize = 0, executionTime = 0) {
  if (!metaDb) return;

  try {
    await metaDb.run(`
      INSERT INTO eduall_cache_history (ed_action, ed_key, ed_status, ed_value_size, ed_execution_time_ms)
      VALUES (?, ?, ?, ?, ?)
    `, [action, key, status, valueSize, executionTime]);
  } catch (err) {
    // Falha silenciosa no histórico, não deve derrubar o pedido principal
  }
}

// =======================================================================
// API PÚBLICA — mesmos nomes de sempre, delegando no adapter ativo
// =======================================================================

async function eduallSet(key, value, ttl = 3600) {
  if (!adapter) {
    eduallLog(`SET ${key} ignorado — cache ainda não inicializada`);
    return false;
  }

  const startTime = Date.now();
  try {
    const valueJson = JSON.stringify(value);
    const valueSize = Buffer.byteLength(valueJson);

    await adapter.set(key, valueJson, ttl, valueSize);

    await eduallUpdateStats('set');
    await eduallRecordHistory('SET', key, 'SUCCESS', valueSize, Date.now() - startTime);
    eduallLog(`SET ${key} (TTL: ${ttl}s)`);
    return true;
  } catch (err) {
    eduallLogError(`SET ERROR ${key}:`, err);
    await eduallRecordHistory('SET', key, 'ERROR', 0, Date.now() - startTime);
    return false;
  }
}

async function eduallGet(key) {
  if (!adapter) {
    eduallLog(`GET ${key} ignorado — cache ainda não inicializada`);
    return null;
  }

  const startTime = Date.now();
  try {
    const result = await adapter.get(key);

    if (result === null) {
      await eduallUpdateStats('miss');
      await eduallRecordHistory('GET', key, 'MISS', 0, Date.now() - startTime);
      eduallLog(`MISS ${key}`);
      return null;
    }

    if (result.expired) {
      await eduallUpdateStats('miss');
      await eduallRecordHistory('GET', key, 'EXPIRED', 0, Date.now() - startTime);
      eduallLog(`EXPIRED ${key}`);
      return null;
    }

    await eduallUpdateStats('hit');
    await eduallRecordHistory('GET', key, 'HIT', Buffer.byteLength(result.value), Date.now() - startTime);
    eduallLog(`HIT ${key}`);
    return JSON.parse(result.value);
  } catch (err) {
    eduallLogError(`GET ERROR ${key}:`, err);
    await eduallRecordHistory('GET', key, 'ERROR', 0, Date.now() - startTime);
    return null;
  }
}

async function eduallDel(key) {
  if (!adapter) {
    eduallLog(`DELETE ${key} ignorado — cache ainda não inicializada`);
    return false;
  }

  try {
    const removed = await adapter.del(key);
    if (removed) {
      await eduallUpdateStats('delete');
      await eduallRecordHistory('DELETE', key, 'SUCCESS', 0, 0);
      eduallLog(`DELETE ${key}`);
    }
    return removed;
  } catch (err) {
    eduallLogError(`DELETE ERROR ${key}:`, err);
    await eduallRecordHistory('DELETE', key, 'ERROR', 0, 0);
    return false;
  }
}

async function eduallClear(pattern = '*') {
  if (!adapter) {
    eduallLog(`CLEAR ${pattern} ignorado — cache ainda não inicializada`);
    return 0;
  }

  try {
    const removedCount = await adapter.clear(pattern);
    eduallLog(`CLEAR ${pattern} (${removedCount} chaves removidas)`);
    for (let i = 0; i < removedCount; i++) await eduallUpdateStats('delete');
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
      memory_usage_percent: (((total_bytes || 0) / config.maxCacheSize) * 100).toFixed(2)
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
    return await metaDb.all(`
      SELECT ed_action, ed_key, ed_status, ed_value_size, ed_execution_time_ms, ed_created_at
      FROM eduall_cache_history
      ORDER BY ed_created_at DESC
      LIMIT ?
    `, [limit]);
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
    if (removed > 0) eduallLog(`CLEANUP ${removed} itens expirados removidos`);

    await metaDb.run(`
      DELETE FROM eduall_cache_history WHERE ed_created_at < datetime('now', '-7 days')
    `);

    return removed;
  } catch (err) {
    eduallLogError('Erro no cleanup:', err);
    return 0;
  }
}

function eduallStartCleanupInterval() {
  cleanupTimer = setInterval(() => {
    eduallCleanup();
  }, config.cleanupInterval);
}

async function eduallWithCache(cacheKey, ttl, asyncFn) {
  if (!adapter) {
    eduallLog('Cache não inicializado, a executar sem cache');
    return await asyncFn();
  }

  try {
    const cached = await eduallGet(cacheKey);
    if (cached !== null) return cached;

    const data = await asyncFn();
    if (data) await eduallSet(cacheKey, data, ttl);

    return data;
  } catch (err) {
    eduallLogError(`withCache ERROR ${cacheKey}:`, err);
    throw err;
  }
}

async function eduallInvalidate(keysInput) {
  if (!adapter) return;

  try {
    const keysArray = Array.isArray(keysInput) ? keysInput : [keysInput];

    for (const key of keysArray) {
      if (key.includes('*')) {
        await eduallClear(key);
      } else {
        await eduallDel(key);
      }
    }
  } catch (err) {
    eduallLogError('Erro ao invalidar cache:', err);
  }
}

async function eduallClose() {
  try {
    if (cleanupTimer) clearInterval(cleanupTimer);
    if (adapter) await adapter.close();
    if (metaDb) await metaDb.close();
    adapter = null;
    metaDb = null;
    initPromise = null;
    eduallLog('Cache fechado');
  } catch (err) {
    eduallLogError('Erro ao fechar cache:', err);
  }
}

async function eduallInit(options = {}) {
  // Se já houver uma inicialização em curso (ou concluída), devolve a
  // mesma promise em vez de arrancar duas inicializações em paralelo.
  if (initPromise) return initPromise;

  initPromise = (async () => {
    try {
      Object.assign(config, options);
      await eduallInitMetaDb();
      adapter = await eduallCreateAdapter();
      eduallStartCleanupInterval();

      // Self-test: confirma que o adapter realmente lê/escreve, e deixa
      // isso bem visível no log, para não haver dúvidas sobre se a cache
      // está mesmo a funcionar.
      const canaryKey = '__eduall_cache_selftest__';
      const canaryValue = { ok: true, ts: Date.now() };
      await adapter.set(canaryKey, JSON.stringify(canaryValue), 60, 0);
      const readBack = await adapter.get(canaryKey);
      const passed = !!readBack && !readBack.expired && JSON.parse(readBack.value).ok === true;
      await adapter.del(canaryKey);

      if (passed) {
        eduallLog(`✅ Self-test PASSOU — cache operacional (driver: ${adapter.driverName})`);
      } else {
        eduallLogError('❌ Self-test FALHOU — adapter respondeu mas get/set não bateram certo. Resultado:', readBack);
      }

      return true;
    } catch (err) {
      eduallLogError('Falha ao inicializar cache:', err);
      // Permite tentar inicializar de novo mais tarde em vez de ficar
      // permanentemente preso a uma promise rejeitada.
      initPromise = null;
      throw err;
    }
  })();

  return initPromise;
}

// Permite a qualquer código (rotas, middleware) esperar pela cache antes
// de a usar, sem ter de repetir o `!adapter` manualmente em todo o lado.
async function eduallReady() {
  if (initPromise) {
    try {
      await initPromise;
    } catch (err) {
      // Já foi logado em eduallInit; aqui só evitamos rejeição não tratada.
    }
  }
  return !!adapter;
}

function eduallLog(message) {
  if (config.enableLogging) {
    console.log(`[${new Date().toISOString()}] [CACHE:${MODULE_INSTANCE_ID}] ${message}`);
  }
}

function eduallLogError(message, err) {
  console.error(`[${new Date().toISOString()}] [CACHE ERROR:${MODULE_INSTANCE_ID}] ${message}`, err);
}

module.exports = {
  eduallInit: eduallInit,
  eduallReady: eduallReady,
  eduallWithCache: eduallWithCache,
  eduallInvalidate: eduallInvalidate,
  eduallSet: eduallSet,
  eduallGet: eduallGet,
  eduallDel: eduallDel,
  eduallClear: eduallClear,
  eduallStats: eduallStats,
  eduallKeys: eduallKeys,
  eduallHistory: eduallHistory,
  eduallClose: eduallClose,
  eduallCleanup: eduallCleanup
};