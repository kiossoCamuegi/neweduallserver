// CACHE-OPT v1 (aplicado por apply_cache_optimizations.py)
const ExecuteQuery = require("../Functions/ExecuteQuery");
const Cache = require("../Functions/CacheRoutes");
const CacheKeys = require("../Functions/CacheKeys");
const { RegisterAuditAction } = require("./Auditory");

const ATTENDANCE_CACHE_TTL = 300; // presenças lançadas com frequência

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

// ─── Fragmento SQL reutilizável do timing (não existe ed_timing_title na BD) ──
// Constrói "HH:MM - HH:MM" a partir das colunas reais de eduall_timing
const TIMING_TITLE_SQL = `
  CONCAT(
    LPAD(t.ed_timing_hour_start, 2, '0'), ':', LPAD(t.ed_timing_minute_start, 2, '0'),
    ' - ',
    LPAD(t.ed_timing_hour_end, 2, '0'), ':', LPAD(t.ed_timing_minute_end, 2, '0')
  )
`;

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
      ${TIMING_TITLE_SQL} AS ed_timing_title,
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
      ${TIMING_TITLE_SQL} AS ed_timing_title,
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

/* ===================== GET OPERATIONS (COM CACHE) ===================== */

const GetEmployeesAttendance = async (req, res) => {
  try {
    const instituteCode = req.session.user.eduall_user_session_curentinstitute;

    const rows = await Cache.eduallWithCache(
      CacheKeys.employeeAttendance.list(instituteCode),
      ATTENDANCE_CACHE_TTL,
      () => FetchEmployeeAttendances(req, res, instituteCode)
    );

    res.status(200).json(rows);
  } catch (error) {
    console.log(error)
    res.status(500).json({
      success: false,
      message: "Falha ao buscar presenças de funcionários!",
      error: error.message,
    });
  }
};

const GetEmployeeAttendanceBycode = async (req, res) => {
  try {
    const { CODE } = req.params;
    const instituteCode = req.session.user.eduall_user_session_curentinstitute;

    const rows = await FetchEmployeeAttendanceByCode(req, res, CODE, instituteCode);

    res.status(200).json(rows);
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Falha ao buscar presenças por código de funcionário!",
      error: error.message,
    });
  }
};

const GetSingleEmployeeAttendance = async (req, res) => {
  try {
    const { ID } = req.params;
    if (CacheKeys.parseId(ID) === null) {
      return res.status(400).json({ success: false, message: "ID inválido." });
    }
    const instituteCode = req.session.user.eduall_user_session_curentinstitute;

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
        .json({ success: false, message: "Registo de presença não encontrado."});

    const result = rows[0];

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

    const errors = ValidateEmployeeAttendanceFields(req.body);
    if (errors.length > 0)
      return res.status(422).json({ success: false, msg: errors.join(" "), errors });

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
    await CacheKeys.safeInvalidate(() => [CacheKeys.employeeAttendance.list(instituteCode)]);

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

    const errors = ValidateEmployeeAttendanceFields(req.body);
    if (errors.length > 0)
      return res.status(422).json({ success: false, msg: errors.join(" "), errors });

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
    await CacheKeys.safeInvalidate(() => [CacheKeys.employeeAttendance.list(instituteCode)]);

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

const EmployeeAttendanceDelete = async (req, res) => {
  try {
    const { ID } = req.params;
    const instituteCode = req.session.user.eduall_user_session_curentinstitute;

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
    await CacheKeys.safeInvalidate(() => [CacheKeys.employeeAttendance.list(instituteCode)]);

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

/* ===================================================================================
   ===================== RELATÓRIO DE EFETIVIDADE (RN01 a RN10) ======================
   ===================================================================================

   ⚠️ ASSUNÇÕES DE SCHEMA — confirmar/ajustar antes de subir para produção:
   1) Departamento (RN03 + §4):
        tabela  -> eduall_department (ed_department_id, ed_department_title, ed_department_deleted)
        coluna  -> eduall_employees.ed_employee_department  (FK para eduall_department)
        Tabela GLOBAL — partilhada entre todas as instituições, sem ed_department_institute_code.
      Se os nomes reais forem diferentes, ajustar em DEPARTMENT_JOIN_SQL abaixo.

   2) Número/matrícula do funcionário (RN03):
        Não foi identificado um campo de matrícula distinto do ID.
        Por omissão está a usar-se ed_employee_id como "número de funcionário".
        Se existir um campo próprio (ex: ed_employee_code), substituir em
        FUNCIONARIO_SELECT_SQL abaixo.

   3) Feriados / calendário (RN04):
        lê de eduall_calendar_holiday (ed_holiday_date, ed_holiday_deleted).
        Tabela GLOBAL — partilhada entre TODAS as escolas/instituições,
        sem ed_holiday_institute_code. Por isso a query NÃO filtra por
        instituteCode. Se a tabela não existir/falhar, cai em fallback
        silencioso (considera apenas seg-sex como dias úteis) — não derruba
        o relatório.
==================================================================================== */

const DEPARTMENT_JOIN_SQL = `
  LEFT JOIN eduall_department dep
    ON dep.ed_department_id = emp.ed_employee_department
    AND dep.ed_department_deleted = 0
`;

const FUNCIONARIO_SELECT_SQL = `
  emp.ed_employee_id,
  emp.ed_employee_id AS employee_number,
  emp.ed_employee_name,
  emp.ed_employee_charge,
  COALESCE(jt.ed_job_title, 'Não atribuído') AS job_title,
  COALESCE(dep.ed_department_title, 'Não atribuído') AS department
`;

// Ajusta estas variantes aos valores REAIS de ed_employee_attd_status usados no frontend
const STATUS_CATEGORY = {
  presente: ["presente", "presença", "present"],
  falta_justificada: ["falta_justificada", "falta justificada", "justificada"],
  falta_injustificada: ["falta_injustificada", "falta injustificada", "injustificada", "falta"],
};

const NormalizeAttendanceStatus = (rawStatus) => {
  if (!rawStatus) return "outro";
  const normalized = rawStatus.toString().trim().toLowerCase();
  for (const [category, variants] of Object.entries(STATUS_CATEGORY)) {
    if (variants.includes(normalized)) return category;
  }
  return "outro";
};

// ─── RN04: dias úteis considerando o calendário de feriados ──────────────────
// Tenta excluir feriados configurados; se a tabela não existir/falhar, faz
// fallback silencioso para seg-sex apenas (não derruba o relatório).
//
// eduall_calendar_holiday é uma tabela GLOBAL (partilhada por todas as
// escolas/instituições) — por isso NÃO se filtra por institute_code.
const CountBusinessDays = async (req, res, instituteCode, startDate, endDate) => {
  let holidaySet = new Set();

  try {
    const holidayQuery = `
      SELECT ed_holiday_date
      FROM eduall_calendar_holiday
      WHERE ed_holiday_deleted = 0
        AND ed_holiday_date BETWEEN ? AND ?
    `;
    const holidayRows = await ExecuteQuery(
      res,
      holidayQuery,
      [startDate, endDate],
      true,
      { db: "eduall_calendar_holiday", type: "select", data: req, silent: true }
    );
    if (holidayRows) {
      holidaySet = new Set(
        holidayRows.map((h) => new Date(h.ed_holiday_date).toISOString().slice(0, 10))
      );
    }
  } catch (e) { 
    console.log(
      "⚠️ Calendário de feriados global não encontrado — a considerar apenas seg-sex como dias úteis."
    );
  }

  let count = 0;
  const current = new Date(startDate);
  const end = new Date(endDate);
  while (current <= end) {
    const day = current.getDay();
    const iso = current.toISOString().slice(0, 10);
    const isWeekend = day === 0 || day === 6;
    const isHoliday = holidaySet.has(iso);
    if (!isWeekend && !isHoliday) count++;
    current.setDate(current.getDate() + 1);
  }
  return count;
};

// ─── Monta o relatório agregado (usado pela view em tela e pelo export) ──────
const BuildEffectivenessReport = async (req, res, instituteCode, filters) => {
  const {
    start_date,
    end_date,
    employee_code,
    job_title_id,
    department_id,
    show_all_employees, // "true" | "false" (string vinda da query) — RN02
  } = filters;

  let employeeFilterSql = "";
  const employeeFilterParams = [];
  if (employee_code) {
    employeeFilterSql += " AND emp.ed_employee_id = ?";
    employeeFilterParams.push(employee_code);
  }
  if (job_title_id) {
    employeeFilterSql += " AND emp.ed_employee_charge = ?";
    employeeFilterParams.push(job_title_id);
  }
  if (department_id) {
    employeeFilterSql += " AND emp.ed_employee_department = ?";
    employeeFilterParams.push(department_id);
  }

  const query = `
    SELECT
      ${FUNCIONARIO_SELECT_SQL},
      ea.ed_employee_attd_status,
      ea.ed_employee_attd_date
    FROM eduall_employees emp
    LEFT JOIN eduall_job_titles jt
      ON jt.ed_job_title_id = emp.ed_employee_charge
    ${DEPARTMENT_JOIN_SQL}
    LEFT JOIN eduall_employee_attendence ea
      ON ea.ed_employee_attd_code = emp.ed_employee_id
      AND ea.ed_employee_attd_deleted = 0
      AND ea.ed_employee_attd_date BETWEEN ? AND ?
    WHERE emp.ed_employee_deleted = 0
      AND emp.ed_employee_institute_code = ?
      ${employeeFilterSql}
    ORDER BY emp.ed_employee_name ASC
  `;

  const PARAMS = [start_date, end_date, instituteCode, ...employeeFilterParams];

  const rows = await ExecuteQuery(res, query, PARAMS, true, {
    db: "eduall_employees",
    type: "select",
    data: req,
  });

  // RN05: evita duplicações quando existir mais de um registo no mesmo dia
  // (ex: mais de uma disciplina/horário no mesmo dia). Mantém-se apenas UM
  // status por (funcionário, data) — o primeiro encontrado.
  const employeesMap = new Map();
  const seenEmployeeDate = new Map(); // employee_id -> Set(datas já contabilizadas)

  for (const row of rows) {
    if (!employeesMap.has(row.ed_employee_id)) {
      employeesMap.set(row.ed_employee_id, {
        employee_id: row.ed_employee_id,
        employee_number: row.employee_number,
        employee_name: row.ed_employee_name,
        job_title: row.job_title,
        department: row.department,
        presencas: 0,
        faltas_justificadas: 0,
        faltas_injustificadas: 0,
        outros_registos: 0,
        observacoes: null, // §6 — sem fonte de dados ainda; ver nota no topo do ficheiro
      });
      seenEmployeeDate.set(row.ed_employee_id, new Set());
    }

    const entry = employeesMap.get(row.ed_employee_id);
    const datesSeen = seenEmployeeDate.get(row.ed_employee_id);

    if (row.ed_employee_attd_date) {
      const dateKey = new Date(row.ed_employee_attd_date).toISOString().slice(0, 10);

      // RN05: já contabilizado este dia para este funcionário -> ignora duplicado
      if (datesSeen.has(dateKey)) continue;
      datesSeen.add(dateKey);

      const category = NormalizeAttendanceStatus(row.ed_employee_attd_status);
      if (category === "presente") entry.presencas++;
      else if (category === "falta_justificada") entry.faltas_justificadas++;
      else if (category === "falta_injustificada") entry.faltas_injustificadas++;
      else entry.outros_registos++;
    }
  }

  const diasUteis = await CountBusinessDays(req, res, instituteCode, start_date, end_date);

  // RN02: por omissão, só mostra funcionários com registos no período.
  // Quando show_all_employees === "true", mostra todos (mesmo sem registos).
  const includeAll = String(show_all_employees).toLowerCase() === "true";

  let entries = Array.from(employeesMap.values());
  if (!includeAll) {
    entries = entries.filter(
      (e) =>
        e.presencas > 0 ||
        e.faltas_justificadas > 0 ||
        e.faltas_injustificadas > 0 ||
        e.outros_registos > 0
    );
  }

  const data = entries.map((emp) => {
    const totalFaltas = emp.faltas_justificadas + emp.faltas_injustificadas;

    // RN08 / RN09: se dias úteis = 0, evita divisão por zero -> N/A (null)
    const percentualAssiduidade =
      diasUteis > 0 ? Number(((emp.presencas / diasUteis) * 100).toFixed(2)) : null;
    const percentualFaltas =
      diasUteis > 0 ? Number(((totalFaltas / diasUteis) * 100).toFixed(2)) : null;

    return {
      ...emp,
      total_dias_uteis: diasUteis,
      total_faltas: totalFaltas,
      percentual_assiduidade: percentualAssiduidade,
      percentual_faltas: percentualFaltas,
    };
  });

  return {
    periodo: { inicio: start_date, fim: end_date },
    total_dias_uteis: diasUteis,
    filtros_aplicados: {
      employee_code: employee_code || null,
      job_title_id: job_title_id || null,
      department_id: department_id || null,
      show_all_employees: includeAll,
    },
    data,
  };
};

// ─── §9: validação dos parâmetros de entrada do relatório ──────────
const ValidateReportFilters = (query) => {
  const errors = [];
  const { start_date, end_date } = query;

  if (!start_date || !end_date) {
    errors.push("Período (data inicial e final) é obrigatório.");
    return errors; // sem datas não há como validar o resto
  }

  const start = new Date(start_date);
  const end = new Date(end_date);

  if (isNaN(start.getTime()) || isNaN(end.getTime())) {
    errors.push("Datas inválidas.");
    return errors;
  }

  if (start > end) {
    errors.push("A data inicial não pode ser posterior à data final.");
  }

  return errors;
};

/**
 * GET — Relatório de Efetividade dos Funcionários
 * Query params: start_date, end_date (obrigatórios),
 *   employee_code, job_title_id, department_id, show_all_employees (opcionais)
 */
const GetEmployeeEffectivenessReport = async (req, res) => {
  try {
    const instituteCode = req.session.user.eduall_user_session_curentinstitute;
    const { start_date, end_date, employee_code, job_title_id, department_id, show_all_employees } =
      req.query;

    const errors = ValidateReportFilters(req.query);
    if (errors.length > 0)
      return res.status(422).json({ success: false, msg: errors.join(" "), errors });

    const report = await BuildEffectivenessReport(req, res, instituteCode, {
      start_date,
      end_date,
      employee_code,
      job_title_id,
      department_id,
      show_all_employees,
    });

    // §9: sem dados no período -> mensagem informativa, não relatório vazio "mudo"
    if (!report.data || report.data.length === 0) {
      return res.status(200).json({
        success: true,
        empty: true,
        msg: "Não existem dados de assiduidade para o período/filtros selecionados.",
        ...report,
      });
    }

    res.status(200).json({ success: true, empty: false, ...report });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Falha ao gerar relatório de efetividade!",
      error: error.message,
    });
  }
};

/**
 * GET — Dados do Relatório de Efetividade para exportação no frontend
 * Mesmos query params do GetEmployeeEffectivenessReport.
 * Apenas devolve os dados em JSON; a geração do Excel é feita no frontend
 * através da função ExportDataForTablesExcel (§7.4).
 */
const ExportEmployeeEffectivenessExcel = async (req, res) => {
  try {
    const instituteCode = req.session.user.eduall_user_session_curentinstitute;
    const { start_date, end_date, employee_code, job_title_id, department_id, show_all_employees } =
      req.query;

    const errors = ValidateReportFilters(req.query);
    if (errors.length > 0)
      return res.status(422).json({ success: false, msg: errors.join(" "), errors });

    const report = await BuildEffectivenessReport(req, res, instituteCode, {
      start_date,
      end_date,
      employee_code,
      job_title_id,
      department_id,
      show_all_employees,
    });

    res.status(200).json({ success: true, ...report });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Falha ao obter dados do relatório de efetividade!",
      error: error.message,
    });
  }
};

/* ===================================================================================
   ===================== DEPARTAMENTOS (eduall_department) ===========================
   ===================================================================================
   Tabela GLOBAL — partilhada entre todas as instituições/escolas, sem institute_code.
   CRUD simples para alimentar o filtro de Departamento do relatório de efetividade
   e o campo de departamento no cadastro de funcionários.
==================================================================================== */

const ValidateDepartmentFields = (body) => {
  const errors = [];
  if (!body.department_title || String(body.department_title).trim() === "")
    errors.push("Nome do departamento é obrigatório.");
  return errors;
};

// GET — lista todos os departamentos ativos (global, sem filtro de instituição)
const GetDepartments = async (req, res) => {
  try {
    const query = `
      SELECT ed_department_id, ed_department_title, ed_department_description
      FROM eduall_department
      WHERE ed_department_deleted = 0
      ORDER BY ed_department_title ASC
    `;
    const rows = await ExecuteQuery(res, query, [], true, {
      db: "eduall_department",
      type: "select",
      data: req,
    });
    res.status(200).json(rows);
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Falha ao buscar departamentos!",
      error: error.message,
    });
  }
};

// GET — departamento único
const GetSingleDepartment = async (req, res) => {
  try {
    const { ID } = req.params;
    const query = `
      SELECT ed_department_id, ed_department_title, ed_department_description
      FROM eduall_department
      WHERE ed_department_deleted = 0
        AND ed_department_id = ?
    `;
    const rows = await ExecuteQuery(res, query, [ID], true, {
      db: "eduall_department",
      type: "select",
      data: req,
    });

    if (!rows || rows.length === 0)
      return res.status(404).json({ success: false, message: "Departamento não encontrado." });

    res.status(200).json(rows[0]);
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Falha ao buscar departamento!",
      error: error.message,
    });
  }
};

// POST — criar departamento
const RegisterDepartment = async (req, res) => {
  try {
    const { department_title, department_description } = req.body;

    const errors = ValidateDepartmentFields(req.body);
    if (errors.length > 0)
      return res.status(422).json({ success: false, msg: errors.join(" "), errors });

    const query = `
      INSERT INTO eduall_department (ed_department_title, ed_department_description)
      VALUES (?, ?)
    `;
    const PARAMS = [department_title.trim(), department_description || null];

    const rows = await ExecuteQuery(res, query, PARAMS, false, {
      db: "eduall_department",
      type: "insert",
      data: req,
    });

    await RegisterAuditAction({
      session: req.session,
      action: 1,
      form: "Departamentos",
      description: `Criou o departamento "${department_title}"`,
    });

    res.status(201).json({
      success: true,
      message: "Departamento criado com sucesso!",
      data: rows,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Falha ao criar departamento!",
      error: error.message,
    });
  }
};

// PUT — atualizar departamento
const DepartmentUpdate = async (req, res) => {
  try {
    const { ID } = req.params;
    const { department_title, department_description } = req.body;

    const errors = ValidateDepartmentFields(req.body);
    if (errors.length > 0)
      return res.status(422).json({ success: false, msg: errors.join(" "), errors });

    const checkQuery = `
      SELECT ed_department_id FROM eduall_department
      WHERE ed_department_deleted = 0
        AND ed_department_id = ?
    `;
    const found = await ExecuteQuery(res, checkQuery, [ID], true, {
      db: "eduall_department",
      type: "select",
      data: req,
    });

    if (!found || found.length === 0)
      return res.status(404).json({ success: false, msg: "Departamento não encontrado ou já foi removido." });

    const query = `
      UPDATE eduall_department
      SET ed_department_title = ?,
          ed_department_description = ?
      WHERE ed_department_deleted = 0
        AND ed_department_id = ?
    `;
    const PARAMS = [department_title.trim(), department_description || null, ID];

    const rows = await ExecuteQuery(res, query, PARAMS, false, {
      db: "eduall_department",
      type: "update",
      data: req,
    });

    await RegisterAuditAction({
      session: req.session,
      action: 2,
      form: "Departamentos",
      description: `Atualizou o departamento #${ID} para "${department_title}"`,
    });

    res.status(200).json({
      success: true,
      message: "Departamento atualizado com sucesso!",
      data: rows,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Falha ao atualizar departamento!",
      error: error.message,
    });
  }
};

// DELETE — soft delete do departamento
const DepartmentDelete = async (req, res) => {
  try {
    const { ID } = req.params;

    const checkQuery = `
      SELECT ed_department_id FROM eduall_department
      WHERE ed_department_deleted = 0
        AND ed_department_id = ?
    `;
    const found = await ExecuteQuery(res, checkQuery, [ID], true, {
      db: "eduall_department",
      type: "select",
      data: req,
    });

    if (!found || found.length === 0)
      return res.status(404).json({ success: false, msg: "Departamento não encontrado ou já foi removido." });

    const query = `
      UPDATE eduall_department
      SET ed_department_deleted = 1
      WHERE ed_department_deleted = 0
        AND ed_department_id = ?
    `;
    const rows = await ExecuteQuery(res, query, [ID], false, {
      db: "eduall_department",
      type: "update",
      data: req,
    });

    await RegisterAuditAction({
      session: req.session,
      action: 3,
      form: "Departamentos",
      description: `Eliminou o departamento #${ID}`,
    });

    res.status(200).json({
      success: true,
      message: "Departamento eliminado com sucesso!",
      data: rows,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Falha ao eliminar departamento!",
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
  GetEmployeeEffectivenessReport,
  ExportEmployeeEffectivenessExcel,
  GetDepartments,
  GetSingleDepartment,
  RegisterDepartment,
  DepartmentUpdate,
  DepartmentDelete,
};