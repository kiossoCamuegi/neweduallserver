const path = require("path");
const sqlite3 = require("sqlite3").verbose();
const { DATABASE, DB_CONFIG } = require("../config/Database");

const DB_PATH = path.join(__dirname, "local.db");

let sqliteDb = null;
const SCHEMA_SYNC_INTERVAL = 10 * 60 * 1000; // 10 min
let lastSchemaSyncMemory = 0;
const ENABLE_DESTRUCTIVE_SCHEMA_SYNC = false; // reservado para futuras migrações destrutivas (não usado ainda)

// ========= SQLITE =========

function openSqlite() {
  return new Promise((resolve, reject) => {
    if (sqliteDb) return resolve(sqliteDb);
    sqliteDb = new sqlite3.Database(DB_PATH, (err) => {
      if (err) return reject(err);
      console.log(`[SQLite] Opened ${DB_PATH}`);
      resolve(sqliteDb);
    });
  });
}

function sqliteExecute(sql, params = [], isSelect = true) {
  return new Promise((resolve, reject) => {
    if (!sqliteDb) return reject(new Error("SQLite not initialized"));

    if (isSelect) {
      sqliteDb.all(sql, params, (err, rows) => {
        if (err) return reject(err);
        resolve(rows || []);
      });
    } else {
      sqliteDb.run(sql, params, function (err) {
        if (err) return reject(err);
        resolve({ lastID: this.lastID, changes: this.changes });
      });
    }
  });
}

// ========= MYSQL =========

async function mysqlExecute(sql, params = [], isSelect = true) {
  const [rows] = await DATABASE.query(sql, params);
  return rows;
}

// ========= Schema Sync Helpers =========

async function getMySQLTables() {
  const [rows] = await DATABASE.query(`
      SELECT TABLE_NAME
      FROM INFORMATION_SCHEMA.TABLES
      WHERE TABLE_SCHEMA = DATABASE()
  `);
  return rows.map((r) => r.TABLE_NAME);
}

async function getMySQLColumns(table) {
  const [rows] = await DATABASE.query(
    `
      SELECT COLUMN_NAME, DATA_TYPE, COLUMN_KEY, EXTRA
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = ?
  `,
    [table]
  );

  return rows.map((c) => ({
    name: c.COLUMN_NAME,
    type: c.DATA_TYPE,
    pk: c.COLUMN_KEY === "PRI",
    autoInc: c.EXTRA?.includes("auto_increment"),
  }));
}

async function getSQLiteTables() {
  const rows = await sqliteExecute(
    "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
  );
  return rows.map((r) => r.name);
}

async function getSQLiteColumns(table) {
  const rows = await sqliteExecute(`PRAGMA table_info(${table})`);
  return rows.map((r) => ({
    name: r.name,
    type: r.type,
    pk: r.pk === 1,
  }));
}

function mapMysqlToSqlite(mysqlType) {
  const t = (mysqlType || "").toLowerCase();
  if (t.includes("int")) return "INTEGER";
  if (t.includes("char") || t.includes("text")) return "TEXT";
  if (t.includes("blob")) return "BLOB";
  if (t.includes("double") || t.includes("float")) return "REAL";
  if (t.includes("decimal")) return "REAL";
  if (t.includes("date") || t.includes("time")) return "TEXT";
  return "TEXT";
}

// ========= Meta table for schema sync =========

async function ensureMeta() {
  await openSqlite();
  await sqliteExecute(
    `CREATE TABLE IF NOT EXISTS __meta (key TEXT PRIMARY KEY, value TEXT)`,
    [],
    false
  );
}

async function getLastSync() {
  await ensureMeta();
  const rows = await sqliteExecute(
    "SELECT value FROM __meta WHERE key = ?",
    ["last_schema_sync"]
  );
  return rows.length ? Number(rows[0].value) : 0;
}

async function setLastSync(ts) {
  await ensureMeta();
  await sqliteExecute(
    `
      INSERT INTO __meta (key,value)
      VALUES ('last_schema_sync',?)
      ON CONFLICT(key) DO UPDATE SET value=excluded.value
  `,
    [String(ts)],
    false
  );
}

// ========= Sync Schema =========

async function syncLocalSchemaFromMySQL() {
  try {
    await openSqlite();
    console.log("\n[SCHEMA] Syncing structure MySQL → SQLite...");

    const mysqlTables = await getMySQLTables();
    const sqliteTables = await getSQLiteTables();

    for (const table of mysqlTables) {
      const mysqlCols = await getMySQLColumns(table);
      const hasLocal = sqliteTables.includes(table);

      if (!hasLocal) {
        const create = mysqlCols
          .map((c) => {
            const type = mapMysqlToSqlite(c.type);
            return c.pk
              ? `"${c.name}" ${type} PRIMARY KEY`
              : `"${c.name}" ${type}`;
          })
          .join(", ");

        await sqliteExecute(`CREATE TABLE "${table}" (${create})`, [], false);
        console.log(`[SCHEMA] Created table: ${table}`);
        continue;
      }

      const sqliteCols = await getSQLiteColumns(table);
      const sqliteNames = sqliteCols.map((c) => c.name);
      const mysqlNames = mysqlCols.map((c) => c.name);

      // Add missing columns
      for (const c of mysqlCols) {
        if (!sqliteNames.includes(c.name)) {
          const type = mapMysqlToSqlite(c.type);
          await sqliteExecute(
            `ALTER TABLE "${table}" ADD COLUMN "${c.name}" ${type}`,
            [],
            false
          );
          console.log(`[SCHEMA] Added column ${c.name} to ${table}`);
        }
      }

      // Warn about extra local columns
      const extraLocal = sqliteNames.filter((n) => !mysqlNames.includes(n));
      if (extraLocal.length) {
        console.log(
          `[SCHEMA] Warning: table '${table}' has extra local cols:`,
          extraLocal
        );
      }
    }

    console.log("[SCHEMA] Sync completed.\n");
  } catch (err) {
    console.error("[SCHEMA] Sync error:", err.message);
  }
}

async function maybeSyncLocalSchema() {
  try {
    const now = Date.now();
    if (now - lastSchemaSyncMemory < 30_000) return;

    const lastDb = await getLastSync();
    if (now - lastDb < SCHEMA_SYNC_INTERVAL) {
      lastSchemaSyncMemory = now;
      return;
    }

    await syncLocalSchemaFromMySQL();
    await setLastSync(now);
    lastSchemaSyncMemory = now;
  } catch (err) {
    if (err.code === "SQLITE_READONLY") {
      console.warn(
        "[SCHEMA] SQLite é read-only, a sincronização local foi ignorada."
      );
      return;
    }
    console.error("[SCHEMA] Erro na sincronização:", err.message);
  }
}

// ========= Query classifier =========

function isMySqlOnlyQuery(sql) {
  const q = sql.toUpperCase();
  return (
    q.includes("INFORMATION_SCHEMA") ||
    q.includes("DATABASE()") ||
    q.includes("SHOW TABLES") ||
    q.includes("SHOW COLUMNS")
  );
}

// ========= MAIN EXECUTOR =========

const ExecuteQuery = async (res, sql, params = [], isSelect = true, audit) => {
  const req = res?.req;
  let mode = "online";
  let forcedOnline = false;

  try {
    const mysqlOnly = isMySqlOnlyQuery(sql);
    if (mysqlOnly) {
      forcedOnline = true;
      mode = "online";
    } else {
      const networkMode =
        req?.session?.user?.eduall_user_session_network_mode || "online";
      if (networkMode === "offline") mode = "offline";
    }

    const mysqlDbName =
      DB_CONFIG?.database ||
      DATABASE?.config?.connectionConfig?.database ||
      DATABASE?.config?.database ||
      "(unknown)";

    const dbLabel =
      mode === "online"
        ? `MySQL (${mysqlDbName})`
        : `SQLite (${DB_PATH})`;

    console.log(
      `[DB] MODE=${mode.toUpperCase()} ${
        forcedOnline ? "(FORCED)" : ""
      } | ${dbLabel}`
    );

    // 👉 OFFLINE: tudo via SQLite, com possível sync de schema se quiseres
    if (mode === "offline") {
      await openSqlite();
      // Se quiseres sincronizar o schema mesmo em modo offline
      // (assumindo que ainda tens acesso ao MySQL para popular a cache),
      // deixa esta linha. Se não fizer sentido, podes comentar.
      await maybeSyncLocalSchema();
      return await sqliteExecute(sql, params, isSelect);
    }

    // 👉 ONLINE: só MySQL, não mexe no ficheiro local.db
    // (evita SQLITE_READONLY quando o ficheiro está read-only)
    return await mysqlExecute(sql, params, isSelect);
  } catch (err) {
    console.error("[DB ERROR]", err.message);
    console.error("SQL:", sql);
    console.error("PARAMS:", params);
    throw err;
  }
};

ExecuteQuery.DB_PATH = DB_PATH;
ExecuteQuery.sqliteRawQuery = sqliteExecute;
ExecuteQuery.openSqliteIfNeeded = openSqlite;

module.exports = ExecuteQuery;
