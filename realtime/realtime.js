"use strict";

const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const { TokenExpiredError } = jwt;
const { SOCKET_EVENTS } = require("./events");
const { DATABASE } = require("../config/Database");
const { ensureSessionRefreshToken } = require("../auth/sessionTokens");

let ioRef = null;
let scheduledPostTimer = null;
const connectedUsers = new Map();
const activeCalls = new Map();
const activeCallByUser = new Map();
const allowedRoomPattern = /^(user|inst):[A-Za-z0-9_-]+$/;
const CALL_RING_TIMEOUT_MS = 30_000;

function userIdentity(sessionUser) {
  if (!sessionUser) return null;
  return {
    userId:
      sessionUser.eduall_user_session_ID ||
      sessionUser.eduall_user_session_id ||
      null,
    instituteCode:
      sessionUser.eduall_user_session_curentinstitute || null,
    refreshToken:
      sessionUser.eduall_user_session_refreshToken || null,
  };
}

function roomMatchesIdentity(room, identity) {
  if (!allowedRoomPattern.test(room) || !identity) return false;
  if (room === `user:${identity.userId}`) return true;
  if (room === `inst:${identity.instituteCode}`) return true;
  return false;
}

async function validateSocketIdentity(identity) {
  const [rows] = await DATABASE.query(
    `SELECT ua.ed_user_account_id AS userId
       FROM eduall_user_accounts ua
      WHERE ua.ed_user_account_id = ?
        AND ua.ed_user_account_deleted = 0
        AND (
          BINARY ua.ed_user_account_institute_code = BINARY ?
          OR EXISTS (
            SELECT 1
              FROM eduall_user_institutes ui
             WHERE ui.ed_user_institute_userCode = ua.ed_user_account_id
               AND BINARY ui.ed_user_institute_code = BINARY ?
               AND ui.ed_user_institute_deleted = 0
          )
          OR EXISTS (
            SELECT 1
              FROM eduall_system_accounts sa
             WHERE sa.ed_system_account_userid = ua.ed_user_account_id
               AND BINARY sa.ed_system_account_institute_code = BINARY ?
               AND sa.ed_system_account_deleted = 0
          )
        )
      LIMIT 1`,
    [identity.userId, identity.instituteCode, identity.instituteCode, identity.instituteCode]
  );
  return Boolean(rows[0]);
}

function onlineUserIds(instituteCode) {
  return [...new Set(
    [...connectedUsers.values()]
      .filter((identity) => identity.instituteCode === instituteCode)
      .map((identity) => Number(identity.userId))
      .filter(Boolean)
  )];
}

function broadcastPresence(instituteCode, eventUserId) {
  if (!ioRef || !instituteCode) return;
  const userIds = onlineUserIds(instituteCode);
  ioRef.to(`inst:${instituteCode}`).emit(SOCKET_EVENTS.CHAT_PRESENCE, {
    userIds,
    eventUserId: Number(eventUserId) || null,
    online: userIds.includes(Number(eventUserId)),
  });
}

function callUserKey(identity) {
  return `${identity.instituteCode}:${Number(identity.userId)}`;
}

function callParticipant(record, userId) {
  return record.members.find((member) => member.id === Number(userId)) || null;
}

function callState(record, userId) {
  return record.states.get(Number(userId)) || {
    audio: true,
    video: Boolean(record.video),
    screen: false,
  };
}

function serializeCall(record) {
  return {
    callId: record.id,
    conversationId: record.conversationId,
    type: record.type,
    name: record.name,
    video: record.video,
    createdAt: record.createdAt,
    initiatorId: record.initiatorId,
    initiator: callParticipant(record, record.initiatorId),
    members: record.members,
    joinedIds: [...record.joined],
    invitedIds: [...record.invited],
    participantStates: Object.fromEntries(
      [...record.joined].map((userId) => [userId, callState(record, userId)])
    ),
  };
}

function emitToCallUsers(record, event, payload, userIds = record.joined) {
  if (!ioRef) return;
  [...new Set(userIds)].forEach((userId) => {
    ioRef.to(`user:${Number(userId)}`).emit(event, payload);
  });
}

function releaseCallParticipant(record, userId) {
  const numericUserId = Number(userId);
  const key = `${record.instituteCode}:${numericUserId}`;
  if (activeCallByUser.get(key) === record.id) activeCallByUser.delete(key);
}

function finishCall(record, reason = "ended", endedBy = null) {
  if (!record || activeCalls.get(record.id) !== record) return;
  activeCalls.delete(record.id);
  clearTimeout(record.ringTimer);
  [...new Set([...record.joined, ...record.invited])].forEach((userId) => {
    releaseCallParticipant(record, userId);
  });
  emitToCallUsers(
    record,
    SOCKET_EVENTS.CALL_ENDED,
    {
      call: serializeCall(record),
      reason,
      endedBy: endedBy == null ? null : Number(endedBy),
    },
    [...new Set([...record.joined, ...record.invited])]
  );
}

function leaveCall(record, userId, reason = "left") {
  const numericUserId = Number(userId);
  if (!record) return;
  record.invited.delete(numericUserId);
  record.joined.delete(numericUserId);
  record.states.delete(numericUserId);
  releaseCallParticipant(record, numericUserId);

  if (record.type === "direct" || record.joined.size === 0) {
    finishCall(record, reason, numericUserId);
    return;
  }

  emitToCallUsers(record, SOCKET_EVENTS.CALL_PARTICIPANT_LEFT, {
    callId: record.id,
    userId: numericUserId,
    reason,
    joinedIds: [...record.joined],
  });
}

async function chatCallMembers(identity, conversationId) {
  const [rows] = await DATABASE.query(
    `SELECT c.ed_hr_chat_conversation_id AS conversationId,
            c.ed_hr_chat_conversation_type AS type,
            c.ed_hr_chat_conversation_name AS conversationName,
            p.ed_hr_chat_participant_user_id AS userId,
            p.ed_hr_chat_participant_role AS role,
            e.ed_employee_name AS employeeName,
            ua.ed_user_account_name AS accountName,
            e.ed_employee_picture AS employeePicture,
            ua.ed_user_account_picture AS accountPicture,
            e.ed_employee_charge AS employeeCharge,
            ua.ed_user_account_charge AS accountCharge
       FROM eduall_hr_chat_conversations c
       JOIN eduall_hr_chat_participants p
         ON p.ed_hr_chat_participant_conversation_id = c.ed_hr_chat_conversation_id
        AND p.ed_hr_chat_participant_deleted = 0
       JOIN eduall_user_accounts ua
         ON ua.ed_user_account_id = p.ed_hr_chat_participant_user_id
        AND ua.ed_user_account_deleted = 0
       LEFT JOIN eduall_user_institutes ui
         ON ui.ed_user_institute_userCode = p.ed_hr_chat_participant_user_id
        AND BINARY ui.ed_user_institute_code = BINARY c.ed_hr_chat_conversation_institute_code
        AND ui.ed_user_institute_deleted = 0
       LEFT JOIN eduall_employees e
         ON e.ed_employee_id = ui.ed_user_institute_employeeCode
        AND BINARY e.ed_employee_institute_code = BINARY c.ed_hr_chat_conversation_institute_code
        AND e.ed_employee_deleted = 0
      WHERE c.ed_hr_chat_conversation_id = ?
        AND c.ed_hr_chat_conversation_institute_code = ?
        AND c.ed_hr_chat_conversation_deleted = 0
        AND EXISTS (
          SELECT 1
            FROM eduall_hr_chat_participants caller
           WHERE caller.ed_hr_chat_participant_conversation_id = c.ed_hr_chat_conversation_id
             AND caller.ed_hr_chat_participant_user_id = ?
             AND caller.ed_hr_chat_participant_deleted = 0
        )`,
    [conversationId, identity.instituteCode, identity.userId]
  );
  if (!rows.length) return null;
  return {
    conversationId: Number(rows[0].conversationId),
    type: rows[0].type,
    name: rows[0].conversationName || "Conversa",
    members: rows.map((row) => ({
      id: Number(row.userId),
      name: row.employeeName || row.accountName || "Utilizador",
      picture: row.employeePicture || row.accountPicture || "",
      role: row.role || "",
      charge: row.employeeCharge || row.accountCharge || "",
    })),
  };
}

function registerSocket(io) {
  ioRef = io;
  io.use(async (socket, next) => {
    const sharedSession = socket.handshake?.session || socket.request?.session;
    if (socket.request && sharedSession && !socket.request.session) {
      socket.request.session = sharedSession;
    }
    const identity = userIdentity(sharedSession?.user);
    if (!identity?.userId || !identity?.instituteCode || !identity?.refreshToken) {
      return next(new Error("SOCKET_UNAUTHORIZED"));
    }
    if (!process.env.REFRESH_TOKEN_SECRET) {
      return next(new Error("SOCKET_UNAUTHORIZED"));
    }
    try {
      try {
        jwt.verify(identity.refreshToken, process.env.REFRESH_TOKEN_SECRET);
      } catch (error) {
        if (!(error instanceof TokenExpiredError)) throw error;
        const refreshed = await ensureSessionRefreshToken(
          socket.request,
          socket.request?.res
        );
        identity.refreshToken = refreshed.token;
        jwt.verify(identity.refreshToken, process.env.REFRESH_TOKEN_SECRET);
      }
      if (!(await validateSocketIdentity(identity))) {
        return next(new Error("SOCKET_FORBIDDEN_IDENTITY"));
      }
      socket.data.identity = identity;
      next();
    } catch (error) {
      console.warn("[realtime:auth]", error.code || error.message);
      next(new Error("SOCKET_UNAUTHORIZED"));
    }
  });

  io.on("connection", (socket) => {
    const identity = socket.data.identity;
    socket.join(`user:${identity.userId}`);
    socket.join(`inst:${identity.instituteCode}`);
    connectedUsers.set(socket.id, identity);
    broadcastPresence(identity.instituteCode, identity.userId);

    socket.on(SOCKET_EVENTS.ROOM_JOIN, ({ room } = {}, ack) => {
      if (!allowedRoomPattern.test(String(room || ""))) {
        return ack?.({
          ok: false,
          error: { code: "SOCKET_INVALID_ROOM", params: { room } },
        });
      }
      if (!roomMatchesIdentity(room, identity)) {
        return ack?.({
          ok: false,
          error: { code: "SOCKET_FORBIDDEN_ROOM", params: { room } },
        });
      }
      socket.join(room);
      return ack?.({ ok: true, room });
    });

    socket.on(SOCKET_EVENTS.ROOM_LEAVE, ({ room } = {}) => {
      if (roomMatchesIdentity(String(room || ""), identity)) socket.leave(room);
    });

    socket.on(SOCKET_EVENTS.CHAT_TYPING, async (payload = {}, ack) => {
      try {
        const conversationId = Number(payload.conversationId);
        if (!conversationId) {
          return ack?.({ ok: false, error: "CHAT_CONVERSATION_REQUIRED" });
        }
        const [rows] = await DATABASE.query(
          `SELECT p.ed_hr_chat_participant_user_id AS userId,
                  ua.ed_user_account_name AS name
             FROM eduall_hr_chat_participants p
             JOIN eduall_hr_chat_conversations c
               ON c.ed_hr_chat_conversation_id = p.ed_hr_chat_participant_conversation_id
             JOIN eduall_user_accounts ua
               ON ua.ed_user_account_id = p.ed_hr_chat_participant_user_id
            WHERE p.ed_hr_chat_participant_conversation_id = ?
              AND p.ed_hr_chat_participant_user_id = ?
              AND p.ed_hr_chat_participant_deleted = 0
              AND c.ed_hr_chat_conversation_institute_code = ?
              AND c.ed_hr_chat_conversation_deleted = 0
            LIMIT 1`,
          [conversationId, identity.userId, identity.instituteCode]
        );
        if (!rows.length) {
          return ack?.({ ok: false, error: "CHAT_CONVERSATION_FORBIDDEN" });
        }
        socket.to(`inst:${identity.instituteCode}`).emit(SOCKET_EVENTS.CHAT_TYPING, {
          conversationId,
          userId: Number(identity.userId),
          name: rows[0].name || "Utilizador",
          typing: Boolean(payload.typing),
          recording: Boolean(payload.recording),
        });
        return ack?.({ ok: true });
      } catch (error) {
        console.error("[chat:typing]", error.message);
        return ack?.({ ok: false, error: "CHAT_TYPING_FAILED" });
      }
    });

    socket.on(SOCKET_EVENTS.CALL_START, async (payload = {}, ack) => {
      try {
        const conversationId = Number(payload.conversationId);
        if (!conversationId) {
          return ack?.({ ok: false, error: "CALL_CONVERSATION_REQUIRED" });
        }
        const currentCallId = activeCallByUser.get(callUserKey(identity));
        if (currentCallId && activeCalls.has(currentCallId)) {
          return ack?.({
            ok: false,
            error: "CALL_ALREADY_ACTIVE",
            callId: currentCallId,
          });
        }
        const conversation = await chatCallMembers(identity, conversationId);
        if (!conversation) {
          return ack?.({ ok: false, error: "CALL_CONVERSATION_FORBIDDEN" });
        }
        const invitedIds = conversation.members
          .map((member) => member.id)
          .filter((userId) => userId !== Number(identity.userId));
        if (!invitedIds.length) {
          return ack?.({ ok: false, error: "CALL_NO_PARTICIPANTS" });
        }

        const record = {
          id: `hr-call-${crypto.randomUUID()}`,
          instituteCode: identity.instituteCode,
          conversationId,
          type: conversation.type,
          name: conversation.name,
          video: Boolean(payload.video),
          initiatorId: Number(identity.userId),
          members: conversation.members,
          joined: new Set([Number(identity.userId)]),
          invited: new Set(invitedIds),
          states: new Map([
            [Number(identity.userId), {
              audio: true,
              video: Boolean(payload.video),
              screen: false,
            }],
          ]),
          createdAt: new Date().toISOString(),
          ringTimer: null,
        };
        activeCalls.set(record.id, record);
        activeCallByUser.set(callUserKey(identity), record.id);
        record.ringTimer = setTimeout(() => {
          if (record.joined.size <= 1) finishCall(record, "timeout", record.initiatorId);
        }, CALL_RING_TIMEOUT_MS);
        record.ringTimer.unref?.();

        const broadcast = serializeCall(record);
        invitedIds.forEach((userId) => {
          ioRef.to(`user:${userId}`).emit(SOCKET_EVENTS.CALL_INCOMING, {
            call: broadcast,
            from: callParticipant(record, identity.userId),
          });
        });
        return ack?.({ ok: true, call: broadcast });
      } catch (error) {
        console.error("[chat:call:start]", error.message);
        return ack?.({ ok: false, error: "CALL_START_FAILED" });
      }
    });

    socket.on(SOCKET_EVENTS.CALL_ACCEPT, async (payload = {}, ack) => {
      try {
        const record = activeCalls.get(String(payload.callId || ""));
        const userId = Number(identity.userId);
        if (!record || record.instituteCode !== identity.instituteCode) {
          return ack?.({ ok: false, error: "CALL_NOT_FOUND" });
        }
        if (!record.invited.has(userId) && !record.joined.has(userId)) {
          return ack?.({ ok: false, error: "CALL_NOT_INVITED" });
        }
        const currentCallId = activeCallByUser.get(callUserKey(identity));
        if (currentCallId && currentCallId !== record.id) {
          return ack?.({ ok: false, error: "CALL_ALREADY_ACTIVE" });
        }

        record.invited.delete(userId);
        const wasJoined = record.joined.has(userId);
        record.joined.add(userId);
        activeCallByUser.set(callUserKey(identity), record.id);
        record.states.set(userId, {
          audio: true,
          video: Boolean(payload.video),
          screen: false,
        });
        clearTimeout(record.ringTimer);
        const existingParticipants = wasJoined
          ? []
          : [...record.joined]
              .filter((id) => id !== userId)
              .map((id) => ({
                ...callParticipant(record, id),
                state: callState(record, id),
              }))
              .filter((participant) => participant.id);
        if (!wasJoined) {
          const participant = {
            ...callParticipant(record, userId),
            state: callState(record, userId),
          };
          emitToCallUsers(
            record,
            SOCKET_EVENTS.CALL_PARTICIPANT_JOINED,
            {
              callId: record.id,
              participant,
              joinedIds: [...record.joined],
            },
            existingParticipants.map((item) => item.id)
          );
        }
        return ack?.({
          ok: true,
          call: serializeCall(record),
          existingParticipants,
        });
      } catch (error) {
        console.error("[chat:call:accept]", error.message);
        return ack?.({ ok: false, error: "CALL_ACCEPT_FAILED" });
      }
    });

    socket.on(SOCKET_EVENTS.CALL_DECLINE, (payload = {}, ack) => {
      const record = activeCalls.get(String(payload.callId || ""));
      const userId = Number(identity.userId);
      if (!record || record.instituteCode !== identity.instituteCode) {
        return ack?.({ ok: false, error: "CALL_NOT_FOUND" });
      }
      if (!record.invited.has(userId)) {
        return ack?.({ ok: false, error: "CALL_NOT_INVITED" });
      }
      record.invited.delete(userId);
      ioRef.to(`user:${record.initiatorId}`).emit(SOCKET_EVENTS.CALL_DECLINED, {
        callId: record.id,
        userId,
        participant: callParticipant(record, userId),
      });
      if (record.type === "direct") {
        finishCall(record, "declined", userId);
      }
      return ack?.({ ok: true });
    });

    socket.on(SOCKET_EVENTS.CALL_SIGNAL, (payload = {}, ack) => {
      const record = activeCalls.get(String(payload.callId || ""));
      const fromUserId = Number(identity.userId);
      const targetUserId = Number(payload.targetUserId);
      if (!record || record.instituteCode !== identity.instituteCode) {
        return ack?.({ ok: false, error: "CALL_NOT_FOUND" });
      }
      if (!record.joined.has(fromUserId) || !record.joined.has(targetUserId)) {
        return ack?.({ ok: false, error: "CALL_SIGNAL_FORBIDDEN" });
      }
      if (!payload.signal || typeof payload.signal !== "object") {
        return ack?.({ ok: false, error: "CALL_SIGNAL_INVALID" });
      }
      ioRef.to(`user:${targetUserId}`).emit(SOCKET_EVENTS.CALL_SIGNAL, {
        callId: record.id,
        fromUserId,
        signal: payload.signal,
      });
      return ack?.({ ok: true });
    });

    socket.on(SOCKET_EVENTS.CALL_PARTICIPANT_STATE, (payload = {}, ack) => {
      const record = activeCalls.get(String(payload.callId || ""));
      const userId = Number(identity.userId);
      if (!record || record.instituteCode !== identity.instituteCode) {
        return ack?.({ ok: false, error: "CALL_NOT_FOUND" });
      }
      if (!record.joined.has(userId)) {
        return ack?.({ ok: false, error: "CALL_NOT_JOINED" });
      }
      record.states.set(userId, {
        audio: Boolean(payload.audio),
        video: Boolean(payload.video),
        screen: Boolean(payload.screen),
      });
      emitToCallUsers(record, SOCKET_EVENTS.CALL_PARTICIPANT_STATE, {
        callId: record.id,
        userId,
        state: callState(record, userId),
      });
      return ack?.({ ok: true });
    });

    socket.on(SOCKET_EVENTS.CALL_LEAVE, (payload = {}, ack) => {
      const record = activeCalls.get(String(payload.callId || ""));
      const userId = Number(identity.userId);
      if (!record || record.instituteCode !== identity.instituteCode) {
        return ack?.({ ok: false, error: "CALL_NOT_FOUND" });
      }
      if (!record.joined.has(userId) && !record.invited.has(userId)) {
        return ack?.({ ok: false, error: "CALL_NOT_JOINED" });
      }
      if (userId === record.initiatorId && record.joined.size <= 1) {
        finishCall(record, "cancelled", userId);
      } else {
        leaveCall(record, userId, "left");
      }
      return ack?.({ ok: true });
    });

    socket.on("disconnect", () => {
      const identityBeforeDisconnect = connectedUsers.get(socket.id);
      connectedUsers.delete(socket.id);
      if (identityBeforeDisconnect) {
        broadcastPresence(identityBeforeDisconnect.instituteCode, identityBeforeDisconnect.userId);
        const stillConnected = [...connectedUsers.values()].some((item) =>
          Number(item.userId) === Number(identityBeforeDisconnect.userId) &&
          item.instituteCode === identityBeforeDisconnect.instituteCode
        );
        const callId = activeCallByUser.get(callUserKey(identityBeforeDisconnect));
        if (!stillConnected && callId) {
          leaveCall(activeCalls.get(callId), identityBeforeDisconnect.userId, "disconnected");
        }
      }
    });
  });
}

function emit(room, event, payload) {
  if (!ioRef || !room || !event) return false;
  ioRef.to(String(room)).emit(String(event), payload);
  return true;
}

function emitWithAck(room, event, payload, timeoutMs = 3000) {
  if (!ioRef || !room || !event) return Promise.resolve({ acknowledged: 0 });
  return new Promise((resolve) => {
    ioRef.timeout(Math.max(250, Number(timeoutMs) || 3000))
      .to(String(room))
      .emit(String(event), payload, (error, responses) => {
        resolve({
          acknowledged: error ? 0 : (responses || []).length,
          timedOut: Boolean(error),
        });
      });
  });
}

function emitDataChanged(identity, resource, payload = {}) {
  if (!identity?.instituteCode) return false;
  return emit(`inst:${identity.instituteCode}`, SOCKET_EVENTS.DATA_CHANGED, {
    resource: String(resource),
    ...payload,
  });
}

function emitToUser(instituteCode, userId, event, payload) {
  if (!ioRef || !userId || !event) return false;
  ioRef.to(`user:${Number(userId)}`).emit(String(event), {
    ...payload,
    instituteCode,
  });
  return true;
}

function socketStatus() {
  return {
    initialized: Boolean(ioRef),
    connectedClients: connectedUsers.size,
  };
}

async function publishDueScheduledPosts() {
  try {
    const [rows] = await DATABASE.query(
      `SELECT ed_hr_post_uid AS id,
              ed_post_institute_code AS instituteCode
         FROM eduall_posts
        WHERE ed_post_deleted = 0
          AND ed_post_moderation_status = 'approved'
          AND ed_post_publish_at IS NOT NULL
          AND ed_post_publish_at <= NOW()
          AND ed_post_schedule_notified = 0
        ORDER BY ed_post_publish_at ASC
        LIMIT 500`
    );
    if (!rows.length) return;
    const ids = rows.map((row) => Number(row.id));
    await DATABASE.query(
      `UPDATE eduall_posts
          SET ed_post_schedule_notified = 1
        WHERE ed_hr_post_uid IN (${ids.map(() => "?").join(",")})`,
      ids
    );
    const byInstitute = new Map();
    rows.forEach((row) => {
      const code = row.instituteCode;
      byInstitute.set(code, [...(byInstitute.get(code) || []), Number(row.id)]);
    });
    for (const [instituteCode, postIds] of byInstitute) {
      emitDataChanged({ instituteCode }, "hr", {
        operation: "SCHEDULED_POST_PUBLISHED",
        postIds,
      });
      const { syncPostNow } = require("../services/recommendation/sync");
      for (const postId of postIds) {
        await syncPostNow({ instituteCode }, postId).catch(() => {});
      }
    }
  } catch (error) {
    console.error("[realtime:scheduled-posts]", error.message);
  }
}

function startScheduledPostWatcher() {
  if (scheduledPostTimer) return scheduledPostTimer;
  const initial = setTimeout(publishDueScheduledPosts, 5000);
  initial.unref?.();
  scheduledPostTimer = setInterval(publishDueScheduledPosts, 30_000);
  scheduledPostTimer.unref?.();
  return scheduledPostTimer;
}

/**
 * Middleware Express único para invalidar listagens após mutações.
 */
function mutationBroadcast(resource) {
  return (req, res, next) => {
    const originalJson = res.json.bind(res);
    res.json = (payload) => {
      if (res.statusCode < 400) {
        emitDataChanged(req.session?.user, resource, {
          operation: req.method,
          path: req.originalUrl,
        });
      }
      return originalJson(payload);
    };
    next();
  };
}

module.exports = {
  SOCKET_EVENTS,
  registerSocket,
  emit,
  emitWithAck,
  emitDataChanged,
  emitToUser,
  publishDueScheduledPosts,
  startScheduledPostWatcher,
  mutationBroadcast,
  roomMatchesIdentity,
  socketStatus,
  onlineUserIds,
  activeCalls,
};
