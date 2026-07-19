// notifications.js
const axios = require("axios");
const ExecuteQuery = require("../Functions/ExecuteQuery");
const Cache = require("../Functions/CacheRoutes");

/* =============== Cache ===============
 * Notificações são lidas com muita frequência (badge de não-lidas,
 * polling do sino) mas escritas com pouca frequência relativa —
 * por isso valem bem a pena em cache, com invalidação direta nos
 * pontos de escrita em vez de confiar só no TTL.
 */
const UNREAD_COUNT_CACHE_TTL = 30;      // segundos — badge pode ficar 30s "desatualizado" no pior caso
const NOTIFICATIONS_LIST_CACHE_TTL = 30; // só cacheamos a primeira página (sem cursor)
const NOTIFICATION_PREFS_CACHE_TTL = 3600; // preferências mudam raramente

const CacheKeys = {
  unreadCount: (instituteCode, userId) => `notifications:unread:${instituteCode}:${userId}`,
  list: (instituteCode, userId, limit) => `notifications:list:${instituteCode}:${userId}:${limit}`,
  prefs: (userId) => `notifications:prefs:${userId}`,
};

// Limpa tudo o que depende do estado de notificações de um utilizador
// (contagem + primeira página). Chamado sempre que há uma escrita que
// afeta esse utilizador: nova notificação recebida, marcar como lida/não
// lida, marcar tudo como lido.
async function invalidateUserNotificationsCache(instituteCode, userId) {
  await Cache.eduallDel(CacheKeys.unreadCount(instituteCode, userId));
  // a lista é cacheada por limit também, por isso limpamos por padrão
  await Cache.eduallClear(`notifications:list:${instituteCode}:${userId}:*`);
}

/* =============== Utils =============== */

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const nowIso = () => new Date().toISOString().slice(0, 19).replace("T", " ");

function safeHTML(s) {
  const str = String(s ?? "");
  return str
    .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, "")
    .replace(/on\w+="[^"]*"/gi, "")
    .replace(/javascript:/gi, "")
    .replace(/<([^>]+)>/g, (m, tag) => {
      const t = tag.trim().toLowerCase();
      const allowed = ["b","strong","i","em","u","br","hr","small","span","div","p","ul","ol","li","code","pre"];
      const name = t.split(/\s+/)[0].replace(/\//g, "");
      return allowed.includes(name) ? `<${tag}>` : "";
    });
}

/* =============== Mensagem (IA opcional) =============== */

function renderNotificationHTML({ action, form, description, userName, createdAt }) {
  const label =
    action === 1
      ? `<span class="text-green">Criado</span>`
      : action === 2
      ? `<span class="text-main">Atualizado</span>`
      : action === 3
      ? `<span class="grey-text">Eliminado</span>`
      : `<span class="text-main">Ação</span>`;

  const html = `
    <p class="ntf">
      <span class="text-main"><b>${userName || "Utilizador"}</b></span> ${["efetuou uma ação","criou","atualizou","eliminou"][action] || "efetuou uma ação"} em <b>${form || "Área"}</b>.
      <br><small class="grey-text">${description ? String(description).slice(0, 400) : ""}</small>
      <br><small class="grey-text">${label} · ${createdAt || nowIso()}</small>
    </p>
  `;
  return safeHTML(html);
}

async function geminiExplain({ action, form, description, userName, createdAt }) {
  try {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      const html = renderNotificationHTML({ action, form, description, userName, createdAt });
      return { ok: true, html };
    }
    const prompt = `
    Gera uma descrição curta (≤580 chars) em HTML simples (p, span, b, small, br).
    Utilizador: ${userName || "—"}
    Área: ${form || "—"}
    Ação: ${action}
    Descrição: ${description || ""}
    Data: ${createdAt || nowIso()}
    `.trim();

    const url =  "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent";
    const { data } = await axios.post(
      `${url}?key=${apiKey}`,
      { contents: [{ parts: [{ text: prompt }] }] },
      { timeout: 8000 }
    );

    const txt =
      data?.candidates?.[0]?.content?.parts?.map((p) => p.text).join("") ||
      data?.candidates?.[0]?.content?.parts?.[0]?.text || "";
    const html = safeHTML(txt).trim() || renderNotificationHTML({ action, form, description, userName, createdAt });
    return { ok: true, html };
  } catch {
    return {
      ok: false,
      html: renderNotificationHTML({ action, form, description, userName, createdAt })
    };
  }
}

/* =============== Schema/Índices =============== */
async function ensureSchema(res, req) {
  // preferências
  const q1 = `
    SELECT COUNT(*) AS exist
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'eduall_user_accounts'
      AND COLUMN_NAME = 'ed_user_account_allow_notification'
  `;
  const [c1] = await ExecuteQuery(res, q1, [], true, { db: "eduall_user_accounts", type: "select", data: req });
  if (c1 && Number(c1.exist) === 0) {
    const alter1 = `
      ALTER TABLE eduall_user_accounts
      ADD COLUMN ed_user_account_allow_notification TINYINT(1) NOT NULL DEFAULT 0
      COMMENT '0=opt-out, 1=opt-in';
    `;
    await ExecuteQuery(res, alter1, [], false, { db: "eduall_user_accounts", type: "alter", data: req });
  }

  // tabela de notificações
  const q2 = `
    CREATE TABLE IF NOT EXISTS eduall_notifications (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      institute_code VARCHAR(64) NOT NULL,
      audit_id BIGINT UNSIGNED NULL,
      actor_user_id BIGINT UNSIGNED NULL,
      recipient_user_id BIGINT UNSIGNED NOT NULL,
      title VARCHAR(200) NULL,
      body_html MEDIUMTEXT NULL,
      body_text TEXT NULL,
      seen TINYINT(1) NOT NULL DEFAULT 0,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_inst_rec_seen_dt (institute_code, recipient_user_id, seen, created_at),
      INDEX idx_inst_rec_id (institute_code, recipient_user_id, id),
      INDEX idx_audit (audit_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `;
  await ExecuteQuery(res, q2, [], false, { db: "eduall_notifications", type: "create", data: req });
}

/* =============== Socket Rooms Helper =============== */
function joinSocketRooms(io, socket, sessionUser) {
  try {
    if (!sessionUser) return;
    const inst = sessionUser.eduall_user_session_curentinstitute;
    const uid = sessionUser.eduall_user_session_ID || sessionUser.eduall_user_session_id;
    if (inst) socket.join(`inst:${inst}`);
    if (uid) socket.join(`user:${uid}`);
  } catch {}
}

/* =============== Core =============== */
const RegisterAuditAction = async ({ session, res, req, action, description, form }) => {
  try {
    await ensureSchema(res, req);

    const actor_user_id = session?.user?.eduall_user_session_ID;
    const institute_code = session?.user?.eduall_user_session_curentinstitute;

    const insertAudit = `
      INSERT INTO eduall_auditory 
      (ed_auditory_action, ed_auditory_description, ed_auditory_form, ed_auditory_user_code, ed_auditory_institute_code) 
      VALUES (?, ?, ?, ?, ?)
    `;
    const params = [action, description, form, actor_user_id, institute_code];
    const auditResult = await ExecuteQuery(res, insertAudit, params, false, {
      db: "eduall_auditory",
      type: "insert",
      data: req
    });
    const audit_id = auditResult?.insertId;

    // dados do utilizador (actor)
    const [u] = await ExecuteQuery(
      res,
      "SELECT ed_user_account_name AS name, ed_user_account_picture AS avatar FROM eduall_user_accounts WHERE ed_user_account_id = ? LIMIT 1",
      [actor_user_id],
      true,
      { db: "eduall_user_accounts", type: "select", data: req }
    );
    const userName = u?.name || "Utilizador";

    const { html: body_html } = await geminiExplain({
      action,
      form,
      description,
      userName,
      createdAt: nowIso()
    });
    const body_text = `${userName} efetuou uma ação em ${form}. ${description || ""}`.trim();

    // destinatários: MESMO INSTITUTO, opt-in, excepto autor
    // ⚠️ AJUSTA a coluna do instituto conforme a tua base:
    // aqui assumimos ed_user_account_institute_code
    const recipients = await ExecuteQuery(
      res,
      `
      SELECT ed_user_account_id AS id, ed_user_account_name AS name, ed_user_account_picture AS avatar
      FROM eduall_user_accounts
      WHERE ed_user_account_allow_notification = 1
        AND ed_user_account_id <> ?
        AND ed_user_account_institute_code = ?
      `,
      [actor_user_id, institute_code],
      true,
      { db: "eduall_user_accounts", type: "select", data: req }
    );

    if (Array.isArray(recipients) && recipients.length) {
      const rows = recipients.map((r) => [
        institute_code,
        audit_id,
        actor_user_id,
        Number(r.id),
        form || "Atividade",
        body_html,
        body_text,
        0,
        nowIso()
      ]);

      const insMany = `
        INSERT INTO eduall_notifications
        (institute_code, audit_id, actor_user_id, recipient_user_id, title, body_html, body_text, seen, created_at)
        VALUES ?
      `;
      await ExecuteQuery(res, insMany, [rows], false, {
        db: "eduall_notifications",
        type: "insert",
        data: req
      });

      // ── CACHE: cada destinatário recebeu uma notificação nova, por isso
      // a contagem de não-lidas e a primeira página de lista dele ficaram
      // desatualizadas. Invalida por destinatário em vez de limpar tudo.
      await Promise.all(
        recipients.map((r) => invalidateUserNotificationsCache(institute_code, Number(r.id)))
      );

      // emitir socket para a ROOM do instituto
      const io = require("../Sockets/GetSocketIo");
      const payload = {
        audit_id,
        institute_code,
        actor_user_id,
        actor_name: userName,
        actor_avatar: u?.avatar || null,
        title: form || "Atividade",
        body_html,
        body_text,
        created_at: nowIso()
      };
      // uso direto do io.to()
      io.to && io.to(`inst:${institute_code}`).emit("notification:new", payload);
      io.emitTo && io.emitTo(`inst:${institute_code}`, "notification:new", payload); // compat
    }

    return { ok: true, audit_id };
  } catch (error) {
    console.log("Erro em RegisterAuditAction:", error.message);
    return { ok: false, error: error.message };
  }
};

/* =============== Rotas =============== */
function buildNotificationsRouter(io) {
  const express = require("express");
  const router = express.Router();

  // middleware simples para exigir sessão
  const needSession = (req, res, next) => {
    if (!req.session?.user) return res.status(401).json({ ok: false, error: "Sessão inválida" });
    next();
  };

  router.get("/api/notifications", needSession, async (req, res) => {
    try {
      await ensureSchema(res, req);

      const user = req.session.user;
      const uid = user.eduall_user_session_ID || user.eduall_user_session_id;
      const inst = user.eduall_user_session_curentinstitute;

      const limit = Math.max(1, Math.min(50, Number(req.query.limit) || 20));
      const cursor = req.query.cursor ? Number(req.query.cursor) : null;

      // ── CACHE: só cacheamos a primeira página (sem cursor). Páginas
      // seguintes são pedidas com pouca frequência e a combinatória de
      // cursors tornaria a cache pouco eficaz.
      const cacheKey = !cursor ? CacheKeys.list(inst, uid, limit) : null;

      if (cacheKey) {
        const cached = await Cache.eduallGet(cacheKey);
        if (cached !== null) {
          return res.json(cached);
        }
      }

      let sql = `
        SELECT
          n.id, n.audit_id, n.title, n.body_html, n.body_text, n.seen, n.created_at,
          n.actor_user_id,
          IFNULL(u.ed_user_account_name, 'Utilizador') AS actor_name,
          IFNULL(u.ed_user_account_picture, NULL) AS actor_avatar
        FROM eduall_notifications n
        LEFT JOIN eduall_user_accounts u
          ON u.ed_user_account_id = n.actor_user_id
        WHERE n.institute_code = ?
          AND n.recipient_user_id = ?
      `;
      const params = [inst, uid];

      if (cursor) {
        sql += ` AND n.id < ? `;
        params.push(cursor);
      }
      sql += ` ORDER BY n.id DESC LIMIT ?`;
      params.push(limit + 1);

      const rows = await ExecuteQuery(res, sql, params, true, {
        db: "eduall_notifications",
        type: "select",
        data: req
      });

      const hasMore = rows.length > limit;
      const dataRows = hasMore ? rows.slice(0, limit) : rows;
      const nextCursor = hasMore ? dataRows[dataRows.length - 1].id : null;

      const data = dataRows.map((r) => ({
        id: r.id,
        audit_id: r.audit_id,
        title: r.title,
        body_html: r.body_html,
        body_text: r.body_text,
        seen: r.seen,
        created_at: r.created_at,
        actor_user_id: r.actor_user_id,
        actor_name: r.actor_name,
        actor_avatar: r.actor_avatar
      }));

      const payload = { ok: true, data, nextCursor };

      if (cacheKey) {
        await Cache.eduallSet(cacheKey, payload, NOTIFICATIONS_LIST_CACHE_TTL);
      }

      return res.json(payload);
    } catch (e) {
      return res.status(500).json({ ok: false, error: e.message });
    }
  });

  // contagem de não lidas (p/ badge)
  router.get("/api/notifications/unread-count", needSession, async (req, res) => {
    try {
      const uid = req.session.user.eduall_user_session_ID || req.session.user.eduall_user_session_id;
      const inst = req.session.user.eduall_user_session_curentinstitute;

      // ── CACHE: este endpoint é chamado em polling pelo sino/badge,
      // por isso é o que mais beneficia de cache.
      const cacheKey = CacheKeys.unreadCount(inst, uid);
      const cached = await Cache.eduallGet(cacheKey);
      if (cached !== null) {
        return res.json(cached);
      }

      const sql = `
        SELECT COUNT(*) AS c
        FROM eduall_notifications
        WHERE institute_code = ? AND recipient_user_id = ? AND seen = 0
      `;
      const [r] = await ExecuteQuery(res, sql, [inst, uid], true, {
        db: "eduall_notifications",
        type: "select",
        data: req
      });

      const payload = { ok: true, count: Number(r?.c || 0) };
      await Cache.eduallSet(cacheKey, payload, UNREAD_COUNT_CACHE_TTL);

      res.json(payload);
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // marcar como lidas
  router.post("/api/notifications/mark-seen", needSession, async (req, res) => {
    try {
      const uid = req.session.user.eduall_user_session_ID || req.session.user.eduall_user_session_id;
      const inst = req.session.user.eduall_user_session_curentinstitute;

      const ids = Array.isArray(req.body?.ids)
        ? req.body.ids.map((n) => Number(n)).filter(Boolean)
        : [];
      if (!ids.length) return res.json({ ok: true });

      const inClause = ids.map(() => "?").join(",");
      const sql = `
        UPDATE eduall_notifications
        SET seen = 1
        WHERE id IN (${inClause}) AND recipient_user_id = ? AND institute_code = ?
      `;
      await ExecuteQuery(res, sql, [...ids, uid, inst], false, {
        db: "eduall_notifications",
        type: "update",
        data: req
      });

      // ── CACHE: contagem e primeira página mudaram
      await invalidateUserNotificationsCache(inst, uid);

      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // marcar como NÃO lidas (opcional, usado no front)
  router.post("/api/notifications/mark-unseen", needSession, async (req, res) => {
    try {
      const uid = req.session.user.eduall_user_session_ID || req.session.user.eduall_user_session_id;
      const inst = req.session.user.eduall_user_session_curentinstitute;

      const ids = Array.isArray(req.body?.ids)
        ? req.body.ids.map((n) => Number(n)).filter(Boolean)
        : [];
      if (!ids.length) return res.json({ ok: true });

      const inClause = ids.map(() => "?").join(",");
      const sql = `
        UPDATE eduall_notifications
        SET seen = 0
        WHERE id IN (${inClause}) AND recipient_user_id = ? AND institute_code = ?
      `;
      await ExecuteQuery(res, sql, [...ids, uid, inst], false, {
        db: "eduall_notifications",
        type: "update",
        data: req
      });

      // ── CACHE: contagem e primeira página mudaram
      await invalidateUserNotificationsCache(inst, uid);

      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // marcar tudo como lido
  router.post("/api/notifications/mark-all-seen", needSession, async (req, res) => {
    try {
      const uid = req.session.user.eduall_user_session_ID || req.session.user.eduall_user_session_id;
      const inst = req.session.user.eduall_user_session_curentinstitute;
      const sql = `
        UPDATE eduall_notifications
        SET seen = 1
        WHERE institute_code = ? AND recipient_user_id = ?
      `;
      await ExecuteQuery(res, sql, [inst, uid], false, {
        db: "eduall_notifications",
        type: "update",
        data: req
      });

      // ── CACHE: contagem e primeira página mudaram
      await invalidateUserNotificationsCache(inst, uid);

      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // preferências: GET estado atual
  router.get("/api/me/notifications", needSession, async (req, res) => {
    try {
      await ensureSchema(res, req);
      const uid = req.session.user.eduall_user_session_ID || req.session.user.eduall_user_session_id;

      // ── CACHE: preferências mudam raramente, TTL longo
      const cacheKey = CacheKeys.prefs(uid);
      const cached = await Cache.eduallGet(cacheKey);
      if (cached !== null) {
        return res.json(cached);
      }

      const [r] = await ExecuteQuery(
        res,
        "SELECT ed_user_account_allow_notification AS allow FROM eduall_user_accounts WHERE ed_user_account_id = ? LIMIT 1",
        [uid],
        true,
        { db: "eduall_user_accounts", type: "select", data: req }
      );

      const payload = { ok: true, allow: Number(r?.allow || 0) === 1 };
      await Cache.eduallSet(cacheKey, payload, NOTIFICATION_PREFS_CACHE_TTL);

      res.json(payload);
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // preferências: toggle
  router.post("/api/me/notifications/toggle", needSession, async (req, res) => {
    try {
      await ensureSchema(res, req);
      const uid = req.session.user.eduall_user_session_ID || req.session.user.eduall_user_session_id;
      const [r] = await ExecuteQuery(
        res,
        "SELECT ed_user_account_allow_notification AS allow FROM eduall_user_accounts WHERE ed_user_account_id = ? LIMIT 1",
        [uid],
        true,
        { db: "eduall_user_accounts", type: "select", data: req }
      );
      const cur = Number(r?.allow || 0);
      const next = cur === 1 ? 0 : 1;
      await ExecuteQuery(
        res,
        "UPDATE eduall_user_accounts SET ed_user_account_allow_notification = ? WHERE ed_user_account_id = ? LIMIT 1",
        [next, uid],
        false,
        { db: "eduall_user_accounts", type: "update", data: req }
      );

      // ── CACHE: preferência mudou
      await Cache.eduallDel(CacheKeys.prefs(uid));

      res.json({ ok: true, allow: next === 1 });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // compat: endpoint antigo se precisares
  router.post("/api/notifications/settings", needSession, async (req, res) => {
    try {
      await ensureSchema(res, req);
      const uid = req.session.user.eduall_user_session_ID || req.session.user.eduall_user_session_id;
      const allow = Number(req.body?.allow) === 1 ? 1 : 0;
      await ExecuteQuery(
        res,
        "UPDATE eduall_user_accounts SET ed_user_account_allow_notification = ? WHERE ed_user_account_id = ? LIMIT 1",
        [allow, uid],
        false,
        { db: "eduall_user_accounts", type: "update", data: req }
      );

      // ── CACHE: preferência mudou
      await Cache.eduallDel(CacheKeys.prefs(uid));

      res.json({ ok: true, allow });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  return router;
}

/* =============== Auditoria (como no teu código) =============== */
const GetAllAuditActionsByInstitute = async (req, res) => {
  try {
    const institute_code = req.session.user.eduall_user_session_curentinstitute;
    const query = `
      SELECT a.*, u.ed_user_account_name AS user_name
      FROM eduall_auditory a
      LEFT JOIN eduall_user_accounts u ON u.ed_user_account_id = a.ed_auditory_user_code
      WHERE a.ed_auditory_institute_code = ?
      ORDER BY a.ed_auditory_id DESC
    `;
    const rows = await ExecuteQuery(res, query, [institute_code], true, {
      db: "eduall_auditory",
      type: "select",
      data: req
    });
    res.status(200).json(rows);
  } catch (error) {
    res.status(500).json({ success: false, message: "Erro ao listar auditoria da instituição", error: error.message });
  }
};

const GetAuditActionsByUser = async (req, res) => {
  try {
    const user_code = req.session.user.eduall_user_session_id;
    const query = `
      SELECT a.*, u.ed_user_account_name AS user_name
      FROM eduall_auditory a
      LEFT JOIN eduall_user_accounts u ON u.ed_user_account_id = a.ed_auditory_user_code
      WHERE a.ed_auditory_user_code = ?
      ORDER BY a.ed_auditory_id DESC
    `;
    const rows = await ExecuteQuery(res, query, [user_code], true, {
      db: "eduall_auditory",
      type: "select",
      data: req
    });
    res.status(200).json(rows);
  } catch (error) {
    res.status(500).json({ success: false, message: "Erro ao listar auditoria do utilizador", error: error.message });
  }
};

const GetAllAuditActionsForAllInstitutes = async (req, res) => {
  try {
    const query = `
      SELECT a.*, u.ed_user_account_name AS user_name
      FROM eduall_auditory a
      LEFT JOIN eduall_user_accounts u ON u.ed_user_account_id = a.ed_auditory_user_code
      ORDER BY a.ed_auditory_id DESC
    `;
    const rows = await ExecuteQuery(res, query, [], true, {
      db: "eduall_auditory",
      type: "select",
      data: req
    });
    res.status(200).json(rows);
  } catch (error) {
    res.status(500).json({ success: false, message: "Erro ao listar auditoria geral", error: error.message });
  }
};

module.exports = {
  RegisterAuditAction,
  joinSocketRooms,
  buildNotificationsRouter,
  GetAllAuditActionsByInstitute,
  GetAuditActionsByUser,
  GetAllAuditActionsForAllInstitutes
};



// Sockets/GetSocketIo.js (exemplo)