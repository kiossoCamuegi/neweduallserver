const ExecuteQuery = require("../Functions/ExecuteQuery");
const Cache = require("../Functions/CacheRoutes");
const { RegisterAuditAction } = require("./Auditory");

const CURRICULUM_CACHE_TTL = 3600;

const CacheKeys = {
  chapters: (classId, subjectId, instituteCode) => `curriculum:chapters:${classId}:${subjectId}:${instituteCode}`,
  chapter: (id, instituteCode) => `curriculum:chapter:${id}:${instituteCode}`,
  subchapters: (chapterId, instituteCode) => `curriculum:subchapters:${chapterId}:${instituteCode}`,
  subchapter: (id, instituteCode) => `curriculum:subchapter:${id}:${instituteCode}`,
  lessons: (chapterId, subchapterId, instituteCode) => `curriculum:lessons:${chapterId}:${subchapterId}:${instituteCode}`,
  lesson: (id, instituteCode) => `curriculum:lesson:${id}:${instituteCode}`,
  plan: (classId, subjectId, instituteCode) => `curriculum:plan:${classId}:${subjectId}:${instituteCode}`,
  all: () => "curriculum:*",
};

// ─── Helpers ──────────────────────────────────────────────────────────────────
const validateTitle = (title, fieldName) => {
  if (!title || title.trim() === "")
    return `${fieldName} é obrigatório.`;
  if (title.trim().length < 2)
    return `${fieldName} deve ter pelo menos 2 caracteres.`;
  return null;
};

// ─── Refrescar cache geral ─────────────────────────────────────────────────────
const RefreshCurriculumCache = async (req, res, instituteCode) => {
  const startTime = Date.now();

  await Cache.eduallClear(CacheKeys.all());
  console.log(`📦🧹 CACHE -> limpa para institute ${instituteCode}`);

  const duration = Date.now() - startTime;
  console.log(`🗄️🐢 BASE DE DADOS (lento) -> cache limpa em ${duration}ms para institute ${instituteCode}`);
};

/* ===================== CHAPTERS (CAPÍTULOS) ===================== */

/**
 * GET CHAPTERS BY CLASS AND SUBJECT
 */
const GetChapters = async (req, res) => {
  try {
    const { class_id, subject_id } = req.params;
    const instituteCode = req.session.user.eduall_user_session_curentinstitute;
    const cacheKey = CacheKeys.chapters(class_id, subject_id, instituteCode);
    const startTime = Date.now();

    const cached = await Cache.eduallGet(cacheKey);
    if (cached !== null) {
      const duration = Date.now() - startTime;
      console.log(`📦⚡ CACHE (rápido) -> GetChapters demorou ${duration}ms (${cacheKey})`);
      return res.status(200).json(cached);
    }

    const query = `
      SELECT * FROM eduall_curriculum_chapters
      WHERE deleted = 0
        AND class_id = ?
        AND subject_id = ?
        AND institute_code = ?
      ORDER BY order_index ASC
    `;
    const params = [class_id, subject_id, instituteCode];
    const rows = await ExecuteQuery(res, query, params, true, {
      db: "eduall_curriculum_chapters",
      type: "select",
      data: req,
    });

    await Cache.eduallSet(cacheKey, rows, CURRICULUM_CACHE_TTL);

    const duration = Date.now() - startTime;
    console.log(`🗄️🐢 BASE DE DADOS (lento) -> GetChapters demorou ${duration}ms (${cacheKey})`);

    res.status(200).json(rows);
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Erro ao buscar capítulos",
      error: error.message,
    });
  }
};

/**
 * CREATE CHAPTER
 */
const CreateChapter = async (req, res) => {
  try {
    const { class_id, subject_id, title, order_index } = req.body;
    const instituteCode = req.session.user.eduall_user_session_curentinstitute;

    // Validar
    const titleError = validateTitle(title, "Título do capítulo");
    if (titleError) return res.status(422).json({ success: false, msg: titleError });

    const chapterCode = `CHAPTER-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const query = `
      INSERT INTO eduall_curriculum_chapters (
        code, class_id, subject_id, title, order_index, institute_code
      ) VALUES (?, ?, ?, ?, ?, ?)
    `;
    const params = [chapterCode, class_id, subject_id, title.trim(), order_index || 0, instituteCode];
    const result = await ExecuteQuery(res, query, params, false, {
      db: "eduall_curriculum_chapters",
      type: "insert",
      data: req,
    });

    await RegisterAuditAction({
      session: req.session,
      action: 1,
      form: "Plano Curricular - Capítulo",
      description: `Criou capítulo "${title.trim()}" para turma ${class_id} e disciplina ${subject_id}`,
    });

    console.log(
      `🗄️🐢 BASE DE DADOS (lento) -> CreateChapter: capítulo "${title.trim()}" criado`
    );
    await RefreshCurriculumCache(req, res, instituteCode);

    res.status(201).json({ success: true, message: "Capítulo criado com sucesso!", data: result });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Erro ao criar capítulo",
      error: error.message,
    });
  }
};

/**
 * UPDATE CHAPTER
 */
const UpdateChapter = async (req, res) => {
  try {
    const { id } = req.params;
    const { title, order_index } = req.body;
    const instituteCode = req.session.user.eduall_user_session_curentinstitute;

    // Validar
    const titleError = validateTitle(title, "Título do capítulo");
    if (titleError) return res.status(422).json({ success: false, msg: titleError });

    // Confirmar existência
    const checkQuery = `SELECT id FROM eduall_curriculum_chapters WHERE id = ? AND institute_code = ? AND deleted = 0`;
    const found = await ExecuteQuery(res, checkQuery, [id, instituteCode], true, {
      db: "eduall_curriculum_chapters",
      type: "select",
      data: req,
    });
    if (!found || found.length === 0)
      return res.status(404).json({ success: false, msg: "Capítulo não encontrado." });

    const query = `
      UPDATE eduall_curriculum_chapters
      SET title = ?, order_index = ?
      WHERE id = ? AND institute_code = ?
    `;
    const params = [title.trim(), order_index || 0, id, instituteCode];
    const result = await ExecuteQuery(res, query, params, false, {
      db: "eduall_curriculum_chapters",
      type: "update",
      data: req,
    });

    await RegisterAuditAction({
      session: req.session,
      action: 2,
      form: "Plano Curricular - Capítulo",
      description: `Atualizou capítulo ID ${id} para "${title.trim()}"`,
    });

    console.log(`🗄️🐢 BASE DE DADOS (lento) -> UpdateChapter: capítulo ${id} atualizado`);
    await RefreshCurriculumCache(req, res, instituteCode);

    res.status(200).json({ success: true, message: "Capítulo atualizado com sucesso!", data: result });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Erro ao atualizar capítulo",
      error: error.message,
    });
  }
};

/**
 * DELETE CHAPTER
 */
const DeleteChapter = async (req, res) => {
  try {
    const { id } = req.params;
    const instituteCode = req.session.user.eduall_user_session_curentinstitute;

    // Confirmar existência
    const checkQuery = `SELECT id FROM eduall_curriculum_chapters WHERE id = ? AND institute_code = ? AND deleted = 0`;
    const found = await ExecuteQuery(res, checkQuery, [id, instituteCode], true, {
      db: "eduall_curriculum_chapters",
      type: "select",
      data: req,
    });
    if (!found || found.length === 0)
      return res.status(404).json({ success: false, msg: "Capítulo não encontrado ou já foi removido." });

    const query = `
      UPDATE eduall_curriculum_chapters
      SET deleted = 1
      WHERE id = ? AND institute_code = ?
    `;
    const params = [id, instituteCode];
    const result = await ExecuteQuery(res, query, params, false, {
      db: "eduall_curriculum_chapters",
      type: "update",
      data: req,
    });

    await RegisterAuditAction({
      session: req.session,
      action: 3,
      form: "Plano Curricular - Capítulo",
      description: `Excluiu capítulo ID ${id}`,
    });

    console.log(`🗄️🐢 BASE DE DADOS (lento) -> DeleteChapter: capítulo ${id} eliminado`);
    await RefreshCurriculumCache(req, res, instituteCode);

    res.status(200).json({ success: true, message: "Capítulo eliminado com sucesso!", data: result });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Erro ao excluir capítulo",
      error: error.message,
    });
  }
};

/* ===================== SUBCHAPTERS (SUBCAPÍTULOS) ===================== */

/**
 * CREATE SUBCHAPTER
 */
const CreateSubchapter = async (req, res) => {
  try {
    const { chapter_id, title, order_index } = req.body;
    const instituteCode = req.session.user.eduall_user_session_curentinstitute;

    // Validar
    const titleError = validateTitle(title, "Título do subcapítulo");
    if (titleError) return res.status(422).json({ success: false, msg: titleError });

    const subchapterCode = `SUBCHAPTER-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const query = `
      INSERT INTO eduall_curriculum_subchapters (
        code, chapter_id, title, order_index, institute_code
      ) VALUES (?, ?, ?, ?, ?)
    `;
    const params = [subchapterCode, chapter_id, title.trim(), order_index || 0, instituteCode];
    const result = await ExecuteQuery(res, query, params, false, {
      db: "eduall_curriculum_subchapters",
      type: "insert",
      data: req,
    });

    await RegisterAuditAction({
      session: req.session,
      action: 1,
      form: "Plano Curricular - Subcapítulo",
      description: `Criou subcapítulo "${title.trim()}" no capítulo ${chapter_id}`,
    });

    console.log(
      `🗄️🐢 BASE DE DADOS (lento) -> CreateSubchapter: subcapítulo "${title.trim()}" criado`
    );
    await RefreshCurriculumCache(req, res, instituteCode);

    res.status(201).json({ success: true, message: "Subcapítulo criado com sucesso!", data: result });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Erro ao criar subcapítulo",
      error: error.message,
    });
  }
};

/**
 * UPDATE SUBCHAPTER
 */
const UpdateSubchapter = async (req, res) => {
  try {
    const { id } = req.params;
    const { title, order_index } = req.body;
    const instituteCode = req.session.user.eduall_user_session_curentinstitute;

    // Validar
    const titleError = validateTitle(title, "Título do subcapítulo");
    if (titleError) return res.status(422).json({ success: false, msg: titleError });

    // Confirmar existência
    const checkQuery = `SELECT id FROM eduall_curriculum_subchapters WHERE id = ? AND institute_code = ? AND deleted = 0`;
    const found = await ExecuteQuery(res, checkQuery, [id, instituteCode], true, {
      db: "eduall_curriculum_subchapters",
      type: "select",
      data: req,
    });
    if (!found || found.length === 0)
      return res.status(404).json({ success: false, msg: "Subcapítulo não encontrado." });

    const query = `
      UPDATE eduall_curriculum_subchapters
      SET title = ?, order_index = ?
      WHERE id = ? AND institute_code = ?
    `;
    const params = [title.trim(), order_index || 0, id, instituteCode];
    const result = await ExecuteQuery(res, query, params, false, {
      db: "eduall_curriculum_subchapters",
      type: "update",
      data: req,
    });

    await RegisterAuditAction({
      session: req.session,
      action: 2,
      form: "Plano Curricular - Subcapítulo",
      description: `Atualizou subcapítulo ID ${id} para "${title.trim()}"`,
    });

    console.log(`🗄️🐢 BASE DE DADOS (lento) -> UpdateSubchapter: subcapítulo ${id} atualizado`);
    await RefreshCurriculumCache(req, res, instituteCode);

    res.status(200).json({ success: true, message: "Subcapítulo atualizado com sucesso!", data: result });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Erro ao atualizar subcapítulo",
      error: error.message,
    });
  }
};

/**
 * DELETE SUBCHAPTER
 */
const DeleteSubchapter = async (req, res) => {
  try {
    const { id } = req.params;
    const instituteCode = req.session.user.eduall_user_session_curentinstitute;

    // Confirmar existência
    const checkQuery = `SELECT id FROM eduall_curriculum_subchapters WHERE id = ? AND institute_code = ? AND deleted = 0`;
    const found = await ExecuteQuery(res, checkQuery, [id, instituteCode], true, {
      db: "eduall_curriculum_subchapters",
      type: "select",
      data: req,
    });
    if (!found || found.length === 0)
      return res.status(404).json({ success: false, msg: "Subcapítulo não encontrado ou já foi removido." });

    const query = `
      UPDATE eduall_curriculum_subchapters
      SET deleted = 1
      WHERE id = ? AND institute_code = ?
    `;
    const params = [id, instituteCode];
    const result = await ExecuteQuery(res, query, params, false, {
      db: "eduall_curriculum_subchapters",
      type: "update",
      data: req,
    });

    await RegisterAuditAction({
      session: req.session,
      action: 3,
      form: "Plano Curricular - Subcapítulo",
      description: `Excluiu subcapítulo ID ${id}`,
    });

    console.log(`🗄️🐢 BASE DE DADOS (lento) -> DeleteSubchapter: subcapítulo ${id} eliminado`);
    await RefreshCurriculumCache(req, res, instituteCode);

    res.status(200).json({ success: true, message: "Subcapítulo eliminado com sucesso!", data: result });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Erro ao excluir subcapítulo",
      error: error.message,
    });
  }
};

/* ===================== LESSONS (AULAS) ===================== */

/**
 * CREATE LESSON
 */
const CreateLesson = async (req, res) => {
  try {
    const {
      chapter_id,
      subchapter_id,
      title,
      description,
      video_url,
      file_url,
      type,
      order_index,
    } = req.body;
    const instituteCode = req.session.user.eduall_user_session_curentinstitute;

    // Validar
    const titleError = validateTitle(title, "Título da aula");
    if (titleError) return res.status(422).json({ success: false, msg: titleError });

    const lessonCode = `LESSON-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const query = `
      INSERT INTO eduall_curriculum_lessons (
        code,
        title,
        description,
        video_url,
        file_url,
        type,
        order_index,
        chapter_id,
        subchapter_id,
        institute_code
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;
    const params = [
      lessonCode,
      title.trim(),
      description ? description.trim() : null,
      video_url || null,
      file_url || null,
      type || "doc",
      order_index || 0,
      chapter_id || null,
      subchapter_id || null,
      instituteCode,
    ];

    const result = await ExecuteQuery(res, query, params, false, {
      db: "eduall_curriculum_lessons",
      type: "insert",
      data: req,
    });

    await RegisterAuditAction({
      session: req.session,
      action: 1,
      form: "Plano Curricular - Aula",
      description: `Criou aula "${title.trim()}" (${type || "doc"})`,
    });

    console.log(`🗄️🐢 BASE DE DADOS (lento) -> CreateLesson: aula "${title.trim()}" criada`);
    await RefreshCurriculumCache(req, res, instituteCode);

    res.status(201).json({ success: true, message: "Aula criada com sucesso!", data: result });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Erro ao criar aula",
      error: error.message,
    });
  }
};

/**
 * UPDATE LESSON
 */
const UpdateLesson = async (req, res) => {
  try {
    const { id } = req.params;
    const { title, description, video_url, file_url, type, order_index } = req.body;
    const instituteCode = req.session.user.eduall_user_session_curentinstitute;

    // Validar
    const titleError = validateTitle(title, "Título da aula");
    if (titleError) return res.status(422).json({ success: false, msg: titleError });

    // Confirmar existência
    const checkQuery = `SELECT id FROM eduall_curriculum_lessons WHERE id = ? AND institute_code = ? AND deleted = 0`;
    const found = await ExecuteQuery(res, checkQuery, [id, instituteCode], true, {
      db: "eduall_curriculum_lessons",
      type: "select",
      data: req,
    });
    if (!found || found.length === 0)
      return res.status(404).json({ success: false, msg: "Aula não encontrada." });

    const query = `
      UPDATE eduall_curriculum_lessons
      SET title = ?, description = ?, video_url = ?, file_url = ?, type = ?, order_index = ?
      WHERE id = ? AND institute_code = ?
    `;
    const params = [
      title.trim(),
      description ? description.trim() : null,
      video_url || null,
      file_url || null,
      type || "doc",
      order_index || 0,
      id,
      instituteCode,
    ];
    const result = await ExecuteQuery(res, query, params, false, {
      db: "eduall_curriculum_lessons",
      type: "update",
      data: req,
    });

    await RegisterAuditAction({
      session: req.session,
      action: 2,
      form: "Plano Curricular - Aula",
      description: `Atualizou aula ID ${id} para "${title.trim()}"`,
    });

    console.log(`🗄️🐢 BASE DE DADOS (lento) -> UpdateLesson: aula ${id} atualizada`);
    await RefreshCurriculumCache(req, res, instituteCode);

    res.status(200).json({ success: true, message: "Aula atualizada com sucesso!", data: result });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Erro ao atualizar aula",
      error: error.message,
    });
  }
};

/**
 * DELETE LESSON
 */
const DeleteLesson = async (req, res) => {
  try {
    const { id } = req.params;
    const instituteCode = req.session.user.eduall_user_session_curentinstitute;

    // Confirmar existência
    const checkQuery = `SELECT id FROM eduall_curriculum_lessons WHERE id = ? AND institute_code = ? AND deleted = 0`;
    const found = await ExecuteQuery(res, checkQuery, [id, instituteCode], true, {
      db: "eduall_curriculum_lessons",
      type: "select",
      data: req,
    });
    if (!found || found.length === 0)
      return res.status(404).json({ success: false, msg: "Aula não encontrada ou já foi removida." });

    const query = `
      UPDATE eduall_curriculum_lessons
      SET deleted = 1
      WHERE id = ? AND institute_code = ?
    `;
    const params = [id, instituteCode];
    const result = await ExecuteQuery(res, query, params, false, {
      db: "eduall_curriculum_lessons",
      type: "update",
      data: req,
    });

    await RegisterAuditAction({
      session: req.session,
      action: 3,
      form: "Plano Curricular - Aula",
      description: `Excluiu aula ID ${id}`,
    });

    console.log(`🗄️🐢 BASE DE DADOS (lento) -> DeleteLesson: aula ${id} eliminada`);
    await RefreshCurriculumCache(req, res, instituteCode);

    res.status(200).json({ success: true, message: "Aula eliminada com sucesso!", data: result });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Erro ao excluir aula",
      error: error.message,
    });
  }
};

/* ===================== HIERARCHICAL PLAN ===================== */

/**
 * GET COMPLETE CURRICULAR PLAN (Chapters > Subchapters > Lessons)
 */
const GetClassAndSubjectCurricularPlan = async (req, res) => {
  try {
    const { class_id, subject_id } = req.params;
    const instituteCode = req.session.user.eduall_user_session_curentinstitute;
    const cacheKey = CacheKeys.plan(class_id, subject_id, instituteCode);
    const startTime = Date.now();

    const cached = await Cache.eduallGet(cacheKey);
    if (cached !== null) {
      const duration = Date.now() - startTime;
      console.log(
        `📦⚡ CACHE (rápido) -> GetClassAndSubjectCurricularPlan demorou ${duration}ms (${cacheKey})`
      );
      return res.json(cached);
    }

    const rows = await ExecuteQuery(
      res,
      `
      SELECT
        c.id AS chapter_id, c.title AS chapter_title, c.order_index AS chapter_order,
        s.id AS subchapter_id, s.title AS subchapter_title, s.order_index AS subchapter_order,
        l.id AS lesson_id, l.title AS lesson_title, l.type AS lesson_type,
        l.subchapter_id IS NOT NULL AS is_sub_lesson
      FROM eduall_curriculum_chapters c
      LEFT JOIN eduall_curriculum_subchapters s
        ON s.chapter_id = c.id AND s.deleted = 0
      LEFT JOIN eduall_curriculum_lessons l
        ON l.deleted = 0
        AND (
          (l.chapter_id = c.id AND l.subchapter_id IS NULL) OR
          (l.subchapter_id = s.id)
        )
      WHERE
        c.class_id = ?
        AND c.subject_id = ?
        AND c.deleted = 0
        AND c.institute_code = ?
      ORDER BY c.order_index ASC, s.order_index ASC, l.order_index ASC
      `,
      [class_id, subject_id, instituteCode],
      true
    );

    let result = { chaptersOrder: [], chapters: {} };

    for (const row of rows) {
      const chapKey = `chap-${row.chapter_id}`;
      const subKey = row.subchapter_id ? `sub-${row.subchapter_id}` : null;

      if (!result.chapters[chapKey]) {
        result.chaptersOrder.push(chapKey);
        result.chapters[chapKey] = {
          id: chapKey,
          title: row.chapter_title,
          subchapters: {},
          lessons: [],
        };
      }

      if (subKey && !result.chapters[chapKey].subchapters[subKey]) {
        result.chapters[chapKey].subchapters[subKey] = {
          id: subKey,
          title: row.subchapter_title,
          lessons: [],
        };
      }

      if (row.lesson_id) {
        const lessonObj = {
          id: `lesson-${row.lesson_id}`,
          title: row.lesson_title,
          type: row.lesson_type,
        };

        if (subKey && row.is_sub_lesson) {
          result.chapters[chapKey].subchapters[subKey].lessons.push(lessonObj);
        } else if (!subKey) {
          result.chapters[chapKey].lessons.push(lessonObj);
        }
      }
    }

    await Cache.eduallSet(cacheKey, result, CURRICULUM_CACHE_TTL);

    const duration = Date.now() - startTime;
    console.log(
      `🗄️🐢 BASE DE DADOS (lento) -> GetClassAndSubjectCurricularPlan demorou ${duration}ms (${cacheKey})`
    );

    res.json(result);
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

module.exports = {
  GetChapters,
  CreateChapter,
  UpdateChapter,
  DeleteChapter,
  CreateSubchapter,
  UpdateSubchapter,
  DeleteSubchapter,
  CreateLesson,
  UpdateLesson,
  DeleteLesson,
  GetClassAndSubjectCurricularPlan,
};