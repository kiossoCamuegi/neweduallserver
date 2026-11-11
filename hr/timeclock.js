"use strict";

const { DATABASE } = require("../config/Database");
const { cleanText } = require("./rules");

const RESOURCES = new Set([
  "schedules",
  "shifts",
  "absences",
  "time-bank",
  "approvals",
  "geofences",
  "geofence-events",
  "geofence-exceptions",
  "settings",
]);

function fail(status, code, message) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  throw error;
}

function parseJson(value, fallback) {
  if (value && typeof value === "object") return value;
  try {
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
}

function timePart(value) {
  if (!value) return null;
  if (/^\d{2}:\d{2}/.test(String(value))) return String(value).slice(0, 5);
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value).slice(11, 16) || null;
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function datePart(value) {
  if (!value) return "";
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}/.test(value)) return value.slice(0, 10);
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString().slice(0, 10);
}

function localDateKey(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function shiftDate(value, days) {
  const date = new Date(`${value}T12:00:00`);
  date.setDate(date.getDate() + days);
  return localDateKey(date);
}

function timeToMinutes(value) {
  const match = String(value || "").match(/^(\d{2}):(\d{2})/);
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}

function workedMinutes(row) {
  const total = row.clockOut ? Math.max(0, Number(row.minutes || 0)) : 0;
  return Math.max(0, total - (total > 60 ? 60 : 0));
}

function recordStatus(row) {
  if (!row.clockIn) return "ABSENT";
  if (timePart(row.clockIn) > "09:05") return "LATE";
  return row.clockOut ? "FINISHED" : "WORKING";
}

function mapRecord(row) {
  const minutes = row.clockOut ? workedMinutes(row) : null;
  return {
    id: Number(row.id),
    employeeId: Number(row.employeeId),
    employeeName: row.employeeName || "Funcionário",
    departmentName: row.departmentName || "Sem departamento",
    date: datePart(row.workDate),
    checkIn: timePart(row.clockIn),
    checkOut: timePart(row.clockOut),
    breakMinutes: row.clockOut && Number(row.minutes || 0) > 60 ? 60 : 0,
    workedMinutes: minutes == null ? 0 : minutes,
    overtimeMinutes: minutes == null ? 0 : Math.max(0, minutes - 480),
    status: recordStatus(row),
    location: row.note?.startsWith("TIMECLOCK-SEED") ? "Sede — Luanda" : "Sede",
    method: row.note?.match(/method=([A-Z_]+)/)?.[1] || "WEB",
    updatedAt: row.updatedAt || row.createdAt,
    note: row.note || "",
  };
}

async function lookups(ctx) {
  const [employees] = await DATABASE.query(
    `SELECT e.ed_employee_id AS id, e.ed_employee_name AS name,
            e.ed_employee_department AS departmentId,
            d.ed_department_title AS departmentName,
            e.ed_employee_charge AS positionId,
            j.ed_job_title AS positionName
       FROM eduall_employees e
       LEFT JOIN eduall_department d
         ON d.ed_department_id = e.ed_employee_department
        AND d.ed_department_deleted = 0
       LEFT JOIN eduall_job_titles j
         ON j.ed_job_title_id = e.ed_employee_charge
        AND BINARY j.ed_job_title_institute_code = BINARY e.ed_employee_institute_code
      WHERE BINARY e.ed_employee_institute_code = BINARY ?
        AND e.ed_employee_deleted = 0
      ORDER BY e.ed_employee_name`,
    [ctx.instituteCode]
  );
  let [departments] = await DATABASE.query(
    `SELECT ed_department_id AS id, ed_department_title AS name
       FROM eduall_department
      WHERE BINARY ed_department_institute_code = BINARY ?
        AND ed_department_deleted = 0
      ORDER BY ed_department_title`,
    [ctx.instituteCode]
  );
  if (!departments.length) {
    [departments] = await DATABASE.query(
      `SELECT ed_department_id AS id, ed_department_title AS name
         FROM eduall_department
        WHERE ed_department_deleted = 0
        ORDER BY ed_department_id`
    );
  }
  const [positions] = await DATABASE.query(
    `SELECT ed_job_title_id AS id, ed_job_title AS name
       FROM eduall_job_titles
      WHERE BINARY ed_job_title_institute_code = BINARY ?
      ORDER BY ed_job_title`,
    [ctx.instituteCode]
  );
  const normalizedEmployees = employees.map((employee, index) => {
    const fallback = departments[index % Math.max(1, departments.length)];
    return {
      ...employee,
      departmentId: employee.departmentId || fallback?.id || null,
      departmentName: employee.departmentName || fallback?.name || "Sem departamento",
    };
  });
  return { employees: normalizedEmployees, departments, positions };
}

async function listRecords(ctx, query = {}) {
  const params = [ctx.instituteCode];
  let where = `t.ed_hr_time_entry_institute_code = ?
    AND t.ed_hr_time_entry_deleted = 0`;
  if (query.employeeId) {
    where += " AND t.ed_hr_time_entry_employee_id = ?";
    params.push(Number(query.employeeId));
  } else if (!ctx.isManager && ctx.employeeId) {
    where += " AND t.ed_hr_time_entry_employee_id = ?";
    params.push(Number(ctx.employeeId));
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
    `SELECT t.ed_hr_time_entry_id AS id,
            t.ed_hr_time_entry_employee_id AS employeeId,
            e.ed_employee_name AS employeeName,
            d.ed_department_title AS departmentName,
            t.ed_hr_time_entry_work_date AS workDate,
            t.ed_hr_time_entry_clock_in AS clockIn,
            t.ed_hr_time_entry_clock_out AS clockOut,
            t.ed_hr_time_entry_minutes AS minutes,
            t.ed_hr_time_entry_status AS status,
            t.ed_hr_time_entry_note AS note,
            t.ed_hr_time_entry_created_at AS createdAt,
            t.ed_hr_time_entry_updated_at AS updatedAt
       FROM eduall_hr_time_entries t
       JOIN eduall_employees e
         ON e.ed_employee_id = t.ed_hr_time_entry_employee_id
        AND BINARY e.ed_employee_institute_code = BINARY t.ed_hr_time_entry_institute_code
        AND e.ed_employee_deleted = 0
       LEFT JOIN eduall_department d
         ON d.ed_department_id = e.ed_employee_department
        AND d.ed_department_deleted = 0
      WHERE ${where}
      ORDER BY t.ed_hr_time_entry_work_date DESC, t.ed_hr_time_entry_id DESC
      LIMIT 2000`,
    params
  );
  return { items: rows.map(mapRecord) };
}

function allowedEmployeeId(ctx, requested) {
  const employeeId = ctx.isManager && requested ? Number(requested) : Number(ctx.employeeId || requested);
  if (!employeeId) fail(422, "HR_TIMECLOCK_EMPLOYEE_REQUIRED", "Selecione um funcionário.");
  if (!ctx.isManager && Number(employeeId) !== Number(ctx.employeeId)) {
    fail(403, "HR_TIMECLOCK_EMPLOYEE_DENIED", "Só pode alterar as suas próprias picagens.");
  }
  return employeeId;
}

async function recordById(ctx, id) {
  const result = await listRecords(ctx, {});
  return (result.items || []).find((row) => Number(row.id) === Number(id)) || null;
}

async function createRecord(ctx, input = {}) {
  const employeeId = allowedEmployeeId(ctx, input.employeeId);
  const date = cleanText(input.date, 10);
  const checkIn = cleanText(input.checkIn, 5);
  const checkOut = cleanText(input.checkOut, 5) || null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(checkIn)) {
    fail(422, "HR_TIMECLOCK_RECORD_INVALID", "Data e entrada são obrigatórias.");
  }
  const [result] = await DATABASE.query(
    `INSERT INTO eduall_hr_time_entries (
       ed_hr_time_entry_institute_code, ed_hr_time_entry_employee_id,
       ed_hr_time_entry_work_date, ed_hr_time_entry_clock_in,
       ed_hr_time_entry_clock_out, ed_hr_time_entry_minutes,
       ed_hr_time_entry_status, ed_hr_time_entry_note,
       ed_hr_time_entry_deleted
     ) VALUES (?, ?, ?, STR_TO_DATE(CONCAT(?, ' ', ?), '%Y-%m-%d %H:%i'),
       IF(? IS NULL, NULL, STR_TO_DATE(CONCAT(?, ' ', ?), '%Y-%m-%d %H:%i')),
       IF(? IS NULL, NULL, TIMESTAMPDIFF(MINUTE,
         STR_TO_DATE(CONCAT(?, ' ', ?), '%Y-%m-%d %H:%i'),
         STR_TO_DATE(CONCAT(?, ' ', ?), '%Y-%m-%d %H:%i'))),
       ?, ?, 0)`,
    [
      ctx.instituteCode, employeeId, date, date, checkIn,
      checkOut, date, checkOut,
      checkOut, date, checkIn, date, checkOut,
      checkOut ? "fechado" : "aberto",
      cleanText(input.note, 500) || "method=WEB",
    ]
  );
  return recordById(ctx, result.insertId);
}

async function updateRecord(ctx, id, input = {}) {
  const current = await recordById(ctx, id);
  if (!current) fail(404, "HR_TIMECLOCK_RECORD_NOT_FOUND", "Picagem não encontrada.");
  allowedEmployeeId(ctx, input.employeeId || current.employeeId);
  const employeeId = allowedEmployeeId(ctx, input.employeeId || current.employeeId);
  const date = cleanText(input.date, 10) || current.date;
  const checkIn = cleanText(input.checkIn, 5) || current.checkIn;
  const checkOut = cleanText(input.checkOut, 5) || null;
  await DATABASE.query(
    `UPDATE eduall_hr_time_entries
        SET ed_hr_time_entry_employee_id = ?,
            ed_hr_time_entry_work_date = ?,
            ed_hr_time_entry_clock_in = STR_TO_DATE(CONCAT(?, ' ', ?), '%Y-%m-%d %H:%i'),
            ed_hr_time_entry_clock_out = IF(? IS NULL, NULL, STR_TO_DATE(CONCAT(?, ' ', ?), '%Y-%m-%d %H:%i')),
            ed_hr_time_entry_minutes = IF(? IS NULL, NULL, TIMESTAMPDIFF(MINUTE,
              STR_TO_DATE(CONCAT(?, ' ', ?), '%Y-%m-%d %H:%i'),
              STR_TO_DATE(CONCAT(?, ' ', ?), '%Y-%m-%d %H:%i'))),
            ed_hr_time_entry_status = ?,
            ed_hr_time_entry_note = ?
      WHERE ed_hr_time_entry_id = ?
        AND BINARY ed_hr_time_entry_institute_code = BINARY ?`,
    [
      employeeId, date, date, checkIn,
      checkOut, date, checkOut,
      checkOut, date, checkIn, date, checkOut,
      checkOut ? "fechado" : "aberto",
      cleanText(input.note, 500) || current.note,
      Number(id), ctx.instituteCode,
    ]
  );
  return recordById(ctx, id);
}

async function deleteRecord(ctx, id) {
  const current = await recordById(ctx, id);
  if (!current) fail(404, "HR_TIMECLOCK_RECORD_NOT_FOUND", "Picagem não encontrada.");
  allowedEmployeeId(ctx, current.employeeId);
  await DATABASE.query(
    `UPDATE eduall_hr_time_entries SET ed_hr_time_entry_deleted = 1
      WHERE ed_hr_time_entry_id = ?
        AND BINARY ed_hr_time_entry_institute_code = BINARY ?`,
    [Number(id), ctx.instituteCode]
  );
  return { id: Number(id), deleted: true };
}

async function duplicateRecord(ctx, id) {
  const current = await recordById(ctx, id);
  if (!current) fail(404, "HR_TIMECLOCK_RECORD_NOT_FOUND", "Picagem não encontrada.");
  return createRecord(ctx, {
    employeeId: current.employeeId,
    date: current.date,
    checkIn: current.checkIn,
    checkOut: current.checkOut,
    note: `${current.note || ""} duplicate=1`.trim(),
  });
}

async function correctRecord(ctx, id, input = {}) {
  const current = await recordById(ctx, id);
  if (!current) fail(404, "HR_TIMECLOCK_RECORD_NOT_FOUND", "Picagem não encontrada.");
  return updateRecord(ctx, id, {
    ...current,
    ...input,
    note: `${current.note || ""} correction=${cleanText(input.reason, 300)}`.trim(),
  });
}

function normalizeDocument(resource, input = {}) {
  const data = { ...input };
  const today = localDateKey();
  if (resource === "schedules") {
    data.activeDays = Array.isArray(data.activeDays) ? data.activeDays.map(Number) : [1, 2, 3, 4, 5];
    data.employeeIds = Array.isArray(data.employeeIds) ? data.employeeIds.map(String) : [];
    data.departmentIds = Array.isArray(data.departmentIds) ? data.departmentIds.map(String) : [];
    data.employeeCount = data.employeeIds.length;
    data.status = data.status || "ACTIVE";
    data.breakMinutes = Math.max(0, Number(data.breakMinutes || 0));
  }
  if (resource === "shifts") {
    data.substituteName = data.substituteName || null;
    data.shiftType = data.shiftType || "MORNING";
    data.scaleType = data.scaleType || "WEEKLY";
    data.rotation = data.rotation || "AUTOMATIC";
  }
  if (resource === "absences") {
    data.status = data.status || "PENDING";
    data.type = data.type || "VACATION";
    data.hasCertificate = Boolean(data.hasCertificate);
    const start = datePart(data.startDate);
    const end = datePart(data.endDate);
    if (start && end) {
      const duration = Math.round(
        (new Date(`${end}T12:00:00`).getTime() - new Date(`${start}T12:00:00`).getTime()) / 86_400_000
      );
      data.days = Math.max(1, duration + 1);
    }
  }
  if (resource === "time-bank") {
    data.type = data.type || "CREDIT";
    data.minutes = Math.max(0, Number(data.minutes || 0));
    data.date = datePart(data.date) || today;
  }
  if (resource === "approvals") {
    data.status = data.status || "PENDING";
    data.step = Math.max(0, Math.min(2, Number(data.step || 0)));
  }
  if (resource === "geofences") {
    data.status = data.status || "ACTIVE";
    data.radiusMeters = Math.max(25, Number(data.radiusMeters || 150));
    data.employeeIds = Array.isArray(data.employeeIds) ? data.employeeIds.map(String) : [];
    data.departmentIds = Array.isArray(data.departmentIds) ? data.departmentIds.map(String) : [];
    data.employeeCount = data.employeeIds.length;
  }
  if (resource === "geofence-events") {
    data.result = data.result || "ALLOWED";
    data.at = data.at || new Date().toISOString();
  }
  if (resource === "geofence-exceptions") {
    data.status = data.status || "ACTIVE";
  }
  return data;
}

function enrichDocument(resource, row, employeeMap) {
  const employee = row.employeeId ? employeeMap.get(String(row.employeeId)) : null;
  const employeeName = row.employeeName || employee?.name || "";
  const departmentName = row.departmentName || employee?.departmentName || "";
  if (resource === "shifts" || resource === "absences" || resource === "time-bank" || resource === "approvals"
    || resource === "geofence-events" || resource === "geofence-exceptions") {
    return { ...row, employeeName, departmentName };
  }
  if (resource === "schedules") {
    const employees = Array.isArray(row.employeeIds) ? row.employeeIds.map(String) : [];
    return { ...row, employeeCount: employees.length };
  }
  return row;
}

async function documents(ctx, resource) {
  if (!RESOURCES.has(resource)) fail(404, "HR_TIMECLOCK_RESOURCE_NOT_FOUND", "Recurso inválido.");
  if (resource === "settings") {
    const [rows] = await DATABASE.query(
      `SELECT ed_hr_timeclock_document_id AS id,
              ed_hr_timeclock_document_data AS data
         FROM eduall_hr_timeclock_documents
        WHERE BINARY ed_hr_timeclock_document_institute_code = BINARY ?
          AND ed_hr_timeclock_document_resource = 'settings'
          AND ed_hr_timeclock_document_deleted = 0
        ORDER BY ed_hr_timeclock_document_id ASC
        LIMIT 1`,
      [ctx.instituteCode]
    );
    return rows[0] ? { ...parseJson(rows[0].data, {}), id: Number(rows[0].id) } : {};
  }
  const [rows] = await DATABASE.query(
    `SELECT ed_hr_timeclock_document_id AS id,
            ed_hr_timeclock_document_data AS data,
            ed_hr_timeclock_document_created_at AS createdAt,
            ed_hr_timeclock_document_updated_at AS updatedAt
       FROM eduall_hr_timeclock_documents
      WHERE BINARY ed_hr_timeclock_document_institute_code = BINARY ?
        AND ed_hr_timeclock_document_resource = ?
        AND ed_hr_timeclock_document_deleted = 0
      ORDER BY ed_hr_timeclock_document_id ASC
      LIMIT 1000`,
    [ctx.instituteCode, resource]
  );
  const employeeMap = new Map(
    (await lookups(ctx)).employees.map((employee) => [String(employee.id), employee])
  );
  return {
    items: rows.map((row) => {
      const data = parseJson(row.data, {});
      return enrichDocument(resource, {
        ...data,
        id: Number(row.id),
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      }, employeeMap);
    }),
  };
}

async function getDocument(ctx, resource, id) {
  const [rows] = await DATABASE.query(
    `SELECT ed_hr_timeclock_document_id AS id,
            ed_hr_timeclock_document_data AS data
       FROM eduall_hr_timeclock_documents
      WHERE ed_hr_timeclock_document_id = ?
        AND BINARY ed_hr_timeclock_document_institute_code = BINARY ?
        AND ed_hr_timeclock_document_resource = ?
        AND ed_hr_timeclock_document_deleted = 0
      LIMIT 1`,
    [Number(id), ctx.instituteCode, resource]
  );
  return rows[0] ? { ...parseJson(rows[0].data, {}), id: Number(rows[0].id) } : null;
}

async function putDocument(ctx, resource, id, input) {
  if (!RESOURCES.has(resource)) fail(404, "HR_TIMECLOCK_RESOURCE_NOT_FOUND", "Recurso inválido.");
  const data = normalizeDocument(resource, input || {});
  delete data.id;
  delete data.createdAt;
  delete data.updatedAt;
  const serialized = JSON.stringify(data);
  if (serialized.length > 200_000) {
    fail(422, "HR_TIMECLOCK_DOCUMENT_TOO_LARGE", "O registo excede o tamanho permitido.");
  }
  if (id) {
    const [result] = await DATABASE.query(
      `UPDATE eduall_hr_timeclock_documents
          SET ed_hr_timeclock_document_data = ?
        WHERE ed_hr_timeclock_document_id = ?
          AND BINARY ed_hr_timeclock_document_institute_code = BINARY ?
          AND ed_hr_timeclock_document_resource = ?
          AND ed_hr_timeclock_document_deleted = 0`,
      [serialized, Number(id), ctx.instituteCode, resource]
    );
    if (!result.affectedRows) fail(404, "HR_TIMECLOCK_DOCUMENT_NOT_FOUND", "Registo não encontrado.");
    return getDocument(ctx, resource, id);
  }
  const [result] = await DATABASE.query(
    `INSERT INTO eduall_hr_timeclock_documents (
       ed_hr_timeclock_document_institute_code,
       ed_hr_timeclock_document_resource,
       ed_hr_timeclock_document_data,
       ed_hr_timeclock_document_created_by
     ) VALUES (?, ?, ?, ?)`,
    [ctx.instituteCode, resource, serialized, ctx.userId]
  );
  return getDocument(ctx, resource, result.insertId);
}

async function deleteDocument(ctx, resource, id) {
  await DATABASE.query(
    `UPDATE eduall_hr_timeclock_documents
        SET ed_hr_timeclock_document_deleted = 1
      WHERE ed_hr_timeclock_document_id = ?
        AND BINARY ed_hr_timeclock_document_institute_code = BINARY ?
        AND ed_hr_timeclock_document_resource = ?`,
    [Number(id), ctx.instituteCode, resource]
  );
  return { id: Number(id), deleted: true };
}

async function patchDocument(ctx, resource, id, patch) {
  const current = await getDocument(ctx, resource, id);
  if (!current) fail(404, "HR_TIMECLOCK_DOCUMENT_NOT_FOUND", "Registo não encontrado.");
  return putDocument(ctx, resource, id, { ...current, ...patch });
}

function uniqueEmployeeIds(rows) {
  return new Set(rows.map((row) => String(row.employeeId)).filter(Boolean));
}

function changePercentage(current, previous) {
  if (!previous) return current ? 100 : 0;
  return Math.round(((current - previous) / previous) * 100);
}

function rowIsLate(row) {
  const checkIn = timePart(row.checkIn);
  return Boolean(checkIn && checkIn > "09:05");
}

function dateLabel(value) {
  return new Date(`${value}T12:00:00`).toLocaleDateString("pt-PT", { weekday: "short" });
}

function monthKeys(count) {
  const now = new Date();
  return Array.from({ length: count }, (_, index) => {
    const date = new Date(now.getFullYear(), now.getMonth() - (count - 1 - index), 1, 12);
    return {
      key: `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`,
      label: date.toLocaleDateString("pt-PT", { month: "short" }).replace(".", ""),
    };
  });
}

function absenceCoversDate(row, date) {
  const start = datePart(row.startDate);
  const end = datePart(row.endDate) || start;
  return Boolean(start && start <= date && end >= date);
}

async function timeclockSummary(ctx) {
  const [recordsResult, approvalsResult, absencesResult, employeesResult] = await Promise.all([
    listRecords(ctx, {}),
    documents(ctx, "approvals"),
    documents(ctx, "absences"),
    lookups(ctx),
  ]);
  const records = recordsResult.items || [];
  const approvals = approvalsResult.items || [];
  const absences = absencesResult.items || [];
  const today = localDateKey();
  const yesterday = shiftDate(today, -1);
  const lastWeek = shiftDate(today, -7);
  const todayRows = records.filter((row) => row.date === today);
  const yesterdayRows = records.filter((row) => row.date === yesterday);
  const expected = employeesResult.employees.length;
  const todayPresentIds = uniqueEmployeeIds(todayRows.filter((row) => row.checkIn));
  const yesterdayPresentIds = uniqueEmployeeIds(yesterdayRows.filter((row) => row.checkIn));
  const present = todayPresentIds.size;
  const lateRows = todayRows.filter(rowIsLate);
  const late = uniqueEmployeeIds(lateRows).size;
  const absent = Math.max(0, expected - present);
  const overtimeToday = todayRows.reduce((sum, row) => sum + row.overtimeMinutes, 0);
  const lastWeekOvertime = records
    .filter((row) => row.date === lastWeek)
    .reduce((sum, row) => sum + row.overtimeMinutes, 0);
  const pendingApprovals = approvals.filter((row) => row.status === "PENDING");
  const pendingAbsences = absences.filter((row) => row.status === "PENDING");
  const pending = pendingApprovals.length + pendingAbsences.length;
  const pendingCategory = (category) => pendingApprovals.filter((row) => row.category === category).length;
  const todayAbsenceRows = absences.filter((row) => (
    row.status !== "REJECTED"
    && row.status !== "CANCELED"
    && absenceCoversDate(row, today)
  ));
  const absenceReasonLabels = {
    VACATION: "Férias",
    SICKNESS: "Doença",
    LEAVE: "Licença",
    JUSTIFIED_ABSENCE: "Justificada",
    UNJUSTIFIED_ABSENCE: "Não justificada",
  };
  const absenceReasons = Object.entries(
    todayAbsenceRows.reduce((counts, row) => {
      const reason = absenceReasonLabels[row.type] || row.type || "Outro";
      counts[reason] = (counts[reason] || 0) + 1;
      return counts;
    }, {})
  ).map(([reason, count]) => ({ reason, count }));
  const rate = expected ? Math.round((present / expected) * 100) : 0;
  const lastSevenDays = Array.from({ length: 7 }, (_, index) => shiftDate(today, index - 6));
  const attendanceByDay = lastSevenDays.map((date) => {
    const dayRows = records.filter((row) => row.date === date);
    const presentCount = uniqueEmployeeIds(dayRows.filter((row) => row.checkIn)).size;
    const absentIds = uniqueEmployeeIds(absences.filter((row) => (
      row.status !== "REJECTED"
      && row.status !== "CANCELED"
      && absenceCoversDate(row, date)
    )));
    const expectedCount = new Set([
      ...uniqueEmployeeIds(dayRows),
      ...absentIds,
    ]).size;
    return {
      date,
      label: dateLabel(date),
      present: presentCount,
      absent: Math.max(0, expectedCount - presentCount),
    };
  });
  const lateTrend = lastSevenDays.map((date) => ({
    date,
    label: dateLabel(date),
    count: uniqueEmployeeIds(records.filter((row) => row.date === date && rowIsLate(row))).size,
  }));
  const currentMonth = today.slice(0, 7);
  const overtimeByDepartment = Object.entries(
    records
      .filter((row) => row.date.startsWith(currentMonth))
      .reduce((groups, row) => {
        const label = row.departmentName || "Sem departamento";
        groups[label] = (groups[label] || 0) + Number(row.overtimeMinutes || 0);
        return groups;
      }, {})
  )
    .map(([label, minutes]) => ({ label, hours: Number((minutes / 60).toFixed(1)) }))
    .filter((row) => row.hours > 0)
    .sort((a, b) => b.hours - a.hours);
  const absencesByMonth = monthKeys(6).map((month) => ({
    label: month.label,
    count: absences.filter((row) => datePart(row.startDate).startsWith(month.key)).length,
  }));
  const lateDelayMinutes = lateRows.map((row) => Math.max(0, timeToMinutes(row.checkIn) - timeToMinutes("09:05")));
  const avgDelayMinutes = lateDelayMinutes.length
    ? Math.round(lateDelayMinutes.reduce((sum, value) => sum + value, 0) / lateDelayMinutes.length)
    : null;
  const yesterdayOvertimeRows = records.filter((row) => row.date === yesterday && row.overtimeMinutes > 120);
  const alerts = [
    ...(pending ? [{ type: "PENDING_REQUEST", text: `${pending} pedidos aguardam aprovação.` }] : []),
    ...todayAbsenceRows
      .filter((row) => row.type === "UNJUSTIFIED_ABSENCE")
      .slice(0, 3)
      .map((row) => ({ type: "UNJUSTIFIED_ABSENCE", text: `${row.employeeName} sem justificação em ${today}.` })),
    ...yesterdayOvertimeRows.slice(0, 3).map((row) => ({
      type: "EXCESS_OVERTIME",
      text: `${row.employeeName} registou ${row.overtimeMinutes} min de horas extra ontem.`,
    })),
  ];
  return {
    kpis: {
      expected: { total: expected, vsYesterdayPct: changePercentage(present, yesterdayPresentIds.size) },
      present: { total: present, ratePct: rate },
      absent: { total: absent, byReason: absenceReasons },
      late: { total: late, avgDelayMinutes },
      overtime: { todayMinutes: overtimeToday, vsLastWeekPct: changePercentage(overtimeToday, lastWeekOvertime) },
      pending: {
        total: pending,
        vacation: pendingAbsences.filter((row) => row.type === "VACATION").length + pendingCategory("Férias"),
        timeBank: pendingCategory("Banco de horas"),
        adjustments: pendingCategory("Ajuste de registo"),
        approvals: pendingApprovals.length,
      },
    },
    rates: {
      attendance: rate,
      absenteeism: expected ? Math.round((absent / expected) * 100) : 0,
      punctuality: present ? Math.round(((present - late) / present) * 100) : 0,
      workedMinutes: todayRows.reduce((sum, row) => sum + row.workedMinutes, 0),
    },
    charts: { attendanceByDay, absencesByMonth, overtimeByDepartment, lateTrend },
    dailySummary: {
      present,
      late,
      absent,
      onBreak: 0,
      working: uniqueEmployeeIds(todayRows.filter((row) => row.checkIn && !row.checkOut)).size,
      finished: uniqueEmployeeIds(todayRows.filter((row) => row.checkIn && row.checkOut)).size,
    },
    alerts,
    recentActivity: records.slice(0, 8).map((row) => ({
      type: "CLOCK",
      text: `${row.employeeName} — ${row.checkIn || "sem entrada"}${row.checkOut ? ` / ${row.checkOut}` : ""}`,
      at: row.updatedAt || `${row.date}T00:00:00`,
    })),
  };
}

async function shiftCoverage(ctx, query = {}) {
  const result = await documents(ctx, "shifts");
  const from = datePart(query.from) || localDateKey();
  const to = datePart(query.to) || from;
  const out = [];
  for (let key = from; key && key <= to; key = shiftDate(key, 1)) {
    out.push({
      date: key,
      scheduled: (result.items || []).filter((row) => row.date === key && row.shiftType !== "DAY_OFF").length,
      required: 3,
    });
  }
  return out;
}

function distanceMeters(lat1, lng1, lat2, lng2) {
  const toRadians = (value) => (Number(value) * Math.PI) / 180;
  const earthRadius = 6_371_000;
  const deltaLat = toRadians(lat2 - lat1);
  const deltaLng = toRadians(lng2 - lng1);
  const value = Math.sin(deltaLat / 2) ** 2
    + Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) * Math.sin(deltaLng / 2) ** 2;
  return 2 * earthRadius * Math.asin(Math.sqrt(value));
}

async function tracking(ctx) {
  const [employeeResult, zonesResult, eventsResult, recordsResult] = await Promise.all([
    lookups(ctx),
    documents(ctx, "geofences"),
    documents(ctx, "geofence-events"),
    listRecords(ctx, {}),
  ]);
  const today = localDateKey();
  const zones = zonesResult.items || [];
  const events = [...(eventsResult.items || [])].sort((a, b) => String(b.at).localeCompare(String(a.at)));
  const latestEventByEmployee = new Map();
  events.forEach((event) => {
    if (!latestEventByEmployee.has(String(event.employeeId))) {
      latestEventByEmployee.set(String(event.employeeId), event);
    }
  });
  const todayByEmployee = new Map();
  recordsResult.items
    .filter((row) => row.date === today)
    .forEach((row) => todayByEmployee.set(String(row.employeeId), row));

  return employeeResult.employees.map((employee, index) => {
    const event = latestEventByEmployee.get(String(employee.id));
    const defaultZone = zones[index % Math.max(1, zones.length)];
    const eventZone = zones.find((zone) => String(zone.id) === String(event?.zoneId)) || defaultZone;
    const lat = Number(event?.lat ?? eventZone?.lat ?? -8.8383) + ((index % 5) - 2) * 0.00018;
    const lng = Number(event?.lng ?? eventZone?.lng ?? 13.2344) + ((index % 4) - 1.5) * 0.00016;
    const nearest = zones
      .filter((zone) => zone.status !== "INACTIVE")
      .map((zone) => ({
        zone,
        distance: distanceMeters(lat, lng, Number(zone.lat), Number(zone.lng)),
      }))
      .sort((a, b) => a.distance - b.distance)[0];
    const inside = nearest && nearest.distance <= Number(nearest.zone.radiusMeters || 150);
    const record = todayByEmployee.get(String(employee.id));
    const active = Boolean(record?.checkIn && !record?.checkOut);
    const lastSeen = event?.at || record?.updatedAt || record?.date || new Date().toISOString();
    return {
      id: String(employee.id),
      employeeId: String(employee.id),
      name: employee.name,
      role: employee.positionName || "Funcionário",
      team: employee.departmentName || "Sem departamento",
      departmentId: String(employee.departmentId || ""),
      departmentName: employee.departmentName || "",
      lat,
      lng,
      accuracy: 8 + (index % 5) * 3,
      online: active,
      presence: active ? "ACTIVE" : "OFFLINE",
      zoneId: inside ? String(nearest.zone.id) : null,
      assignedZoneId: inside ? String(nearest.zone.id) : (nearest ? String(nearest.zone.id) : ""),
      status: inside ? "INSIDE" : "OUTSIDE",
      speedMps: 0,
      speedKmh: 0,
      roam: Math.min(3, Number((nearest?.distance / 100 || 0).toFixed(1))),
      trail: [[lat, lng]],
      lastSeen,
      updatedAt: new Date().toISOString(),
    };
  });
}

module.exports = {
  RESOURCES,
  correctRecord,
  createRecord,
  deleteRecord,
  deleteDocument,
  documents,
  duplicateRecord,
  getDocument,
  listRecords,
  lookups,
  patchDocument,
  putDocument,
  shiftCoverage,
  timeclockSummary,
  tracking,
  updateRecord,
};
