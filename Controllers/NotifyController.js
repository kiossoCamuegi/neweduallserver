// CACHE-OPT v5 (aplicado por apply_cache_optimizations.py)
const axios = require("axios");
const ExecuteQuery = require("../Functions/ExecuteQuery");

// CACHE-OPT v5: cache por escola (chaves "<entidade>:<escola>:..."); uma falha de cache nunca parte o pedido
const Cache = require("../Functions/CacheRoutes");
const _cacheGet = async (key) => { try { const v = await Cache.eduallGet(key); return v === undefined ? null : v; } catch (e) { return null; } };
const _cacheSet = async (key, value, ttl) => { try { if (value !== undefined && value !== null) await Cache.eduallSet(key, value, ttl); } catch (e) { /* cache indisponível: ignorado */ } };
const _cacheClear = async (...patterns) => { for (const p of patterns) { try { await Cache.eduallClear(p); } catch (e) { /* ignorado */ } } };

/* ===================== Helpers ===================== */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const nowIso = () => new Date().toISOString().slice(0, 19).replace("T", " ");

/** Limpa HTML perigoso (whitelist simples) */
function safeHTML(s) {
  const str = String(s ?? "");
  return str
    .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, "")
    .replace(/on\w+="[^"]*"/gi, "")
    .replace(/javascript:/gi, "")
    .replace(/<([^>]+)>/g, (m, tag) => {
      const t = tag.trim().toLowerCase();
      const allowed = [
        "b",
        "strong",
        "i",
        "em",
        "u",
        "br",
        "hr",
        "small",
        "span",
        "div",
        "p",
        "ul",
        "ol",
        "li",
        "code",
        "pre",
      ];
      const name = t.split(/\s+/)[0].replace(/\//g, "");
      return allowed.includes(name) ? `<${tag}>` : "";
    });
}

/** Explicação via Gemini (ou fallback) */
async function geminiExplain({ action, form, description, userName, createdAt }) {
  try {
    const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
    if (!apiKey) throw new Error("Missing GEMINI_API_KEY");
    if (process.env.NOTIFY_USE_AI === "0") throw new Error("IA desativada (NOTIFY_USE_AI=0)"); // CACHE-OPT v5

    const prompt = `
Gera uma descrição curta e amigável (máx 380 chars, HTML simples) sobre uma ação do utilizador.
Utiliza pequenas etiquetas coloridas para identificar a ação (1=criou, 2=atualizou, 3=eliminou, 4=outro).

Utilizador: ${userName}
Formulário: ${form}
Ação: ${action}
Descrição: ${description}
Data: ${createdAt}
`;

    const { data } = await axios.post(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`,
      { contents: [{ parts: [{ text: prompt }] }] },
      { timeout: 8000 }
    );

    const txt =
      data?.candidates?.[0]?.content?.parts?.map((p) => p.text).join("") ||
      data?.candidates?.[0]?.content?.parts?.[0]?.text ||
      "";

    return { ok: true, html: safeHTML(txt).trim() };
  } catch {
    return {
      ok: false,
      html: safeHTML(
        `<p><b>${userName}</b> efetuou uma ação em <b>${form}</b>: ${description}</p>`
      ),
    };
  }
}

/* ===================== Garantir Estrutura ===================== */
let _notifySchemaReady = false; // CACHE-OPT v5: schema só uma vez por processo (antes: em CADA RegisterAuditAction)
async function ensureSchema(res, req) {
  if (_notifySchemaReady) return;
  // Preferência de notificação
  const checkUserCol = `
    SELECT COUNT(*) AS exist FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_NAME='eduall_user_accounts' AND COLUMN_NAME='ed_user_account_allow_notification'
  `;
  const [c] = await ExecuteQuery(res, checkUserCol, [], true);
  if (!c || Number(c.exist) === 0) {
    await ExecuteQuery(
      res,
      `ALTER TABLE eduall_user_accounts
       ADD COLUMN ed_user_account_allow_notification TINYINT(1) NOT NULL DEFAULT 1
       COMMENT '1=aceita notificações, 0=não aceita'`
    );
  }

  // Tabela de notificações
  await ExecuteQuery(
    res,
    `CREATE TABLE IF NOT EXISTS eduall_notifications (
      id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      institute_code VARCHAR(64) NOT NULL,
      audit_id BIGINT UNSIGNED,
      actor_user_id BIGINT UNSIGNED,
      recipient_user_id BIGINT UNSIGNED,
      title VARCHAR(200),
      body_html MEDIUMTEXT,
      body_text TEXT,
      seen TINYINT(1) DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      INDEX (institute_code, recipient_user_id, seen)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;`
  );
  _notifySchemaReady = true;
}

/* ===================== Core ===================== */
const RegisterAuditAction = async ({
  session,
  res,
  req,
  action,
  description,
  form,
}) => {
  try {
    await ensureSchema(res, req);
    const actor_user_id = session?.user?.eduall_user_session_ID;
    const institute_code = session?.user?.eduall_user_session_curentinstitute;

    // Criar log de auditoria
    const insAudit = `
      INSERT INTO eduall_auditory 
      (ed_auditory_action, ed_auditory_description, ed_auditory_form, ed_auditory_user_code, ed_auditory_institute_code)
      VALUES (?, ?, ?, ?, ?)`;
    const auditRes = await ExecuteQuery(res, insAudit, [
      action,
      description,
      form,
      actor_user_id,
      institute_code,
    ]);
    const audit_id = auditRes?.insertId;

    // Buscar info do ator
    const _actorKey = `notify:actor:${actor_user_id}`; // CACHE-OPT v5
    let actor = await _cacheGet(_actorKey);
    if (actor === null) {
      const [_actorRow] = await ExecuteQuery(
        res,
        `SELECT ed_user_account_name AS name, ed_user_account_picture AS avatar
         FROM eduall_user_accounts WHERE ed_user_account_id = ? LIMIT 1`,
        [actor_user_id],
        true
      );
      actor = _actorRow || null;
      await _cacheSet(_actorKey, actor, 300);
    }
    const userName = actor?.name || "Utilizador";

    const { html: body_html } = await geminiExplain({
      action,
      form,
      description,
      userName,
      createdAt: nowIso(),
    });
    const body_text = `${userName} realizou uma ação em ${form}: ${description}`;

    // Selecionar destinatários da mesma instituição (exceto o autor)
    const _rcKey = `notify:${institute_code}:recipients`; // CACHE-OPT v5: lista da escola em cache; o autor é filtrado em JS
    let _allRecipients = await _cacheGet(_rcKey);
    if (_allRecipients === null) {
      _allRecipients = await ExecuteQuery(
        res,
        `SELECT ed_user_account_id AS id FROM eduall_user_accounts
         WHERE ed_user_account_institute_code = ?
           AND ed_user_account_allow_notification = 1`,
        [institute_code],
        true
      );
      await _cacheSet(_rcKey, _allRecipients, 120);
    }
    const recipients = (_allRecipients || []).filter((r) => String(r.id) !== String(actor_user_id));

    if (!recipients?.length) return { ok: true, audit_id, info: "Sem destinatários" };

    // Inserir notificações
    const values = recipients.map(
      () => "(?,?,?,?,?,?,?,0,?)"
    ).join(",");
    const flat = [];
    recipients.forEach((r) =>
      flat.push(
        institute_code,
        audit_id,
        actor_user_id,
        r.id,
        form || "Atividade",
        body_html,
        body_text,
        nowIso()
      )
    );
    await ExecuteQuery(
      res,
      `INSERT INTO eduall_notifications
       (institute_code, audit_id, actor_user_id, recipient_user_id, title, body_html, body_text, seen, created_at)
       VALUES ${values}`,
      flat
    );

    // Emitir via socket apenas para a instituição (não para o autor)
    const io = require("../Sockets/GetSocketIo");
    io.emitTo &&
      io.emitTo(`inst:${institute_code}`, "notification:new", {
        audit_id,
        actor_user_id,
        actor_name: userName,
        actor_avatar: actor?.avatar || null,
        description,
        form,
        action,
        html: body_html,
        text: body_text,
      });

    return { ok: true, audit_id };
  } catch (e) {
    console.error("RegisterAuditAction erro:", e);
    return { ok: false, error: e.message };
  }
};

/* ===================== Rotas REST ===================== */
function buildNotificationsRouter(io) {
  const express = require("express");
  const router = express.Router();

  // Listar notificações (com JOIN no usuário)
  router.get("/api/notifications", async (req, res) => {
    try {
      await ensureSchema(res, req);
      const user = req.session?.user;
      if (!user)
        return res.status(401).json({ ok: false, error: "Sessão inválida" });

      const uid = user.eduall_user_session_ID;
      const inst = user.eduall_user_session_curentinstitute;
      const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 25));
      const cursor = req.query.cursor ? Number(req.query.cursor) : null;

      let sql = `
        SELECT n.id, n.audit_id, n.actor_user_id,
               u.ed_user_account_name AS actor_name,
               u.ed_user_account_picture AS actor_avatar,
               n.title, n.body_html, n.body_text,
               n.seen, n.created_at
        FROM eduall_notifications AS n
        LEFT JOIN eduall_user_accounts AS u
          ON n.actor_user_id = u.ed_user_account_id
        WHERE n.institute_code = ? AND n.recipient_user_id = ?
      `;
      const params = [inst, uid];
      if (cursor) {
        sql += " AND n.id < ?";
        params.push(cursor);
      }
      sql += " ORDER BY n.id DESC LIMIT ?";
      params.push(limit + 1);

      const rows = await ExecuteQuery(res, sql, params, true);
      const hasMore = rows.length > limit;
      const data = hasMore ? rows.slice(0, limit) : rows;
      const nextCursor = hasMore ? data[data.length - 1].id : null;

      res.json({ ok: true, data, nextCursor });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // Marcar notificações como vistas
  router.post("/api/notifications/mark-seen", async (req, res) => {
    try {
      const user = req.session?.user;
      if (!user)
        return res.status(401).json({ ok: false, error: "Sessão inválida" });
      const uid = user.eduall_user_session_ID;
      const inst = user.eduall_user_session_curentinstitute;
      const ids = Array.isArray(req.body?.ids)
        ? req.body.ids.map(Number).filter(Boolean)
        : [];
      if (!ids.length) return res.json({ ok: true });
      const inClause = ids.map(() => "?").join(",");
      await ExecuteQuery(
        res,
        `UPDATE eduall_notifications SET seen = 1
         WHERE id IN (${inClause}) AND recipient_user_id = ? AND institute_code = ?`,
        [...ids, uid, inst]
      );
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // Alterar preferências
  router.post("/api/me/notifications/toggle", async (req, res) => {
    try {
      const user = req.session?.user;
      if (!user)
        return res.status(401).json({ ok: false, error: "Sessão inválida" });
      const uid = user.eduall_user_session_ID;
      const [cur] = await ExecuteQuery(
        res,
        "SELECT ed_user_account_allow_notification AS allow FROM eduall_user_accounts WHERE ed_user_account_id = ?",
        [uid],
        true
      );
      const newVal = cur?.allow ? 0 : 1;
      await ExecuteQuery(
        res,
        "UPDATE eduall_user_accounts SET ed_user_account_allow_notification = ? WHERE ed_user_account_id = ?",
        [newVal, uid]
      );
      await _cacheClear("notify:*"); // CACHE-OPT v5: preferência mudou -> lista de destinatários/autores inválida
      res.json({ ok: true, allow: newVal });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // Marcar tudo como visto
  router.post("/api/notifications/mark-all-seen", async (req, res) => {
    try {
      const user = req.session?.user;
      if (!user)
        return res.status(401).json({ ok: false, error: "Sessão inválida" });
      const uid = user.eduall_user_session_ID;
      const inst = user.eduall_user_session_curentinstitute;
      await ExecuteQuery(
        res,
        `UPDATE eduall_notifications SET seen = 1
         WHERE institute_code = ? AND recipient_user_id = ?`,
        [inst, uid]
      );
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  return router;
}
 

 

/*
/* ===================== Ligação com o teu Socket singleton ===================== */
/**
 * Expõe uma pequena API no teu GetSocketIo para emitir para rooms.
 * No teu Sockets/GetSocketIo.js, garante que tens algo como:
 * 
 *   const io = new Server(HTTPApp, { ... });
 *   module.exports = Object.assign(io, {
 *     emitTo: (room, evt, payload) => io.to(room).emit(evt, payload)
 *   });
 

1 -------- /Controllers/NotificationsController.js
2 --------
// ===== Socket.IO ligado ao HTTPApp =====
const io = require("socket.io")(HTTPApp, {
  cors: { origin: allowedOrigins, credentials: true }
});

// ===== Notifications =====
const { initNotifications, RegisterAuditAction } = require("./Controllers/NotificationsController");

// Isto liga as *rotas* /api/notifications* e os listeners de socket
initNotifications({ app, io });

// (opcional) exporta para poderes usar em outros controllers
module.exports.RegisterAuditAction = RegisterAuditAction;

3---------
const { RegisterAuditAction } = require("../Controllers/NotificationsController");

await RegisterAuditAction({
  session: req.session,
  res,
  req,
  action: 1,          // 1 = criar, 2 = atualizar, 3 = eliminar... (usa o teu esquema)
  form: "Turmas",
  description: `Registrou uma nova turma (${req.body.class_title}) com o código ${req.body.class_code}`,
});


















1) app.js — montar as rotas e o socket.io

(a) Garante que crias o io a partir do HTTPApp.
(b) Usa o buildNotificationsRouter(io) para publicar as rotas.
(c) Exporta o RegisterAuditAction para reutilizar nos controladores.

// ... resto do teu app.js acima

// ===== Socket =====
const HTTPApp = require('http').createServer(app);

// cria socket.io atrelado ao mesmo servidor HTTP
const { Server } = require('socket.io');
const io = new Server(HTTPApp, {
  cors: { origin: allowedOrigins, credentials: true }
});

// torna o io acessível no teu helper GetSocketIo (ver passo 2)
require("./Sockets/GetSocketIo").init(io);

// carrega o teu SocketMain (onde aceitarás o join das rooms)
require("./Sockets/SocketMain");

// ===== Notifications (rotas + helpers) =====
const {
  buildNotificationsRouter,
  RegisterAuditAction
} = require('./Controllers/NotificationsController');

// publica as rotas REST de notificações
app.use(buildNotificationsRouter(io));

// (opcional) exporta para outros controladores usarem:
module.exports.RegisterAuditAction = RegisterAuditAction;

// ===== Start Server =====
const PORT = process.env.PORT || 5000;
HTTPApp.listen(PORT, () => console.log(` Servidor iniciado na porta: ${PORT}`));


As rotas agora estão disponíveis:

GET /api/notifications?limit=&cursor=

POST /api/notifications/mark-seen

POST /api/notifications/mark-all-seen

POST /api/notifications/settings (body { allow: 0|1 })

2) Sockets/GetSocketIo.js — utilitário simples

Se ainda não tens, cria um helper para partilhar a instância e oferecer emitTo:

// Sockets/GetSocketIo.js
let _io = null;

function init(io) {
  _io = io;
}

// envia para uma room específica
function emitTo(room, event, payload) {
  if (_io) _io.to(room).emit(event, payload);
}

// acesso direto (se precisares)
function get() { return _io; }

module.exports = { init, emitTo, get };


O teu RegisterAuditAction já invoca:

const io = require("../Sockets/GetSocketIo");
io.emitTo(`inst:${institute_code}`, "notification:new", {...})

3) Sockets/SocketMain.js — aceitar o join às rooms

Usa o joinSocketRooms do teu controller quando o cliente se ligar e te enviar os dados do utilizador (id + instituto) — p. ex., através de um evento join:

// Sockets/SocketMain.js
const { get } = require("./GetSocketIo");
const { joinSocketRooms } = require("../Controllers/NotificationsController");

const io = get();

io.on("connection", (socket) => {
  // o cliente deve emitir algo como:
  // socket.emit("join", { user: req.session.user })  OU passar só ids
  socket.on("join", (payload) => {
    // 1) Se tens a sessão no socket (via middleware), ótimo;
    // 2) Caso contrário, usa o payload enviado pelo cliente:
    const sessionUser = payload?.user || {
      eduall_user_session_curentinstitute: payload?.instituteCode,
      eduall_user_session_ID: payload?.userId
    };
    joinSocketRooms(io, socket, sessionUser);
  });

  socket.on("leave", (payload) => {
    try {
      const inst = payload?.instituteCode;
      const uid  = payload?.userId;
      if (inst) socket.leave(`inst:${inst}`);
      if (uid)  socket.leave(`user:${uid}`);
    } catch {}
  });
});


Se já usas express-socket.io-session para partilhar a sessão, podes obter req.session.user no socket.request.session.user e passar direto ao joinSocketRooms.

4) Usar o RegisterAuditAction nos controladores

Em qualquer CRUD onde registas atividade:

const { RegisterAuditAction } = require("../Controllers/NotificationsController");

await RegisterAuditAction({
  session: req.session,
  res,
  req,
  action: 1, // 1=criar, 2=atualizar, 3=eliminar...
  form: "Turmas",
  description: `Criou a turma ${req.body.class_title} (${req.body.class_code}).`
});


Isto:

garante o schema (coluna ed_user_account_allow_notification + tabela eduall_notifications);

grava na eduall_auditory;

gera HTML com Gemini (fallback texto);

cria notificações por recetor (opt-in=1, mesma escola, exclui autor);

emite notification:new para a room inst:{institute}.

5) Cliente (mínimo para testar)

Assim que conheceres userId e instituteCode do utilizador logado:

import io from "socket.io-client";
const socket = io(process.env.REACT_APP_API_BASE, { withCredentials: true });
socket.emit("join", { userId: me.id, instituteCode: me.currentInstitute });

socket.on("notification:new", (n) => {
  console.log("Nova notificação:", n);
});


E consome a API:

GET  /api/notifications?limit=25
POST /api/notifications/mark-seen   { ids: [123,124] }
POST /api/notifications/mark-all-seen
POST /api/notifications/settings    { allow: 1 } // opt-in

Dicas rápidas

Garante que, após login, tens em req.session.user:

eduall_user_session_curentinstitute

eduall_user_session_ID (ou _id – o teu código já trata ambos)

Adiciona no teu CSS as classes utilitárias que a IA vai usar:

.text-main{color:#0d6efd}.text-green{color:#198754}.grey-text{color:#6c757d}
.bg-main{background:#0d6efd;color:#fff}.bg-warning{background:#fff3cd}
.bg-waning{background:#fff8e1}


 

*/