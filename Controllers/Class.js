const ExecuteQuery = require("../Functions/ExecuteQuery");
const Cache = require("../Functions/CacheRoutes");
const { RegisterAuditAction } = require("./Auditory");

const CLASS_CACHE_TTL = 3600;

const CacheKeys = {
  list: (instituteCode) => `class:list:${instituteCode}`,
  exams: (instituteCode) => `class:exams:${instituteCode}`,
  single: (id, instituteCode) => `class:single:${id}:${instituteCode}`,
  information: (id, instituteCode) => `class:information:${id}:${instituteCode}`,
  all: () => "class:*",
};

// ─── Helpers ───────────────────────────────────────────────────────────────────
const normalizeService = (value) => {
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

// ─── Validações reutilizáveis ─────────────────────────────────────────────────
const ValidateClassFields = (body) => {
  const errors = [];

  if (!body.class_title || body.class_title.trim() === "")
    errors.push("Título da turma é obrigatório.");

  if (body.class_title && body.class_title.trim().length < 2)
    errors.push("Título da turma deve ter pelo menos 2 caracteres.");

  return errors;
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
      eduall_faculty.ed_faculty_name,
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

// ─── Refrescar cache (limpa tudo e repõe as listas) ──────────────────────────
const RefreshClassCache = async (req, res, instituteCode) => {
  const startTime = Date.now();

  await Cache.eduallClear(CacheKeys.all());
  console.log(`📦🧹 CACHE -> limpa para institute ${instituteCode}`);

  // Refazer as duas listas principais
  const classesRows = await FetchAllClasses(req, res, instituteCode);
  const examsRows = await FetchClassesForExams(req, res, instituteCode);

  await Cache.eduallSet(CacheKeys.list(instituteCode), classesRows, CLASS_CACHE_TTL);
  await Cache.eduallSet(CacheKeys.exams(instituteCode), examsRows, CLASS_CACHE_TTL);

  const duration = Date.now() - startTime;
  console.log(
    `🗄️🐢 BASE DE DADOS (lento) -> cache reposta em ${duration}ms para institute ${instituteCode}`
  );

  return classesRows;
};

/* ===================== GET OPERATIONS (COM CACHE) ===================== */

/**
 * GET ALL — Listar todas as turmas com JOINs
 */
const GetClass = async (req, res) => {
  try {
    const instituteCode = req.session.user.eduall_user_session_curentinstitute;
    const cacheKey = CacheKeys.list(instituteCode);
    const startTime = Date.now();

    const cached = await Cache.eduallGet(cacheKey);
    if (cached !== null) {
      const duration = Date.now() - startTime;
      console.log(`📦⚡ CACHE (rápido) -> GetClass demorou ${duration}ms (${cacheKey})`);
      return res.status(200).json(cached);
    }

    const rows = await FetchAllClasses(req, res, instituteCode);
    await Cache.eduallSet(cacheKey, rows, CLASS_CACHE_TTL);

    const duration = Date.now() - startTime;
    console.log(`🗄️🐢 BASE DE DADOS (lento) -> GetClass demorou ${duration}ms (${cacheKey})`);

    res.status(200).json(rows);
  } catch (error) {
    console.log(error);
    return res
      .status(500)
      .json({ status: 500, success: false, error: error.message });
  }
};

/**
 * GET CLASSES FOR EXAMS — Listar turmas com academic_level para exames
 */
const GetClassOfExams = async (req, res) => {
  try {
    const instituteCode = req.session.user.eduall_user_session_curentinstitute;
    const cacheKey = CacheKeys.exams(instituteCode);
    const startTime = Date.now();

    const cached = await Cache.eduallGet(cacheKey);
    if (cached !== null) {
      const duration = Date.now() - startTime;
      console.log(`📦⚡ CACHE (rápido) -> GetClassOfExams demorou ${duration}ms (${cacheKey})`);
      return res.status(200).json(cached);
    }

    const rows = await FetchClassesForExams(req, res, instituteCode);
    await Cache.eduallSet(cacheKey, rows, CLASS_CACHE_TTL);

    const duration = Date.now() - startTime;
    console.log(`🗄️🐢 BASE DE DADOS (lento) -> GetClassOfExams demorou ${duration}ms (${cacheKey})`);

    res.status(200).json(rows);
  } catch (error) {
    return res
      .status(500)
      .json({ status: 500, success: false, error: error.message });
  }
};

/**
 * GET SINGLE — Obter uma turma individual
 */
const GetSingleClass = async (req, res) => {
  try {
    const { ID } = req.params;
    const instituteCode = req.session.user.eduall_user_session_curentinstitute;
    const cacheKey = CacheKeys.single(ID, instituteCode);
    const startTime = Date.now();

    const cached = await Cache.eduallGet(cacheKey);
    if (cached !== null) {
      const duration = Date.now() - startTime;
      console.log(`📦⚡ CACHE (rápido) -> GetSingleClass demorou ${duration}ms (${cacheKey})`);
      return res.status(200).json(cached);
    }

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
      return res
        .status(404)
        .json({ success: false, message: "Turma não encontrada." });

    await Cache.eduallSet(cacheKey, rows, CLASS_CACHE_TTL);

    const duration = Date.now() - startTime;
    console.log(`🗄️🐢 BASE DE DADOS (lento) -> GetSingleClass demorou ${duration}ms (${cacheKey})`);

    res.status(200).json(rows);
  } catch (error) {
    return res
      .status(500)
      .json({ status: 500, success: false, error: error.message });
  }
};

/**
 * GET CLASS INFORMATION — Obtém informações detalhadas de uma turma
 */
const GetClassInformation = async (req, res) => {
  try {
    const { ID } = req.params;
    const instituteCode = req.session.user.eduall_user_session_curentinstitute;
    const cacheKey = CacheKeys.information(ID, instituteCode);
    const startTime = Date.now();

    const cached = await Cache.eduallGet(cacheKey);
    if (cached !== null) {
      const duration = Date.now() - startTime;
      console.log(
        `📦⚡ CACHE (rápido) -> GetClassInformation demorou ${duration}ms (${cacheKey})`
      );
      return res.status(200).json(cached);
    }

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
      return res
        .status(404)
        .json({ success: false, message: "Informações da turma não encontradas." });

    await Cache.eduallSet(cacheKey, rows, CLASS_CACHE_TTL);

    const duration = Date.now() - startTime;
    console.log(
      `🗄️🐢 BASE DE DADOS (lento) -> GetClassInformation demorou ${duration}ms (${cacheKey})`
    );

    res.status(200).json(rows);
  } catch (error) {
    return res
      .status(500)
      .json({ status: 500, success: false, error: error.message });
  }
};

/* ===================== POST OPERATIONS (COM VALIDAÇÃO E CACHE REFRESH) ===================== */

/**
 * POST — Registar turma (single ou bulk)
 */
const RegisterClass = async (req, res) => {
  try {
    const instituteCode = req.session.user.eduall_user_session_curentinstitute;

    // ── Sugere nome alternativo quando já existe duplicado ──────────────────
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

    // ── Verifica se já existe nome normalizado igual ─────────────────────────
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

    // ── Inserção de uma turma ────────────────────────────────────────────────
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
          ed_class_institute_code
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`;

      const PARAMS = [
        rawClassTitle,
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
        classService,
        classTransport,
        instituteCode,
      ];

      const rows = await ExecuteQuery(res, query, PARAMS, false, {
        db: "eduall_class",
        type: "insert",
        data: req,
      });

      const auditSuffix = [
        classService ? `propinas ID ${classService}` : null,
        classTransport ? `transporte ID ${classTransport}` : null,
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

    // ── Single vs Bulk ───────────────────────────────────────────────────────
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
      await RefreshClassCache(req, res, instituteCode);
      return res.status(200).json(result.rows);
    }

    // Bulk
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
        details.push({
          index: i,
          status: "fail",
          msg: err?.message || "Erro interno ao registar turma.",
        });
      }
    }

    console.log(`🗄️🐢 BASE DE DADOS (lento) -> RegisterClass (bulk): ${ok} turmas registadas`);
    await RefreshClassCache(req, res, instituteCode);

    return res.status(200).json({ status: 200, success: true, ok, fail, details });
  } catch (error) {
    return res.status(500).json({
      status: 500,
      success: false,
      msg: "Erro interno no servidor.",
      error: error.message,
    });
  }
};

/* ===================== PUT OPERATIONS (COM VALIDAÇÃO E CACHE REFRESH) ===================== */

/**
 * PUT — Atualizar turma
 */
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
    } = req.body;

    // Validações
    const errors = ValidateClassFields(req.body);
    if (errors.length > 0)
      return res.status(422).json({ success: false, msg: errors.join(" "), errors });

    const normalizedTitle = normalizeClassTitle(class_title);
    const instituteCode = req.session.user.eduall_user_session_curentinstitute;

    // ── Verificação de nome duplicado (ignora a própria turma) ───────────────
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
        ed_class_transport      = ?
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
    await RefreshClassCache(req, res, instituteCode);

    res.status(200).json(rows);
  } catch (error) {
    console.log(error);
    return res
      .status(500)
      .json({ status: 500, success: false, error: error.message });
  }
};

/**
 * PATCH — Atualizar transporte em TODAS as turmas
 */
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
    await RefreshClassCache(req, res, instituteCode);

    return res.status(200).json({
      status: 200,
      success: true,
      msg: classTransport
        ? `Serviço de transporte ID ${classTransport} aplicado a todas as turmas.`
        : "Serviço de transporte removido de todas as turmas.",
      rows,
    });
  } catch (error) {
    console.log(error);
    return res.status(500).json({
      status: 500,
      success: false,
      msg: "Erro ao atualizar transporte de todas as turmas.",
      error: error.message,
    });
  }
};

/* ===================== DELETE OPERATIONS (COM CACHE REFRESH) ===================== */

/**
 * DELETE (soft-delete) — Eliminar turma
 */
const ClassDelete = async (req, res) => {
  try {
    const { ID } = req.params;
    const instituto = req.session.user.eduall_user_session_curentinstitute;

    // Confirmar existência antes de apagar
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
      return res
        .status(404)
        .json({ success: false, msg: "Turma não encontrada ou já foi removida." });

    const classTitle = foundClass[0].ed_class_title;

    // Verificar se há alunos associados
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

    // Soft delete
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
    await RefreshClassCache(req, res, instituto);

    res.status(200).json(rows);
  } catch (error) {
    return res
      .status(500)
      .json({
        success: false,
        msg: "Erro ao tentar eliminar a turma!",
        error: error.message,
      });
  }
};

module.exports = {
  GetClass,
  GetSingleClass,
  GetClassInformation,
  RegisterClass,
  ClassDelete,
  ClassUpdate,
  GetClassOfExams,
  UpdateAllClassesTransport,
};