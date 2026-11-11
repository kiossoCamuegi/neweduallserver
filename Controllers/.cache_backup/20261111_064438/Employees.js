const multer = require("multer");
const path = require("path");
const ExecuteQuery = require("../Functions/ExecuteQuery");
const Cache = require("../Functions/CacheRoutes");
const { RegisterAuditAction } = require("./Auditory");

const EMPLOYEE_CACHE_TTL = 3600;

const CacheKeys = {
  list: (instituteCode) => `employee:list:${instituteCode}`,
  single: (id, instituteCode) => `employee:single:${id}:${instituteCode}`,
  byJobTitle: (jobTitleId) => `employee:byJobTitle:${jobTitleId}`,
  byUser: (userId, instituteCode) => `employee:byUser:${userId}:${instituteCode}`,
  all: () => "employee:*",
};

// ─── Validações reutilizáveis ─────────────────────────────────────────────────
const ValidateEmployeeFields = (body) => {
  const errors = [];

  if (!body.employee_name || body.employee_name.trim() === "")
    errors.push("Nome do funcionário é obrigatório.");

  if (body.employee_name && body.employee_name.trim().length < 3)
    errors.push("Nome do funcionário deve ter pelo menos 3 caracteres.");

  // employee_code é opcional: se não vier, é gerado automaticamente no backend

  if (!body.employee_email || body.employee_email.trim() === "")
    errors.push("Email do funcionário é obrigatório.");

  if (body.employee_email) {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
    if (!emailRegex.test(body.employee_email.trim()))
      errors.push("Email inválido.");
  }

  if (!body.employee_charge || body.employee_charge.trim() === "")
    errors.push("Cargo/função é obrigatória.");

  return errors;
};

// ─── Gerar código único de funcionário ────────────────────────────────────────
const GenerateUniqueEmployeeCode = async (req, res, instituteCode) => {
  let code;
  let exists = true;

  while (exists) {
    code = `FUNC${Date.now().toString().slice(-6)}${Math.floor(Math.random() * 900 + 100)}`;

    const checkQuery = `
      SELECT ed_employee_id FROM eduall_employees
      WHERE ed_employee_code = ?
        AND ed_employee_institute_code = ?
    `;
    const found = await ExecuteQuery(res, checkQuery, [code, instituteCode], true, {
      db: "eduall_employees",
      type: "select",
      data: req,
    });

    exists = found && found.length > 0;
  }

  return code;
};

// ─── Fetch base (sem cache) ────────────────────────────────────────────────────
const FetchEmployees = async (res, req, instituteCode) => {
  const query = `
    SELECT
      e.*,
      (
        SELECT u.ed_user_account_email
        FROM eduall_user_accounts u
        WHERE u.ed_user_account_email = e.ed_employee_email
        LIMIT 1
      ) AS ed_user_account_email,
      CASE
        WHEN (
          SELECT u.ed_user_account_email
          FROM eduall_user_accounts u
          WHERE u.ed_user_account_email = e.ed_employee_email
          LIMIT 1
        ) IS NOT NULL THEN 1
        ELSE 0
      END AS has_active_account,
      COALESCE(
        (
          SELECT j.ed_job_title
          FROM eduall_job_titles j
          WHERE j.ed_job_title_id = e.ed_employee_charge
          LIMIT 1
        ),
        'Não atribuído'
      ) AS job_title
    FROM eduall_employees e
    WHERE e.ed_employee_deleted = 0
      AND e.ed_employee_institute_code = ?
    ORDER BY e.ed_employee_name ASC
  `;
  return ExecuteQuery(res, query, [instituteCode], true, {
    db: "eduall_employees",
    type: "select",
    data: req,
  });
};

// ─── Fetch de um único funcionário (com job_title) ────────────────────────────
const FetchSingleEmployee = async (res, req, id, instituteCode) => {
  const query = `
    SELECT
      e.*,
      COALESCE(j.ed_job_title, 'Não atribuído') AS job_title
    FROM eduall_employees e
    LEFT JOIN eduall_job_titles j
      ON j.ed_job_title_id = e.ed_employee_charge
    WHERE e.ed_employee_id = ?
      AND e.ed_employee_institute_code = ?
  `;
  const rows = await ExecuteQuery(res, query, [id, instituteCode], true, {
    db: "eduall_employees",
    type: "select",
    data: req,
  });
  return rows && rows[0] ? rows[0] : null;
};

// ─── Refrescar cache (limpa tudo e repõe a lista) ─────────────────────────────
const RefreshEmployeeCache = async (res, req, instituteCode) => {
  const startTime = Date.now();

  await Cache.eduallClear(CacheKeys.all());
  console.log(`📦🧹 CACHE -> limpa para institute ${instituteCode}`);

  const rows = await FetchEmployees(res, req, instituteCode);
  await Cache.eduallSet(CacheKeys.list(instituteCode), rows, EMPLOYEE_CACHE_TTL);

  const duration = Date.now() - startTime;
  console.log(
    `🗄️🐢 BASE DE DADOS (lento) -> cache reposta em ${duration}ms para institute ${instituteCode}`
  );

  return rows;
};

/* ===================== GET OPERATIONS (COM CACHE) ===================== */

/**
 * GET ALL — Listar todos os funcionários com dados de conta ativa e cargo
 */
const Getemployees = async (req, res) => {
  try {
    const instituteCode = req.session.user.eduall_user_session_curentinstitute;
    const cacheKey = CacheKeys.list(instituteCode);
    const startTime = Date.now();

    const cached = await Cache.eduallGet(cacheKey);
    if (cached !== null) {
      const duration = Date.now() - startTime;
      console.log(`📦⚡ CACHE (rápido) -> Getemployees demorou ${duration}ms (${cacheKey})`);
      return res.status(200).json(cached);
    }

    const rows = await FetchEmployees(res, req, instituteCode);
    await Cache.eduallSet(cacheKey, rows, EMPLOYEE_CACHE_TTL);

    const duration = Date.now() - startTime;
    console.log(`🗄️🐢 BASE DE DADOS (lento) -> Getemployees demorou ${duration}ms (${cacheKey})`);

    res.status(200).json(rows);
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Falha ao buscar funcionários!",
      error: error.message,
    });
  }
};

/**
 * GET SINGLE — Obter funcionário individual com dados de cargo
 */
const GetSingleEmployee = async (req, res) => {
  try {
    const { ID } = req.params;
    const instituteCode = req.session.user.eduall_user_session_curentinstitute;
    const cacheKey = CacheKeys.single(ID, instituteCode);
    const startTime = Date.now();

    const cached = await Cache.eduallGet(cacheKey);
    if (cached !== null) {
      const duration = Date.now() - startTime;
      console.log(
        `📦⚡ CACHE (rápido) -> GetSingleEmployee demorou ${duration}ms (${cacheKey})`
      );
      return res.status(200).json(cached);
    }

    const query = `
      SELECT
        e.*,
        COALESCE(j.ed_job_title, 'Não atribuído') AS job_title
      FROM eduall_employees e
      LEFT JOIN eduall_job_titles j
        ON j.ed_job_title_id = e.ed_employee_charge
      WHERE e.ed_employee_id = ?
        AND e.ed_employee_deleted = 0
        AND e.ed_employee_institute_code = ?
    `;

    const PARAMS = [ID, instituteCode];
    const rows = await ExecuteQuery(res, query, PARAMS, true, {
      db: "eduall_employees",
      type: "select",
      data: req,
    });

    if (!rows || rows.length === 0)
      return res
        .status(404)
        .json({ success: false, message: "Funcionário não encontrado." });

    const result = rows[0];
    await Cache.eduallSet(cacheKey, result, EMPLOYEE_CACHE_TTL);

    const duration = Date.now() - startTime;
    console.log(
      `🗄️🐢 BASE DE DADOS (lento) -> GetSingleEmployee demorou ${duration}ms (${cacheKey})`
    );

    res.status(200).json(result);
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Falha ao buscar funcionário!",
      error: error.message,
    });
  }
};

/**
 * GET BY JOB TITLE — Listar funcionários por cargo/função
 */
const GetEmployeeByJobTitle = async (req, res) => {
  try {
    const { CODE } = req.params;
    const cacheKey = CacheKeys.byJobTitle(CODE);
    const startTime = Date.now();

    const cached = await Cache.eduallGet(cacheKey);
    if (cached !== null) {
      const duration = Date.now() - startTime;
      console.log(
        `📦⚡ CACHE (rápido) -> GetEmployeeByJobTitle demorou ${duration}ms (${cacheKey})`
      );
      return res.status(200).json(cached);
    }

    const query = `
      SELECT * FROM eduall_employees
      WHERE ed_employee_charge = ?
        AND ed_employee_deleted = 0
      ORDER BY ed_employee_name ASC
    `;
    const PARAMS = [CODE];
    const rows = await ExecuteQuery(res, query, PARAMS, true, {
      db: "eduall_employees",
      type: "select",
      data: req,
    });

    await Cache.eduallSet(cacheKey, rows, EMPLOYEE_CACHE_TTL);

    const duration = Date.now() - startTime;
    console.log(
      `🗄️🐢 BASE DE DADOS (lento) -> GetEmployeeByJobTitle demorou ${duration}ms (${cacheKey})`
    );

    res.status(200).json(rows);
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Falha ao buscar funcionários por cargo!",
      error: error.message,
    });
  }
};

/**
 * GET BY USER — Obter dados de funcionário pelo utilizador logado (com licenças)
 */
const GetEmployeeDataByUser = async (req, res) => {
  try {
    const userId = req.session.user.eduall_user_session_ID;
    const instituteCode = req.session.user.eduall_user_session_curentinstitute;
    const cacheKey = CacheKeys.byUser(userId, instituteCode);
    const startTime = Date.now();

    const cached = await Cache.eduallGet(cacheKey);
    if (cached !== null) {
      const duration = Date.now() - startTime;
      console.log(
        `📦⚡ CACHE (rápido) -> GetEmployeeDataByUser demorou ${duration}ms (${cacheKey})`
      );
      return res.status(200).json(cached);
    }

    const query = `
      SELECT
        ui.*,
        ins.ed_institute_id,
        ins.ed_institute_name,
        ins.ed_institute_code,
        emp.ed_employee_id,
        emp.ed_employee_name,
        emp.ed_employee_email,
        emp.ed_employee_charge,
        lc.ed_institute_licence_type,
        lc.ed_institute_licence_endDate
      FROM eduall_user_institutes ui
      LEFT JOIN eduall_institutes ins
        ON ui.ed_user_institute_code = ins.ed_institute_code
      LEFT JOIN eduall_employees emp
        ON ui.ed_user_institute_employeeCode = emp.ed_employee_id AND emp.ed_employee_deleted = 0
      LEFT JOIN eduall_institutes_licences lc
        ON lc.ed_institute_licence_instituteCode = ins.ed_institute_code
      WHERE ui.ed_user_institute_deleted = 0
        AND ui.ed_user_institute_userCode = ?
        AND ui.ed_user_institute_code = ?
        AND lc.ed_institute_licence_type IN (0, 2, 3, 4, 5)
        AND lc.ed_institute_licence_endDate > NOW()
    `;

    const PARAMS = [userId, instituteCode];
    const rows = await ExecuteQuery(res, query, PARAMS, true, {
      db: "eduall_employees",
      type: "select",
      data: req,
    });

    await Cache.eduallSet(cacheKey, rows, EMPLOYEE_CACHE_TTL);

    const duration = Date.now() - startTime;
    console.log(
      `🗄️🐢 BASE DE DADOS (lento) -> GetEmployeeDataByUser demorou ${duration}ms (${cacheKey})`
    );

    res.status(200).json(rows);
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Falha ao buscar dados de funcionário!",
      error: error.message,
    });
  }
};

/* ===================== POST OPERATIONS (COM VALIDAÇÃO E CACHE REFRESH) ===================== */

/**
 * POST — Registar novo funcionário
 * Se employee_code não vier no body, é gerado automaticamente e garantido único na BD.
 */
const RegisterEmployee = async (req, res) => {
  try {
    const {
      employee_name,
      employee_address,
      employee_nacionality,
      employee_naturalness,
      employee_gender,
      employee_religion,
      employee_birthday,
      employee_phone,
      employee_landline,
      employee_nif,
      employee_email,
      employee_civil_state,
      employee_identityCard,
      employee_charge,
      employee_subjects,
      employee_status,
    } = req.body;
    let employee_code = req.body.employee_code;
    const instituteCode = req.session.user.eduall_user_session_curentinstitute;

    // Validações
    const errors = ValidateEmployeeFields(req.body);
    if (errors.length > 0)
      return res.status(422).json({ success: false, msg: errors.join(" "), errors });

    // Verificar email único dentro do instituto
    const checkEmailQuery = `
      SELECT ed_employee_id FROM eduall_employees
      WHERE ed_employee_deleted = 0
        AND LOWER(TRIM(ed_employee_email)) = LOWER(TRIM(?))
        AND ed_employee_institute_code = ?
    `;
    const existingEmail = await ExecuteQuery(
      res,
      checkEmailQuery,
      [employee_email.trim(), instituteCode],
      true,
      { db: "eduall_employees", type: "select", data: req }
    );

    if (existingEmail && existingEmail.length > 0)
      return res.status(409).json({
        success: false,
        msg: `Já existe um funcionário com o email "${employee_email.trim()}".`,
      });

    // Se não veio código do frontend, gera um automaticamente (único na BD)
    if (!employee_code || employee_code.trim() === "") {
      employee_code = await GenerateUniqueEmployeeCode(req, res, instituteCode);
      console.log(`🔑 Código gerado automaticamente para novo funcionário: ${employee_code}`);
    } else {
      employee_code = employee_code.trim();

      // Se veio um código manual, confirmar que não está em uso
      const checkCodeQuery = `
        SELECT ed_employee_id FROM eduall_employees
        WHERE ed_employee_deleted = 0
          AND ed_employee_code = ?
          AND ed_employee_institute_code = ?
      `;
      const existingCode = await ExecuteQuery(
        res,
        checkCodeQuery,
        [employee_code, instituteCode],
        true,
        { db: "eduall_employees", type: "select", data: req }
      );

      if (existingCode && existingCode.length > 0)
        return res.status(409).json({
          success: false,
          msg: `Já existe um funcionário com o código "${employee_code}".`,
        });
    }

    const picturePath = req.file ? "images/employees/" + req.file.filename : "";

    const query = `
      INSERT INTO eduall_employees (
        ed_employee_name,
        ed_employee_address,
        ed_employee_nacionality,
        ed_employee_naturalness,
        ed_employee_gender,
        ed_employee_religion,
        ed_employee_birthday,
        ed_employee_phone,
        ed_employee_phone2,
        ed_employee_nif,
        ed_employee_email,
        ed_employee_civil_state,
        ed_employee_code,
        ed_employee_picture,
        ed_employee_identityCard,
        ed_employee_charge,
        ed_employee_subjects,
        ed_employee_status,
        ed_employee_institute_code
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    const PARAMS = [
      employee_name.trim(),
      employee_address || null,
      employee_nacionality || null,
      employee_naturalness || null,
      employee_gender || null,
      employee_religion || null,
      employee_birthday || null,
      employee_phone || null,
      employee_landline || null,
      employee_nif || null,
      employee_email.trim(),
      employee_civil_state || null,
      employee_code,
      picturePath,
      employee_identityCard || null,
      employee_charge.trim(),
      employee_subjects || null,
      employee_status || "active",
      instituteCode,
    ];

    const rows = await ExecuteQuery(res, query, PARAMS, false, {
      db: "eduall_employees",
      type: "insert",
      data: req,
    });

    await RegisterAuditAction({
      session: req.session,
      action: 1,
      form: "Funcionários",
      description: `Registrou novo funcionário (${employee_name.trim()}) com código ${employee_code}`,
    });

    console.log(
      `🗄️🐢 BASE DE DADOS (lento) -> RegisterEmployee: funcionário "${employee_name.trim()}" registado`
    );
    await RefreshEmployeeCache(res, req, instituteCode);

    // Buscar o registo completo recém-criado (com job_title incluído)
    const insertedId = rows && rows.insertId ? rows.insertId : null;
    const fullEmployee = insertedId
      ? await FetchSingleEmployee(res, req, insertedId, instituteCode)
      : null;

    res.status(201).json({
      success: true,
      message: "Funcionário registado com sucesso!",
      data: fullEmployee || rows,
      employee_code, // devolve o código (gerado ou fornecido) ao frontend
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Falha ao registar funcionário!",
      error: error.message,
    });
  }
};

/* ===================== PUT OPERATIONS (COM VALIDAÇÃO E CACHE REFRESH) ===================== */

/**
 * PUT — Atualizar funcionário
 * O employee_code NUNCA é alterado aqui: mantém-se sempre o valor já existente na BD.
 * A resposta devolve o registo completo e atualizado (fullEmployee), incluindo o
 * código original e o job_title, mesmo que o frontend só tenha enviado alguns campos.
 */
const EmployeeUpdate = async (req, res) => {
  try {
    const { ID } = req.params;
    const {
      employee_name,
      employee_address,
      employee_nacionality,
      employee_naturalness,
      employee_gender,
      employee_religion,
      employee_birthday,
      employee_phone,
      employee_landline,
      employee_nif,
      employee_email,
      employee_civil_state,
      employee_identityCard,
      employee_charge,
      employee_subjects,
      employee_status,
    } = req.body;
    const instituteCode = req.session.user.eduall_user_session_curentinstitute;

    // Validações
    const errors = ValidateEmployeeFields(req.body);
    if (errors.length > 0)
      return res.status(422).json({ success: false, msg: errors.join(" "), errors });

    // Confirmar que o funcionário existe (e obter o código atual, que será mantido)
    const checkExistQuery = `
      SELECT ed_employee_id, ed_employee_code FROM eduall_employees
      WHERE ed_employee_deleted = 0
        AND ed_employee_id = ?
        AND ed_employee_institute_code = ?
    `;
    const found = await ExecuteQuery(res, checkExistQuery, [ID, instituteCode], true, {
      db: "eduall_employees",
      type: "select",
      data: req,
    });

    if (!found || found.length === 0)
      return res
        .status(404)
        .json({
          success: false,
          msg: "Funcionário não encontrado ou já foi removido.",
        });

    // Verificar email único (excluindo o próprio funcionário)
    const checkEmailQuery = `
      SELECT ed_employee_id FROM eduall_employees
      WHERE ed_employee_deleted = 0
        AND LOWER(TRIM(ed_employee_email)) = LOWER(TRIM(?))
        AND ed_employee_institute_code = ?
        AND ed_employee_id != ?
    `;
    const existingEmail = await ExecuteQuery(
      res,
      checkEmailQuery,
      [employee_email.trim(), instituteCode, ID],
      true,
      { db: "eduall_employees", type: "select", data: req }
    );

    if (existingEmail && existingEmail.length > 0)
      return res.status(409).json({
        success: false,
        msg: `Já existe outro funcionário com o email "${employee_email.trim()}".`,
      });

    // Preparar imagem (atualizar só se foi enviada uma nova)
    let setPicture = "";
    const pictureParams = [];
    if (req.file) {
      const picturePath = "images/employees/" + req.file.filename;
      setPicture = ", ed_employee_picture = ?";
      pictureParams.push(picturePath);
    }

    // NOTA: ed_employee_code propositadamente NÃO faz parte deste UPDATE,
    // pelo que o código já existente na BD é sempre mantido.
    const query = `
      UPDATE eduall_employees SET
        ed_employee_name = ?,
        ed_employee_address = ?,
        ed_employee_nacionality = ?,
        ed_employee_naturalness = ?,
        ed_employee_gender = ?,
        ed_employee_religion = ?,
        ed_employee_birthday = ?,
        ed_employee_phone = ?,
        ed_employee_phone2 = ?,
        ed_employee_nif = ?,
        ed_employee_email = ?,
        ed_employee_civil_state = ?,
        ed_employee_identityCard = ?,
        ed_employee_charge = ?,
        ed_employee_subjects = ?,
        ed_employee_status = ?
        ${setPicture}
      WHERE ed_employee_deleted = 0
        AND ed_employee_id = ?
        AND ed_employee_institute_code = ?
    `;

    const PARAMS = [
      employee_name.trim(),
      employee_address || null,
      employee_nacionality || null,
      employee_naturalness || null,
      employee_gender || null,
      employee_religion || null,
      employee_birthday || null,
      employee_phone || null,
      employee_landline || null,
      employee_nif || null,
      employee_email.trim(),
      employee_civil_state || null,
      employee_identityCard || null,
      employee_charge.trim(),
      employee_subjects || null,
      employee_status || "active",
      ...pictureParams,
      ID,
      instituteCode,
    ];

    await ExecuteQuery(res, query, PARAMS, false, {
      db: "eduall_employees",
      type: "update",
      data: req,
    });

    await RegisterAuditAction({
      session: req.session,
      action: 2,
      form: "Funcionários",
      description: `Atualizou funcionário (${employee_name.trim()}) com ID ${ID}`,
    });

    console.log(`🗄️🐢 BASE DE DADOS (lento) -> EmployeeUpdate: funcionário ${ID} atualizado`);
    await RefreshEmployeeCache(res, req, instituteCode);

    // Buscar o registo completo e atualizado (código mantido, job_title incluído)
    const fullEmployee = await FetchSingleEmployee(res, req, ID, instituteCode);

    res.status(200).json({
      success: true,
      message: "Funcionário atualizado com sucesso!",
      data: fullEmployee,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Falha ao atualizar funcionário!",
      error: error.message,
    });
  }
};

/* ===================== DELETE OPERATIONS (COM CACHE REFRESH) ===================== */

/**
 * DELETE (soft-delete) — Eliminar funcionário
 */
const EmployeeDelete = async (req, res) => {
  try {
    const { ID } = req.params;
    const instituteCode = req.session.user.eduall_user_session_curentinstitute;

    // Confirmar existência antes de apagar
    const checkQuery = `
      SELECT ed_employee_name FROM eduall_employees
      WHERE ed_employee_deleted = 0
        AND ed_employee_id = ?
        AND ed_employee_institute_code = ?
    `;
    const found = await ExecuteQuery(res, checkQuery, [ID, instituteCode], true, {
      db: "eduall_employees",
      type: "select",
      data: req,
    });

    if (!found || found.length === 0)
      return res
        .status(404)
        .json({
          success: false,
          msg: "Funcionário não encontrado ou já foi removido.",
        });

    const employeeName = found[0].ed_employee_name;

    const query = `
      UPDATE eduall_employees
      SET ed_employee_deleted = 1
      WHERE ed_employee_deleted = 0
        AND ed_employee_id = ?
        AND ed_employee_institute_code = ?
    `;
    const PARAMS = [ID, instituteCode];

    const rows = await ExecuteQuery(res, query, PARAMS, false, {
      db: "eduall_employees",
      type: "update",
      data: req,
    });

    await RegisterAuditAction({
      session: req.session,
      action: 3,
      form: "Funcionários",
      description: `Eliminou funcionário "${employeeName}" (ID: ${ID})`,
    });

    console.log(`🗄️🐢 BASE DE DADOS (lento) -> EmployeeDelete: funcionário ${ID} eliminado`);
    await RefreshEmployeeCache(res, req, instituteCode);

    res.status(200).json({
      success: true,
      message: "Funcionário eliminado com sucesso!",
      data: rows,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Falha ao eliminar funcionário!",
      error: error.message,
    });
  }
};

/* ===================== MULTER CONFIGURATION ===================== */

const storage = multer.diskStorage({
  destination: path.join(__dirname, `./../images/employees/`),
  filename: (req, file, cb) => {
    return cb(
      null,
      `eduall_file_${file.fieldname}_${Date.now()}_${Math.random().toString().slice(2, 11)}_${path.extname(file.originalname)}`
    );
  },
});

const uploadEmployeePicture = multer({
  storage: storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
  fileFilter: (req, file, cb) => {
    const allowedMimes = ["image/jpeg", "image/png", "image/gif", "image/webp"];
    if (allowedMimes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(
        new Error(
          "Tipo de ficheiro não permitido. Use JPEG, PNG, GIF ou WebP."
        )
      );
    }
  },
}).single(`employee_picture`);

module.exports = {
  Getemployees,
  GetSingleEmployee,
  GetEmployeeByJobTitle,
  RegisterEmployee,
  EmployeeDelete,
  EmployeeUpdate,
  uploadEmployeePicture,
  GetEmployeeDataByUser,
};