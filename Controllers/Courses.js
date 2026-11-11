// CACHE-OPT v1 (aplicado por apply_cache_optimizations.py)
const ExecuteQuery = require("../Functions/ExecuteQuery");
const Cache = require("../Functions/CacheRoutes");
const CacheKeys = require("../Functions/CacheKeys");
const { RegisterAuditAction } = require("./Auditory");

const COURSE_CACHE_TTL = 3600;

// ─── Validações reutilizáveis ─────────────────────────────────────────────────
const ValidateCourseFields = (body) => {
  const errors = [];

  if (!body.course_title || body.course_title.trim() === "")
    errors.push("Título do curso é obrigatório.");

  if (body.course_title && body.course_title.trim().length < 2)
    errors.push("Título do curso deve ter pelo menos 2 caracteres.");

  if (!body.course_category || body.course_category.trim() === "")
    errors.push("Categoria do curso é obrigatória.");

  return errors;
};

// ─── Fetch base (sem cache) ────────────────────────────────────────────────────
const FetchCourses = async (req, res, instituteCode) => {
  const query = `
    SELECT * FROM eduall_courses
    WHERE ed_course_deleted = 0
      AND ed_course_institute_code = ?
    ORDER BY ed_course_title ASC
  `;
  return ExecuteQuery(res, query, [instituteCode], true, {
    db: "eduall_courses",
    type: "select",
    data: req,
  });
};

/* ===================== GET OPERATIONS (COM CACHE) ===================== */

/**
 * GET ALL — Listar todos os cursos
 */
const GetCourse = async (req, res) => {
  try {
    const instituteCode = req.session.user.eduall_user_session_curentinstitute;

    const rows = await Cache.eduallWithCache(
      CacheKeys.course.list(instituteCode),
      COURSE_CACHE_TTL,
      () => FetchCourses(req, res, instituteCode)
    );

    res.status(200).json(rows);
  } catch (error) {
    res
      .status(500)
      .json({
        success: false,
        message: "Falha ao buscar cursos!",
        error: error.message,
      });
  }
};

/**
 * GET SINGLE — Obter um curso individual
 */
const GetsingleCourse = async (req, res) => {
  try {
    const { ID } = req.params;
    if (CacheKeys.parseId(ID) === null) {
      return res.status(400).json({ success: false, message: "ID inválido." });
    }
    const instituteCode = req.session.user.eduall_user_session_curentinstitute;

    const query = `
      SELECT * FROM eduall_courses
      WHERE ed_course_deleted = 0
        AND ed_course_id = ?
        AND ed_course_institute_code = ?
    `;
    const PARAMS = [ID, instituteCode];
    const rows = await ExecuteQuery(res, query, PARAMS, true, {
      db: "eduall_courses",
      type: "select",
      data: req,
    });

    if (!rows || rows.length === 0)
      return res
        .status(404)
        .json({ success: false, message: "Curso não encontrado." });

    res.status(200).json(rows);
  } catch (error) {
    res
      .status(500)
      .json({
        success: false,
        message: "Falha ao buscar curso!",
        error: error.message,
      });
  }
};

/* ===================== POST OPERATIONS (COM VALIDAÇÃO E CACHE REFRESH) ===================== */

/**
 * POST — Registar curso
 */
const RegisterCourse = async (req, res) => {
  try {
    const { course_title, course_category } = req.body;
    const instituteCode = req.session.user.eduall_user_session_curentinstitute;

    // Validações
    const errors = ValidateCourseFields(req.body);
    if (errors.length > 0)
      return res.status(422).json({ success: false, msg: errors.join(" "), errors });

    const courseTitleLowerCase = course_title.trim().toLowerCase();

    // Verificar duplicação (case-insensitive)
    const checkQuery = `
      SELECT ed_course_id FROM eduall_courses
      WHERE LOWER(TRIM(ed_course_title)) = LOWER(TRIM(?))
        AND ed_course_deleted = 0
        AND ed_course_institute_code = ?
    `;
    const checkParams = [courseTitleLowerCase, instituteCode];
    const existingCourse = await ExecuteQuery(res, checkQuery, checkParams, true, {
      db: "eduall_courses",
      type: "select",
      data: req,
    });

    if (existingCourse && existingCourse.length > 0) {
      return res.status(409).json({
        success: false,
        msg: "Já existe um curso com este nome.",
      });
    }

    const query = `
      INSERT INTO eduall_courses (
        ed_course_title,
        ed_course_category,
        ed_course_institute_code
      ) VALUES (?, ?, ?)
    `;
    const PARAMS = [course_title.trim(), course_category.trim(), instituteCode];

    const rows = await ExecuteQuery(res, query, PARAMS, false, {
      db: "eduall_courses",
      type: "insert",
      data: req,
    });

    await RegisterAuditAction({
      session: req.session,
      action: 1,
      form: "Cursos",
      description: `Registrou novo curso (${course_title.trim()}) da categoria ${course_category.trim()}`,
    });

    console.log(
      `🗄️🐢 BASE DE DADOS (lento) -> RegisterCourse: curso "${course_title.trim()}" registado`
    );
    await CacheKeys.safeInvalidate(() => [CacheKeys.course.list(instituteCode), CacheKeys.schoolClass.list(instituteCode), CacheKeys.schoolClass.exams(instituteCode)]);

    res.status(200).json({
      success: true,
      message: "Curso registado com sucesso!",
      data: rows,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      msg: "Falha ao registar curso!",
      error: error.message,
    });
  }
};

/* ===================== PUT OPERATIONS (COM VALIDAÇÃO E CACHE REFRESH) ===================== */

/**
 * PUT — Atualizar curso
 */
const CourseUpdate = async (req, res) => {
  try {
    const { ID } = req.params;
    const { course_title, course_category } = req.body;
    const instituteCode = req.session.user.eduall_user_session_curentinstitute;

    // Validações
    const errors = ValidateCourseFields(req.body);
    if (errors.length > 0)
      return res.status(422).json({ success: false, msg: errors.join(" "), errors });

    const courseTitleLowerCase = course_title.trim().toLowerCase();

    // Confirmar que o curso existe
    const checkExistQuery = `
      SELECT ed_course_id FROM eduall_courses
      WHERE ed_course_deleted = 0
        AND ed_course_id = ?
        AND ed_course_institute_code = ?
    `;
    const found = await ExecuteQuery(res, checkExistQuery, [ID, instituteCode], true, {
      db: "eduall_courses",
      type: "select",
      data: req,
    });

    if (!found || found.length === 0)
      return res
        .status(404)
        .json({
          success: false,
          msg: "Curso não encontrado ou já foi removido.",
        });

    // Verificar duplicação (excluindo o próprio curso)
    const checkQuery = `
      SELECT ed_course_id FROM eduall_courses
      WHERE LOWER(TRIM(ed_course_title)) = LOWER(TRIM(?))
        AND ed_course_deleted = 0
        AND ed_course_institute_code = ?
        AND ed_course_id != ?
    `;
    const checkParams = [courseTitleLowerCase, instituteCode, ID];
    const existingCourse = await ExecuteQuery(res, checkQuery, checkParams, true, {
      db: "eduall_courses",
      type: "select",
      data: req,
    });

    if (existingCourse && existingCourse.length > 0) {
      return res.status(409).json({
        success: false,
        msg: "Já existe outro curso com este nome.",
      });
    }

    const query = `
      UPDATE eduall_courses
      SET ed_course_title = ?, ed_course_category = ?
      WHERE ed_course_deleted = 0
        AND ed_course_id = ?
        AND ed_course_institute_code = ?
    `;
    const PARAMS = [course_title.trim(), course_category.trim(), ID, instituteCode];

    const rows = await ExecuteQuery(res, query, PARAMS, false, {
      db: "eduall_courses",
      type: "update",
      data: req,
    });

    await RegisterAuditAction({
      session: req.session,
      action: 2,
      form: "Cursos",
      description: `Atualizou curso (${course_title.trim()}) da categoria ${course_category.trim()} com ID ${ID}`,
    });

    console.log(`🗄️🐢 BASE DE DADOS (lento) -> CourseUpdate: curso ${ID} atualizado`);
    await CacheKeys.safeInvalidate(() => [CacheKeys.course.list(instituteCode), CacheKeys.schoolClass.list(instituteCode), CacheKeys.schoolClass.exams(instituteCode)]);

    res.status(200).json({
      success: true,
      message: "Curso atualizado com sucesso!",
      data: rows,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      msg: "Falha ao atualizar curso!",
      error: error.message,
    });
  }
};

/* ===================== DELETE OPERATIONS (COM CACHE REFRESH) ===================== */

/**
 * DELETE (soft-delete) — Eliminar curso
 */
const CourseDelete = async (req, res) => {
  try {
    const { ID } = req.params;
    const instituteCode = req.session.user.eduall_user_session_curentinstitute;

    // Confirmar existência antes de apagar
    const checkQuery = `
      SELECT ed_course_title FROM eduall_courses
      WHERE ed_course_deleted = 0
        AND ed_course_id = ?
        AND ed_course_institute_code = ?
    `;
    const found = await ExecuteQuery(res, checkQuery, [ID, instituteCode], true, {
      db: "eduall_courses",
      type: "select",
      data: req,
    });

    if (!found || found.length === 0)
      return res
        .status(404)
        .json({
          success: false,
          msg: "Curso não encontrado ou já foi removido.",
        });

    const courseTitle = found[0].ed_course_title;

    // Verificar se há classes associadas
    const checkClassesQuery = `
      SELECT COUNT(*) AS total FROM eduall_class
      WHERE ed_class_course = ?
        AND ed_class_institute_code = ?
        AND ed_class_deleted = 0
    `;
    const checkResult = await ExecuteQuery(
      res,
      checkClassesQuery,
      [ID, instituteCode],
      true,
      { db: "eduall_class", type: "select", data: req }
    );

    const classCount = checkResult[0]?.total || 0;

    if (classCount > 0) {
      return res.status(400).json({
        success: false,
        msg: `Não é possível eliminar. Existem ${classCount} turma(s) ainda associada(s) a este curso.`,
      });
    }

    // Soft delete
    const query = `
      UPDATE eduall_courses
      SET ed_course_deleted = 1
      WHERE ed_course_deleted = 0
        AND ed_course_id = ?
        AND ed_course_institute_code = ?
    `;
    const PARAMS = [ID, instituteCode];

    const rows = await ExecuteQuery(res, query, PARAMS, false, {
      db: "eduall_courses",
      type: "update",
      data: req,
    });

    await RegisterAuditAction({
      session: req.session,
      action: 3,
      form: "Cursos",
      description: `Eliminou curso "${courseTitle}" (ID: ${ID})`,
    });

    console.log(`🗄️🐢 BASE DE DADOS (lento) -> CourseDelete: curso ${ID} eliminado`);
    await CacheKeys.safeInvalidate(() => [CacheKeys.course.list(instituteCode), CacheKeys.schoolClass.list(instituteCode), CacheKeys.schoolClass.exams(instituteCode)]);

    res.status(200).json({
      success: true,
      message: "Curso eliminado com sucesso!",
      data: rows,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      msg: "Falha ao eliminar curso!",
      error: error.message,
    });
  }
};

module.exports = { GetCourse, GetsingleCourse, RegisterCourse, CourseDelete, CourseUpdate };