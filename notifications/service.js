"use strict";

const { DATABASE } = require("../config/Database");
const realtime = require("../realtime/realtime");
const { resolveRedisConnection } = require("../realtime/redisConfiguration");
const { configuredUserIds } = require("../hr/moderationAccess");

let rateRedis;
function getRateRedis() {
  if (rateRedis !== undefined) return rateRedis;
  try {
    const Redis = require("ioredis");
    const target = resolveRedisConnection();
    rateRedis = target.url
      ? new Redis(target.url, { maxRetriesPerRequest: 1, enableOfflineQueue: false })
      : new Redis({
          host: target.host,
          port: target.port,
          password: target.password,
          db: target.db,
          maxRetriesPerRequest: 1,
          enableOfflineQueue: false,
        });
    rateRedis?.on("error", () => {});
  } catch {
    rateRedis = null;
  }
  return rateRedis;
}

function fail(status, code, message) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  throw error;
}

function json(value, fallback = {}) {
  try {
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
}

function notificationRow(row) {
  const data = json(row.data_json, {});
  const hasActor = Boolean(Number(row.actor_user_id));
  return {
    id: Number(row.id),
    type: row.type || "legacy",
    actorId: row.actor_user_id ? Number(row.actor_user_id) : null,
    actorName: (hasActor ? row.actor_name : data.actorName)
      || row.actor_name
      || data.actorName
      || "Utilizador",
    actorAvatar: (hasActor ? row.actor_avatar : data.actorAvatar)
      || row.actor_avatar
      || data.actorAvatar
      || "",
    title: row.title || "",
    text: row.body_text || "",
    postId: row.post_id ? Number(row.post_id) : null,
    commentId: row.comment_id ? Number(row.comment_id) : null,
    data,
    read: Boolean(row.seen),
    readAt: row.read_at,
    createdAt: row.created_at,
  };
}

function groupedActors(previous = {}, actorId, actorName, actorAvatar) {
  const actors = Array.isArray(previous.actors) ? [...previous.actors] : [];
  if (!actors.length && Number(previous.actorId || previous.actor_user_id)) {
    actors.push({
      id: Number(previous.actorId || previous.actor_user_id),
      name: previous.actorName || "Utilizador",
      avatar: previous.actorAvatar || "",
    });
  }
  if (actorId && !actors.some((actor) => Number(actor.id) === Number(actorId))) {
    actors.push({
      id: Number(actorId),
      name: actorName || "Utilizador",
      avatar: actorAvatar || "",
    });
  }
  return actors.slice(-8);
}

function groupedActorCount(previous = {}, actors = []) {
  return Math.max(Number(previous.count || 1), actors.length);
}

async function canNotify(recipientId, instituteCode, actorId) {
  if (!recipientId || Number(recipientId) === Number(actorId)) return false;
  const [rows] = await DATABASE.query(
    `SELECT ua.ed_user_account_allow_notification AS allow,
            EXISTS (
              SELECT 1 FROM eduall_hr_recommendation_muted_authors m
               WHERE BINARY m.ed_hr_rec_muted_institute_code = BINARY ?
                 AND m.ed_hr_rec_muted_user_id = ua.ed_user_account_id
                 AND m.ed_hr_rec_muted_author_id = ?
            ) AS muted
       FROM eduall_user_accounts ua
      WHERE ua.ed_user_account_id = ?
        AND ua.ed_user_account_deleted = 0
      LIMIT 1`,
    [instituteCode, Number(actorId) || 0, recipientId]
  );
  return Boolean(rows[0] && Number(rows[0].allow) !== 0 && !Number(rows[0].muted));
}

async function allowNotificationRate(instituteCode, recipientId) {
  const limit = Math.max(1, Number(process.env.NOTIFICATIONS_MAX_PER_HOUR) || 200);
  const key = `notifications:rate:${instituteCode}:${recipientId}:${Math.floor(Date.now() / 3_600_000)}`;
  const redis = getRateRedis();
  if (redis) {
    try {
      const total = await redis.incr(key);
      if (total === 1) await redis.expire(key, 3700);
      return total <= limit;
    } catch {
      // O limite em MySQL continua a ser aplicado abaixo.
    }
  }
  const [rows] = await DATABASE.query(
    `SELECT COUNT(*) AS total FROM eduall_notifications
      WHERE institute_code = ? AND recipient_user_id = ?
        AND created_at >= DATE_SUB(NOW(), INTERVAL 1 HOUR)`,
    [instituteCode, recipientId]
  );
  return Number(rows[0]?.total || 0) < limit;
}

async function createNotification(input) {
  const recipientId = Number(input.recipientId);
  const actorId = Number(input.actorId) || null;
  if (!recipientId || recipientId === actorId) return null;
  if (!(await canNotify(recipientId, input.instituteCode, actorId))) return null;
  if (!(await allowNotificationRate(input.instituteCode, recipientId))) return null;

  const data = input.data || {};
  const groupKey = input.groupKey || null;
  if (groupKey) {
    const [grouped] = await DATABASE.query(
      `SELECT id, actor_user_id, data_json, title, body_text
         FROM eduall_notifications
        WHERE BINARY institute_code = BINARY ?
          AND recipient_user_id = ?
          AND type = ?
          AND group_key = ?
          AND seen = 0
          AND deleted = 0
          AND created_at >= DATE_SUB(NOW(), INTERVAL ? MINUTE)
        ORDER BY id DESC
        LIMIT 1`,
      [
        input.instituteCode,
        recipientId,
        input.type,
        groupKey,
        Math.max(1, Number(process.env.NOTIFICATIONS_GROUP_WINDOW_MINUTES) || 30),
      ]
    );
    if (grouped[0]) {
      const previous = json(grouped[0].data_json, {});
      const actors = groupedActors(previous, actorId, input.actorName, input.actorAvatar);
      const count = groupedActorCount(previous, actors);
      const nextData = { ...previous, ...data, actors: actors.slice(-8), count };
      const body = count > 1
        ? `${input.actorName || "Alguém"} e mais ${count - 1} pessoa${count > 2 ? "s" : ""} ${input.groupAction || "interagiram"}`
        : (input.text || grouped[0].body_text || "");
      await DATABASE.query(
        `UPDATE eduall_notifications
            SET actor_user_id = ?, data_json = ?, body_text = ?, title = ?,
                updated_at = NOW()
          WHERE id = ? AND recipient_user_id = ? AND institute_code = ?`,
        [
          actorId,
          JSON.stringify(nextData),
          body,
          input.title || grouped[0].title,
          grouped[0].id,
          recipientId,
          input.instituteCode,
        ]
      );
      const [rows] = await DATABASE.query(
        "SELECT * FROM eduall_notifications WHERE id = ? LIMIT 1",
        [grouped[0].id]
      );
      const item = notificationRow(rows[0]);
      realtime.emitToUser(input.instituteCode, recipientId, "notification:new", item);
      return item;
    }
  }

  const dedupeKey = input.dedupeKey
    ? String(input.dedupeKey).slice(0, 255)
    : null;
  const [result] = await DATABASE.query(
    `INSERT INTO eduall_notifications (
       institute_code, actor_user_id, recipient_user_id, type, post_id,
       comment_id, title, body_text, data_json, group_key, dedupe_key
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       actor_user_id = VALUES(actor_user_id),
       title = VALUES(title),
       body_text = VALUES(body_text),
       data_json = VALUES(data_json),
       deleted = 0,
       updated_at = NOW()`,
    [
      input.instituteCode,
      actorId,
      recipientId,
      input.type,
      input.postId || null,
      input.commentId || null,
      String(input.title || "").slice(0, 200),
      String(input.text || "").slice(0, 5000),
      JSON.stringify({
        ...data,
        actorId,
        actorName: input.actorName,
        actorAvatar: input.actorAvatar,
        actors: groupedActors({}, actorId, input.actorName, input.actorAvatar),
        count: actorId ? 1 : 0,
      }),
      groupKey,
      dedupeKey,
    ]
  );
  let id = Number(result.insertId);
  if (!id && dedupeKey) {
    const [rows] = await DATABASE.query(
      `SELECT id FROM eduall_notifications
        WHERE institute_code = ? AND recipient_user_id = ? AND dedupe_key = ?
        LIMIT 1`,
      [input.instituteCode, recipientId, dedupeKey]
    );
    id = Number(rows[0]?.id || 0);
  }
  if (!id) return null;
  const [rows] = await DATABASE.query("SELECT * FROM eduall_notifications WHERE id = ?", [id]);
  const item = notificationRow(rows[0]);
  realtime.emitToUser(input.instituteCode, recipientId, "notification:new", item);
  return item;
}

async function listNotifications(ctx, query = {}) {
  const limit = Math.max(1, Math.min(50, Number(query.limit) || 20));
  const before = Number(query.cursor) || null;
  const params = [ctx.instituteCode, ctx.userId];
  let where = `n.institute_code = ? AND n.recipient_user_id = ? AND n.deleted = 0`;
  if (query.unread === "1" || query.unread === "true") where += " AND n.seen = 0";
  if (before) {
    where += " AND n.id < ?";
    params.push(before);
  }
  const [rows] = await DATABASE.query(
    `SELECT n.*,
            COALESCE(ea.ed_employee_name, ua.ed_user_account_name, 'Utilizador') AS actor_name,
            COALESCE(ua.ed_user_account_picture, ea.ed_employee_picture, '') AS actor_avatar
       FROM eduall_notifications n
       LEFT JOIN eduall_user_accounts ua
         ON ua.ed_user_account_id = n.actor_user_id
        AND ua.ed_user_account_deleted = 0
       LEFT JOIN eduall_user_institutes ui
         ON ui.ed_user_institute_userCode = n.actor_user_id
        AND BINARY ui.ed_user_institute_code = BINARY n.institute_code
        AND ui.ed_user_institute_deleted = 0
       LEFT JOIN eduall_employees ea
         ON ea.ed_employee_id = ui.ed_user_institute_employeeCode
        AND BINARY ea.ed_employee_institute_code = BINARY n.institute_code
        AND ea.ed_employee_deleted = 0
      WHERE ${where}
      ORDER BY n.id DESC
      LIMIT ?`,
    [...params, limit + 1]
  );
  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  return {
    items: page.map(notificationRow),
    nextCursor: hasMore ? Number(page[page.length - 1].id) : null,
  };
}

async function unreadCount(ctx) {
  const [rows] = await DATABASE.query(
    `SELECT COUNT(*) AS total FROM eduall_notifications
      WHERE institute_code = ? AND recipient_user_id = ? AND seen = 0 AND deleted = 0`,
    [ctx.instituteCode, ctx.userId]
  );
  return { count: Number(rows[0]?.total || 0) };
}

async function markRead(ctx, ids) {
  const list = [...new Set((Array.isArray(ids) ? ids : [ids]).map(Number).filter(Boolean))];
  if (!list.length) return { updated: 0 };
  const [result] = await DATABASE.query(
    `UPDATE eduall_notifications
        SET seen = 1, read_at = NOW()
      WHERE institute_code = ? AND recipient_user_id = ?
        AND id IN (${list.map(() => "?").join(",")})
        AND deleted = 0`,
    [ctx.instituteCode, ctx.userId, ...list]
  );
  return { updated: result.affectedRows || 0 };
}

async function markAllRead(ctx) {
  const [result] = await DATABASE.query(
    `UPDATE eduall_notifications
        SET seen = 1, read_at = NOW()
      WHERE institute_code = ? AND recipient_user_id = ? AND seen = 0 AND deleted = 0`,
    [ctx.instituteCode, ctx.userId]
  );
  return { updated: result.affectedRows || 0 };
}

async function deleteNotification(ctx, id) {
  await DATABASE.query(
    `UPDATE eduall_notifications SET deleted = 1
      WHERE id = ? AND institute_code = ? AND recipient_user_id = ?`,
    [Number(id), ctx.instituteCode, ctx.userId]
  );
  return { id: Number(id), deleted: true };
}

async function watchPost({ instituteCode, postId, userId, source = "comment" }) {
  if (!userId || !postId) return;
  await DATABASE.query(
    `INSERT INTO post_watchers (
       ed_post_watcher_institute_code, ed_post_watcher_post_uid,
       ed_post_watcher_user_id, ed_post_watcher_source
     ) VALUES (?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       ed_post_watcher_source = VALUES(ed_post_watcher_source),
       ed_post_watcher_updated_at = NOW()`,
    [instituteCode, Number(postId), Number(userId), source]
  );
}

async function mutePostWatcher(ctx, postId) {
  await DATABASE.query(
    `INSERT INTO post_watchers (
       ed_post_watcher_institute_code, ed_post_watcher_post_uid,
       ed_post_watcher_user_id, ed_post_watcher_source, ed_post_watcher_muted
     ) VALUES (?, ?, ?, 'manual', 1)
     ON DUPLICATE KEY UPDATE ed_post_watcher_muted = 1, ed_post_watcher_updated_at = NOW()`,
    [ctx.instituteCode, Number(postId), ctx.userId]
  );
  return { postId: Number(postId), muted: true };
}

async function handleDomainEvent(event) {
  const payload = event.payload || {};
  const base = {
    instituteCode: event.instituteCode,
    actorId: payload.actorId,
    actorName: payload.actorName,
    actorAvatar: payload.actorAvatar,
    postId: payload.postId,
    commentId: payload.commentId,
  };
  if (event.name === "post.approved") {
    return createNotification({
      ...base,
      recipientId: payload.authorId,
      type: "post_approved",
      title: "A tua publicação foi publicada",
      text: "A publicação já está visível na comunidade.",
      dedupeKey: `post-approved:${payload.postId}`,
    });
  }
  if (event.name === "post.created") {
    return null;
  }
  if (event.name === "post.rejected") {
    return createNotification({
      ...base,
      recipientId: payload.authorId,
      type: "post_rejected",
      title: "A tua publicação foi bloqueada",
      text: payload.reason || "A publicação não cumpre as regras da comunidade.",
      data: { reason: payload.reason, canRequestReview: true },
      dedupeKey: `post-rejected:${payload.postId}`,
    });
  }
  if (event.name === "content.under_review" || event.name === "report.threshold_reached") {
    return createNotification({
      ...base,
      recipientId: payload.authorId,
      type: "content_under_review",
      title: "Conteúdo em revisão",
      text: "O teu conteúdo foi temporariamente ocultado para revisão.",
      data: { contentType: payload.contentType, contentId: payload.contentId },
      dedupeKey: `under-review:${payload.contentType}:${payload.contentId}`,
    });
  }
  if (event.name === "comment.removed" || event.name === "comment.rejected") {
    return createNotification({
      ...base,
      recipientId: payload.authorId,
      type: "comment_removed",
      title: "O teu comentário foi removido",
      text: payload.reason || "O comentário deixou de estar visível após revisão.",
      data: { reason: payload.reason },
      dedupeKey: `comment-removed:${payload.commentId}`,
    });
  }
  if (event.name === "content.escalated") {
    const recipients = configuredUserIds(process.env.MODERATION_LEGAL_USER_IDS);
    return Promise.all(
      [...recipients].map((recipientId) => createNotification({
        ...base,
        recipientId,
        type: "content_under_review",
        title: "Conteúdo escalado para o jurídico/DPO",
        text: "Foi bloqueado conteúdo com suspeita de infração grave. Consulte o processo restrito.",
        data: {
          reason: payload.reason,
          contentType: payload.contentType,
          contentId: payload.contentId,
          legalEscalation: true,
        },
        dedupeKey: `legal-escalation:${payload.contentType}:${payload.contentId}:${recipientId}`,
      }))
    );
  }
  if (event.name === "comment.approved") {
    const recipients = new Map();
    if (payload.postAuthorId) recipients.set(Number(payload.postAuthorId), "comment_on_post");
    if (payload.parentAuthorId) recipients.set(Number(payload.parentAuthorId), "reply_to_my_comment");
    const [watchers] = await DATABASE.query(
      `SELECT ed_post_watcher_user_id AS userId
         FROM post_watchers
        WHERE BINARY ed_post_watcher_institute_code = BINARY ?
          AND ed_post_watcher_post_uid = ?
          AND ed_post_watcher_muted = 0`,
      [event.instituteCode, payload.postId]
    );
    watchers.forEach((watcher) => {
      if (!recipients.has(Number(watcher.userId))) {
        recipients.set(Number(watcher.userId), "comment_on_interacted_post");
      }
    });
    const output = [];
    for (const [recipientId, type] of recipients) {
      if (Number(recipientId) === Number(payload.actorId)) continue;
      output.push(await createNotification({
        ...base,
        recipientId,
        type,
        title: type === "reply_to_my_comment"
          ? `${payload.actorName || "Alguém"} respondeu ao teu comentário`
          : `${payload.actorName || "Alguém"} comentou numa publicação`,
        text: payload.excerpt || "Há um novo comentário.",
        groupKey: `comment:${payload.postId}:${recipientId}`,
        groupAction: "comentaram",
        dedupeKey: `comment:${payload.commentId}:${recipientId}`,
      }));
    }
    return output.filter(Boolean);
  }
  if (event.name === "reaction.created") {
    return createNotification({
      ...base,
      recipientId: payload.postAuthorId,
      type: "reaction_on_my_post",
      title: `${payload.actorName || "Alguém"} reagiu à tua publicação`,
      text: `Reação: ${payload.reaction || "Adoro"}`,
      groupKey: `reaction:${payload.postId}:${payload.postAuthorId}`,
      groupAction: "reagiram",
      dedupeKey: `reaction:${payload.postId}:${payload.actorId}:${payload.reaction}`,
    });
  }
  if (event.name === "user.followed") {
    return createNotification({
      ...base,
      recipientId: payload.followedId,
      type: "new_follower",
      title: `${payload.actorName || "Alguém"} começou a seguir-te`,
      text: "Tens um novo seguidor.",
      groupKey: `follow:${payload.followedId}`,
      groupAction: "começaram a seguir-te",
      dedupeKey: `follow:${payload.actorId}:${payload.followedId}`,
    });
  }
  return null;
}

module.exports = {
  createNotification,
  deleteNotification,
  groupedActorCount,
  groupedActors,
  handleDomainEvent,
  listNotifications,
  markAllRead,
  markRead,
  mutePostWatcher,
  unreadCount,
  watchPost,
};
