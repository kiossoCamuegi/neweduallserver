const ExecuteQuery = require("../Functions/ExecuteQuery");
const Cache = require("../Functions/CacheRoutes");
const { RegisterAuditAction } = require("./Auditory");

const DECLARATION_CACHE_TTL = 3600;

const CacheKeys = {
  list: (instituteCode) => `declaration:list:${instituteCode}`,
  single: (id, instituteCode) => `declaration:single:${id}:${instituteCode}`,
  all: () => "declaration:*",
};

// ─── Validações reutilizáveis ─────────────────────────────────────────────────
const ValidateDeclarationFields = (body) => {
  const errors = [];

  if (!body.declaration_student || String(body.declaration_student).trim() === "")
    errors.push("Código/ID do aluno é obrigatório.");

  if (!body.declaration_effect || body.declaration_effect.trim() === "")
    errors.push("Efeito da declaração é obrigatório.");

  if (body.declaration_with_marks === null || body.declaration_with_marks === undefined || body.declaration_with_marks === "")
    errors.push("Campo 'com notas' é obrigatório.");

  if (!body.declaration_class || String(body.declaration_class).trim() === "")
    errors.push("Turma/classe é obrigatória.");

  return errors;
};

// ─── Fetch base (sem cache) ────────────────────────────────────────────────────
const FetchDeclarations = async (req, res, instituteCode) => {
  const query = `
    SELECT
      d.*,
      s.ed_student_id,
      s.ed_student_name,
      s.ed_student_code,
      s.ed_student_picture
    FROM eduall_declarations d
    LEFT JOIN eduall_students s
      ON s.ed_student_id = d.ed_declaration_student_code
    WHERE d.ed_declaration_deleted = 0
      AND d.ed_declaration_institute_code = ?
    ORDER BY s.ed_student_name ASC
  `;
  return ExecuteQuery(res, query, [instituteCode], true, {
    db: "eduall_declarations",
    type: "select",
    data: req,
  });
};

// ─── Refrescar cache (limpa tudo e repõe a lista) ─────────────────────────────
const RefreshDeclarationCache = async (req, res, instituteCode) => {
  const startTime = Date.now();

  await Cache.eduallClear(CacheKeys.all());
  console.log(`📦🧹 CACHE -> limpa para institute ${instituteCode}`);

  const rows = await FetchDeclarations(req, res, instituteCode);
  await Cache.eduallSet(CacheKeys.list(instituteCode), rows, DECLARATION_CACHE_TTL);

  const duration = Date.now() - startTime;
  console.log(
    `🗄️🐢 BASE DE DADOS (lento) -> cache reposta em ${duration}ms para institute ${instituteCode}`
  );

  return rows;
};

/* ===================== GET OPERATIONS (COM CACHE) ===================== */

/**
 * GET ALL — Listar todas as declarações com dados de alunos
 */
const GetDeclarations = async (req, res) => {
  try {
    const instituteCode = req.session.user.eduall_user_session_curentinstitute;
    const cacheKey = CacheKeys.list(instituteCode);
    const startTime = Date.now();

    const cached = await Cache.eduallGet(cacheKey);
    if (cached !== null) {
      const duration = Date.now() - startTime;
      console.log(`📦⚡ CACHE (rápido) -> GetDeclarations demorou ${duration}ms (${cacheKey})`);
      return res.status(200).json(cached);
    }

    const rows = await FetchDeclarations(req, res, instituteCode);
    await Cache.eduallSet(cacheKey, rows, DECLARATION_CACHE_TTL);

    const duration = Date.now() - startTime;
    console.log(`🗄️🐢 BASE DE DADOS (lento) -> GetDeclarations demorou ${duration}ms (${cacheKey})`);

    res.status(200).json(rows);
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Falha ao buscar declarações!",
      error: error.message,
    });
  }
};

/**
 * GET SINGLE — Obter declaração individual com dados do aluno
 */
const GetSingleDeclaration = async (req, res) => {
  try {
    const { ID } = req.params;
    const instituteCode = req.session.user.eduall_user_session_curentinstitute;
    const cacheKey = CacheKeys.single(ID, instituteCode);
    const startTime = Date.now();

    const cached = await Cache.eduallGet(cacheKey);
    if (cached !== null) {
      const duration = Date.now() - startTime;
      console.log(
        `📦⚡ CACHE (rápido) -> GetSingleDeclaration demorou ${duration}ms (${cacheKey})`
      );
      return res.status(200).json(cached);
    }

    const query = `
      SELECT
        d.*,
        s.ed_student_id,
        s.ed_student_name,
        s.ed_student_code,
        s.ed_student_picture
      FROM eduall_declarations d
      LEFT JOIN eduall_students s
        ON s.ed_student_id = d.ed_declaration_student_code
      WHERE d.ed_declaration_deleted = 0
        AND d.ed_declaration_id = ?
        AND d.ed_declaration_institute_code = ?
    `;
    const PARAMS = [ID, instituteCode];
    const rows = await ExecuteQuery(res, query, PARAMS, true, {
      db: "eduall_declarations",
      type: "select",
      data: req,
    });

    if (!rows || rows.length === 0)
      return res
        .status(404)
        .json({ success: false, message: "Declaração não encontrada." });

    const result = rows[0];
    await Cache.eduallSet(cacheKey, result, DECLARATION_CACHE_TTL);

    const duration = Date.now() - startTime;
    console.log(
      `🗄️🐢 BASE DE DADOS (lento) -> GetSingleDeclaration demorou ${duration}ms (${cacheKey})`
    );

    res.status(200).json(result);
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Falha ao buscar declaração!",
      error: error.message,
    });
  }
};

/* ===================== POST OPERATIONS (COM VALIDAÇÃO E CACHE REFRESH) ===================== */

/**
 * POST — Registar declaração
 */
const RegisterDeclaration = async (req, res) => {
  try {
    const {
      declaration_student,
      declaration_effect,
      declaration_with_marks,
      declaration_class,
    } = req.body;
    const instituteCode = req.session.user.eduall_user_session_curentinstitute;

    // Validações
    const errors = ValidateDeclarationFields(req.body);
    if (errors.length > 0)
      return res.status(422).json({ success: false, msg: errors.join(" "), errors });

    // Verificar se o aluno existe
    const checkStudentQuery = `
      SELECT ed_student_id FROM eduall_students
      WHERE ed_student_deleted = 0
        AND ed_student_id = ?
        AND ed_student_institute_code = ?
    `;
    const studentCheck = await ExecuteQuery(
      res,
      checkStudentQuery,
      [declaration_student, instituteCode],
      true,
      { db: "eduall_students", type: "select", data: req }
    );

    if (!studentCheck || studentCheck.length === 0)
      return res
        .status(404)
        .json({
          success: false,
          msg: "Aluno não encontrado ou não pertence à instituição.",
        });

    const query = `
      INSERT INTO eduall_declarations (
        ed_declaration_student_code,
        ed_declaration_effect,
        ed_declaration_with_marks,
        ed_declaration_class,
        ed_declaration_institute_code
      ) VALUES (?, ?, ?, ?, ?)
    `;
    const PARAMS = [
      declaration_student,
      declaration_effect.trim(),
      declaration_with_marks ? 1 : 0,
      declaration_class,
      instituteCode,
    ];

    const rows = await ExecuteQuery(res, query, PARAMS, false, {
      db: "eduall_declarations",
      type: "insert",
      data: req,
    });

    await RegisterAuditAction({
      session: req.session,
      action: 1,
      form: "Declarações",
      description: `Registrou declaração para aluno #${declaration_student} (efeito: ${declaration_effect.trim()})`,
    });

    console.log(
      `🗄️🐢 BASE DE DADOS (lento) -> RegisterDeclaration: declaração para aluno ${declaration_student} registada`
    );
    await RefreshDeclarationCache(req, res, instituteCode);

    res
      .status(201)
      .json({
        success: true,
        message: "Declaração registada com sucesso!",
        data: rows,
      });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Falha ao registar declaração!",
      error: error.message,
    });
  }
};

/* ===================== PUT OPERATIONS (COM VALIDAÇÃO E CACHE REFRESH) ===================== */

/**
 * PUT — Atualizar declaração
 */
const DeclarationUpdate = async (req, res) => {
  try {
    const { ID } = req.params;
    const {
      declaration_effect,
      declaration_with_marks,
      declaration_class,
    } = req.body;
    const instituteCode = req.session.user.eduall_user_session_curentinstitute;

    // Validações
    const errors = ValidateDeclarationFields({
      declaration_student: "dummy", // para satisfazer validação
      declaration_effect,
      declaration_with_marks,
      declaration_class,
    });
    if (errors.length > 0)
      return res.status(422).json({ success: false, msg: errors.join(" "), errors });

    // Confirmar que a declaração existe
    const checkExistQuery = `
      SELECT ed_declaration_id FROM eduall_declarations
      WHERE ed_declaration_deleted = 0
        AND ed_declaration_id = ?
        AND ed_declaration_institute_code = ?
    `;
    const found = await ExecuteQuery(res, checkExistQuery, [ID, instituteCode], true, {
      db: "eduall_declarations",
      type: "select",
      data: req,
    });

    if (!found || found.length === 0)
      return res
        .status(404)
        .json({
          success: false,
          msg: "Declaração não encontrada ou já foi removida.",
        });

    const query = `
      UPDATE eduall_declarations
      SET ed_declaration_effect = ?, ed_declaration_with_marks = ?, ed_declaration_class = ?
      WHERE ed_declaration_deleted = 0
        AND ed_declaration_id = ?
        AND ed_declaration_institute_code = ?
    `;
    const PARAMS = [
      declaration_effect.trim(),
      declaration_with_marks ? 1 : 0,
      declaration_class,
      ID,
      instituteCode,
    ];

    const rows = await ExecuteQuery(res, query, PARAMS, false, {
      db: "eduall_declarations",
      type: "update",
      data: req,
    });

    await RegisterAuditAction({
      session: req.session,
      action: 2,
      form: "Declarações",
      description: `Atualizou declaração ID ${ID} com efeito ${declaration_effect.trim()}`,
    });

    console.log(
      `🗄️🐢 BASE DE DADOS (lento) -> DeclarationUpdate: declaração ${ID} atualizada`
    );
    await RefreshDeclarationCache(req, res, instituteCode);

    res
      .status(200)
      .json({
        success: true,
        message: "Declaração atualizada com sucesso!",
        data: rows,
      });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Falha ao atualizar declaração!",
      error: error.message,
    });
  }
};

/* ===================== DELETE OPERATIONS (COM CACHE REFRESH) ===================== */

/**
 * DELETE (soft-delete) — Eliminar declaração
 */
const DeclarationDelete = async (req, res) => {
  try {
    const { ID } = req.params;
    const instituteCode = req.session.user.eduall_user_session_curentinstitute;

    // Confirmar existência antes de apagar
    const checkQuery = `
      SELECT ed_declaration_id FROM eduall_declarations
      WHERE ed_declaration_deleted = 0
        AND ed_declaration_id = ?
        AND ed_declaration_institute_code = ?
    `;
    const found = await ExecuteQuery(res, checkQuery, [ID, instituteCode], true, {
      db: "eduall_declarations",
      type: "select",
      data: req,
    });

    if (!found || found.length === 0)
      return res
        .status(404)
        .json({
          success: false,
          msg: "Declaração não encontrada ou já foi removida.",
        });

    const query = `
      UPDATE eduall_declarations
      SET ed_declaration_deleted = 1
      WHERE ed_declaration_deleted = 0
        AND ed_declaration_id = ?
        AND ed_declaration_institute_code = ?
    `;
    const PARAMS = [ID, instituteCode];

    const rows = await ExecuteQuery(res, query, PARAMS, false, {
      db: "eduall_declarations",
      type: "update",
      data: req,
    });

    await RegisterAuditAction({
      session: req.session,
      action: 3,
      form: "Declarações",
      description: `Eliminou declaração (ID ${ID})`,
    });

    console.log(
      `🗄️🐢 BASE DE DADOS (lento) -> DeclarationDelete: declaração ${ID} eliminada`
    );
    await RefreshDeclarationCache(req, res, instituteCode);

    res.status(200).json({
      success: true,
      message: "Declaração eliminada com sucesso!",
      data: rows,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Falha ao eliminar declaração!",
      error: error.message,
    });
  }
};

module.exports = {
  GetDeclarations,
  GetSingleDeclaration,
  RegisterDeclaration,
  DeclarationDelete,
  DeclarationUpdate,
};