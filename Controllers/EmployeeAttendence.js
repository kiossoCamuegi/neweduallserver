const ExecuteQuery = require("../Functions/ExecuteQuery");
const Cache = require("../Functions/CacheRoutes");
const { RegisterAuditAction } = require("./Auditory");

const ATTENDANCE_CACHE_TTL = 3600;

const CacheKeys = {
  list: (instituteCode) => `attendance:list:${instituteCode}`,
  byCode: (employeeCode, instituteCode) => `attendance:byCode:${employeeCode}:${instituteCode}`,
  single: (id, instituteCode) => `attendance:single:${id}:${instituteCode}`,
  all: () => "attendance:*",
};

// ─── Validações reutilizáveis ─────────────────────────────────────────────────
const ValidateEmployeeAttendanceFields = (body) => {
  const errors = [];

  if (!body.employee_attendance_code || String(body.employee_attendance_code).trim() === "")
    errors.push("Código do funcionário é obrigatório.");

  if (!body.employee_attendance_date || body.employee_attendance_date.trim() === "")
    errors.push("Data da presença é obrigatória.");

  if (!body.employee_attendance_status || body.employee_attendance_status.trim() === "")
    errors.push("Status da presença é obrigatório.");

  if (body.employee_attendance_timing === null || body.employee_attendance_timing === undefined || body.employee_attendance_timing === "")
    errors.push("Timing/horário é obrigatório.");

  return errors;
};

// ─── Fetch base (sem cache) ────────────────────────────────────────────────────
const FetchEmployeeAttendances = async (req, res, instituteCode) => {
  const query = `
    SELECT
      ea.*,
      s.ed_subject_id,
      s.ed_subject_title,
      c.ed_class_id,
      c.ed_class_title,
      t.ed_timing_id,
      t.ed_timing_title,
      emp.ed_employee_id,
      emp.ed_employee_name
    FROM eduall_employee_attendence ea
    LEFT JOIN eduall_subjects s
      ON ea.ed_employee_attd_subject = s.ed_subject_id AND s.ed_subject_deleted = 0
    LEFT JOIN eduall_class c
      ON ea.ed_employee_attd_class = c.ed_class_id AND c.ed_class_deleted = 0
    LEFT JOIN eduall_timing t
      ON t.ed_timing_id = ea.ed_employee_attd_timing AND t.ed_timing_deleted = 0
    LEFT JOIN eduall_employees emp
      ON ea.ed_employee_attd_code = emp.ed_employee_id AND emp.ed_employee_deleted = 0
    WHERE ea.ed_employee_attd_deleted = 0
      AND ea.ed_employee_attd_institute_code = ?
    ORDER BY ea.ed_employee_attd_date DESC
  `;
  return ExecuteQuery(res, query, [instituteCode], true, {
    db: "eduall_employee_attendence",
    type: "select",
    data: req,
  });
};

const FetchEmployeeAttendanceByCode = async (req, res, employeeCode, instituteCode) => {
  const query = `
    SELECT
      ea.*,
      s.ed_subject_id,
      s.ed_subject_title,
      c.ed_class_id,
      c.ed_class_title,
      t.ed_timing_id,
      t.ed_timing_title,
      emp.ed_employee_id,
      emp.ed_employee_name
    FROM eduall_employee_attendence ea
    LEFT JOIN eduall_subjects s
      ON ea.ed_employee_attd_subject = s.ed_subject_id AND s.ed_subject_deleted = 0
    LEFT JOIN eduall_class c
      ON ea.ed_employee_attd_class = c.ed_class_id AND c.ed_class_deleted = 0
    LEFT JOIN eduall_timing t
      ON t.ed_timing_id = ea.ed_employee_attd_timing AND t.ed_timing_deleted = 0
    LEFT JOIN eduall_employees emp
      ON ea.ed_employee_attd_code = emp.ed_employee_id AND emp.ed_employee_deleted = 0
    WHERE ea.ed_employee_attd_deleted = 0
      AND ea.ed_employee_attd_code = ?
      AND ea.ed_employee_attd_institute_code = ?
    ORDER BY ea.ed_employee_attd_date DESC
  `;
  return ExecuteQuery(res, query, [employeeCode, instituteCode], true, {
    db: "eduall_employee_attendence",
    type: "select",
    data: req,
  });
};

// ─── Refrescar cache (limpa tudo e repõe a lista) ─────────────────────────────
const RefreshAttendanceCache = async (req, res, instituteCode) => {
  const startTime = Date.now();

  await Cache.eduallClear(CacheKeys.all());
  console.log(`📦🧹 CACHE -> limpa para institute ${instituteCode}`);

  const rows = await FetchEmployeeAttendances(req, res, instituteCode);
  await Cache.eduallSet(CacheKeys.list(instituteCode), rows, ATTENDANCE_CACHE_TTL);

  const duration = Date.now() - startTime;
  console.log(
    `🗄️🐢 BASE DE DADOS (lento) -> cache reposta em ${duration}ms para institute ${instituteCode}`
  );

  return rows;
};

/* ===================== GET OPERATIONS (COM CACHE) ===================== */

/**
 * GET ALL — Listar todas as presenças de funcionários com dados de funcionário, disciplina, turma e timing
 */
const GetEmployeesAttendance = async (req, res) => {
  try {
    const instituteCode = req.session.user.eduall_user_session_curentinstitute;
    const cacheKey = CacheKeys.list(instituteCode);
    const startTime = Date.now();

    const cached = await Cache.eduallGet(cacheKey);
    if (cached !== null) {
      const duration = Date.now() - startTime;
      console.log(
        `📦⚡ CACHE (rápido) -> GetEmployeesAttendance demorou ${duration}ms (${cacheKey})`
      );
      return res.status(200).json(cached);
    }

    const rows = await FetchEmployeeAttendances(req, res, instituteCode);
    await Cache.eduallSet(cacheKey, rows, ATTENDANCE_CACHE_TTL);

    const duration = Date.now() - startTime;
    console.log(
      `🗄️🐢 BASE DE DADOS (lento) -> GetEmployeesAttendance demorou ${duration}ms (${cacheKey})`
    );

    res.status(200).json(rows);
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Falha ao buscar presenças de funcionários!",
      error: error.message,
    });
  }
};

/**
 * GET BY CODE — Listar presenças por código de funcionário
 */
const GetEmployeeAttendanceBycode = async (req, res) => {
  try {
    const { CODE } = req.params;
    const instituteCode = req.session.user.eduall_user_session_curentinstitute;
    const cacheKey = CacheKeys.byCode(CODE, instituteCode);
    const startTime = Date.now();

    const cached = await Cache.eduallGet(cacheKey);
    if (cached !== null) {
      const duration = Date.now() - startTime;
      console.log(
        `📦⚡ CACHE (rápido) -> GetEmployeeAttendanceBycode demorou ${duration}ms (${cacheKey})`
      );
      return res.status(200).json(cached);
    }

    const rows = await FetchEmployeeAttendanceByCode(req, res, CODE, instituteCode);
    await Cache.eduallSet(cacheKey, rows, ATTENDANCE_CACHE_TTL);

    const duration = Date.now() - startTime;
    console.log(
      `🗄️🐢 BASE DE DADOS (lento) -> GetEmployeeAttendanceBycode demorou ${duration}ms (${cacheKey})`
    );

    res.status(200).json(rows);
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Falha ao buscar presenças por código de funcionário!",
      error: error.message,
    });
  }
};

/**
 * GET SINGLE — Obter registo individual de presença
 */
const GetSingleEmployeeAttendance = async (req, res) => {
  try {
    const { ID } = req.params;
    const instituteCode = req.session.user.eduall_user_session_curentinstitute;
    const cacheKey = CacheKeys.single(ID, instituteCode);
    const startTime = Date.now();

    const cached = await Cache.eduallGet(cacheKey);
    if (cached !== null) {
      const duration = Date.now() - startTime;
      console.log(
        `📦⚡ CACHE (rápido) -> GetSingleEmployeeAttendance demorou ${duration}ms (${cacheKey})`
      );
      return res.status(200).json(cached);
    }

    const query = `
      SELECT * FROM eduall_employee_attendence
      WHERE ed_employee_attd_deleted = 0
        AND ed_employee_attd_id = ?
        AND ed_employee_attd_institute_code = ?
    `;
    const PARAMS = [ID, instituteCode];
    const rows = await ExecuteQuery(res, query, PARAMS, true, {
      db: "eduall_employee_attendence",
      type: "select",
      data: req,
    });

    if (!rows || rows.length === 0)
      return res
        .status(404)
        .json({ success: false, message: "Registo de presença não encontrado." });

    const result = rows[0];
    await Cache.eduallSet(cacheKey, result, ATTENDANCE_CACHE_TTL);

    const duration = Date.now() - startTime;
    console.log(
      `🗄️🐢 BASE DE DADOS (lento) -> GetSingleEmployeeAttendance demorou ${duration}ms (${cacheKey})`
    );

    res.status(200).json(result);
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Falha ao buscar registo de presença!",
      error: error.message,
    });
  }
};

/* ===================== POST OPERATIONS (COM VALIDAÇÃO E CACHE REFRESH) ===================== */

/**
 * POST — Registar presença de funcionário
 */
const RegisterEmployeeAttendance = async (req, res) => {
  try {
    const {
      employee_attendance_code,
      employee_attendance_date,
      employee_attendance_timing,
      employee_attendance_status,
      employee_attendance_subject,
      employee_attendance_class,
    } = req.body;
    const instituteCode = req.session.user.eduall_user_session_curentinstitute;

    // Validações
    const errors = ValidateEmployeeAttendanceFields(req.body);
    if (errors.length > 0)
      return res.status(422).json({ success: false, msg: errors.join(" "), errors });

    // Verificar se o funcionário existe
    const checkEmployeeQuery = `
      SELECT ed_employee_id FROM eduall_employees
      WHERE ed_employee_deleted = 0
        AND ed_employee_id = ?
        AND ed_employee_institute_code = ?
    `;
    const employeeCheck = await ExecuteQuery(
      res,
      checkEmployeeQuery,
      [employee_attendance_code, instituteCode],
      true,
      { db: "eduall_employees", type: "select", data: req }
    );

    if (!employeeCheck || employeeCheck.length === 0)
      return res
        .status(404)
        .json({
          success: false,
          msg: "Funcionário não encontrado ou não pertence à instituição.",
        });

    const query = `
      INSERT INTO eduall_employee_attendence (
        ed_employee_attd_code,
        ed_employee_attd_date,
        ed_employee_attd_timing,
        ed_employee_attd_status,
        ed_employee_attd_subject,
        ed_employee_attd_class,
        ed_employee_attd_institute_code
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `;
    const PARAMS = [
      employee_attendance_code,
      employee_attendance_date,
      employee_attendance_timing,
      employee_attendance_status.trim(),
      employee_attendance_subject || null,
      employee_attendance_class || null,
      instituteCode,
    ];

    const rows = await ExecuteQuery(res, query, PARAMS, false, {
      db: "eduall_employee_attendence",
      type: "insert",
      data: req,
    });

    await RegisterAuditAction({
      session: req.session,
      action: 1,
      form: "Presença dos Funcionários",
      description: `Registrou presença para funcionário #${employee_attendance_code} na data ${employee_attendance_date}`,
    });

    console.log(
      `🗄️🐢 BASE DE DADOS (lento) -> RegisterEmployeeAttendance: presença registada para funcionário ${employee_attendance_code}`
    );
    await RefreshAttendanceCache(req, res, instituteCode);

    res
      .status(201)
      .json({
        success: true,
        message: "Presença registada com sucesso!",
        data: rows,
      });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Falha ao registar presença de funcionário!",
      error: error.message,
    });
  }
};

/* ===================== PUT OPERATIONS (COM VALIDAÇÃO E CACHE REFRESH) ===================== */

/**
 * PUT — Atualizar registo de presença
 */
const EmployeeAttendanceUpdate = async (req, res) => {
  try {
    const { ID } = req.params;
    const {
      employee_attendance_code,
      employee_attendance_date,
      employee_attendance_timing,
      employee_attendance_status,
      employee_attendance_subject,
      employee_attendance_class,
    } = req.body;
    const instituteCode = req.session.user.eduall_user_session_curentinstitute;

    // Validações
    const errors = ValidateEmployeeAttendanceFields(req.body);
    if (errors.length > 0)
      return res.status(422).json({ success: false, msg: errors.join(" "), errors });

    // Confirmar que o registo existe
    const checkExistQuery = `
      SELECT ed_employee_attd_id FROM eduall_employee_attendence
      WHERE ed_employee_attd_deleted = 0
        AND ed_employee_attd_id = ?
        AND ed_employee_attd_institute_code = ?
    `;
    const found = await ExecuteQuery(res, checkExistQuery, [ID, instituteCode], true, {
      db: "eduall_employee_attendence",
      type: "select",
      data: req,
    });

    if (!found || found.length === 0)
      return res
        .status(404)
        .json({
          success: false,
          msg: "Registo de presença não encontrado ou já foi removido.",
        });

    const query = `
      UPDATE eduall_employee_attendence
      SET ed_employee_attd_code = ?,
          ed_employee_attd_date = ?,
          ed_employee_attd_timing = ?,
          ed_employee_attd_status = ?,
          ed_employee_attd_subject = ?,
          ed_employee_attd_class = ?
      WHERE ed_employee_attd_deleted = 0
        AND ed_employee_attd_id = ?
        AND ed_employee_attd_institute_code = ?
    `;
    const PARAMS = [
      employee_attendance_code,
      employee_attendance_date,
      employee_attendance_timing,
      employee_attendance_status.trim(),
      employee_attendance_subject || null,
      employee_attendance_class || null,
      ID,
      instituteCode,
    ];

    const rows = await ExecuteQuery(res, query, PARAMS, false, {
      db: "eduall_employee_attendence",
      type: "update",
      data: req,
    });

    await RegisterAuditAction({
      session: req.session,
      action: 2,
      form: "Presença dos Funcionários",
      description: `Atualizou presença de funcionário #${employee_attendance_code} para data ${employee_attendance_date} (ID ${ID})`,
    });

    console.log(
      `🗄️🐢 BASE DE DADOS (lento) -> EmployeeAttendanceUpdate: presença ${ID} atualizada`
    );
    await RefreshAttendanceCache(req, res, instituteCode);

    res
      .status(200)
      .json({
        success: true,
        message: "Presença atualizada com sucesso!",
        data: rows,
      });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Falha ao atualizar presença de funcionário!",
      error: error.message,
    });
  }
};

/* ===================== DELETE OPERATIONS (COM CACHE REFRESH) ===================== */

/**
 * DELETE (soft-delete) — Eliminar registo de presença
 */
const EmployeeAttendanceDelete = async (req, res) => {
  try {
    const { ID } = req.params;
    const instituteCode = req.session.user.eduall_user_session_curentinstitute;

    // Confirmar existência antes de apagar
    const checkQuery = `
      SELECT ed_employee_attd_id FROM eduall_employee_attendence
      WHERE ed_employee_attd_deleted = 0
        AND ed_employee_attd_id = ?
        AND ed_employee_attd_institute_code = ?
    `;
    const found = await ExecuteQuery(res, checkQuery, [ID, instituteCode], true, {
      db: "eduall_employee_attendence",
      type: "select",
      data: req,
    });

    if (!found || found.length === 0)
      return res
        .status(404)
        .json({
          success: false,
          msg: "Registo de presença não encontrado ou já foi removido.",
        });

    const query = `
      UPDATE eduall_employee_attendence
      SET ed_employee_attd_deleted = 1
      WHERE ed_employee_attd_deleted = 0
        AND ed_employee_attd_id = ?
        AND ed_employee_attd_institute_code = ?
    `;
    const PARAMS = [ID, instituteCode];

    const rows = await ExecuteQuery(res, query, PARAMS, false, {
      db: "eduall_employee_attendence",
      type: "update",
      data: req,
    });

    await RegisterAuditAction({
      session: req.session,
      action: 3,
      form: "Presença dos Funcionários",
      description: `Eliminou registo de presença (ID ${ID})`,
    });

    console.log(
      `🗄️🐢 BASE DE DADOS (lento) -> EmployeeAttendanceDelete: presença ${ID} eliminada`
    );
    await RefreshAttendanceCache(req, res, instituteCode);

    res.status(200).json({
      success: true,
      message: "Presença eliminada com sucesso!",
      data: rows,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Falha ao eliminar presença de funcionário!",
      error: error.message,
    });
  }
};

module.exports = {
  RegisterEmployeeAttendance,
  GetEmployeesAttendance,
  GetEmployeeAttendanceBycode,
  EmployeeAttendanceUpdate,
  EmployeeAttendanceDelete,
  GetSingleEmployeeAttendance,
};