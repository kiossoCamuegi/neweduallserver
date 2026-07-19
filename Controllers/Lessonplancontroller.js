const { RegisterAuditAction } = require("./Auditory");
const ExecuteQuery = require("../Functions/ExecuteQuery");

 const GetLessonPlans = async (req, res) => {
  try {
    const { classId, subjectId } = req.params;

    const query = `
      SELECT 
        lp.*,
        CONCAT(cl.ed_class_title) AS ed_lesson_plan_class_name,
        sb.ed_subject_title AS ed_lesson_plan_subject_name
      FROM eduall_lesson_plans lp
      LEFT JOIN eduall_class cl 
        ON cl.ed_class_id = lp.ed_lesson_plan_class
      LEFT JOIN eduall_subjects sb 
        ON sb.ed_subject_id = lp.ed_lesson_plan_subject
      WHERE lp.ed_lesson_plan_deleted = 0
        AND lp.ed_lesson_plan_institute_code = ?
        AND lp.ed_lesson_plan_class = ?
        AND lp.ed_lesson_plan_subject = ?
      ORDER BY lp.ed_lesson_plan_date DESC, lp.ed_lesson_plan_created_at DESC
    `;

    const PARAMS = [
      req.session.user.eduall_user_session_curentinstitute,
      classId,
      subjectId,
    ];

    const rows = await ExecuteQuery(res, query, PARAMS, true, {
      db: "eduall_lesson_plans",
      type: "select",
      data: req,
    });

    res.status(200).json(rows);
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Falha ao buscar planos de aula!",
      error: error.message,
    });
  }
};

/* ══════════════════════════════════════════════
   GET ALL LESSON PLANS (ADMIN — all classes/subjects)
══════════════════════════════════════════════ */
const GetAllLessonPlansAdmin = async (req, res) => {
  try {
    const query = `
      SELECT 
        lp.*,
        CONCAT(cl.ed_class_title) AS ed_lesson_plan_class_name,
        sb.ed_subject_title AS ed_lesson_plan_subject_name
      FROM eduall_lesson_plans lp
      LEFT JOIN eduall_class cl 
        ON cl.ed_class_id = lp.ed_lesson_plan_class
      LEFT JOIN eduall_subjects sb 
        ON sb.ed_subject_id = lp.ed_lesson_plan_subject
      WHERE lp.ed_lesson_plan_deleted = 0
        AND lp.ed_lesson_plan_institute_code = ?
      ORDER BY lp.ed_lesson_plan_date DESC, lp.ed_lesson_plan_created_at DESC
    `;

    const PARAMS = [req.session.user.eduall_user_session_curentinstitute];

    const rows = await ExecuteQuery(res, query, PARAMS, true, {
      db: "eduall_lesson_plans",
      type: "select",
      data: req,
    });

    res.status(200).json(rows);
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Falha ao buscar todos os planos de aula!",
      error: error.message,
    });
  }
};

/* ══════════════════════════════════════════════
   GET SINGLE LESSON PLAN
══════════════════════════════════════════════ */
const GetSingleLessonPlan = async (req, res) => {
  try {
    const { ID } = req.params;

    const query = `
      SELECT 
        lp.*,
        CONCAT(cl.ed_class_title) AS ed_lesson_plan_class_name,
        sb.ed_subject_title AS ed_lesson_plan_subject_name
      FROM eduall_lesson_plans lp
      LEFT JOIN eduall_class cl 
        ON cl.ed_class_id = lp.ed_lesson_plan_class
      LEFT JOIN eduall_subjects sb 
        ON sb.ed_subject_id = lp.ed_lesson_plan_subject
      WHERE lp.ed_lesson_plan_deleted = 0
        AND lp.ed_lesson_plan_id = ?
        AND lp.ed_lesson_plan_institute_code = ?
    `;

    const PARAMS = [ID, req.session.user.eduall_user_session_curentinstitute];

    const rows = await ExecuteQuery(res, query, PARAMS, true, {
      db: "eduall_lesson_plans",
      type: "select",
      data: req,
    });

    res.status(200).json(rows);
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Falha ao buscar plano de aula!",
      error: error.message,
    });
  }
};

/* ══════════════════════════════════════════════
   REGISTER LESSON PLAN
══════════════════════════════════════════════ */
const RegisterLessonPlan = async (req, res) => {
  try {
    const {
      ed_lesson_plan_class,
      ed_lesson_plan_subject,
      ed_lesson_plan_teacher_name,
      ed_lesson_plan_date,
      ed_lesson_plan_duration,
      ed_lesson_plan_summary,
      ed_lesson_plan_unit,
      ed_lesson_plan_entry_profile,
      ed_lesson_plan_exit_profile,
      ed_lesson_plan_teaching_resources,
      ed_lesson_plan_methods,
      ed_lesson_plan_objectives_general,
      ed_lesson_plan_objectives_specific,
      ed_lesson_plan_introduction,
      ed_lesson_plan_development,
      ed_lesson_plan_consolidation,
      ed_lesson_plan_evaluation,
      ed_lesson_plan_task,
    } = req.body;

    const query = `
      INSERT INTO eduall_lesson_plans (
        ed_lesson_plan_class,
        ed_lesson_plan_subject,
        ed_lesson_plan_teacher_name,
        ed_lesson_plan_date,
        ed_lesson_plan_duration,
        ed_lesson_plan_summary,
        ed_lesson_plan_unit,
        ed_lesson_plan_entry_profile,
        ed_lesson_plan_exit_profile,
        ed_lesson_plan_teaching_resources,
        ed_lesson_plan_methods,
        ed_lesson_plan_objectives_general,
        ed_lesson_plan_objectives_specific,
        ed_lesson_plan_introduction,
        ed_lesson_plan_development,
        ed_lesson_plan_consolidation,
        ed_lesson_plan_evaluation,
        ed_lesson_plan_task,
        ed_lesson_plan_institute_code,
        ed_lesson_plan_created_by
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    const PARAMS = [
      ed_lesson_plan_class,
      ed_lesson_plan_subject,
      ed_lesson_plan_teacher_name,
      ed_lesson_plan_date || null,
      ed_lesson_plan_duration,
      ed_lesson_plan_summary,
      ed_lesson_plan_unit,
      ed_lesson_plan_entry_profile,
      ed_lesson_plan_exit_profile,
      ed_lesson_plan_teaching_resources,
      ed_lesson_plan_methods,
      ed_lesson_plan_objectives_general,
      ed_lesson_plan_objectives_specific,
      ed_lesson_plan_introduction,
      ed_lesson_plan_development,
      ed_lesson_plan_consolidation,
      ed_lesson_plan_evaluation,
      ed_lesson_plan_task,
      req.session.user.eduall_user_session_curentinstitute,
      req.session.user.eduall_user_session_ID,
    ];

    const rows = await ExecuteQuery(res, query, PARAMS, false, {
      db: "eduall_lesson_plans",
      type: "insert",
      data: req,
    });

    await RegisterAuditAction({
      session: req.session,
      action: 1,
      form: "Plano de Aula",
      description: `Registou um plano de aula para a turma ID ${ed_lesson_plan_class} / disciplina ID ${ed_lesson_plan_subject}`,
    });

    res.status(200).json(rows);
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Falha ao registar plano de aula!",
      error: error.message,
    });
  }
};

/* ══════════════════════════════════════════════
   UPDATE LESSON PLAN
══════════════════════════════════════════════ */
const UpdateLessonPlan = async (req, res) => {
  try {
    const { ID } = req.params;
    const {
      ed_lesson_plan_teacher_name,
      ed_lesson_plan_date,
      ed_lesson_plan_duration,
      ed_lesson_plan_summary,
      ed_lesson_plan_unit,
      ed_lesson_plan_entry_profile,
      ed_lesson_plan_exit_profile,
      ed_lesson_plan_teaching_resources,
      ed_lesson_plan_methods,
      ed_lesson_plan_objectives_general,
      ed_lesson_plan_objectives_specific,
      ed_lesson_plan_introduction,
      ed_lesson_plan_development,
      ed_lesson_plan_consolidation,
      ed_lesson_plan_evaluation,
      ed_lesson_plan_task,
    } = req.body;

    const query = `
      UPDATE eduall_lesson_plans SET
        ed_lesson_plan_teacher_name         = ?,
        ed_lesson_plan_date                 = ?,
        ed_lesson_plan_duration             = ?,
        ed_lesson_plan_summary              = ?,
        ed_lesson_plan_unit                 = ?,
        ed_lesson_plan_entry_profile        = ?,
        ed_lesson_plan_exit_profile         = ?,
        ed_lesson_plan_teaching_resources   = ?,
        ed_lesson_plan_methods              = ?,
        ed_lesson_plan_objectives_general   = ?,
        ed_lesson_plan_objectives_specific  = ?,
        ed_lesson_plan_introduction         = ?,
        ed_lesson_plan_development          = ?,
        ed_lesson_plan_consolidation        = ?,
        ed_lesson_plan_evaluation           = ?,
        ed_lesson_plan_task                 = ?,
        ed_lesson_plan_updated_at           = NOW()
      WHERE ed_lesson_plan_deleted = 0
        AND ed_lesson_plan_id = ?
        AND ed_lesson_plan_institute_code = ?
    `;

    const PARAMS = [
      ed_lesson_plan_teacher_name,
      ed_lesson_plan_date || null,
      ed_lesson_plan_duration,
      ed_lesson_plan_summary,
      ed_lesson_plan_unit,
      ed_lesson_plan_entry_profile,
      ed_lesson_plan_exit_profile,
      ed_lesson_plan_teaching_resources,
      ed_lesson_plan_methods,
      ed_lesson_plan_objectives_general,
      ed_lesson_plan_objectives_specific,
      ed_lesson_plan_introduction,
      ed_lesson_plan_development,
      ed_lesson_plan_consolidation,
      ed_lesson_plan_evaluation,
      ed_lesson_plan_task,
      ID,
      req.session.user.eduall_user_session_curentinstitute,
    ];

    const rows = await ExecuteQuery(res, query, PARAMS, false, {
      db: "eduall_lesson_plans",
      type: "update",
      data: req,
    });

    await RegisterAuditAction({
      session: req.session,
      action: 2,
      form: "Plano de Aula",
      description: `Actualizou o plano de aula ID "${ID}"`,
    });

    res.status(200).json(rows);
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Falha ao actualizar plano de aula!",
      error: error.message,
    });
  }
};

/* ══════════════════════════════════════════════
   ADD/UPDATE SCHOOL NOTES (Anotações da Escola)
══════════════════════════════════════════════ */
const UpdateSchoolNotes = async (req, res) => {
  try {
    const { ID } = req.params;
    const { ed_lesson_plan_school_notes } = req.body;

    const query = `
      UPDATE eduall_lesson_plans SET
        ed_lesson_plan_school_notes = ?,
        ed_lesson_plan_updated_at   = NOW()
      WHERE ed_lesson_plan_deleted = 0
        AND ed_lesson_plan_id = ?
        AND ed_lesson_plan_institute_code = ?
    `;

    const PARAMS = [
      ed_lesson_plan_school_notes,
      ID,
      req.session.user.eduall_user_session_curentinstitute,
    ];

    const rows = await ExecuteQuery(res, query, PARAMS, false, {
      db: "eduall_lesson_plans",
      type: "update",
      data: req,
    });

    await RegisterAuditAction({
      session: req.session,
      action: 2,
      form: "Plano de Aula",
      description: `Adicionou anotação escolar ao plano de aula ID "${ID}"`,
    });

    res.status(200).json(rows);
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Falha ao guardar anotação!",
      error: error.message,
    });
  }
};

/* ══════════════════════════════════════════════
   DELETE LESSON PLAN (soft delete)
══════════════════════════════════════════════ */
const DeleteLessonPlan = async (req, res) => {
  try {
    const { ID } = req.params;

    const query = `
      UPDATE eduall_lesson_plans 
      SET ed_lesson_plan_deleted = 1,
          ed_lesson_plan_updated_at = NOW()
      WHERE ed_lesson_plan_deleted = 0
        AND ed_lesson_plan_id = ?
        AND ed_lesson_plan_institute_code = ?
    `;

    const PARAMS = [ID, req.session.user.eduall_user_session_curentinstitute];

    const rows = await ExecuteQuery(res, query, PARAMS, false, {
      db: "eduall_lesson_plans",
      type: "update",
      data: req,
    });

    await RegisterAuditAction({
      session: req.session,
      action: 3,
      form: "Plano de Aula",
      description: `Eliminou o plano de aula com ID "${ID}"`,
    });

    res.status(200).json(rows);
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Falha ao eliminar plano de aula!",
      error: error.message,
    });
  }
};

module.exports = {
  GetLessonPlans,
  GetAllLessonPlansAdmin,
  GetSingleLessonPlan,
  RegisterLessonPlan,
  UpdateLessonPlan,
  UpdateSchoolNotes,
  DeleteLessonPlan,
};
 