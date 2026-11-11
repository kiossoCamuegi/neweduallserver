const fs = require("fs");
const path = require("path");
const mysql = require("mysql2/promise");
const dbConfig = require("./DatabaseCredentials");

const DB_CONFIG = {
  ...dbConfig,
  connectionLimit: 10,
  charset: "utf8mb4",
};

let DATABASE;
let readyResolve;
const dbReady = new Promise((resolve) => {
  readyResolve = resolve;
});

// ─────────────────────────────────────────────────────────────────────────
// Backoff crescente para reconexão: 2s, 4s, 8s, 16s, 30s, 30s, 30s...
// Evita martelar o servidor com tentativas a cada 2s (o que pode levar o
// MySQL/MariaDB a bloquear o IP por excesso de erros de ligação —
// "Host is blocked because of many connection errors").
// ─────────────────────────────────────────────────────────────────────────
let retryAttempt = 0;
const MAX_RETRY_DELAY_MS = 30000;

function getRetryDelay() {
  const delay = Math.min(2000 * 2 ** retryAttempt, MAX_RETRY_DELAY_MS);
  retryAttempt++;
  return delay;
}

async function createPool() {
  try {
    DATABASE = mysql.createPool(DB_CONFIG);
    // Testa a conexão
    const conn = await DATABASE.getConnection();
    conn.release();
    console.log("💛🧡❤ Database connected successfully!");
    retryAttempt = 0; // reset do backoff após sucesso
    handlePoolErrors(DATABASE);
    readyResolve(DATABASE); // ✅ resolve a promise assim que o pool estiver pronto
  } catch (err) {
    const delay = getRetryDelay();
    console.error(
      `💥 Database connection failed: ${err.message} — nova tentativa em ${delay / 1000}s`
    );
    setTimeout(createPool, delay);
  }
}

// Reconectar em caso de erro do pool
function handlePoolErrors(pool) {
  pool.on("error", async (err) => {
    console.error("💔 Database error occurred:", err);
    if (err.code === "PROTOCOL_CONNECTION_LOST") {
      console.log("🔄 Reconnecting database...");
      await createPool();
    } else {
      console.error("Unexpected database error:", err.message);
    }
  });
}

/**
 * getDB — usar isto em vez de importar DATABASE diretamente quando existir
 * risco do pool ainda não estar pronto (ex: scripts standalone, testes,
 * ou módulos carregados muito cedo no arranque da app).
 *
 *   const { getDB } = require("./Database");
 *   const db = await getDB();
 *   const [rows] = await db.query("SELECT 1");
 */
async function getDB() {
  if (DATABASE) return DATABASE;
  return dbReady;
}

function queryDatabase(...args) {
  const callback = typeof args[args.length - 1] === "function"
    ? args.pop()
    : null;
  const operation = getDB().then((db) => db.query(...args));
  if (callback) {
    operation
      .then(([rows, fields]) => callback(null, rows, fields))
      .catch((error) => callback(error));
  }
  return operation;
}

/**
 * Exportação estável para módulos carregados antes de o pool terminar de
 * ligar. Mantém a API assíncrona do mysql2 e também aceita callbacks usados
 * pelas rotas legacy.
 */
const DATABASE_EXPORT = {
  query: queryDatabase,
  execute: queryDatabase,
  getConnection: () => getDB().then((db) => db.getConnection()),
  end: () => getDB().then((db) => db.end()),
};

async function checkDatabaseConnection() {
  const db = await getDB();
  const connection = await db.getConnection();
  connection.release();
}

async function closeDatabase() {
  const db = await getDB();
  await db.end();
}

// ═════════════════════════════════════════════════════════════════════════════
// IMPORTAÇÃO DE FICHEIRO .sql (CREATE TABLE + INSERT) PARA A BASE DE DADOS
// ═════════════════════════════════════════════════════════════════════════════
//
// Usa uma ligação DEDICADA (fora do pool principal), com multipleStatements
// ativado só aqui — assim o pool usado pelas queries normais da aplicação
// continua sem essa flag (evita abrir superfície de SQL injection à toa).
//
//   const { importSqlFile } = require("./Database");
//   await importSqlFile("./dump.sql");
//
async function importSqlFile(filePath) {
  const resolvedPath = path.isAbsolute(filePath) ? filePath : path.join(__dirname, filePath);

  console.log(`\n📂 A ler o ficheiro: ${resolvedPath}`);

  if (!fs.existsSync(resolvedPath)) {
    throw new Error(`Ficheiro não encontrado: ${resolvedPath}`);
  }

  const sqlContent = fs.readFileSync(resolvedPath, "utf8");
  const sizeKB = (sqlContent.length / 1024).toFixed(1);
  console.log(`✅ Ficheiro lido (${sizeKB} KB)`);

  console.log(`\n🔌 A abrir ligação dedicada para importação...`);
  const importConnection = await mysql.createConnection({
    ...DB_CONFIG,
    multipleStatements: true, // apenas nesta ligação, não no pool principal
  });

  try {
    console.log(`⏳ A executar o ficheiro SQL (isto pode demorar dependendo do tamanho)...`);
    const startTime = Date.now();

    const [results] = await importConnection.query(sqlContent);

    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log(`✅ Importação concluída em ${duration}s`);

    if (Array.isArray(results)) {
      console.log(`📊 ${results.length} comando(s) SQL executado(s)`);
    }

    return results;
  } catch (error) {
    console.error(`❌ Erro durante a importação:`, error.message);
    throw error;
  } finally {
    await importConnection.end();
    console.log(`🔌 Ligação de importação fechada`);
  }
}

(async () => {
  await createPool();
})();

// ─────────────────────────────────────────────────────────────────────────
// Permite rodar a importação diretamente por linha de comando:
//   node Database.js ./dump.sql
// ─────────────────────────────────────────────────────────────────────────
if (require.main === module) {
  const sqlFileArg = process.argv[2];
  if (sqlFileArg) {
    importSqlFile(sqlFileArg)
      .then(() => process.exit(0))
      .catch(() => process.exit(1));
  }
}

module.exports = {
  DATABASE: DATABASE_EXPORT,
  DB_CONFIG,
  getDB,
  checkDatabaseConnection,
  closeDatabase,
  importSqlFile,
};
