"use strict";

const { DATABASE } = require("../config/Database");
const { safeDecryptContent } = require("../shared/contentCrypto");
const { cleanText } = require("../hr/rules");
const { analyzeTextRules } = require("./textRules");
const { termsForInstitute } = require("./terms");
const { recordDomainEvent } = require("./domainEvents");
const recommendationSync = require("../services/recommendation/sync");
const { storage } = require("../storage");
const { quarantineContentMedia } = require("./processor");
const {
  requireLegalEscalation,
  requireModerator,
} = require("../hr/moderationAccess");

const STATUSES = new Set(["pending", "approved", "rejected", "needs_review"]);
const CONTENT_TYPES = new Set(["post", "comment", "story", "avatar"]);
const REPORT_TYPES = new Set(["post", "comment"]);

function fail(status, code, message) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  throw error;
}

function parseJson(value, fallback) {
  try {
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
}

function pathBasename(value) {
  return String(value || "").split(/[\\/]/).pop().slice(0, 180);
}

function decodedBasename(value) {
  const raw = pathBasename(value);
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

async function synchronousCommentRules(ctx, text) {
  const terms = await termsForInstitute(ctx.instituteCode);
  return analyzeTextRules(text, terms);
}

async function tableFor(contentType) {
  if (!CONTENT_TYPES.has(contentType)) fail(422, "MODERATION_CONTENT_TYPE_INVALID", "Tipo de conteúdo inválido.");
  if (contentType === "post") {
    return {
        table: "eduall_posts",
        id: "ed_hr_post_uid",
        institute: "ed_post_institute_code",
        user: "ed_post_user",
        status: "ed_post_moderation_status",
        reason: "ed_post_moderation_reason",
        reviewRequested: "ed_post_moderation_review_requested_at",
        deleted: "ed_post_deleted",
        date: "ed_post_registerdate",
      };
  }
  if (contentType === "comment") {
    return {
        table: "eduall_post_comments",
        id: "ed_post_comment_uid",
        institute: "ed_post_comment_institute_code",
        user: "ed_post_comment_user",
        status: "ed_post_comment_moderation_status",
        reason: "ed_post_comment_moderation_reason",
        reviewRequested: "ed_post_comment_moderation_review_requested_at",
        deleted: "ed_post_comment_deleted",
        date: "ed_post_comment_registerDate",
      };
  }
  if (contentType === "story") {
    return {
      table: "eduall_hr_stories",
      id: "ed_hr_story_id",
      institute: "ed_hr_story_institute_code",
      user: "ed_hr_story_user_id",
      status: "ed_hr_story_moderation_status",
      reason: "ed_hr_story_moderation_reason",
      reviewRequested: "ed_hr_story_moderation_review_requested_at",
      deleted: "ed_hr_story_deleted",
      date: "ed_hr_story_created_at",
    };
  }
  return {
    table: "eduall_hr_chat_conversations",
    id: "ed_hr_chat_conversation_id",
    institute: "ed_hr_chat_conversation_institute_code",
    user: "ed_hr_chat_conversation_created_by",
    status: "ed_hr_chat_conversation_picture_moderation_status",
    reason: "ed_hr_chat_conversation_picture_moderation_reason",
    reviewRequested: "ed_hr_chat_conversation_picture_review_requested_at",
    deleted: "ed_hr_chat_conversation_deleted",
    date: "ed_hr_chat_conversation_updated_at",
  };
}

async function setStatus(contentType, instituteCode, contentId, status, reason = null) {
  if (!STATUSES.has(status)) fail(422, "MODERATION_STATUS_INVALID", "Estado de moderação inválido.");
  const target = await tableFor(contentType);
  await DATABASE.query(
    `UPDATE ${target.table}
        SET ${target.status} = ?, ${target.reason} = ?
      WHERE ${target.id} = ? AND BINARY ${target.institute} = BINARY ? AND ${target.deleted} = 0`,
    [status, cleanText(reason, 1000) || null, Number(contentId), instituteCode]
  );
}

async function listQueue(ctx, query = {}) {
  requireModerator(ctx);
  const status = STATUSES.has(query.status) ? query.status : "needs_review";
  const limit = Math.max(1, Math.min(100, Number(query.limit) || 30));
  const [postRows] = await DATABASE.query(
    `SELECT p.ed_hr_post_uid AS id, 'post' AS contentType,
            p.ed_post_description AS text, p.ed_post_attachments AS attachments,
            p.ed_post_moderation_status AS status,
            p.ed_post_moderation_reason AS reason,
            p.ed_post_moderation_review_requested_at AS reviewRequestedAt,
            p.ed_post_registerdate AS createdAt,
            p.ed_post_user AS authorId,
            COALESCE(ua.ed_user_account_name, e.ed_employee_name, 'Utilizador') AS authorName,
            (SELECT COUNT(*) FROM content_reports r
              WHERE BINARY r.ed_content_report_institute_code = BINARY p.ed_post_institute_code
                AND r.ed_content_report_content_type = 'post'
                AND r.ed_content_report_content_id = p.ed_hr_post_uid
                AND r.ed_content_report_status = 'OPEN') AS reportCount
       FROM eduall_posts p
       LEFT JOIN eduall_user_accounts ua ON ua.ed_user_account_id = p.ed_post_user
       LEFT JOIN eduall_employees e
         ON e.ed_employee_id = p.ed_post_author_employee
        AND BINARY e.ed_employee_institute_code = BINARY p.ed_post_institute_code
      WHERE BINARY p.ed_post_institute_code = BINARY ?
        AND p.ed_post_deleted = 0
        AND p.ed_post_moderation_status = ?
      ORDER BY p.ed_post_moderation_review_requested_at IS NOT NULL DESC,
               p.ed_post_registerdate ASC
      LIMIT ?`,
    [ctx.instituteCode, status, limit]
  );
  const [commentRows] = await DATABASE.query(
    `SELECT c.ed_post_comment_uid AS id, 'comment' AS contentType,
            c.ed_post_comment_text AS text, '[]' AS attachments,
            c.ed_post_comment_moderation_status AS status,
            c.ed_post_comment_moderation_reason AS reason,
            c.ed_post_comment_moderation_review_requested_at AS reviewRequestedAt,
            c.ed_post_comment_registerDate AS createdAt,
            c.ed_post_comment_post_uid AS postId,
            c.ed_post_comment_user AS authorId,
            COALESCE(ua.ed_user_account_name, e.ed_employee_name, 'Utilizador') AS authorName,
            (SELECT COUNT(*) FROM content_reports r
              WHERE BINARY r.ed_content_report_institute_code = BINARY c.ed_post_comment_institute_code
                AND r.ed_content_report_content_type = 'comment'
                AND r.ed_content_report_content_id = c.ed_post_comment_uid
                AND r.ed_content_report_status = 'OPEN') AS reportCount
       FROM eduall_post_comments c
       LEFT JOIN eduall_user_accounts ua ON ua.ed_user_account_id = c.ed_post_comment_user
       LEFT JOIN eduall_user_institutes ui
         ON ui.ed_user_institute_userCode = c.ed_post_comment_user
        AND BINARY ui.ed_user_institute_code = BINARY c.ed_post_comment_institute_code
        AND ui.ed_user_institute_deleted = 0
       LEFT JOIN eduall_employees e
         ON e.ed_employee_id = ui.ed_user_institute_employeeCode
        AND BINARY e.ed_employee_institute_code = BINARY c.ed_post_comment_institute_code
      WHERE BINARY c.ed_post_comment_institute_code = BINARY ?
        AND c.ed_post_comment_deleted = 0
        AND c.ed_post_comment_moderation_status = ?
      ORDER BY c.ed_post_comment_moderation_review_requested_at IS NOT NULL DESC,
               c.ed_post_comment_registerDate ASC
      LIMIT ?`,
    [ctx.instituteCode, status, limit]
  );
  const [storyRows] = await DATABASE.query(
    `SELECT s.ed_hr_story_id AS id, 'story' AS contentType,
            s.ed_hr_story_slides AS slides,
            s.ed_hr_story_moderation_status AS status,
            s.ed_hr_story_moderation_reason AS reason,
            s.ed_hr_story_moderation_review_requested_at AS reviewRequestedAt,
            s.ed_hr_story_created_at AS createdAt,
            s.ed_hr_story_user_id AS authorId,
            COALESCE(ua.ed_user_account_name, e.ed_employee_name, 'Utilizador') AS authorName
       FROM eduall_hr_stories s
       LEFT JOIN eduall_user_accounts ua ON ua.ed_user_account_id = s.ed_hr_story_user_id
       LEFT JOIN eduall_user_institutes ui
         ON ui.ed_user_institute_userCode = s.ed_hr_story_user_id
        AND BINARY ui.ed_user_institute_code = BINARY s.ed_hr_story_institute_code
        AND ui.ed_user_institute_deleted = 0
       LEFT JOIN eduall_employees e
         ON e.ed_employee_id = ui.ed_user_institute_employeeCode
        AND BINARY e.ed_employee_institute_code = BINARY s.ed_hr_story_institute_code
      WHERE BINARY s.ed_hr_story_institute_code = BINARY ?
        AND s.ed_hr_story_deleted = 0
        AND s.ed_hr_story_moderation_status = ?
      ORDER BY s.ed_hr_story_moderation_review_requested_at IS NOT NULL DESC,
               s.ed_hr_story_created_at ASC
      LIMIT ?`,
    [ctx.instituteCode, status, limit]
  );
  const [avatarRows] = await DATABASE.query(
    `SELECT c.ed_hr_chat_conversation_id AS id, 'avatar' AS contentType,
            c.ed_hr_chat_conversation_pending_picture AS picture,
            c.ed_hr_chat_conversation_picture_moderation_status AS status,
            c.ed_hr_chat_conversation_picture_moderation_reason AS reason,
            c.ed_hr_chat_conversation_picture_review_requested_at AS reviewRequestedAt,
            c.ed_hr_chat_conversation_updated_at AS createdAt,
            c.ed_hr_chat_conversation_created_by AS authorId,
            COALESCE(ua.ed_user_account_name, 'Utilizador') AS authorName
       FROM eduall_hr_chat_conversations c
       LEFT JOIN eduall_user_accounts ua
         ON ua.ed_user_account_id = c.ed_hr_chat_conversation_created_by
      WHERE BINARY c.ed_hr_chat_conversation_institute_code = BINARY ?
        AND c.ed_hr_chat_conversation_deleted = 0
        AND c.ed_hr_chat_conversation_type = 'group'
        AND c.ed_hr_chat_conversation_pending_picture IS NOT NULL
        AND c.ed_hr_chat_conversation_picture_moderation_status = ?
      ORDER BY c.ed_hr_chat_conversation_picture_review_requested_at IS NOT NULL DESC,
               c.ed_hr_chat_conversation_updated_at ASC
      LIMIT ?`,
    [ctx.instituteCode, status, limit]
  );
  const items = [...postRows, ...commentRows, ...storyRows, ...avatarRows]
    .map((row) => ({
      ...row,
      id: Number(row.id),
      postId: row.postId ? Number(row.postId) : Number(row.id),
      authorId: Number(row.authorId),
      reportCount: Number(row.reportCount || 0),
      text: safeDecryptContent(row.text || ""),
      attachments: row.picture
        ? [{
            type: "image",
            name: "avatar-do-grupo",
            mime: "image/jpeg",
            storageKey: decodedBasename(row.picture),
            url: row.picture,
          }]
        : row.slides
          ? parseJson(row.slides, []).map((slide, index) => ({
              type: slide.type === "video" ? "video" : "image",
              name: `story-${index + 1}`,
              storageKey: pathBasename(slide.storageKey),
              url: `/api/hr/feed/story-media/${encodeURIComponent(pathBasename(slide.storageKey))}`,
              poster: slide.posterKey ? {
                storageKey: pathBasename(slide.posterKey),
                url: `/api/hr/feed/story-media/${encodeURIComponent(pathBasename(slide.posterKey))}`,
              } : null,
            }))
          : parseJson(row.attachments, []),
    }))
    .sort((a, b) => {
      if (a.reviewRequestedAt && !b.reviewRequestedAt) return -1;
      if (!a.reviewRequestedAt && b.reviewRequestedAt) return 1;
      return String(a.createdAt).localeCompare(String(b.createdAt));
    })
    .slice(0, limit);
  if (items.length) {
    const postIds = items.filter((item) => item.contentType === "post").map((item) => item.id);
    const commentIds = items.filter((item) => item.contentType === "comment").map((item) => item.id);
    const predicates = [];
    const params = [ctx.instituteCode];
    if (postIds.length) {
      predicates.push(`(ed_moderation_result_content_type = 'post'
        AND ed_moderation_result_content_id IN (${postIds.map(() => "?").join(",")}))`);
      params.push(...postIds);
    }
    if (commentIds.length) {
      predicates.push(`(ed_moderation_result_content_type = 'comment'
        AND ed_moderation_result_content_id IN (${commentIds.map(() => "?").join(",")}))`);
      params.push(...commentIds);
    }
    const [analysisRows] = await DATABASE.query(
      `SELECT ed_moderation_result_content_type AS contentType,
              ed_moderation_result_content_id AS contentId,
              ed_moderation_result_media_index AS mediaIndex,
              ed_moderation_result_frame_timestamp AS frameTimestamp,
              ed_moderation_result_analyzer AS analyzer,
              ed_moderation_result_model AS model,
              ed_moderation_result_scores AS scores,
              ed_moderation_result_metadata AS metadata,
              ed_moderation_result_decision AS decision,
              ed_moderation_result_reason AS reason,
              ed_moderation_result_attempt AS attempt,
              ed_moderation_result_created_at AS createdAt
         FROM moderation_results
        WHERE BINARY ed_moderation_result_institute_code = BINARY ?
          AND (${predicates.join(" OR ")})
        ORDER BY ed_moderation_result_attempt DESC, ed_moderation_result_id DESC`,
      params
    );
    const byContent = new Map();
    analysisRows.forEach((row) => {
      const key = `${row.contentType}:${Number(row.contentId)}`;
      const current = byContent.get(key);
      if (!current || Number(row.attempt) === current.attempt) {
        const list = current && Number(row.attempt) === current.attempt
          ? current.analysis
          : [];
        list.push({
          mediaIndex: row.mediaIndex == null ? null : Number(row.mediaIndex),
          frameTimestamp: row.frameTimestamp == null ? null : Number(row.frameTimestamp),
          analyzer: row.analyzer,
          model: row.model,
          scores: parseJson(row.scores, {}),
          metadata: parseJson(row.metadata, {}),
          decision: row.decision,
          reason: row.reason,
          createdAt: row.createdAt,
        });
        byContent.set(key, { attempt: Number(row.attempt), analysis: list });
      }
    });
    items.forEach((item) => {
      item.analysis = byContent.get(`${item.contentType}:${item.id}`)?.analysis || [];
    });
    const mediaParams = [ctx.instituteCode];
    const mediaPredicates = [];
    if (postIds.length) {
      mediaPredicates.push(`(ed_moderation_media_content_type = 'post'
        AND ed_moderation_media_content_id IN (${postIds.map(() => "?").join(",")}))`);
      mediaParams.push(...postIds);
    }
    if (commentIds.length) {
      mediaPredicates.push(`(ed_moderation_media_content_type = 'comment'
        AND ed_moderation_media_content_id IN (${commentIds.map(() => "?").join(",")}))`);
      mediaParams.push(...commentIds);
    }
    if (mediaPredicates.length) {
      const [mediaRows] = await DATABASE.query(
        `SELECT ed_moderation_media_content_type AS contentType,
                ed_moderation_media_content_id AS contentId,
                ed_moderation_media_attachment_index AS mediaIndex,
                ed_moderation_media_status AS status,
                ed_moderation_media_reason AS reason,
                ed_moderation_media_worst_timestamp AS worstTimestamp,
                ed_moderation_media_preview_key AS previewKey,
                ed_moderation_media_quarantine_until AS quarantineUntil
           FROM moderation_media
          WHERE BINARY ed_moderation_media_institute_code = BINARY ?
            AND (${mediaPredicates.join(" OR ")})
          ORDER BY ed_moderation_media_attachment_index ASC`,
        mediaParams
      );
      const byContent = new Map();
      mediaRows.forEach((row) => {
        const key = `${row.contentType}:${Number(row.contentId)}`;
        const list = byContent.get(key) || [];
        list.push({
          ...row,
          mediaIndex: Number(row.mediaIndex),
          worstTimestamp: row.worstTimestamp == null ? null : Number(row.worstTimestamp),
          previewUrl: row.previewKey ? `/api/hr/moderation/preview/${row.previewKey}` : null,
        });
        byContent.set(key, list);
      });
      items.forEach((item) => {
        item.mediaModeration = byContent.get(`${item.contentType}:${item.id}`) || [];
      });
    }
  }
  return { items, status };
}

async function reviewContent(ctx, contentType, contentId, input) {
  requireModerator(ctx);
  const decision = input?.decision === "approve"
    ? "approved"
    : input?.decision === "reject" ? "rejected" : null;
  if (!decision) fail(422, "MODERATION_DECISION_INVALID", "Escolha aprovar ou rejeitar.");
  const reason = cleanText(input?.reason, 1000) || null;
  if (decision === "rejected" && !reason) {
    fail(422, "MODERATION_REVIEW_REASON_REQUIRED", "Indique o motivo da rejeição.");
  }
  const target = await tableFor(contentType);
  const [rows] = await DATABASE.query(
    `SELECT ${target.id} AS id, ${target.user} AS userId, ${target.status} AS status
       FROM ${target.table}
      WHERE ${target.id} = ? AND BINARY ${target.institute} = BINARY ? AND ${target.deleted} = 0
      LIMIT 1`,
    [Number(contentId), ctx.instituteCode]
  );
  if (!rows.length) fail(404, "MODERATION_CONTENT_NOT_FOUND", "Conteúdo não encontrado.");
  const connection = await DATABASE.getConnection();
  let publishAt = null;
  try {
    await connection.beginTransaction();
    await connection.query(
      `UPDATE ${target.table}
          SET ${target.status} = ?, ${target.reason} = ?
        WHERE ${target.id} = ?`,
      [decision, reason, Number(contentId)]
    );
    if (contentType === "story") {
      await connection.query(
        `UPDATE eduall_hr_story_media
            SET ed_hr_story_media_moderation_status = ?
          WHERE BINARY ed_hr_story_media_institute_code = BINARY ?
            AND ed_hr_story_media_story_id = ?`,
        [decision, ctx.instituteCode, Number(contentId)]
      );
    } else if (contentType === "avatar" && decision === "approved") {
      await connection.query(
        `UPDATE eduall_hr_chat_conversations
            SET ed_hr_chat_conversation_picture =
                  ed_hr_chat_conversation_pending_picture,
                ed_hr_chat_conversation_pending_picture = NULL,
                ed_hr_chat_conversation_updated_at = NOW()
          WHERE ed_hr_chat_conversation_id = ?
            AND BINARY ed_hr_chat_conversation_institute_code = BINARY ?`,
        [Number(contentId), ctx.instituteCode]
      );
    }
    await connection.query(
      `INSERT INTO moderation_reviews (
         ed_moderation_review_institute_code,
         ed_moderation_review_content_type,
         ed_moderation_review_content_id,
         ed_moderation_review_reviewer_id,
         ed_moderation_review_decision,
         ed_moderation_review_notes
       ) VALUES (?, ?, ?, ?, ?, ?)`,
      [ctx.instituteCode, contentType, Number(contentId), ctx.userId, decision, reason]
    );
    await connection.query(
      `UPDATE content_reports SET ed_content_report_status = 'RESOLVED'
        WHERE BINARY ed_content_report_institute_code = BINARY ?
          AND ed_content_report_content_type = ?
          AND ed_content_report_content_id = ?
          AND ed_content_report_status = 'OPEN'`,
      [ctx.instituteCode, contentType, Number(contentId)]
    );
    await connection.query(
      `UPDATE moderation_media
          SET ed_moderation_media_status = ?
        WHERE BINARY ed_moderation_media_institute_code = BINARY ?
          AND ed_moderation_media_content_type = ?
          AND ed_moderation_media_content_id = ?`,
      [decision, ctx.instituteCode, contentType, Number(contentId)]
    );
    if (contentType === "post") {
      const [postRows] = await connection.query(
        `SELECT ed_post_publish_at AS publishAt
           FROM eduall_posts
          WHERE ed_hr_post_uid = ?
            AND BINARY ed_post_institute_code = BINARY ?
          LIMIT 1`,
        [Number(contentId), ctx.instituteCode]
      );
      publishAt = postRows[0]?.publishAt || null;
      const scheduledForFuture = decision === "approved"
        && publishAt
        && new Date(publishAt).getTime() > Date.now();
      if (scheduledForFuture) {
        await connection.commit();
        return {
          contentType,
          contentId: Number(contentId),
          decision,
          reason,
          scheduledForFuture: true,
        };
      }
      await recordDomainEvent(
        connection,
        ctx.instituteCode,
        decision === "approved" ? "post.approved" : "post.rejected",
        {
          actorId: ctx.userId,
          actorName: ctx.userName,
          authorId: Number(rows[0].userId),
          postId: Number(contentId),
          reason,
        }
      );
    } else if (decision === "approved") {
      const [commentRows] = await connection.query(
        `SELECT c.ed_post_comment_post_uid AS postId,
                c.ed_post_comment_parent_uid AS parentId,
                c.ed_post_comment_text AS text,
                c.ed_post_comment_user AS actorId,
                p.ed_post_user AS postAuthorId,
                parent.ed_post_comment_user AS parentAuthorId,
                COALESCE(ua.ed_user_account_name, e.ed_employee_name, 'Utilizador') AS actorName,
                COALESCE(ua.ed_user_account_picture, e.ed_employee_picture, '') AS actorAvatar
           FROM eduall_post_comments c
           JOIN eduall_posts p
             ON p.ed_hr_post_uid = c.ed_post_comment_post_uid
           LEFT JOIN eduall_post_comments parent
             ON parent.ed_post_comment_uid = c.ed_post_comment_parent_uid
           LEFT JOIN eduall_user_accounts ua
             ON ua.ed_user_account_id = c.ed_post_comment_user
           LEFT JOIN eduall_user_institutes ui
             ON ui.ed_user_institute_userCode = c.ed_post_comment_user
            AND BINARY ui.ed_user_institute_code = BINARY c.ed_post_comment_institute_code
            AND ui.ed_user_institute_deleted = 0
           LEFT JOIN eduall_employees e
             ON e.ed_employee_id = ui.ed_user_institute_employeeCode
            AND BINARY e.ed_employee_institute_code = BINARY c.ed_post_comment_institute_code
          WHERE c.ed_post_comment_uid = ? AND BINARY c.ed_post_comment_institute_code = BINARY ?
          LIMIT 1`,
        [Number(contentId), ctx.instituteCode]
      );
      const comment = commentRows[0];
      if (comment) {
        await connection.query(
          `INSERT INTO post_watchers (
             ed_post_watcher_institute_code, ed_post_watcher_post_uid,
             ed_post_watcher_user_id, ed_post_watcher_source
           ) VALUES (?, ?, ?, 'comment')
           ON DUPLICATE KEY UPDATE ed_post_watcher_updated_at = NOW()`,
          [ctx.instituteCode, comment.postId, comment.actorId]
        );
        await recordDomainEvent(connection, ctx.instituteCode, "comment.approved", {
          actorId: Number(comment.actorId),
          actorName: comment.actorName,
          actorAvatar: comment.actorAvatar,
          postId: Number(comment.postId),
          postAuthorId: Number(comment.postAuthorId),
          parentAuthorId: comment.parentAuthorId ? Number(comment.parentAuthorId) : null,
          commentId: Number(contentId),
          excerpt: safeDecryptContent(comment.text || "").slice(0, 180),
        });
      }
    } else {
      const [commentRows] = await connection.query(
        `SELECT c.ed_post_comment_post_uid AS postId,
                c.ed_post_comment_user AS authorId
           FROM eduall_post_comments c
          WHERE c.ed_post_comment_uid = ?
            AND BINARY c.ed_post_comment_institute_code = BINARY ?
          LIMIT 1`,
        [Number(contentId), ctx.instituteCode]
      );
      if (commentRows[0]) {
        await recordDomainEvent(connection, ctx.instituteCode, "comment.rejected", {
          actorId: ctx.userId,
          actorName: ctx.userName,
          actorAvatar: ctx.userPicture,
          authorId: Number(commentRows[0].authorId),
          postId: Number(commentRows[0].postId),
          commentId: Number(contentId),
          reason: reason || "O comentário não cumpre as regras da comunidade.",
        });
      }
    }
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
  if (
    contentType === "post"
    && decision === "approved"
    && (!publishAt || new Date(publishAt).getTime() <= Date.now())
  ) {
    await recommendationSync.syncPostNow({ instituteCode: ctx.instituteCode }, contentId).catch(() => {});
  } else if (contentType === "post" && decision === "rejected") {
    recommendationSync.schedulePostHidden({ instituteCode: ctx.instituteCode }, contentId);
  }
  if (decision === "rejected") {
    await quarantineContentMedia(ctx.instituteCode, contentType, Number(contentId));
  }
  return { contentType, contentId: Number(contentId), decision, reason };
}

async function requestReview(ctx, contentType, contentId) {
  const target = await tableFor(contentType);
  const [rows] = await DATABASE.query(
    `SELECT ${target.id} AS id, ${target.user} AS userId, ${target.status} AS status
       FROM ${target.table}
      WHERE ${target.id} = ? AND BINARY ${target.institute} = BINARY ? AND ${target.deleted} = 0
      LIMIT 1`,
    [Number(contentId), ctx.instituteCode]
  );
  if (!rows.length) fail(404, "MODERATION_CONTENT_NOT_FOUND", "Conteúdo não encontrado.");
  if (Number(rows[0].userId) !== Number(ctx.userId) && !ctx.isManager) {
    fail(403, "MODERATION_REVIEW_DENIED", "Não pode pedir revisão deste conteúdo.");
  }
  if (rows[0].status !== "rejected") {
    fail(409, "MODERATION_REVIEW_NOT_AVAILABLE", "Este conteúdo não está rejeitado.");
  }
  await DATABASE.query(
    `UPDATE ${target.table}
        SET ${target.status} = 'needs_review',
            ${target.reviewRequested} = NOW()
      WHERE ${target.id} = ?`,
    [Number(contentId)]
  );
  await DATABASE.query(
    `UPDATE moderation_media
        SET ed_moderation_media_status = 'needs_review'
      WHERE BINARY ed_moderation_media_institute_code = BINARY ?
        AND ed_moderation_media_content_type = ?
        AND ed_moderation_media_content_id = ?`,
    [ctx.instituteCode, contentType, Number(contentId)]
  );
  return { contentType, contentId: Number(contentId), status: "needs_review" };
}

async function reportContent(ctx, contentType, contentId, input) {
  if (!REPORT_TYPES.has(contentType)) fail(422, "MODERATION_REPORT_TYPE_INVALID", "Tipo inválido.");
  const reason = cleanText(input?.reason, 80) || "other";
  const details = cleanText(input?.details, 2000) || null;
  const target = await tableFor(contentType);
  const [contentRows] = await DATABASE.query(
    `SELECT ${target.id} AS id, ${target.user} AS userId,
            ${target.status} AS status
       FROM ${target.table}
      WHERE ${target.id} = ?
        AND BINARY ${target.institute} = BINARY ?
        AND ${target.deleted} = 0
      LIMIT 1`,
    [Number(contentId), ctx.instituteCode]
  );
  if (!contentRows.length) fail(404, "MODERATION_CONTENT_NOT_FOUND", "Conteúdo não encontrado.");
  if (String(contentRows[0].status || "approved") !== "approved") {
    fail(404, "MODERATION_CONTENT_NOT_FOUND", "Conteúdo não encontrado.");
  }
  if (Number(contentRows[0].userId) === Number(ctx.userId)) {
    fail(422, "MODERATION_SELF_REPORT", "Não pode denunciar o seu próprio conteúdo.");
  }
  const maxReportsPerDay = Math.max(
    1,
    Number(process.env.MODERATION_REPORTS_PER_USER_DAY) || 20
  );
  const [usageRows] = await DATABASE.query(
    `SELECT COUNT(*) AS total
       FROM content_reports
      WHERE BINARY ed_content_report_institute_code = BINARY ?
        AND ed_content_report_reporter_id = ?
        AND ed_content_report_created_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR)`,
    [ctx.instituteCode, ctx.userId]
  );
  if (Number(usageRows[0]?.total || 0) >= maxReportsPerDay) {
    fail(429, "MODERATION_REPORT_RATE_LIMIT", "Atingiu o limite diário de denúncias.");
  }
  const [beforeRows] = await DATABASE.query(
    `SELECT ed_content_report_status AS status
       FROM content_reports
      WHERE BINARY ed_content_report_institute_code = BINARY ?
        AND ed_content_report_content_type = ?
        AND ed_content_report_content_id = ?
        AND ed_content_report_reporter_id = ?
      LIMIT 1`,
    [ctx.instituteCode, contentType, Number(contentId), ctx.userId]
  );
  const alreadyReported = beforeRows[0]?.status === "OPEN";
  const [writeResult] = await DATABASE.query(
    `INSERT INTO content_reports (
       ed_content_report_institute_code, ed_content_report_content_type,
       ed_content_report_content_id, ed_content_report_reporter_id,
       ed_content_report_reason, ed_content_report_details
     ) VALUES (?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       ed_content_report_reason = VALUES(ed_content_report_reason),
       ed_content_report_details = VALUES(ed_content_report_details),
       ed_content_report_status = 'OPEN'`,
    [ctx.instituteCode, contentType, Number(contentId), ctx.userId, reason, details]
  );
  const [countRows] = await DATABASE.query(
    `SELECT COUNT(*) AS total FROM content_reports
      WHERE BINARY ed_content_report_institute_code = BINARY ?
        AND ed_content_report_content_type = ?
        AND ed_content_report_content_id = ?
        AND ed_content_report_status = 'OPEN'`,
    [ctx.instituteCode, contentType, Number(contentId)]
  );
  const reportCount = Number(countRows[0]?.total || 0);
  const threshold = Math.max(1, Number(process.env.MODERATION_REPORT_HIDE_THRESHOLD) || 3);
  const thresholdReached = reportCount >= threshold;
  const newlyHidden = thresholdReached
    && ["approved", "pending"].includes(String(contentRows[0].status || "approved"));
  if (newlyHidden) {
    await setStatus(contentType, ctx.instituteCode, contentId, "needs_review",
      `Ocultado automaticamente após ${reportCount} denúncias.`);
    if (contentType === "post") {
      recommendationSync.schedulePostHidden({ instituteCode: ctx.instituteCode }, contentId);
    }
    if (contentRows[0]?.userId) {
      const connection = await DATABASE.getConnection();
      try {
        await recordDomainEvent(connection, ctx.instituteCode, "report.threshold_reached", {
          actorId: ctx.userId,
          actorName: ctx.userName,
          authorId: Number(contentRows[0].userId),
          contentType,
          contentId: Number(contentId),
          reportCount,
          threshold,
        });
      } finally {
        connection.release();
      }
    }
  }
  return {
    contentType,
    contentId: Number(contentId),
    reportCount,
    hidden: thresholdReached,
    alreadyReported: Boolean(alreadyReported && !writeResult?.affectedRows),
  };
}

async function listReports(ctx) {
  requireModerator(ctx);
  const [rows] = await DATABASE.query(
    `SELECT r.ed_content_report_id AS id,
            r.ed_content_report_content_type AS contentType,
            r.ed_content_report_content_id AS contentId,
            r.ed_content_report_reason AS reason,
            r.ed_content_report_details AS details,
            r.ed_content_report_status AS status,
            r.ed_content_report_created_at AS createdAt,
            COALESCE(ua.ed_user_account_name, 'Utilizador') AS reporterName
       FROM content_reports r
       LEFT JOIN eduall_user_accounts ua
         ON ua.ed_user_account_id = r.ed_content_report_reporter_id
      WHERE BINARY r.ed_content_report_institute_code = BINARY ?
      ORDER BY r.ed_content_report_created_at DESC
      LIMIT 300`,
    [ctx.instituteCode]
  );
  return { items: rows };
}

async function listHistory(ctx) {
  requireModerator(ctx);
  const [rows] = await DATABASE.query(
    `SELECT r.ed_moderation_review_id AS id,
            r.ed_moderation_review_content_type AS contentType,
            r.ed_moderation_review_content_id AS contentId,
            r.ed_moderation_review_decision AS decision,
            r.ed_moderation_review_notes AS notes,
            r.ed_moderation_review_created_at AS createdAt,
            COALESCE(ua.ed_user_account_name, 'Moderador') AS reviewerName
       FROM moderation_reviews r
       LEFT JOIN eduall_user_accounts ua
         ON ua.ed_user_account_id = r.ed_moderation_review_reviewer_id
      WHERE BINARY r.ed_moderation_review_institute_code = BINARY ?
      ORDER BY r.ed_moderation_review_created_at DESC
      LIMIT 300`,
    [ctx.instituteCode]
  );
  return { items: rows };
}

async function moderationPreview(ctx, storageKey) {
  requireModerator(ctx);
  const [rows] = await DATABASE.query(
    `SELECT ed_moderation_media_preview_key AS storageKey,
            ed_moderation_media_worst_timestamp AS timestamp
       FROM moderation_media
      WHERE BINARY ed_moderation_media_institute_code = BINARY ?
        AND ed_moderation_media_preview_key = ?
      LIMIT 1`,
    [ctx.instituteCode, String(storageKey || "")]
  );
  if (!rows.length) fail(404, "MODERATION_PREVIEW_NOT_FOUND", "Frame de revisão não encontrado.");
  return {
    storageKey: rows[0].storageKey,
    timestamp: rows[0].timestamp == null ? null : Number(rows[0].timestamp),
  };
}

async function escalateContent(ctx, contentType, contentId, input = {}) {
  requireModerator(ctx);
  requireLegalEscalation(ctx);
  const target = await tableFor(contentType);
  const [rows] = await DATABASE.query(
    `SELECT ${target.id} AS id, ${target.user} AS userId,
            ${target.status} AS status
       FROM ${target.table}
      WHERE ${target.id} = ?
        AND BINARY ${target.institute} = BINARY ?
        AND ${target.deleted} = 0
      LIMIT 1`,
    [Number(contentId), ctx.instituteCode]
  );
  if (!rows.length) fail(404, "MODERATION_CONTENT_NOT_FOUND", "Conteúdo não encontrado.");
  const notes = cleanText(input.reason, 2000)
    || "";
  if (!notes) {
    fail(422, "MODERATION_LEGAL_REASON_REQUIRED", "Descreva a suspeita para o jurídico/DPO.");
  }
  const [copies] = await DATABASE.query(
    `SELECT ed_moderation_media_quarantine_key AS quarantineKey
       FROM moderation_media
      WHERE BINARY ed_moderation_media_institute_code = BINARY ?
        AND ed_moderation_media_content_type = ?
        AND ed_moderation_media_content_id = ?
        AND ed_moderation_media_quarantine_key IS NOT NULL`,
    [ctx.instituteCode, contentType, Number(contentId)]
  );
  const connection = await DATABASE.getConnection();
  try {
    await connection.beginTransaction();
    await connection.query(
      `UPDATE ${target.table}
          SET ${target.status} = 'rejected', ${target.reason} = ?
        WHERE ${target.id} = ?
          AND BINARY ${target.institute} = BINARY ?`,
      [notes, Number(contentId), ctx.instituteCode]
    );
    await connection.query(
      `INSERT INTO moderation_reviews (
         ed_moderation_review_institute_code,
         ed_moderation_review_content_type,
         ed_moderation_review_content_id,
         ed_moderation_review_reviewer_id,
         ed_moderation_review_decision,
         ed_moderation_review_escalated,
         ed_moderation_review_notes
       ) VALUES (?, ?, ?, ?, 'escalated', 1, ?)`,
      [ctx.instituteCode, contentType, Number(contentId), ctx.userId, notes]
    );
    await connection.query(
      `UPDATE content_reports
          SET ed_content_report_status = 'ESCALATED'
        WHERE BINARY ed_content_report_institute_code = BINARY ?
          AND ed_content_report_content_type = ?
          AND ed_content_report_content_id = ?
          AND ed_content_report_status = 'OPEN'`,
      [ctx.instituteCode, contentType, Number(contentId)]
    );
    await connection.query(
      `UPDATE moderation_media
          SET ed_moderation_media_status = 'rejected',
              ed_moderation_media_quarantine_key = NULL,
              ed_moderation_media_quarantine_until = NULL
        WHERE BINARY ed_moderation_media_institute_code = BINARY ?
          AND ed_moderation_media_content_type = ?
          AND ed_moderation_media_content_id = ?`,
      [ctx.instituteCode, contentType, Number(contentId)]
    );
    await recordDomainEvent(connection, ctx.instituteCode, "content.escalated", {
      actorId: ctx.userId,
      actorName: ctx.userName,
      actorAvatar: ctx.userPicture,
      authorId: Number(rows[0].userId),
      contentType,
      contentId: Number(contentId),
      reason: notes,
    });
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
  const cleanupResults = await Promise.allSettled(
    copies
      .map((row) => row.quarantineKey)
      .filter(Boolean)
      .map((key) => storage.delete(key))
  );
  const copyRetained = cleanupResults.some((result) => result.status === "rejected");
  if (copyRetained) {
    console.error(
      `[moderation:legal] Falha ao remover cópia de quarentena de ${contentType}:${contentId}`
    );
  }
  if (contentType === "post") {
    recommendationSync.schedulePostHidden({ instituteCode: ctx.instituteCode }, contentId);
  }
  return {
    contentType,
    contentId: Number(contentId),
    status: "rejected",
    escalated: true,
    copyRetained,
  };
}

async function declineReview(ctx, contentType, contentId, input = {}) {
  requireModerator(ctx);
  const target = await tableFor(contentType);
  const [rows] = await DATABASE.query(
    `SELECT ${target.id} AS id
       FROM ${target.table}
      WHERE ${target.id} = ?
        AND BINARY ${target.institute} = BINARY ?
        AND ${target.deleted} = 0
      LIMIT 1`,
    [Number(contentId), ctx.instituteCode]
  );
  if (!rows.length) fail(404, "MODERATION_CONTENT_NOT_FOUND", "Conteúdo não encontrado.");
  await DATABASE.query(
    `INSERT INTO moderation_reviews (
       ed_moderation_review_institute_code,
       ed_moderation_review_content_type,
       ed_moderation_review_content_id,
       ed_moderation_review_reviewer_id,
       ed_moderation_review_decision,
       ed_moderation_review_notes
     ) VALUES (?, ?, ?, ?, 'declined_review', ?)`,
    [
      ctx.instituteCode,
      contentType,
      Number(contentId),
      ctx.userId,
      cleanText(input.reason, 1000) || "O revisor solicitou que outro moderador analisasse o conteúdo.",
    ]
  );
  return { contentType, contentId: Number(contentId), status: "needs_review", reassigned: true };
}

module.exports = {
  declineReview,
  escalateContent,
  listHistory,
  listQueue,
  listReports,
  moderationPreview,
  reportContent,
  requestReview,
  reviewContent,
  setStatus,
  synchronousCommentRules,
};
