// CACHE-OPT v1 (aplicado por apply_cache_optimizations.py)
const ExecuteQuery = require("../Functions/ExecuteQuery");
const Cache = require("../Functions/CacheRoutes");
const CacheKeys = require("../Functions/CacheKeys");
const { RegisterAuditAction } = require("./Auditory");

const DECLARATION_REQUEST_CACHE_TTL = 600; // lista com JOIN a alunos

// ─── Validações reutilizáveis ─────────────────────────────────────────────────
const ValidateDeclarationRequestFields = (body) => {
  const errors = [];

  if (!body.declaration_request_student_code || String(body.declaration_request_student_code).trim() === "")
    errors.push("Código/ID do aluno é obrigatório.");

  if (!body.declaration_request_by || body.declaration_request_by.trim() === "")
    errors.push("Solicitado por é obrigatório.");

  if (body.declaration_request_with_marks === null || body.declaration_request_with_marks === undefined || body.declaration_request_with_marks === "")
    errors.push("Campo 'com notas' é obrigatório.");

  if (!body.declaration_request_description || body.declaration_request_description.trim() === "")
    errors.push("Descrição da solicitação é obrigatória.");

  if (body.declaration_request_description && body.declaration_request_description.trim().length < 3)
    errors.push("Descrição deve ter pelo menos 3 caracteres.");

  return errors;
};

// ─── Fetch base (sem cache) ────────────────────────────────────────────────────
const FetchDeclarationRequests = async (req, res, instituteCode) => {
  const query = `
    SELECT
      dr.*,
      s.ed_student_id,
      s.ed_student_name,
      s.ed_student_code,
      s.ed_student_picture
    FROM eduall_declaration_requests dr
    LEFT JOIN eduall_students s
      ON s.ed_student_id = dr.ed_declaration_request_student_code
    WHERE dr.ed_declaration_request_deleted = 0
      AND dr.ed_declaration_request_institute_code = ?
    ORDER BY s.ed_student_name ASC
  `;
  return ExecuteQuery(res, query, [instituteCode], true, {
    db: "eduall_declaration_requests",
    type: "select",
    data: req,
  });
};

/* ===================== GET OPERATIONS (COM CACHE) ===================== */

/**
 * GET ALL — Listar todas as solicitações de declaração com dados de alunos
 */
const GetDeclarationRequests = async (req, res) => {
  try {
    const instituteCode = req.session.user.eduall_user_session_curentinstitute;

    const rows = await Cache.eduallWithCache(
      CacheKeys.declarationRequest.list(instituteCode),
      DECLARATION_REQUEST_CACHE_TTL,
      () => FetchDeclarationRequests(req, res, instituteCode)
    );

    res.status(200).json(rows);
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Falha ao buscar solicitações de declaração!",
      error: error.message,
    });
  }
};

/**
 * GET SINGLE — Obter solicitação de declaração individual com dados do aluno
 */
const GetSingleDeclarationRequest = async (req, res) => {
  try {
    const { ID } = req.params;
    if (CacheKeys.parseId(ID) === null) {
      return res.status(400).json({ success: false, message: "ID inválido." });
    }
    const instituteCode = req.session.user.eduall_user_session_curentinstitute;

    const query = `
      SELECT
        dr.*,
        s.ed_student_id,
        s.ed_student_name,
        s.ed_student_code,
        s.ed_student_picture
      FROM eduall_declaration_requests dr
      LEFT JOIN eduall_students s
        ON s.ed_student_id = dr.ed_declaration_request_student_code
      WHERE dr.ed_declaration_request_deleted = 0
        AND dr.ed_declaration_request_id = ?
        AND dr.ed_declaration_request_institute_code = ?
    `;
    const PARAMS = [ID, instituteCode];
    const rows = await ExecuteQuery(res, query, PARAMS, true, {
      db: "eduall_declaration_requests",
      type: "select",
      data: req,
    });

    if (!rows || rows.length === 0)
      return res
        .status(404)
        .json({ success: false, message: "Solicitação de declaração não encontrada." });

    const result = rows[0];

    res.status(200).json(result);
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Falha ao buscar solicitação de declaração!",
      error: error.message,
    });
  }
};

/* ===================== POST OPERATIONS (COM VALIDAÇÃO E CACHE REFRESH) ===================== */

/**
 * POST — Registar solicitação de declaração
 */
const RegisterDeclarationRequest = async (req, res) => {
  try {
    const {
      declaration_request_student_code,
      declaration_request_by,
      declaration_request_with_marks,
      declaration_request_description,
    } = req.body;
    const instituteCode = req.session.user.eduall_user_session_curentinstitute;

    // Validações
    const errors = ValidateDeclarationRequestFields(req.body);
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
      [declaration_request_student_code, instituteCode],
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
      INSERT INTO eduall_declaration_requests (
        ed_declaration_request_student_code,
        ed_declaration_request_by,
        ed_declaration_request_with_marks,
        ed_declaration_request_description,
        ed_declaration_request_institute_code
      ) VALUES (?, ?, ?, ?, ?)
    `;
    const PARAMS = [
      declaration_request_student_code,
      declaration_request_by.trim(),
      declaration_request_with_marks ? 1 : 0,
      declaration_request_description.trim(),
      instituteCode,
    ];

    const rows = await ExecuteQuery(res, query, PARAMS, false, {
      db: "eduall_declaration_requests",
      type: "insert",
      data: req,
    });

    await RegisterAuditAction({
      session: req.session,
      action: 1,
      form: "Solicitação de Declaração",
      description: `Registrou solicitação de declaração para aluno #${declaration_request_student_code} (solicitado por: ${declaration_request_by.trim()})`,
    });

    console.log(
      `🗄️🐢 BASE DE DADOS (lento) -> RegisterDeclarationRequest: solicitação para aluno ${declaration_request_student_code} registada`
    );
    await CacheKeys.safeInvalidate(() => [CacheKeys.declarationRequest.list(instituteCode)]);

    res
      .status(201)
      .json({
        success: true,
        message: "Solicitação de declaração registada com sucesso!",
        data: rows,
      });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Falha ao registar solicitação de declaração!",
      error: error.message,
    });
  }
};

/* ===================== PUT OPERATIONS (COM VALIDAÇÃO E CACHE REFRESH) ===================== */

/**
 * PUT — Atualizar solicitação de declaração
 */
const DeclarationRequestUpdate = async (req, res) => {
  try {
    const { ID } = req.params;
    const {
      declaration_request_student_code,
      declaration_request_by,
      declaration_request_with_marks,
      declaration_request_status,
      declaration_request_description,
    } = req.body;
    const instituteCode = req.session.user.eduall_user_session_curentinstitute;

    // Validações
    const errors = ValidateDeclarationRequestFields({
      declaration_request_student_code,
      declaration_request_by,
      declaration_request_with_marks,
      declaration_request_description,
    });
    if (errors.length > 0)
      return res.status(422).json({ success: false, msg: errors.join(" "), errors });

    // Confirmar que a solicitação existe
    const checkExistQuery = `
      SELECT ed_declaration_request_id FROM eduall_declaration_requests
      WHERE ed_declaration_request_deleted = 0
        AND ed_declaration_request_id = ?
        AND ed_declaration_request_institute_code = ?
    `;
    const found = await ExecuteQuery(res, checkExistQuery, [ID, instituteCode], true, {
      db: "eduall_declaration_requests",
      type: "select",
      data: req,
    });

    if (!found || found.length === 0)
      return res
        .status(404)
        .json({
          success: false,
          msg: "Solicitação de declaração não encontrada ou já foi removida.",
        });

    const query = `
      UPDATE eduall_declaration_requests
      SET ed_declaration_request_student_code = ?, 
          ed_declaration_request_by = ?,
          ed_declaration_request_with_marks = ?,
          ed_declaration_request_status = ?,
          ed_declaration_request_description = ?
      WHERE ed_declaration_request_deleted = 0
        AND ed_declaration_request_id = ?
        AND ed_declaration_request_institute_code = ?
    `;
    const PARAMS = [
      declaration_request_student_code,
      declaration_request_by.trim(),
      declaration_request_with_marks ? 1 : 0,
      declaration_request_status ? declaration_request_status.trim() : null,
      declaration_request_description.trim(),
      ID,
      instituteCode,
    ];

    const rows = await ExecuteQuery(res, query, PARAMS, false, {
      db: "eduall_declaration_requests",
      type: "update",
      data: req,
    });

    await RegisterAuditAction({
      session: req.session,
      action: 2,
      form: "Solicitação de Declaração",
      description: `Atualizou solicitação de declaração ID ${ID} para aluno ${declaration_request_student_code}`,
    });

    console.log(
      `🗄️🐢 BASE DE DADOS (lento) -> DeclarationRequestUpdate: solicitação ${ID} atualizada`
    );
    await CacheKeys.safeInvalidate(() => [CacheKeys.declarationRequest.list(instituteCode)]);

    res
      .status(200)
      .json({
        success: true,
        message: "Solicitação de declaração atualizada com sucesso!",
        data: rows,
      });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Falha ao atualizar solicitação de declaração!",
      error: error.message,
    });
  }
};

/* ===================== DELETE OPERATIONS (COM CACHE REFRESH) ===================== */

/**
 * DELETE (soft-delete) — Eliminar solicitação de declaração
 */
const DeclarationRequestDelete = async (req, res) => {
  try {
    const { ID } = req.params;
    const instituteCode = req.session.user.eduall_user_session_curentinstitute;

    // Confirmar existência antes de apagar
    const checkQuery = `
      SELECT ed_declaration_request_id FROM eduall_declaration_requests
      WHERE ed_declaration_request_deleted = 0
        AND ed_declaration_request_id = ?
        AND ed_declaration_request_institute_code = ?
    `;
    const found = await ExecuteQuery(res, checkQuery, [ID, instituteCode], true, {
      db: "eduall_declaration_requests",
      type: "select",
      data: req,
    });

    if (!found || found.length === 0)
      return res
        .status(404)
        .json({
          success: false,
          msg: "Solicitação de declaração não encontrada ou já foi removida.",
        });

    const query = `
      UPDATE eduall_declaration_requests
      SET ed_declaration_request_deleted = 1
      WHERE ed_declaration_request_deleted = 0
        AND ed_declaration_request_id = ?
        AND ed_declaration_request_institute_code = ?
    `;
    const PARAMS = [ID, instituteCode];

    const rows = await ExecuteQuery(res, query, PARAMS, false, {
      db: "eduall_declaration_requests",
      type: "update",
      data: req,
    });

    await RegisterAuditAction({
      session: req.session,
      action: 3,
      form: "Solicitação de Declaração",
      description: `Eliminou solicitação de declaração (ID ${ID})`,
    });

    console.log(
      `🗄️🐢 BASE DE DADOS (lento) -> DeclarationRequestDelete: solicitação ${ID} eliminada`
    );
    await CacheKeys.safeInvalidate(() => [CacheKeys.declarationRequest.list(instituteCode)]);

    res.status(200).json({
      success: true,
      message: "Solicitação de declaração eliminada com sucesso!",
      data: rows,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Falha ao eliminar solicitação de declaração!",
      error: error.message,
    });
  }
};

module.exports = {
  GetDeclarationRequests,
  GetSingleDeclarationRequest,
  RegisterDeclarationRequest,
  DeclarationRequestDelete,
  DeclarationRequestUpdate,
};