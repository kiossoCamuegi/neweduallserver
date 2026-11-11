const ExecuteQuery = require("../Functions/ExecuteQuery");
const { RegisterAuditAction } = require("./Auditory");

// ─── MIGRATION SQL (run once to add new columns) ─────────────────────────────
// Run this SQL in your DB before using the new fields:
/*
ALTER TABLE eduall_student_exams
  ADD COLUMN IF NOT EXISTS ed_exam_period      VARCHAR(80)  DEFAULT NULL COMMENT 'Turno: Manhã, Tarde, Manhã/Tarde',
  ADD COLUMN IF NOT EXISTS ed_exam_group_label VARCHAR(120) DEFAULT NULL COMMENT 'Grupo/Público: Regulares, Adultos…',
  ADD COLUMN IF NOT EXISTS ed_exam_class_label VARCHAR(180) DEFAULT NULL COMMENT 'Etiqueta livre de classe ex: 7ª e 8ª Classe',
  ADD COLUMN IF NOT EXISTS ed_exam_trimestre   VARCHAR(60)  DEFAULT NULL COMMENT 'II TRIMESTRE / 2025',
  ADD COLUMN IF NOT EXISTS ed_exam_notes       TEXT         DEFAULT NULL COMMENT 'Observações do calendário';
*/

// ─────────────────────────────────────────────────────────────────────────────
// GET ALL — enriched with new fields
// ─────────────────────────────────────────────────────────────────────────────
const GetExamsCalendar = async (req, res) => {
  try {
    const query = `
      SELECT
        eduall_student_exams.*,
        eduall_subjects.ed_subject_title,
        eduall_class.ed_class_title,
        eduall_class.ed_class_code,
        eduall_class.ed_class_period,
        eduall_timing.ed_timing_hour_start,
        eduall_timing.ed_timing_minute_start,
        eduall_timing.ed_timing_hour_end,
        eduall_timing.ed_timing_minute_end
      FROM eduall_student_exams
      LEFT JOIN eduall_subjects ON eduall_student_exams.ed_student_exam_subject = eduall_subjects.ed_subject_id
      LEFT JOIN eduall_class    ON eduall_student_exams.ed_student_exam_class   = eduall_class.ed_class_id
      LEFT JOIN eduall_timing   ON eduall_timing.ed_timing_id = eduall_student_exams.ed_student_exam_time
      WHERE eduall_student_exams.ed_student_exam_deleted = 0
        AND eduall_student_exams.ed_student_exam_institute_code = ?
      ORDER BY eduall_student_exams.ed_student_exam_date ASC,
               eduall_timing.ed_timing_hour_start ASC,
               eduall_timing.ed_timing_minute_start ASC`;

    const rows = await ExecuteQuery(res, query,
      [req.session.user.eduall_user_session_curentinstitute], true,
      { db: "eduall_student_exams", type: "select", data: req });

    res.status(200).json(rows);
  } catch (error) {
    res.status(500).json({ success: false, message: "Erro ao buscar calendário.", error: error.message });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// GET BY CLASS
// ─────────────────────────────────────────────────────────────────────────────
const GetExamsCalendarByClass = async (req, res) => {
  try {
    const { CLASS } = req.params;
    const query = `
      SELECT eduall_student_exams.*, eduall_subjects.ed_subject_title,
             eduall_class.ed_class_title,
             eduall_timing.ed_timing_hour_start, eduall_timing.ed_timing_minute_start,
             eduall_timing.ed_timing_hour_end,   eduall_timing.ed_timing_minute_end
      FROM eduall_student_exams
      LEFT JOIN eduall_subjects ON eduall_student_exams.ed_student_exam_subject = eduall_subjects.ed_subject_id
      LEFT JOIN eduall_class    ON eduall_student_exams.ed_student_exam_class   = eduall_class.ed_class_id
      LEFT JOIN eduall_timing   ON eduall_timing.ed_timing_id = eduall_student_exams.ed_student_exam_time
      WHERE eduall_student_exams.ed_student_exam_deleted = 0
        AND eduall_student_exams.ed_student_exam_class = ?
      ORDER BY eduall_student_exams.ed_student_exam_date ASC`;

    const rows = await ExecuteQuery(res, query, [CLASS], true,
      { db: "eduall_student_exams", type: "select", data: req });
    res.status(200).json(rows);
  } catch (error) {
    res.status(500).json({ success: false, message: "Erro.", error: error.message });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// GET SINGLE
// ─────────────────────────────────────────────────────────────────────────────
const GetSingleExamCalendar = async (req, res) => {
  try {
    const { ID } = req.params;
    const query = `
      SELECT eduall_student_exams.*, eduall_subjects.ed_subject_title,
             eduall_class.ed_class_title,
             eduall_timing.ed_timing_hour_start, eduall_timing.ed_timing_minute_start,
             eduall_timing.ed_timing_hour_end,   eduall_timing.ed_timing_minute_end
      FROM eduall_student_exams
      LEFT JOIN eduall_subjects ON eduall_student_exams.ed_student_exam_subject = eduall_subjects.ed_subject_id
      LEFT JOIN eduall_class    ON eduall_student_exams.ed_student_exam_class   = eduall_class.ed_class_id
      LEFT JOIN eduall_timing   ON eduall_timing.ed_timing_id = eduall_student_exams.ed_student_exam_time
      WHERE eduall_student_exams.ed_student_exam_deleted = 0
        AND eduall_student_exams.ed_student_exam_id = ?`;

    const rows = await ExecuteQuery(res, query, [ID], true,
      { db: "eduall_student_exams", type: "select", data: req });
    res.status(200).json(rows);
  } catch (error) {
    res.status(500).json({ success: false, message: "Erro.", error: error.message });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// REGISTER — now includes new fields
// ─────────────────────────────────────────────────────────────────────────────
const RegisterStudentExamCalendar = async (req, res) => {
  try {
    const {
      exam_calendar_class,
      exam_calendar_subject,
      exam_calendar_date,
      exam_calendar_time,
      exam_period      = null,   // Manhã / Tarde / Manhã/Tarde
      exam_group_label = null,   // Regulares / Adultos
      exam_class_label = null,   // "7ª e 8ª Classe"
      exam_trimestre   = null,   // "II TRIMESTRE/2025"
      exam_notes       = null,   // Observações
    } = req.body;

    const query = `
      INSERT INTO eduall_student_exams
        (ed_student_exam_class, ed_student_exam_subject, ed_student_exam_date,
         ed_student_exam_time, ed_exam_period, ed_exam_group_label,
         ed_exam_class_label, ed_exam_trimestre, ed_exam_notes,
         ed_student_exam_institute_code)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

    const PARAMS = [
      exam_calendar_class, exam_calendar_subject, exam_calendar_date,
      exam_calendar_time || null,
      exam_period, exam_group_label, exam_class_label,
      exam_trimestre, exam_notes,
      req.session.user.eduall_user_session_curentinstitute,
    ];

    await ExecuteQuery(res, query, PARAMS, false,
      { db: "eduall_student_exams", type: "insert", data: req });

    await RegisterAuditAction({
      session: req.session, action: 1,
      form: "Calendário de Exame",
      description: `Registou prova de ${exam_calendar_subject} para turma ${exam_calendar_class} em ${exam_calendar_date}`,
    });

    res.status(200).json({ success: true, msg: "Prova registada com sucesso!" });
  } catch (error) {
    res.status(500).json({ success: false, message: "Erro ao registar.", error: error.message });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// UPDATE — includes new fields
// ─────────────────────────────────────────────────────────────────────────────
const UpdateStudentExamCalendar = async (req, res) => {
  try {
    const { ID } = req.params;
    const {
      exam_calendar_class, exam_calendar_subject,
      exam_calendar_date, exam_calendar_time,
      exam_period = null, exam_group_label = null,
      exam_class_label = null, exam_trimestre = null,
      exam_notes = null,
    } = req.body;

    const query = `
      UPDATE eduall_student_exams SET
        ed_student_exam_class   = ?,
        ed_student_exam_subject = ?,
        ed_student_exam_date    = ?,
        ed_student_exam_time    = ?,
        ed_exam_period          = ?,
        ed_exam_group_label     = ?,
        ed_exam_class_label     = ?,
        ed_exam_trimestre       = ?,
        ed_exam_notes           = ?
      WHERE ed_student_exam_deleted = 0
        AND ed_student_exam_id = ?`;

    await ExecuteQuery(res, query,
      [exam_calendar_class, exam_calendar_subject, exam_calendar_date,
       exam_calendar_time || null, exam_period, exam_group_label,
       exam_class_label, exam_trimestre, exam_notes, ID],
      false, { db: "eduall_student_exams", type: "update", data: req });

    await RegisterAuditAction({
      session: req.session, action: 2,
      form: "Calendário de Exame",
      description: `Actualizou prova ID ${ID}`,
    });

    res.status(200).json({ success: true, msg: "Prova actualizada!" });
  } catch (error) {
    res.status(500).json({ success: false, message: "Erro ao actualizar.", error: error.message });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// DELETE (soft)
// ─────────────────────────────────────────────────────────────────────────────
const DeleteStudentExamCalendar = async (req, res) => {
  try {
    const { ID } = req.params;
    await ExecuteQuery(res,
      `UPDATE eduall_student_exams SET ed_student_exam_deleted = 1
       WHERE ed_student_exam_deleted = 0 AND ed_student_exam_id = ?`,
      [ID], false, { db: "eduall_student_exams", type: "update", data: req });

    await RegisterAuditAction({
      session: req.session, action: 3,
      form: "Calendário de Exame",
      description: `Eliminou prova ID ${ID}`,
    });

    res.status(200).json({ success: true, msg: "Prova eliminada." });
  } catch (error) {
    res.status(500).json({ success: false, message: "Erro.", error: error.message });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// GET CALENDAR BLOCKS — groups exams by period+classLabel+groupLabel for the
// "Calendário de Prova do Professor" view (like the physical document)
// ─────────────────────────────────────────────────────────────────────────────
const GetCalendarBlocks = async (req, res) => {
  try {
    const query = `
      SELECT
        eduall_student_exams.*,
        eduall_subjects.ed_subject_title,
        eduall_class.ed_class_title,
        eduall_timing.ed_timing_hour_start,
        eduall_timing.ed_timing_minute_start,
        eduall_timing.ed_timing_hour_end,
        eduall_timing.ed_timing_minute_end
      FROM eduall_student_exams
      LEFT JOIN eduall_subjects ON eduall_student_exams.ed_student_exam_subject = eduall_subjects.ed_subject_id
      LEFT JOIN eduall_class    ON eduall_student_exams.ed_student_exam_class   = eduall_class.ed_class_id
      LEFT JOIN eduall_timing   ON eduall_timing.ed_timing_id = eduall_student_exams.ed_student_exam_time
      WHERE eduall_student_exams.ed_student_exam_deleted = 0
        AND eduall_student_exams.ed_student_exam_institute_code = ?
      ORDER BY
        FIELD(ed_exam_period, 'Manhã', 'Manhã/Tarde', 'Tarde', NULL),
        eduall_student_exams.ed_student_exam_date ASC,
        eduall_timing.ed_timing_hour_start ASC`;

    const rows = await ExecuteQuery(res, query,
      [req.session.user.eduall_user_session_curentinstitute], true,
      { db: "eduall_student_exams", type: "select", data: req });

    res.status(200).json(rows);
  } catch (error) {
    res.status(500).json({ success: false, message: "Erro.", error: error.message });
  }
};

module.exports = {
  GetExamsCalendar,
  GetExamsCalendarByClass,
  GetSingleExamCalendar,
  RegisterStudentExamCalendar,
  UpdateStudentExamCalendar,
  DeleteStudentExamCalendar,
  GetCalendarBlocks,
};