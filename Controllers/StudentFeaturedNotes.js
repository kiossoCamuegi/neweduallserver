const ExecuteQuery = require("../Functions/ExecuteQuery");
const { RegisterAuditAction } = require("./Auditory");
const { CheckSpecialExamPermission } = require("./NotesRestrictions");

const GetsingleStudentFeaturedNotebYSubStCls = async (req, res) => {
   try {
     const { SUBJECT, STUDENT, CLASS } = req.params;
     const query = `SELECT * FROM eduall_student_featured_notes   
       LEFT JOIN eduall_class ON eduall_class.ed_class_id = eduall_student_featured_notes.ed_student_featured_note_class
       LEFT JOIN eduall_academic_level ON eduall_academic_level.ed_academic_level_id = eduall_class.ed_class_academic_level 
       WHERE ed_student_featured_note_subject = ? 
       AND ed_student_featured_note_studentCode = ? 
       AND ed_student_featured_note_class = ? 
       AND ed_student_featured_note_deleted = 0 
       AND ed_student_featured_note_institute_code = ?`;
     const PARAMS = [SUBJECT, STUDENT, CLASS, req.session.user.eduall_user_session_curentinstitute];
     const rows = await ExecuteQuery(res, query, PARAMS, true, { db: "eduall_student_featured_notes", type: "select", data: req });
     res.status(200).json(rows);
   } catch (error) {
     return res.status(500).json({ success: false, error: error.message });
   }
};

const RegisterStudentFeaturedNotes = async (req, res) => {
  try {
    const { allowed } = await CheckSpecialExamPermission(req, res);
    if (!allowed) {
      return res.status(403).json({
        success: false,
        msg: "Ação não permitida devido à restrição pedagógica!"
      });
    }

    const classId = req.body.student_featured_class;
    const instituteCode = req.session.user.eduall_user_session_curentinstitute;

    // 1. Buscar o nível acadêmico da turma
    const classQuery = `
      SELECT ed_class_academic_level 
      FROM eduall_class 
      WHERE ed_class_deleted = 0 
        AND ed_class_id = ? 
        AND ed_class_institute_code = ?
      LIMIT 1
    `;
    const classResult = await ExecuteQuery(res, classQuery, [classId, instituteCode], true);

    if (!classResult || classResult.length === 0) {
      return res.status(404).json({ success: false, msg: "Turma não encontrada ou inválida!" });
    }

    const academicLevelId = classResult[0].ed_class_academic_level;

    // 2. Verificar se o nível permite notas de recurso
    const levelQuery = `
      SELECT ed_academic_level_forFt 
      FROM eduall_academic_level 
      WHERE ed_academic_level_deleted = 0 
        AND ed_academic_level_id = ? 
        AND ed_academic_level_institute_code = ?
      LIMIT 1
    `;
    const levelResult = await ExecuteQuery(res, levelQuery, [academicLevelId, instituteCode], true);

    if (!levelResult || levelResult.length === 0) {
      return res.status(404).json({ success: false, msg: "Nível acadêmico da turma inválido!" });
    }

    if (levelResult[0].ed_academic_level_forFt !== 1) {
      return res.status(403).json({ success: false, msg: "Turma não permite lançamento de notas de recurso!" });
    }

    // 3. Verificar se a nota de recurso já foi registrada
    const checkExistingQuery = `
      SELECT 1 
      FROM eduall_student_featured_notes 
      WHERE ed_student_featured_note_studentCode = ? 
        AND ed_student_featured_note_class = ? 
        AND ed_student_featured_note_subject = ? 
        AND ed_student_featured_note_institute_code = ?
      LIMIT 1
    `;
    const existingNote = await ExecuteQuery(res, checkExistingQuery, [
      req.body.student_featured_code,
      req.body.student_featured_class,
      req.body.student_featured_subject,
      instituteCode
    ], true);

    if (existingNote && existingNote.length > 0) {
      return res.status(409).json({
        success: false,
        msg: "A nota de recurso já foi registrada para este aluno, disciplina e turma!"
      });
    }

    // 4. Registrar nota de recurso
    const insertQuery = `
      INSERT INTO eduall_student_featured_notes (
        ed_student_featured_note_studentCode, 
        ed_student_featured_note_class, 
        ed_student_featured_note_subject, 
        ed_student_featured_note_score, 
        ed_student_featured_note_institute_code
      ) VALUES (?, ?, ?, ?, ?)
    `;
    const PARAMS = [
      req.body.student_featured_code, 
      req.body.student_featured_class, 
      req.body.student_featured_subject, 
      req.body.student_featured_score, 
      instituteCode
    ];
    await ExecuteQuery(res, insertQuery, PARAMS, false, {
      db: "eduall_student_featured_notes",
      type: "insert",
      data: req
    });

    await RegisterAuditAction({
      session: req.session,
      action: 1,
      form: "Notas de Recurso",
      description: `Registrou uma nova nota de recurso para o aluno com o nº de matrícula #${req.body.student_featured_code}`,
    });

    res.status(200).json({
      success: true,
      msg: "Notas de recurso registradas com sucesso!"
    });

  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
};

const UpdateStudentFeaturedNotes = async (req, res) => {
  try {
    const { allowed } = await CheckSpecialExamPermission(req, res);
    if (!allowed) {
      return res.status(403).json({ success: false, msg: "Ação não permitida devido à restrição pedagógica!" });
    }

    const { ID } = req.params;
    const classId = req.body.student_featured_class;
    const instituteCode = req.session.user.eduall_user_session_curentinstitute;

    // 1. Buscar o nível acadêmico da turma
    const classQuery = `
      SELECT ed_class_academic_level 
      FROM eduall_class 
      WHERE ed_class_deleted = 0 
        AND ed_class_id = ? 
        AND ed_class_institute_code = ?
      LIMIT 1
    `;
    const classResult = await ExecuteQuery(res, classQuery, [classId, instituteCode], true);

    if (!classResult || classResult.length === 0) {
      return res.status(404).json({ success: false, msg: "Turma não encontrada ou inválida!" });
    }

    const academicLevelId = classResult[0].ed_class_academic_level;

    // 2. Verificar se o nível permite notas de recurso
    const levelQuery = `
      SELECT ed_academic_level_forFt 
      FROM eduall_academic_level 
      WHERE ed_academic_level_deleted = 0 
        AND ed_academic_level_id = ? 
        AND ed_academic_level_institute_code = ?
      LIMIT 1
    `;
    const levelResult = await ExecuteQuery(res, levelQuery, [academicLevelId, instituteCode], true);

    if (!levelResult || levelResult.length === 0) {
      return res.status(404).json({ success: false, msg: "Nível acadêmico da turma inválido!" });
    }

    if (levelResult[0].ed_academic_level_forFt !== 1) {
      return res.status(403).json({ success: false, msg: "Turma não permite atualização de notas de recurso!" });
    }

    // 3. Atualizar nota de recurso
    const updateQuery = `
      UPDATE eduall_student_featured_notes 
      SET ed_student_featured_note_studentCode = ?, 
          ed_student_featured_note_class = ?, 
          ed_student_featured_note_subject = ?, 
          ed_student_featured_note_score = ? 
      WHERE ed_student_featured_note_deleted = 0 
        AND ed_student_featured_note_id = ?
    `;
    const PARAMS = [
      req.body.student_featured_code, 
      req.body.student_featured_class, 
      req.body.student_featured_subject, 
      req.body.student_featured_score, 
      ID
    ];
    await ExecuteQuery(res, updateQuery, PARAMS, false, { db: "eduall_student_featured_notes", type: "update", data: req });

    await RegisterAuditAction({
      session: req.session,
      action: 2,
      form: "Notas de Recurso",
      description: `Atualizou a nota de recurso do aluno ${req.body.student_featured_code} na disciplina ${req.body.student_featured_subject} com a nova nota ${req.body.student_featured_score}`,
    });

    res.status(200).json({ success: true, msg: "Notas de recurso atualizadas com sucesso!" });

  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
}; 


const DeleteStudentFeaturedNotes = async (req, res) => {
   try {
    const { allowed } = await CheckSpecialExamPermission(req, res);
    if (!allowed) {return res.status(403).json({ success: false, msg: "Ação não permitida devido a restrição  pedagógica !"});}
    
     const { ID } = req.params;
     const query = `UPDATE eduall_student_featured_notes SET ed_student_featured_note_deleted = 1 
                    WHERE ed_student_featured_note_id = ? AND ed_student_featured_note_deleted = 0`;
     const PARAMS = [ID];
     await ExecuteQuery(res, query, PARAMS, false, { db: "eduall_student_featured_notes", type: "update", data: req });

     await RegisterAuditAction({
       session: req.session,
       action: 3,  // Ação de exclusão
       form: "Notas de Recurso",
       description: `Eliminou a nota de recurso com ID ${ID}`,
     });

     res.status(200).json({ success: true, msg: "Nota de recurso eliminada com sucesso!" });
   } catch (error) {
     return res.status(500).json({ success: false, error: error.message });
   }
};

module.exports = { 
  GetsingleStudentFeaturedNotebYSubStCls, 
  RegisterStudentFeaturedNotes, 
  UpdateStudentFeaturedNotes, 
  DeleteStudentFeaturedNotes 
};

  