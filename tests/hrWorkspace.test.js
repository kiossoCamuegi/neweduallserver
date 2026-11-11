"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");

test("RH está montado antes do fallback e exige sessão/token", () => {
  const app = read("app.js");
  const router = read("routes/HrWorkspace.js");
  assert.match(app, /(?:applicationRoutes|app)\.use\("\/api\/hr", hrWorkspaceRouter\)/);
  assert.match(router, /router\.use\(VerifyToken\)/);
  assert.match(router, /hr\.resolveContext\(req\)/);
});

test("sessão autenticada renova refresh token expirado sem esconder menus", () => {
  const middleware = read("middleware/VerifyToken.js");
  const tokens = read("auth/sessionTokens.js");
  const refresh = read("Controllers/RefreshToken.js");
  assert.match(middleware, /ensureSessionRefreshToken\(req, res\)/);
  assert.match(tokens, /TokenExpiredError/);
  assert.match(tokens, /eduall_user_session_refreshToken = token/);
  assert.match(tokens, /ed_user_account_deleted = 0/);
  assert.match(refresh, /ensureSessionRefreshToken\(req, res/);
  assert.match(read("realtime/realtime.js"), /ensureSessionRefreshToken/);
  assert.match(read("realtime/realtime.js"), /TokenExpiredError/);
  assert.match(read("realtime/realtime.js"), /handshake\?\.session/);
});

test("RH cobre feed, chat, férias, calendário, engagement e restantes módulos", () => {
  const router = read("routes/HrWorkspace.js");
  [
    '"/feed"',
    '"/feed/media/*"',
    '"/feed/:id/comments"',
    '"/feed/:id/share"',
    '"/feed/comments/:id/reactions"',
    '"/feed/:id/reactions"',
    '"/chat/conversations"',
    '"/chat/conversations/:conversationId/messages"',
    '"/chat/conversations/:conversationId/messages/media"',
    '"/chat/media/:storageKey"',
    '"/chat/groups"',
    '"/chat/direct"',
    '"/vacations"',
    '"/attendance/:direction"',
    '"/timeclock/records"',
    '"/timeclock/documents/:resource"',
    '"/timeclock/summary"',
    '"/calendar"',
    '"/engagement"',
    '"/recruitment/vacancies"',
    '"/expenses"',
    '"/training/courses"',
    '"/documents"',
  ].forEach((route) => assert.match(router, new RegExp(route.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))));
  assert.match(read("hr/service.js"), /sharePostToChat/);
  assert.match(read("hr/service.js"), /type: "post"/);
  assert.match(read("hr/timeclock.js"), /timeclockSummary/);
  assert.match(read("migrations/045_hr_timeclock_documents.sql"), /eduall_hr_timeclock_documents/);
});

test("migração RH é aditiva e mantém soft delete e tenant", () => {
  const migration = read("migrations/028_hr_workspace.sql");
  assert.match(migration, /CREATE TABLE IF NOT EXISTS eduall_hr_vacation_requests/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS eduall_hr_time_entries/);
  assert.match(migration, /ed_hr_vacation_institute_code/);
  assert.match(migration, /ed_hr_vacation_deleted/);
  assert.doesNotMatch(migration, /\bDROP TABLE\b/i);
});

test("feed RH completo mantém repostas, filtros e anexos privados", () => {
  const service = read("hr/service.js");
  const router = read("routes/HrWorkspace.js");
  const migration = read("migrations/032_hr_feed_completion.sql");
  const identityMigration = read("migrations/033_hr_feed_stable_identity.sql");
  const commentIdentityMigration = read("migrations/034_hr_feed_comment_identity.sql");
  const commentReactionMigration = read("migrations/035_hr_comment_reactions.sql");
  const media = read("hr/feedMedia.js");
  assert.match(service, /query\.search/);
  assert.match(service, /query\.visibility/);
  assert.match(service, /FEED_SORTS/);
  assert.match(service, /query\.sort === "recent"/);
  assert.match(service, /ed_post_comment_parent_uid/);
  assert.match(service, /getFeedMedia/);
  assert.match(router, /uploadFeedMedia/);
  assert.match(router, /getFeedMedia/);
  assert.match(migration, /ed_post_comment_parent_id/);
  assert.match(identityMigration, /ed_hr_post_uid BIGINT NOT NULL AUTO_INCREMENT UNIQUE/);
  assert.match(identityMigration, /ed_post_comment_post_uid/);
  assert.match(identityMigration, /ed_hr_post_reaction_post_uid/);
  assert.match(commentIdentityMigration, /ed_post_comment_uid BIGINT NOT NULL AUTO_INCREMENT UNIQUE/);
  assert.match(commentIdentityMigration, /ed_post_comment_parent_uid/);
  assert.match(commentReactionMigration, /eduall_hr_comment_reactions/);
  assert.match(media, /limits:\s*\{/);
});

test("chat RH completo inclui grupos, presença e mensagens em tempo real", () => {
  const service = read("hr/service.js");
  const realtime = read("realtime/realtime.js");
  const migration = read("migrations/036_hr_chat_complete.sql");
  assert.match(service, /eligibleChatContacts/);
  assert.match(service, /TIMESTAMPDIFF\(YEAR, s\.ed_student_birthday/);
  assert.match(service, /createChatGroup/);
  assert.match(service, /sendChatMessage/);
  assert.match(realtime, /CHAT_PRESENCE/);
  assert.match(realtime, /CHAT_TYPING/);
  assert.match(service, /editChatMessage/);
  assert.match(service, /toggleChatMessageReaction/);
  assert.match(migration, /eduall_hr_chat_conversations/);
  assert.match(migration, /eduall_hr_chat_participants/);
  const chatMedia = read("hr/chatMedia.js");
  assert.match(chatMedia, /20 \* 1024 \* 1024/);
  assert.match(chatMedia, /files: 25/);
  assert.match(chatMedia, /video\/mp4/);
  assert.match(chatMedia, /audio\/webm/);
});

test("chamadas RH usam sinalização Socket.IO autorizada e WebRTC", () => {
  const events = read("realtime/events.js");
  const realtime = read("realtime/realtime.js");
  const frontendEvents = read("../frontend/src/realtime/events.js");
  const callClient = read("../frontend/src/RH_app/Pages/Chat/useChatCall.js");
  assert.match(events, /CALL_START:\s*"chat:call:start"/);
  assert.match(events, /CALL_SIGNAL:\s*"chat:call:signal"/);
  assert.match(frontendEvents, /CALL_PARTICIPANT_JOINED:\s*"chat:call:participant_joined"/);
  assert.match(realtime, /chatCallMembers/);
  assert.match(realtime, /ed_hr_chat_participant_user_id/);
  assert.match(realtime, /CALL_RING_TIMEOUT_MS/);
  assert.match(realtime, /CALL_RING_TIMEOUT_MS = 30_000/);
  assert.match(realtime, /activeCalls/);
  assert.match(realtime, /CALL_SIGNAL/);
  assert.match(callClient, /new RTCPeerConnection/);
  assert.match(callClient, /getUserMedia/);
  assert.match(callClient, /getDisplayMedia/);
  assert.match(callClient, /CALL_PARTICIPANT_STATE/);
  assert.match(callClient, /REACT_APP_WEBRTC_TURN_URL/);
  assert.match(callClient, /connectSocketWhenReady/);
  assert.match(read("../frontend/src/realtime/socketClient.js"), /repairHttpSession/);
});

test("frontend RH restaura módulos antigos e mantém workspace como fallback", () => {
  const routes = read("../frontend/src/Layout/CustomRoutes.jsx");
  const workspace = read("../frontend/src/RH_app/Workspace/HrWorkspace.jsx");
  assert.match(routes, /RH_app\/Workspace\/HrWorkspace/);
  assert.match(routes, /RH_app\/Pages\/Employees\/EmployeesRh/);
  assert.match(routes, /RH_app\/Pages\/Dashboard\/HR_dashboard/);
  assert.match(routes, /<Route path="\/hr\/home" render=\{\(\) => <HrDashboard/);
  assert.match(routes, /FeedNews\/Index/);
  assert.match(routes, /<Route path="\/hr\/feed" render=\{\(\) => <FeedNewsCommunity/);
  assert.doesNotMatch(workspace, /MockAdapter|Mockdata|mock data/i);
  assert.match(workspace, /CommunityPage/);
  assert.match(workspace, /ChatPage/);
  assert.match(workspace, /VacationsPage/);
});
