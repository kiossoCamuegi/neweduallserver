const cron = require("node-cron");
const { DATABASE } = require("../config/Database"); // pool MySQL partilhado
const {
  DB_PATH,
  openSqliteIfNeeded,
  sqliteRawQuery,
} = require("../Functions/ExecuteQuery");

// Tamanho dos lotes
const BATCH_SIZE = 500;

// Tabelas que NÃO devem ser atualizadas do lado do cliente para o MySQL
const UPLOAD_IGNORE_TABLES = ["users"];

// Global vars
let lastSchemaSync = 0;

// Nome da coluna de tenant na TABELA atual (vem de setTenantCode)
let currentTenantField = null;

// ================== HELPERS GENÉRICOS ==================

function chunkArray(arr, size) {
  const out = [];
  if (!Array.isArray(arr) || size <= 0) return out;
  for (let i = 0; i < arr.length; i += size) {
    out.push(arr.slice(i, i + size));
  }
  return out;
}

async function getMySQLConnection() {
  return DATABASE.getConnection();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Guarda em memória qual é o NOME DA COLUNA que representa o tenant
 * para a tabela a sincronizar.
 *
 * Ex:
 *   setTenantCode("student_institute_code");
 */
function setTenantCode(tenantFieldName) {
  currentTenantField = tenantFieldName || null;
  console.log(
    "[TENANT] Campo de tenant atual:",
    currentTenantField || "(sem filtro de tenant por coluna)"
  );
}

// ================== SQLITE WRAPPERS ==================

async function openDatabase() {
  await openSqliteIfNeeded();
  console.log("[SQLite] Base de dados aberta (via ExecuteQuery.js):", DB_PATH);
}

/**
 * Wrapper para manter assinatura antiga:
 * ExecuteQuery(sql, params = [], returnRows = true)
 */
function ExecuteQuery(sql, params = [], returnRows = true) {
  return sqliteRawQuery(sql, params, returnRows);
}

// ================== SCHEMA LOCAL (INICIAL / EXEMPLO) ==================

async function initSchema() {
  await openSqliteIfNeeded();

  await ExecuteQuery(
    `CREATE TABLE IF NOT EXISTS tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT,
      description TEXT,
      completed INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    )`,
    [],
    false
  );

  await ExecuteQuery(
    `CREATE TABLE IF NOT EXISTS contacts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT,
      phone TEXT,
      created_at TEXT NOT NULL
    )`,
    [],
    false
  );

  await ExecuteQuery(
    `CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL UNIQUE,
      password TEXT NOT NULL,
      name TEXT NOT NULL
    )`,
    [],
    false
  );

  const count = await ExecuteQuery("SELECT COUNT(*) AS total FROM users");
  if (count[0].total === 0) {
    await ExecuteQuery(
      "INSERT INTO users (email, password, name) VALUES (?, ?, ?)",
      ["admin@local.test", "123456", "Admin Local"],
      false
    );
    console.log("[SQLite] Utilizador default criado.");
  }

  console.log("[SQLite] Schema inicializado.");
}

// ================== HELPERS DE SCHEMA / SYNC ==================

async function getSQLiteTables() {
  const rows = await ExecuteQuery(
    "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
  );
  return rows.map((r) => r.name);
}

async function getSQLiteColumns(table) {
  const rows = await ExecuteQuery(`PRAGMA table_info(${table})`);
  return rows.map((r) => ({
    name: r.name,
    type: r.type,
    pk: r.pk === 1,
  }));
}

async function getMySQLTables(conn) {
  const [rows] = await conn.query(
    `
    SELECT TABLE_NAME
    FROM INFORMATION_SCHEMA.TABLES
    WHERE TABLE_SCHEMA = DATABASE()
  `
  );
  return rows.map((r) => r.TABLE_NAME);
}

async function getMySQLColumns(conn, table) {
  const [rows] = await conn.query(
    `
    SELECT COLUMN_NAME, DATA_TYPE, COLUMN_KEY, EXTRA
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?
  `,
    [table]
  );

  return rows.map((col) => ({
    name: col.COLUMN_NAME,
    type: col.DATA_TYPE,
    pk: col.COLUMN_KEY === "PRI",
    autoIncrement: col.EXTRA?.includes("auto_increment"),
  }));
}

function mapMysqlTypeToSQLite(mysqlType) {
  const t = String(mysqlType || "").toLowerCase();
  if (t.includes("int")) return "INTEGER";
  if (t.includes("char") || t.includes("text") || t.includes("enum")) return "TEXT";
  if (t.includes("blob")) return "BLOB";
  if (t.includes("real") || t.includes("double") || t.includes("float")) return "REAL";
  if (t.includes("decimal") || t.includes("numeric")) return "REAL";
  if (t.includes("date") || t.includes("time") || t.includes("year")) return "TEXT";
  return "TEXT";
}

// Usa o MySQL como fonte de verdade do schema → com throttle (1x por hora)
async function syncSchemaFromMySQLToSQLite(conn) {
  if (Date.now() - lastSchemaSync < 3600_000) {
    return;
  }
  lastSchemaSync = Date.now();

  console.log("[SCHEMA] Sincronizar schema (MySQL → SQLite)");

  const mysqlTables = await getMySQLTables(conn);
  const sqliteTables = await getSQLiteTables();

  for (const table of mysqlTables) {
    const exists = sqliteTables.includes(table);
    const mysqlCols = await getMySQLColumns(conn, table);

    if (!exists) {
      const cols = mysqlCols
        .map((c) => {
          const type = mapMysqlTypeToSQLite(c.type);
          if (c.pk) return `"${c.name}" ${type} PRIMARY KEY`;
          return `"${c.name}" ${type}`;
        })
        .join(", ");

      await ExecuteQuery(`CREATE TABLE "${table}" (${cols})`, [], false);
      console.log("[SCHEMA] Criada tabela SQLite:", table);
      continue;
    }

    const sqliteCols = await getSQLiteColumns(table);
    const sqliteNames = sqliteCols.map((c) => c.name);

    for (const col of mysqlCols) {
      if (!sqliteNames.includes(col.name)) {
        const type = mapMysqlTypeToSQLite(col.type);
        await ExecuteQuery(
          `ALTER TABLE "${table}" ADD COLUMN "${col.name}" ${type}`,
          [],
          false
        );
        console.log("[SCHEMA] ADD COLUMN:", table, col.name);
      }
    }
  }

  console.log("[SCHEMA] Concluído.");
}

// ================== UPLOAD INTERNO (SQLite -> MySQL) ==================
/**
 * internalUpload(conn, specificTableName, tenantValue)
 *
 * - specificTableName: nome da tabela ou null (todas)
 * - tenantValue: valor do tenant (ex: 'INS001') ou null (sem filtro)
 * - currentTenantField: NOME DA COLUNA (setTenantCode)
 */
async function internalUpload(conn, specificTableName = null, tenantValue = null) {
  await openSqliteIfNeeded();
  await syncSchemaFromMySQLToSQLite(conn);

  const sqliteTables = await getSQLiteTables();
  const mysqlTables = await getMySQLTables(conn);

  for (const tableName of sqliteTables) {
    if (specificTableName && tableName !== specificTableName) continue;
    if (!mysqlTables.includes(tableName)) continue;

    if (UPLOAD_IGNORE_TABLES.includes(tableName)) {
      console.log(
        `[UPLOAD] A ignorar tabela '${tableName}' (controlada pelo servidor).`
      );
      continue;
    }

    const sqliteCols = await getSQLiteColumns(tableName);
    const mysqlCols = await getMySQLColumns(conn, tableName);

    const sqliteColNames = sqliteCols.map((c) => c.name);
    const mysqlColNames = mysqlCols.map((c) => c.name);
    const commonCols = sqliteColNames.filter((c) =>
      mysqlColNames.includes(c)
    );

    if (!commonCols.length) continue;

    const hasTenantColumn =
      currentTenantField && commonCols.includes(currentTenantField);

    console.log(
      "[UPLOAD] Tabela:",
      tableName,
      "| Campo tenant:",
      currentTenantField || "(nenhum)",
      "| Valor tenant:",
      tenantValue || "(TODOS)",
      "| Coluna existe?:",
      hasTenantColumn
    );

    // Filtro por tenant (se:
    //  - currentTenantField não é null
    //  - tenantValue não é null
    //  - a tabela tem mesmo essa coluna)
    let whereClause = "";
    const whereParams = [];

    if (hasTenantColumn && tenantValue) {
      whereClause = ` WHERE "${currentTenantField}" = ?`;
      whereParams.push(tenantValue);
    }

    const rows = await ExecuteQuery(
      `SELECT ${commonCols.map((c) => `"${c}"`).join(", ")} 
       FROM "${tableName}"${whereClause}`,
      whereParams
    );

    if (!rows.length) {
      console.log("[UPLOAD]  - sem linhas para enviar, a ignorar.");
      continue;
    }

    const columnListSQL = commonCols.map((c) => `\`${c}\``).join(", ");
    const placeholdersPerRow = `(${commonCols.map(() => "?").join(",")})`;

    const updateCols = commonCols
      .filter((c) => c !== "id")
      .map((c) => `\`${c}\` = VALUES(\`${c}\`)`)
      .join(", ");

    const updateClause = updateCols || "`id` = `id`";

    const baseSQL = `
      INSERT INTO \`${tableName}\` (${columnListSQL})
      VALUES __VALUES__
      ON DUPLICATE KEY UPDATE ${updateClause}
    `;

    const rowChunks = chunkArray(rows, BATCH_SIZE);

    async function processChunkWithRetry(chunk) {
      if (!chunk.length) return;

      const values = [];
      const valuesBlocks = chunk.map((row) => {
        commonCols.forEach((c) => values.push(row[c]));
        return placeholdersPerRow;
      });

      const sql = baseSQL.replace("__VALUES__", valuesBlocks.join(", "));

      const MAX_RETRIES = 3;
      let attempt = 0;

      while (true) {
        try {
          await conn.query(sql, values);
          break;
        } catch (err) {
          const isLock =
            err.code === "ER_LOCK_WAIT_TIMEOUT" ||
            err.code === "ER_LOCK_DEADLOCK";

          if (!isLock) {
            throw err;
          }

          attempt++;
          if (attempt >= MAX_RETRIES) {
            console.error(
              `[UPLOAD] Lock em '${tableName}', chunk ignorado após ${MAX_RETRIES} tentativas:`,
              err.sqlMessage || err.message
            );
            break;
          }

          const delay = 200 * Math.pow(2, attempt);
          console.warn(
            `[UPLOAD] Lock em '${tableName}', tentativa ${attempt}/${MAX_RETRIES}. A aguardar ${delay}ms...`
          );
          await sleep(delay);
        }
      }
    }

    for (const chunk of rowChunks) {
      await processChunkWithRetry(chunk);
    }

    console.log("[UPLOAD]  - concluído:", tableName);
  }
}

// ================== SYNC UPLOAD (global e single) ==================

async function syncUploadToMySQL(tenantValue = null) {
  const conn = await getMySQLConnection();
  try {
    console.log(
      "[UPLOAD] Iniciar sync global (SQLite -> MySQL) | Campo tenant:",
      currentTenantField || "(nenhum)",
      "| Valor tenant:",
      tenantValue || "(TODOS)"
    );
    await internalUpload(conn, null, tenantValue);
    console.log("[UPLOAD] Upload global completo ✔️");
  } catch (err) {
    console.error("[UPLOAD] Erro no upload global:", err);
    throw err;
  } finally {
    conn.release();
  }
}

async function syncUploadSingleTable(tableName, tenantValue = null) {
  const conn = await getMySQLConnection();
  try {
    console.log(
      "[UPLOAD] Iniciar sync de tabela única:",
      tableName,
      "| Campo tenant:",
      currentTenantField || "(nenhum)",
      "| Valor tenant:",
      tenantValue || "(TODOS)"
    );
    await internalUpload(conn, tableName, tenantValue);
    console.log("[UPLOAD] Upload single completo ✔️");
    return {
      ok: true,
      table: tableName,
      mode: "upload",
      tenantField: currentTenantField,
      tenantValue,
    };
  } catch (err) {
    console.error("[UPLOAD] Erro no upload single:", err);
    throw err;
  } finally {
    conn.release();
  }
}

// ================== SYNC DOWNLOAD (MySQL -> SQLite) ==================
/**
 * internalDownload(conn, specificTableName, tenantValue)
 */
async function internalDownload(conn, specificTableName = null, tenantValue = null) {
  await openSqliteIfNeeded();
  await syncSchemaFromMySQLToSQLite(conn);

  const mysqlTables = await getMySQLTables(conn);

  for (const tableName of mysqlTables) {
    if (specificTableName && tableName !== specificTableName) continue;

    const mysqlCols = await getMySQLColumns(conn, tableName);
    const colNames = mysqlCols.map((c) => c.name);

    const hasTenantColumn =
      currentTenantField && colNames.includes(currentTenantField);

    console.log(
      "[DOWNLOAD] Tabela:",
      tableName,
      "| Campo tenant:",
      currentTenantField || "(nenhum)",
      "| Valor tenant:",
      tenantValue || "(TODOS)",
      "| Coluna existe?:",
      hasTenantColumn
    );

    let whereClause = "";
    const params = [];

    if (hasTenantColumn && tenantValue) {
      whereClause = ` WHERE \`${currentTenantField}\` = ?`;
      params.push(tenantValue);
    }

    const [rows] = await conn.query(
      `SELECT ${colNames.map((c) => `\`${c}\``).join(", ")} 
       FROM \`${tableName}\`${whereClause}`,
      params
    );

    if (!rows.length) {
      console.log("[DOWNLOAD]  - sem linhas, a ignorar.");
      continue;
    }

    const rowChunks = chunkArray(rows, BATCH_SIZE);

    const colListSQLite = colNames.map((c) => `"${c}"`).join(", ");
    const placeholdersPerRow = `(${colNames.map(() => "?").join(", ")})`;

    for (const chunk of rowChunks) {
      const values = [];
      const valuesBlocks = chunk.map((row) => {
        colNames.forEach((c) => values.push(row[c]));
        return placeholdersPerRow;
      });

      const insertSQL = `
        INSERT OR REPLACE INTO "${tableName}" (${colListSQLite})
        VALUES ${valuesBlocks.join(", ")}
      `;

      await ExecuteQuery("BEGIN TRANSACTION", [], false);
      try {
        await ExecuteQuery(insertSQL, values, false);
        await ExecuteQuery("COMMIT", [], false);
      } catch (err) {
        console.error(
          `[SYNC DOWNLOAD] Erro num chunk da tabela "${tableName}", a fazer ROLLBACK:`,
          err.message
        );
        await ExecuteQuery("ROLLBACK", [], false).catch(() => {});
        throw err;
      }
    }

    console.log("[DOWNLOAD]  - concluído:", tableName);
  }
}

async function syncDownloadFromMySQL(tenantValue = null) {
  const conn = await getMySQLConnection();
  try {
    console.log(
      "[DOWNLOAD] Iniciar sync global (MySQL -> SQLite) | Campo tenant:",
      currentTenantField || "(nenhum)",
      "| Valor tenant:",
      tenantValue || "(TODOS)"
    );
    await internalDownload(conn, null, tenantValue);
    console.log("[DOWNLOAD] Download global completo ✔️");
  } catch (err) {
    console.error("[DOWNLOAD] Erro no download global:", err);
    throw err;
  } finally {
    conn.release();
  }
}

async function syncDownloadSingleTable(tableName, tenantValue = null) {
  const conn = await getMySQLConnection();
  try {
    console.log(
      "[DOWNLOAD] Iniciar sync single (MySQL -> SQLite) tabela:",
      tableName,
      "| Campo tenant:",
      currentTenantField || "(nenhum)",
      "| Valor tenant:",
      tenantValue || "(TODOS)"
    );
    await internalDownload(conn, tableName, tenantValue);
    console.log("[DOWNLOAD] Download single completo ✔️");
    return {
      ok: true,
      table: tableName,
      mode: "download",
      tenantField: currentTenantField,
      tenantValue,
    };
  } catch (err) {
    console.error("[DOWNLOAD] Erro no download single:", err);
    throw err;
  } finally {
    conn.release();
  }
}

// ================== AUTO-SYNC EM BACKGROUND (CADA 15min) ==================

let isSyncRunning = false;
let autoSyncTask = null;

async function runFullSyncCycle(tenantValue = null) {
  if (isSyncRunning) {
    console.log("[AUTO-SYNC] Já há um ciclo em execução, a ignorar.");
    return;
  }

  isSyncRunning = true;
  console.log(
    "[AUTO-SYNC] Iniciar ciclo (upload + download). | Campo tenant:",
    currentTenantField || "(nenhum)",
    "| Valor tenant:",
    tenantValue || "(TODOS)"
  );

  try {
    await syncUploadToMySQL(tenantValue);
    console.log("[AUTO-SYNC] Upload concluído.");
  } catch (err) {
    console.error("[AUTO-SYNC] Erro no upload:", err.message);
  }

  try {
    await syncDownloadFromMySQL(tenantValue);
    console.log("[AUTO-SYNC] Download concluído.");
  } catch (err) {
    console.error("[AUTO-SYNC] Erro no download:", err.message);
  }

  isSyncRunning = false;
  console.log("[AUTO-SYNC] Ciclo concluído.");
}

function startAutoSync(tenantValue = null) {
  if (autoSyncTask) return;

  console.log(
    "[AUTO-SYNC] Agendado com node-cron para correr a cada 15 minutos."
  );

  runFullSyncCycle(tenantValue).catch((err) => {
    console.error("[AUTO-SYNC] Erro no ciclo inicial:", err.message);
  });

  autoSyncTask = cron.schedule("*/15 * * * *", () => {
    runFullSyncCycle(tenantValue).catch((err) => {
      console.error("[AUTO-SYNC] Erro no ciclo agendado:", err.message);
    });
  });
}

function autoSyncMiddleware(req, res, next) {
  if (!autoSyncTask) {
    // podes passar aqui também o tenantValue se quiseres auto-sync por escola
    startAutoSync();
  }
  next();
}

// ================== EXPORTS ==================

module.exports = {
  DB_PATH,
  openDatabase,
  initSchema,
  setTenantCode,            // recebe o NOME DA COLUNA do tenant
  syncUploadToMySQL,        // (opcional, global)
  syncDownloadFromMySQL,    // (opcional, global)
  syncUploadSingleTable,    // usa tenantValue se passado
  syncDownloadSingleTable,  // idem
  startAutoSync,
  autoSyncMiddleware,
};
