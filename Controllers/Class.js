// CACHE-OPT v1 (aplicado por apply_cache_optimizations.py)
const ExecuteQuery = require("../Functions/ExecuteQuery");
const Cache = require("../Functions/CacheRoutes");
const CacheKeys = require("../Functions/CacheKeys");
const { invalidateStudentCaches } = require("../Functions/StudentCache");
const { RegisterAuditAction } = require("./Auditory");

const CLASS_CACHE_TTL = 300; // listas com contagens/capacidade: TTL curto

// ─── Log colorido de erros (consola do servidor) ──────────────────────────────
// Nunca é isto que é devolvido ao cliente — serve para quem está a olhar para
// os logs perceber rapidamente onde e porquê rebentou.
const LogError = (context, error) => {
  const red = "\x1b[31m";
  const bgRed = "\x1b[41m\x1b[37m";
  const yellow = "\x1b[33m";
  const reset = "\x1b[0m";

  console.error(`${bgRed} 🔴 ERRO [${context}] ${reset}`);
  console.error(`${red}Mensagem:${reset} ${error?.message || error}`);
  if (error?.code) console.error(`${yellow}Code:${reset} ${error.code}`);
  if (error?.sqlMessage) console.error(`${yellow}SQL Message:${reset} ${error.sqlMessage}`);
  if (error?.sql) console.error(`${yellow}SQL:${reset} ${error.sql}`);
  if (error?.stack) console.error(`${red}Stack:${reset}\n${error.stack}`);
};

const FRIENDLY_ERROR = "Ocorreu um erro ao processar o pedido. Tente novamente ou contacte o suporte.";

// ─── Helpers ───────────────────────────────────────────────────────────────────
const normalizeService = (value) => {
  if (value === null || value === undefined || value === "") return null;
  const n = parseInt(String(value).trim(), 10);
  if (isNaN(n) || n <= 0) return null;
  return n;
};

// Limite de alunos: aceita null/"" como "sem limite". 0 também é tratado como "sem limite".
const normalizeStudentLimit = (value) => {
  if (value === null || value === undefined || value === "") return null;
  const n = parseInt(String(value).trim(), 10);
  if (isNaN(n) || n <= 0) return null;
  return n;
};

const normalizeClassTitle = (title) => {
  return String(title || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/ª/g, "")
    .replace(/º/g, "");
};

const uidServer = () => Math.random().toString(16).slice(2) + Date.now().toString(16);

// ─── Validações reutilizáveis ─────────────────────────────────────────────────
const ValidateClassFields = (body) => {
  const errors = [];

  if (!body.class_title || body.class_title.trim() === "")
    errors.push("Título da turma é obrigatório.");

  if (body.class_title && body.class_title.trim().length < 2)
    errors.push("Título da turma deve ter pelo menos 2 caracteres.");

  if (
    body.class_student_limit !== undefined &&
    body.class_student_limit !== null &&
    body.class_student_limit !== ""
  ) {
    const n = parseInt(String(body.class_student_limit).trim(), 10);
    if (isNaN(n) || n <= 0)
      errors.push("Limite de alunos deve ser um número inteiro positivo.");
  }

  return errors;
};

// ─── Contagem de alunos ativos numa turma ─────────────────────────────────────
const CountActiveStudentsInClass = async (req, res, classId, instituteCode) => {
  const query = `
    SELECT COUNT(*) AS total FROM eduall_students
    WHERE ed_student_deleted = 0
      AND ed_student_class = ?
      AND ed_student_institute_code = ?`;
  const result = await ExecuteQuery(res, query, [classId, instituteCode], true, {
    db: "eduall_students",
    type: "select",
    data: req,
  });
  return result?.[0]?.total || 0;
};

/**
 * Verifica a disponibilidade de vagas numa turma.
 * Retorna { limit, current, available, isFull }.
 * limit = null significa "sem limite definido".
 */
const CheckClassAvailability = async (req, res, classId, instituteCode) => {
  const query = `
    SELECT ed_class_student_limit FROM eduall_class
    WHERE ed_class_id = ? AND ed_class_institute_code = ? AND ed_class_deleted = 0`;
  const rows = await ExecuteQuery(res, query, [classId, instituteCode], true, {
    db: "eduall_class",
    type: "select",
    data: req,
  });

  if (!rows || rows.length === 0) {
    return { limit: null, current: 0, available: null, isFull: false, notFound: true };
  }

  const limit = rows[0].ed_class_student_limit;
  const current = await CountActiveStudentsInClass(req, res, classId, instituteCode);

  if (limit === null || limit === undefined) {
    return { limit: null, current, available: null, isFull: false, notFound: false };
  }

  const available = Math.max(limit - current, 0);
  return { limit, current, available, isFull: current >= limit, notFound: false };
};

// ─── Fetch base (sem cache) ────────────────────────────────────────────────────
const FetchAllClasses = async (req, res, instituteCode) => {
  const query = `
    SELECT
      c.*,
      cr.*,
      al.*,
      ci.*,
      f.*,
      ay.*,
      co.*,
      emp.ed_employee_id   AS ed_class_director_id,
      emp.ed_employee_name AS ed_class_director_name

    FROM eduall_class c

    LEFT JOIN eduall_classrooms     cr  ON cr.ed_classroom_id      = c.ed_class_room
    LEFT JOIN eduall_academic_level al  ON al.ed_academic_level_id = c.ed_class_academic_level
    LEFT JOIN eduall_cicles         ci  ON ci.ed_cicle_id          = c.ed_class_cicle
    LEFT JOIN eduall_faculty        f   ON f.ed_faculty_id         = c.ed_class_faculty
    LEFT JOIN eduall_academic_year  ay  ON ay.ed_academic_year_id  = c.ed_class_year
    LEFT JOIN eduall_courses        co  ON co.ed_course_id         = c.ed_class_course
    LEFT JOIN eduall_employees      emp ON emp.ed_employee_id      = c.ed_class_director

    WHERE c.ed_class_deleted = 0
      AND c.ed_class_institute_code = ?

    ORDER BY c.ed_class_title ASC
  `;
  return ExecuteQuery(res, query, [instituteCode], true, {
    db: "eduall_class",
    type: "select",
    data: req,
  });
};

const FetchClassesForExams = async (req, res, instituteCode) => {
  const query = `
    SELECT eduall_class.*,
      eduall_classrooms.ed_classroom_title, 
      eduall_academic_level.ed_academic_level_title,
      eduall_cicles.ed_cicle_title,
      eduall_faculty.ed_faculty_title,
      eduall_academic_year.ed_academic_year_title,
      eduall_courses.ed_course_title,
      emp.ed_employee_name AS ed_class_director_name
    FROM eduall_class
    LEFT JOIN eduall_classrooms      ON eduall_classrooms.ed_classroom_id         = eduall_class.ed_class_room
    LEFT JOIN eduall_academic_level  ON eduall_academic_level.ed_academic_level_id = eduall_class.ed_class_academic_level
    LEFT JOIN eduall_cicles          ON eduall_cicles.ed_cicle_id                 = eduall_class.ed_class_cicle
    LEFT JOIN eduall_faculty         ON eduall_faculty.ed_faculty_id              = eduall_class.ed_class_faculty
    LEFT JOIN eduall_academic_year   ON eduall_academic_year.ed_academic_year_id  = eduall_class.ed_class_year
    LEFT JOIN eduall_courses         ON eduall_courses.ed_course_id               = eduall_class.ed_class_course
    LEFT JOIN eduall_employees AS emp ON emp.ed_employee_id                       = eduall_class.ed_class_director
    WHERE ed_class_deleted = 0
      AND eduall_academic_level.ed_academic_level_forExam = 1
      AND ed_class_institute_code = ?`;
  return ExecuteQuery(res, query, [instituteCode], true, {
    db: "eduall_class",
    type: "select",
    data: req,
  });
};

/* ===================== GET OPERATIONS (COM CACHE) ===================== */

const GetClass = async (req, res) => {
  try {
    const instituteCode = req.session.user.eduall_user_session_curentinstitute;

    const rows = await Cache.eduallWithCache(
      CacheKeys.schoolClass.list(instituteCode),
      CLASS_CACHE_TTL,
      () => FetchAllClasses(req, res, instituteCode)
    );

    res.status(200).json(rows);
  } catch (error) {
    LogError("GetClass", error);
    return res.status(500).json({ status: 500, success: false, msg: FRIENDLY_ERROR });
  }
};

const GetClassOfExams = async (req, res) => {
  try {
    const instituteCode = req.session.user.eduall_user_session_curentinstitute;

    const rows = await Cache.eduallWithCache(
      CacheKeys.schoolClass.exams(instituteCode),
      CLASS_CACHE_TTL,
      () => FetchClassesForExams(req, res, instituteCode)
    );

    res.status(200).json(rows);
  } catch (error) {
    LogError("GetClassOfExams", error);
    return res.status(500).json({ status: 500, success: false, msg: FRIENDLY_ERROR });
  }
};

const GetSingleClass = async (req, res) => {
  try {
    const { ID } = req.params;
    if (CacheKeys.parseId(ID) === null) {
      return res.status(400).json({ success: false, message: "ID inválido." });
    }
    const instituteCode = req.session.user.eduall_user_session_curentinstitute;

    const query = `
      SELECT eduall_class.*, emp.ed_employee_name AS ed_class_director_name
      FROM eduall_class
      LEFT JOIN eduall_employees AS emp ON emp.ed_employee_id = eduall_class.ed_class_director
      WHERE ed_class_deleted = 0 AND ed_class_id = ? AND ed_class_institute_code = ?
      ORDER BY ed_class_title ASC`;

    const PARAMS = [ID, instituteCode];
    const rows = await ExecuteQuery(res, query, PARAMS, true, {
      db: "eduall_class",
      type: "select",
      data: req,
    });

    if (!rows || rows.length === 0)
      return res.status(404).json({ success: false, message: "Turma não encontrada." });

    res.status(200).json(rows);
  } catch (error) {
    LogError("GetSingleClass", error);
    return res.status(500).json({ status: 500, success: false, msg: FRIENDLY_ERROR });
  }
};

const GetClassInformation = async (req, res) => {
  try {
    const { ID } = req.params;
    if (CacheKeys.parseId(ID) === null) {
      return res.status(400).json({ success: false, message: "ID inválido." });
    }
    const instituteCode = req.session.user.eduall_user_session_curentinstitute;

    const query = `
      SELECT eduall_class.*,
        eduall_classrooms.ed_classroom_title,
        eduall_academic_level.ed_academic_level_title,
        eduall_cicles.ed_cicle_title,
        eduall_academic_year.ed_academic_year_title,
        eduall_institutes.ed_institute_name,
        emp.ed_employee_name AS ed_class_director_name,
        emp.ed_employee_id   AS ed_class_director
      FROM eduall_class
      LEFT JOIN eduall_classrooms      ON eduall_classrooms.ed_classroom_id         = eduall_class.ed_class_room
      LEFT JOIN eduall_academic_level  ON eduall_academic_level.ed_academic_level_id = eduall_class.ed_class_academic_level
      LEFT JOIN eduall_cicles          ON eduall_cicles.ed_cicle_id                 = eduall_class.ed_class_cicle
      LEFT JOIN eduall_academic_year   ON eduall_academic_year.ed_academic_year_id  = eduall_class.ed_class_year
      LEFT JOIN eduall_institutes      ON eduall_institutes.ed_institute_code        = eduall_class.ed_class_institute_code
      LEFT JOIN eduall_employees AS emp ON emp.ed_employee_id                       = eduall_class.ed_class_director
      WHERE ed_class_deleted = 0
        AND eduall_class.ed_class_id = ?
        AND ed_class_institute_code = ?`;

    const PARAMS = [ID, instituteCode];
    const rows = await ExecuteQuery(res, query, PARAMS, true, {
      db: "eduall_class",
      type: "select",
      data: req,
    });

    if (!rows || rows.length === 0)
      return res.status(404).json({ success: false, message: "Informações da turma não encontradas." });

    const availability = await CheckClassAvailability(req, res, ID, instituteCode);
    rows[0].ed_class_capacity_info = availability;

    res.status(200).json(rows);
  } catch (error) {
    LogError("GetClassInformation", error);
    return res.status(500).json({ status: 500, success: false, msg: FRIENDLY_ERROR });
  }
};

const GetClassAvailability = async (req, res) => {
  try {
    const { ID } = req.params;
    const instituteCode = req.session.user.eduall_user_session_curentinstitute;

    const availability = await CheckClassAvailability(req, res, ID, instituteCode);

    if (availability.notFound)
      return res.status(404).json({ success: false, message: "Turma não encontrada." });

    return res.status(200).json({ success: true, ...availability });
  } catch (error) {
    LogError("GetClassAvailability", error);
    return res.status(500).json({ status: 500, success: false, msg: FRIENDLY_ERROR });
  }
};

/* ===================== INSERÇÃO BASE (reutilizada por Register e pelo Assistente) ===================== */

/**
 * Faz apenas o INSERT + devolve as rows. Não faz verificação de duplicado —
 * quem chama (RegisterClass, o Assistente de Turmas) é responsável por isso
 * antes de chamar esta função.
 */
const InsertClassRecord = async (req, res, instituteCode, payload) => {
  const query = `
    INSERT INTO eduall_class (
      ed_class_title,
      ed_class_faculty,
      ed_class_code, 
      ed_class_course,
      ed_class_period,
      ed_class_year,
      ed_class_room,
      ed_class_cicle,
      ed_class_academic_level,
      ed_class_description,
      ed_class_subjects,
      ed_class_director,
      ed_class_service,
      ed_class_transport,
      ed_class_student_limit,
      ed_class_institute_code
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`;

  const PARAMS = [
    payload.class_title,
    payload.class_faculty ?? "",
    payload.class_code ?? "",
    payload.class_course ?? "",
    payload.class_period ?? 0,
    payload.class_year ?? "",
    payload.class_room ?? "",
    payload.class_cicle ?? "",
    payload.class_academic_level ?? "",
    payload.class_description ?? "",
    payload.class_subjects ?? "",
    payload.class_director || null,
    payload.class_service ?? null,
    payload.class_transport ?? null,
    payload.class_student_limit ?? null,
    instituteCode,
  ];

  return ExecuteQuery(res, query, PARAMS, false, {
    db: "eduall_class",
    type: "insert",
    data: req,
  });
};

/* ===================== POST OPERATIONS (COM VALIDAÇÃO E CACHE REFRESH) ===================== */

/**
 * POST — Registar turma (single ou bulk)
 */
const RegisterClass = async (req, res) => {
  try {
    const instituteCode = req.session.user.eduall_user_session_curentinstitute;

    const buildSuggestionIfExists = async (rawTitle) => {
      let index = 2;
      const allTitlesQuery = `
        SELECT ed_class_title FROM eduall_class
        WHERE ed_class_institute_code = ? AND ed_class_deleted = 0`;
      const allTitles = await ExecuteQuery(res, allTitlesQuery, [instituteCode], true, {
        db: "eduall_class",
        type: "select",
        data: req,
      });
      while (
        allTitles.some(
          (c) =>
            normalizeClassTitle(c.ed_class_title) ===
            normalizeClassTitle(`${rawTitle} ${index}`)
        )
      ) {
        index++;
      }
      return `${rawTitle} ${index}`;
    };

    const checkSimilarExists = async (rawTitle) => {
      const checkQuery = `
        SELECT ed_class_title FROM eduall_class
        WHERE
          LOWER(REPLACE(REPLACE(REPLACE(ed_class_title, ' ', ''), 'ª', ''), 'º', '')) =
          LOWER(REPLACE(REPLACE(REPLACE(?, ' ', ''), 'ª', ''), 'º', ''))
          AND ed_class_institute_code = ?
          AND ed_class_deleted = 0
        LIMIT 1`;
      const existing = await ExecuteQuery(
        res,
        checkQuery,
        [rawTitle, instituteCode],
        true,
        { db: "eduall_class", type: "select", data: req }
      );
      return existing?.length > 0;
    };

    const insertClass = async (payload) => {
      const rawClassTitle = String(payload.class_title ?? "").trim();
      if (!rawClassTitle) {
        return { success: false, status: 400, msg: "Nome da turma inválido." };
      }

      const exists = await checkSimilarExists(rawClassTitle);
      if (exists) {
        const suggestion = await buildSuggestionIfExists(rawClassTitle);
        return {
          success: false,
          status: 400,
          msg: `Já existe uma turma com um nome muito similar. Por favor, utilize uma nomenclatura diferenciada. Ex: ( ${suggestion} )`,
          suggestion,
        };
      }

      const classService = normalizeService(payload.class_service);
      const classTransport = normalizeService(payload.class_transport);
      const classStudentLimit = normalizeStudentLimit(payload.class_student_limit);

      const rows = await InsertClassRecord(req, res, instituteCode, {
        ...payload,
        class_title: rawClassTitle,
        class_service: classService,
        class_transport: classTransport,
        class_student_limit: classStudentLimit,
      });

      const auditSuffix = [
        classService ? `propinas ID ${classService}` : null,
        classTransport ? `transporte ID ${classTransport}` : null,
        classStudentLimit ? `limite de ${classStudentLimit} aluno(s)` : null,
      ]
        .filter(Boolean)
        .join(", ");

      await RegisterAuditAction({
        session: req.session,
        action: 1,
        form: "Turmas",
        description: `Registou turma "${rawClassTitle}"${auditSuffix ? ` (${auditSuffix})` : ""}`,
      });

      return { success: true, status: 200, rows };
    };

    const isBulk = Array.isArray(req.body?.items);

    if (!isBulk) {
      const result = await insertClass(req.body);
      if (!result.success) {
        return res.status(result.status || 400).json({
          status: result.status || 400,
          success: false,
          msg: result.msg || "Erro ao registar turma.",
          suggestion: result.suggestion || undefined,
        });
      }
      console.log(
        `🗄️🐢 BASE DE DADOS (lento) -> RegisterClass: turma "${req.body.class_title}" registada`
      );
      await CacheKeys.safeInvalidate(() => [CacheKeys.schoolClass.list(instituteCode), CacheKeys.schoolClass.exams(instituteCode), CacheKeys.academicLevel.studentsSummary(instituteCode)]);
    await invalidateStudentCaches(instituteCode);
      return res.status(200).json(result.rows);
    }

    const items = req.body.items;
    if (!items.length) {
      return res.status(400).json({
        status: 400,
        success: false,
        msg: "Nenhuma turma enviada no lote.",
      });
    }

    const details = [];
    let ok = 0,
      fail = 0;

    for (let i = 0; i < items.length; i++) {
      try {
        const r = await insertClass(items[i] || {});
        if (r.success) {
          ok++;
          details.push({ index: i, status: "ok" });
        } else {
          fail++;
          details.push({
            index: i,
            status: "fail",
            msg: r.msg || "Falha ao registar turma.",
            suggestion: r.suggestion || "",
          });
        }
      } catch (err) {
        fail++;
        LogError(`RegisterClass (bulk item ${i})`, err);
        details.push({
          index: i,
          status: "fail",
          msg: "Erro interno ao registar esta turma.",
        });
      }
    }

    console.log(`🗄️🐢 BASE DE DADOS (lento) -> RegisterClass (bulk): ${ok} turmas registadas`);
    await CacheKeys.safeInvalidate(() => [CacheKeys.schoolClass.list(instituteCode), CacheKeys.schoolClass.exams(instituteCode), CacheKeys.academicLevel.studentsSummary(instituteCode)]);
    await invalidateStudentCaches(instituteCode);

    return res.status(200).json({ status: 200, success: true, ok, fail, details });
  } catch (error) {
    LogError("RegisterClass", error);
    return res.status(500).json({
      status: 500,
      success: false,
      msg: FRIENDLY_ERROR,
    });
  }
};

/* ===================== PUT OPERATIONS (COM VALIDAÇÃO E CACHE REFRESH) ===================== */

const ClassUpdate = async (req, res) => {
  try {
    const { ID } = req.params;
    const {
      class_title,
      class_faculty,
      class_code,
      class_subjects,
      class_course,
      class_period,
      class_year,
      class_room,
      class_cicle,
      class_academic_level,
      class_description,
      class_director,
      class_service,
      class_transport,
      class_student_limit,
    } = req.body;

    const errors = ValidateClassFields(req.body);
    if (errors.length > 0)
      return res.status(422).json({ success: false, msg: errors.join(" "), errors });

    const normalizedTitle = normalizeClassTitle(class_title);
    const instituteCode = req.session.user.eduall_user_session_curentinstitute;

    const current = await ExecuteQuery(
      res,
      `SELECT ed_class_title FROM eduall_class
       WHERE ed_class_id = ? AND ed_class_institute_code = ? AND ed_class_deleted = 0`,
      [ID, instituteCode],
      true,
      { db: "eduall_class", type: "select", data: req }
    );

    if (current.length > 0) {
      const currentNormalized = normalizeClassTitle(current[0].ed_class_title);

      if (normalizedTitle !== currentNormalized) {
        const existing = await ExecuteQuery(
          res,
          `SELECT ed_class_title FROM eduall_class
           WHERE REPLACE(LOWER(TRIM(ed_class_title)), ' ', '') = ?
             AND ed_class_id != ?
             AND ed_class_institute_code = ?
             AND ed_class_deleted = 0`,
          [normalizedTitle, ID, instituteCode],
          true,
          { db: "eduall_class", type: "select", data: req }
        );

        if (existing.length > 0) {
          const sugestao = `${class_title.trim().replace(/\s+/g, "")}${new Date().getFullYear()}`;
          return res.status(409).json({
            status: 409,
            success: false,
            msg: `Já existe outra turma com este nome. Por favor, utilize uma nomenclatura diferenciada (ex: ${sugestao}).`,
            sugestao,
          });
        }
      }
    }

    const classServiceVal = normalizeService(class_service);
    const classTransportVal = normalizeService(class_transport);
    const classStudentLimitVal = normalizeStudentLimit(class_student_limit);

    if (classStudentLimitVal !== null) {
      const currentStudentCount = await CountActiveStudentsInClass(
        req,
        res,
        ID,
        instituteCode
      );
      if (currentStudentCount > classStudentLimitVal) {
        return res.status(400).json({
          status: 400,
          success: false,
          msg: `Não é possível definir o limite para ${classStudentLimitVal}. A turma já tem ${currentStudentCount} aluno(s) matriculado(s).`,
        });
      }
    }

    const query = `
      UPDATE eduall_class SET
        ed_class_title          = ?,
        ed_class_faculty        = ?,
        ed_class_code           = ?,
        ed_class_course         = ?,
        ed_class_period         = ?,
        ed_class_year           = ?,
        ed_class_room           = ?,
        ed_class_cicle          = ?,
        ed_class_academic_level = ?,
        ed_class_description    = ?,
        ed_class_subjects       = ?,
        ed_class_director       = ?,
        ed_class_service        = ?,
        ed_class_transport      = ?,
        ed_class_student_limit  = ?
      WHERE ed_class_deleted = 0
        AND ed_class_id = ?
        AND ed_class_institute_code = ?`;

    const PARAMS = [
      class_title,
      class_faculty,
      class_code,
      class_course,
      class_period,
      class_year,
      class_room,
      class_cicle,
      class_academic_level,
      class_description,
      class_subjects,
      class_director || null,
      classServiceVal,
      classTransportVal,
      classStudentLimitVal,
      ID,
      instituteCode,
    ];

    const rows = await ExecuteQuery(res, query, PARAMS, false, {
      db: "eduall_class",
      type: "update",
      data: req,
    });

    const auditSuffix = [
      classServiceVal ? `propinas ID ${classServiceVal}` : null,
      classTransportVal ? `transporte ID ${classTransportVal}` : null,
      classStudentLimitVal
        ? `limite de ${classStudentLimitVal} aluno(s)`
        : "sem limite de alunos",
    ]
      .filter(Boolean)
      .join(", ");

    await RegisterAuditAction({
      session: req.session,
      action: 2,
      form: "Turmas",
      description: `Atualizou turma "${class_title}" (ID ${ID})${auditSuffix ? ` — ${auditSuffix}` : ""}`,
    });

    console.log(`🗄️🐢 BASE DE DADOS (lento) -> ClassUpdate: turma ${ID} atualizada`);
    await CacheKeys.safeInvalidate(() => [CacheKeys.schoolClass.list(instituteCode), CacheKeys.schoolClass.exams(instituteCode), CacheKeys.academicLevel.studentsSummary(instituteCode)]);
    await invalidateStudentCaches(instituteCode);

    res.status(200).json(rows);
  } catch (error) {
    LogError("ClassUpdate", error);
    return res.status(500).json({ status: 500, success: false, msg: FRIENDLY_ERROR });
  }
};

const UpdateAllClassesTransport = async (req, res) => {
  try {
    const instituteCode = req.session.user.eduall_user_session_curentinstitute;
    const classTransport = normalizeService(req.body.class_transport);

    const query = `
      UPDATE eduall_class
      SET ed_class_transport = ?
      WHERE ed_class_deleted = 0
        AND ed_class_institute_code = ?`;

    const PARAMS = [classTransport, instituteCode];

    const rows = await ExecuteQuery(res, query, PARAMS, false, {
      db: "eduall_class",
      type: "update",
      data: req,
    });

    const auditMsg = classTransport
      ? `Aplicou serviço de transporte ID ${classTransport} a TODAS as turmas`
      : `Removeu serviço de transporte de TODAS as turmas`;

    await RegisterAuditAction({
      session: req.session,
      action: 2,
      form: "Turmas",
      description: auditMsg,
    });

    console.log(`🗄️🐢 BASE DE DADOS (lento) -> UpdateAllClassesTransport: bulk update executado`);
    await CacheKeys.safeInvalidate(() => [CacheKeys.schoolClass.list(instituteCode), CacheKeys.schoolClass.exams(instituteCode), CacheKeys.academicLevel.studentsSummary(instituteCode)]);
    await invalidateStudentCaches(instituteCode);

    return res.status(200).json({
      status: 200,
      success: true,
      msg: classTransport
        ? `Serviço de transporte ID ${classTransport} aplicado a todas as turmas.`
        : "Serviço de transporte removido de todas as turmas.",
      rows,
    });
  } catch (error) {
    LogError("UpdateAllClassesTransport", error);
    return res.status(500).json({
      status: 500,
      success: false,
      msg: "Não foi possível atualizar o transporte de todas as turmas. Tente novamente.",
    });
  }
};

const UpdateClassStudentLimit = async (req, res) => {
  try {
    const { ID } = req.params;
    const instituteCode = req.session.user.eduall_user_session_curentinstitute;
    const classStudentLimitVal = normalizeStudentLimit(req.body.class_student_limit);

    const foundClass = await ExecuteQuery(
      res,
      `SELECT ed_class_title FROM eduall_class
       WHERE ed_class_deleted = 0 AND ed_class_id = ? AND ed_class_institute_code = ?`,
      [ID, instituteCode],
      true,
      { db: "eduall_class", type: "select", data: req }
    );

    if (!foundClass || foundClass.length === 0)
      return res.status(404).json({ success: false, msg: "Turma não encontrada." });

    if (classStudentLimitVal !== null) {
      const currentStudentCount = await CountActiveStudentsInClass(
        req,
        res,
        ID,
        instituteCode
      );
      if (currentStudentCount > classStudentLimitVal) {
        return res.status(400).json({
          status: 400,
          success: false,
          msg: `Não é possível definir o limite para ${classStudentLimitVal}. A turma já tem ${currentStudentCount} aluno(s) matriculado(s).`,
        });
      }
    }

    const query = `
      UPDATE eduall_class SET ed_class_student_limit = ?
      WHERE ed_class_deleted = 0 AND ed_class_id = ? AND ed_class_institute_code = ?`;
    const rows = await ExecuteQuery(res, query, [classStudentLimitVal, ID, instituteCode], false, {
      db: "eduall_class",
      type: "update",
      data: req,
    });

    await RegisterAuditAction({
      session: req.session,
      action: 2,
      form: "Turmas",
      description: classStudentLimitVal
        ? `Definiu limite de ${classStudentLimitVal} aluno(s) para a turma "${foundClass[0].ed_class_title}" (ID ${ID})`
        : `Removeu o limite de alunos da turma "${foundClass[0].ed_class_title}" (ID ${ID})`,
    });

    console.log(`🗄️🐢 BASE DE DADOS (lento) -> UpdateClassStudentLimit: turma ${ID} atualizada`);
    await CacheKeys.safeInvalidate(() => [CacheKeys.schoolClass.list(instituteCode), CacheKeys.schoolClass.exams(instituteCode), CacheKeys.academicLevel.studentsSummary(instituteCode)]);
    await invalidateStudentCaches(instituteCode);

    return res.status(200).json({
      status: 200,
      success: true,
      msg: classStudentLimitVal
        ? `Limite de alunos definido para ${classStudentLimitVal}.`
        : "Limite de alunos removido (turma sem limite).",
      rows,
    });
  } catch (error) {
    LogError("UpdateClassStudentLimit", error);
    return res.status(500).json({
      status: 500,
      success: false,
      msg: "Não foi possível atualizar o limite de alunos da turma. Tente novamente.",
    });
  }
};

/* ===================== DELETE OPERATIONS (COM CACHE REFRESH) ===================== */

const ClassDelete = async (req, res) => {
  try {
    const { ID } = req.params;
    const instituto = req.session.user.eduall_user_session_curentinstitute;

    const checkTitleQuery = `
      SELECT ed_class_title FROM eduall_class
      WHERE ed_class_deleted = 0
        AND ed_class_id = ?
        AND ed_class_institute_code = ?
    `;
    const foundClass = await ExecuteQuery(res, checkTitleQuery, [ID, instituto], true, {
      db: "eduall_class",
      type: "select",
      data: req,
    });

    if (!foundClass || foundClass.length === 0)
      return res.status(404).json({ success: false, msg: "Turma não encontrada ou já foi removida." });

    const classTitle = foundClass[0].ed_class_title;

    const checkQuery = `
      SELECT COUNT(*) AS total FROM eduall_students
      WHERE ed_student_deleted = 0 AND ed_student_class = ? AND ed_student_institute_code = ?`;
    const checkResult = await ExecuteQuery(res, checkQuery, [ID, instituto], true, {
      db: "eduall_students",
      type: "select",
      data: req,
    });

    if ((checkResult[0]?.total || 0) > 0) {
      return res.status(400).json({
        success: false,
        msg: `Não é possível deletar. Existem ${checkResult[0].total} aluno(s) ainda associado(s) a esta turma.`,
      });
    }

    const query = `
      UPDATE eduall_class SET ed_class_deleted = 1
      WHERE ed_class_deleted = 0 AND ed_class_id = ? AND ed_class_institute_code = ?`;
    const rows = await ExecuteQuery(res, query, [ID, instituto], false, {
      db: "eduall_class",
      type: "update",
      data: req,
    });

    await RegisterAuditAction({
      session: req.session,
      action: 3,
      form: "Turmas",
      description: `Eliminou turma "${classTitle}" (ID: ${ID})`,
    });

    console.log(`🗄️🐢 BASE DE DADOS (lento) -> ClassDelete: turma ${ID} eliminada`);
    await CacheKeys.safeInvalidate(() => [CacheKeys.schoolClass.list(instituto), CacheKeys.schoolClass.exams(instituto), CacheKeys.academicLevel.studentsSummary(instituto)]);
    await invalidateStudentCaches(instituto);

    res.status(200).json(rows);
  } catch (error) {
    LogError("ClassDelete", error);
    return res.status(500).json({
      success: false,
      msg: "Não foi possível eliminar a turma. Tente novamente.",
    });
  }
};

/* ══════════════════════════════════════════════════════════════════════════
   ASSISTENTE DE CRIAÇÃO DE TURMAS (Gemini + fallback manual) — MODO MANUAL
   ══════════════════════════════════════════════════════════════════════════ */

// ─── Geradores de sequência (A,B,C… / 1,2,3… / I,II,III…) ─────────────────────
const ToLetterLabel = (index) => {
  // 0-based -> A, B, C ... Z, AA, AB ...
  let n = index;
  let label = "";
  do {
    label = String.fromCharCode(65 + (n % 26)) + label;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return label;
};

const ToRomanLabel = (num) => {
  const romanMap = [
    [1000, "M"], [900, "CM"], [500, "D"], [400, "CD"],
    [100, "C"], [90, "XC"], [50, "L"], [40, "XL"],
    [10, "X"], [9, "IX"], [5, "V"], [4, "IV"], [1, "I"],
  ];
  let n = num;
  let out = "";
  for (const [value, symbol] of romanMap) {
    while (n >= value) {
      out += symbol;
      n -= value;
    }
  }
  return out;
};

const GenerateSequenceLabel = (index, sequenceType) => {
  switch (sequenceType) {
    case "numbers":
      return String(index + 1);
    case "roman":
      return ToRomanLabel(index + 1);
    case "letters":
    default:
      return ToLetterLabel(index);
  }
};

// ─── Aplica o padrão de nomenclatura definido pela instituição ────────────────
// Suporta o token {X} (ou {x} para minúsculas). Sem token, acrescenta no fim.
const ApplyNamingPattern = (pattern, label) => {
  const raw = String(pattern || "").trim();
  if (!raw) return label;
  if (raw.includes("{X}")) return raw.replace(/{X}/g, label);
  if (raw.includes("{x}")) return raw.replace(/{x}/g, label.toLowerCase());
  return `${raw} ${label}`.trim();
};

// ─── Fallback manual (determinístico, sem IA) ─────────────────────────────────
const GenerateClassNamesManual = ({ pattern, quantity, sequenceType }) => {
  const names = [];
  for (let i = 0; i < quantity; i++) {
    const label = GenerateSequenceLabel(i, sequenceType);
    names.push(ApplyNamingPattern(pattern, label));
  }
  return names;
};

/* ─────────────────────────────────────────────────────────────────────────
   CIRCUIT BREAKER PARA CHAMADAS À GEMINI
   ───────────────────────────────────────────────────────────────────────── */
const CIRCUIT_BREAKER_FAILURE_THRESHOLD = 3;
const CIRCUIT_BREAKER_COOLDOWN_MS = 5 * 60 * 1000; // 5 minutos

const CircuitBreakerState = {
  consecutiveFailures: 0,
  openUntil: 0, // timestamp; enquanto Date.now() < openUntil, o circuito está aberto
};

const IsCircuitOpen = () => Date.now() < CircuitBreakerState.openUntil;

const RegisterCircuitFailure = () => {
  CircuitBreakerState.consecutiveFailures += 1;
  if (CircuitBreakerState.consecutiveFailures >= CIRCUIT_BREAKER_FAILURE_THRESHOLD) {
    CircuitBreakerState.openUntil = Date.now() + CIRCUIT_BREAKER_COOLDOWN_MS;
    console.warn(
      `\x1b[33m⚠️  [AI CIRCUIT BREAKER] Gemini falhou ${CircuitBreakerState.consecutiveFailures}x seguidas. ` +
        `A pausar chamadas à IA durante ${CIRCUIT_BREAKER_COOLDOWN_MS / 1000}s (fallback manual imediato até lá).\x1b[0m`
    );
  }
};

const RegisterCircuitSuccess = () => {
  CircuitBreakerState.consecutiveFailures = 0;
  CircuitBreakerState.openUntil = 0;
};

// ─── Geração via Gemini ────────────────────────────────────────────────────
const GEMINI_API_KEY = "AIzaSyCW-uNqo1cxd1twpu_cUfSAnen1DrDYcDw";
const GEMINI_MODEL = "gemini-3.1-flash-lite";

const GEMINI_TIMEOUT_MS = 60000; // 20s — geração simples de nomes
const GEMINI_SUGGEST_TIMEOUT_MS = 60000; // 30s — sugestão de modelos (prompt maior)

const GEMINI_NAMES_MAX_OUTPUT_TOKENS = 2048;
const GEMINI_MODELS_MAX_OUTPUT_TOKENS = 8192;

// Classifica o erro para logs mais úteis (timeout vs. rede vs. resposta inválida)
const ClassifyGeminiError = (error) => {
  if (error?.name === "AbortError")
    return "TIMEOUT — a Gemini não respondeu dentro do tempo limite (rede lenta, API key inválida, ou serviço indisponível).";
  if (error?.status === "CONFIG") return "CONFIGURAÇÃO — GEMINI_API_KEY não definida.";
  if (error?.status === 503) return "SOBRECARGA (503) — o modelo Gemini está temporariamente sobrecarregado do lado da Google.";
  if (error?.status === 429) return "RATE LIMIT (429) — foram excedidos os limites de pedidos à Gemini.";
  if (typeof error?.status === "number") return `HTTP ${error.status} — a Gemini devolveu um erro.`;
  return "ERRO — falha inesperada ao contactar a Gemini.";
};

const isTransientGeminiError = (error) => error?.status === 503 || error?.status === 429;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const withGeminiRetry = async (fn, { retries = 2, baseDelayMs = 600 } = {}) => {
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      const isLastAttempt = attempt === retries;
      if (!isTransientGeminiError(error) || isLastAttempt) throw error;
      const delay = baseDelayMs * Math.pow(2, attempt); // 600ms, 1200ms, ...
      console.log(
        `\x1b[33m⏳ [AI RETRY] ${ClassifyGeminiError(error)} — a tentar novamente em ${delay}ms (tentativa ${attempt + 2}/${retries + 1}).\x1b[0m`
      );
      await sleep(delay);
    }
  }
  throw lastError;
};

/* ─────────────────────────── Parsing robusto de JSON vindo da Gemini ─────────────────────────── */

const StripMarkdownFences = (text) =>
  String(text || "").replace(/```json/gi, "").replace(/```/g, "").trim();

const ExtractJsonArrayCandidate = (text) => {
  const cleaned = StripMarkdownFences(text);
  const start = cleaned.indexOf("[");
  const end = cleaned.lastIndexOf("]");
  if (start === -1 || end === -1 || end < start) return null;
  return cleaned.slice(start, end + 1);
};

const RepairTruncatedJsonArray = (text) => {
  let depth = 0;
  let inString = false;
  let escape = false;
  let lastCompleteEnd = -1;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (ch === "\\") {
      escape = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (ch === "{") depth++;
    if (ch === "}") {
      depth--;
      if (depth === 0) lastCompleteEnd = i;
    }
  }

  if (lastCompleteEnd === -1) return null;
  return `${text.slice(0, lastCompleteEnd + 1)}]`;
};

const ParseGeminiJsonArray = (rawText, { operation }) => {
  const candidate = ExtractJsonArrayCandidate(rawText);

  if (!candidate) {
    const err = new Error("Invalid AI response — no JSON array found in Gemini output.");
    err.status = "INVALID_JSON";
    err.details = String(rawText || "").slice(0, 800);
    throw err;
  }

  try {
    return { parsed: JSON.parse(candidate), repaired: false };
  } catch (firstError) {
    const repairedCandidate = RepairTruncatedJsonArray(candidate);
    if (repairedCandidate) {
      try {
        const parsed = JSON.parse(repairedCandidate);
        console.warn(
          `\x1b[33m⚠️  [AI JSON REPAIR] Resposta da Gemini (${operation}) veio truncada — recuperados ${parsed.length} item(ns) válido(s) antes do corte.\x1b[0m`
        );
        return { parsed, repaired: true };
      } catch {
        // cai para o erro abaixo
      }
    }
    const err = new Error("Invalid AI response — expected JSON structure was not returned.");
    err.status = "INVALID_JSON";
    err.details = candidate.slice(0, 800);
    throw err;
  }
};

const CallGeminiForClassNames = async ({ pattern, quantity, sequenceType, academicLevelLabel }) => {
  if (!GEMINI_API_KEY) {
    const err = new Error("GEMINI_API_KEY não está configurada no ambiente do servidor.");
    err.status = "CONFIG";
    throw err;
  }
  if (typeof fetch !== "function") throw new Error("Fetch não está disponível neste runtime Node.");

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`;

  const prompt = `
Gera uma lista de ${quantity} nomes de turmas escolares, em português, seguindo ESTRITAMENTE o padrão de nomenclatura: "${pattern}".
Tipo de sequência a usar para diferenciar as turmas: ${sequenceType} (letters = A, B, C...; numbers = 1, 2, 3...; roman = I, II, III...).
${academicLevelLabel ? `Contexto/nível de ensino: ${academicLevelLabel}.` : ""}
Regras obrigatórias:
- Devolve APENAS um array JSON de strings, sem texto adicional, sem markdown, sem comentários, sem explicações.
- O array tem de ter exatamente ${quantity} elementos, todos únicos entre si.
- Substitui o token da sequência no padrão de forma coerente com o tipo pedido.
- Não inventes texto ou números fora do padrão indicado.
Exemplo de resposta válida para o padrão "7.ª {X}" com 3 turmas: ["7.ª A","7.ª B","7.ª C"]
`.trim();

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), GEMINI_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.4, maxOutputTokens: GEMINI_NAMES_MAX_OUTPUT_TOKENS },
      }),
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => "");
      const err = new Error(`Gemini respondeu com status ${response.status}: ${errText}`);
      err.status = response.status;
      throw err;
    }

    const data = await response.json();
    const rawText =
      data?.candidates?.[0]?.content?.parts?.map((p) => p.text).join("") || "";

    const { parsed } = ParseGeminiJsonArray(rawText, { operation: "GenerateClassNames" });

    if (!Array.isArray(parsed) || parsed.length !== quantity)
      throw new Error("A resposta da IA não tem o formato ou a quantidade esperada.");

    const names = parsed.map((n) => String(n).trim()).filter(Boolean);
    const uniqueNames = [...new Set(names)];

    if (uniqueNames.length !== quantity)
      throw new Error("A IA devolveu nomes duplicados ou incompletos.");

    return uniqueNames;
  } finally {
    clearTimeout(timeout);
  }
};

// ─── Wrapper: tenta Gemini, cai para o gerador manual em qualquer falha ───────
const GenerateClassNames = async ({ pattern, quantity, sequenceType, academicLevelLabel, useAI }) => {
  if (useAI && !IsCircuitOpen()) {
    try {
      const names = await withGeminiRetry(() =>
        CallGeminiForClassNames({ pattern, quantity, sequenceType, academicLevelLabel })
      );
      RegisterCircuitSuccess();
      return { names, source: "gemini" };
    } catch (error) {
      LogError(
        `CallGeminiForClassNames (fallback manual ativado) — ${ClassifyGeminiError(error)}`,
        error
      );
      RegisterCircuitFailure();
    }
  } else if (useAI && IsCircuitOpen()) {
    console.log("📦⚡ [AI CIRCUIT BREAKER] Circuito aberto -> a saltar a Gemini e a usar o gerador manual diretamente.");
  }
  const names = GenerateClassNamesManual({ pattern, quantity, sequenceType });
  return { names, source: "manual" };
};

// ─── Verificação de duplicados por ANO LETIVO (para o Assistente) ────────────
const CheckSimilarClassExists = async (req, res, instituteCode, rawTitle, academicYear, excludeId = null) => {
  let query = `
    SELECT ed_class_title FROM eduall_class
    WHERE
      LOWER(REPLACE(REPLACE(REPLACE(ed_class_title, ' ', ''), 'ª', ''), 'º', '')) =
      LOWER(REPLACE(REPLACE(REPLACE(?, ' ', ''), 'ª', ''), 'º', ''))
      AND ed_class_institute_code = ?
      AND ed_class_year = ?
      AND ed_class_deleted = 0`;
  const params = [rawTitle, instituteCode, academicYear];
  if (excludeId) {
    query += ` AND ed_class_id != ?`;
    params.push(excludeId);
  }
  query += ` LIMIT 1`;

  const existing = await ExecuteQuery(res, query, params, true, {
    db: "eduall_class",
    type: "select",
    data: req,
  });
  return existing?.length > 0;
};

const BuildWizardSuggestion = async (req, res, instituteCode, rawTitle, academicYear) => {
  let index = 2;
  let candidate = `${rawTitle} (${index})`;
  while (await CheckSimilarClassExists(req, res, instituteCode, candidate, academicYear)) {
    index++;
    candidate = `${rawTitle} (${index})`;
  }
  return candidate;
};

// ─── Turmas de um ano letivo de origem, para duplicação de estrutura ─────────
const FetchClassesForDuplication = async (req, res, instituteCode, sourceYear) => {
  const query = `
    SELECT ed_class_title, ed_class_faculty, ed_class_code, ed_class_course, ed_class_period,
           ed_class_room, ed_class_cicle, ed_class_academic_level, ed_class_description,
           ed_class_subjects, ed_class_director, ed_class_service, ed_class_transport,
           ed_class_student_limit
    FROM eduall_class
    WHERE ed_class_deleted = 0 AND ed_class_institute_code = ? AND ed_class_year = ?
    ORDER BY ed_class_title ASC`;
  return ExecuteQuery(res, query, [instituteCode, sourceYear], true, {
    db: "eduall_class",
    type: "select",
    data: req,
  });
};

/**
 * POST /eduallclassapi/wizard/preview
 */
const PreviewClassWizard = async (req, res) => {
  try {
    const instituteCode = req.session.user.eduall_user_session_curentinstitute;
    const {
      academic_year,
      academic_level,
      quantity,
      naming_pattern,
      sequence_type,
      use_ai,
      duplicate_from_year,
    } = req.body;

    if (!academic_year) {
      return res.status(422).json({ success: false, msg: "Selecione o ano letivo de destino." });
    }

    // ── Modo duplicação: replica a estrutura de um ano letivo anterior ──────
    if (duplicate_from_year) {
      if (String(duplicate_from_year) === String(academic_year)) {
        return res.status(422).json({
          success: false,
          msg: "O ano letivo de origem tem de ser diferente do ano letivo de destino.",
        });
      }

      const sourceClasses = await FetchClassesForDuplication(req, res, instituteCode, duplicate_from_year);

      if (!sourceClasses.length) {
        return res.status(404).json({
          success: false,
          msg: "Não foram encontradas turmas no ano letivo de origem selecionado.",
        });
      }

      const preview = [];
      for (const c of sourceClasses) {
        const duplicate = await CheckSimilarClassExists(req, res, instituteCode, c.ed_class_title, academic_year);
        preview.push({
          tempId: uidServer(),
          title: c.ed_class_title,
          duplicate,
          overrides: {
            class_faculty: c.ed_class_faculty || "",
            class_code: c.ed_class_code || "",
            class_course: c.ed_class_course || "",
            class_period: c.ed_class_period ?? 0,
            class_room: c.ed_class_room || "",
            class_cicle: c.ed_class_cicle || "",
            class_academic_level: c.ed_class_academic_level || "",
            class_description: c.ed_class_description || "",
            class_subjects: c.ed_class_subjects || "",
            class_director: c.ed_class_director || "",
            class_service: c.ed_class_service ?? null,
            class_transport: c.ed_class_transport ?? null,
            class_student_limit: c.ed_class_student_limit ?? null,
          },
        });
      }

      return res.status(200).json({ success: true, source: "duplicate", usedAI: false, classes: preview });
    }

    // ── Modo geração normal (IA + fallback manual) ──────────────────────────
    const qty = parseInt(quantity, 10);
    if (!qty || qty <= 0 || qty > 200) {
      return res.status(422).json({
        success: false,
        msg: "Indique uma quantidade de turmas válida (entre 1 e 200).",
      });
    }

    const pattern = String(naming_pattern || "{X}").trim();
    const seqType = ["letters", "numbers", "roman"].includes(sequence_type) ? sequence_type : "letters";

    let academicLevelLabel = "";
    if (academic_level) {
      const levelRows = await ExecuteQuery(
        res,
        `SELECT ed_academic_level_title FROM eduall_academic_level WHERE ed_academic_level_id = ?`,
        [academic_level],
        true,
        { db: "eduall_academic_level", type: "select", data: req }
      );
      academicLevelLabel = levelRows?.[0]?.ed_academic_level_title || "";
    }

    const { names, source } = await GenerateClassNames({
      pattern,
      quantity: qty,
      sequenceType: seqType,
      academicLevelLabel,
      useAI: use_ai !== false,
    });

    const preview = [];
    for (const title of names) {
      const duplicate = await CheckSimilarClassExists(req, res, instituteCode, title, academic_year);
      preview.push({ tempId: uidServer(), title, duplicate, overrides: null });
    }

    return res.status(200).json({
      success: true,
      source,
      usedAI: source === "gemini",
      classes: preview,
    });
  } catch (error) {
    LogError("PreviewClassWizard", error);
    return res.status(500).json({
      success: false,
      msg: "Não foi possível gerar a pré-visualização das turmas. Tente novamente.",
    });
  }
};

/**
 * POST /eduallclassapi/wizard/confirm
 */
const ConfirmClassWizard = async (req, res) => {
  try {
    const instituteCode = req.session.user.eduall_user_session_curentinstitute;
    const {
      academic_year,
      academic_level,
      class_course,
      class_faculty,
      class_cicle,
      class_room,
      class_director,
      class_service,
      class_transport,
      class_student_limit,
      class_subjects,
      classes,
    } = req.body;

    if (!academic_year) {
      return res.status(422).json({ success: false, msg: "Ano letivo de destino em falta." });
    }
    if (!Array.isArray(classes) || classes.length === 0) {
      return res.status(422).json({ success: false, msg: "Nenhuma turma para criar." });
    }
    if (classes.length > 200) {
      return res.status(422).json({ success: false, msg: "Limite de 200 turmas por operação excedido." });
    }

    const sharedStudentLimit = normalizeStudentLimit(class_student_limit);
    const sharedService = normalizeService(class_service);
    const sharedTransport = normalizeService(class_transport);

    const details = [];
    let ok = 0;
    let fail = 0;

    for (let i = 0; i < classes.length; i++) {
      const item = classes[i] || {};
      const rawTitle = String(item.title || "").trim();

      if (!rawTitle) {
        fail++;
        details.push({ index: i, status: "fail", msg: "Nome da turma inválido." });
        continue;
      }

      const overrides = item.overrides || {};

      try {
        const duplicate = await CheckSimilarClassExists(req, res, instituteCode, rawTitle, academic_year);
        const finalTitle = duplicate
          ? await BuildWizardSuggestion(req, res, instituteCode, rawTitle, academic_year)
          : rawTitle;

        const payload = {
          class_title: finalTitle,
          class_faculty: overrides.class_faculty ?? class_faculty ?? "",
          class_code: overrides.class_code ?? "",
          class_course: overrides.class_course ?? class_course ?? "",
          class_period: overrides.class_period ?? 0,
          class_year: academic_year,
          class_room: overrides.class_room ?? class_room ?? "",
          class_cicle: overrides.class_cicle ?? class_cicle ?? "",
          class_academic_level: overrides.class_academic_level ?? academic_level ?? "",
          class_description: overrides.class_description ?? "",
          class_subjects: overrides.class_subjects ?? class_subjects ?? "",
          class_director: overrides.class_director ?? class_director ?? "",
          class_service:
            overrides.class_service !== undefined
              ? normalizeService(overrides.class_service)
              : sharedService,
          class_transport:
            overrides.class_transport !== undefined
              ? normalizeService(overrides.class_transport)
              : sharedTransport,
          class_student_limit:
            overrides.class_student_limit !== undefined
              ? normalizeStudentLimit(overrides.class_student_limit)
              : sharedStudentLimit,
        };

        await InsertClassRecord(req, res, instituteCode, payload);

        ok++;
        details.push({
          index: i,
          status: "ok",
          title: finalTitle,
          renamed: finalTitle !== rawTitle,
        });
      } catch (err) {
        fail++;
        LogError(`ConfirmClassWizard (item ${i})`, err);
        details.push({ index: i, status: "fail", msg: "Erro ao criar esta turma." });
      }
    }

    await RegisterAuditAction({
      session: req.session,
      action: 1,
      form: "Turmas",
      description: `Assistente de criação de turmas: ${ok} turma(s) criada(s), ${fail} falha(s) (ano letivo ID ${academic_year}).`,
    });

    console.log(`🗄️🐢 BASE DE DADOS (lento) -> ConfirmClassWizard: ${ok} turmas criadas, ${fail} falhas`);
    await CacheKeys.safeInvalidate(() => [CacheKeys.schoolClass.list(instituteCode), CacheKeys.schoolClass.exams(instituteCode), CacheKeys.academicLevel.studentsSummary(instituteCode)]);
    await invalidateStudentCaches(instituteCode);

    return res.status(200).json({ success: true, ok, fail, details });
  } catch (error) {
    LogError("ConfirmClassWizard", error);
    return res.status(500).json({
      success: false,
      msg: "Não foi possível concluir a criação das turmas. Tente novamente.",
    });
  }
};

/* ══════════════════════════════════════════════════════════════════════════
   ASSISTENTE DE CRIAÇÃO DE TURMAS — MODO AUTOMÁTICO (IA analisa dados existentes)
   Endpoints: POST /eduallclassapi/ai/suggest  e  POST /eduallclassapi/ai/confirm
   ══════════════════════════════════════════════════════════════════════════ */

const hasValueServer = (v) => String(v ?? "").trim() !== "";
const csvToIdsServer = (csv) =>
  String(csv || "").split(",").map((x) => String(x).trim()).filter(Boolean);

const LogAiError = ({ operation, error, extra = {} }) => {
  const timestamp = new Date().toISOString().replace("T", " ").slice(0, 19);
  const status = error?.status || error?.response?.status || extra.status || "N/A";
  const requestId = extra.requestId || error?.requestId || "N/A";

  console.error("\x1b[41m\x1b[37m 🔴 [AI CONFIGURATION ERROR] \x1b[0m");
  console.error(`\x1b[33mProvider:\x1b[0m Gemini`);
  console.error(`\x1b[33mOperation:\x1b[0m ${operation}`);
  if (status !== "N/A") console.error(`\x1b[33mStatus:\x1b[0m ${status}`);
  console.error(`\x1b[33mReason:\x1b[0m ${ClassifyGeminiError(error)} (${error?.message || error})`);
  if (error?.details) console.error(`\x1b[33mDetails:\x1b[0m ${error.details}`);
  if (requestId !== "N/A") console.error(`\x1b[33mRequestId:\x1b[0m ${requestId}`);
  console.error(`\x1b[33mTimestamp:\x1b[0m ${timestamp}`);
  if (error?.stack) console.error(`\x1b[31mStack:\x1b[0m\n${error.stack}`);
};

/* ─────────────────────────── CATÁLOGO (dados já existentes) ─────────────────────────── */

const FetchAcademicLevelsCatalog = async (req, res, instituteCode) => {
  const query = `
    SELECT ed_academic_level_id, ed_academic_level_title
    FROM eduall_academic_level
    WHERE ed_academic_level_institute_code = ?
    ORDER BY ed_academic_level_title ASC`;
  return ExecuteQuery(res, query, [instituteCode], true, {
    db: "eduall_academic_level", type: "select", data: req,
  });
};

const FetchCoursesCatalog = async (req, res, instituteCode) => {
  const query = `
    SELECT ed_course_id, ed_course_title
    FROM eduall_courses
    WHERE ed_course_institute_code = ?
    ORDER BY ed_course_title ASC`;
  return ExecuteQuery(res, query, [instituteCode], true, {
    db: "eduall_courses", type: "select", data: req,
  });
};

const FetchCiclesCatalog = async (req, res, instituteCode) => {
  const query = `
    SELECT ed_cicle_id, ed_cicle_title
    FROM eduall_cicles
    WHERE ed_cicle_institute_code = ?
    ORDER BY ed_cicle_title ASC`;
  return ExecuteQuery(res, query, [instituteCode], true, {
    db: "eduall_cicles", type: "select", data: req,
  });
};

const FetchFacultiesCatalog = async (req, res, instituteCode) => {
  const query = `
    SELECT ed_faculty_id, ed_faculty_title
    FROM eduall_faculty
    WHERE ed_faculty_institute_code = ?
    ORDER BY ed_faculty_title ASC`;
  return ExecuteQuery(res, query, [instituteCode], true, {
    db: "eduall_faculty", type: "select", data: req,
  });
};

const FetchSubjectsCatalog = async (req, res, instituteCode) => {
  const query = `
    SELECT ed_subject_id, ed_subject_title
    FROM eduall_subjects
    WHERE ed_subject_institute_code = ?
    ORDER BY ed_subject_title ASC`;
  return ExecuteQuery(res, query, [instituteCode], true, {
    db: "eduall_subjects", type: "select", data: req,
  });
};

// Turmas já existentes no ano letivo de destino — dá contexto real à IA
const FetchExistingClassesContext = async (req, res, instituteCode, academicYear) => {
  const query = `
    SELECT
      c.ed_class_title, c.ed_class_academic_level, c.ed_class_course,
      c.ed_class_cicle, c.ed_class_faculty, c.ed_class_subjects,
      al.ed_academic_level_title, co.ed_course_title, ci.ed_cicle_title
    FROM eduall_class c
    LEFT JOIN eduall_academic_level al ON al.ed_academic_level_id = c.ed_class_academic_level
    LEFT JOIN eduall_courses        co ON co.ed_course_id         = c.ed_class_course
    LEFT JOIN eduall_cicles         ci ON ci.ed_cicle_id          = c.ed_class_cicle
    WHERE c.ed_class_deleted = 0
      AND c.ed_class_institute_code = ?
      AND c.ed_class_year = ?
    ORDER BY c.ed_class_title ASC`;
  return ExecuteQuery(res, query, [instituteCode, academicYear], true, {
    db: "eduall_class", type: "select", data: req,
  });
};

const FetchInstituteType = async (req, res, instituteCode) => {
  const rows = await ExecuteQuery(
    res,
    `SELECT ed_institute_type FROM eduall_institutes WHERE ed_institute_code = ?`,
    [instituteCode],
    true,
    { db: "eduall_institutes", type: "select", data: req }
  );
  return Number(rows?.[0]?.ed_institute_type) === 1; // true = baseado em faculdade/curso
};

/* ─────────────────────────── GEMINI: sugestão de modelos ─────────────────────────── */

const MAX_CATALOG_ITEMS_IN_PROMPT = 120;
const MAX_EXISTING_CLASSES_IN_PROMPT = 60;

const CallGeminiForClassModels = async ({
  academicLevels, courses, cicles, faculties, subjects, existingClasses,
}) => {
  if (!GEMINI_API_KEY) {
    const err = new Error("GEMINI_API_KEY não está configurada no ambiente do servidor.");
    err.status = "CONFIG";
    throw err;
  }
  if (typeof fetch !== "function") throw new Error("Fetch não está disponível neste runtime Node.");

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`;

  const catalogSummary = {
    academic_levels: academicLevels.slice(0, MAX_CATALOG_ITEMS_IN_PROMPT).map((l) => ({ id: String(l.ed_academic_level_id), title: l.ed_academic_level_title })),
    courses: courses.slice(0, MAX_CATALOG_ITEMS_IN_PROMPT).map((c) => ({ id: String(c.ed_course_id), title: c.ed_course_title })),
    cicles: cicles.slice(0, MAX_CATALOG_ITEMS_IN_PROMPT).map((c) => ({ id: String(c.ed_cicle_id), title: c.ed_cicle_title })),
    faculties: faculties.slice(0, MAX_CATALOG_ITEMS_IN_PROMPT).map((f) => ({ id: String(f.ed_faculty_id), title: f.ed_faculty_title })),
    subjects: subjects.slice(0, MAX_CATALOG_ITEMS_IN_PROMPT).map((s) => ({ id: String(s.ed_subject_id), title: s.ed_subject_title })),
  };

  const existingSummary = existingClasses.slice(0, MAX_EXISTING_CLASSES_IN_PROMPT).map((c) => ({
    title: c.ed_class_title,
    academic_level: c.ed_academic_level_title || null,
    course: c.ed_course_title || null,
    cicle: c.ed_cicle_title || null,
    subjects_csv: c.ed_class_subjects || "",
  }));

  const prompt = `
És um assistente que ajuda a configurar turmas escolares para uma instituição de ensino em Angola.
Analisa os dados abaixo (estrutura já existente na escola) e sugere MODELOS de turma prontos a criar.

CATÁLOGO DISPONÍVEL NA ESCOLA:
${JSON.stringify(catalogSummary)}

TURMAS JÁ EXISTENTES NO ANO LETIVO SELECIONADO:
${JSON.stringify(existingSummary)}

TAREFA:
Sugere entre 1 e 6 modelos de turma. Cada modelo representa um "tipo" de turma (ex: "10.ª Informática")
que poderá gerar várias turmas (A, B, C...). Usa APENAS ids que existam no catálogo fornecido.
Sempre que existirem turmas semelhantes já registadas, reaproveita as disciplinas associadas a elas,
mas usa NO MÁXIMO 8 subject_ids por modelo, mesmo que a turma existente tenha mais.
Se não existirem dados suficientes para um campo (ex: curso, ciclo), deixa a respetiva propriedade como string vazia "".

Devolve APENAS um array JSON (sem markdown, sem texto adicional, sem comentários) com objetos neste formato exato:
[
  {
    "title_pattern": "10.ª Informática {X}",
    "suggested_quantity": 3,
    "academic_level_id": "id do catálogo ou vazio",
    "course_id": "id do catálogo ou vazio",
    "cicle_id": "id do catálogo ou vazio",
    "subject_ids": ["id1", "id2"],
    "possibly_existing": false
  }
]
Regras obrigatórias:
- "title_pattern" deve conter o token {X} onde a letra/número de sequência da turma deve aparecer.
- "possibly_existing" deve ser true se já existir uma turma muito semelhante na lista de turmas existentes.
- "subject_ids" deve conter APENAS ids presentes no catálogo de disciplinas fornecido, no máximo 8 por modelo.
- Não inventes ids que não estejam no catálogo.
- Sê conciso: no máximo 6 modelos, sem texto fora do array JSON.
`.trim();

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), GEMINI_SUGGEST_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.3, maxOutputTokens: GEMINI_MODELS_MAX_OUTPUT_TOKENS },
      }),
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => "");
      const err = new Error(`Gemini respondeu com status ${response.status}`);
      err.status = response.status;
      err.details = errText.slice(0, 500);
      throw err;
    }

    const data = await response.json();
    const candidate0 = data?.candidates?.[0];
    const rawText = candidate0?.content?.parts?.map((p) => p.text).join("") || "";
    const finishReason = candidate0?.finishReason;

    if (!rawText.trim()) {
      const err = new Error("Resposta vazia da IA.");
      err.status = "EMPTY_RESPONSE";
      err.details = finishReason ? `finishReason: ${finishReason}` : undefined;
      throw err;
    }

    if (finishReason === "MAX_TOKENS") {
      console.warn(
        `\x1b[33m⚠️  [AI] Gemini atingiu o limite de maxOutputTokens (${GEMINI_MODELS_MAX_OUTPUT_TOKENS}) — a resposta pode vir truncada. A tentar recuperar o que der.\x1b[0m`
      );
    }

    const { parsed } = ParseGeminiJsonArray(rawText, { operation: "GenerateClassModels" });

    if (!Array.isArray(parsed) || parsed.length === 0) {
      const err = new Error("A IA não devolveu nenhum modelo de turma válido.");
      err.status = "UNEXPECTED_STRUCTURE";
      throw err;
    }

    const validSubjectIds = new Set(subjects.map((s) => String(s.ed_subject_id)));
    const validLevelIds   = new Set(academicLevels.map((l) => String(l.ed_academic_level_id)));
    const validCourseIds  = new Set(courses.map((c) => String(c.ed_course_id)));
    const validCicleIds   = new Set(cicles.map((c) => String(c.ed_cicle_id)));

    const models = parsed
      .filter((m) => m && hasValueServer(m.title_pattern))
      .map((m) => ({
        title_pattern: String(m.title_pattern).trim(),
        suggested_quantity: Math.max(1, Math.min(50, parseInt(m.suggested_quantity, 10) || 1)),
        academic_level_id: validLevelIds.has(String(m.academic_level_id)) ? String(m.academic_level_id) : "",
        course_id: validCourseIds.has(String(m.course_id)) ? String(m.course_id) : "",
        cicle_id: validCicleIds.has(String(m.cicle_id)) ? String(m.cicle_id) : "",
        subject_ids: Array.isArray(m.subject_ids)
          ? m.subject_ids.map(String).filter((id) => validSubjectIds.has(id))
          : [],
        possibly_existing: !!m.possibly_existing,
      }));

    if (!models.length) {
      const err = new Error("Nenhum modelo válido restou após validação da resposta da IA.");
      err.status = "VALIDATION_FAILED";
      throw err;
    }

    return models;
  } finally {
    clearTimeout(timeout);
  }
};

/* ─────────────────────────── Fallback manual (sem IA) ─────────────────────────── */

const BuildManualClassModels = ({ academicLevels, existingClasses, instituteTypeIsFaculty }) => {
  const groups = new Map();

  for (const cls of existingClasses) {
    const levelId  = String(cls.ed_class_academic_level || "");
    const courseId = instituteTypeIsFaculty ? String(cls.ed_class_course || "") : "";
    const cicleId  = !instituteTypeIsFaculty ? String(cls.ed_class_cicle || "") : "";
    const key = `${levelId}|${courseId}|${cicleId}`;

    if (!groups.has(key)) {
      groups.set(key, {
        levelId, courseId, cicleId,
        levelTitle: cls.ed_academic_level_title || "",
        courseTitle: cls.ed_course_title || "",
        count: 0,
        subjectIds: new Set(),
      });
    }
    const g = groups.get(key);
    g.count += 1;
    csvToIdsServer(cls.ed_class_subjects).forEach((id) => g.subjectIds.add(id));
  }

  const models = [];
  for (const g of groups.values()) {
    if (!g.levelId) continue;
    const label = g.courseTitle || g.levelTitle || "Turma";
    models.push({
      title_pattern: `${g.levelTitle || ""} ${label} {X}`.trim(),
      suggested_quantity: Math.max(1, g.count || 1),
      academic_level_id: g.levelId,
      course_id: g.courseId,
      cicle_id: g.cicleId,
      subject_ids: [...g.subjectIds],
      possibly_existing: true,
    });
  }

  if (!models.length) {
    for (const level of academicLevels.slice(0, 6)) {
      models.push({
        title_pattern: `${level.ed_academic_level_title} {X}`,
        suggested_quantity: 1,
        academic_level_id: String(level.ed_academic_level_id),
        course_id: "",
        cicle_id: "",
        subject_ids: [],
        possibly_existing: false,
      });
    }
  }

  return models.slice(0, 6);
};

/* ─────────────────────────── POST /eduallclassapi/ai/suggest ─────────────────────────── */

const SuggestClassModelsAI = async (req, res) => {
  try {
    const instituteCode = req.session.user.eduall_user_session_curentinstitute;
    const { academic_year, use_ai } = req.body;

    if (!hasValueServer(academic_year)) {
      return res.status(422).json({
        success: false,
        msg: "Selecione o ano letivo de destino para analisar os dados existentes.",
      });
    }

    const [instituteTypeIsFaculty, academicLevels, courses, cicles, faculties, subjects, existingClasses] =
      await Promise.all([
        FetchInstituteType(req, res, instituteCode),
        FetchAcademicLevelsCatalog(req, res, instituteCode),
        FetchCoursesCatalog(req, res, instituteCode),
        FetchCiclesCatalog(req, res, instituteCode),
        FetchFacultiesCatalog(req, res, instituteCode),
        FetchSubjectsCatalog(req, res, instituteCode),
        FetchExistingClassesContext(req, res, instituteCode, academic_year),
      ]);

    let models = [];
    let source = "manual";

    if (use_ai !== false && IsCircuitOpen()) {
      console.log(
        "📦⚡ [AI CIRCUIT BREAKER] Circuito aberto -> SuggestClassModelsAI vai direto ao fallback manual."
      );
    }

    if (use_ai !== false && !IsCircuitOpen()) {
      try {
        models = await withGeminiRetry(() =>
          CallGeminiForClassModels({
            academicLevels, courses, cicles, faculties, subjects, existingClasses,
          })
        );
        source = "gemini";
        RegisterCircuitSuccess();
      } catch (aiError) {
        LogAiError({ operation: "GenerateClassModels", error: aiError });
        RegisterCircuitFailure();
        models = []; // cai para o fallback manual abaixo, nunca bloqueia o utilizador
      }
    }

    if (!models.length) {
      models = BuildManualClassModels({ academicLevels, existingClasses, instituteTypeIsFaculty });
      source = "manual";
    }

    for (const model of models) {
      if (model.possibly_existing) continue;
      const sampleTitle = ApplyNamingPattern(model.title_pattern, GenerateSequenceLabel(0, "letters"));
      model.possibly_existing = await CheckSimilarClassExists(req, res, instituteCode, sampleTitle, academic_year);
    }

    return res.status(200).json({
      success: true,
      source,
      catalog: { academicLevels, courses, cicles, faculties, subjects },
      models,
    });
  } catch (error) {
    LogError("SuggestClassModelsAI", error);
    return res.status(500).json({
      success: false,
      msg: "Não foi possível gerar as sugestões. Tente novamente.",
    });
  }
};

/* ─────────────────────────── POST /eduallclassapi/ai/confirm ─────────────────────────── */

const ConfirmAiClassModelsSelection = async (req, res) => {
  try {
    const instituteCode = req.session.user.eduall_user_session_curentinstitute;
    const { academic_year, models } = req.body;

    if (!hasValueServer(academic_year))
      return res.status(422).json({ success: false, msg: "Ano letivo de destino em falta." });

    if (!Array.isArray(models) || !models.length)
      return res.status(422).json({ success: false, msg: "Nenhum modelo de turma selecionado." });

    const subjectsCatalog = await FetchSubjectsCatalog(req, res, instituteCode);
    const validSubjectIds = new Set(subjectsCatalog.map((s) => String(s.ed_subject_id)));

    const details = [];
    let created = 0, reused = 0, fail = 0;

    for (let mi = 0; mi < models.length; mi++) {
      const model = models[mi] || {};
      const seqType = ["letters", "numbers", "roman"].includes(model.sequence_type)
        ? model.sequence_type
        : "letters";
      const pattern = hasValueServer(model.title_pattern) ? String(model.title_pattern).trim() : "{X}";
      const quantity = Math.max(1, Math.min(50, parseInt(model.quantity, 10) || 1));

      const subjectIds = Array.isArray(model.subject_ids)
        ? model.subject_ids.map(String).filter((id) => validSubjectIds.has(id))
        : [];
      const subjectsCsv = subjectIds.join(",");

      const classService = normalizeService(model.class_service);
      const classTransport = normalizeService(model.class_transport);
      const classStudentLimit = normalizeStudentLimit(model.class_student_limit);

      // NOTA: a tabela eduall_courses NÃO tem coluna de faculdade
      // (ed_course_faculty não existe — era a causa do ER_BAD_FIELD_ERROR).
      // A faculdade é um campo próprio da turma (ed_class_faculty), por isso
      // vem diretamente do modelo selecionado no frontend, sem consultar o curso.
      const resolvedFaculty = model.class_faculty || model.faculty_id || "";

      for (let i = 0; i < quantity; i++) {
        const label = GenerateSequenceLabel(i, seqType);
        const rawTitle = ApplyNamingPattern(pattern, label);

        try {
          const existingRows = await ExecuteQuery(
            res,
            `SELECT ed_class_id, ed_class_subjects FROM eduall_class
             WHERE
               LOWER(REPLACE(REPLACE(REPLACE(ed_class_title, ' ', ''), 'ª', ''), 'º', '')) =
               LOWER(REPLACE(REPLACE(REPLACE(?, ' ', ''), 'ª', ''), 'º', ''))
               AND ed_class_institute_code = ?
               AND ed_class_year = ?
               AND ed_class_deleted = 0
             LIMIT 1`,
            [rawTitle, instituteCode, academic_year],
            true,
            { db: "eduall_class", type: "select", data: req }
          );

          if (existingRows && existingRows.length > 0) {
            // Reutiliza a turma existente: junta as disciplinas em falta, sem duplicar.
            const existingId = existingRows[0].ed_class_id;
            const existingSubjects = csvToIdsServer(existingRows[0].ed_class_subjects);
            const mergedSubjects = [...new Set([...existingSubjects, ...subjectIds])];

            await ExecuteQuery(
              res,
              `UPDATE eduall_class SET ed_class_subjects = ?
               WHERE ed_class_id = ? AND ed_class_institute_code = ?`,
              [mergedSubjects.join(","), existingId, instituteCode],
              false,
              { db: "eduall_class", type: "update", data: req }
            );

            reused++;
            details.push({ index: `${mi}-${i}`, title: rawTitle, status: "reused" });
            continue;
          }

          await InsertClassRecord(req, res, instituteCode, {
            class_title: rawTitle,
            class_faculty: resolvedFaculty,
            class_code: "",
            class_course: model.course_id || "",
            class_period: 0,
            class_year: academic_year,
            class_room: model.class_room || "",
            class_cicle: model.cicle_id || "",
            class_academic_level: model.academic_level_id || "",
            class_description: "",
            class_subjects: subjectsCsv,
            class_director: model.class_director || "",
            class_service: classService,
            class_transport: classTransport,
            class_student_limit: classStudentLimit,
          });

          created++;
          details.push({ index: `${mi}-${i}`, title: rawTitle, status: "created" });
        } catch (err) {
          fail++;
          LogError(`ConfirmAiClassModelsSelection (model ${mi}, item ${i})`, err);
          details.push({
            index: `${mi}-${i}`,
            title: rawTitle,
            status: "fail",
            msg: "Erro ao criar/atualizar esta turma.",
          });
        }
      }
    }

    await RegisterAuditAction({
      session: req.session,
      action: 1,
      form: "Turmas",
      description: `Configuração automática de turmas (IA): ${created} criada(s), ${reused} reutilizada(s), ${fail} falha(s) (ano letivo ID ${academic_year}).`,
    });

    console.log(
      `🗄️🐢 BASE DE DADOS (lento) -> ConfirmAiClassModelsSelection: ${created} criadas, ${reused} reutilizadas, ${fail} falhas`
    );
    await CacheKeys.safeInvalidate(() => [CacheKeys.schoolClass.list(instituteCode), CacheKeys.schoolClass.exams(instituteCode), CacheKeys.academicLevel.studentsSummary(instituteCode)]);
    await invalidateStudentCaches(instituteCode);

    return res.status(200).json({ success: true, created, reused, fail, details });
  } catch (error) {
    LogError("ConfirmAiClassModelsSelection", error);
    return res.status(500).json({
      success: false,
      msg: "Não foi possível concluir a configuração automática das turmas. Tente novamente.",
    });
  }
};

module.exports = {
  GetClass,
  GetSingleClass,
  GetClassInformation,
  GetClassAvailability,
  RegisterClass,
  ClassDelete,
  ClassUpdate,
  GetClassOfExams,
  UpdateAllClassesTransport,
  UpdateClassStudentLimit,
  CheckClassAvailability,
  PreviewClassWizard,
  ConfirmClassWizard,
  SuggestClassModelsAI,
  ConfirmAiClassModelsSelection,
};