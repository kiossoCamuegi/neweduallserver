const mysql = require("mysql2/promise");
const dbConfig = require("./DatabaseCredentials");

const DB_CONFIG = {
   ...dbConfig,
  connectionLimit: 10, 
  charset: "utf8mb4"
};

let DATABASE;

async function createPool() {
  try {
    DATABASE = mysql.createPool(DB_CONFIG);
    // Testa a conexão
    await DATABASE.getConnection();
    console.log("💛🧡❤ Database connected successfully!");
  } catch (err) {
    console.error("💥 Database connection failed:", err.message);
    setTimeout(createPool, 2000); // tenta reconectar
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

(async () => {
  await createPool();
  handlePoolErrors(DATABASE);
})(); 

module.exports = {
  DATABASE,
  DB_CONFIG,
};
