"use strict";

const fs = require("fs");
const express = require("express");
const { Readable } = require("stream");
const VerifyToken = require("../middleware/VerifyToken");
const realtime = require("../realtime/realtime");
const hr = require("../hr/service");
const timeclock = require("../hr/timeclock");
const moduleState = require("../hr/moduleState");
const moderation = require("../moderation/service");
const moderationQueue = require("../moderation/queue");
const moderationTerms = require("../moderation/terms");
const notifications = require("../notifications/service");
const recommendation = require("../services/recommendation/sync");
const {
  persistUploadedFeed,
  removeUploadedFiles,
  removeStoredAttachments,
  uploadFeedMedia,
  validateUploadedFiles,
} = require("../hr/feedMedia");
const { storage } = require("../storage");
const {
  attachmentsFromFiles: chatAttachmentsFromFiles,
  removeChatUploadedFiles,
  uploadChatMedia,
} = require("../hr/chatMedia");
const {
  removeUploadedFiles: removeStoryUploadedFiles,
  storyAttachments,
  uploadStoryMedia,
  validateStoryUploadedFiles,
} = require("../hr/storyMedia");

const router = express.Router();

function sendError(res, error) {
  const status = Number(error?.status) || 500;
  const code = error?.code || "HR_INTERNAL_ERROR";
  const message = status >= 500 ? "Não foi possível concluir a operação de RH." : error.message;
  if (status >= 500) console.error("[hr]", error);
  return res.status(status).json({
    success: false,
    error: { code, params: error?.params || {}, status },
    msg: error?.params && Object.keys(error.params).length
      ? message
      : error.message,
  });
}

const handle = (fn) => async (req, res, next) => {
  try {
    const result = await fn(req, res);
    if (!res.headersSent) res.json({ success: true, ...result });
  } catch (error) {
    if (next) next(error);
    else sendError(res, error);
  }
};

function handleChatMediaUpload(req, res, next) {
  uploadChatMedia(req, res, (error) => {
    if (!error) return next();
    removeChatUploadedFiles(req.files);
    const tooLarge = error.code === "LIMIT_FILE_SIZE";
    const tooMany = error.code === "LIMIT_FILE_COUNT";
    const status = tooLarge ? 413 : tooMany ? 422 : Number(error.status) || 400;
    return res.status(status).json({
      success: false,
      error: {
        code: tooLarge
          ? "HR_CHAT_MEDIA_TOO_LARGE"
          : tooMany
            ? "HR_CHAT_MEDIA_LIMIT"
            : error.code || "HR_CHAT_MEDIA_INVALID",
        params: {},
      },
      msg: tooLarge
        ? "Cada ficheiro pode ter no máximo 20 MB."
        : tooMany
          ? "Envie os anexos em lotes de até 25 ficheiros."
          : error.message || "Não foi possível processar o ficheiro.",
    });
  });
}

function handleStoryMediaUpload(req, res, next) {
  uploadStoryMedia(req, res, (error) => {
    if (!error) return next();
    removeStoryUploadedFiles(req.files);
    const tooLarge = error.code === "LIMIT_FILE_SIZE";
    const tooMany = error.code === "LIMIT_FILE_COUNT";
    const status = tooLarge ? 413 : tooMany ? 422 : Number(error.status) || 400;
    return res.status(status).json({
      success: false,
      error: {
        code: tooLarge
          ? "HR_STORY_MEDIA_TOO_LARGE"
          : tooMany
            ? "HR_STORY_MEDIA_LIMIT"
            : error.code || "HR_STORY_MEDIA_INVALID",
        params: {},
      },
      msg: tooLarge
        ? "Cada ficheiro do story pode ter no máximo 100 MB."
        : tooMany
          ? "Pode enviar no máximo oito slides e uma música."
          : error.message || "Não foi possível processar o ficheiro do story.",
    });
  });
}

function handleFeedMediaUpload(req, res, next) {
  uploadFeedMedia(req, res, (error) => {
    if (!error) return next();
    removeUploadedFiles(req.files);
    const tooLarge = error.code === "LIMIT_FILE_SIZE";
    const tooMany = error.code === "LIMIT_FILE_COUNT";
    const status = tooLarge ? 413 : tooMany ? 422 : Number(error.status) || 400;
    return res.status(status).json({
      success: false,
      error: {
        code: tooLarge
          ? "HR_FEED_VIDEO_TOO_LARGE"
          : tooMany
            ? "HR_FEED_MEDIA_LIMIT"
            : error.code || "HR_FEED_MEDIA_INVALID",
        params: {},
      },
      msg: tooLarge
        ? "O vídeo final não pode exceder 30 MB."
        : tooMany
          ? "Pode enviar no máximo cinco ficheiros e um poster."
          : error.message || "Não foi possível processar o anexo.",
    });
  });
}

router.use(VerifyToken);
router.use(async (req, res, next) => {
  try {
    req.hr = await hr.resolveContext(req);
    recommendation.scheduleUserSync(req.hr);
    next();
  } catch (error) {
    sendError(res, error);
  }
});
router.use((req, res, next) => {
  if (req.method === "GET") return next();
  return realtime.mutationBroadcast("hr")(req, res, next);
});

router.get("/bootstrap", handle(async (req) => hr.bootstrap(req.hr)));
router.get("/notifications", handle(async (req) => ({
  data: await notifications.listNotifications(req.hr, req.query),
})));
router.get("/notifications/unread-count", handle(async (req) => ({
  data: await notifications.unreadCount(req.hr),
})));
router.post("/notifications/read", handle(async (req) => ({
  data: await notifications.markRead(req.hr, req.body?.ids),
})));
router.post("/notifications/read-all", handle(async (req) => ({
  data: await notifications.markAllRead(req.hr),
})));
router.delete("/notifications/:id", handle(async (req) => ({
  data: await notifications.deleteNotification(req.hr, req.params.id),
})));
router.post("/notifications/posts/:postId/mute", handle(async (req) => ({
  data: await notifications.mutePostWatcher(req.hr, req.params.postId),
})));
router.get("/notifications/settings", handle(async (req) => {
  const [rows] = await require("../config/Database").DATABASE.query(
    `SELECT ed_user_account_allow_notification AS allow
       FROM eduall_user_accounts WHERE ed_user_account_id = ? LIMIT 1`,
    [req.hr.userId]
  );
  return {
    data: {
      enabled: Number(rows[0]?.allow ?? 1) !== 0,
      pollIntervalMs: Math.max(
        5_000,
        Number(process.env.NOTIFICATIONS_POLL_INTERVAL_MS) || 30_000
      ),
    },
  };
}));
router.patch("/notifications/settings", handle(async (req) => {
  await require("../config/Database").DATABASE.query(
    `UPDATE eduall_user_accounts SET ed_user_account_allow_notification = ?
      WHERE ed_user_account_id = ?`,
    [req.body?.enabled ? 1 : 0, req.hr.userId]
  );
  return { data: { enabled: Boolean(req.body?.enabled) } };
}));
router.get("/moderation/queue", handle(async (req) => ({
  data: await moderation.listQueue(req.hr, req.query),
})));
router.get("/moderation/reports", handle(async (req) => ({
  data: await moderation.listReports(req.hr),
})));
router.get("/moderation/history", handle(async (req) => ({
  data: await moderation.listHistory(req.hr),
})));
router.get("/moderation/preview/*", async (req, res, next) => {
  try {
    const preview = await moderation.moderationPreview(req.hr, req.params[0]);
    const object = await storage.get(preview.storageKey);
    if (!object) {
      return res.status(404).json({
        success: false,
        error: { code: "MODERATION_PREVIEW_NOT_FOUND", params: {} },
        msg: "Frame de revisão não encontrado.",
      });
    }
    res.setHeader("Content-Type", "image/jpeg");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Cache-Control", "private, no-store");
    if (object.local) return res.sendFile(object.path);
    return Readable.fromWeb(object.stream).pipe(res);
  } catch (error) {
    return next(error);
  }
});
router.post("/moderation/reports", handle(async (req) => ({
  data: await moderation.reportContent(
    req.hr,
    req.body?.contentType,
    req.body?.contentId,
    req.body
  ),
})));
router.post("/moderation/:contentType/:id/review", handle(async (req) => ({
  data: await moderation.reviewContent(
    req.hr,
    req.params.contentType,
    req.params.id,
    req.body
  ),
})));
router.post("/moderation/:contentType/:id/escalate", handle(async (req) => ({
  data: await moderation.escalateContent(
    req.hr,
    req.params.contentType,
    req.params.id,
    req.body
  ),
})));
router.post("/moderation/:contentType/:id/request-review", handle(async (req) => ({
  data: await moderation.requestReview(req.hr, req.params.contentType, req.params.id),
})));
router.post("/moderation/:contentType/:id/decline-review", handle(async (req) => ({
  data: await moderation.declineReview(
    req.hr,
    req.params.contentType,
    req.params.id,
    req.body
  ),
})));
router.get("/moderation/terms", handle(async (req) => {
  if (!req.hr.canModerate) {
    throw new hr.HrError(403, "MODERATION_MANAGER_REQUIRED", "Só moderadores podem consultar os termos.");
  }
  return { data: await moderationTerms.listTerms(req.hr) };
}));
router.post("/moderation/terms", handle(async (req) => {
  if (!req.hr.canModerate) {
    throw new hr.HrError(403, "MODERATION_MANAGER_REQUIRED", "Só moderadores podem editar os termos.");
  }
  await moderationTerms.saveTerm(req.hr, req.body);
  return { data: await moderationTerms.listTerms(req.hr) };
}));
router.get("/moderation/health", handle(async () => ({
  data: await moderationQueue.moderationQueueHealth(),
})));
router.get("/workspace-state/:module/:key", handle(async (req) => ({
  data: await moduleState.getModuleState(req.hr, req.params.module, req.params.key),
})));
router.put("/workspace-state/:module/:key", handle(async (req) => ({
  data: await moduleState.saveModuleState(
    req.hr,
    req.params.module,
    req.params.key,
    req.body
  ),
})));
router.get("/dashboard", handle(async (req) => ({ data: await hr.dashboard(req.hr) })));
router.get("/analytics", handle(async (req) => ({ data: await hr.analytics(req.hr) })));
router.get("/me", handle(async (req) => ({ data: await hr.getEmployee(req.hr, req.hr.employeeId) })));
router.get("/organization", handle(async (req) => ({ data: await hr.organization(req.hr) })));
router.get("/access/users", handle(async (req) => ({ data: await hr.listUsers(req.hr) })));

router.get("/employees", handle(async (req) => hr.listEmployees(req.hr, req.query)));
router.post("/employees", handle(async (req) => ({
  data: await hr.saveEmployee(req.hr, req, null, req.body).then((data) => {
    recommendation.scheduleEmployeeUserSync(req.hr, data.id).catch(() => {});
    return data;
  }),
})));
router.put("/employees/:id", handle(async (req) => ({
  data: await hr.saveEmployee(req.hr, req, req.params.id, req.body).then((data) => {
    recommendation.scheduleEmployeeUserSync(req.hr, data.id).catch(() => {});
    return data;
  }),
})));
router.delete("/employees/:id", handle(async (req) => ({
  data: await hr.deactivateEmployee(req.hr, req, req.params.id, req.body?.reason),
})));
router.post("/departments", handle(async (req) => ({
  data: await hr.saveDepartment(req.hr, req, null, req.body),
})));
router.put("/departments/:id", handle(async (req) => ({
  data: await hr.saveDepartment(req.hr, req, req.params.id, req.body),
})));

router.get("/feed", handle(async (req) => hr.listFeed(req.hr, req.query, "community")));
router.get("/feed/:id(\\d+)", handle(async (req) => ({
  data: await hr.getFeedPost(req.hr, req.params.id),
})));
router.post("/feed", handleFeedMediaUpload, async (req, res, next) => {
  try {
    await validateUploadedFiles(req.files);
    const clientVideoMetadata = req.body?.videoMetadata
      ? JSON.parse(req.body.videoMetadata)
      : null;
    req.attachments = await persistUploadedFeed(req.files, clientVideoMetadata, req.hr);
    removeUploadedFiles(req.files);
    const data = await hr.createPost(req.hr, req, req.body, "community");
    moderationQueue.enqueueModeration({
      instituteCode: req.hr.instituteCode,
      contentType: "post",
      contentId: data.id,
    });
    if (!res.headersSent) res.status(201).json({ success: true, data });
  } catch (error) {
    removeUploadedFiles(req.files);
    removeStoredAttachments(req.attachments || []).catch(() => {});
    next(error);
  }
});
router.patch("/feed/:id", handle(async (req) => ({
  data: await hr.updatePost(req.hr, req, req.params.id, req.body).then((data) => {
    recommendation.schedulePostHidden(req.hr, req.params.id);
    moderationQueue.enqueueModeration({
      instituteCode: req.hr.instituteCode,
      contentType: "post",
      contentId: req.params.id,
      reason: "edited",
    });
    return data;
  }),
})));
router.delete("/feed/:id", handle(async (req) => ({
  data: await hr.deletePost(req.hr, req, req.params.id).then((data) => {
    recommendation.schedulePostHidden(req.hr, req.params.id);
    return data;
  }),
})));
router.post("/feed/:id/comments", handle(async (req) => ({
  data: await hr.addComment(req.hr, req, req.params.id, req.body).then((data) => {
    moderationQueue.enqueueModeration({
      instituteCode: req.hr.instituteCode,
      contentType: "comment",
      contentId: data.id,
    });
    return data;
  }),
})));
router.post("/feed/:id/share", handle(async (req) => ({
  data: await hr.sharePostToChat(req.hr, req, req.params.id, req.body),
})));
router.delete("/feed/comments/:id", handle(async (req) => ({
  data: await hr.deleteComment(req.hr, req, req.params.id),
})));
router.post("/feed/comments/:id/reactions", handle(async (req) => ({
  data: await hr.toggleCommentReaction(req.hr, req, req.params.id, req.body),
})));
router.post("/feed/:id/reactions", handle(async (req) => ({
  data: await hr.toggleReaction(req.hr, req, req.params.id, req.body).then((data) => {
    if (data.active) {
      recommendation.scheduleFeedback(req.hr, "like", req.params.id, {
        value: 1,
        comment: data.type,
      });
    } else {
      recommendation.scheduleFeedbackRemoval(req.hr, "like", req.params.id);
    }
    return data;
  }),
})));
router.post("/feed/:id/watch", handle(async (req) => {
  await hr.getFeedPost(req.hr, req.params.id);
  await notifications.watchPost({
    instituteCode: req.hr.instituteCode,
    postId: Number(req.params.id),
    userId: req.hr.userId,
    source: "save",
  });
  return { data: { postId: Number(req.params.id), watching: true } };
}));
router.get("/feed/stories", handle(async (req) => hr.listStories(req.hr)));
router.post("/feed/stories", handleStoryMediaUpload, async (req, res, next) => {
  try {
    const files = storyAttachments(req.files);
    await validateStoryUploadedFiles(files);
    const data = await hr.createStory(req.hr, req, req.body, files);
    moderationQueue.enqueueModeration({
      instituteCode: req.hr.instituteCode,
      contentType: "story",
      contentId: data.id,
    });
    if (!res.headersSent) res.status(201).json({ success: true, data });
  } catch (error) {
    removeStoryUploadedFiles(req.files);
    next(error);
  }
});
router.post("/feed/stories/:id/view", handle(async (req) => ({
  data: await hr.markStoryViewed(req.hr, req.params.id),
})));
router.get("/feed/story-media/:storageKey", async (req, res, next) => {
  try {
    const media = await hr.getStoryMedia(req.hr, req.params.storageKey);
    if (!fs.existsSync(media.path)) {
      return res.status(404).json({
        success: false,
        error: { code: "HR_STORY_MEDIA_NOT_FOUND", params: {} },
        msg: "Ficheiro do story não encontrado.",
      });
    }
    const mime = media.mime || "application/octet-stream";
    const name = String(media.name || "story").replace(/[\r\n"]/g, "_");
    res.setHeader("Content-Type", mime);
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Cache-Control", "private, max-age=300");
    res.setHeader(
      "Content-Disposition",
      `inline; filename*=UTF-8''${encodeURIComponent(name)}`
    );
    return res.sendFile(media.path);
  } catch (error) {
    return next(error);
  }
});
router.get("/feed/media/*", async (req, res, next) => {
  try {
    const media = await hr.getFeedMedia(req.hr, req.params[0]);
    const object = await storage.get(media.storageKey, { range: req.headers.range });
    if (!object) {
      return res.status(404).json({
        success: false,
        error: { code: "HR_FEED_MEDIA_NOT_FOUND", params: {} },
        msg: "Anexo não encontrado.",
      });
    }
    const mime = media.attachment?.mime || "application/octet-stream";
    const name = String(media.attachment?.name || "anexo")
      .replace(/[\r\n"]/g, "_");
    const disposition = mime.startsWith("image/") || mime.startsWith("video/")
      ? "inline"
      : "attachment";
    res.setHeader("Content-Type", mime);
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Accept-Ranges", "bytes");
    res.setHeader("Cache-Control", "private, max-age=31536000, immutable");
    res.setHeader(
      "Content-Disposition",
      `${disposition}; filename*=UTF-8''${encodeURIComponent(name)}`
    );
    if (object.local && !req.headers.range) {
      return res.sendFile(object.path);
    }
    if (object.local) {
      res.status(206);
      res.setHeader("Content-Length", object.end - object.start + 1);
      res.setHeader("Content-Range", `bytes ${object.start}-${object.end}/${object.size}`);
    } else {
      if (object.response.status === 206) res.status(206);
      const contentRange = object.response.headers.get("content-range");
      if (contentRange) res.setHeader("Content-Range", contentRange);
      const contentLength = object.response.headers.get("content-length");
      if (contentLength) res.setHeader("Content-Length", contentLength);
      return Readable.fromWeb(object.stream).pipe(res);
    }
    return object.stream.pipe(res);
  } catch (error) {
    return next(error);
  }
});

router.get("/engagement", handle(async (req) => hr.listFeed(req.hr, req.query, "engagement")));
router.post("/engagement", handle(async (req) => {
  const data = await hr.createPost(req.hr, req, req.body, "engagement");
  moderationQueue.enqueueModeration({
    instituteCode: req.hr.instituteCode,
    contentType: "post",
    contentId: data.id,
  });
  return { data };
}));
router.get("/engagement/feedback", handle(async (req) => ({
  data: await hr.listFeedback(req.hr),
})));
router.post("/engagement/feedback", handle(async (req) => ({
  data: await hr.createFeedback(req.hr, req, req.body),
})));

router.get("/chat/contacts", handle(async (req) => ({
  data: await hr.listChatContacts(req.hr, req.query),
})));
router.get("/chat/conversations", handle(async (req) => ({
  data: await hr.listChatConversations(req.hr),
})));
router.get("/chat/groups/discover", handle(async (req) => ({
  data: await hr.listDiscoverableChatGroups(req.hr, req.query),
})));
router.post("/chat/direct", handle(async (req) => ({
  data: await hr.openDirectChat(req.hr, req.body?.userId),
})));
router.post("/chat/groups", handle(async (req) => ({
  data: await hr.createChatGroup(req.hr, req, req.body),
})));
router.patch("/chat/groups/:id", handle(async (req) => ({
  data: await hr.updateChatGroup(req.hr, req, req.params.id, req.body),
})));
router.post(
  "/chat/groups/:id/avatar",
  handleChatMediaUpload,
  async (req, res, next) => {
    try {
      const attachment = chatAttachmentsFromFiles(req.files)[0];
      if (!attachment || attachment.type !== "image") {
        removeChatUploadedFiles(req.files);
        return res.status(415).json({
          success: false,
          error: { code: "HR_CHAT_GROUP_PICTURE_INVALID", params: {} },
          msg: "Escolha uma imagem válida para o grupo.",
        });
      }
      if (attachment.size > 4 * 1024 * 1024) {
        removeChatUploadedFiles(req.files);
        return res.status(413).json({
          success: false,
          error: { code: "HR_CHAT_GROUP_PICTURE_TOO_LARGE", params: {} },
          msg: "A imagem do grupo não pode exceder 4 MB.",
        });
      }
      const data = await hr.updateChatGroupAvatar(req.hr, req, req.params.id, {
        picture: attachment.url,
      });
      moderationQueue.enqueueModeration({
        instituteCode: req.hr.instituteCode,
        contentType: "avatar",
        contentId: data.id,
      });
      return res.json({ success: true, data });
    } catch (error) {
      removeChatUploadedFiles(req.files);
      return next(error);
    }
  }
);
router.delete("/chat/groups/:id", handle(async (req) => ({
  data: await hr.deleteChatGroup(req.hr, req, req.params.id),
})));
router.post("/chat/groups/:id/join", handle(async (req) => ({
  data: await hr.joinChatGroup(req.hr, req, req.params.id),
})));
router.post("/chat/groups/:id/leave", handle(async (req) => ({
  data: await hr.leaveChatGroup(req.hr, req, req.params.id),
})));
router.get("/chat/conversations/:conversationId/messages", handle(async (req) => ({
  data: await hr.listChatMessages(req.hr, req.params.conversationId),
})));
router.get("/chat/media/:storageKey", async (req, res, next) => {
  try {
    const media = await hr.getChatMedia(req.hr, req.params.storageKey);
    if (!fs.existsSync(media.path)) {
      return res.status(404).json({
        success: false,
        error: { code: "HR_CHAT_MEDIA_NOT_FOUND", params: {} },
        msg: "Anexo não encontrado.",
      });
    }
    const mime = media.attachment?.mime || "application/octet-stream";
    const name = String(media.attachment?.name || "anexo")
      .replace(/[\r\n"]/g, "_");
    const disposition = mime.startsWith("image/") || mime.startsWith("video/") || mime.startsWith("audio/")
      ? "inline"
      : "attachment";
    res.setHeader("Content-Type", mime);
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Cache-Control", "private, max-age=3600");
    res.setHeader(
      "Content-Disposition",
      `${disposition}; filename*=UTF-8''${encodeURIComponent(name)}`
    );
    return res.sendFile(media.path);
  } catch (error) {
    return next(error);
  }
});
router.post(
  "/chat/conversations/:conversationId/messages/media",
  handleChatMediaUpload,
  async (req, res, next) => {
    try {
      const attachments = chatAttachmentsFromFiles(req.files);
      if (attachments[0] && req.body?.duration) {
        attachments[0].duration = Number(req.body.duration) || 0;
      }
      if (!attachments.length) {
        return res.status(422).json({
          success: false,
          error: { code: "HR_CHAT_MEDIA_REQUIRED", params: {} },
          msg: "Selecione pelo menos um ficheiro.",
        });
      }
      const data = await hr.sendChatMessage(req.hr, req, {
        ...req.body,
        conversationId: req.params.conversationId,
        attachments,
      });
      return res.status(201).json({ success: true, data });
    } catch (error) {
      removeChatUploadedFiles(req.files);
      return next(error);
    }
  }
);
router.post("/chat/conversations/:conversationId/messages", handle(async (req) => ({
  data: await hr.sendChatMessage(req.hr, req, {
    ...req.body,
    conversationId: req.params.conversationId,
  }),
})));
router.patch("/chat/conversations/:conversationId/messages/:messageId", handle(async (req) => ({
  data: await hr.editChatMessage(
    req.hr,
    req,
    req.params.conversationId,
    req.params.messageId,
    req.body
  ),
})));
router.delete("/chat/conversations/:conversationId/messages/:messageId", handle(async (req) => ({
  data: await hr.deleteChatMessage(
    req.hr,
    req,
    req.params.conversationId,
    req.params.messageId
  ),
})));
router.post("/chat/conversations/:conversationId/messages/:messageId/reactions", handle(async (req) => ({
  data: await hr.toggleChatMessageReaction(
    req.hr,
    req.params.conversationId,
    req.params.messageId,
    req.body
  ),
})));
router.post("/chat/conversations/:conversationId/read", handle(async (req) => ({
  data: await hr.markChatRead(req.hr, req.params.conversationId),
})));

router.get("/vacations", handle(async (req) => hr.listVacations(req.hr, req.query)));
router.post("/vacations", handle(async (req) => ({
  data: await hr.createVacation(req.hr, req, req.body),
})));
router.post("/vacations/:id/:decision", handle(async (req) => ({
  data: await hr.decideVacation(req.hr, req, req.params.id, req.params.decision, req.body),
})));

router.get("/attendance", handle(async (req) => ({ data: await hr.listAttendance(req.hr, req.query) })));
router.post("/attendance/:direction", handle(async (req) => {
  if (!["in", "out"].includes(req.params.direction)) {
    const error = new hr.HrError(422, "HR_CLOCK_DIRECTION_INVALID", "Direcção de picagem inválida.");
    throw error;
  }
  return { data: await hr.punchAttendance(req.hr, req, req.params.direction) };
}));

router.get("/timeclock/bootstrap", handle(async (req) => ({
  data: await timeclock.lookups(req.hr),
})));
router.get("/timeclock/summary", handle(async (req) => ({
  data: await timeclock.timeclockSummary(req.hr),
})));
router.get("/timeclock/tracking", handle(async (req) => ({
  data: await timeclock.tracking(req.hr),
})));
router.get("/timeclock/shifts/coverage", handle(async (req) => ({
  data: await timeclock.shiftCoverage(req.hr, req.query),
})));
router.get("/timeclock/records", handle(async (req) => ({
  data: await timeclock.listRecords(req.hr, req.query),
})));
router.post("/timeclock/records", handle(async (req) => ({
  data: await timeclock.createRecord(req.hr, req.body),
})));
router.put("/timeclock/records/:id", handle(async (req) => ({
  data: await timeclock.updateRecord(req.hr, req.params.id, req.body),
})));
router.post("/timeclock/records/:id/duplicate", handle(async (req) => ({
  data: await timeclock.duplicateRecord(req.hr, req.params.id),
})));
router.post("/timeclock/records/:id/correct", handle(async (req) => ({
  data: await timeclock.correctRecord(req.hr, req.params.id, req.body),
})));
router.delete("/timeclock/records/:id", handle(async (req) => ({
  data: await timeclock.deleteRecord(req.hr, req.params.id),
})));
router.get("/timeclock/documents/:resource", handle(async (req) => ({
  data: await timeclock.documents(req.hr, req.params.resource),
})));
router.post("/timeclock/documents/:resource", handle(async (req) => ({
  data: await timeclock.putDocument(req.hr, req.params.resource, null, req.body),
})));
router.put("/timeclock/documents/:resource/:id", handle(async (req) => ({
  data: await timeclock.putDocument(req.hr, req.params.resource, req.params.id, req.body),
})));
router.patch("/timeclock/documents/:resource/:id", handle(async (req) => ({
  data: await timeclock.patchDocument(req.hr, req.params.resource, req.params.id, req.body),
})));
router.delete("/timeclock/documents/:resource/:id", handle(async (req) => ({
  data: await timeclock.deleteDocument(req.hr, req.params.resource, req.params.id),
})));

router.get("/projects", handle(async (req) => ({ data: await hr.listProjects(req.hr) })));
router.post("/projects", handle(async (req) => ({
  data: await hr.createProject(req.hr, req, req.body),
})));
router.patch("/projects/:id", handle(async (req) => ({
  data: await hr.updateProject(req.hr, req, req.params.id, req.body),
})));

router.get("/goals", handle(async (req) => ({ data: await hr.listGoals(req.hr, req.query) })));
router.post("/goals", handle(async (req) => ({
  data: await hr.createGoal(req.hr, req, req.body),
})));
router.patch("/goals/:id", handle(async (req) => ({
  data: await hr.updateGoal(req.hr, req, req.params.id, req.body),
})));

router.get("/calendar", handle(async (req) => ({ data: await hr.listCalendar(req.hr, req.query) })));
router.post("/calendar", handle(async (req) => ({
  data: await hr.saveCalendar(req.hr, req, null, req.body),
})));
router.put("/calendar/:id", handle(async (req) => ({
  data: await hr.saveCalendar(req.hr, req, req.params.id, req.body),
})));
router.delete("/calendar/:id", handle(async (req) => ({
  data: await hr.deleteCalendar(req.hr, req, req.params.id),
})));

router.get("/recruitment/vacancies", handle(async (req) => ({
  data: await hr.listVacancies(req.hr),
})));
router.post("/recruitment/vacancies", handle(async (req) => ({
  data: await hr.saveVacancy(req.hr, req, null, req.body),
})));
router.patch("/recruitment/vacancies/:id", handle(async (req) => ({
  data: await hr.saveVacancy(req.hr, req, req.params.id, req.body),
})));
router.get("/recruitment/candidates", handle(async (req) => ({
  data: await hr.listCandidates(req.hr, req.query),
})));
router.post("/recruitment/candidates", handle(async (req) => ({
  data: await hr.createCandidate(req.hr, req, req.body),
})));
router.patch("/recruitment/candidates/:id", handle(async (req) => ({
  data: await hr.updateCandidate(req.hr, req, req.params.id, req.body),
})));

router.get("/expenses", handle(async (req) => hr.listExpenses(req.hr, req.query)));
router.post("/expenses", handle(async (req) => ({
  data: await hr.createExpense(req.hr, req, req.body),
})));
router.post("/expenses/:id/:decision", handle(async (req) => ({
  data: await hr.decideExpense(req.hr, req, req.params.id, req.params.decision, req.body),
})));
router.get("/payroll", handle(async (req) => ({
  data: await hr.listPayroll(req.hr, req.query),
})));
router.post("/payroll", handle(async (req) => ({
  data: await hr.savePayroll(req.hr, req, null, req.body),
})));
router.patch("/payroll/:id", handle(async (req) => ({
  data: await hr.savePayroll(req.hr, req, req.params.id, req.body),
})));

router.get("/training/courses", handle(async (req) => ({ data: await hr.listCourses(req.hr) })));
router.post("/training/courses", handle(async (req) => ({
  data: await hr.createCourse(req.hr, req, req.body),
})));
router.post("/training/courses/:id/enroll", handle(async (req) => ({
  data: await hr.enrollCourse(req.hr, req, req.params.id, req.body),
})));

router.get("/documents", handle(async (req) => ({ data: await hr.listDocuments(req.hr, req.query) })));
router.post("/documents", handle(async (req) => ({
  data: await hr.createDocument(req.hr, req, req.body),
})));
router.patch("/documents/:id", handle(async (req) => ({
  data: await hr.updateDocument(req.hr, req, req.params.id, req.body),
})));

router.get("/shifts", handle(async (req) => ({ data: await hr.listShifts(req.hr, req.query) })));
router.post("/shifts", handle(async (req) => ({
  data: await hr.createShift(req.hr, req, req.body),
})));

router.use((error, _req, res, _next) => {
  if (error?.code === "LIMIT_FILE_SIZE") {
    return sendError(res, new hr.HrError(
      413,
      "HR_FEED_MEDIA_TOO_LARGE",
      "Cada anexo pode ter no máximo 80 MB."
    ));
  }
  if (error?.code === "LIMIT_FILE_COUNT") {
    return sendError(res, new hr.HrError(
      422,
      "HR_FEED_MEDIA_LIMIT",
      "Pode anexar no máximo 5 ficheiros."
    ));
  }
  return sendError(res, error);
});

module.exports = router;
