"use strict";

const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const app = fs.readFileSync(path.join(root, "app.js"), "utf8");
const frontendApi = fs.readFileSync(
  path.join(root, "..", "frontend", "src", "RH_app", "Workspace", "api.js"),
  "utf8"
);
const router = fs.readFileSync(path.join(root, "routes", "HrWorkspace.js"), "utf8");

const checks = [
  [app, /app\.use\("\/api\/hr", hrWorkspaceRouter\)/, "O router /api/hr não está montado."],
  [router, /router\.get\("\/bootstrap"/, "A rota de bootstrap do RH não existe."],
  [router, /router\.get\("\/feed"/, "A rota do feed do RH não existe."],
  [router, /router\.get\("\/chat\/conversations"/, "A rota de conversas do RH não existe."],
  [router, /router\.get\("\/chat\/conversations\/:conversationId\/messages"/, "A rota de mensagens do RH não existe."],
  [app, /new SocketServer\(emergencyServer/, "O Socket.IO não está ligado ao servidor HTTP ativo."],
  [frontendApi, /chatMessages:\s*\(conversationId, signal\)/, "O frontend não usa a rota de mensagens do RH."],
];

const failures = checks
  .filter(([source, pattern]) => !pattern.test(source))
  .map(([, , message]) => message);

if (failures.length) {
  failures.forEach((message) => console.error(`- ${message}`));
  process.exitCode = 1;
} else {
  console.log("Contrato de arranque do workspace RH validado.");
}
