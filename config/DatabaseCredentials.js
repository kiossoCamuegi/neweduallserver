// ─────────────────────────────────────────────────────────────────────────
// Ligação à base de dados.
//
// A aplicação Node e o MySQL correm no MESMO servidor (cPanel). Usar o
// endereço público (cpanel154.dnscpanel.com) obriga cada query a sair e
// voltar ao próprio servidor — medido em ~174 ms por query. Em local/socket
// a mesma query fica em ~1 ms.
//
// Ordem de preferência:
//   1. MYSQL_HOST definido no ambiente  → usa esse host (ex.: testes locais)
//   2. socket local do MySQL            → caminho mais rápido e compatível
//      com o utilizador `user@localhost` criado pelo cPanel
//   3. 127.0.0.1                        → TCP local
//
// Para testar de outra máquina contra a BD remota:
//   MYSQL_HOST=cpanel154.dnscpanel.com npm start
//
// As variáveis MYSQL_* são intencionalmente diferentes das DB_* do .env
// (que apontam para outra base antiga) para não haver troca acidental.
// ─────────────────────────────────────────────────────────────────────────
const fs = require("fs");

const DEFAULT_SOCKET_PATHS = [
  "/var/lib/mysql/mysql.sock",
  "/var/run/mysqld/mysqld.sock",
  "/tmp/mysql.sock",
];

const forcedHost = process.env.MYSQL_HOST;
const forcedSocket = process.env.MYSQL_SOCKET;
// MYSQL_SOCKET permite indicar o caminho exacto do socket do cPanel.
const SOCKET_PATHS = forcedSocket ? [forcedSocket] : DEFAULT_SOCKET_PATHS;
let socketPath = null;

if (!forcedHost && process.platform !== "win32") {
  for (const candidate of SOCKET_PATHS) {
    try {
      // Verifica acesso real (não só existência): se o processo não puder
      // usar o socket, cai para TCP em 127.0.0.1 em vez de falhar no boot.
      fs.accessSync(candidate, fs.constants.R_OK | fs.constants.W_OK);
      socketPath = candidate;
      break;
    } catch (_) { /* ignora e tenta o próximo */ }
  }
}

const dbConfig = {
  port: Number(process.env.MYSQL_PORT || 3306),
  user: process.env.MYSQL_USER || "eduallsi_andre",
  password: process.env.MYSQL_PASSWORD || "q!s&$AXo@{dc",
  database: process.env.MYSQL_DATABASE || "eduallsi_andre",
};

if (socketPath) {
  dbConfig.socketPath = socketPath;
} else {
  dbConfig.host = forcedHost || "127.0.0.1";
}

// Rede de segurança: se o alvo preferido (socket/127.0.0.1) não estiver
// acessível no servidor, o app.js testa e cai automaticamente para o host
// público — a aplicação nunca fica sem BD por causa desta otimização.
dbConfig.fallbackHost =
  process.env.MYSQL_FALLBACK_HOST || "cpanel154.dnscpanel.com";
dbConfig.fallbackPort = Number(process.env.MYSQL_FALLBACK_PORT || 3306);

module.exports = dbConfig;
