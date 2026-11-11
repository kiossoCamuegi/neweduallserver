"use strict";

const crypto = require("crypto");
const { DATABASE } = require("../config/Database");
const {
  cleanText,
  validateVacation,
  validatePositiveAmount,
  normalizePage,
  buildMeta,
  canManageHr,
} = require("./rules");
const { safeMediaPath } = require("./feedMedia");
const { storage } = require("../storage");
const { attachmentFromStorageKey, safeChatMediaPath } = require("./chatMedia");
const { safeStoryMediaPath } = require("./storyMedia");
const realtime = require("../realtime/realtime");
const notifications = require("../notifications/service");
const moderationService = require("../moderation/service");
const { recordDomainEvent } = require("../moderation/domainEvents");
const { moderationCapabilities } = require("./moderationAccess");
const {
  encryptContent,
  safeDecryptContent,
} = require("../shared/contentCrypto");

class HrError extends Error {
  constructor(status, code, message, params = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.params = params;
  }
}

const fail = (status, code, message, params) => {
  throw new HrError(status, code, message, params);
};

const numberOrNull = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

const parseJson = (value, fallback) => {
  if (value && typeof value === "object") return value;
  try {
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
};

function protectChatAttachments(value) {
  return (Array.isArray(value) ? value : []).map((attachment) => {
    if (attachment?.type !== "rich" || attachment?.payload === undefined) return attachment;
    return {
      type: "rich",
      encryptedPayload: encryptContent(JSON.stringify(attachment.payload)),
    };
  });
}

function revealChatAttachments(value) {
  return parseJson(value, []).map((attachment) => {
    if (attachment?.type !== "rich" || !attachment?.encryptedPayload) return attachment;
    const plain = safeDecryptContent(attachment.encryptedPayload);
    let payload = {};
    try { payload = plain ? JSON.parse(plain) : {}; } catch { payload = {}; }
    return { type: "rich", payload };
  });
}

const mysqlUtcDateTime = (value) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 19).replace("T", " ");
};

const FEED_VISIBILITIES = new Set(["institute", "department", "private"]);
const REACTION_TYPES = Object.freeze(["love", "care", "haha", "wow", "sad", "angry"]);
const REACTION_ALIASES = Object.freeze({
  like: "love",
  gosto: "love",
  amor: "love",
  adoro: "love",
  forca: "care",
  "força": "care",
  haha: "haha",
  uau: "wow",
  triste: "sad",
  raiva: "angry",
  grr: "angry",
});
const FEED_SORTS = {
  newest: "COALESCE(p.ed_post_publish_at, p.ed_post_registerdate) DESC, p.ed_hr_post_uid DESC",
  oldest: "COALESCE(p.ed_post_publish_at, p.ed_post_registerdate) ASC, p.ed_hr_post_uid ASC",
  popular: `(
    SELECT COUNT(*) FROM eduall_hr_post_reactions r
     WHERE r.ed_hr_post_reaction_post_uid = p.ed_hr_post_uid
       AND r.ed_hr_post_reaction_institute_code = p.ed_post_institute_code
       AND r.ed_hr_post_reaction_deleted = 0
  ) DESC, commentCount DESC, COALESCE(p.ed_post_publish_at, p.ed_post_registerdate) DESC`,
  discussed: `commentCount DESC, (
    SELECT COUNT(*) FROM eduall_hr_post_reactions r
     WHERE r.ed_hr_post_reaction_post_uid = p.ed_hr_post_uid
       AND r.ed_hr_post_reaction_institute_code = p.ed_post_institute_code
       AND r.ed_hr_post_reaction_deleted = 0
  ) DESC, COALESCE(p.ed_post_publish_at, p.ed_post_registerdate) DESC`,
};

function normalizeReactionType(value, fallback = null) {
  const normalized = cleanText(value || "", 30).toLowerCase();
  const type = REACTION_ALIASES[normalized] || normalized;
  return REACTION_TYPES.includes(type) ? type : fallback;
}

function emptyReactionCounts() {
  return Object.fromEntries(REACTION_TYPES.map((type) => [type, 0]));
}

const REACTION_TARGETS = Object.freeze({
  post: {
    table: "eduall_hr_post_reactions",
    instituteColumn: "ed_hr_post_reaction_institute_code",
    idColumn: "ed_hr_post_reaction_post_uid",
    typeColumn: "ed_hr_post_reaction_type",
    userColumn: "ed_hr_post_reaction_user_id",
    deletedColumn: "ed_hr_post_reaction_deleted",
    createdColumn: "ed_hr_post_reaction_created_at",
  },
  comment: {
    table: "eduall_hr_comment_reactions",
    instituteColumn: "ed_hr_comment_reaction_institute_code",
    idColumn: "ed_hr_comment_reaction_comment_uid",
    typeColumn: "ed_hr_comment_reaction_type",
    userColumn: "ed_hr_comment_reaction_user_id",
    deletedColumn: "ed_hr_comment_reaction_deleted",
    createdColumn: "ed_hr_comment_reaction_created_at",
  },
});

async function loadReactionSummaries(connection, ctx, targetType, targetIds) {
  const ids = [...new Set(targetIds.map(Number).filter(Boolean))];
  const result = new Map(ids.map((id) => [id, {
    reactionCounts: emptyReactionCounts(),
    reactionsTotal: 0,
    myReaction: null,
    reactors: [],
  }]));
  if (!ids.length) return result;
  const target = REACTION_TARGETS[targetType];
  const placeholders = ids.map(() => "?").join(",");
  const [rows] = await connection.query(
    `SELECT ${target.idColumn} AS targetId,
            ${target.typeColumn} AS type,
            COUNT(*) AS count,
            MAX(CASE WHEN ${target.userColumn} = ? THEN 1 ELSE 0 END) AS mine
       FROM ${target.table}
      WHERE ${target.instituteColumn} = ?
        AND ${target.idColumn} IN (${placeholders})
        AND ${target.deletedColumn} = 0
      GROUP BY ${target.idColumn}, ${target.typeColumn}`,
    [ctx.userId, ctx.instituteCode, ...ids]
  );
  rows.forEach((row) => {
    const id = Number(row.targetId);
    const type = normalizeReactionType(row.type);
    const summary = result.get(id);
    if (!type || !summary) return;
    const count = Number(row.count || 0);
    summary.reactionCounts[type] += count;
    summary.reactionsTotal += count;
    if (Number(row.mine)) summary.myReaction = type;
  });

  const [reactorRows] = await connection.query(
    `SELECT r.${target.idColumn} AS targetId,
            r.${target.userColumn} AS userId,
            ua.ed_user_account_name AS accountName,
            ua.ed_user_account_picture AS accountPicture,
            e.ed_employee_name AS employeeName,
            e.ed_employee_picture AS employeePicture
       FROM ${target.table} r
       JOIN eduall_user_accounts ua
         ON ua.ed_user_account_id = r.${target.userColumn}
        AND ua.ed_user_account_deleted = 0
       LEFT JOIN eduall_user_institutes ui
         ON ui.ed_user_institute_userCode = r.${target.userColumn}
        AND BINARY ui.ed_user_institute_code = BINARY ?
        AND ui.ed_user_institute_deleted = 0
       LEFT JOIN eduall_employees e
         ON e.ed_employee_id = ui.ed_user_institute_employeeCode
        AND BINARY e.ed_employee_institute_code = BINARY ?
        AND e.ed_employee_deleted = 0
      WHERE r.${target.instituteColumn} = ?
        AND r.${target.idColumn} IN (${placeholders})
        AND r.${target.deletedColumn} = 0
      ORDER BY r.${target.idColumn}, r.${target.createdColumn} DESC
      LIMIT 5000`,
    [ctx.instituteCode, ctx.instituteCode, ctx.instituteCode, ...ids]
  );
  reactorRows.forEach((row) => {
    const summary = result.get(Number(row.targetId));
    if (!summary || summary.reactors.length >= 3) return;
    const id = Number(row.userId);
    if (summary.reactors.some((person) => Number(person.id) === id)) return;
    summary.reactors.push({
      id,
      name: row.employeeName || row.accountName || "Utilizador",
      picture: row.accountPicture || row.employeePicture || "",
    });
  });
  return result;
}

function normalizeFeedVisibility(value, fallback = "") {
  const normalized = cleanText(value, 30).toLowerCase();
  if (normalized === "public" || normalized === "institute") return "institute";
  if (normalized === "friends" || normalized === "department") return "department";
  if (normalized === "private") return "private";
  return fallback;
}

function normalizePostBackground(value) {
  const background = cleanText(value, 500);
  if (!background) return null;
  return /^linear-gradient\([#0-9a-zA-Z.,%()\s-]+\)$/.test(background)
    ? background
    : null;
}

function canReadFeedRow(row, ctx) {
  const moderationStatus = String(row.moderationStatus || row.status || "approved");
  const moderator = Boolean(ctx.canModerate || ctx.isManager);
  if (
    moderationStatus !== "approved"
    && Number(row.userId) !== Number(ctx.userId)
    && !moderator
  ) return false;
  const visibility = normalizeFeedVisibility(row.visibility, "institute");
  if (visibility === "institute") return true;
  if (Number(row.userId) === Number(ctx.userId)) return true;
  if (moderator) return true;
  return Boolean(
    visibility === "department" &&
    ctx.employeeId &&
    ctx.departmentId &&
    Number(row.departmentId) === Number(ctx.departmentId)
  );
}

function sanitizeFeedAttachments(value) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 5).map((attachment) => {
    const storageKey = safeMediaPath(attachment?.storageKey);
    const type = ["image", "video", "file"].includes(attachment?.type)
      ? attachment.type
      : "file";
    return {
      id: cleanText(attachment?.id, 64) || storageKey,
      type,
      name: cleanText(pathBasename(attachment?.name), 180) || "anexo",
      mime: cleanText(attachment?.mime, 120),
      size: Math.max(0, Number(attachment?.size) || 0),
      storageKey,
      url: `/api/hr/feed/media/${storageKey}`,
      duration: Math.max(0, Number(attachment?.duration) || 0),
      width: Math.max(0, Number(attachment?.width) || 0),
      height: Math.max(0, Number(attachment?.height) || 0),
      poster: attachment?.poster?.storageKey
        ? {
            storageKey: safeMediaPath(attachment.poster.storageKey),
            url: `/api/hr/feed/media/${safeMediaPath(attachment.poster.storageKey)}`,
            mime: cleanText(attachment.poster.mime, 120),
            size: Math.max(0, Number(attachment.poster.size) || 0),
          }
        : null,
    };
  }).filter((attachment) => attachment.storageKey);
}

function pathBasename(value) {
  return String(value || "").split(/[\\/]/).pop().slice(0, 180);
}

function normalizeStoryCaptions(value) {
  const captions = parseJson(value, []);
  return Array.isArray(captions) ? captions.slice(0, 8) : [];
}

function normalizeStoryLanguages(value) {
  const languages = parseJson(value, []);
  return Array.isArray(languages)
    ? languages.slice(0, 8).map((language) => {
        const normalized = String(language || "").trim().replace(/_/g, "-");
        return /^[a-zA-Z]{2,3}(?:-[a-zA-Z0-9]{2,8})*$/.test(normalized)
          ? normalized.slice(0, 35)
          : "";
      })
    : [];
}

function normalizeStoryDurations(value) {
  const durations = parseJson(value, []);
  return Array.isArray(durations) ? durations.slice(0, 8) : [];
}

function storyMediaUrl(storageKey) {
  return `/api/hr/feed/story-media/${encodeURIComponent(storageKey)}`;
}

const employeeRow = (row) => ({
  id: Number(row.id),
  code: row.code || "",
  name: row.name || "",
  email: row.email || "",
  phone: row.phone || "",
  picture: row.picture || "",
  role: row.role || "",
  departmentId: row.departmentId || null,
  department: row.department || "",
  managerId: row.managerId || null,
  managerName: row.managerName || "",
  status: Number(row.status) === 0 ? "inactivo" : "activo",
  hireDate: row.hireDate || "",
  contractType: row.contractType || "",
  workMode: row.workMode || "",
  location: row.location || "",
  vacationBalance: Number(row.vacationBalance || 0),
  notes: row.notes || "",
});

async function resolveContext(req) {
  const userId = Number(req.session?.user?.eduall_user_session_ID);
  const instituteCode = cleanText(
    req.session?.user?.eduall_user_session_curentinstitute,
    200
  );
  if (!userId || !instituteCode) {
    fail(401, "HR_SESSION_REQUIRED", "É necessária uma sessão institucional válida.");
  }
  const [rows] = await DATABASE.query(
    `SELECT ua.ed_user_account_id AS userId,
            ua.ed_user_account_name AS userName,
            ua.ed_user_account_email AS userEmail,
            ua.ed_user_account_picture AS userPicture,
            ua.ed_user_account_type AS accountType,
            ua.ed_usertype AS userType,
            ua.ed_user_account_institute_code AS accountInstituteCode,
            ui.ed_user_institute_employeeCode AS membershipEmployeeId,
            e.ed_employee_id AS employeeId,
            e.ed_employee_code AS employeeCode,
            e.ed_employee_name AS employeeName,
            e.ed_employee_email AS employeeEmail,
            e.ed_employee_picture AS employeePicture,
            e.ed_employee_charge AS employeeRole,
            e.ed_employee_department AS employeeDepartment,
            d.ed_department_title AS departmentName
       FROM eduall_user_accounts ua
       LEFT JOIN eduall_user_institutes ui
              ON ui.ed_user_institute_userCode = ua.ed_user_account_id
             AND ui.ed_user_institute_code = ?
             AND ui.ed_user_institute_deleted = 0
       LEFT JOIN eduall_employees e
              ON e.ed_employee_id = ui.ed_user_institute_employeeCode
             AND e.ed_employee_institute_code = ?
             AND e.ed_employee_deleted = 0
       LEFT JOIN eduall_department d
              ON d.ed_department_id = e.ed_employee_department
             AND d.ed_department_deleted = 0
      WHERE ua.ed_user_account_id = ?
        AND ua.ed_user_account_deleted = 0
      LIMIT 1`,
    [instituteCode, instituteCode, userId]
  );
  let row = rows[0];
  if (!row) fail(401, "HR_USER_NOT_FOUND", "Utilizador da sessão não encontrado.");

  if (!row.employeeId && row.userEmail) {
    const [byEmail] = await DATABASE.query(
      `SELECT e.ed_employee_id AS employeeId,
              e.ed_employee_code AS employeeCode,
              e.ed_employee_name AS employeeName,
              e.ed_employee_email AS employeeEmail,
              e.ed_employee_picture AS employeePicture,
              e.ed_employee_charge AS employeeRole,
              e.ed_employee_department AS employeeDepartment,
              d.ed_department_title AS departmentName
         FROM eduall_employees e
         LEFT JOIN eduall_department d
                ON d.ed_department_id = e.ed_employee_department
               AND d.ed_department_deleted = 0
        WHERE e.ed_employee_institute_code = ?
          AND e.ed_employee_deleted = 0
          AND LOWER(TRIM(e.ed_employee_email)) = LOWER(TRIM(?))
        LIMIT 1`,
      [instituteCode, row.userEmail]
    );
    if (byEmail[0]) row = { ...row, ...byEmail[0] };
  }

  const [apps] = await DATABASE.query(
    `SELECT ed_system_account_app_type AS appType
       FROM eduall_system_accounts
      WHERE ed_system_account_userid = ?
        AND ed_system_account_institute_code = ?
        AND ed_system_account_deleted = 0`,
    [userId, instituteCode]
  );
  const appTypes = apps.map((item) => item.appType).filter(Boolean);
  const memberByInstitute = String(row.accountInstituteCode || "") === instituteCode;
  if (!row.membershipEmployeeId && !memberByInstitute && !appTypes.length) {
    fail(403, "HR_INSTITUTE_ACCESS_DENIED", "O utilizador não pertence a esta instituição.");
  }

  const isManager = canManageHr({
    accountType: row.accountType,
    userType: row.userType,
    role: row.employeeRole,
    appTypes,
  });
  const capabilities = moderationCapabilities({ userId, isManager });

  return {
    userId,
    instituteCode,
    userName: row.userName || row.employeeName || "",
    userEmail: row.userEmail || row.employeeEmail || "",
    userPicture: row.userPicture || row.employeePicture || "",
    employeeId: row.employeeId ? Number(row.employeeId) : null,
    employeeCode: row.employeeCode || "",
    employeeName: row.employeeName || row.userName || "",
    employeeRole: row.employeeRole || "",
    departmentId: row.employeeDepartment || null,
    departmentName: row.departmentName || "",
    appTypes,
    isManager,
    ...capabilities,
    identity: req.session.user,
  };
}

function requireManager(ctx) {
  if (!ctx.isManager) {
    fail(403, "HR_MANAGER_REQUIRED", "Esta operação exige acesso de gestão de RH.");
  }
}

async function audit(connection, ctx, req, action, entityType, entityId, oldValue, newValue, reason) {
  await connection.query(
    `INSERT INTO eduall_hr_audit_logs (
       ed_hr_audit_institute_code, ed_hr_audit_user_id, ed_hr_audit_action,
       ed_hr_audit_entity_type, ed_hr_audit_entity_id, ed_hr_audit_old_value,
       ed_hr_audit_new_value, ed_hr_audit_reason, ed_hr_audit_ip
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      ctx.instituteCode,
      ctx.userId,
      action,
      entityType,
      String(entityId),
      oldValue == null ? null : JSON.stringify(oldValue),
      newValue == null ? null : JSON.stringify(newValue),
      cleanText(reason, 2000) || null,
      cleanText(req.ip || req.socket?.remoteAddress, 100) || null,
    ]
  );
}

async function transaction(work) {
  const connection = await DATABASE.getConnection();
  try {
    await connection.beginTransaction();
    const result = await work(connection);
    await connection.commit();
    return result;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

async function bootstrap(ctx) {
  const [departments] = await DATABASE.query(
    `SELECT d.ed_department_id AS id,
            d.ed_department_title AS name
       FROM eduall_department d
      WHERE d.ed_department_deleted = 0
        AND (d.ed_department_institute_code = ? OR d.ed_department_institute_code IS NULL)
      ORDER BY d.ed_department_title`,
    [ctx.instituteCode]
  );
  return {
    user: {
      id: ctx.userId,
      name: ctx.userName,
      email: ctx.userEmail,
      picture: ctx.userPicture,
      employeeId: ctx.employeeId,
      employeeCode: ctx.employeeCode,
      role: ctx.employeeRole,
      departmentId: ctx.departmentId,
      departmentName: ctx.departmentName,
      isManager: ctx.isManager,
      canModerate: ctx.canModerate,
      canLegalEscalate: ctx.canLegalEscalate,
    },
    departments: departments.map((item) => ({ id: Number(item.id), name: item.name })),
  };
}

async function dashboard(ctx) {
  const [[employees], [vacations], [expenses], [vacancies], [messages], [events], [goals]] =
    await Promise.all([
      DATABASE.query(
        `SELECT COUNT(*) AS total,
                SUM(CASE WHEN ed_employee_status <> 0 THEN 1 ELSE 0 END) AS active
           FROM eduall_employees
          WHERE ed_employee_institute_code = ? AND ed_employee_deleted = 0`,
        [ctx.instituteCode]
      ),
      DATABASE.query(
        `SELECT COUNT(*) AS total
           FROM eduall_hr_vacation_requests
          WHERE ed_hr_vacation_institute_code = ?
            AND ed_hr_vacation_status = 'pendente'
            AND ed_hr_vacation_deleted = 0`,
        [ctx.instituteCode]
      ),
      DATABASE.query(
        `SELECT COUNT(*) AS total, COALESCE(SUM(ed_hr_expense_amount), 0) AS amount
           FROM eduall_hr_expenses
          WHERE ed_hr_expense_institute_code = ?
            AND ed_hr_expense_status = 'pendente'
            AND ed_hr_expense_deleted = 0`,
        [ctx.instituteCode]
      ),
      DATABASE.query(
        `SELECT COUNT(*) AS total
           FROM eduall_hr_recruitment_vacancies
          WHERE ed_hr_vacancy_institute_code = ?
            AND ed_hr_vacancy_status IN ('publicada','aberta')
            AND ed_hr_vacancy_deleted = 0`,
        [ctx.instituteCode]
      ),
      DATABASE.query(
        `SELECT COUNT(*) AS total
           FROM eduall_chat_messages
          WHERE ed_chat_message_institute_code = ?
            AND ed_chat_message_to = ?
            AND ed_chat_message_readed = 0
            AND ed_chat_message_deleted = 0`,
        [ctx.instituteCode, ctx.userId]
      ),
      DATABASE.query(
        `SELECT ed_calendar_event_id AS id,
                ed_calendar_event_title AS title,
                ed_calendar_event_start AS startAt,
                ed_calendar_event_end AS endAt,
                ed_calendar_event_type AS type
           FROM eduall_calendar_events
          WHERE ed_calendar_event_institute_code = ?
            AND ed_calendar_event_deleted = 0
            AND ed_calendar_event_end >= NOW()
          ORDER BY ed_calendar_event_start ASC
          LIMIT 5`,
        [ctx.instituteCode]
      ),
      DATABASE.query(
        `SELECT COUNT(*) AS total
           FROM eduall_hr_goals
          WHERE ed_hr_goal_institute_code = ?
            AND ed_hr_goal_status IN ('em_curso','em_risco')
            AND ed_hr_goal_deleted = 0`,
        [ctx.instituteCode]
      ),
    ]);

  return {
    employees: Number(employees[0]?.total || 0),
    activeEmployees: Number(employees[0]?.active || 0),
    pendingVacations: Number(vacations[0]?.total || 0),
    pendingExpenses: Number(expenses[0]?.total || 0),
    pendingExpenseAmount: Number(expenses[0]?.amount || 0),
    openVacancies: Number(vacancies[0]?.total || 0),
    unreadMessages: Number(messages[0]?.total || 0),
    activeGoals: Number(goals[0]?.total || 0),
    upcomingEvents: events,
  };
}

async function listEmployees(ctx, query = {}) {
  const { page, limit, offset } = normalizePage(query);
  const params = [ctx.instituteCode];
  let where = `e.ed_employee_institute_code = ?
    AND e.ed_employee_deleted = 0
    AND (d.ed_department_id IS NULL OR d.ed_department_deleted = 0)`;
  if (query.search) {
    const search = `%${cleanText(query.search, 200).toLowerCase()}%`;
    where += ` AND (
      LOWER(CONVERT(e.ed_employee_name USING utf8mb4)) LIKE ?
      OR LOWER(CONVERT(e.ed_employee_email USING utf8mb4)) LIKE ?
      OR LOWER(CONVERT(e.ed_employee_code USING utf8mb4)) LIKE ?
    )`;
    params.push(search, search, search);
  }
  if (query.departmentId) {
    where += " AND e.ed_employee_department = ?";
    params.push(Number(query.departmentId));
  }
  if (query.status === "activo" || query.status === "inactivo") {
    where += " AND e.ed_employee_status " + (query.status === "activo" ? "<> 0" : "= 0");
  }
  const from = `
    FROM eduall_employees e
    LEFT JOIN eduall_department d
           ON d.ed_department_id = e.ed_employee_department
          AND d.ed_department_deleted = 0
    LEFT JOIN eduall_employees m
           ON m.ed_employee_id = e.ed_employee_manager_id
          AND m.ed_employee_institute_code = e.ed_employee_institute_code
          AND m.ed_employee_deleted = 0`;
  const [[count], [rows]] = await Promise.all([
    DATABASE.query(`SELECT COUNT(*) AS total ${from} WHERE ${where}`, params),
    DATABASE.query(
      `SELECT e.ed_employee_id AS id,
              e.ed_employee_code AS code,
              e.ed_employee_name AS name,
              e.ed_employee_email AS email,
              e.ed_employee_phone AS phone,
              COALESCE(
                (
                  SELECT ua.ed_user_account_picture
                    FROM eduall_user_institutes ui
                    JOIN eduall_user_accounts ua
                      ON ua.ed_user_account_id = ui.ed_user_institute_userCode
                     AND ua.ed_user_account_deleted = 0
                   WHERE ui.ed_user_institute_employeeCode = e.ed_employee_id
                     AND BINARY ui.ed_user_institute_code = BINARY e.ed_employee_institute_code
                     AND ui.ed_user_institute_deleted = 0
                     AND NULLIF(TRIM(ua.ed_user_account_picture), '') IS NOT NULL
                   ORDER BY ua.ed_user_account_id ASC
                   LIMIT 1
                ),
                e.ed_employee_picture,
                ''
              ) AS picture,
              e.ed_employee_charge AS role,
              e.ed_employee_department AS departmentId,
              d.ed_department_title AS department,
              e.ed_employee_manager_id AS managerId,
              m.ed_employee_name AS managerName,
              e.ed_employee_status AS status,
              e.ed_employee_hire_date AS hireDate,
              e.ed_employee_contract_type AS contractType,
              e.ed_employee_work_mode AS workMode,
              e.ed_employee_location AS location,
              e.ed_employee_vacation_balance AS vacationBalance,
              e.ed_employee_notes AS notes
         ${from}
        WHERE ${where}
        ORDER BY ${query.sort === "recent" ? "e.ed_employee_id DESC" : "e.ed_employee_name ASC"}
        LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    ),
  ]);
  return {
    data: rows.map(employeeRow),
    meta: buildMeta(count[0]?.total, page, limit),
  };
}

async function getEmployee(ctx, id) {
  const employeeId = Number(id || ctx.employeeId);
  if (!employeeId) fail(404, "HR_EMPLOYEE_LINK_REQUIRED", "A conta não está ligada a um funcionário.");
  if (!ctx.isManager && employeeId !== ctx.employeeId) {
    fail(403, "HR_EMPLOYEE_SCOPE_DENIED", "Só pode consultar o seu próprio perfil.");
  }
  const result = await listEmployees(ctx, { page: 1, limit: 100 });
  const employee = result.data.find((item) => item.id === employeeId);
  if (!employee) fail(404, "HR_EMPLOYEE_NOT_FOUND", "Funcionário não encontrado.");
  return employee;
}

async function saveEmployee(ctx, req, id, input) {
  requireManager(ctx);
  const name = cleanText(input?.name, 255);
  const email = cleanText(input?.email, 180);
  if (name.length < 3) fail(422, "HR_EMPLOYEE_NAME_REQUIRED", "O nome deve ter pelo menos 3 caracteres.");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
    fail(422, "HR_EMPLOYEE_EMAIL_INVALID", "Indique um email válido.");
  }
  return transaction(async (connection) => {
    const employeeId = numberOrNull(id);
    let previous = null;
    let resultId = employeeId;
    if (employeeId) {
      const [rows] = await connection.query(
        `SELECT ed_employee_id AS id, ed_employee_name AS name
           FROM eduall_employees
          WHERE ed_employee_id = ? AND ed_employee_institute_code = ?
            AND ed_employee_deleted = 0 FOR UPDATE`,
        [employeeId, ctx.instituteCode]
      );
      if (!rows.length) fail(404, "HR_EMPLOYEE_NOT_FOUND", "Funcionário não encontrado.");
      previous = rows[0];
      await connection.query(
        `UPDATE eduall_employees
            SET ed_employee_name = ?, ed_employee_email = ?, ed_employee_phone = ?,
                ed_employee_charge = ?, ed_employee_department = ?,
                ed_employee_manager_id = ?, ed_employee_status = ?,
                ed_employee_hire_date = ?, ed_employee_contract_type = ?,
                ed_employee_work_mode = ?, ed_employee_location = ?,
                ed_employee_notes = ?, ed_employee_vacation_balance = ?,
                ed_employee_updated_at = NOW()
          WHERE ed_employee_id = ? AND ed_employee_institute_code = ?`,
        [
          name, email, cleanText(input.phone, 80) || null,
          cleanText(input.role, 180) || null, numberOrNull(input.departmentId),
          numberOrNull(input.managerId), input.status === "inactivo" ? 0 : 1,
          cleanText(input.hireDate, 10) || null,
          cleanText(input.contractType, 60) || null,
          cleanText(input.workMode, 30) || null,
          cleanText(input.location, 180) || null,
          cleanText(input.notes, 5000) || null,
          Math.max(0, Number(input.vacationBalance) || 0),
          employeeId, ctx.instituteCode,
        ]
      );
    } else {
      const code = cleanText(input.code, 40) ||
        `HR-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(2).toString("hex").toUpperCase()}`;
      const [inserted] = await connection.query(
        `INSERT INTO eduall_employees (
           ed_employee_code, ed_employee_name, ed_employee_email, ed_employee_phone,
           ed_employee_charge, ed_employee_department, ed_employee_manager_id,
           ed_employee_status, ed_employee_hire_date, ed_employee_contract_type,
           ed_employee_work_mode, ed_employee_location, ed_employee_notes,
           ed_employee_vacation_balance, ed_employee_institute_code, ed_employee_deleted
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
        [
          code, name, email, cleanText(input.phone, 80) || null,
          cleanText(input.role, 180) || null, numberOrNull(input.departmentId),
          numberOrNull(input.managerId), input.status === "inactivo" ? 0 : 1,
          cleanText(input.hireDate, 10) || null,
          cleanText(input.contractType, 60) || null,
          cleanText(input.workMode, 30) || null,
          cleanText(input.location, 180) || null,
          cleanText(input.notes, 5000) || null,
          Math.max(0, Number(input.vacationBalance) || 0),
          ctx.instituteCode,
        ]
      );
      resultId = inserted.insertId;
    }
    await audit(
      connection, ctx, req, employeeId ? "actualizar_funcionario" : "criar_funcionario",
      "employee", resultId, previous, { name, email, role: input.role }, input.reason
    );
    return { id: resultId };
  });
}

async function deactivateEmployee(ctx, req, id, reason) {
  requireManager(ctx);
  return transaction(async (connection) => {
    const employeeId = Number(id);
    const [rows] = await connection.query(
      `SELECT ed_employee_id AS id, ed_employee_name AS name
         FROM eduall_employees
        WHERE ed_employee_id = ? AND ed_employee_institute_code = ?
          AND ed_employee_deleted = 0 FOR UPDATE`,
      [employeeId, ctx.instituteCode]
    );
    if (!rows.length) fail(404, "HR_EMPLOYEE_NOT_FOUND", "Funcionário não encontrado.");
    await connection.query(
      `UPDATE eduall_employees
          SET ed_employee_deleted = 1, ed_employee_status = 0,
              ed_employee_updated_at = NOW()
        WHERE ed_employee_id = ? AND ed_employee_institute_code = ?`,
      [employeeId, ctx.instituteCode]
    );
    await audit(connection, ctx, req, "inactivar_funcionario", "employee", employeeId, rows[0], null, reason);
    return { id: employeeId };
  });
}

async function listFeed(ctx, query = {}, kind = "community") {
  const { page, limit, offset } = normalizePage(query);
  const filterParams = [
    ctx.instituteCode,
    kind,
    ctx.userId,
    ctx.isManager ? 1 : 0,
    ctx.employeeId || null,
    ctx.departmentId || null,
  ];
  let where = `
    p.ed_post_institute_code = ?
    AND p.ed_post_kind = ?
    AND p.ed_post_deleted = 0
    AND (p.ed_post_publish_at IS NULL OR p.ed_post_publish_at <= NOW())
    AND (
      p.ed_post_visibility IN ('institute', 'public')
      OR p.ed_post_user = ?
      OR ? = 1
      OR (
        p.ed_post_visibility IN ('department', 'friends')
        AND ? IS NOT NULL
        AND e.ed_employee_department = ?
      )
    )
    AND (p.ed_post_moderation_status = 'approved' OR p.ed_post_user = ?)`;
  filterParams.push(ctx.userId);
  const selectedVisibility = normalizeFeedVisibility(query.visibility);
  if (selectedVisibility) {
    where += " AND p.ed_post_visibility IN (?, ?)";
    filterParams.push(
      selectedVisibility,
      selectedVisibility === "institute" ? "public" : selectedVisibility
    );
  }
  if (query.search) {
    where += ` AND (
      LOWER(CONVERT(COALESCE(p.ed_post_description, '') USING utf8mb4)) LIKE ?
      OR LOWER(CONVERT(COALESCE(ua.ed_user_account_name, e.ed_employee_name, '') USING utf8mb4)) LIKE ?
    )`;
    const term = `%${cleanText(query.search, 200).toLowerCase()}%`;
    filterParams.push(term, term);
  }
  if (query.from) {
    const from = cleanText(query.from, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(from)) {
      where += " AND COALESCE(p.ed_post_publish_at, p.ed_post_registerdate) >= ?";
      filterParams.push(`${from} 00:00:00`);
    }
  }
  if (query.to) {
    const to = cleanText(query.to, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(to)) {
      where += " AND COALESCE(p.ed_post_publish_at, p.ed_post_registerdate) < DATE_ADD(?, INTERVAL 1 DAY)";
      filterParams.push(`${to} 00:00:00`);
    }
  }
  const sortKey = FEED_SORTS[query.sort] ? query.sort : "newest";
  const fromSql = `
    FROM eduall_posts p
    LEFT JOIN eduall_user_accounts ua
      ON ua.ed_user_account_id = p.ed_post_user
     AND ua.ed_user_account_deleted = 0
    LEFT JOIN eduall_employees e
      ON e.ed_employee_id = p.ed_post_author_employee
     AND e.ed_employee_institute_code = p.ed_post_institute_code
     AND e.ed_employee_deleted = 0`;
  const [[count], [rows]] = await Promise.all([
    DATABASE.query(`SELECT COUNT(*) AS total ${fromSql} WHERE ${where}`, filterParams),
    DATABASE.query(
      `SELECT p.ed_hr_post_uid AS id, p.ed_post_id AS legacyId, p.ed_post_user AS userId,
              p.ed_post_description AS content,
              COALESCE(p.ed_post_publish_at, p.ed_post_registerdate) AS createdAt,
              p.ed_post_visibility AS visibility, p.ed_post_attachments AS attachments,
              p.ed_post_moderation_status AS moderationStatus,
              p.ed_post_moderation_reason AS moderationReason,
              p.ed_post_background AS background,
              p.ed_post_feeling AS feeling,
              p.ed_post_location AS location,
              p.ed_post_publish_at AS publishAt,
              p.ed_post_author_employee AS employeeId, p.ed_post_links AS links,
              e.ed_employee_department AS departmentId,
              COALESCE(ua.ed_user_account_name, e.ed_employee_name, 'Utilizador') AS authorName,
              COALESCE(ua.ed_user_account_picture, e.ed_employee_picture, '') AS authorPicture,
              (SELECT COUNT(*) FROM eduall_post_comments c
                WHERE c.ed_post_comment_post_uid = p.ed_hr_post_uid
                  AND c.ed_post_comment_institute_code = p.ed_post_institute_code
                  AND c.ed_post_comment_deleted = 0
                  AND c.ed_post_comment_moderation_status = 'approved') AS commentCount
         ${fromSql}
        WHERE ${where}
        ORDER BY ${FEED_SORTS[sortKey]}
        LIMIT ? OFFSET ?`,
      [...filterParams, limit, offset]
    ),
  ]);
  const ids = rows.map((row) => Number(row.id));
  let comments = [];
  if (ids.length) {
    const [commentRows] = await DATABASE.query(
      `SELECT c.ed_post_comment_uid AS id, c.ed_post_comment_post_uid AS postId,
              c.ed_post_comment_user AS userId, c.ed_post_comment_text AS text,
              c.ed_post_comment_registerDate AS createdAt,
              c.ed_post_comment_parent_uid AS parentId,
              c.ed_post_comment_moderation_status AS moderationStatus,
              c.ed_post_comment_moderation_reason AS moderationReason,
              COALESCE(ua.ed_user_account_name, e.ed_employee_name, 'Utilizador') AS authorName,
              COALESCE(ua.ed_user_account_picture, e.ed_employee_picture, '') AS authorPicture,
              1 AS commentBase
         FROM eduall_post_comments c
         LEFT JOIN eduall_user_accounts ua ON ua.ed_user_account_id = c.ed_post_comment_user
         LEFT JOIN eduall_user_institutes ui
                ON ui.ed_user_institute_userCode = c.ed_post_comment_user
               AND ui.ed_user_institute_code = c.ed_post_comment_institute_code
               AND ui.ed_user_institute_deleted = 0
         LEFT JOIN eduall_employees e
                ON e.ed_employee_id = ui.ed_user_institute_employeeCode
               AND e.ed_employee_institute_code = c.ed_post_comment_institute_code
               AND e.ed_employee_deleted = 0
        WHERE c.ed_post_comment_institute_code = ?
          AND c.ed_post_comment_deleted = 0
          AND c.ed_post_comment_post_uid IN (${ids.map(() => "?").join(",")})
        ORDER BY c.ed_post_comment_registerDate ASC`,
      [ctx.instituteCode, ...ids]
    );
    comments = commentRows;
  }
  const commentIds = comments.map((comment) => Number(comment.id));
  const [postReactions, commentReactions] = await Promise.all([
    loadReactionSummaries(DATABASE, ctx, "post", ids),
    loadReactionSummaries(DATABASE, ctx, "comment", commentIds),
  ]);
  return {
    data: rows.map((row) => ({
      id: Number(row.id),
      legacyId: Number(row.legacyId) || 0,
      content: safeDecryptContent(row.content || ""),
      createdAt: row.createdAt,
      visibility: normalizeFeedVisibility(row.visibility, "institute"),
      moderationStatus: row.moderationStatus || "approved",
      moderationReason: row.moderationReason || "",
      attachments: parseJson(row.attachments, []),
      background: row.background || "",
      feeling: row.feeling || "",
      location: row.location || "",
      publishAt: row.publishAt,
      links: row.links || "",
      author: {
        id: Number(row.userId),
        employeeId: row.employeeId ? Number(row.employeeId) : null,
        name: row.authorName,
        picture: row.authorPicture,
      },
      canDelete: Number(row.userId) === ctx.userId || ctx.isManager,
      commentCount: Number(row.commentCount || 0),
      reactionCount: postReactions.get(Number(row.id))?.reactionsTotal || 0,
      reactionsTotal: postReactions.get(Number(row.id))?.reactionsTotal || 0,
      reactionCounts: postReactions.get(Number(row.id))?.reactionCounts || emptyReactionCounts(),
      myReaction: postReactions.get(Number(row.id))?.myReaction || null,
      reactors: postReactions.get(Number(row.id))?.reactors || [],
      reacted: Boolean(postReactions.get(Number(row.id))?.myReaction),
      reactionType: postReactions.get(Number(row.id))?.myReaction || "",
      comments: comments
        .filter((comment) => (
          Number(comment.postId) === Number(row.id)
          && (
            (comment.moderationStatus || "approved") === "approved"
            || Number(comment.userId) === Number(ctx.userId)
            || ctx.isManager
          )
        ))
        .map((comment) => ({
          id: Number(comment.id),
          parentId: comment.parentId ? Number(comment.parentId) : null,
          text: safeDecryptContent(comment.text || ""),
          createdAt: comment.createdAt,
          authorName: comment.authorName,
          authorPicture: comment.authorPicture,
          canDelete: Number(comment.userId) === ctx.userId || ctx.isManager,
          moderationStatus: comment.moderationStatus || "approved",
          moderationReason: comment.moderationReason || "",
          reactionCount: commentReactions.get(Number(comment.id))?.reactionsTotal || 0,
          reactionsTotal: commentReactions.get(Number(comment.id))?.reactionsTotal || 0,
          reactionCounts: commentReactions.get(Number(comment.id))?.reactionCounts || emptyReactionCounts(),
          myReaction: commentReactions.get(Number(comment.id))?.myReaction || null,
          reactors: commentReactions.get(Number(comment.id))?.reactors || [],
          reacted: Boolean(commentReactions.get(Number(comment.id))?.myReaction),
          reactionType: commentReactions.get(Number(comment.id))?.myReaction || "",
        })),
    })),
    meta: {
      ...buildMeta(count[0]?.total, page, limit),
      sort: sortKey,
      visibility: selectedVisibility || "all",
    },
  };
}

async function createPost(ctx, req, input, kind = "community") {
  const content = cleanText(input?.content, 12000);
  const encryptedContent = encryptContent(content);
  const attachments = sanitizeFeedAttachments(req?.attachments);
  const videoAttachment = attachments.find((attachment) => attachment.type === "video") || null;
  if (content.length < 2 && !attachments.length) {
    fail(422, "HR_POST_CONTENT_REQUIRED", "Escreva o conteúdo ou adicione um ficheiro.");
  }
  const visibility = ["institute", "department", "private"].includes(input?.visibility)
    ? input.visibility
    : "institute";
  const requestedPublishAt = cleanText(input?.publishAt, 50);
  const publishAt = requestedPublishAt ? mysqlUtcDateTime(requestedPublishAt) : null;
  if (requestedPublishAt && !publishAt) {
    fail(422, "HR_POST_SCHEDULE_INVALID", "A data de agendamento é inválida.");
  }
  if (publishAt && new Date(`${publishAt.replace(" ", "T")}Z`).getTime() <= Date.now()) {
    fail(422, "HR_POST_SCHEDULE_PAST", "A publicação agendada tem de estar no futuro.");
  }
  const background = normalizePostBackground(input?.background);
  const feeling = cleanText(input?.feeling, 180) || null;
  const location = cleanText(input?.location, 255) || null;
  return transaction(async (connection) => {
    const code = `HR-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
    const [result] = await connection.query(
      `INSERT INTO eduall_posts (
         ed_post_for, ed_post_user, ed_post_user_type, ed_post_code,
         ed_post_description, ed_post_links, ed_post_total_files,
         ed_post_registerdate, ed_post_deleted, ed_post_moderation_status,
         ed_post_institute_code,
         ed_post_author_employee, ed_post_kind, ed_post_visibility,
         ed_post_attachments, ed_post_background, ed_post_feeling,
         ed_post_location, ed_post_publish_at, ed_post_schedule_notified,
         ed_post_video_storage_key, ed_post_video_poster_key,
         ed_post_video_duration, ed_post_video_size,
         ed_post_video_width, ed_post_video_height
       ) VALUES (
         1, ?, 0, ?, ?, ?, ?, NOW(), 0, 'pending',
         ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
       )`,
      [
        ctx.userId, code, encryptedContent, cleanText(input.links, 5000) || null,
        attachments.length,
        ctx.instituteCode, ctx.employeeId, kind, visibility,
        JSON.stringify(attachments), background, feeling, location,
        publishAt, publishAt ? 0 : 1,
        videoAttachment?.storageKey || null,
        videoAttachment?.poster?.storageKey || null,
        videoAttachment?.duration || null,
        videoAttachment?.size || null,
        videoAttachment?.width || null,
        videoAttachment?.height || null,
      ]
    );
    await audit(connection, ctx, req, "publicar", kind === "engagement" ? "engagement_post" : "post",
      result.insertId, null, {
        content: encryptedContent,
        visibility,
        attachments: attachments.length,
        background,
        feeling,
        location,
        publishAt,
      }, input.reason);
    await recordDomainEvent(connection, ctx.instituteCode, "post.created", {
      actorId: ctx.userId,
      actorName: ctx.userName,
      actorAvatar: ctx.userPicture,
      postId: Number(result.insertId),
      authorId: ctx.userId,
      visibility,
      scheduled: Boolean(publishAt),
    });
    return {
      id: result.insertId,
      attachments,
      background,
      feeling,
      location,
      publishAt: publishAt ? `${publishAt.replace(" ", "T")}Z` : null,
      scheduled: Boolean(publishAt),
      moderationStatus: "pending",
      moderationMessage: "A tua publicação está a ser validada. Vais receber uma notificação quando for publicada.",
    };
  });
}

async function getFeedPost(ctx, id) {
  let response = await listFeed(ctx, {
    page: 1,
    limit: 1000,
    sort: "newest",
  });
  let post = (response?.data || []).find((item) => Number(item.id) === Number(id));
  if (!post) {
    response = await listFeed(ctx, {
      page: 1,
      limit: 1000,
      sort: "newest",
      scope: "mine",
    });
    post = (response?.data || []).find((item) => Number(item.id) === Number(id));
  }
  if (!post) fail(404, "HR_POST_NOT_FOUND", "Publicação não encontrada.");
  return post;
}

async function listStories(ctx) {
  const [rows] = await DATABASE.query(
    `SELECT s.ed_hr_story_id AS id,
            s.ed_hr_story_user_id AS userId,
            s.ed_hr_story_employee_id AS employeeId,
            s.ed_hr_story_slides AS slides,
            s.ed_hr_story_music_url AS musicUrl,
            s.ed_hr_story_hidden_users AS hiddenUsers,
            s.ed_hr_story_moderation_status AS moderationStatus,
            s.ed_hr_story_moderation_reason AS moderationReason,
            s.ed_hr_story_created_at AS createdAt,
            s.ed_hr_story_expires_at AS expiresAt,
            COALESCE(ua.ed_user_account_name, e.ed_employee_name, 'Utilizador') AS authorName,
            COALESCE(ua.ed_user_account_picture, e.ed_employee_picture, '') AS authorPicture
       FROM eduall_hr_stories s
       LEFT JOIN eduall_user_accounts ua
         ON ua.ed_user_account_id = s.ed_hr_story_user_id
        AND ua.ed_user_account_deleted = 0
       LEFT JOIN eduall_user_institutes ui
         ON ui.ed_user_institute_userCode = s.ed_hr_story_user_id
        AND BINARY ui.ed_user_institute_code = BINARY s.ed_hr_story_institute_code
        AND ui.ed_user_institute_deleted = 0
       LEFT JOIN eduall_employees e
         ON e.ed_employee_id = ui.ed_user_institute_employeeCode
        AND BINARY e.ed_employee_institute_code = BINARY s.ed_hr_story_institute_code
        AND e.ed_employee_deleted = 0
      WHERE BINARY s.ed_hr_story_institute_code = BINARY ?
        AND s.ed_hr_story_deleted = 0
        AND s.ed_hr_story_expires_at > NOW()
      ORDER BY s.ed_hr_story_created_at DESC, s.ed_hr_story_id DESC
      LIMIT 100`,
    [ctx.instituteCode]
  );

  const visibleRows = rows.filter((row) => {
    const moderationStatus = String(row.moderationStatus || "approved");
    if (
      moderationStatus !== "approved"
      && Number(row.userId) !== Number(ctx.userId)
      && !ctx.canModerate
    ) return false;
    if (Number(row.userId) === Number(ctx.userId)) return true;
    const hidden = parseJson(row.hiddenUsers, []);
    return !Array.isArray(hidden)
      || !hidden.some((id) => Number(id) === Number(ctx.userId));
  });
  const ids = visibleRows.map((row) => Number(row.id));
  let views = [];
  if (ids.length) {
    const placeholders = ids.map(() => "?").join(",");
    const [viewRows] = await DATABASE.query(
      `SELECT v.ed_hr_story_view_story_id AS storyId,
              v.ed_hr_story_view_user_id AS userId,
              v.ed_hr_story_view_last_seen_at AS viewedAt,
              COALESCE(ua.ed_user_account_name, e.ed_employee_name, 'Utilizador') AS viewerName,
              COALESCE(ua.ed_user_account_picture, e.ed_employee_picture, '') AS viewerPicture
         FROM eduall_hr_story_views v
         LEFT JOIN eduall_user_accounts ua
           ON ua.ed_user_account_id = v.ed_hr_story_view_user_id
          AND ua.ed_user_account_deleted = 0
         LEFT JOIN eduall_user_institutes ui
           ON ui.ed_user_institute_userCode = v.ed_hr_story_view_user_id
          AND BINARY ui.ed_user_institute_code = BINARY v.ed_hr_story_view_institute_code
          AND ui.ed_user_institute_deleted = 0
         LEFT JOIN eduall_employees e
           ON e.ed_employee_id = ui.ed_user_institute_employeeCode
          AND BINARY e.ed_employee_institute_code = BINARY v.ed_hr_story_view_institute_code
          AND e.ed_employee_deleted = 0
        WHERE BINARY v.ed_hr_story_view_institute_code = BINARY ?
          AND v.ed_hr_story_view_story_id IN (${placeholders})
        ORDER BY v.ed_hr_story_view_last_seen_at DESC`,
      [ctx.instituteCode, ...ids]
    );
    views = viewRows;
  }

  return {
    data: visibleRows.map((row) => {
      const storyId = Number(row.id);
      const isMe = Number(row.userId) === Number(ctx.userId);
      const storyViews = views.filter((view) => Number(view.storyId) === storyId);
      const slides = parseJson(row.slides, [])
        .map((slide) => ({
          type: slide.type === "video" ? "video" : "image",
          src: storyMediaUrl(pathBasename(slide.storageKey)),
          poster: slide.posterKey
            ? storyMediaUrl(pathBasename(slide.posterKey))
            : "",
          caption: cleanText(slide.caption, 500),
          language: normalizeStoryLanguages(JSON.stringify([slide.language]))[0] || "",
          duration: Math.min(30000, Math.max(1000, Number(slide.duration) || 5000)),
        }))
        .filter((slide) => slide.src);
      return {
        id: storyId,
        user: row.authorName,
        avatar: row.authorPicture || "",
        createdAt: row.createdAt,
        expiresAt: row.expiresAt,
        isMe,
        seen: storyViews.some((view) => Number(view.userId) === Number(ctx.userId)),
        music: row.musicUrl || "",
        moderationStatus: row.moderationStatus || "approved",
        moderationReason: row.moderationReason || "",
        slides,
        viewers: isMe
          ? storyViews.map((view) => ({
              id: Number(view.userId),
              name: view.viewerName,
              avatar: view.viewerPicture || "",
              time: view.viewedAt,
            }))
          : [],
      };
    }).filter((story) => story.slides.length),
  };
}

async function createStory(ctx, req, input, storyFiles) {
  const files = Array.isArray(storyFiles?.slides) ? storyFiles.slides : [];
  const posters = Array.isArray(storyFiles?.posters) ? storyFiles.posters : [];
  if (!files.length) {
    fail(422, "HR_STORY_MEDIA_REQUIRED", "Adicione pelo menos uma fotografia ou vídeo.");
  }
  if (files.length > 8) {
    fail(422, "HR_STORY_MEDIA_LIMIT", "Cada story pode ter no máximo oito ficheiros.");
  }
  if (files.some((file) => !["image", "video"].includes(file.type))) {
    fail(415, "HR_STORY_MEDIA_TYPE_INVALID", "Os slides têm de ser imagens ou vídeos.");
  }

  const captions = normalizeStoryCaptions(input?.captions);
  const languages = normalizeStoryLanguages(input?.languages);
  const durations = normalizeStoryDurations(input?.durations);
  const hiddenUsers = parseJson(input?.hiddenFrom, [])
    .map(Number)
    .filter((id) => Number.isInteger(id) && id > 0)
    .slice(0, 100);
  const posterIndexes = parseJson(input?.posterIndexes, [])
    .map(Number)
    .filter((index) => Number.isInteger(index) && index >= 0 && index < files.length);
  const posterByIndex = new Map(
    posterIndexes.map((slideIndex, posterIndex) => [slideIndex, posters[posterIndex]])
  );
  const slides = files.map((file, index) => ({
    type: file.type,
    storageKey: pathBasename(file.storageKey),
    posterKey: posterByIndex.get(index)?.storageKey
      ? pathBasename(posterByIndex.get(index).storageKey)
      : null,
    caption: cleanText(captions[index], 500),
    language: languages[index] || "",
    duration: Math.min(15000, Math.max(3000, Number(durations[index]) || 5000)),
  }));
  const uploadedMusic = storyFiles?.music;
  const musicUrl = uploadedMusic?.storageKey
    ? storyMediaUrl(pathBasename(uploadedMusic.storageKey))
    : null;

  return transaction(async (connection) => {
    const [result] = await connection.query(
      `INSERT INTO eduall_hr_stories (
         ed_hr_story_institute_code, ed_hr_story_user_id,
         ed_hr_story_employee_id, ed_hr_story_slides,
         ed_hr_story_music_url, ed_hr_story_hidden_users,
         ed_hr_story_expires_at, ed_hr_story_deleted,
         ed_hr_story_moderation_status
       ) VALUES (?, ?, ?, ?, ?, ?, DATE_ADD(NOW(), INTERVAL 24 HOUR), 0, 'pending')`,
      [
        ctx.instituteCode,
        ctx.userId,
        ctx.employeeId,
        JSON.stringify(slides),
        musicUrl || null,
        JSON.stringify(hiddenUsers),
      ]
    );
    const storyId = Number(result.insertId);
    const allMedia = [
      ...files,
      ...posters,
      ...(uploadedMusic ? [uploadedMusic] : []),
    ];
    if (allMedia.length) {
      await connection.query(
        `INSERT INTO eduall_hr_story_media (
           ed_hr_story_media_institute_code, ed_hr_story_media_story_id,
           ed_hr_story_media_storage_key, ed_hr_story_media_name,
           ed_hr_story_media_mime, ed_hr_story_media_kind,
           ed_hr_story_media_size
         ) VALUES ?`,
        [allMedia.map((file) => [
          ctx.instituteCode,
          storyId,
          pathBasename(file.storageKey),
          cleanText(file.name, 180) || "story",
          cleanText(file.mime, 120) || "application/octet-stream",
          file.type || "file",
          Math.max(0, Number(file.size) || 0),
        ])]
      );
    }
    await audit(
      connection, ctx, req, "publicar_story", "hr_story", storyId,
      null, { slides: slides.length, hasMusic: Boolean(musicUrl) }, input?.reason
    );
    return { id: storyId, slides: slides.length, expiresInHours: 24 };
  });
}

async function getStoryMedia(ctx, storageKey) {
  const [rows] = await DATABASE.query(
    `SELECT m.ed_hr_story_media_storage_key AS storageKey,
            m.ed_hr_story_media_name AS name,
            m.ed_hr_story_media_mime AS mime,
            s.ed_hr_story_user_id AS userId,
            s.ed_hr_story_hidden_users AS hiddenUsers,
            s.ed_hr_story_moderation_status AS moderationStatus
       FROM eduall_hr_story_media m
       JOIN eduall_hr_stories s
         ON s.ed_hr_story_id = m.ed_hr_story_media_story_id
        AND s.ed_hr_story_institute_code = m.ed_hr_story_media_institute_code
       WHERE m.ed_hr_story_media_storage_key = ?
         AND BINARY m.ed_hr_story_media_institute_code = BINARY ?
         AND s.ed_hr_story_deleted = 0
         AND s.ed_hr_story_expires_at > NOW()
       LIMIT 1`,
    [pathBasename(storageKey), ctx.instituteCode]
  );
  if (!rows.length) fail(404, "HR_STORY_MEDIA_NOT_FOUND", "Ficheiro do story não encontrado.");
  const hiddenUsers = parseJson(rows[0].hiddenUsers, []);
  if (
    Number(rows[0].userId) !== Number(ctx.userId)
    && String(rows[0].moderationStatus || "approved") !== "approved"
    && !ctx.canModerate
  ) {
    fail(404, "HR_STORY_MEDIA_NOT_FOUND", "Ficheiro do story não encontrado.");
  }
  if (
    Number(rows[0].userId) !== Number(ctx.userId)
    && Array.isArray(hiddenUsers)
    && hiddenUsers.some((id) => Number(id) === Number(ctx.userId))
  ) {
    fail(404, "HR_STORY_MEDIA_NOT_FOUND", "Ficheiro do story não encontrado.");
  }
  const mediaPath = safeStoryMediaPath(rows[0].storageKey);
  if (!mediaPath) fail(404, "HR_STORY_MEDIA_NOT_FOUND", "Ficheiro do story não encontrado.");
  return {
    path: mediaPath,
    name: rows[0].name,
    mime: rows[0].mime,
  };
}

async function markStoryViewed(ctx, storyId) {
  const [rows] = await DATABASE.query(
    `SELECT ed_hr_story_id AS id, ed_hr_story_user_id AS userId,
            ed_hr_story_hidden_users AS hiddenUsers
       FROM eduall_hr_stories
      WHERE ed_hr_story_id = ?
        AND BINARY ed_hr_story_institute_code = BINARY ?
        AND ed_hr_story_deleted = 0
        AND ed_hr_story_expires_at > NOW()
      LIMIT 1`,
    [Number(storyId), ctx.instituteCode]
  );
  if (!rows.length) fail(404, "HR_STORY_NOT_FOUND", "Story não encontrado ou já expirou.");
  if (Number(rows[0].userId) === Number(ctx.userId)) {
    return { storyId: Number(storyId), viewed: true };
  }
  const hiddenUsers = parseJson(rows[0].hiddenUsers, []);
  if (
    Array.isArray(hiddenUsers)
    && hiddenUsers.some((id) => Number(id) === Number(ctx.userId))
  ) {
    fail(404, "HR_STORY_NOT_FOUND", "Story não encontrado ou já expirou.");
  }
  await DATABASE.query(
    `INSERT INTO eduall_hr_story_views (
       ed_hr_story_view_institute_code, ed_hr_story_view_story_id,
       ed_hr_story_view_user_id, ed_hr_story_view_first_seen_at,
       ed_hr_story_view_last_seen_at
     ) VALUES (?, ?, ?, NOW(), NOW())
     ON DUPLICATE KEY UPDATE ed_hr_story_view_last_seen_at = NOW()`,
    [ctx.instituteCode, Number(storyId), ctx.userId]
  );
  return { storyId: Number(storyId), viewed: true };
}

async function updatePost(ctx, req, id, input) {
  return transaction(async (connection) => {
    const [rows] = await connection.query(
      `SELECT ed_hr_post_uid AS id, ed_post_user AS userId,
              ed_post_description AS content, ed_post_visibility AS visibility
         FROM eduall_posts
        WHERE ed_hr_post_uid = ? AND ed_post_institute_code = ? AND ed_post_deleted = 0
        FOR UPDATE`,
      [id, ctx.instituteCode]
    );
    if (!rows.length) fail(404, "HR_POST_NOT_FOUND", "Publicação não encontrada.");
    if (Number(rows[0].userId) !== ctx.userId && !ctx.isManager) {
      fail(403, "HR_POST_UPDATE_DENIED", "Não pode editar esta publicação.");
    }
    const content = cleanText(input?.content, 12000);
    const encryptedContent = encryptContent(content);
    if (content.length < 2) fail(422, "HR_POST_CONTENT_REQUIRED", "Escreva o conteúdo da publicação.");
    const visibility = FEED_VISIBILITIES.has(input?.visibility)
      ? input.visibility
      : normalizeFeedVisibility(rows[0].visibility, "institute");
    await connection.query(
      `UPDATE eduall_posts
          SET ed_post_description = ?, ed_post_visibility = ?,
              ed_post_moderation_status = 'pending',
              ed_post_moderation_reason = NULL,
              ed_post_updatedate = NOW()
        WHERE ed_hr_post_uid = ? AND ed_post_institute_code = ?`,
      [encryptedContent, visibility, id, ctx.instituteCode]
    );
    await audit(connection, ctx, req, "editar_publicacao", "post", id, rows[0],
      { content: encryptedContent, visibility }, input?.reason);
    return { id: Number(id), content, visibility, moderationStatus: "pending" };
  });
}

async function deletePost(ctx, req, id) {
  const result = await transaction(async (connection) => {
    const [rows] = await connection.query(
      `SELECT ed_hr_post_uid AS id, ed_post_user AS userId,
              ed_post_description AS content, ed_post_attachments AS attachments
         FROM eduall_posts
        WHERE ed_hr_post_uid = ? AND ed_post_institute_code = ? AND ed_post_deleted = 0
        FOR UPDATE`,
      [id, ctx.instituteCode]
    );
    if (!rows.length) fail(404, "HR_POST_NOT_FOUND", "Publicação não encontrada.");
    if (Number(rows[0].userId) !== ctx.userId && !ctx.isManager) {
      fail(403, "HR_POST_DELETE_DENIED", "Não pode remover esta publicação.");
    }
    await connection.query(
      `UPDATE eduall_posts SET ed_post_deleted = 1, ed_post_updatedate = NOW()
        WHERE ed_hr_post_uid = ? AND ed_post_institute_code = ?`,
      [id, ctx.instituteCode]
    );
    await audit(connection, ctx, req, "remover_publicacao", "post", id, rows[0], null, req.body?.reason);
    return {
      id: Number(id),
      attachments: parseJson(rows[0].attachments, []),
    };
  });
  const keys = new Set();
  result.attachments.forEach((attachment) => {
    if (attachment?.storageKey) keys.add(attachment.storageKey);
    if (attachment?.poster?.storageKey) keys.add(attachment.poster.storageKey);
  });
  await Promise.allSettled([...keys].map((key) => storage.delete(key)));
  return { id: result.id };
}

async function addComment(ctx, req, postId, input) {
  const text = cleanText(input?.text, 5000);
  const encryptedText = encryptContent(text);
  if (!text) fail(422, "HR_COMMENT_REQUIRED", "Escreva um comentário.");
  const ruleResult = await moderationService.synchronousCommentRules(ctx, text);
  if (ruleResult.blocked) {
    fail(
      422,
      "HR_COMMENT_MODERATION_REJECTED",
      "O comentário contém linguagem não permitida e não foi publicado."
    );
  }
  return transaction(async (connection) => {
    const [posts] = await connection.query(
      `SELECT ed_post_id AS legacyId
         FROM eduall_posts
        WHERE ed_hr_post_uid = ? AND ed_post_institute_code = ? AND ed_post_deleted = 0
          AND ed_post_moderation_status = 'approved'`,
      [postId, ctx.instituteCode]
    );
    if (!posts.length) fail(404, "HR_POST_NOT_FOUND", "Publicação não encontrada.");
    let parentId = numberOrNull(input?.parentId);
    if (parentId) {
      const [parents] = await connection.query(
        `SELECT ed_post_comment_uid AS id, ed_post_comment_parent_uid AS parentId
           FROM eduall_post_comments
          WHERE ed_post_comment_uid = ? AND ed_post_comment_post_uid = ?
            AND ed_post_comment_institute_code = ? AND ed_post_comment_deleted = 0
          LIMIT 1`,
        [parentId, postId, ctx.instituteCode]
      );
      if (!parents.length) {
        fail(422, "HR_COMMENT_PARENT_INVALID", "O comentário respondido já não está disponível.");
      }
      parentId = numberOrNull(parents[0].parentId) || parentId;
    }
    const [result] = await connection.query(
      `INSERT INTO eduall_post_comments (
         ed_post_comment_text, ed_post_comment_user, ed_post_comment_postCode,
         ed_post_comment_post_uid,
         ed_post_comment_deleted, ed_post_comment_registerDate,
         ed_post_comment_institute_code, ed_post_comment_parent_uid,
         ed_post_comment_moderation_status
       ) VALUES (?, ?, ?, ?, 0, NOW(), ?, ?, 'pending')`,
      [encryptedText, ctx.userId, posts[0].legacyId || 0, postId, ctx.instituteCode, parentId]
    );
    await audit(connection, ctx, req, "comentar", "post_comment", result.insertId,
      null, { postId: Number(postId), parentId, text: encryptedText });
    return {
      id: result.insertId,
      parentId,
      moderationStatus: "pending",
      moderationMessage: "O comentário está em análise. Só fica visível aos outros depois da validação.",
    };
  });
}

async function deleteComment(ctx, req, id) {
  return transaction(async (connection) => {
    const [rows] = await connection.query(
      `SELECT ed_post_comment_uid AS id, ed_post_comment_user AS userId
         FROM eduall_post_comments
        WHERE ed_post_comment_uid = ? AND ed_post_comment_institute_code = ?
          AND ed_post_comment_deleted = 0 FOR UPDATE`,
      [id, ctx.instituteCode]
    );
    if (!rows.length) fail(404, "HR_COMMENT_NOT_FOUND", "Comentário não encontrado.");
    if (Number(rows[0].userId) !== ctx.userId && !ctx.isManager) {
      fail(403, "HR_COMMENT_DELETE_DENIED", "Não pode remover este comentário.");
    }
    await connection.query(
      `UPDATE eduall_post_comments
          SET ed_post_comment_deleted = 1, ed_post_comment_updatedate = NOW()
        WHERE ed_post_comment_institute_code = ?
          AND (ed_post_comment_uid = ? OR ed_post_comment_parent_uid = ?)`,
      [ctx.instituteCode, id, id]
    );
    await audit(connection, ctx, req, "remover_comentario", "post_comment", id,
      rows[0], null, req.body?.reason);
    if (Number(rows[0].userId) !== Number(ctx.userId)) {
      await recordDomainEvent(connection, ctx.instituteCode, "comment.removed", {
        actorId: ctx.userId,
        actorName: ctx.userName,
        authorId: Number(rows[0].userId),
        commentId: Number(id),
        reason: cleanText(req.body?.reason, 500) || "Removido por moderação.",
      });
    }
    return { id: Number(id) };
  });
}

async function toggleReaction(ctx, req, postId, input) {
  const type = normalizeReactionType(input?.type || "love");
  if (!type) fail(422, "HR_REACTION_INVALID", "Tipo de reação inválido.");
  return transaction(async (connection) => {
    const [posts] = await connection.query(
      `SELECT p.ed_post_id AS legacyId, p.ed_post_user AS userId,
              p.ed_post_visibility AS visibility,
              p.ed_post_moderation_status AS moderationStatus,
              e.ed_employee_department AS departmentId
         FROM eduall_posts p
         LEFT JOIN eduall_employees e
           ON e.ed_employee_id = p.ed_post_author_employee
          AND e.ed_employee_institute_code = p.ed_post_institute_code
          AND e.ed_employee_deleted = 0
        WHERE p.ed_hr_post_uid = ? AND p.ed_post_institute_code = ?
          AND p.ed_post_deleted = 0`,
      [postId, ctx.instituteCode]
    );
    if (!posts.length || !canReadFeedRow(posts[0], ctx)) {
      fail(404, "HR_POST_NOT_FOUND", "Publicação não encontrada.");
    }
    const [existing] = await connection.query(
      `SELECT ed_hr_post_reaction_id AS id, ed_hr_post_reaction_type AS type,
              ed_hr_post_reaction_deleted AS deleted
         FROM eduall_hr_post_reactions
        WHERE ed_hr_post_reaction_institute_code = ?
          AND ed_hr_post_reaction_post_uid = ?
          AND ed_hr_post_reaction_user_id = ?
        FOR UPDATE`,
      [ctx.instituteCode, postId, ctx.userId]
    );
    if (existing.length && !existing[0].deleted) {
      if (existing[0].type === type) {
        await connection.query(
          `UPDATE eduall_hr_post_reactions
              SET ed_hr_post_reaction_deleted = 1,
                  ed_hr_post_reaction_updated_at = NOW()
            WHERE ed_hr_post_reaction_id = ?`,
          [existing[0].id]
        );
        const summary = await loadReactionSummaries(connection, ctx, "post", [postId]);
        return { active: false, type: null, ...summary.get(Number(postId)) };
      }
      await connection.query(
        `UPDATE eduall_hr_post_reactions
            SET ed_hr_post_reaction_type = ?, ed_hr_post_reaction_deleted = 0,
                ed_hr_post_reaction_updated_at = NOW()
          WHERE ed_hr_post_reaction_id = ?`,
        [type, existing[0].id]
      );
      const summary = await loadReactionSummaries(connection, ctx, "post", [postId]);
      return { active: true, type, ...summary.get(Number(postId)) };
    }
    if (existing.length) {
      await connection.query(
        `UPDATE eduall_hr_post_reactions
            SET ed_hr_post_reaction_type = ?, ed_hr_post_reaction_deleted = 0,
                ed_hr_post_reaction_updated_at = NOW()
          WHERE ed_hr_post_reaction_id = ?`,
        [type, existing[0].id]
      );
      const summary = await loadReactionSummaries(connection, ctx, "post", [postId]);
      return { active: true, type, ...summary.get(Number(postId)) };
    }
    await connection.query(
      `INSERT INTO eduall_hr_post_reactions (
         ed_hr_post_reaction_institute_code, ed_hr_post_reaction_post_id,
         ed_hr_post_reaction_post_uid,
         ed_hr_post_reaction_user_id, ed_hr_post_reaction_employee_id,
         ed_hr_post_reaction_type, ed_hr_post_reaction_deleted
       ) VALUES (?, ?, ?, ?, ?, ?, 0)`,
      [
        ctx.instituteCode,
        posts[0].legacyId || 0,
        postId,
        ctx.userId,
        ctx.employeeId,
        type,
      ]
    );
    await connection.query(
      `INSERT INTO post_watchers (
         ed_post_watcher_institute_code, ed_post_watcher_post_uid,
         ed_post_watcher_user_id, ed_post_watcher_source
       ) VALUES (?, ?, ?, 'reaction')
       ON DUPLICATE KEY UPDATE ed_post_watcher_updated_at = NOW()`,
      [ctx.instituteCode, Number(postId), ctx.userId]
    );
    await recordDomainEvent(connection, ctx.instituteCode, "reaction.created", {
      actorId: ctx.userId,
      actorName: ctx.userName,
      actorAvatar: ctx.userPicture,
      postId: Number(postId),
      postAuthorId: Number(posts[0].userId),
      reaction: type,
    });
    const summary = await loadReactionSummaries(connection, ctx, "post", [postId]);
    return { active: true, type, ...summary.get(Number(postId)) };
  });
}

async function toggleCommentReaction(ctx, req, commentId, input) {
  const type = normalizeReactionType(input?.type || "love");
  if (!type) fail(422, "HR_REACTION_INVALID", "Tipo de reação inválido.");
  return transaction(async (connection) => {
    const [comments] = await connection.query(
      `SELECT c.ed_post_comment_uid AS id,
              p.ed_post_user AS userId,
              p.ed_post_visibility AS visibility,
              p.ed_post_moderation_status AS moderationStatus,
              e.ed_employee_department AS departmentId
         FROM eduall_post_comments c
         JOIN eduall_posts p
           ON p.ed_hr_post_uid = c.ed_post_comment_post_uid
          AND p.ed_post_institute_code = c.ed_post_comment_institute_code
         LEFT JOIN eduall_employees e
           ON e.ed_employee_id = p.ed_post_author_employee
          AND e.ed_employee_institute_code = p.ed_post_institute_code
          AND e.ed_employee_deleted = 0
        WHERE c.ed_post_comment_uid = ?
          AND c.ed_post_comment_institute_code = ?
          AND c.ed_post_comment_deleted = 0
          AND p.ed_post_deleted = 0
        LIMIT 1`,
      [commentId, ctx.instituteCode]
    );
    if (!comments.length || !canReadFeedRow(comments[0], ctx)) {
      fail(404, "HR_COMMENT_NOT_FOUND", "Comentário não encontrado.");
    }
    const [existing] = await connection.query(
      `SELECT ed_hr_comment_reaction_id AS id,
              ed_hr_comment_reaction_type AS type,
              ed_hr_comment_reaction_deleted AS deleted
         FROM eduall_hr_comment_reactions
        WHERE ed_hr_comment_reaction_institute_code = ?
          AND ed_hr_comment_reaction_comment_uid = ?
          AND ed_hr_comment_reaction_user_id = ?
        FOR UPDATE`,
      [ctx.instituteCode, commentId, ctx.userId]
    );
    if (existing.length && !existing[0].deleted) {
      if (existing[0].type === type) {
        await connection.query(
          `UPDATE eduall_hr_comment_reactions
              SET ed_hr_comment_reaction_deleted = 1,
                  ed_hr_comment_reaction_updated_at = NOW()
            WHERE ed_hr_comment_reaction_id = ?`,
          [existing[0].id]
        );
        const summary = await loadReactionSummaries(connection, ctx, "comment", [commentId]);
        return { active: false, type: null, ...summary.get(Number(commentId)) };
      }
      await connection.query(
        `UPDATE eduall_hr_comment_reactions
            SET ed_hr_comment_reaction_type = ?, ed_hr_comment_reaction_deleted = 0,
                ed_hr_comment_reaction_updated_at = NOW()
          WHERE ed_hr_comment_reaction_id = ?`,
        [type, existing[0].id]
      );
      const summary = await loadReactionSummaries(connection, ctx, "comment", [commentId]);
      return { active: true, type, ...summary.get(Number(commentId)) };
    }
    if (existing.length) {
      await connection.query(
        `UPDATE eduall_hr_comment_reactions
            SET ed_hr_comment_reaction_type = ?, ed_hr_comment_reaction_deleted = 0,
                ed_hr_comment_reaction_updated_at = NOW()
          WHERE ed_hr_comment_reaction_id = ?`,
        [type, existing[0].id]
      );
      const summary = await loadReactionSummaries(connection, ctx, "comment", [commentId]);
      return { active: true, type, ...summary.get(Number(commentId)) };
    }
    await connection.query(
      `INSERT INTO eduall_hr_comment_reactions (
         ed_hr_comment_reaction_institute_code,
         ed_hr_comment_reaction_comment_uid,
         ed_hr_comment_reaction_user_id,
         ed_hr_comment_reaction_type,
         ed_hr_comment_reaction_deleted
       ) VALUES (?, ?, ?, ?, 0)`,
      [ctx.instituteCode, commentId, ctx.userId, type]
    );
    const summary = await loadReactionSummaries(connection, ctx, "comment", [commentId]);
    return { active: true, type, ...summary.get(Number(commentId)) };
  });
}

async function getFeedMedia(ctx, storageKey) {
  let decodedKey = storageKey;
  try { decodedKey = decodeURIComponent(storageKey); } catch { /* chave inválida */ }
  const key = safeMediaPath(decodedKey);
  if (!key) {
    fail(404, "HR_FEED_MEDIA_NOT_FOUND", "Anexo não encontrado.");
  }
  const [rows] = await DATABASE.query(
    `SELECT p.ed_post_id AS id, p.ed_post_user AS userId,
            p.ed_post_visibility AS visibility,
            p.ed_post_attachments AS attachments,
            p.ed_post_moderation_status AS moderationStatus,
            e.ed_employee_department AS departmentId
       FROM eduall_posts p
       LEFT JOIN eduall_employees e
         ON e.ed_employee_id = p.ed_post_author_employee
        AND e.ed_employee_institute_code = p.ed_post_institute_code
        AND e.ed_employee_deleted = 0
      WHERE p.ed_post_institute_code = ?
        AND p.ed_post_deleted = 0
        AND p.ed_post_attachments LIKE ?
      LIMIT 100`,
    [ctx.instituteCode, `%${key}%`]
  );
  const post = rows.find((row) =>
    parseJson(row.attachments, []).some((attachment) => (
      attachment?.storageKey === key || attachment?.poster?.storageKey === key
    ))
  );
  if (!post) fail(404, "HR_FEED_MEDIA_NOT_FOUND", "Anexo não encontrado.");
  if (!canReadFeedRow(post, ctx)) {
    fail(403, "HR_FEED_MEDIA_DENIED", "Não tem acesso a este anexo.");
  }
  const attachment = parseJson(post.attachments, [])
    .map((item) => (
      item?.storageKey === key
        ? item
        : item?.poster?.storageKey === key
          ? { ...item.poster, type: "image", name: `${item.name || "video"}-poster` }
          : null
    ))
    .find(Boolean);
  const validKey = safeMediaPath(key);
  if (!validKey) fail(404, "HR_FEED_MEDIA_NOT_FOUND", "Anexo não encontrado.");
  return { storageKey: validKey, attachment };
}

async function eligibleChatContacts(ctx) {
  const [employees, students, guardians] = await Promise.all([
    DATABASE.query(
      `SELECT DISTINCT ua.ed_user_account_id AS id,
              COALESCE(e.ed_employee_name, ua.ed_user_account_name) AS name,
              COALESCE(ua.ed_user_account_picture, e.ed_employee_picture, '') AS picture,
              COALESCE(e.ed_employee_charge, ua.ed_user_account_charge, 'Colaborador') AS role,
              'employee' AS kind,
              NULL AS age,
              NULL AS context
         FROM eduall_user_institutes ui
         JOIN eduall_user_accounts ua
           ON ua.ed_user_account_id = ui.ed_user_institute_userCode
          AND ua.ed_user_account_deleted = 0
         LEFT JOIN eduall_employees e
           ON e.ed_employee_id = ui.ed_user_institute_employeeCode
          AND e.ed_employee_institute_code = ui.ed_user_institute_code
          AND e.ed_employee_deleted = 0
        WHERE ui.ed_user_institute_code = ?
          AND ui.ed_user_institute_deleted = 0
          AND ui.ed_user_institute_employeeCode > 0
          AND ua.ed_user_account_id <> ?`,
      [ctx.instituteCode, ctx.userId]
    ),
    DATABASE.query(
      `SELECT DISTINCT ua.ed_user_account_id AS id,
              COALESCE(s.ed_student_name, ua.ed_user_account_name) AS name,
              COALESCE(s.ed_student_picture, ua.ed_user_account_picture, '') AS picture,
              'Aluno' AS role,
              'student' AS kind,
              TIMESTAMPDIFF(YEAR, s.ed_student_birthday, CURDATE()) AS age,
              COALESCE(s.ed_student_lastclass, 'Aluno') AS context
         FROM eduall_users_student_accounts sa
         JOIN eduall_user_accounts ua
           ON ua.ed_user_account_id = sa.ed_user_std_account_userCode
          AND ua.ed_user_account_deleted = 0
         JOIN eduall_students s
           ON s.ed_student_id = sa.ed_user_std_account_studentCode
          AND s.ed_student_institute_code = ?
          AND s.ed_student_deleted = 0
        WHERE sa.ed_user_std_account_instituteCode = ?
          AND sa.ed_user_std_account_deleted = 0
          AND s.ed_student_birthday IS NOT NULL
          AND s.ed_student_birthday <= DATE_SUB(CURDATE(), INTERVAL 16 YEAR)
          AND ua.ed_user_account_id <> ?`,
      [ctx.instituteCode, ctx.instituteCode, ctx.userId]
    ),
    DATABASE.query(
      `SELECT ua.ed_user_account_id AS id,
              COALESCE(MAX(p.ed_parent_name), ua.ed_user_account_name) AS name,
              COALESCE(MAX(p.ed_parent_picture), ua.ed_user_account_picture, '') AS picture,
              'Encarregado' AS role,
              'guardian' AS kind,
              NULL AS age,
              GROUP_CONCAT(DISTINCT s.ed_student_name ORDER BY s.ed_student_name SEPARATOR ', ') AS context
         FROM eduall_parent_childrens pc
         JOIN eduall_students s
           ON s.ed_student_id = pc.ed_parent_children_code
          AND s.ed_student_institute_code = ?
          AND s.ed_student_deleted = 0
         JOIN eduall_user_accounts ua
           ON ua.ed_user_account_id = pc.ed_parent_children_UserCode
          AND ua.ed_user_account_deleted = 0
         LEFT JOIN eduall_parents p
           ON LOWER(TRIM(p.ed_parent_email)) = LOWER(TRIM(ua.ed_user_account_email))
          AND p.ed_parent_deleted = 0
        WHERE pc.ed_parent_children_deleted = 0
          AND ua.ed_user_account_id <> ?
        GROUP BY ua.ed_user_account_id, ua.ed_user_account_name, ua.ed_user_account_picture`,
      [ctx.instituteCode, ctx.userId]
    ),
  ]);

  const priority = { employee: 3, student: 2, guardian: 1 };
  const byId = new Map();
  for (const row of [...employees[0], ...students[0], ...guardians[0]]) {
    const id = Number(row.id);
    const current = byId.get(id);
    if (!current || priority[row.kind] > priority[current.kind]) {
      byId.set(id, {
        id,
        name: row.name || "Utilizador",
        picture: row.picture || "",
        role: row.role || "",
        kind: row.kind,
        age: row.age == null ? null : Number(row.age),
        context: row.context || "",
      });
    }
  }
  return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name, "pt"));
}

async function listChatContacts(ctx, query = {}) {
  const online = new Set(realtime.onlineUserIds(ctx.instituteCode).map(Number));
  let contacts = await eligibleChatContacts(ctx);
  if (query.kind && ["employee", "student", "guardian"].includes(query.kind)) {
    contacts = contacts.filter((item) => item.kind === query.kind);
  }
  if (query.search) {
    const term = cleanText(query.search, 200).toLowerCase();
    contacts = contacts.filter((item) =>
      `${item.name} ${item.role} ${item.context}`.toLowerCase().includes(term)
    );
  }
  return contacts.map((item) => ({
    ...item,
    online: online.has(item.id),
  }));
}

async function assertConversationMember(ctx, conversationId, connection = DATABASE, lock = false) {
  const [rows] = await connection.query(
    `SELECT c.ed_hr_chat_conversation_id AS id,
            c.ed_hr_chat_conversation_type AS type,
            c.ed_hr_chat_conversation_name AS name,
            c.ed_hr_chat_conversation_description AS description,
            c.ed_hr_chat_conversation_picture AS picture,
            c.ed_hr_chat_conversation_visibility AS visibility,
            c.ed_hr_chat_conversation_join_policy AS joinPolicy,
            c.ed_hr_chat_conversation_created_by AS createdBy,
            p.ed_hr_chat_participant_role AS role
       FROM eduall_hr_chat_conversations c
       JOIN eduall_hr_chat_participants p
         ON p.ed_hr_chat_participant_conversation_id = c.ed_hr_chat_conversation_id
        AND p.ed_hr_chat_participant_user_id = ?
        AND p.ed_hr_chat_participant_deleted = 0
      WHERE c.ed_hr_chat_conversation_id = ?
        AND c.ed_hr_chat_conversation_institute_code = ?
        AND c.ed_hr_chat_conversation_deleted = 0
      LIMIT 1
      ${lock ? "FOR UPDATE" : ""}`,
    [ctx.userId, conversationId, ctx.instituteCode]
  );
  if (!rows.length) fail(404, "HR_CHAT_CONVERSATION_NOT_FOUND", "Conversa não encontrada.");
  return rows[0];
}

async function listChatConversations(ctx) {
  const [conversations] = await DATABASE.query(
    `SELECT c.ed_hr_chat_conversation_id AS id,
            c.ed_hr_chat_conversation_type AS type,
            c.ed_hr_chat_conversation_name AS name,
            c.ed_hr_chat_conversation_description AS description,
            c.ed_hr_chat_conversation_picture AS picture,
            c.ed_hr_chat_conversation_visibility AS visibility,
            c.ed_hr_chat_conversation_join_policy AS joinPolicy,
            c.ed_hr_chat_conversation_created_by AS createdBy,
            c.ed_hr_chat_conversation_updated_at AS updatedAt,
            p.ed_hr_chat_participant_role AS role
       FROM eduall_hr_chat_conversations c
       JOIN eduall_hr_chat_participants p
         ON p.ed_hr_chat_participant_conversation_id = c.ed_hr_chat_conversation_id
        AND p.ed_hr_chat_participant_user_id = ?
        AND p.ed_hr_chat_participant_deleted = 0
      WHERE c.ed_hr_chat_conversation_institute_code = ?
        AND c.ed_hr_chat_conversation_deleted = 0
      ORDER BY c.ed_hr_chat_conversation_updated_at DESC
      LIMIT 300`,
    [ctx.userId, ctx.instituteCode]
  );
  const ids = conversations.map((row) => Number(row.id));
  if (!ids.length) return [];
  const placeholders = ids.map(() => "?").join(",");
  const [participants, latestMessages, reads, unreadRows] = await Promise.all([
    DATABASE.query(
      `SELECT p.ed_hr_chat_participant_conversation_id AS conversationId,
              p.ed_hr_chat_participant_user_id AS userId,
              p.ed_hr_chat_participant_role AS role,
              COALESCE(e.ed_employee_name, ua.ed_user_account_name, 'Utilizador') AS name,
              COALESCE(ua.ed_user_account_picture, e.ed_employee_picture, '') AS picture,
              CASE WHEN e.ed_employee_id IS NOT NULL THEN 'employee' ELSE 'user' END AS kind
         FROM eduall_hr_chat_participants p
         JOIN eduall_user_accounts ua
           ON ua.ed_user_account_id = p.ed_hr_chat_participant_user_id
          AND ua.ed_user_account_deleted = 0
         LEFT JOIN eduall_employees e
           ON e.ed_employee_institute_code = ?
          AND LOWER(TRIM(e.ed_employee_email)) = LOWER(TRIM(ua.ed_user_account_email))
          AND e.ed_employee_deleted = 0
        WHERE p.ed_hr_chat_participant_conversation_id IN (${placeholders})
          AND p.ed_hr_chat_participant_deleted = 0`,
      [ctx.instituteCode, ...ids]
    ),
    DATABASE.query(
      `SELECT m.ed_hr_chat_message_uid AS id,
              m.ed_chat_message_conversation_id AS conversationId,
              m.ed_chat_message_from AS fromUserId,
              m.ed_chat_message_content AS content,
              m.ed_chat_message_type AS type,
              m.ed_chat_message_registertime AS createdAt
         FROM eduall_chat_messages m
         JOIN (
           SELECT ed_chat_message_conversation_id, MAX(ed_hr_chat_message_uid) AS latestId
             FROM eduall_chat_messages
            WHERE ed_chat_message_institute_code = ?
              AND ed_chat_message_deleted = 0
              AND ed_chat_message_conversation_id IN (${placeholders})
            GROUP BY ed_chat_message_conversation_id
         ) latest ON latest.latestId = m.ed_hr_chat_message_uid`,
      [ctx.instituteCode, ...ids]
    ),
    DATABASE.query(
      `SELECT ed_hr_chat_read_conversation_id AS conversationId,
              ed_hr_chat_read_last_message_uid AS lastMessageId
         FROM eduall_hr_chat_reads
        WHERE ed_hr_chat_read_user_id = ?
          AND ed_hr_chat_read_conversation_id IN (${placeholders})`,
      [ctx.userId, ...ids]
    ),
    DATABASE.query(
      `SELECT m.ed_chat_message_conversation_id AS conversationId,
              COUNT(*) AS unread
         FROM eduall_chat_messages m
         LEFT JOIN eduall_hr_chat_reads r
           ON r.ed_hr_chat_read_conversation_id = m.ed_chat_message_conversation_id
          AND r.ed_hr_chat_read_user_id = ?
        WHERE m.ed_chat_message_institute_code = ?
          AND m.ed_chat_message_deleted = 0
          AND m.ed_chat_message_from <> ?
          AND m.ed_hr_chat_message_uid > COALESCE(r.ed_hr_chat_read_last_message_uid, 0)
          AND m.ed_chat_message_conversation_id IN (${placeholders})
        GROUP BY m.ed_chat_message_conversation_id`,
      [ctx.userId, ctx.instituteCode, ctx.userId, ...ids]
    ),
  ]);
  const online = new Set(realtime.onlineUserIds(ctx.instituteCode).map(Number));
  const participantsByConversation = new Map();
  participants[0].forEach((row) => {
    const key = Number(row.conversationId);
    const list = participantsByConversation.get(key) || [];
    list.push({
      id: Number(row.userId),
      name: row.name,
      picture: row.picture || "",
      role: row.role,
      kind: row.kind,
      online: online.has(Number(row.userId)),
    });
    participantsByConversation.set(key, list);
  });
  const latestByConversation = new Map(latestMessages[0].map((row) => [Number(row.conversationId), row]));
  const readByConversation = new Map(reads[0].map((row) => [Number(row.conversationId), Number(row.lastMessageId)]));
  const unreadByConversation = new Map(unreadRows[0].map((row) => [Number(row.conversationId), Number(row.unread)]));

  return conversations.map((row) => {
    const id = Number(row.id);
    const members = participantsByConversation.get(id) || [];
    const other = row.type === "direct" ? members.find((member) => member.id !== ctx.userId) : null;
    const latest = latestByConversation.get(id);
    return {
      id,
      type: row.type,
      name: row.type === "group" ? row.name || "Grupo" : other?.name || "Conversa",
      picture: row.type === "group" ? row.picture || "" : other?.picture || "",
      otherUserId: row.type === "direct" ? other?.id || null : null,
      role: row.type === "group" ? `${members.length} participantes` : other?.role || "",
      kind: row.type === "group" ? "group" : other?.kind || "user",
      online: row.type === "group"
        ? members.some((member) => member.online && member.id !== ctx.userId)
        : Boolean(other?.online),
      members,
      memberCount: members.length,
      roleInConversation: row.role,
      canManage: row.type === "group" && (row.role === "admin" || Number(row.createdBy) === ctx.userId),
      description: row.description || "",
      visibility: row.visibility || "private",
      joinPolicy: row.joinPolicy || "invite",
      unread: unreadByConversation.get(id) || 0,
      lastReadMessageId: readByConversation.get(id) || 0,
      latestMessage: latest
        ? {
            id: Number(latest.id),
            fromUserId: Number(latest.fromUserId),
            content: safeDecryptContent(latest.content || ""),
            type: latest.type || "text",
            createdAt: latest.createdAt,
            mine: Number(latest.fromUserId) === ctx.userId,
          }
        : null,
      updatedAt: latest?.createdAt || row.updatedAt,
    };
  }).sort((a, b) => new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0));
}

async function listDiscoverableChatGroups(ctx, query = {}) {
  const limit = Math.min(100, Math.max(1, Number.parseInt(query.limit, 10) || 20));
  const params = [ctx.instituteCode, ctx.userId];
  let where = `c.ed_hr_chat_conversation_institute_code = ?
    AND c.ed_hr_chat_conversation_type = 'group'
    AND c.ed_hr_chat_conversation_visibility = 'public'
    AND c.ed_hr_chat_conversation_join_policy = 'open'
    AND c.ed_hr_chat_conversation_deleted = 0
    AND NOT EXISTS (
      SELECT 1 FROM eduall_hr_chat_participants mine
       WHERE mine.ed_hr_chat_participant_conversation_id = c.ed_hr_chat_conversation_id
         AND mine.ed_hr_chat_participant_user_id = ?
         AND mine.ed_hr_chat_participant_deleted = 0
    )`;
  if (query.search) {
    where += " AND (LOWER(c.ed_hr_chat_conversation_name) LIKE ? OR LOWER(COALESCE(c.ed_hr_chat_conversation_description, '')) LIKE ?)";
    const term = `%${cleanText(query.search, 200).toLowerCase()}%`;
    params.push(term, term);
  }
  const [rows] = await DATABASE.query(
    `SELECT c.ed_hr_chat_conversation_id AS id,
            c.ed_hr_chat_conversation_name AS name,
            c.ed_hr_chat_conversation_description AS description,
            c.ed_hr_chat_conversation_picture AS picture,
            c.ed_hr_chat_conversation_visibility AS visibility,
            c.ed_hr_chat_conversation_join_policy AS joinPolicy,
            c.ed_hr_chat_conversation_updated_at AS updatedAt,
            (
              SELECT COUNT(*) FROM eduall_hr_chat_participants p
               WHERE p.ed_hr_chat_participant_conversation_id = c.ed_hr_chat_conversation_id
                 AND p.ed_hr_chat_participant_deleted = 0
            ) AS memberCount
       FROM eduall_hr_chat_conversations c
      WHERE ${where}
      ORDER BY memberCount DESC, c.ed_hr_chat_conversation_updated_at DESC
      LIMIT ?`,
    [...params, limit]
  );
  return rows.map((row) => ({
    id: Number(row.id),
    type: "group",
    name: row.name || "Grupo",
    picture: row.picture || "",
    description: row.description || "",
    visibility: row.visibility || "public",
    joinPolicy: row.joinPolicy || "open",
    memberCount: Number(row.memberCount || 0),
    updatedAt: row.updatedAt,
  }));
}

async function joinChatGroup(ctx, req, conversationId) {
  return transaction(async (connection) => {
    const [rows] = await connection.query(
      `SELECT ed_hr_chat_conversation_id AS id,
              ed_hr_chat_conversation_type AS type,
              ed_hr_chat_conversation_visibility AS visibility,
              ed_hr_chat_conversation_join_policy AS joinPolicy
         FROM eduall_hr_chat_conversations
        WHERE ed_hr_chat_conversation_id = ?
          AND ed_hr_chat_conversation_institute_code = ?
          AND ed_hr_chat_conversation_deleted = 0
        FOR UPDATE`,
      [Number(conversationId), ctx.instituteCode]
    );
    const group = rows[0];
    if (
      !group
      || group.type !== "group"
      || group.visibility !== "public"
      || group.joinPolicy !== "open"
    ) {
      fail(404, "HR_CHAT_GROUP_NOT_JOINABLE", "Este grupo não está disponível para entrada.");
    }
    const [membership] = await connection.query(
      `SELECT ed_hr_chat_participant_id AS id
         FROM eduall_hr_chat_participants
        WHERE ed_hr_chat_participant_conversation_id = ?
          AND ed_hr_chat_participant_user_id = ?
          AND ed_hr_chat_participant_deleted = 0
        LIMIT 1`,
      [group.id, ctx.userId]
    );
    if (!membership.length) {
      await connection.query(
        `INSERT INTO eduall_hr_chat_participants (
           ed_hr_chat_participant_conversation_id,
           ed_hr_chat_participant_user_id,
           ed_hr_chat_participant_role,
           ed_hr_chat_participant_added_by
         ) VALUES (?, ?, 'member', ?)
         ON DUPLICATE KEY UPDATE
           ed_hr_chat_participant_deleted = 0,
           ed_hr_chat_participant_added_by = VALUES(ed_hr_chat_participant_added_by)`,
        [group.id, ctx.userId, ctx.userId]
      );
      await audit(
        connection, ctx, req, "entrar_grupo_chat", "chat_group", group.id,
        null, { visibility: group.visibility, joinPolicy: group.joinPolicy }
      );
    }
    return { id: Number(group.id), joined: true };
  });
}

async function leaveChatGroup(ctx, req, conversationId) {
  return transaction(async (connection) => {
    const conversation = await assertConversationMember(
      ctx, Number(conversationId), connection, true
    );
    if (conversation.type !== "group") {
      fail(422, "HR_CHAT_GROUP_REQUIRED", "Só é possível sair de um grupo.");
    }
    if (conversation.role === "admin" || Number(conversation.createdBy) === ctx.userId) {
      const [admins] = await connection.query(
        `SELECT COUNT(*) AS total
           FROM eduall_hr_chat_participants
          WHERE ed_hr_chat_participant_conversation_id = ?
            AND ed_hr_chat_participant_role = 'admin'
            AND ed_hr_chat_participant_deleted = 0`,
        [conversation.id]
      );
      if (Number(admins[0]?.total || 0) <= 1) {
        fail(409, "HR_CHAT_GROUP_LAST_ADMIN", "Transfira a administração antes de sair do grupo.");
      }
    }
    await connection.query(
      `UPDATE eduall_hr_chat_participants
          SET ed_hr_chat_participant_deleted = 1
        WHERE ed_hr_chat_participant_conversation_id = ?
          AND ed_hr_chat_participant_user_id = ?`,
      [conversation.id, ctx.userId]
    );
    await audit(
      connection, ctx, req, "sair_grupo_chat", "chat_group", conversation.id,
      { role: conversation.role }, null
    );
    return { id: Number(conversation.id), left: true };
  });
}

async function openDirectChat(ctx, targetUserId) {
  const target = Number(targetUserId);
  const contacts = await eligibleChatContacts(ctx);
  const contact = contacts.find((item) => item.id === target);
  if (!contact) fail(404, "HR_CONTACT_NOT_FOUND", "Contacto não elegível para conversa.");
  const key = [ctx.userId, target].sort((a, b) => a - b).join(":");
  return transaction(async (connection) => {
    await connection.query(
      `INSERT INTO eduall_hr_chat_conversations (
         ed_hr_chat_conversation_institute_code,
         ed_hr_chat_conversation_type,
         ed_hr_chat_conversation_direct_key,
         ed_hr_chat_conversation_created_by
       ) VALUES (?, 'direct', ?, ?)
       ON DUPLICATE KEY UPDATE
         ed_hr_chat_conversation_deleted = 0,
         ed_hr_chat_conversation_updated_at = NOW()`,
      [ctx.instituteCode, key, ctx.userId]
    );
    const [rows] = await connection.query(
      `SELECT ed_hr_chat_conversation_id AS id
         FROM eduall_hr_chat_conversations
        WHERE ed_hr_chat_conversation_institute_code = ?
          AND ed_hr_chat_conversation_direct_key = ?
        LIMIT 1`,
      [ctx.instituteCode, key]
    );
    const conversationId = Number(rows[0].id);
    for (const userId of [ctx.userId, target]) {
      await connection.query(
        `INSERT INTO eduall_hr_chat_participants (
           ed_hr_chat_participant_conversation_id,
           ed_hr_chat_participant_user_id,
           ed_hr_chat_participant_role,
           ed_hr_chat_participant_added_by
         ) VALUES (?, ?, 'member', ?)
         ON DUPLICATE KEY UPDATE ed_hr_chat_participant_deleted = 0`,
        [conversationId, userId, ctx.userId]
      );
    }
    return { conversationId, contact };
  });
}

async function addChatParticipantsToConversation(connection, ctx, conversationId, userIds) {
  const unique = [...new Set(userIds.map(Number).filter((id) => id && id !== ctx.userId))];
  for (const userId of unique) {
    await connection.query(
      `INSERT INTO eduall_hr_chat_participants (
         ed_hr_chat_participant_conversation_id,
         ed_hr_chat_participant_user_id,
         ed_hr_chat_participant_role,
         ed_hr_chat_participant_added_by
       ) VALUES (?, ?, 'member', ?)
       ON DUPLICATE KEY UPDATE
         ed_hr_chat_participant_deleted = 0,
         ed_hr_chat_participant_added_by = VALUES(ed_hr_chat_participant_added_by)`,
      [conversationId, userId, ctx.userId]
    );
  }
}

async function createChatGroup(ctx, req, input) {
  const name = cleanText(input?.name, 180);
  if (name.length < 2) fail(422, "HR_CHAT_GROUP_NAME_REQUIRED", "Indique o nome do grupo.");
  const requested = Array.isArray(input?.participantIds) ? input.participantIds : [];
  const eligible = new Set((await eligibleChatContacts(ctx)).map((item) => item.id));
  const participantIds = [...new Set(requested.map(Number))]
    .filter((id) => eligible.has(id) && id !== ctx.userId);
  const visibility = input?.visibility === "public" ? "public" : "private";
  const joinPolicy = visibility === "public" && input?.joinPolicy === "open"
    ? "open"
    : "invite";
  if (!participantIds.length && !(visibility === "public" && joinPolicy === "open")) {
    fail(422, "HR_CHAT_GROUP_MEMBERS_REQUIRED", "Adicione pelo menos um participante.");
  }
  const description = cleanText(input?.description, 500) || null;
  return transaction(async (connection) => {
    const [result] = await connection.query(
      `INSERT INTO eduall_hr_chat_conversations (
         ed_hr_chat_conversation_institute_code,
         ed_hr_chat_conversation_type,
         ed_hr_chat_conversation_name,
         ed_hr_chat_conversation_description,
         ed_hr_chat_conversation_visibility,
         ed_hr_chat_conversation_join_policy,
         ed_hr_chat_conversation_created_by
       ) VALUES (?, 'group', ?, ?, ?, ?, ?)`,
      [ctx.instituteCode, name, description, visibility, joinPolicy, ctx.userId]
    );
    const conversationId = Number(result.insertId);
    await connection.query(
      `INSERT INTO eduall_hr_chat_participants (
         ed_hr_chat_participant_conversation_id,
         ed_hr_chat_participant_user_id,
         ed_hr_chat_participant_role,
         ed_hr_chat_participant_added_by
       ) VALUES (?, ?, 'admin', ?)`,
      [conversationId, ctx.userId, ctx.userId]
    );
    await addChatParticipantsToConversation(connection, ctx, conversationId, participantIds);
    const adminIds = [...new Set(
      (Array.isArray(input?.adminIds) ? input.adminIds : [])
        .map(Number)
        .filter((id) => participantIds.includes(id))
    )];
    if (adminIds.length) {
      await connection.query(
        `UPDATE eduall_hr_chat_participants
            SET ed_hr_chat_participant_role = 'admin'
          WHERE ed_hr_chat_participant_conversation_id = ?
            AND ed_hr_chat_participant_user_id IN (${adminIds.map(() => "?").join(",")})
            AND ed_hr_chat_participant_deleted = 0`,
        [conversationId, ...adminIds]
      );
    }
    await audit(connection, ctx, req, "criar_grupo_chat", "chat_group", conversationId,
      null, { name, description, visibility, joinPolicy, participantIds, adminIds });
    return { id: conversationId };
  });
}

async function updateChatGroup(ctx, req, conversationId, input) {
  return transaction(async (connection) => {
    const conversation = await assertConversationMember(ctx, Number(conversationId), connection, true);
    if (conversation.type !== "group" || (conversation.role !== "admin" && Number(conversation.createdBy) !== ctx.userId)) {
      fail(403, "HR_CHAT_GROUP_ADMIN_REQUIRED", "Só os administradores podem editar o grupo.");
    }
    const name = cleanText(input?.name, 180);
    if (name.length < 2) fail(422, "HR_CHAT_GROUP_NAME_REQUIRED", "Indique o nome do grupo.");
    const visibility = input?.visibility === undefined
      ? conversation.visibility || "private"
      : input.visibility === "public" ? "public" : "private";
    const joinPolicy = visibility === "public" && input?.joinPolicy === "open"
      ? "open"
      : visibility === "public" && conversation.visibility === "public"
        ? conversation.joinPolicy || "invite"
        : "invite";
    const description = cleanText(input?.description, 500) || null;
    await connection.query(
      `UPDATE eduall_hr_chat_conversations
          SET ed_hr_chat_conversation_name = ?,
              ed_hr_chat_conversation_description = ?,
              ed_hr_chat_conversation_visibility = ?,
              ed_hr_chat_conversation_join_policy = ?,
              ed_hr_chat_conversation_updated_at = NOW()
        WHERE ed_hr_chat_conversation_id = ?
          AND ed_hr_chat_conversation_institute_code = ?`,
      [name, description, visibility, joinPolicy, conversationId, ctx.instituteCode]
    );
    if (Array.isArray(input?.participantIds)) {
      const eligible = new Set((await eligibleChatContacts(ctx)).map((item) => item.id));
      const ids = [...new Set(input.participantIds.map(Number))]
        .filter((id) => eligible.has(id) && id !== ctx.userId);
      await addChatParticipantsToConversation(connection, ctx, conversationId, ids);
      if (ids.length) {
        await connection.query(
          `UPDATE eduall_hr_chat_participants
              SET ed_hr_chat_participant_deleted = 1
            WHERE ed_hr_chat_participant_conversation_id = ?
              AND ed_hr_chat_participant_user_id <> ?
              AND ed_hr_chat_participant_role <> 'admin'
              AND ed_hr_chat_participant_user_id NOT IN (${ids.map(() => "?").join(",")})`,
          [conversationId, ctx.userId, ...ids]
        );
      }
    }
    if (Array.isArray(input?.adminIds)) {
      const requestedAdmins = new Set(input.adminIds.map(Number).filter(Boolean));
      await connection.query(
        `UPDATE eduall_hr_chat_participants
            SET ed_hr_chat_participant_role = 'member'
          WHERE ed_hr_chat_participant_conversation_id = ?
            AND ed_hr_chat_participant_user_id <> ?
            AND ed_hr_chat_participant_deleted = 0`,
        [conversationId, ctx.userId]
      );
      const adminIds = [...requestedAdmins];
      if (adminIds.length) {
        await connection.query(
          `UPDATE eduall_hr_chat_participants
              SET ed_hr_chat_participant_role = 'admin'
            WHERE ed_hr_chat_participant_conversation_id = ?
              AND ed_hr_chat_participant_user_id IN (${adminIds.map(() => "?").join(",")})
              AND ed_hr_chat_participant_deleted = 0`,
          [conversationId, ...adminIds]
        );
      }
    }
    await audit(connection, ctx, req, "editar_grupo_chat", "chat_group", conversationId,
      conversation, {
        name,
        description,
        visibility,
        joinPolicy,
        participantIds: input?.participantIds,
        adminIds: input?.adminIds,
      });
    return { id: Number(conversationId) };
  });
}

async function updateChatGroupAvatar(ctx, req, conversationId, input) {
  return transaction(async (connection) => {
    const conversation = await assertConversationMember(ctx, Number(conversationId), connection, true);
    if (conversation.type !== "group" || (conversation.role !== "admin" && Number(conversation.createdBy) !== ctx.userId)) {
      fail(403, "HR_CHAT_GROUP_ADMIN_REQUIRED", "Só os administradores podem alterar a imagem do grupo.");
    }
    const picture = cleanText(input?.picture, 500);
    if (!picture.startsWith("/api/hr/chat/media/")) {
      fail(422, "HR_CHAT_GROUP_PICTURE_INVALID", "A imagem do grupo é inválida.");
    }
    await connection.query(
      `UPDATE eduall_hr_chat_conversations
          SET ed_hr_chat_conversation_pending_picture = ?,
              ed_hr_chat_conversation_picture_moderation_status = 'pending',
              ed_hr_chat_conversation_picture_moderation_reason = NULL,
              ed_hr_chat_conversation_updated_at = NOW()
        WHERE ed_hr_chat_conversation_id = ?
          AND ed_hr_chat_conversation_institute_code = ?`,
      [picture, Number(conversationId), ctx.instituteCode]
    );
    await audit(
      connection, ctx, req, "alterar_imagem_grupo_chat", "chat_group",
      conversationId, { picture: conversation.picture || "" }, { picture }
    );
    return {
      id: Number(conversationId),
      picture: conversation.picture || "",
      pendingPicture: picture,
      moderationStatus: "pending",
    };
  });
}

async function deleteChatGroup(ctx, req, conversationId) {
  return transaction(async (connection) => {
    const conversation = await assertConversationMember(ctx, Number(conversationId), connection, true);
    if (conversation.type !== "group" || (conversation.role !== "admin" && Number(conversation.createdBy) !== ctx.userId)) {
      fail(403, "HR_CHAT_GROUP_ADMIN_REQUIRED", "Só os administradores podem apagar o grupo.");
    }
    await connection.query(
      `UPDATE eduall_hr_chat_conversations
          SET ed_hr_chat_conversation_deleted = 1, ed_hr_chat_conversation_updated_at = NOW()
        WHERE ed_hr_chat_conversation_id = ?
          AND ed_hr_chat_conversation_institute_code = ?`,
      [conversationId, ctx.instituteCode]
    );
    await audit(connection, ctx, req, "apagar_grupo_chat", "chat_group", conversationId,
      conversation, null);
    return { id: Number(conversationId) };
  });
}

async function listChatMessages(ctx, conversationId) {
  await assertConversationMember(ctx, Number(conversationId));
  const [rows] = await DATABASE.query(
    `SELECT m.ed_hr_chat_message_uid AS id,
            m.ed_chat_message_from AS fromUserId,
            m.ed_chat_message_content AS content,
            m.ed_chat_message_type AS type,
            m.ed_chat_message_attachments AS attachments,
            m.ed_chat_message_reply_to_uid AS replyToId,
            m.ed_chat_message_registertime AS createdAt,
            m.ed_chat_message_edited_at AS editedAt,
            COALESCE(e.ed_employee_name, ua.ed_user_account_name, 'Utilizador') AS authorName,
            COALESCE(ua.ed_user_account_picture, e.ed_employee_picture, '') AS authorPicture
       FROM eduall_chat_messages m
       LEFT JOIN eduall_user_accounts ua
         ON ua.ed_user_account_id = m.ed_chat_message_from
       LEFT JOIN eduall_employees e
         ON e.ed_employee_institute_code = m.ed_chat_message_institute_code
        AND LOWER(TRIM(e.ed_employee_email)) = LOWER(TRIM(ua.ed_user_account_email))
        AND e.ed_employee_deleted = 0
      WHERE m.ed_chat_message_institute_code = ?
        AND m.ed_chat_message_conversation_id = ?
        AND m.ed_chat_message_deleted = 0
      ORDER BY m.ed_hr_chat_message_uid ASC
      LIMIT 500`,
    [ctx.instituteCode, conversationId]
  );
  const messageIds = rows.map((row) => Number(row.id));
  const reactionsByMessage = new Map();
  if (messageIds.length) {
    const [reactionRows] = await DATABASE.query(
      `SELECT ed_hr_chat_message_reaction_message_uid AS messageId,
              ed_hr_chat_message_reaction_key AS reactionKey,
              ed_hr_chat_message_reaction_user_id AS userId
         FROM eduall_hr_chat_message_reactions
        WHERE ed_hr_chat_message_reaction_institute_code = ?
          AND ed_hr_chat_message_reaction_message_uid IN (${messageIds.map(() => "?").join(",")})
          AND ed_hr_chat_message_reaction_deleted = 0
        ORDER BY ed_hr_chat_message_reaction_created_at ASC`,
      [ctx.instituteCode, ...messageIds]
    );
    reactionRows.forEach((row) => {
      const key = String(row.reactionKey || "").slice(0, 30);
      if (!key) return;
      const list = reactionsByMessage.get(Number(row.messageId)) || [];
      const existing = list.find((item) => item.key === key);
      const userId = Number(row.userId) === ctx.userId ? "me" : Number(row.userId);
      if (existing) existing.users.push(userId);
      else list.push({ key, users: [userId] });
      reactionsByMessage.set(Number(row.messageId), list);
    });
  }
  return rows.map((row) => ({
    id: Number(row.id),
    fromUserId: Number(row.fromUserId),
    authorName: row.authorName,
    authorPicture: row.authorPicture || "",
    content: safeDecryptContent(row.content || ""),
    type: row.type || "text",
    attachments: revealChatAttachments(row.attachments),
    replyToId: row.replyToId ? Number(row.replyToId) : null,
    createdAt: row.createdAt,
    editedAt: row.editedAt,
    mine: Number(row.fromUserId) === ctx.userId,
    reactions: reactionsByMessage.get(Number(row.id)) || [],
  }));
}

async function getChatMedia(ctx, storageKey) {
  const key = pathBasename(storageKey);
  const filePath = safeChatMediaPath(key);
  if (!key || !filePath) {
    fail(404, "HR_CHAT_MEDIA_NOT_FOUND", "Anexo não encontrado.");
  }
  const [rows] = await DATABASE.query(
    `SELECT m.ed_chat_message_attachments AS attachments
       FROM eduall_chat_messages m
       JOIN eduall_hr_chat_participants p
         ON p.ed_hr_chat_participant_conversation_id = m.ed_chat_message_conversation_id
        AND p.ed_hr_chat_participant_user_id = ?
        AND p.ed_hr_chat_participant_deleted = 0
      WHERE m.ed_chat_message_institute_code = ?
        AND m.ed_chat_message_deleted = 0
        AND m.ed_chat_message_attachments LIKE ?
      LIMIT 100`,
    [ctx.userId, ctx.instituteCode, `%${key}%`]
  );
  const attachment = rows
    .flatMap((row) => parseJson(row.attachments, []))
    .find((item) => item?.storageKey === key);
  if (attachment) return { path: filePath, attachment };

  const [avatarRows] = await DATABASE.query(
    `SELECT c.ed_hr_chat_conversation_picture AS picture
       FROM eduall_hr_chat_conversations c
       JOIN eduall_hr_chat_participants p
         ON p.ed_hr_chat_participant_conversation_id = c.ed_hr_chat_conversation_id
        AND p.ed_hr_chat_participant_user_id = ?
        AND p.ed_hr_chat_participant_deleted = 0
      WHERE c.ed_hr_chat_conversation_institute_code = ?
        AND c.ed_hr_chat_conversation_type = 'group'
        AND c.ed_hr_chat_conversation_picture LIKE ?
        AND c.ed_hr_chat_conversation_deleted = 0
      LIMIT 20`,
    [ctx.userId, ctx.instituteCode, `%${encodeURIComponent(key)}%`]
  );
  const avatar = avatarRows.find((row) => {
    const picture = String(row.picture || "").split("?")[0];
    const pictureKey = picture.split("/").pop();
    try {
      return decodeURIComponent(pictureKey) === key;
    } catch {
      return pictureKey === key;
    }
  });
  const storedAttachment = avatar ? attachmentFromStorageKey(key) : null;
  if (!storedAttachment) {
    fail(404, "HR_CHAT_MEDIA_NOT_FOUND", "Anexo não encontrado.");
  }
  return { path: filePath, attachment: storedAttachment };
}

async function editableChatMessage(ctx, conversationId, messageId, connection, lock = false) {
  const [rows] = await connection.query(
    `SELECT ed_hr_chat_message_uid AS id,
            ed_chat_message_from AS fromUserId,
            ed_chat_message_type AS type,
            ed_chat_message_content AS content
       FROM eduall_chat_messages
      WHERE ed_hr_chat_message_uid = ?
        AND ed_chat_message_conversation_id = ?
        AND ed_chat_message_institute_code = ?
        AND ed_chat_message_deleted = 0
      LIMIT 1
      ${lock ? "FOR UPDATE" : ""}`,
    [messageId, conversationId, ctx.instituteCode]
  );
  if (!rows.length) fail(404, "HR_CHAT_MESSAGE_NOT_FOUND", "Mensagem não encontrada.");
  if (Number(rows[0].fromUserId) !== ctx.userId && !ctx.isManager) {
    fail(403, "HR_CHAT_MESSAGE_DENIED", "Não pode alterar esta mensagem.");
  }
  return rows[0];
}

async function editChatMessage(ctx, req, conversationId, messageId, input) {
  await assertConversationMember(ctx, Number(conversationId));
  const content = cleanText(input?.content, 10000);
  const encryptedContent = encryptContent(content);
  if (!content) fail(422, "HR_MESSAGE_REQUIRED", "Escreva uma mensagem.");
  return transaction(async (connection) => {
    const message = await editableChatMessage(ctx, Number(conversationId), Number(messageId), connection, true);
    await connection.query(
      `UPDATE eduall_chat_messages
          SET ed_chat_message_content = ?, ed_chat_message_edited_at = NOW()
        WHERE ed_hr_chat_message_uid = ?
          AND ed_chat_message_conversation_id = ?
          AND ed_chat_message_institute_code = ?`,
      [encryptedContent, messageId, conversationId, ctx.instituteCode]
    );
    await audit(connection, ctx, req, "editar_mensagem_chat", "chat_message", messageId,
      message, { content: encryptedContent });
    return { id: Number(messageId), content };
  });
}

async function deleteChatMessage(ctx, req, conversationId, messageId) {
  await assertConversationMember(ctx, Number(conversationId));
  return transaction(async (connection) => {
    const message = await editableChatMessage(ctx, Number(conversationId), Number(messageId), connection, true);
    await connection.query(
      `UPDATE eduall_chat_messages
          SET ed_chat_message_deleted = 1
        WHERE ed_hr_chat_message_uid = ?
          AND ed_chat_message_conversation_id = ?
          AND ed_chat_message_institute_code = ?`,
      [messageId, conversationId, ctx.instituteCode]
    );
    await audit(connection, ctx, req, "apagar_mensagem_chat", "chat_message", messageId,
      message, null);
    return { id: Number(messageId) };
  });
}

async function toggleChatMessageReaction(ctx, conversationId, messageId, input) {
  await assertConversationMember(ctx, Number(conversationId));
  const key = cleanText(input?.key || input?.reaction || "like", 30) || "like";
  return transaction(async (connection) => {
    const [messages] = await connection.query(
      `SELECT 1 FROM eduall_chat_messages
        WHERE ed_hr_chat_message_uid = ?
          AND ed_chat_message_conversation_id = ?
          AND ed_chat_message_institute_code = ?
          AND ed_chat_message_deleted = 0
        LIMIT 1`,
      [messageId, conversationId, ctx.instituteCode]
    );
    if (!messages.length) fail(404, "HR_CHAT_MESSAGE_NOT_FOUND", "Mensagem não encontrada.");
    const [existing] = await connection.query(
      `SELECT ed_hr_chat_message_reaction_id AS id,
              ed_hr_chat_message_reaction_key AS reactionKey,
              ed_hr_chat_message_reaction_deleted AS deleted
         FROM eduall_hr_chat_message_reactions
        WHERE ed_hr_chat_message_reaction_institute_code = ?
          AND ed_hr_chat_message_reaction_message_uid = ?
          AND ed_hr_chat_message_reaction_user_id = ?
        FOR UPDATE`,
      [ctx.instituteCode, messageId, ctx.userId]
    );
    if (existing.length && !existing[0].deleted && existing[0].reactionKey === key) {
      await connection.query(
        `UPDATE eduall_hr_chat_message_reactions
            SET ed_hr_chat_message_reaction_deleted = 1
          WHERE ed_hr_chat_message_reaction_id = ?`,
        [existing[0].id]
      );
      return { active: false, key };
    }
    if (existing.length) {
      await connection.query(
        `UPDATE eduall_hr_chat_message_reactions
            SET ed_hr_chat_message_reaction_key = ?, ed_hr_chat_message_reaction_deleted = 0
          WHERE ed_hr_chat_message_reaction_id = ?`,
        [key, existing[0].id]
      );
    } else {
      await connection.query(
        `INSERT INTO eduall_hr_chat_message_reactions (
           ed_hr_chat_message_reaction_institute_code,
           ed_hr_chat_message_reaction_conversation_id,
           ed_hr_chat_message_reaction_message_uid,
           ed_hr_chat_message_reaction_user_id,
           ed_hr_chat_message_reaction_key,
           ed_hr_chat_message_reaction_deleted
         ) VALUES (?, ?, ?, ?, ?, 0)`,
        [ctx.instituteCode, conversationId, messageId, ctx.userId, key]
      );
    }
    return { active: true, key };
  });
}

async function sendChatMessage(ctx, req, input) {
  const conversationId = Number(input?.conversationId);
  if (!numberOrNull(conversationId)) fail(422, "HR_CHAT_CONVERSATION_REQUIRED", "Selecione uma conversa.");
  const type = ["text", "audio", "image", "video", "file", "gallery", "poll", "event", "announce", "call", "post"].includes(input?.type)
    ? input.type
    : "text";
  const content = cleanText(input?.content, 10000);
  const encryptedContent = encryptContent(content);
  const attachments = Array.isArray(input?.attachments) ? input.attachments.slice(0, 25) : [];
  if (!content && !attachments.length) fail(422, "HR_MESSAGE_REQUIRED", "Escreva uma mensagem.");
  return transaction(async (connection) => {
    const conversation = await assertConversationMember(ctx, conversationId, connection, true);
    const [members] = await connection.query(
      `SELECT ed_hr_chat_participant_user_id AS userId
         FROM eduall_hr_chat_participants
        WHERE ed_hr_chat_participant_conversation_id = ?
          AND ed_hr_chat_participant_deleted = 0`,
      [conversationId]
    );
    const target = conversation.type === "direct"
      ? members.find((item) => Number(item.userId) !== ctx.userId)?.userId || 0
      : 0;
    const [lastRows] = await connection.query(
      `SELECT COALESCE(MAX(ed_chat_message_id), 0) + 1 AS nextId
         FROM eduall_chat_messages
        FOR UPDATE`
    );
    const legacyId = Number(lastRows[0]?.nextId || 1);
    let replyToId = numberOrNull(input?.replyToId);
    if (replyToId) {
      const [replyRows] = await connection.query(
        `SELECT 1 FROM eduall_chat_messages
          WHERE ed_hr_chat_message_uid = ?
            AND ed_chat_message_conversation_id = ?
            AND ed_chat_message_institute_code = ?
            AND ed_chat_message_deleted = 0
          LIMIT 1`,
        [replyToId, conversationId, ctx.instituteCode]
      );
      if (!replyRows.length) replyToId = null;
    }
    const [result] = await connection.query(
      `INSERT INTO eduall_chat_messages (
         ed_chat_message_id, ed_chat_message_code, ed_chat_message_from,
         ed_chat_message_to, ed_chat_message_group_code,
         ed_chat_message_conversation_id, ed_chat_message_content,
         ed_chat_message_type, ed_chat_message_gif, ed_chat_message_attachments,
         ed_chat_message_reply_to_uid, ed_chat_message_readed,
         ed_chat_message_registertime, ed_chat_message_institute_code,
         ed_chat_message_deleted
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, NOW(), ?, 0)`,
      [
        legacyId,
        `HR-CHAT-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`,
        ctx.userId,
        target,
        conversation.type === "group" ? conversationId : target,
        conversationId,
        encryptedContent,
        type,
        cleanText(input?.gif, 1000) || null,
        JSON.stringify(protectChatAttachments(attachments)),
        replyToId,
        ctx.instituteCode,
      ]
    );
    await connection.query(
      `UPDATE eduall_hr_chat_conversations
          SET ed_hr_chat_conversation_updated_at = NOW()
        WHERE ed_hr_chat_conversation_id = ?`,
      [conversationId]
    );
    await connection.query(
      `INSERT INTO eduall_hr_chat_reads (
         ed_hr_chat_read_conversation_id, ed_hr_chat_read_user_id,
         ed_hr_chat_read_last_message_uid
       ) VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE
         ed_hr_chat_read_last_message_uid = VALUES(ed_hr_chat_read_last_message_uid)`,
      [conversationId, ctx.userId, result.insertId]
    );
    return {
      id: Number(result.insertId),
      conversationId,
      fromUserId: ctx.userId,
      content,
      type,
      attachments,
      createdAt: new Date().toISOString(),
    };
  });
}

async function sharePostToChat(ctx, req, postId, input) {
  const conversationId = Number(input?.conversationId);
  if (!numberOrNull(conversationId)) {
    fail(422, "HR_CHAT_CONVERSATION_REQUIRED", "Selecione uma conversa.");
  }
  const post = await getFeedPost(ctx, Number(postId));
  const attachments = sanitizeFeedAttachments(post.attachments);
  const media = attachments[0] || null;
  const excerpt = cleanText(
    String(post.content || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " "),
    260
  );
  const preview = {
    postId: Number(post.id),
    title: excerpt || (media ? `Publicação com ${media.type === "video" ? "vídeo" : "ficheiro"}` : "Publicação"),
    excerpt,
    author: post.author?.name || "Utilizador",
    authorAvatar: post.author?.picture || "",
    mediaType: media?.type || null,
    mediaUrl: media?.url || null,
    posterUrl: media?.poster?.url || null,
    originalUrl: `/hr/feed?post=${Number(post.id)}`,
  };
  return sendChatMessage(ctx, req, {
    conversationId,
    type: "post",
    content: `Publicação partilhada de ${preview.author}`,
    attachments: [{ type: "rich", payload: preview }],
  });
}

async function markChatRead(ctx, conversationId) {
  await assertConversationMember(ctx, Number(conversationId));
  const [rows] = await DATABASE.query(
    `SELECT COALESCE(MAX(ed_hr_chat_message_uid), 0) AS lastMessageId
       FROM eduall_chat_messages
      WHERE ed_chat_message_institute_code = ?
        AND ed_chat_message_conversation_id = ?
        AND ed_chat_message_deleted = 0`,
    [ctx.instituteCode, conversationId]
  );
  await DATABASE.query(
    `INSERT INTO eduall_hr_chat_reads (
       ed_hr_chat_read_conversation_id, ed_hr_chat_read_user_id,
       ed_hr_chat_read_last_message_uid
     ) VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE
       ed_hr_chat_read_last_message_uid = GREATEST(
         ed_hr_chat_read_last_message_uid,
         VALUES(ed_hr_chat_read_last_message_uid)
       )`,
    [conversationId, ctx.userId, Number(rows[0]?.lastMessageId || 0)]
  );
  return { ok: true, lastMessageId: Number(rows[0]?.lastMessageId || 0) };
}

async function listVacations(ctx, query = {}) {
  const { page, limit, offset } = normalizePage(query);
  const params = [ctx.instituteCode];
  let where = "v.ed_hr_vacation_institute_code = ? AND v.ed_hr_vacation_deleted = 0";
  if (!ctx.isManager) {
    where += " AND v.ed_hr_vacation_employee_id = ?";
    params.push(ctx.employeeId);
  } else if (query.employeeId) {
    where += " AND v.ed_hr_vacation_employee_id = ?";
    params.push(Number(query.employeeId));
  }
  if (query.status) {
    where += " AND v.ed_hr_vacation_status = ?";
    params.push(cleanText(query.status, 30));
  }
  const [[count], [rows]] = await Promise.all([
    DATABASE.query(`SELECT COUNT(*) AS total FROM eduall_hr_vacation_requests v WHERE ${where}`, params),
    DATABASE.query(
      `SELECT v.*, e.ed_employee_name AS employeeName, e.ed_employee_code AS employeeCode
         FROM eduall_hr_vacation_requests v
         JOIN eduall_employees e
           ON e.ed_employee_id = v.ed_hr_vacation_employee_id
          AND e.ed_employee_institute_code = v.ed_hr_vacation_institute_code
          AND e.ed_employee_deleted = 0
        WHERE ${where}
        ORDER BY v.ed_hr_vacation_start_date DESC, v.ed_hr_vacation_id DESC
        LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    ),
  ]);
  return {
    data: rows.map((row) => ({
      id: Number(row.ed_hr_vacation_id),
      employeeId: Number(row.ed_hr_vacation_employee_id),
      employeeName: row.employeeName,
      employeeCode: row.employeeCode,
      type: row.ed_hr_vacation_type,
      startDate: row.ed_hr_vacation_start_date,
      endDate: row.ed_hr_vacation_end_date,
      days: Number(row.ed_hr_vacation_days),
      status: row.ed_hr_vacation_status,
      reason: row.ed_hr_vacation_reason || "",
      decisionNote: row.ed_hr_vacation_decision_note || "",
      createdAt: row.ed_hr_vacation_created_at,
    })),
    meta: buildMeta(count[0]?.total, page, limit),
  };
}

async function createVacation(ctx, req, input) {
  const validation = validateVacation(input);
  if (!validation.ok) fail(422, "HR_VACATION_INVALID", "Dados de ausência inválidos.", validation.errors);
  const employeeId = ctx.isManager && input.employeeId
    ? Number(input.employeeId)
    : ctx.employeeId;
  if (!employeeId) fail(422, "HR_EMPLOYEE_LINK_REQUIRED", "A conta não está ligada a um funcionário.");
  return transaction(async (connection) => {
    const [employeeRows] = await connection.query(
      `SELECT ed_employee_id AS id, ed_employee_vacation_balance AS balance
         FROM eduall_employees
        WHERE ed_employee_id = ? AND ed_employee_institute_code = ?
          AND ed_employee_deleted = 0 FOR UPDATE`,
      [employeeId, ctx.instituteCode]
    );
    if (!employeeRows.length) fail(404, "HR_EMPLOYEE_NOT_FOUND", "Funcionário não encontrado.");
    if (
      validation.value.leaveType === "ferias" &&
      Number(employeeRows[0].balance || 0) < validation.value.days
    ) {
      fail(409, "HR_VACATION_BALANCE_EXCEEDED", "O saldo de férias é insuficiente.");
    }
    const [overlaps] = await connection.query(
      `SELECT COUNT(*) AS total FROM eduall_hr_vacation_requests
        WHERE ed_hr_vacation_institute_code = ?
          AND ed_hr_vacation_employee_id = ?
          AND ed_hr_vacation_deleted = 0
          AND ed_hr_vacation_status IN ('pendente','aprovada')
          AND ed_hr_vacation_start_date <= ?
          AND ed_hr_vacation_end_date >= ?`,
      [ctx.instituteCode, employeeId, validation.value.endDate, validation.value.startDate]
    );
    if (Number(overlaps[0]?.total || 0) > 0) {
      fail(409, "HR_VACATION_OVERLAP", "Já existe uma ausência neste intervalo.");
    }
    const [result] = await connection.query(
      `INSERT INTO eduall_hr_vacation_requests (
         ed_hr_vacation_institute_code, ed_hr_vacation_employee_id,
         ed_hr_vacation_requester_user_id, ed_hr_vacation_type,
         ed_hr_vacation_start_date, ed_hr_vacation_end_date,
         ed_hr_vacation_days, ed_hr_vacation_status, ed_hr_vacation_reason,
         ed_hr_vacation_deleted
       ) VALUES (?, ?, ?, ?, ?, ?, ?, 'pendente', ?, 0)`,
      [
        ctx.instituteCode, employeeId, ctx.userId, validation.value.leaveType,
        validation.value.startDate, validation.value.endDate, validation.value.days,
        validation.value.reason,
      ]
    );
    await audit(connection, ctx, req, "pedir_ausencia", "vacation_request", result.insertId, null,
      validation.value, validation.value.reason);
    return { id: result.insertId, status: "pendente" };
  });
}

async function decideVacation(ctx, req, id, decision, input) {
  requireManager(ctx);
  if (!["aprovada", "rejeitada", "cancelada"].includes(decision)) {
    fail(422, "HR_VACATION_DECISION_INVALID", "Decisão inválida.");
  }
  return transaction(async (connection) => {
    const [rows] = await connection.query(
      `SELECT * FROM eduall_hr_vacation_requests
        WHERE ed_hr_vacation_id = ? AND ed_hr_vacation_institute_code = ?
          AND ed_hr_vacation_deleted = 0 FOR UPDATE`,
      [id, ctx.instituteCode]
    );
    if (!rows.length) fail(404, "HR_VACATION_NOT_FOUND", "Pedido de ausência não encontrado.");
    if (rows[0].ed_hr_vacation_status !== "pendente") {
      fail(409, "HR_VACATION_ALREADY_DECIDED", "O pedido já foi decidido.");
    }
    await connection.query(
      `UPDATE eduall_hr_vacation_requests
          SET ed_hr_vacation_status = ?, ed_hr_vacation_decision_note = ?,
              ed_hr_vacation_decided_by = ?, ed_hr_vacation_decided_at = NOW()
        WHERE ed_hr_vacation_id = ? AND ed_hr_vacation_institute_code = ?`,
      [decision, cleanText(input.note, 2000) || null, ctx.userId, id, ctx.instituteCode]
    );
    if (decision === "aprovada" && rows[0].ed_hr_vacation_type === "ferias") {
      await connection.query(
        `UPDATE eduall_employees
            SET ed_employee_vacation_balance = GREATEST(0, ed_employee_vacation_balance - CAST(? AS DECIMAL(8,2)))
          WHERE ed_employee_id = ? AND ed_employee_institute_code = ?`,
        [rows[0].ed_hr_vacation_days, rows[0].ed_hr_vacation_employee_id, ctx.instituteCode]
      );
    }
    await audit(connection, ctx, req, `decidir_ausencia_${decision}`, "vacation_request", id, rows[0],
      { status: decision, note: input.note }, input.note);
    return { id: Number(id), status: decision };
  });
}

async function listAttendance(ctx, query = {}) {
  const employeeId = ctx.isManager && query.employeeId ? Number(query.employeeId) : ctx.employeeId;
  const params = [ctx.instituteCode];
  let where = "t.ed_hr_time_entry_institute_code = ? AND t.ed_hr_time_entry_deleted = 0";
  if (employeeId) {
    where += " AND t.ed_hr_time_entry_employee_id = ?";
    params.push(employeeId);
  }
  if (query.from) {
    where += " AND t.ed_hr_time_entry_work_date >= ?";
    params.push(cleanText(query.from, 10));
  }
  if (query.to) {
    where += " AND t.ed_hr_time_entry_work_date <= ?";
    params.push(cleanText(query.to, 10));
  }
  const [rows] = await DATABASE.query(
    `SELECT t.*, e.ed_employee_name AS employeeName, e.ed_employee_code AS employeeCode
       FROM eduall_hr_time_entries t
       JOIN eduall_employees e
         ON e.ed_employee_id = t.ed_hr_time_entry_employee_id
        AND e.ed_employee_institute_code = t.ed_hr_time_entry_institute_code
        AND e.ed_employee_deleted = 0
      WHERE ${where}
      ORDER BY t.ed_hr_time_entry_clock_in DESC
      LIMIT 500`,
    params
  );
  return rows.map((row) => ({
    id: Number(row.ed_hr_time_entry_id),
    employeeId: Number(row.ed_hr_time_entry_employee_id),
    employeeName: row.employeeName,
    employeeCode: row.employeeCode,
    workDate: row.ed_hr_time_entry_work_date,
    clockIn: row.ed_hr_time_entry_clock_in,
    clockOut: row.ed_hr_time_entry_clock_out,
    minutes: row.ed_hr_time_entry_minutes,
    status: row.ed_hr_time_entry_status,
    note: row.ed_hr_time_entry_note || "",
  }));
}

async function punchAttendance(ctx, req, direction) {
  if (!ctx.employeeId) fail(422, "HR_EMPLOYEE_LINK_REQUIRED", "A conta não está ligada a um funcionário.");
  return transaction(async (connection) => {
    const [open] = await connection.query(
      `SELECT * FROM eduall_hr_time_entries
        WHERE ed_hr_time_entry_institute_code = ?
          AND ed_hr_time_entry_employee_id = ?
          AND ed_hr_time_entry_clock_out IS NULL
          AND ed_hr_time_entry_deleted = 0
        ORDER BY ed_hr_time_entry_clock_in DESC LIMIT 1 FOR UPDATE`,
      [ctx.instituteCode, ctx.employeeId]
    );
    if (direction === "in") {
      if (open.length) fail(409, "HR_CLOCK_ALREADY_OPEN", "Já existe uma picagem em aberto.");
      const [result] = await connection.query(
        `INSERT INTO eduall_hr_time_entries (
           ed_hr_time_entry_institute_code, ed_hr_time_entry_employee_id,
           ed_hr_time_entry_work_date, ed_hr_time_entry_clock_in,
           ed_hr_time_entry_status, ed_hr_time_entry_deleted
         ) VALUES (?, ?, CURDATE(), NOW(), 'aberto', 0)`,
        [ctx.instituteCode, ctx.employeeId]
      );
      return { id: result.insertId, direction: "in" };
    }
    if (!open.length) fail(409, "HR_CLOCK_NOT_OPEN", "Não existe uma picagem em aberto.");
    await connection.query(
      `UPDATE eduall_hr_time_entries
          SET ed_hr_time_entry_clock_out = NOW(),
              ed_hr_time_entry_minutes = TIMESTAMPDIFF(MINUTE, ed_hr_time_entry_clock_in, NOW()),
              ed_hr_time_entry_status = 'fechado'
        WHERE ed_hr_time_entry_id = ? AND ed_hr_time_entry_institute_code = ?`,
      [open[0].ed_hr_time_entry_id, ctx.instituteCode]
    );
    return { id: Number(open[0].ed_hr_time_entry_id), direction: "out" };
  });
}

async function listProjects(ctx) {
  const [rows] = await DATABASE.query(
    `SELECT p.ed_task_and_project_id AS id,
            p.ed_task_and_project_title AS title,
            p.ed_task_and_project_subtitle AS subtitle,
            p.ed_task_and_project_description AS description,
            p.ed_task_and_project_type AS type,
            p.ed_task_and_project_startDate AS startDate,
            p.ed_task_and_project_endDate AS endDate,
            p.ed_task_and_project_color AS color,
            p.ed_task_and_project_status AS status,
            p.ed_task_and_project_priority AS priority,
            p.ed_task_and_project_visibility AS visibility,
            p.ed_task_and_project_registerDate AS createdAt,
            (SELECT COUNT(*) FROM eduall_hr_task_members m
              WHERE m.ed_hr_task_member_project_id = p.ed_task_and_project_id
                AND m.ed_hr_task_member_institute_code = p.ed_task_and_project_institute_code
                AND m.ed_hr_task_member_deleted = 0) AS memberCount
       FROM eduall_task_and_projects p
      WHERE p.ed_task_and_project_institute_code = ?
        AND p.ed_task_and_project_deleted = 0
        AND (
          p.ed_task_and_project_visibility = 'instituto'
          OR p.ed_task_and_project_added_by = ?
          OR EXISTS (
            SELECT 1 FROM eduall_hr_task_members m
             WHERE m.ed_hr_task_member_project_id = p.ed_task_and_project_id
               AND m.ed_hr_task_member_institute_code = p.ed_task_and_project_institute_code
               AND m.ed_hr_task_member_employee_id = ?
               AND m.ed_hr_task_member_deleted = 0
          )
        )
      ORDER BY p.ed_task_and_project_registerDate DESC`,
    [ctx.instituteCode, ctx.userId, ctx.employeeId]
  );
  return rows.map((row) => ({
    id: Number(row.id),
    title: row.title,
    subtitle: row.subtitle || "",
    description: row.description || "",
    type: row.type,
    startDate: row.startDate,
    endDate: row.endDate,
    color: row.color || "#5b4dc4",
    status: row.status,
    priority: row.priority,
    visibility: row.visibility,
    memberCount: Number(row.memberCount || 0),
    createdAt: row.createdAt,
  }));
}

async function createProject(ctx, req, input) {
  const title = cleanText(input.title, 255);
  if (!title) fail(422, "HR_PROJECT_TITLE_REQUIRED", "Indique o título do projeto.");
  const code = `HRP-${Date.now().toString(36).toUpperCase()}`;
  const startDate = cleanText(input.startDate, 10) ||
    new Date().toISOString().slice(0, 10);
  const endDate = cleanText(input.endDate, 10) || startDate;
  return transaction(async (connection) => {
    const [result] = await connection.query(
      `INSERT INTO eduall_task_and_projects (
         ed_task_and_project_title, ed_task_and_project_subtitle,
         ed_task_and_project_added_by, ed_task_and_project_code,
         ed_task_and_project_description, ed_task_and_project_type,
         ed_task_and_project_startDate, ed_task_and_project_endDate,
         ed_task_and_project_color, ed_task_and_project_institute_code,
         ed_task_and_project_deleted, ed_task_and_project_status,
         ed_task_and_project_priority, ed_task_and_project_visibility
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)`,
      [
        title, cleanText(input.subtitle, 255), ctx.userId, code,
        cleanText(input.description, 10000) || null, Number(input.type) || 0,
        startDate, endDate,
        cleanText(input.color, 20) || "#5b4dc4", ctx.instituteCode,
        cleanText(input.status, 30) || "planeado",
        cleanText(input.priority, 20) || "media",
        cleanText(input.visibility, 30) || "equipa",
      ]
    );
    if (ctx.employeeId) {
      await connection.query(
        `INSERT INTO eduall_hr_task_members (
           ed_hr_task_member_institute_code, ed_hr_task_member_project_id,
           ed_hr_task_member_employee_id, ed_hr_task_member_role,
           ed_hr_task_member_deleted
         ) VALUES (?, ?, ?, 'responsavel', 0)`,
        [ctx.instituteCode, result.insertId, ctx.employeeId]
      );
    }
    await audit(connection, ctx, req, "criar_projeto", "project", result.insertId, null,
      { title, status: input.status }, input.reason);
    return { id: result.insertId };
  });
}

async function updateProject(ctx, req, id, input) {
  return transaction(async (connection) => {
    const [rows] = await connection.query(
      `SELECT * FROM eduall_task_and_projects
        WHERE ed_task_and_project_id = ? AND ed_task_and_project_institute_code = ?
          AND ed_task_and_project_deleted = 0 FOR UPDATE`,
      [id, ctx.instituteCode]
    );
    if (!rows.length) fail(404, "HR_PROJECT_NOT_FOUND", "Projeto não encontrado.");
    const status = cleanText(input.status, 30) || rows[0].ed_task_and_project_status;
    await connection.query(
      `UPDATE eduall_task_and_projects
          SET ed_task_and_project_title = ?, ed_task_and_project_description = ?,
              ed_task_and_project_startDate = ?, ed_task_and_project_endDate = ?,
              ed_task_and_project_status = ?, ed_task_and_project_priority = ?,
              ed_task_and_project_visibility = ?, ed_task_and_project_updated_at = NOW()
        WHERE ed_task_and_project_id = ? AND ed_task_and_project_institute_code = ?`,
      [
        cleanText(input.title, 255) || rows[0].ed_task_and_project_title,
        cleanText(input.description, 10000) || rows[0].ed_task_and_project_description,
        cleanText(input.startDate, 10) || rows[0].ed_task_and_project_startDate,
        cleanText(input.endDate, 10) || rows[0].ed_task_and_project_endDate,
        status, cleanText(input.priority, 20) || rows[0].ed_task_and_project_priority,
        cleanText(input.visibility, 30) || rows[0].ed_task_and_project_visibility,
        id, ctx.instituteCode,
      ]
    );
    await audit(connection, ctx, req, "actualizar_projeto", "project", id, rows[0],
      { status, title: input.title }, input.reason);
    return { id: Number(id), status };
  });
}

async function listGoals(ctx, query = {}) {
  const employeeId = ctx.isManager && query.employeeId ? Number(query.employeeId) : ctx.employeeId;
  const params = [ctx.instituteCode];
  let where = "g.ed_hr_goal_institute_code = ? AND g.ed_hr_goal_deleted = 0";
  if (employeeId) {
    where += " AND g.ed_hr_goal_employee_id = ?";
    params.push(employeeId);
  }
  const [rows] = await DATABASE.query(
    `SELECT g.*, e.ed_employee_name AS employeeName
       FROM eduall_hr_goals g
       JOIN eduall_employees e
         ON e.ed_employee_id = g.ed_hr_goal_employee_id
        AND e.ed_employee_institute_code = g.ed_hr_goal_institute_code
        AND e.ed_employee_deleted = 0
      WHERE ${where}
      ORDER BY g.ed_hr_goal_due_date ASC, g.ed_hr_goal_id DESC`,
    params
  );
  return rows.map((row) => ({
    id: Number(row.ed_hr_goal_id),
    employeeId: Number(row.ed_hr_goal_employee_id),
    employeeName: row.employeeName,
    title: row.ed_hr_goal_title,
    description: row.ed_hr_goal_description || "",
    period: row.ed_hr_goal_period,
    progress: Number(row.ed_hr_goal_progress),
    status: row.ed_hr_goal_status,
    dueDate: row.ed_hr_goal_due_date,
  }));
}

async function createGoal(ctx, req, input) {
  const title = cleanText(input.title, 255);
  if (!title || !cleanText(input.period, 60)) {
    fail(422, "HR_GOAL_REQUIRED", "Título e período são obrigatórios.");
  }
  const employeeId = ctx.isManager && input.employeeId ? Number(input.employeeId) : ctx.employeeId;
  if (!employeeId) fail(422, "HR_EMPLOYEE_LINK_REQUIRED", "A conta não está ligada a um funcionário.");
  return transaction(async (connection) => {
    const [result] = await connection.query(
      `INSERT INTO eduall_hr_goals (
         ed_hr_goal_institute_code, ed_hr_goal_employee_id, ed_hr_goal_title,
         ed_hr_goal_description, ed_hr_goal_period, ed_hr_goal_progress,
         ed_hr_goal_status, ed_hr_goal_due_date, ed_hr_goal_created_by,
         ed_hr_goal_deleted
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
      [
        ctx.instituteCode, employeeId, title, cleanText(input.description, 5000) || null,
        cleanText(input.period, 60), Math.max(0, Math.min(100, Number(input.progress) || 0)),
        cleanText(input.status, 30) || "em_curso",
        cleanText(input.dueDate, 10) || null, ctx.userId,
      ]
    );
    await audit(connection, ctx, req, "criar_objectivo", "goal", result.insertId, null,
      { title, employeeId }, input.reason);
    return { id: result.insertId };
  });
}

async function updateGoal(ctx, req, id, input) {
  return transaction(async (connection) => {
    const [rows] = await connection.query(
      `SELECT * FROM eduall_hr_goals
        WHERE ed_hr_goal_id = ? AND ed_hr_goal_institute_code = ?
          AND ed_hr_goal_deleted = 0 FOR UPDATE`,
      [id, ctx.instituteCode]
    );
    if (!rows.length) fail(404, "HR_GOAL_NOT_FOUND", "Objetivo não encontrado.");
    if (!ctx.isManager && Number(rows[0].ed_hr_goal_employee_id) !== ctx.employeeId) {
      fail(403, "HR_GOAL_SCOPE_DENIED", "Objetivo fora do seu âmbito.");
    }
    const progress = Math.max(0, Math.min(100, Number(input.progress ?? rows[0].ed_hr_goal_progress)));
    const status = progress >= 100 ? "concluido" : (cleanText(input.status, 30) || rows[0].ed_hr_goal_status);
    await connection.query(
      `UPDATE eduall_hr_goals
          SET ed_hr_goal_progress = ?, ed_hr_goal_status = ?,
              ed_hr_goal_due_date = COALESCE(?, ed_hr_goal_due_date)
        WHERE ed_hr_goal_id = ? AND ed_hr_goal_institute_code = ?`,
      [progress, status, cleanText(input.dueDate, 10) || null, id, ctx.instituteCode]
    );
    await audit(connection, ctx, req, "actualizar_objectivo", "goal", id, rows[0],
      { progress, status }, input.reason);
    return { id: Number(id), progress, status };
  });
}

async function listFeedback(ctx) {
  const [rows] = await DATABASE.query(
    `SELECT f.*, sender.ed_employee_name AS fromName, target.ed_employee_name AS toName
       FROM eduall_hr_feedback f
       LEFT JOIN eduall_employees sender ON sender.ed_employee_id = f.ed_hr_feedback_from_employee
       LEFT JOIN eduall_employees target ON target.ed_employee_id = f.ed_hr_feedback_to_employee
      WHERE f.ed_hr_feedback_institute_code = ? AND f.ed_hr_feedback_deleted = 0
        AND (f.ed_hr_feedback_visibility = 'equipa' OR f.ed_hr_feedback_from_employee = ?
          OR f.ed_hr_feedback_to_employee = ? OR ? = 1)
      ORDER BY f.ed_hr_feedback_created_at DESC LIMIT 200`,
    [ctx.instituteCode, ctx.employeeId || 0, ctx.employeeId || 0, ctx.isManager ? 1 : 0]
  );
  return rows.map((row) => ({
    id: Number(row.ed_hr_feedback_id),
    fromName: row.fromName || "Colega",
    toEmployeeId: Number(row.ed_hr_feedback_to_employee),
    toName: row.toName || "",
    type: row.ed_hr_feedback_type,
    visibility: row.ed_hr_feedback_visibility,
    text: row.ed_hr_feedback_text,
    createdAt: row.ed_hr_feedback_created_at,
  }));
}

async function createFeedback(ctx, req, input) {
  const toEmployeeId = Number(input.toEmployeeId);
  const text = cleanText(input.text, 5000);
  if (!numberOrNull(toEmployeeId) || !text || !ctx.employeeId) {
    fail(422, "HR_FEEDBACK_REQUIRED", "Destinatário e texto são obrigatórios.");
  }
  return transaction(async (connection) => {
    const [target] = await connection.query(
      `SELECT 1 FROM eduall_employees
        WHERE ed_employee_id = ? AND ed_employee_institute_code = ?
          AND ed_employee_deleted = 0`,
      [toEmployeeId, ctx.instituteCode]
    );
    if (!target.length) fail(404, "HR_EMPLOYEE_NOT_FOUND", "Destinatário não encontrado.");
    const [result] = await connection.query(
      `INSERT INTO eduall_hr_feedback (
         ed_hr_feedback_institute_code, ed_hr_feedback_from_employee,
         ed_hr_feedback_to_employee, ed_hr_feedback_type,
         ed_hr_feedback_visibility, ed_hr_feedback_text, ed_hr_feedback_deleted
       ) VALUES (?, ?, ?, ?, ?, ?, 0)`,
      [
        ctx.instituteCode, ctx.employeeId, toEmployeeId,
        cleanText(input.type, 30) || "reconhecimento",
        cleanText(input.visibility, 30) || "equipa", text,
      ]
    );
    return { id: result.insertId };
  });
}

async function listCalendar(ctx, query = {}) {
  const mineOnly = ["1", "true", "yes"].includes(String(query.mine || "").toLowerCase());
  const params = [ctx.instituteCode];
  let where = `c.ed_calendar_event_institute_code = ?
    AND c.ed_calendar_event_deleted = 0`;
  if (mineOnly) {
    where += ` AND (
      c.ed_calendar_event_employee_id = ?
      OR c.ed_calendar_event_created_by = ?
      OR JSON_VALID(c.ed_calendar_event_attendees)
        AND JSON_CONTAINS(c.ed_calendar_event_attendees, JSON_OBJECT('personId', ?))
    )`;
    params.push(ctx.employeeId, ctx.userId, ctx.employeeId);
  } else if (!ctx.isManager) {
    where += ` AND (
      c.ed_calendar_event_audience IN ('todos', 'public', 'publico', 'público', 'institute')
      OR c.ed_calendar_event_employee_id = ?
      OR c.ed_calendar_event_created_by = ?
      OR (
        c.ed_calendar_event_audience IN ('departamento', 'department')
        AND owner.ed_employee_department = ?
      )
      OR JSON_VALID(c.ed_calendar_event_attendees)
        AND JSON_CONTAINS(c.ed_calendar_event_attendees, JSON_OBJECT('personId', ?))
    )`;
    params.push(ctx.employeeId, ctx.userId, ctx.departmentId, ctx.employeeId);
  }
  if (query.from) {
    where += " AND c.ed_calendar_event_end >= ?";
    params.push(cleanText(query.from, 10));
  }
  if (query.to) {
    where += " AND c.ed_calendar_event_start <= ?";
    params.push(cleanText(query.to, 10));
  }
  if (query.type) {
    where += " AND c.ed_calendar_event_type = ?";
    params.push(cleanText(query.type, 40));
  }
  const requestedLimit = Number.parseInt(query.limit, 10);
  const limit = Math.min(1000, Math.max(1, requestedLimit || 1000));
  const [rows] = await DATABASE.query(
    `SELECT c.ed_calendar_event_id AS id,
            c.ed_calendar_event_title AS title,
            c.ed_calendar_event_start AS startAt,
            c.ed_calendar_event_end AS endAt,
            c.ed_calendar_event_description AS description,
            c.ed_calendar_event_audience AS audience,
            c.ed_calendar_event_color AS color,
            c.ed_calendar_event_type AS type,
            c.ed_calendar_event_status AS status,
            c.ed_calendar_event_employee_id AS employeeId,
            c.ed_calendar_event_created_by AS createdBy,
            c.ed_calendar_event_all_day AS allDay,
            c.ed_calendar_event_privacy AS privacy,
            c.ed_calendar_event_rrule AS rrule,
            c.ed_calendar_event_exdates AS exdates,
            c.ed_calendar_event_attendees AS attendees,
            c.ed_calendar_event_location AS location,
            c.ed_calendar_event_meeting_link AS meetingLink,
            c.ed_calendar_event_series_id AS seriesId,
            c.ed_calendar_event_registerdate AS createdAt,
            c.ed_calendar_event_updated_at AS updatedAt,
            COALESCE(ua.ed_user_account_name, owner.ed_employee_name, 'Utilizador') AS ownerName,
            COALESCE(ua.ed_user_account_picture, owner.ed_employee_picture, '') AS ownerPicture,
            owner.ed_employee_department AS departmentId,
            d.ed_department_title AS departmentName
       FROM eduall_calendar_events c
       LEFT JOIN eduall_employees owner
         ON owner.ed_employee_id = c.ed_calendar_event_employee_id
        AND BINARY owner.ed_employee_institute_code = BINARY c.ed_calendar_event_institute_code
        AND owner.ed_employee_deleted = 0
       LEFT JOIN eduall_department d
         ON d.ed_department_id = owner.ed_employee_department
        AND d.ed_department_deleted = 0
       LEFT JOIN eduall_user_accounts ua
         ON ua.ed_user_account_id = c.ed_calendar_event_created_by
        AND ua.ed_user_account_deleted = 0
      WHERE ${where}
      ORDER BY c.ed_calendar_event_start ASC, c.ed_calendar_event_id ASC
      LIMIT ?`,
    [...params, limit]
  );
  return rows.map((row) => ({
    id: Number(row.id),
    title: row.title,
    startAt: row.startAt,
    endAt: row.endAt,
    description: row.description || "",
    audience: row.audience,
    color: row.color || "#5b4dc4",
    type: row.type,
    status: row.status || "publicado",
    employeeId: row.employeeId ? Number(row.employeeId) : null,
    createdBy: row.createdBy ? Number(row.createdBy) : null,
    ownerName: row.ownerName,
    ownerPicture: row.ownerPicture || "",
    departmentId: row.departmentId ? Number(row.departmentId) : null,
    departmentName: row.departmentName || "",
    allDay: Boolean(Number(row.allDay)),
    privacy: row.privacy || "public",
    rrule: row.rrule || "",
    exdates: parseJson(row.exdates, []),
    attendees: parseJson(row.attendees, []),
    location: row.location || "",
    meetingLink: row.meetingLink || "",
    seriesId: row.seriesId ? Number(row.seriesId) : null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    canEdit: ctx.isManager
      || Number(row.createdBy) === Number(ctx.userId)
      || Number(row.employeeId) === Number(ctx.employeeId),
  }));
}

function calendarAttendees(value) {
  return (Array.isArray(value) ? value : [])
    .slice(0, 100)
    .map((attendee) => ({
      personId: numberOrNull(attendee?.personId || attendee?.employeeId || attendee),
      rsvp: ["accepted", "declined", "tentative", "needs"].includes(attendee?.rsvp)
        ? attendee.rsvp
        : "needs",
    }))
    .filter((attendee) => attendee.personId);
}

async function saveCalendar(ctx, req, id, input) {
  const title = cleanText(input.title, 255);
  const startAt = cleanText(input.startAt, 40);
  const endAt = cleanText(input.endAt, 40);
  if (!title || !startAt || !endAt || endAt < startAt) {
    fail(422, "HR_CALENDAR_INVALID", "Título e intervalo válido são obrigatórios.");
  }
  return transaction(async (connection) => {
    let previous = null;
    let eventId = numberOrNull(id);
    let employeeId = ctx.isManager && input.employeeId
      ? Number(input.employeeId)
      : ctx.employeeId;
    if (eventId) {
      const [rows] = await connection.query(
        `SELECT * FROM eduall_calendar_events
          WHERE ed_calendar_event_id = ? AND ed_calendar_event_institute_code = ?
            AND ed_calendar_event_deleted = 0 FOR UPDATE`,
        [eventId, ctx.instituteCode]
      );
      if (!rows.length) fail(404, "HR_CALENDAR_NOT_FOUND", "Evento não encontrado.");
      previous = rows[0];
      const canEdit = ctx.isManager
        || Number(previous.ed_calendar_event_created_by) === Number(ctx.userId)
        || Number(previous.ed_calendar_event_employee_id) === Number(ctx.employeeId);
      if (!canEdit) {
        fail(403, "HR_CALENDAR_EDIT_DENIED", "Não pode alterar este evento.");
      }
      employeeId = ctx.isManager && input.employeeId
        ? Number(input.employeeId)
        : Number(previous.ed_calendar_event_employee_id) || ctx.employeeId;
      const createdBy = Number(previous.ed_calendar_event_created_by) || ctx.userId;
      const privacy = ["public", "busy", "private"].includes(input.privacy)
        ? input.privacy
        : cleanText(previous.ed_calendar_event_privacy, 20) || "public";
      const audience = cleanText(input.audience, 40)
        || (privacy === "private" ? "pessoal" : privacy === "busy" ? "departamento" : "todos");
      const attendees = Array.isArray(input.attendees)
        ? calendarAttendees(input.attendees)
        : parseJson(previous.ed_calendar_event_attendees, []);
      await connection.query(
        `UPDATE eduall_calendar_events
            SET ed_calendar_event_title = ?, ed_calendar_event_start = ?,
                ed_calendar_event_end = ?, ed_calendar_event_description = ?,
                ed_calendar_event_audience = ?, ed_calendar_event_color = ?,
                ed_calendar_event_employee_id = ?, ed_calendar_event_type = ?,
                ed_calendar_event_status = ?, ed_calendar_event_created_by = ?,
                ed_calendar_event_all_day = ?, ed_calendar_event_privacy = ?,
                ed_calendar_event_rrule = ?, ed_calendar_event_exdates = ?,
                ed_calendar_event_attendees = ?, ed_calendar_event_location = ?,
                ed_calendar_event_meeting_link = ?, ed_calendar_event_series_id = ?
          WHERE ed_calendar_event_id = ? AND ed_calendar_event_institute_code = ?`,
        [
          title, startAt, endAt, cleanText(input.description, 5000),
          audience,
          cleanText(input.color, 20) || "#5b4dc4",
          employeeId,
          cleanText(input.type, 40) || "event",
          cleanText(input.status, 30) || "publicado",
          createdBy,
          input.allDay ? 1 : 0,
          privacy,
          cleanText(input.rrule, 255) || null,
          JSON.stringify(Array.isArray(input.exdates) ? input.exdates.slice(0, 200) : []),
          JSON.stringify(attendees),
          cleanText(input.location, 255) || null,
          cleanText(input.meetingLink, 1000) || null,
          numberOrNull(input.seriesId),
          eventId, ctx.instituteCode,
        ]
      );
    } else {
      const privacy = ["public", "busy", "private"].includes(input.privacy)
        ? input.privacy
        : "public";
      const audience = cleanText(input.audience, 40)
        || (privacy === "private" ? "pessoal" : privacy === "busy" ? "departamento" : "todos");
      const attendees = calendarAttendees(input.attendees);
      const [result] = await connection.query(
        `INSERT INTO eduall_calendar_events (
           ed_calendar_event_audience, ed_calendar_event_title,
           ed_calendar_event_start, ed_calendar_event_end,
           ed_calendar_event_color, ed_calendar_event_description,
           ed_calendar_event_deleted, ed_calendar_event_institute_code,
           ed_calendar_event_employee_id, ed_calendar_event_type,
           ed_calendar_event_status, ed_calendar_event_created_by,
           ed_calendar_event_all_day, ed_calendar_event_privacy,
           ed_calendar_event_rrule, ed_calendar_event_exdates,
           ed_calendar_event_attendees, ed_calendar_event_location,
           ed_calendar_event_meeting_link, ed_calendar_event_series_id
         ) VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          audience, title, startAt, endAt,
          cleanText(input.color, 20) || "#5b4dc4",
          cleanText(input.description, 5000), ctx.instituteCode,
          employeeId,
          cleanText(input.type, 40) || "event",
          cleanText(input.status, 30) || "publicado",
          ctx.userId,
          input.allDay ? 1 : 0,
          privacy,
          cleanText(input.rrule, 255) || null,
          JSON.stringify(Array.isArray(input.exdates) ? input.exdates.slice(0, 200) : []),
          JSON.stringify(attendees),
          cleanText(input.location, 255) || null,
          cleanText(input.meetingLink, 1000) || null,
          numberOrNull(input.seriesId),
        ]
      );
      eventId = result.insertId;
    }
    await audit(connection, ctx, req, id ? "actualizar_evento" : "criar_evento",
      "calendar_event", eventId, previous, { title, startAt, endAt }, input.reason);
    return { id: eventId };
  });
}

async function deleteCalendar(ctx, req, id) {
  return transaction(async (connection) => {
    const [rows] = await connection.query(
      `SELECT * FROM eduall_calendar_events
        WHERE ed_calendar_event_id = ? AND ed_calendar_event_institute_code = ?
          AND ed_calendar_event_deleted = 0 FOR UPDATE`,
      [id, ctx.instituteCode]
    );
    if (!rows.length) fail(404, "HR_CALENDAR_NOT_FOUND", "Evento não encontrado.");
    const canDelete = ctx.isManager
      || Number(rows[0].ed_calendar_event_created_by) === Number(ctx.userId)
      || Number(rows[0].ed_calendar_event_employee_id) === Number(ctx.employeeId);
    if (!canDelete) {
      fail(403, "HR_CALENDAR_DELETE_DENIED", "Não pode remover este evento.");
    }
    await connection.query(
      `UPDATE eduall_calendar_events SET ed_calendar_event_deleted = 1
        WHERE ed_calendar_event_id = ? AND ed_calendar_event_institute_code = ?`,
      [id, ctx.instituteCode]
    );
    await audit(connection, ctx, req, "remover_evento", "calendar_event", id, rows[0], null, req.body?.reason);
    return { id: Number(id) };
  });
}

async function listVacancies(ctx) {
  const [rows] = await DATABASE.query(
    `SELECT v.*, d.ed_department_title AS departmentName,
            (SELECT COUNT(*) FROM eduall_hr_recruitment_candidates c
              WHERE c.ed_hr_candidate_vacancy_id = v.ed_hr_vacancy_id
                AND c.ed_hr_candidate_institute_code = v.ed_hr_vacancy_institute_code
                AND c.ed_hr_candidate_deleted = 0) AS candidateCount
       FROM eduall_hr_recruitment_vacancies v
       LEFT JOIN eduall_department d ON d.ed_department_id = v.ed_hr_vacancy_department
      WHERE v.ed_hr_vacancy_institute_code = ? AND v.ed_hr_vacancy_deleted = 0
      ORDER BY v.ed_hr_vacancy_created_at DESC`,
    [ctx.instituteCode]
  );
  return rows.map((row) => ({
    id: Number(row.ed_hr_vacancy_id),
    reference: row.ed_hr_vacancy_reference,
    title: row.ed_hr_vacancy_title,
    departmentId: row.ed_hr_vacancy_department,
    departmentName: row.departmentName || "",
    location: row.ed_hr_vacancy_location || "",
    contractType: row.ed_hr_vacancy_contract_type || "",
    openings: Number(row.ed_hr_vacancy_openings),
    status: row.ed_hr_vacancy_status,
    description: row.ed_hr_vacancy_description || "",
    candidateCount: Number(row.candidateCount || 0),
    createdAt: row.ed_hr_vacancy_created_at,
  }));
}

async function saveVacancy(ctx, req, id, input) {
  requireManager(ctx);
  const title = cleanText(input.title, 255);
  if (!title) fail(422, "HR_VACANCY_TITLE_REQUIRED", "Indique o título da vaga.");
  const status = cleanText(input.status, 30) || "rascunho";
  if (["publicada", "aberta"].includes(status) &&
      (!Number(input.openings) || !Number(input.departmentId))) {
    fail(422, "HR_VACANCY_INCOMPLETE", "Vagas e departamento são obrigatórios para publicar.");
  }
  return transaction(async (connection) => {
    let vacancyId = numberOrNull(id);
    let previous = null;
    if (vacancyId) {
      const [rows] = await connection.query(
        `SELECT * FROM eduall_hr_recruitment_vacancies
          WHERE ed_hr_vacancy_id = ? AND ed_hr_vacancy_institute_code = ?
            AND ed_hr_vacancy_deleted = 0 FOR UPDATE`,
        [vacancyId, ctx.instituteCode]
      );
      if (!rows.length) fail(404, "HR_VACANCY_NOT_FOUND", "Vaga não encontrada.");
      previous = rows[0];
      await connection.query(
        `UPDATE eduall_hr_recruitment_vacancies
            SET ed_hr_vacancy_title = ?, ed_hr_vacancy_department = ?,
                ed_hr_vacancy_location = ?, ed_hr_vacancy_contract_type = ?,
                ed_hr_vacancy_openings = ?, ed_hr_vacancy_status = ?,
                ed_hr_vacancy_description = ?
          WHERE ed_hr_vacancy_id = ? AND ed_hr_vacancy_institute_code = ?`,
        [
          title, numberOrNull(input.departmentId), cleanText(input.location, 180) || null,
          cleanText(input.contractType, 60) || null, Math.max(1, Number(input.openings) || 1),
          status, cleanText(input.description, 10000) || null, vacancyId, ctx.instituteCode,
        ]
      );
    } else {
      const reference = cleanText(input.reference, 50) ||
        `VAGA-${new Date().getFullYear()}-${Date.now().toString().slice(-5)}`;
      const [result] = await connection.query(
        `INSERT INTO eduall_hr_recruitment_vacancies (
           ed_hr_vacancy_institute_code, ed_hr_vacancy_reference,
           ed_hr_vacancy_title, ed_hr_vacancy_department,
           ed_hr_vacancy_location, ed_hr_vacancy_contract_type,
           ed_hr_vacancy_openings, ed_hr_vacancy_status,
           ed_hr_vacancy_description, ed_hr_vacancy_hiring_manager,
           ed_hr_vacancy_created_by, ed_hr_vacancy_deleted
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
        [
          ctx.instituteCode, reference, title, numberOrNull(input.departmentId),
          cleanText(input.location, 180) || null, cleanText(input.contractType, 60) || null,
          Math.max(1, Number(input.openings) || 1), status,
          cleanText(input.description, 10000) || null,
          numberOrNull(input.hiringManagerId) || ctx.employeeId, ctx.userId,
        ]
      );
      vacancyId = result.insertId;
    }
    await audit(connection, ctx, req, id ? "actualizar_vaga" : "criar_vaga",
      "vacancy", vacancyId, previous, { title, status }, input.reason);
    return { id: vacancyId, status };
  });
}

async function listCandidates(ctx, query = {}) {
  const params = [ctx.instituteCode];
  let where = "c.ed_hr_candidate_institute_code = ? AND c.ed_hr_candidate_deleted = 0";
  if (query.vacancyId) {
    where += " AND c.ed_hr_candidate_vacancy_id = ?";
    params.push(Number(query.vacancyId));
  }
  const [rows] = await DATABASE.query(
    `SELECT c.*, v.ed_hr_vacancy_title AS vacancyTitle
       FROM eduall_hr_recruitment_candidates c
       JOIN eduall_hr_recruitment_vacancies v
         ON v.ed_hr_vacancy_id = c.ed_hr_candidate_vacancy_id
        AND v.ed_hr_vacancy_institute_code = c.ed_hr_candidate_institute_code
      WHERE ${where}
      ORDER BY c.ed_hr_candidate_created_at DESC`,
    params
  );
  return rows.map((row) => ({
    id: Number(row.ed_hr_candidate_id),
    vacancyId: Number(row.ed_hr_candidate_vacancy_id),
    vacancyTitle: row.vacancyTitle,
    name: row.ed_hr_candidate_name,
    email: row.ed_hr_candidate_email || "",
    phone: row.ed_hr_candidate_phone || "",
    source: row.ed_hr_candidate_source || "",
    stage: row.ed_hr_candidate_stage,
    score: row.ed_hr_candidate_score == null ? null : Number(row.ed_hr_candidate_score),
    notes: row.ed_hr_candidate_notes || "",
    createdAt: row.ed_hr_candidate_created_at,
  }));
}

async function createCandidate(ctx, req, input) {
  requireManager(ctx);
  const name = cleanText(input.name, 255);
  const vacancyId = Number(input.vacancyId);
  if (!name || !numberOrNull(vacancyId)) {
    fail(422, "HR_CANDIDATE_REQUIRED", "Nome e vaga são obrigatórios.");
  }
  return transaction(async (connection) => {
    const [vacancy] = await connection.query(
      `SELECT 1 FROM eduall_hr_recruitment_vacancies
        WHERE ed_hr_vacancy_id = ? AND ed_hr_vacancy_institute_code = ?
          AND ed_hr_vacancy_deleted = 0`,
      [vacancyId, ctx.instituteCode]
    );
    if (!vacancy.length) fail(404, "HR_VACANCY_NOT_FOUND", "Vaga não encontrada.");
    const [result] = await connection.query(
      `INSERT INTO eduall_hr_recruitment_candidates (
         ed_hr_candidate_institute_code, ed_hr_candidate_vacancy_id,
         ed_hr_candidate_name, ed_hr_candidate_email, ed_hr_candidate_phone,
         ed_hr_candidate_source, ed_hr_candidate_stage, ed_hr_candidate_score,
         ed_hr_candidate_notes, ed_hr_candidate_deleted
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
      [
        ctx.instituteCode, vacancyId, name, cleanText(input.email, 180) || null,
        cleanText(input.phone, 80) || null, cleanText(input.source, 80) || null,
        cleanText(input.stage, 40) || "triagem",
        input.score == null || input.score === "" ? null : Number(input.score),
        cleanText(input.notes, 5000) || null,
      ]
    );
    return { id: result.insertId };
  });
}

async function updateCandidate(ctx, req, id, input) {
  requireManager(ctx);
  return transaction(async (connection) => {
    const [rows] = await connection.query(
      `SELECT * FROM eduall_hr_recruitment_candidates
        WHERE ed_hr_candidate_id = ? AND ed_hr_candidate_institute_code = ?
          AND ed_hr_candidate_deleted = 0 FOR UPDATE`,
      [id, ctx.instituteCode]
    );
    if (!rows.length) fail(404, "HR_CANDIDATE_NOT_FOUND", "Candidato não encontrado.");
    const stage = cleanText(input.stage, 40) || rows[0].ed_hr_candidate_stage;
    await connection.query(
      `UPDATE eduall_hr_recruitment_candidates
          SET ed_hr_candidate_stage = ?, ed_hr_candidate_score = ?,
              ed_hr_candidate_notes = ?
        WHERE ed_hr_candidate_id = ? AND ed_hr_candidate_institute_code = ?`,
      [
        stage,
        input.score == null || input.score === "" ? rows[0].ed_hr_candidate_score : Number(input.score),
        cleanText(input.notes, 5000) || rows[0].ed_hr_candidate_notes,
        id, ctx.instituteCode,
      ]
    );
    await audit(connection, ctx, req, "mover_candidato", "candidate", id,
      { stage: rows[0].ed_hr_candidate_stage }, { stage }, input.reason);
    return { id: Number(id), stage };
  });
}

async function listExpenses(ctx, query = {}) {
  const { page, limit, offset } = normalizePage(query);
  const params = [ctx.instituteCode];
  let where = "x.ed_hr_expense_institute_code = ? AND x.ed_hr_expense_deleted = 0";
  if (!ctx.isManager) {
    where += " AND x.ed_hr_expense_employee_id = ?";
    params.push(ctx.employeeId);
  }
  if (query.status) {
    where += " AND x.ed_hr_expense_status = ?";
    params.push(cleanText(query.status, 30));
  }
  const [[count], [rows]] = await Promise.all([
    DATABASE.query(`SELECT COUNT(*) AS total FROM eduall_hr_expenses x WHERE ${where}`, params),
    DATABASE.query(
      `SELECT x.*, e.ed_employee_name AS employeeName
         FROM eduall_hr_expenses x
         LEFT JOIN eduall_employees e ON e.ed_employee_id = x.ed_hr_expense_employee_id
        WHERE ${where}
        ORDER BY x.ed_hr_expense_date DESC, x.ed_hr_expense_id DESC
        LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    ),
  ]);
  return {
    data: rows.map((row) => ({
      id: Number(row.ed_hr_expense_id),
      employeeId: row.ed_hr_expense_employee_id,
      employeeName: row.employeeName || "",
      category: row.ed_hr_expense_category,
      description: row.ed_hr_expense_description,
      amount: Number(row.ed_hr_expense_amount),
      currency: row.ed_hr_expense_currency,
      date: row.ed_hr_expense_date,
      status: row.ed_hr_expense_status,
      receiptUrl: row.ed_hr_expense_receipt_url || "",
      createdAt: row.ed_hr_expense_created_at,
    })),
    meta: buildMeta(count[0]?.total, page, limit),
  };
}

async function createExpense(ctx, req, input) {
  const amount = validatePositiveAmount(input.amount);
  const category = cleanText(input.category, 60);
  const description = cleanText(input.description, 500);
  if (!amount.ok || !category || !description) {
    fail(422, "HR_EXPENSE_INVALID", "Categoria, descrição e valor positivo são obrigatórios.");
  }
  const requestedEmployeeId = numberOrNull(input.employeeId);
  const employeeId = ctx.isManager && requestedEmployeeId
    ? requestedEmployeeId
    : ctx.employeeId;
  if (!employeeId) {
    fail(422, "HR_EMPLOYEE_REQUIRED", "É necessário indicar o colaborador da despesa.");
  }
  const status = input.status === "rascunho" ? "rascunho" : "pendente";
  return transaction(async (connection) => {
    const [employee] = await connection.query(
      `SELECT 1 FROM eduall_employees
        WHERE ed_employee_id = ? AND ed_employee_institute_code = ?
          AND ed_employee_deleted = 0`,
      [employeeId, ctx.instituteCode]
    );
    if (!employee.length) fail(404, "HR_EMPLOYEE_NOT_FOUND", "Funcionário não encontrado.");
    const [result] = await connection.query(
      `INSERT INTO eduall_hr_expenses (
         ed_hr_expense_institute_code, ed_hr_expense_employee_id,
         ed_hr_expense_category, ed_hr_expense_description,
         ed_hr_expense_amount, ed_hr_expense_currency, ed_hr_expense_date,
         ed_hr_expense_status, ed_hr_expense_receipt_url,
         ed_hr_expense_submitted_by, ed_hr_expense_deleted
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
      [
        ctx.instituteCode, employeeId, category, description, amount.value,
        cleanText(input.currency, 3).toUpperCase() || "AOA",
        cleanText(input.date, 10) || new Date().toISOString().slice(0, 10),
        status,
        cleanText(input.receiptUrl, 1000) || null, ctx.userId,
      ]
    );
    await audit(connection, ctx, req, "submeter_despesa", "expense", result.insertId, null,
      { category, description, amount: amount.value, employeeId, status }, input.reason);
    return { id: result.insertId, status };
  });
}

async function decideExpense(ctx, req, id, status, input) {
  requireManager(ctx);
  if (!["aprovada", "rejeitada"].includes(status)) {
    fail(422, "HR_EXPENSE_DECISION_INVALID", "Decisão inválida.");
  }
  return transaction(async (connection) => {
    const [rows] = await connection.query(
      `SELECT * FROM eduall_hr_expenses
        WHERE ed_hr_expense_id = ? AND ed_hr_expense_institute_code = ?
          AND ed_hr_expense_deleted = 0 FOR UPDATE`,
      [id, ctx.instituteCode]
    );
    if (!rows.length) fail(404, "HR_EXPENSE_NOT_FOUND", "Despesa não encontrada.");
    if (rows[0].ed_hr_expense_status !== "pendente") {
      fail(409, "HR_EXPENSE_ALREADY_DECIDED", "A despesa já foi decidida.");
    }
    await connection.query(
      `UPDATE eduall_hr_expenses
          SET ed_hr_expense_status = ?, ed_hr_expense_decided_by = ?,
              ed_hr_expense_decided_at = NOW()
        WHERE ed_hr_expense_id = ? AND ed_hr_expense_institute_code = ?`,
      [status, ctx.userId, id, ctx.instituteCode]
    );
    await audit(connection, ctx, req, `decidir_despesa_${status}`, "expense", id,
      { status: rows[0].ed_hr_expense_status }, { status }, input.note);
    return { id: Number(id), status };
  });
}

async function listPayroll(ctx, query = {}) {
  const params = [ctx.instituteCode];
  let where = `e.ed_employee_institute_code = ?
    AND e.ed_employee_deleted = 0
    AND (p.hr_status IS NULL OR p.hr_status <> 'cancelado')`;
  if (!ctx.isManager) {
    where += " AND p.hr_tech_id = ?";
    params.push(ctx.employeeId);
  } else if (query.employeeId) {
    where += " AND p.hr_tech_id = ?";
    params.push(Number(query.employeeId));
  }
  if (query.month) {
    where += " AND p.hr_ref_month = ?";
    params.push(cleanText(query.month, 7));
  }
  const [rows] = await DATABASE.query(
    `SELECT p.*, e.ed_employee_name AS employeeName, e.ed_employee_code AS employeeCode
       FROM eduall_hr_payments p
       JOIN eduall_employees e
         ON e.ed_employee_id = p.hr_tech_id
        AND e.ed_employee_institute_code = ?
        AND e.ed_employee_deleted = 0
      WHERE ${where}
      ORDER BY p.hr_ref_month DESC, e.ed_employee_name ASC
      LIMIT 500`,
    [ctx.instituteCode, ...params]
  );
  return rows.map((row) => ({
    id: Number(row.hr_id),
    employeeId: Number(row.hr_tech_id),
    employeeName: row.employeeName,
    employeeCode: row.employeeCode,
    month: row.hr_ref_month,
    baseSalary: Number(row.hr_base_salary || 0),
    bonus: Number(row.hr_bonus || 0),
    discount: Number(row.hr_discount || 0),
    net: Number(row.hr_base_salary || 0) + Number(row.hr_bonus || 0) - Number(row.hr_discount || 0),
    status: row.hr_status || "pendente",
    note: row.hr_note || "",
    createdAt: row.hr_created_at,
  }));
}

async function savePayroll(ctx, req, id, input) {
  requireManager(ctx);
  const employeeId = Number(input.employeeId);
  const month = cleanText(input.month || input.refMonth, 7);
  if (!numberOrNull(employeeId) || !/^\d{4}-\d{2}$/.test(month)) {
    fail(422, "HR_PAYROLL_INVALID", "Funcionário e mês de referência válido são obrigatórios.");
  }
  return transaction(async (connection) => {
    const [employee] = await connection.query(
      `SELECT 1 FROM eduall_employees
        WHERE ed_employee_id = ? AND ed_employee_institute_code = ?
          AND ed_employee_deleted = 0`,
      [employeeId, ctx.instituteCode]
    );
    if (!employee.length) fail(404, "HR_EMPLOYEE_NOT_FOUND", "Funcionário não encontrado.");
    const payrollId = numberOrNull(id);
    let previous = null;
    let resultId = payrollId;
    if (payrollId) {
      const [rows] = await connection.query(
        `SELECT p.* FROM eduall_hr_payments p
           JOIN eduall_employees e ON e.ed_employee_id = p.hr_tech_id
          WHERE p.hr_id = ? AND e.ed_employee_institute_code = ?
            AND e.ed_employee_deleted = 0
          FOR UPDATE`,
        [payrollId, ctx.instituteCode]
      );
      if (!rows.length) fail(404, "HR_PAYROLL_NOT_FOUND", "Processamento salarial não encontrado.");
      previous = rows[0];
      await connection.query(
        `UPDATE eduall_hr_payments
            SET hr_base_salary = ?, hr_bonus = ?, hr_discount = ?,
                hr_status = ?, hr_note = ?, hr_operator = ?
          WHERE hr_id = ?`,
        [
          Math.max(0, Number(input.baseSalary) || 0),
          Math.max(0, Number(input.bonus) || 0),
          Math.max(0, Number(input.discount) || 0),
          cleanText(input.status, 40) || "pendente",
          cleanText(input.note, 255) || null,
          String(ctx.userId), payrollId,
        ]
      );
    } else {
      const [result] = await connection.query(
        `INSERT INTO eduall_hr_payments (
           hr_tech_id, hr_ref_month, hr_base_salary, hr_bonus,
           hr_discount, hr_status, hr_note, hr_operator
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          employeeId, month,
          Math.max(0, Number(input.baseSalary) || 0),
          Math.max(0, Number(input.bonus) || 0),
          Math.max(0, Number(input.discount) || 0),
          cleanText(input.status, 40) || "pendente",
          cleanText(input.note, 255) || null,
          String(ctx.userId),
        ]
      );
      resultId = result.insertId;
    }
    await audit(connection, ctx, req, payrollId ? "actualizar_salario" : "processar_salario",
      "payroll", resultId, previous, {
        employeeId, month, baseSalary: Number(input.baseSalary) || 0,
        bonus: Number(input.bonus) || 0, discount: Number(input.discount) || 0,
        status: input.status || "pendente",
      }, input.reason);
    return { id: resultId };
  });
}

async function listCourses(ctx) {
  const [rows] = await DATABASE.query(
    `SELECT c.*,
            (SELECT COUNT(*) FROM eduall_hr_training_enrollments x
              WHERE x.ed_hr_training_course_id = c.ed_hr_course_id
                AND x.ed_hr_training_enrollment_institute_code = c.ed_hr_course_institute_code
                AND x.ed_hr_training_deleted = 0) AS enrolledCount
       FROM eduall_hr_training_courses c
      WHERE c.ed_hr_course_institute_code = ? AND c.ed_hr_course_deleted = 0
      ORDER BY c.ed_hr_course_start_date DESC`,
    [ctx.instituteCode]
  );
  return rows.map((row) => ({
    id: Number(row.ed_hr_course_id),
    title: row.ed_hr_course_title,
    description: row.ed_hr_course_description || "",
    category: row.ed_hr_course_category || "",
    provider: row.ed_hr_course_provider || "",
    startDate: row.ed_hr_course_start_date,
    endDate: row.ed_hr_course_end_date,
    capacity: Number(row.ed_hr_course_capacity),
    enrolledCount: Number(row.enrolledCount || 0),
    status: row.ed_hr_course_status,
  }));
}

async function createCourse(ctx, req, input) {
  requireManager(ctx);
  const title = cleanText(input.title, 255);
  if (!title) fail(422, "HR_COURSE_TITLE_REQUIRED", "Indique o título da formação.");
  return transaction(async (connection) => {
    const [result] = await connection.query(
      `INSERT INTO eduall_hr_training_courses (
         ed_hr_course_institute_code, ed_hr_course_title,
         ed_hr_course_description, ed_hr_course_category,
         ed_hr_course_provider, ed_hr_course_start_date,
         ed_hr_course_end_date, ed_hr_course_capacity,
         ed_hr_course_status, ed_hr_course_created_by,
         ed_hr_course_deleted
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
      [
        ctx.instituteCode, title, cleanText(input.description, 5000) || null,
        cleanText(input.category, 80) || null, cleanText(input.provider, 120) || null,
        cleanText(input.startDate, 10) || null, cleanText(input.endDate, 10) || null,
        Math.max(1, Number(input.capacity) || 20),
        cleanText(input.status, 30) || "aberto", ctx.userId,
      ]
    );
    return { id: result.insertId };
  });
}

async function enrollCourse(ctx, req, courseId, input) {
  const employeeId = ctx.isManager && input.employeeId ? Number(input.employeeId) : ctx.employeeId;
  if (!employeeId) fail(422, "HR_EMPLOYEE_LINK_REQUIRED", "A conta não está ligada a um funcionário.");
  return transaction(async (connection) => {
    const [courses] = await connection.query(
      `SELECT c.*,
              (SELECT COUNT(*) FROM eduall_hr_training_enrollments x
                WHERE x.ed_hr_training_course_id = c.ed_hr_course_id
                  AND x.ed_hr_training_enrollment_institute_code = c.ed_hr_course_institute_code
                  AND x.ed_hr_training_deleted = 0) AS enrolled
         FROM eduall_hr_training_courses c
        WHERE c.ed_hr_course_id = ? AND c.ed_hr_course_institute_code = ?
          AND c.ed_hr_course_deleted = 0 FOR UPDATE`,
      [courseId, ctx.instituteCode]
    );
    if (!courses.length) fail(404, "HR_COURSE_NOT_FOUND", "Formação não encontrada.");
    if (Number(courses[0].enrolled) >= Number(courses[0].ed_hr_course_capacity)) {
      fail(409, "HR_COURSE_FULL", "A formação não tem vagas disponíveis.");
    }
    const [exists] = await connection.query(
      `SELECT ed_hr_training_enrollment_id AS id, ed_hr_training_deleted AS deleted
         FROM eduall_hr_training_enrollments
        WHERE ed_hr_training_enrollment_institute_code = ?
          AND ed_hr_training_course_id = ?
          AND ed_hr_training_employee_id = ?`,
      [ctx.instituteCode, courseId, employeeId]
    );
    if (exists.length && !exists[0].deleted) fail(409, "HR_COURSE_ALREADY_ENROLLED", "Já está inscrito.");
    if (exists.length) {
      await connection.query(
        `UPDATE eduall_hr_training_enrollments
            SET ed_hr_training_status = 'inscrito', ed_hr_training_deleted = 0
          WHERE ed_hr_training_enrollment_id = ?`,
        [exists[0].id]
      );
      return { id: Number(exists[0].id), status: "inscrito" };
    }
    const [result] = await connection.query(
      `INSERT INTO eduall_hr_training_enrollments (
         ed_hr_training_enrollment_institute_code, ed_hr_training_course_id,
         ed_hr_training_employee_id, ed_hr_training_status, ed_hr_training_deleted
       ) VALUES (?, ?, ?, 'inscrito', 0)`,
      [ctx.instituteCode, courseId, employeeId]
    );
    return { id: result.insertId, status: "inscrito" };
  });
}

async function listDocuments(ctx, query = {}) {
  const params = [ctx.instituteCode];
  let where = "d.ed_hr_document_institute_code = ? AND d.ed_hr_document_deleted = 0";
  if (!ctx.isManager) {
    where += " AND d.ed_hr_document_employee_id = ?";
    params.push(ctx.employeeId);
  } else if (query.employeeId) {
    where += " AND d.ed_hr_document_employee_id = ?";
    params.push(Number(query.employeeId));
  }
  const [rows] = await DATABASE.query(
    `SELECT d.*, e.ed_employee_name AS employeeName
       FROM eduall_hr_documents d
       LEFT JOIN eduall_employees e ON e.ed_employee_id = d.ed_hr_document_employee_id
      WHERE ${where}
      ORDER BY d.ed_hr_document_created_at DESC`,
    params
  );
  return rows.map((row) => ({
    id: Number(row.ed_hr_document_id),
    employeeId: row.ed_hr_document_employee_id,
    employeeName: row.employeeName || "",
    type: row.ed_hr_document_type,
    title: row.ed_hr_document_title,
    fileUrl: row.ed_hr_document_file_url || "",
    fileName: row.ed_hr_document_file_name || "",
    status: row.ed_hr_document_status,
    validUntil: row.ed_hr_document_valid_until,
    notes: row.ed_hr_document_notes || "",
    createdAt: row.ed_hr_document_created_at,
  }));
}

async function createDocument(ctx, req, input) {
  const title = cleanText(input.title, 255);
  const type = cleanText(input.type, 80);
  if (!title || !type) fail(422, "HR_DOCUMENT_REQUIRED", "Tipo e título são obrigatórios.");
  const employeeId = ctx.isManager && input.employeeId ? Number(input.employeeId) : ctx.employeeId;
  return transaction(async (connection) => {
    const [result] = await connection.query(
      `INSERT INTO eduall_hr_documents (
         ed_hr_document_institute_code, ed_hr_document_employee_id,
         ed_hr_document_type, ed_hr_document_title,
         ed_hr_document_file_url, ed_hr_document_file_name,
         ed_hr_document_status, ed_hr_document_valid_until,
         ed_hr_document_notes, ed_hr_document_created_by,
         ed_hr_document_deleted
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
      [
        ctx.instituteCode, employeeId, type, title,
        cleanText(input.fileUrl, 1000) || null,
        cleanText(input.fileName, 255) || null,
        cleanText(input.status, 30) || "pendente",
        cleanText(input.validUntil, 10) || null,
        cleanText(input.notes, 5000) || null, ctx.userId,
      ]
    );
    await audit(connection, ctx, req, "criar_documento", "document", result.insertId, null,
      { title, type, employeeId }, input.reason);
    return { id: result.insertId, status: input.status || "pendente" };
  });
}

async function updateDocument(ctx, req, id, input) {
  return transaction(async (connection) => {
    const [rows] = await connection.query(
      `SELECT * FROM eduall_hr_documents
        WHERE ed_hr_document_id = ? AND ed_hr_document_institute_code = ?
          AND ed_hr_document_deleted = 0 FOR UPDATE`,
      [id, ctx.instituteCode]
    );
    if (!rows.length) fail(404, "HR_DOCUMENT_NOT_FOUND", "Documento não encontrado.");
    if (!ctx.isManager && Number(rows[0].ed_hr_document_employee_id) !== ctx.employeeId) {
      fail(403, "HR_DOCUMENT_SCOPE_DENIED", "Documento fora do seu âmbito.");
    }
    const status = cleanText(input.status, 30) || rows[0].ed_hr_document_status;
    await connection.query(
      `UPDATE eduall_hr_documents
          SET ed_hr_document_status = ?, ed_hr_document_valid_until = ?,
              ed_hr_document_notes = ?, ed_hr_document_file_url = ?
        WHERE ed_hr_document_id = ? AND ed_hr_document_institute_code = ?`,
      [
        status, cleanText(input.validUntil, 10) || rows[0].ed_hr_document_valid_until,
        cleanText(input.notes, 5000) || rows[0].ed_hr_document_notes,
        cleanText(input.fileUrl, 1000) || rows[0].ed_hr_document_file_url,
        id, ctx.instituteCode,
      ]
    );
    await audit(connection, ctx, req, "actualizar_documento", "document", id,
      { status: rows[0].ed_hr_document_status }, { status }, input.reason);
    return { id: Number(id), status };
  });
}

async function listShifts(ctx, query = {}) {
  const params = [ctx.instituteCode];
  let where = "s.ed_hr_shift_institute_code = ? AND s.ed_hr_shift_deleted = 0";
  if (!ctx.isManager) {
    where += " AND (s.ed_hr_shift_employee_id = ? OR s.ed_hr_shift_employee_id IS NULL)";
    params.push(ctx.employeeId || 0);
  }
  if (query.from) {
    where += " AND s.ed_hr_shift_work_date >= ?";
    params.push(cleanText(query.from, 10));
  }
  if (query.to) {
    where += " AND s.ed_hr_shift_work_date <= ?";
    params.push(cleanText(query.to, 10));
  }
  const [rows] = await DATABASE.query(
    `SELECT s.*, e.ed_employee_name AS employeeName
       FROM eduall_hr_shifts s
       LEFT JOIN eduall_employees e ON e.ed_employee_id = s.ed_hr_shift_employee_id
      WHERE ${where}
      ORDER BY s.ed_hr_shift_work_date, s.ed_hr_shift_start_time`,
    params
  );
  return rows.map((row) => ({
    id: Number(row.ed_hr_shift_id),
    employeeId: row.ed_hr_shift_employee_id,
    employeeName: row.employeeName || "",
    workDate: row.ed_hr_shift_work_date,
    startTime: row.ed_hr_shift_start_time,
    endTime: row.ed_hr_shift_end_time,
    location: row.ed_hr_shift_location || "",
    notes: row.ed_hr_shift_notes || "",
    status: row.ed_hr_shift_status,
  }));
}

async function createShift(ctx, req, input) {
  requireManager(ctx);
  const workDate = cleanText(input.workDate, 10);
  const startTime = cleanText(input.startTime, 8);
  const endTime = cleanText(input.endTime, 8);
  if (!workDate || !startTime || !endTime || endTime <= startTime) {
    fail(422, "HR_SHIFT_INVALID", "Indique data e horário válidos.");
  }
  return transaction(async (connection) => {
    const [result] = await connection.query(
      `INSERT INTO eduall_hr_shifts (
         ed_hr_shift_institute_code, ed_hr_shift_employee_id,
         ed_hr_shift_work_date, ed_hr_shift_start_time,
         ed_hr_shift_end_time, ed_hr_shift_location,
         ed_hr_shift_department, ed_hr_shift_notes,
         ed_hr_shift_status, ed_hr_shift_created_by,
         ed_hr_shift_deleted
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
      [
        ctx.instituteCode, numberOrNull(input.employeeId), workDate,
        startTime, endTime, cleanText(input.location, 180) || null,
        numberOrNull(input.departmentId), cleanText(input.notes, 5000) || null,
        cleanText(input.status, 30) || "planeado", ctx.userId,
      ]
    );
    return { id: result.insertId };
  });
}

async function organization(ctx) {
  const [departments, employeeList] = await Promise.all([
    DATABASE.query(
      `SELECT d.ed_department_id AS id, d.ed_department_title AS name,
              d.ed_department_description AS description,
              (SELECT COUNT(*) FROM eduall_employees e
                WHERE e.ed_employee_department = d.ed_department_id
                  AND e.ed_employee_institute_code = ?
                  AND e.ed_employee_deleted = 0) AS employeeCount
         FROM eduall_department d
        WHERE d.ed_department_deleted = 0
          AND (d.ed_department_institute_code = ? OR d.ed_department_institute_code IS NULL)
        ORDER BY d.ed_department_title`,
      [ctx.instituteCode, ctx.instituteCode]
    ),
    listEmployees(ctx, { limit: 100 }),
  ]);
  return {
    departments: departments[0].map((row) => ({
      id: Number(row.id),
      name: row.name,
      description: row.description || "",
      employeeCount: Number(row.employeeCount || 0),
    })),
    employees: employeeList.data,
  };
}

async function saveDepartment(ctx, req, id, input) {
  requireManager(ctx);
  const name = cleanText(input.name, 180);
  if (!name) fail(422, "HR_DEPARTMENT_NAME_REQUIRED", "Indique o nome do departamento.");
  return transaction(async (connection) => {
    let departmentId = numberOrNull(id);
    if (departmentId) {
      const [rows] = await connection.query(
        `SELECT * FROM eduall_department
          WHERE ed_department_id = ? AND ed_department_deleted = 0
            AND (ed_department_institute_code = ? OR ed_department_institute_code IS NULL)
          FOR UPDATE`,
        [departmentId, ctx.instituteCode]
      );
      if (!rows.length) fail(404, "HR_DEPARTMENT_NOT_FOUND", "Departamento não encontrado.");
      await connection.query(
        `UPDATE eduall_department
            SET ed_department_title = ?, ed_department_description = ?,
                ed_department_institute_code = ?, ed_department_updated_at = NOW()
          WHERE ed_department_id = ?`,
        [name, cleanText(input.description, 1000) || null, ctx.instituteCode, departmentId]
      );
    } else {
      const [result] = await connection.query(
        `INSERT INTO eduall_department (
           ed_department_title, ed_department_description,
           ed_department_deleted, ed_department_institute_code,
           ed_department_updated_at
         ) VALUES (?, ?, 0, ?, NOW())`,
        [name, cleanText(input.description, 1000) || null, ctx.instituteCode]
      );
      departmentId = result.insertId;
    }
    await audit(connection, ctx, req, id ? "actualizar_departamento" : "criar_departamento",
      "department", departmentId, null, { name }, input.reason);
    return { id: departmentId };
  });
}

async function analytics(ctx) {
  const [[employees], [vacations], [expenses], [training], [recruitment], [projects]] =
    await Promise.all([
      DATABASE.query(
        `SELECT COUNT(*) AS total,
                SUM(CASE WHEN ed_employee_status <> 0 THEN 1 ELSE 0 END) AS active
           FROM eduall_employees
          WHERE ed_employee_institute_code = ? AND ed_employee_deleted = 0`,
        [ctx.instituteCode]
      ),
      DATABASE.query(
        `SELECT ed_hr_vacation_status AS status, COUNT(*) AS total
           FROM eduall_hr_vacation_requests
          WHERE ed_hr_vacation_institute_code = ? AND ed_hr_vacation_deleted = 0
          GROUP BY ed_hr_vacation_status`,
        [ctx.instituteCode]
      ),
      DATABASE.query(
        `SELECT ed_hr_expense_status AS status, COUNT(*) AS total,
                COALESCE(SUM(ed_hr_expense_amount), 0) AS amount
           FROM eduall_hr_expenses
          WHERE ed_hr_expense_institute_code = ? AND ed_hr_expense_deleted = 0
          GROUP BY ed_hr_expense_status`,
        [ctx.instituteCode]
      ),
      DATABASE.query(
        `SELECT COUNT(*) AS courses,
                (SELECT COUNT(*) FROM eduall_hr_training_enrollments e
                  WHERE e.ed_hr_training_enrollment_institute_code = ?
                    AND e.ed_hr_training_deleted = 0) AS enrollments
           FROM eduall_hr_training_courses c
          WHERE c.ed_hr_course_institute_code = ? AND c.ed_hr_course_deleted = 0`,
        [ctx.instituteCode, ctx.instituteCode]
      ),
      DATABASE.query(
        `SELECT COUNT(*) AS vacancies,
                (SELECT COUNT(*) FROM eduall_hr_recruitment_candidates c
                  WHERE c.ed_hr_candidate_institute_code = ?
                    AND c.ed_hr_candidate_deleted = 0) AS candidates
           FROM eduall_hr_recruitment_vacancies v
          WHERE v.ed_hr_vacancy_institute_code = ? AND v.ed_hr_vacancy_deleted = 0`,
        [ctx.instituteCode, ctx.instituteCode]
      ),
      DATABASE.query(
        `SELECT ed_task_and_project_status AS status, COUNT(*) AS total
           FROM eduall_task_and_projects
          WHERE ed_task_and_project_institute_code = ?
            AND ed_task_and_project_deleted = 0
          GROUP BY ed_task_and_project_status`,
        [ctx.instituteCode]
      ),
    ]);
  return {
    employees: employees[0],
    vacations,
    expenses,
    training: training[0],
    recruitment: recruitment[0],
    projects,
  };
}

async function listUsers(ctx) {
  requireManager(ctx);
  const [rows] = await DATABASE.query(
    `SELECT ua.ed_user_account_id AS id,
            ua.ed_user_account_name AS name,
            ua.ed_user_account_email AS email,
            ua.ed_user_account_status AS status,
            e.ed_employee_charge AS role
       FROM eduall_user_institutes ui
       JOIN eduall_user_accounts ua
         ON ua.ed_user_account_id = ui.ed_user_institute_userCode
        AND ua.ed_user_account_deleted = 0
       LEFT JOIN eduall_employees e
         ON e.ed_employee_id = ui.ed_user_institute_employeeCode
        AND e.ed_employee_institute_code = ui.ed_user_institute_code
        AND e.ed_employee_deleted = 0
      WHERE ui.ed_user_institute_code = ?
        AND ui.ed_user_institute_deleted = 0
      ORDER BY ua.ed_user_account_name`,
    [ctx.instituteCode]
  );
  return rows.map((row) => ({
    id: Number(row.id),
    name: row.name,
    email: row.email,
    role: row.role || "",
    status: Number(row.status) === 0 ? "activo" : "inactivo",
  }));
}

module.exports = {
  HrError,
  canReadFeedRow,
  resolveContext,
  requireManager,
  bootstrap,
  dashboard,
  analytics,
  listEmployees,
  getEmployee,
  saveEmployee,
  deactivateEmployee,
  listFeed,
  createPost,
  listStories,
  createStory,
  getStoryMedia,
  markStoryViewed,
  updatePost,
  deletePost,
  addComment,
  deleteComment,
  toggleReaction,
  toggleCommentReaction,
  getFeedMedia,
  getFeedPost,
  listChatContacts,
  listChatConversations,
  listDiscoverableChatGroups,
  joinChatGroup,
  leaveChatGroup,
  openDirectChat,
  createChatGroup,
  updateChatGroup,
  updateChatGroupAvatar,
  deleteChatGroup,
  listChatMessages,
  getChatMedia,
  sendChatMessage,
  sharePostToChat,
  editChatMessage,
  deleteChatMessage,
  toggleChatMessageReaction,
  markChatRead,
  listVacations,
  createVacation,
  decideVacation,
  listAttendance,
  punchAttendance,
  listProjects,
  createProject,
  updateProject,
  listGoals,
  createGoal,
  updateGoal,
  listFeedback,
  createFeedback,
  listCalendar,
  saveCalendar,
  deleteCalendar,
  listVacancies,
  saveVacancy,
  listCandidates,
  createCandidate,
  updateCandidate,
  listExpenses,
  createExpense,
  decideExpense,
  listPayroll,
  savePayroll,
  listCourses,
  createCourse,
  enrollCourse,
  listDocuments,
  createDocument,
  updateDocument,
  listShifts,
  createShift,
  organization,
  saveDepartment,
  listUsers,
};
