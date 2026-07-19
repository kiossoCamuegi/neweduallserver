const mysql = require('mysql');
const ExecuteQuery = require('../Functions/ExecuteQuery');

// Conexão com o banco de dados
const dbOptions = {
  password: process.env.DB_PASSWORD || "",
  user: process.env.DB_USER || "root",
  database: process.env.DB_NAME || "eduall",
  host: process.env.DB_HOST || "localhost",
  port: 3306
};

const dbConnection = mysql.createConnection(dbOptions);

// Função para criar a tabela 'visitor' caso não exista
const createVisitorTable = async () => {
  const createTableQuery = `
    CREATE TABLE IF NOT EXISTS visitor (
      id INT AUTO_INCREMENT PRIMARY KEY,
      user_id INT DEFAULT NULL,
      session_id VARCHAR(255) DEFAULT NULL,
      is_logged_in BOOLEAN NOT NULL,
      request_count INT DEFAULT 1,
      timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `;
  await ExecuteQuery(null, createTableQuery, [], false, { db: "eduall", type: "create", data: null });
};

// Middleware para registrar a visita
const registerVisitor = async (req, res, next) => {
  const userId = req.session.user ? req.session.user.id : null;
  const sessionId = req.sessionID;
  const isLoggedIn = userId ? true : false;

  // Criar a tabela 'visitor' caso não exista
  await createVisitorTable();

  // Verificar se o usuário já tem registros de visitas
  let query = 'SELECT * FROM visitor WHERE session_id = ?';
  let params = [sessionId];
  let result = await ExecuteQuery(res, query, params, true, { db: "eduall", type: "select", data: req });

  if (result && result.length > 0) {
    // Se já existe, atualizar o número de requisições feitas
    const updateQuery = `
      UPDATE visitor
      SET request_count = request_count + 1
      WHERE session_id = ?;
    `;
    await ExecuteQuery(res, updateQuery, params, false, { db: "eduall", type: "update", data: req });
  } else {
    // Se não existe, inserir uma nova entrada
    const insertQuery = `
      INSERT INTO visitor (user_id, session_id, is_logged_in)
      VALUES (?, ?, ?);
    `;
    await ExecuteQuery(res, insertQuery, [userId, sessionId, isLoggedIn], false, { db: "eduall", type: "insert", data: req });
  }

  next();
};

// Middleware de registro de visita
module.exports = registerVisitor;
