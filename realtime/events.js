"use strict";

const SOCKET_EVENTS = Object.freeze({
  CONNECT: "connect",
  DISCONNECT: "disconnect",
  CONNECT_ERROR: "connect_error",
  ROOM_JOIN: "room:join",
  ROOM_LEAVE: "room:leave",
  DATA_CHANGED: "data:changed",
  JOB_PROGRESS: "job:progress",
  JOB_DONE: "job:done",
  JOB_ERROR: "job:error",
  NOTIFICATION_NEW: "notification:new",
  AGENT_TOOL_CALL: "agent:tool_call",
  AGENT_TOOL_RESULT: "agent:tool_result",
  CHAT_TYPING: "chat:typing",
  CHAT_PRESENCE: "chat:presence",
  CALL_INCOMING: "chat:call:incoming",
  CALL_START: "chat:call:start",
  CALL_ACCEPT: "chat:call:accept",
  CALL_DECLINE: "chat:call:decline",
  CALL_SIGNAL: "chat:call:signal",
  CALL_PARTICIPANT_JOINED: "chat:call:participant_joined",
  CALL_PARTICIPANT_LEFT: "chat:call:participant_left",
  CALL_PARTICIPANT_STATE: "chat:call:participant_state",
  CALL_DECLINED: "chat:call:declined",
  CALL_ENDED: "chat:call:ended",
  CALL_LEAVE: "chat:call:leave",
});

module.exports = { SOCKET_EVENTS };
