// CACHE-OPT v1 (aplicado por apply_cache_optimizations.py)
const ExecuteQuery = require("../Functions/ExecuteQuery");
const Cache = require("../Functions/CacheRoutes");
const CacheKeys = require("../Functions/CacheKeys");
const { RegisterAuditAction } = require("./Auditory");

const POINT_CACHE_TTL = 300; // notas lançadas com frequência: TTL curto

// ─── Validações reutilizáveis ─────────────────────────────────────────────────
const ValidatePointFields = (body) => {
  const errors = [];

  if (!body.cn_avaliation_studentCode || String(body.cn_avaliation_studentCode).trim() === "")
    errors.push("Código/ID do aluno é obrigatório.");

  if (!body.cn_avaliation_subClass || String(body.cn_avaliation_subClass).trim() === "")
    errors.push("SubClass é obrigatório.");

  if (body.cn_avaliation_score === null || body.cn_avaliation_score === undefined || body.cn_avaliation_score === "")
    errors.push("Pontuação é obrigatória.");

  if (body.cn_avaliation_score !== null && body.cn_avaliation_score !== undefined) {
    const score = Number(body.cn_avaliation_score);
    if (isNaN(score) || score < 0 || score > 20)
      errors.push("Pontuação deve ser um número entre 0 e 20.");
  }

  if (!body.cn_avaliation_date)
    errors.push("Data da avaliação é obrigatória.");

  return errors;
};

// ─── Fetch base (sem cache) ────────────────────────────────────────────────────
const FetchPoints = async (req, res, instituteCode) => {
  const query = `
    SELECT * FROM eduall_continuous_avaliations
    WHERE ed_cn_avl_deleted = 0
      AND ed_cn_avl_instituteCode = ?
  `;
  return ExecuteQuery(res, query, [instituteCode], true, {
    db: "eduall_continuous_avaliations",
    type: "select",
    data: req,
  });
};

const FetchPointsBySubClass = async (req, res, subClassId, instituteCode) => {
  const query = `
    SELECT * FROM eduall_continuous_avaliations
    LEFT JOIN eduall_students
      ON ed_student_id = ed_cn_avl_studentCode
    WHERE ed_cn_avl_deleted = 0
      AND ed_cn_avl_subClass = ?
      AND ed_cn_avl_instituteCode = ?
      AND ed_student_deleted = 0
  `;
  return ExecuteQuery(res, query, [subClassId, instituteCode], true, {
    db: "eduall_continuous_avaliations",
    type: "select",
    data: req,
  });
};

/* ===================== GET OPERATIONS (COM CACHE) ===================== */

/**
 * GET ALL — Listar todas as avaliações contínuas
 */
const GetPoints = async (req, res) => {
  try {
    const instituteCode = req.session.user.eduall_user_session_curentinstitute;

    const rows = await Cache.eduallWithCache(
      CacheKeys.point.list(instituteCode),
      POINT_CACHE_TTL,
      () => FetchPoints(req, res, instituteCode)
    );

    res.status(200).json(rows);
  } catch (error) {
    res
      .status(500)
      .json({
        success: false,
        message: "Falha ao buscar avaliações contínuas!",
        error: error.message,
      });
  }
};

/**
 * GET BY SUBCLASS — Listar avaliações por subclass com dados de alunos
 */
const GetPointsBySubClass = async (req, res) => {
  try {
    const { ID } = req.params;
    const instituteCode = req.session.user.eduall_user_session_curentinstitute;

    const rows = await FetchPointsBySubClass(req, res, ID, instituteCode);

    res.status(200).json(rows);
  } catch (error) {
    res
      .status(500)
      .json({
        success: false,
        message: "Falha ao buscar avaliações por subclass!",
        error: error.message,
      });
  }
};

/**
 * GET SINGLE — Obter uma avaliação individual
 */
const GetSinglePoint = async (req, res) => {
  try {
    const { ID } = req.params;
    if (CacheKeys.parseId(ID) === null) {
      return res.status(400).json({ success: false, message: "ID inválido." });
    }
    const instituteCode = req.session.user.eduall_user_session_curentinstitute;

    const query = `
      SELECT * FROM eduall_continuous_avaliations
      WHERE ed_cn_avl_deleted = 0
        AND ed_cn_avl_id = ?
        AND ed_cn_avl_instituteCode = ?
    `;
    const PARAMS = [ID, instituteCode];
    const rows = await ExecuteQuery(res, query, PARAMS, true, {
      db: "eduall_continuous_avaliations",
      type: "select",
      data: req,
    });

    if (!rows || rows.length === 0)
      return res
        .status(404)
        .json({ success: false, message: "Avaliação não encontrada." });

    res.status(200).json(rows);
  } catch (error) {
    res
      .status(500)
      .json({
        success: false,
        message: "Falha ao buscar avaliação!",
        error: error.message,
      });
  }
};

/* ===================== POST OPERATIONS (COM VALIDAÇÃO E CACHE REFRESH) ===================== */

/**
 * POST — Registar avaliação contínua
 */
const RegisterPoint = async (req, res) => {
  try {
    const {
      cn_avaliation_studentCode,
      cn_avaliation_subClass,
      cn_avaliation_score,
      cn_avaliation_description,
      cn_avaliation_date,
    } = req.body;
    const instituteCode = req.session.user.eduall_user_session_curentinstitute;

    // Validações
    const errors = ValidatePointFields(req.body);
    if (errors.length > 0)
      return res.status(422).json({ success: false, msg: errors.join(" "), errors });

    // Verificar se o aluno existe e pertence ao instituto
    const checkStudentQuery = `
      SELECT ed_student_id FROM eduall_students
      WHERE ed_student_deleted = 0
        AND ed_student_id = ?
        AND ed_student_institute_code = ?
    `;
    const studentCheck = await ExecuteQuery(
      res,
      checkStudentQuery,
      [cn_avaliation_studentCode, instituteCode],
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
      INSERT INTO eduall_continuous_avaliations (
        ed_cn_avl_studentCode,
        ed_cn_avl_subClass,
        ed_cn_avl_score,
        ed_cn_avl_description,
        ed_cn_avl_date,
        ed_cn_avl_instituteCode
      ) VALUES (?, ?, ?, ?, ?, ?)
    `;
    const PARAMS = [
      cn_avaliation_studentCode,
      cn_avaliation_subClass,
      Number(cn_avaliation_score),
      cn_avaliation_description ? cn_avaliation_description.trim() : null,
      cn_avaliation_date,
      instituteCode,
    ];

    const rows = await ExecuteQuery(res, query, PARAMS, false, {
      db: "eduall_continuous_avaliations",
      type: "insert",
      data: req,
    });

    await RegisterAuditAction({
      session: req.session,
      action: 1,
      form: "Avaliações Contínuas",
      description: `Registrou avaliação contínua para aluno #${cn_avaliation_studentCode} com pontuação ${cn_avaliation_score}`,
    });

    console.log(
      `🗄️🐢 BASE DE DADOS (lento) -> RegisterPoint: avaliação registada para aluno ${cn_avaliation_studentCode}`
    );
    await CacheKeys.safeInvalidate(() => [CacheKeys.point.list(instituteCode)]);

    res
      .status(200)
      .json({ success: true, message: "Avaliação registada com sucesso!", data: rows });
  } catch (error) {
    res
      .status(500)
      .json({
        success: false,
        message: "Falha ao registar avaliação!",
        error: error.message,
      });
  }
};

/* ===================== PUT OPERATIONS (COM VALIDAÇÃO E CACHE REFRESH) ===================== */

/**
 * PUT — Atualizar avaliação
 */
const PointUpdate = async (req, res) => {
  try {
    const { ID } = req.params;
    const { cn_avaliation_score, cn_avaliation_description } = req.body;
    const instituteCode = req.session.user.eduall_user_session_curentinstitute;

    // Validações básicas
    if (cn_avaliation_score === null || cn_avaliation_score === undefined || cn_avaliation_score === "") {
      return res.status(422).json({
        success: false,
        msg: "Pontuação é obrigatória.",
      });
    }

    const score = Number(cn_avaliation_score);
    if (isNaN(score) || score < 0 || score > 20) {
      return res.status(422).json({
        success: false,
        msg: "Pontuação deve ser um número entre 0 e 20.",
      });
    }

    // Confirmar que a avaliação existe
    const checkExistQuery = `
      SELECT ed_cn_avl_id FROM eduall_continuous_avaliations
      WHERE ed_cn_avl_deleted = 0
        AND ed_cn_avl_id = ?
        AND ed_cn_avl_instituteCode = ?
    `;
    const found = await ExecuteQuery(res, checkExistQuery, [ID, instituteCode], true, {
      db: "eduall_continuous_avaliations",
      type: "select",
      data: req,
    });

    if (!found || found.length === 0)
      return res
        .status(404)
        .json({
          success: false,
          msg: "Avaliação não encontrada ou já foi removida.",
        });

    const query = `
      UPDATE eduall_continuous_avaliations
      SET ed_cn_avl_score = ?, ed_cn_avl_description = ?
      WHERE ed_cn_avl_deleted = 0
        AND ed_cn_avl_id = ?
        AND ed_cn_avl_instituteCode = ?
    `;
    const PARAMS = [score, cn_avaliation_description ? cn_avaliation_description.trim() : null, ID, instituteCode];

    const rows = await ExecuteQuery(res, query, PARAMS, false, {
      db: "eduall_continuous_avaliations",
      type: "update",
      data: req,
    });

    await RegisterAuditAction({
      session: req.session,
      action: 2,
      form: "Avaliações Contínuas",
      description: `Atualizou avaliação ID ${ID} com nova pontuação ${score}`,
    });

    console.log(`🗄️🐢 BASE DE DADOS (lento) -> PointUpdate: avaliação ${ID} atualizada`);
    await CacheKeys.safeInvalidate(() => [CacheKeys.point.list(instituteCode)]);

    res
      .status(200)
      .json({ success: true, message: "Avaliação atualizada com sucesso!", data: rows });
  } catch (error) {
    res
      .status(500)
      .json({
        success: false,
        message: "Falha ao atualizar avaliação!",
        error: error.message,
      });
  }
};

/* ===================== DELETE OPERATIONS (COM CACHE REFRESH) ===================== */

/**
 * DELETE (soft-delete) — Eliminar avaliação
 */
const PointDelete = async (req, res) => {
  try {
    const { ID } = req.params;
    const instituteCode = req.session.user.eduall_user_session_curentinstitute;

    // Confirmar existência antes de apagar
    const checkQuery = `
      SELECT ed_cn_avl_id FROM eduall_continuous_avaliations
      WHERE ed_cn_avl_deleted = 0
        AND ed_cn_avl_id = ?
        AND ed_cn_avl_instituteCode = ?
    `;
    const found = await ExecuteQuery(res, checkQuery, [ID, instituteCode], true, {
      db: "eduall_continuous_avaliations",
      type: "select",
      data: req,
    });

    if (!found || found.length === 0)
      return res
        .status(404)
        .json({
          success: false,
          msg: "Avaliação não encontrada ou já foi removida.",
        });

    const query = `
      UPDATE eduall_continuous_avaliations
      SET ed_cn_avl_deleted = 1
      WHERE ed_cn_avl_deleted = 0
        AND ed_cn_avl_id = ?
        AND ed_cn_avl_instituteCode = ?
    `;
    const PARAMS = [ID, instituteCode];

    const rows = await ExecuteQuery(res, query, PARAMS, false, {
      db: "eduall_continuous_avaliations",
      type: "update",
      data: req,
    });

    await RegisterAuditAction({
      session: req.session,
      action: 3,
      form: "Avaliações Contínuas",
      description: `Eliminou avaliação (ID: ${ID})`,
    });

    console.log(`🗄️🐢 BASE DE DADOS (lento) -> PointDelete: avaliação ${ID} eliminada`);
    await CacheKeys.safeInvalidate(() => [CacheKeys.point.list(instituteCode)]);

    res
      .status(200)
      .json({ success: true, message: "Avaliação eliminada com sucesso!", data: rows });
  } catch (error) {
    res
      .status(500)
      .json({
        success: false,
        message: "Falha ao eliminar avaliação!",
        error: error.message,
      });
  }
};

module.exports = {
  GetPoints,
  GetPointsBySubClass,
  GetSinglePoint,
  RegisterPoint,
  PointDelete,
  PointUpdate,
};