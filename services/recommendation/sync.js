"use strict";

const { DATABASE } = require("../../config/Database");
const { gorseClient } = require("./gorseClient");
const { recommendationQueue } = require("./queue");
const { safeDecryptContent } = require("../../shared/contentCrypto");

const USER_SYNC_TTL_MS = 5 * 60 * 1000;
const userSyncTimes = new Map();

const encodeIdPart = (value) => encodeURIComponent(String(value || ""));

function gorseUserId(instituteCode, userId) {
  return `u:${encodeIdPart(instituteCode)}:${Number(userId)}`;
}

function gorsePostId(instituteCode, postId) {
  return `p:${encodeIdPart(instituteCode)}:${Number(postId)}`;
}

function parseGorseId(value, prefix) {
  const match = String(value || "").match(
    new RegExp(`^${prefix}:([^:]+):(\\d+)$`)
  );
  if (!match) return null;
  try {
    return {
      instituteCode: decodeURIComponent(match[1]),
      id: Number(match[2]),
    };
  } catch {
    return null;
  }
}

function plainText(value, max = 240) {
  return String(value || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

function category(value) {
  return plainText(value, 100)
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/gi, "-")
    .replace(/^-+|-+$/g, "");
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

async function loadGorseUser(ctx, userId) {
  const [rows] = await DATABASE.query(
    `SELECT ua.ed_user_account_id AS id,
            ua.ed_user_account_name AS name,
            ua.ed_user_account_email AS email,
            ua.ed_user_account_picture AS picture,
            ua.ed_user_account_type AS accountType,
            ua.ed_user_account_country AS country,
            e.ed_employee_id AS employeeId,
            e.ed_employee_name AS employeeName,
            e.ed_employee_charge AS role,
            e.ed_employee_location AS location,
            e.ed_employee_department AS departmentId,
            d.ed_department_title AS department
       FROM eduall_user_accounts ua
       LEFT JOIN eduall_user_institutes ui
         ON ui.ed_user_institute_userCode = ua.ed_user_account_id
        AND BINARY ui.ed_user_institute_code = BINARY ?
        AND ui.ed_user_institute_deleted = 0
       LEFT JOIN eduall_employees e
         ON e.ed_employee_id = ui.ed_user_institute_employeeCode
        AND BINARY e.ed_employee_institute_code = BINARY ?
        AND e.ed_employee_deleted = 0
       LEFT JOIN eduall_department d
         ON d.ed_department_id = e.ed_employee_department
        AND d.ed_department_deleted = 0
      WHERE ua.ed_user_account_id = ?
        AND ua.ed_user_account_deleted = 0
      LIMIT 1`,
    [ctx.instituteCode, ctx.instituteCode, userId]
  );
  const user = rows[0];
  if (!user) return null;

  const [groups] = await DATABASE.query(
    `SELECT DISTINCT c.ed_hr_chat_conversation_id AS id,
            c.ed_hr_chat_conversation_name AS name
       FROM eduall_hr_chat_participants p
       JOIN eduall_hr_chat_conversations c
         ON c.ed_hr_chat_conversation_id = p.ed_hr_chat_participant_conversation_id
        AND BINARY c.ed_hr_chat_conversation_institute_code = BINARY ?
       WHERE p.ed_hr_chat_participant_user_id = ?
         AND p.ed_hr_chat_participant_deleted = 0
         AND c.ed_hr_chat_conversation_type = 'group'
         AND c.ed_hr_chat_conversation_deleted = 0
       LIMIT 100`,
    [ctx.instituteCode, userId]
  ).catch(() => [[]]);

  const [follows] = await DATABASE.query(
    `SELECT ed_hr_user_follow_followed_id AS id
       FROM eduall_hr_user_follows
      WHERE BINARY ed_hr_user_follow_institute_code = BINARY ?
        AND ed_hr_user_follow_follower_id = ?
        AND ed_hr_user_follow_deleted = 0
      LIMIT 500`,
    [ctx.instituteCode, userId]
  ).catch(() => [[]]);

  const [preferences] = await DATABASE.query(
    `SELECT ed_hr_rec_pref_interests AS interests
       FROM eduall_hr_recommendation_preferences
      WHERE BINARY ed_hr_rec_pref_institute_code = BINARY ?
        AND ed_hr_rec_pref_user_id = ?
      LIMIT 1`,
    [ctx.instituteCode, userId]
  ).catch(() => [[]]);

  let userInterests = preferences[0]?.interests;
  if (typeof userInterests === "string") {
    try { userInterests = JSON.parse(userInterests); } catch { userInterests = []; }
  }

  return {
    user,
    groups,
    follows,
    interests: Array.isArray(userInterests) ? userInterests : [],
  };
}

function buildGorseUser(ctx, record, instituteCode = ctx.instituteCode) {
  const { user, groups, follows, interests = [] } = record;
  return {
    UserId: gorseUserId(instituteCode, user.id),
    Labels: {
      tenant: instituteCode,
      name: user.name || user.employeeName || "Utilizador",
      email: user.email || "",
      employee: user.employeeId ? "true" : "false",
      role: user.role || "",
      department: user.department || "",
      location: user.location || "",
      country: user.country || "",
      groups: groups.map((group) => String(group.id)),
      follows: follows.map((follow) => String(follow.id)),
      interests: interests.map((interest) => String(interest).toLowerCase()),
      account_type: String(user.accountType || 0),
    },
    Comment: plainText(
      [user.name || user.employeeName, user.role, user.department, user.location]
        .filter(Boolean)
        .join(" · "),
      500
    ),
  };
}

async function syncUserNow(ctx, userId = ctx.userId) {
  const record = await loadGorseUser(ctx, userId);
  if (!record) return null;
  const user = buildGorseUser(ctx, record);
  await gorseClient.insertUsers([user]);
  return user;
}

function scheduleUserSync(ctx, userId = ctx.userId, options = {}) {
  const key = `${ctx.instituteCode}:${userId}`;
  const last = userSyncTimes.get(key) || 0;
  if (!options.force && Date.now() - last < USER_SYNC_TTL_MS) return false;
  userSyncTimes.set(key, Date.now());
  return recommendationQueue.enqueue(`user:${key}`, async () => {
    try {
      await syncUserNow(ctx, userId);
    } catch (error) {
      userSyncTimes.delete(key);
      throw error;
    }
  });
}

async function scheduleEmployeeUserSync(ctx, employeeId) {
  const [rows] = await DATABASE.query(
    `SELECT ed_user_institute_userCode AS userId
       FROM eduall_user_institutes
      WHERE BINARY ed_user_institute_code = BINARY ?
        AND ed_user_institute_employeeCode = ?
        AND ed_user_institute_deleted = 0
      LIMIT 1`,
    [ctx.instituteCode, Number(employeeId)]
  );
  if (rows[0]?.userId) scheduleUserSync(ctx, Number(rows[0].userId));
}

function extractHashtags(value) {
  const matches = String(value || "").match(/#[\p{L}\p{N}_-]+/gu) || [];
  return unique(matches.map((tag) => tag.slice(1).toLowerCase())).slice(0, 30);
}

async function loadGorseItem(ctx, postId) {
  const [rows] = await DATABASE.query(
    `SELECT p.ed_hr_post_uid AS id,
            p.ed_post_description AS content,
            COALESCE(p.ed_post_publish_at, p.ed_post_registerdate) AS createdAt,
            p.ed_post_visibility AS visibility,
            p.ed_post_attachments AS attachments,
            p.ed_post_background AS background,
            p.ed_post_feeling AS feeling,
            p.ed_post_location AS location,
            p.ed_post_deleted AS deleted,
            p.ed_post_kind AS kind,
            p.ed_post_author_employee AS employeeId,
            COALESCE(ua.ed_user_account_name, e.ed_employee_name, 'Utilizador') AS authorName,
            e.ed_employee_department AS departmentId,
            d.ed_department_title AS department
       FROM eduall_posts p
       LEFT JOIN eduall_user_accounts ua
         ON ua.ed_user_account_id = p.ed_post_user
        AND ua.ed_user_account_deleted = 0
       LEFT JOIN eduall_employees e
         ON e.ed_employee_id = p.ed_post_author_employee
        AND BINARY e.ed_employee_institute_code = BINARY p.ed_post_institute_code
        AND e.ed_employee_deleted = 0
       LEFT JOIN eduall_department d
         ON d.ed_department_id = e.ed_employee_department
        AND d.ed_department_deleted = 0
      WHERE p.ed_hr_post_uid = ?
        AND BINARY p.ed_post_institute_code = BINARY ?
        AND p.ed_post_kind = 'community'
        AND p.ed_post_moderation_status = 'approved'
        AND (p.ed_post_publish_at IS NULL OR p.ed_post_publish_at <= NOW())
      LIMIT 1`,
    [Number(postId), ctx.instituteCode]
  );
  return rows[0] || null;
}

function buildGorseItem(ctx, item, instituteCode = ctx.instituteCode) {
  const plainContent = safeDecryptContent(item.content || "");
  const title = plainText(plainContent, 180) || `Publicação ${item.id}`;
  const categories = unique([
    "post",
    category(`type-${item.kind || "community"}`),
    category(`tenant-${instituteCode}`),
    category(`author-${item.authorName}`),
    category(`visibility-${item.visibility}`),
    category(`department-${item.department || item.departmentId || "sem-departamento"}`),
    category(`feeling-${item.feeling || "sem-sentimento"}`),
    ...extractHashtags(plainContent).map((tag) => category(`tag-${tag}`)),
  ]);
  return {
    ItemId: gorsePostId(instituteCode, item.id),
    IsHidden: Boolean(Number(item.deleted)),
    Categories: categories,
    Timestamp: new Date(item.createdAt || Date.now()).toISOString(),
    Labels: {
      tenant: instituteCode,
      title,
      author: item.authorName,
      author_id: item.employeeId ? String(item.employeeId) : "",
      department: item.department || "",
      visibility: item.visibility || "institute",
      feeling: item.feeling || "",
      location: item.location || "",
      hashtags: extractHashtags(plainContent),
      has_media: item.attachments && item.attachments !== "[]" ? "true" : "false",
    },
    Comment: title,
  };
}

async function syncPostNow(ctx, postId) {
  const item = await loadGorseItem(ctx, postId);
  if (!item) return null;
  const gorseItem = buildGorseItem(ctx, item);
  await gorseClient.insertItems([gorseItem]);
  return gorseItem;
}

function schedulePostSync(ctx, postId) {
  return recommendationQueue.enqueue(`post:${ctx.instituteCode}:${postId}`, () => (
    syncPostNow(ctx, postId)
  ));
}

function schedulePostHidden(ctx, postId) {
  const itemId = gorsePostId(ctx.instituteCode, postId);
  return recommendationQueue.enqueue(`post-hide:${itemId}`, () => (
    gorseClient.patchItem(itemId, { IsHidden: true })
  ));
}

function scheduleFeedback(ctx, type, postId, options = {}) {
  const feedback = [{
    FeedbackType: String(type),
    UserId: gorseUserId(ctx.instituteCode, ctx.userId),
    ItemId: gorsePostId(ctx.instituteCode, postId),
    Value: Number(options.value ?? 1),
    Timestamp: new Date(options.timestamp || Date.now()).toISOString(),
    Comment: plainText(options.comment, 500),
  }];
  return recommendationQueue.enqueue(
    `feedback:${ctx.instituteCode}:${ctx.userId}:${type}:${postId}`,
    () => gorseClient.insertFeedback(feedback, { overwrite: true })
  );
}

function scheduleFeedbackRemoval(ctx, type, postId) {
  return recommendationQueue.enqueue(
    `feedback-remove:${ctx.instituteCode}:${ctx.userId}:${type}:${postId}`,
    () => gorseClient.deleteFeedback(
      gorseUserId(ctx.instituteCode, ctx.userId),
      gorsePostId(ctx.instituteCode, postId),
      type
    )
  );
}

function scheduleFollowSync(ctx, followedUserId) {
  recommendationQueue.enqueue(
    `user-follow:${ctx.instituteCode}:${ctx.userId}`,
    () => syncUserNow(ctx, ctx.userId)
  );
  recommendationQueue.enqueue(
    `user-followed:${ctx.instituteCode}:${followedUserId}`,
    () => syncUserNow(ctx, followedUserId)
  );
}

module.exports = {
  buildGorseItem,
  buildGorseUser,
  gorsePostId,
  gorseUserId,
  loadGorseItem,
  loadGorseUser,
  parseGorseId,
  scheduleFeedback,
  scheduleFeedbackRemoval,
  scheduleEmployeeUserSync,
  scheduleFollowSync,
  schedulePostHidden,
  schedulePostSync,
  scheduleUserSync,
  syncPostNow,
  syncUserNow,
};
