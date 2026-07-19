const ExecuteQuery = require("../Functions/ExecuteQuery");
const { RegisterAuditAction } = require("./Auditory");
const { CheckExamPermission, CheckSpecialExamPermission } = require("./NotesRestrictions");

const GetsingleStudentExamNotebYSubStCls = async (req, res) => {
    try {
        const { SUBJECT, STUDENT, CLASS } = req.params;
        const INSTITUTE_CODE = req.session.user.eduall_user_session_curentinstitute;
    
        const query = `
            SELECT * FROM eduall_student_exam_notes        
            LEFT JOIN eduall_class ON eduall_class.ed_class_id = ?
            LEFT JOIN eduall_academic_level ON eduall_academic_level.ed_academic_level_id = eduall_class.ed_class_academic_level
            WHERE ed_student_exam_subject = ? 
            AND ed_student_exam_studentCode = ? 
            AND ed_student_exam_class = ? 
            AND ed_student_exam_deleted = 0 
            AND ed_student_exam_institute_code = ?
        `;
        const PARAMS = [CLASS, SUBJECT, STUDENT, CLASS, INSTITUTE_CODE];
        let rows = await ExecuteQuery(res, query, PARAMS, true, { db: "eduall_student_exam_notes", type: "select", data: req });

    
        res.status(200).json(rows);
    } catch (error) {
        res.status(500).json({ success: false, message: "Erro ao buscar nota do exame!", error: error.message });
    }
    
};

 


 
/**
 * GET /eduallgetstudentexamscorebyclasssubject/:CLASS,:SUBJECT
 * Lista todas as notas de exame de uma turma + disciplina (bulk).
 * Inclui JOIN com alunos para devolver nome, foto e código de matrícula.
 */
const GetAllStudentExamNotesByClassSubject = async (req, res) => {
  try {
    const { CLASS, SUBJECT } = req.params;
    const instituteCode = req.session.user.eduall_user_session_curentinstitute;

    const query = `
      SELECT
        esn.ed_student_exam_note_id,
        esn.ed_student_exam_note_studentCode,
        esn.ed_student_exam_note_class,
        esn.ed_student_exam_note_subject,
        esn.ed_student_exam_note_score,
        esn.ed_student_exam_note_institute_code,
        s.ed_student_id,
        s.ed_student_name,
        s.ed_student_code,
        s.ed_student_picture,
        c.ed_class_id,
        c.ed_class_name,
        al.ed_academic_level_avaliationtype_endat AS max_value
      FROM eduall_student_exam_notes esn
      LEFT JOIN eduall_student        s  ON s.ed_student_id              = esn.ed_student_exam_note_studentCode
      LEFT JOIN eduall_class          c  ON c.ed_class_id                = esn.ed_student_exam_note_class
      LEFT JOIN eduall_academic_level al ON al.ed_academic_level_id      = c.ed_class_academic_level
      WHERE esn.ed_student_exam_note_class            = ?
        AND esn.ed_student_exam_note_subject          = ?
        AND esn.ed_student_exam_note_deleted          = 0
        AND esn.ed_student_exam_note_institute_code   = ?
      ORDER BY s.ed_student_name ASC
    `;

    const rows = await ExecuteQuery(
      res, query,
      [CLASS, SUBJECT, instituteCode],
      true,
      { db: "eduall_student_exam_notes", type: "select", data: req }
    );

    return res.status(200).json(rows);
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * GET /eduallgetstudentexamscorebyclasssubjectwithstudents/:CLASS,:SUBJECT
 * Devolve TODOS os alunos da turma com a nota de exame (null se ainda não registada).
 * Ideal para pré-popular a tabela de lançamento em bulk.
 */
const GetAllStudentsWithExamNoteByClassSubject = async (req, res) => {
  try {
    const { CLASS, SUBJECT } = req.params;
    const instituteCode = req.session.user.eduall_user_session_curentinstitute;

    const query = `
      SELECT
        s.ed_student_id,
        s.ed_student_name,
        s.ed_student_code,
        s.ed_student_picture,
        esn.ed_student_exam_note_id,
        esn.ed_student_exam_note_score,
        al.ed_academic_level_avaliationtype_endat AS max_value,
        c.ed_class_name
      FROM eduall_student s
      LEFT JOIN eduall_student_class_enrollment e
             ON e.ed_enrollment_student = s.ed_student_id
            AND e.ed_enrollment_class   = ?
            AND e.ed_enrollment_deleted = 0
      LEFT JOIN eduall_class c
             ON c.ed_class_id           = ?
      LEFT JOIN eduall_academic_level al
             ON al.ed_academic_level_id = c.ed_class_academic_level
      LEFT JOIN eduall_student_exam_notes esn
             ON esn.ed_student_exam_note_studentCode  = s.ed_student_id
            AND esn.ed_student_exam_note_class        = ?
            AND esn.ed_student_exam_note_subject      = ?
            AND esn.ed_student_exam_note_deleted      = 0
            AND esn.ed_student_exam_note_institute_code = ?
      WHERE s.ed_student_deleted        = 0
        AND s.ed_student_institute_code = ?
        AND e.ed_enrollment_class IS NOT NULL
      ORDER BY s.ed_student_name ASC
    `;

    const rows = await ExecuteQuery(
      res, query,
      [CLASS, CLASS, CLASS, SUBJECT, instituteCode, instituteCode],
      true,
      { db: "eduall_student_exam_notes", type: "select", data: req }
    );

    return res.status(200).json(rows);
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * POST /eduallstudentexamscoreregister/post
 * Regista uma nota de exame (individual).
 */
const RegisterStudentExamNotes = async (req, res) => {
  try {
    const { allowed } = await CheckSpecialExamPermission(req, res);
    if (!allowed) {
      return res.status(403).json({
        success: false,
        msg: "Ação não permitida devido à restrição pedagógica!"
      });
    }

    const instituteCode = req.session.user.eduall_user_session_curentinstitute;

    // Verificar duplicado
    const checkQuery = `
      SELECT 1 FROM eduall_student_exam_notes
      WHERE ed_student_exam_note_studentCode  = ?
        AND ed_student_exam_note_class        = ?
        AND ed_student_exam_note_subject      = ?
        AND ed_student_exam_note_institute_code = ?
      LIMIT 1
    `;
    const existing = await ExecuteQuery(res, checkQuery, [
      req.body.student_exam_code,
      req.body.student_exam_class,
      req.body.student_exam_subject,
      instituteCode
    ], true);

    if (existing && existing.length > 0) {
      return res.status(409).json({
        success: false,
        msg: "Nota de exame já registada para este aluno, disciplina e turma!"
      });
    }

    const insertQuery = `
      INSERT INTO eduall_student_exam_notes (
        ed_student_exam_note_studentCode,
        ed_student_exam_note_class,
        ed_student_exam_note_subject,
        ed_student_exam_note_score,
        ed_student_exam_note_institute_code
      ) VALUES (?, ?, ?, ?, ?)
    `;
    await ExecuteQuery(res, insertQuery, [
      req.body.student_exam_code,
      req.body.student_exam_class,
      req.body.student_exam_subject,
      req.body.student_exam_score,
      instituteCode
    ], false, { db: "eduall_student_exam_notes", type: "insert", data: req });

    await RegisterAuditAction({
      session: req.session,
      action: 1,
      form: "Notas de Exame",
      description: `Registou nota de exame para o aluno #${req.body.student_exam_code}`,
    });

    return res.status(200).json({ success: true, msg: "Nota de exame registada com sucesso!" });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * PUT /eduallstudentexamscoreupdate/update/:ID
 * Atualiza uma nota de exame.
 */
const UpdateStudentExamNotes = async (req, res) => {
  try {
    const { allowed } = await CheckSpecialExamPermission(req, res);
    if (!allowed) {
      return res.status(403).json({ success: false, msg: "Ação não permitida devido à restrição pedagógica!" });
    }

    const { ID } = req.params;

    const updateQuery = `
      UPDATE eduall_student_exam_notes
      SET ed_student_exam_note_studentCode = ?,
          ed_student_exam_note_class       = ?,
          ed_student_exam_note_subject     = ?,
          ed_student_exam_note_score       = ?
      WHERE ed_student_exam_note_deleted = 0
        AND ed_student_exam_note_id      = ?
    `;
    await ExecuteQuery(res, updateQuery, [
      req.body.student_exam_code,
      req.body.student_exam_class,
      req.body.student_exam_subject,
      req.body.student_exam_score,
      ID
    ], false, { db: "eduall_student_exam_notes", type: "update", data: req });

    await RegisterAuditAction({
      session: req.session,
      action: 2,
      form: "Notas de Exame",
      description: `Atualizou nota de exame do aluno #${req.body.student_exam_code} → ${req.body.student_exam_score}`,
    });

    return res.status(200).json({ success: true, msg: "Nota de exame atualizada com sucesso!" });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * PUT /eduallstudentexamscoredelete/delete/:ID
 * Soft-delete de uma nota de exame.
 */
const DeleteStudentExamNotes = async (req, res) => {
  try {
    const { ID } = req.params;

    const deleteQuery = `
      UPDATE eduall_student_exam_notes
      SET ed_student_exam_note_deleted = 1
      WHERE ed_student_exam_note_id = ?
    `;
    await ExecuteQuery(res, deleteQuery, [ID], false, {
      db: "eduall_student_exam_notes", type: "delete", data: req
    });

    await RegisterAuditAction({
      session: req.session,
      action: 3,
      form: "Notas de Exame",
      description: `Eliminou nota de exame com ID #${ID}`,
    });

    return res.status(200).json({ success: true, msg: "Nota de exame eliminada com sucesso!" });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * POST /eduallstudentexamscores/bulk
 * Upsert em bulk de notas de exame: insere se não existir, atualiza se existir.
 * Body: { items: [{ student_code, class_id, subject_id, score }] }
 */
const BulkUpsertStudentExamNotes = async (req, res) => {
  try {
    const { allowed } = await CheckSpecialExamPermission(req, res);
    if (!allowed) {
      return res.status(403).json({ success: false, msg: "Ação não permitida devido à restrição pedagógica!" });
    }

    const instituteCode = req.session.user.eduall_user_session_curentinstitute;
    const items = req.body.items || [];

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ success: false, msg: "Nenhum item enviado." });
    }

    // Validar max_value por turma (cache local por classId)
    const classMaxCache = {};
    const getMaxValue = async (classId) => {
      if (classMaxCache[classId] !== undefined) return classMaxCache[classId];
      try {
        const classQuery = `
          SELECT al.ed_academic_level_avaliationtype_endat AS max_value
          FROM eduall_class c
          LEFT JOIN eduall_academic_level al ON al.ed_academic_level_id = c.ed_class_academic_level
          WHERE c.ed_class_id = ? AND c.ed_class_deleted = 0 AND c.ed_class_institute_code = ?
          LIMIT 1
        `;
        const result = await ExecuteQuery(res, classQuery, [classId, instituteCode], true);
        const max = result?.[0]?.max_value || 20;
        classMaxCache[classId] = max;
        return max;
      } catch (_) {
        classMaxCache[classId] = 20;
        return 20;
      }
    };

    let inserted = 0;
    let updated  = 0;
    const errors = [];

    for (const item of items) {
      const { student_code, class_id, subject_id, score } = item;

      if (!student_code || !class_id || !subject_id) {
        errors.push({ item, reason: "Campos obrigatórios em falta." });
        continue;
      }

      const scoreNum = parseFloat(String(score ?? "").replace(",", "."));
      if (!isFinite(scoreNum)) {
        // Nota vazia/inválida: ignorar silenciosamente
        continue;
      }

      const maxValue = await getMaxValue(class_id);
      const clampedScore = Math.min(Math.max(scoreNum, 0), maxValue);

      // Verificar se já existe
      const checkQuery = `
        SELECT ed_student_exam_note_id FROM eduall_student_exam_notes
        WHERE ed_student_exam_note_studentCode    = ?
          AND ed_student_exam_note_class          = ?
          AND ed_student_exam_note_subject        = ?
          AND ed_student_exam_note_institute_code = ?
          AND ed_student_exam_note_deleted        = 0
        LIMIT 1
      `;
      const existing = await ExecuteQuery(res, checkQuery,
        [student_code, class_id, subject_id, instituteCode], true);

      if (existing && existing.length > 0) {
        const existingId = existing[0].ed_student_exam_note_id;
        const updateQuery = `
          UPDATE eduall_student_exam_notes
          SET ed_student_exam_note_score = ?
          WHERE ed_student_exam_note_id  = ?
        `;
        await ExecuteQuery(res, updateQuery, [clampedScore, existingId], false, {
          db: "eduall_student_exam_notes", type: "update", data: req
        });
        updated++;
      } else {
        const insertQuery = `
          INSERT INTO eduall_student_exam_notes (
            ed_student_exam_note_studentCode,
            ed_student_exam_note_class,
            ed_student_exam_note_subject,
            ed_student_exam_note_score,
            ed_student_exam_note_institute_code
          ) VALUES (?, ?, ?, ?, ?)
        `;
        await ExecuteQuery(res, insertQuery,
          [student_code, class_id, subject_id, clampedScore, instituteCode], false, {
            db: "eduall_student_exam_notes", type: "insert", data: req
          });
        inserted++;
      }
    }

    await RegisterAuditAction({
      session: req.session,
      action: 1,
      form: "Notas de Exame (Bulk)",
      description: `Lançamento bulk: ${inserted} inseridas, ${updated} atualizadas.`,
    });

    return res.status(200).json({
      success: true,
      msg: `Lançamento concluído: ${inserted} inseridas, ${updated} atualizadas.`,
      inserted,
      updated,
      errors: errors.length ? errors : undefined,
    });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
};


// ════════════════════════════════════════════════════════════════════════════
//  NOTAS DE RECURSO
// ════════════════════════════════════════════════════════════════════════════

/**
 * GET /eduallgetstudentfeaturedscorebyclasssubject/:CLASS,:SUBJECT
 * Lista todas as notas de recurso de uma turma + disciplina (bulk).
 */
const GetAllStudentFeaturedNotesByClassSubject = async (req, res) => {
  try {
    const { CLASS, SUBJECT } = req.params;
    const instituteCode = req.session.user.eduall_user_session_curentinstitute;

    const query = `
      SELECT
        sfn.ed_student_featured_note_id,
        sfn.ed_student_featured_note_studentCode,
        sfn.ed_student_featured_note_class,
        sfn.ed_student_featured_note_subject,
        sfn.ed_student_featured_note_score,
        sfn.ed_student_featured_note_institute_code,
        s.ed_student_id,
        s.ed_student_name,
        s.ed_student_code,
        s.ed_student_picture,
        c.ed_class_id,
        c.ed_class_name,
        al.ed_academic_level_avaliationtype_endat AS max_value,
        al.ed_academic_level_forFt                AS allows_recurso
      FROM eduall_student_featured_notes sfn
      LEFT JOIN eduall_student        s  ON s.ed_student_id              = sfn.ed_student_featured_note_studentCode
      LEFT JOIN eduall_class          c  ON c.ed_class_id                = sfn.ed_student_featured_note_class
      LEFT JOIN eduall_academic_level al ON al.ed_academic_level_id      = c.ed_class_academic_level
      WHERE sfn.ed_student_featured_note_class          = ?
        AND sfn.ed_student_featured_note_subject        = ?
        AND sfn.ed_student_featured_note_deleted        = 0
        AND sfn.ed_student_featured_note_institute_code = ?
      ORDER BY s.ed_student_name ASC
    `;

    const rows = await ExecuteQuery(
      res, query,
      [CLASS, SUBJECT, instituteCode],
      true,
      { db: "eduall_student_featured_notes", type: "select", data: req }
    );

    return res.status(200).json(rows);
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * GET /eduallgetstudentfeaturedscorebyclasssubjectwithstudents/:CLASS,:SUBJECT
 * Devolve TODOS os alunos da turma com a nota de recurso (null se não registada).
 */
const GetAllStudentsWithFeaturedNoteByClassSubject = async (req, res) => {
  try {
    const { CLASS, SUBJECT } = req.params;
    const instituteCode = req.session.user.eduall_user_session_curentinstitute;

    // Primeiro verificar se o nível académico permite recurso
    const levelCheckQuery = `
      SELECT al.ed_academic_level_forFt, al.ed_academic_level_avaliationtype_endat AS max_value
      FROM eduall_class c
      LEFT JOIN eduall_academic_level al ON al.ed_academic_level_id = c.ed_class_academic_level
      WHERE c.ed_class_id = ? AND c.ed_class_deleted = 0 AND c.ed_class_institute_code = ?
      LIMIT 1
    `;
    const levelResult = await ExecuteQuery(res, levelCheckQuery, [CLASS, instituteCode], true);

    if (!levelResult || levelResult.length === 0) {
      return res.status(404).json({ success: false, msg: "Turma não encontrada." });
    }

    if (levelResult[0].ed_academic_level_forFt !== 1) {
      return res.status(403).json({
        success: false,
        msg: "Esta turma não permite notas de recurso.",
        allows_recurso: false
      });
    }

    const query = `
      SELECT
        s.ed_student_id,
        s.ed_student_name,
        s.ed_student_code,
        s.ed_student_picture,
        sfn.ed_student_featured_note_id,
        sfn.ed_student_featured_note_score,
        ? AS max_value,
        c.ed_class_name,
        1 AS allows_recurso
      FROM eduall_student s
      LEFT JOIN eduall_student_class_enrollment e
             ON e.ed_enrollment_student = s.ed_student_id
            AND e.ed_enrollment_class   = ?
            AND e.ed_enrollment_deleted = 0
      LEFT JOIN eduall_class c
             ON c.ed_class_id           = ?
      LEFT JOIN eduall_student_featured_notes sfn
             ON sfn.ed_student_featured_note_studentCode  = s.ed_student_id
            AND sfn.ed_student_featured_note_class        = ?
            AND sfn.ed_student_featured_note_subject      = ?
            AND sfn.ed_student_featured_note_deleted      = 0
            AND sfn.ed_student_featured_note_institute_code = ?
      WHERE s.ed_student_deleted        = 0
        AND s.ed_student_institute_code = ?
        AND e.ed_enrollment_class IS NOT NULL
      ORDER BY s.ed_student_name ASC
    `;

    const rows = await ExecuteQuery(
      res, query,
      [
        levelResult[0].max_value,
        CLASS, CLASS, CLASS, SUBJECT,
        instituteCode, instituteCode
      ],
      true,
      { db: "eduall_student_featured_notes", type: "select", data: req }
    );

    return res.status(200).json(rows);
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * POST /eduallstudentfeaturedscores/bulk
 * Upsert em bulk de notas de recurso.
 * Body: { items: [{ student_code, class_id, subject_id, score }] }
 */
const BulkUpsertStudentFeaturedNotes = async (req, res) => {
  try {
    const { allowed } = await CheckSpecialExamPermission(req, res);
    if (!allowed) {
      return res.status(403).json({ success: false, msg: "Ação não permitida devido à restrição pedagógica!" });
    }

    const instituteCode = req.session.user.eduall_user_session_curentinstitute;
    const items = req.body.items || [];

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ success: false, msg: "Nenhum item enviado." });
    }

    // Cache de validação por turma
    const classInfoCache = {};
    const getClassInfo = async (classId) => {
      if (classInfoCache[classId] !== undefined) return classInfoCache[classId];
      try {
        const q = `
          SELECT al.ed_academic_level_forFt,
                 al.ed_academic_level_avaliationtype_endat AS max_value
          FROM eduall_class c
          LEFT JOIN eduall_academic_level al ON al.ed_academic_level_id = c.ed_class_academic_level
          WHERE c.ed_class_id = ? AND c.ed_class_deleted = 0 AND c.ed_class_institute_code = ?
          LIMIT 1
        `;
        const result = await ExecuteQuery(res, q, [classId, instituteCode], true);
        const info = {
          forFt:    result?.[0]?.ed_academic_level_forFt ?? 0,
          maxValue: result?.[0]?.max_value ?? 20,
        };
        classInfoCache[classId] = info;
        return info;
      } catch (_) {
        classInfoCache[classId] = { forFt: 0, maxValue: 20 };
        return classInfoCache[classId];
      }
    };

    let inserted = 0;
    let updated  = 0;
    const errors = [];

    for (const item of items) {
      const { student_code, class_id, subject_id, score } = item;

      if (!student_code || !class_id || !subject_id) {
        errors.push({ item, reason: "Campos obrigatórios em falta." });
        continue;
      }

      const scoreNum = parseFloat(String(score ?? "").replace(",", "."));
      if (!isFinite(scoreNum)) continue; // nota vazia → ignorar

      const classInfo = await getClassInfo(class_id);

      if (classInfo.forFt !== 1) {
        errors.push({ item, reason: "Turma não permite notas de recurso." });
        continue;
      }

      const clampedScore = Math.min(Math.max(scoreNum, 0), classInfo.maxValue);

      // Verificar duplicado
      const checkQuery = `
        SELECT ed_student_featured_note_id FROM eduall_student_featured_notes
        WHERE ed_student_featured_note_studentCode    = ?
          AND ed_student_featured_note_class          = ?
          AND ed_student_featured_note_subject        = ?
          AND ed_student_featured_note_institute_code = ?
          AND ed_student_featured_note_deleted        = 0
        LIMIT 1
      `;
      const existing = await ExecuteQuery(res, checkQuery,
        [student_code, class_id, subject_id, instituteCode], true);

      if (existing && existing.length > 0) {
        const existingId = existing[0].ed_student_featured_note_id;
        const updateQuery = `
          UPDATE eduall_student_featured_notes
          SET ed_student_featured_note_score = ?
          WHERE ed_student_featured_note_id  = ?
        `;
        await ExecuteQuery(res, updateQuery, [clampedScore, existingId], false, {
          db: "eduall_student_featured_notes", type: "update", data: req
        });
        updated++;
      } else {
        const insertQuery = `
          INSERT INTO eduall_student_featured_notes (
            ed_student_featured_note_studentCode,
            ed_student_featured_note_class,
            ed_student_featured_note_subject,
            ed_student_featured_note_score,
            ed_student_featured_note_institute_code
          ) VALUES (?, ?, ?, ?, ?)
        `;
        await ExecuteQuery(res, insertQuery,
          [student_code, class_id, subject_id, clampedScore, instituteCode], false, {
            db: "eduall_student_featured_notes", type: "insert", data: req
          });
        inserted++;
      }
    }

    await RegisterAuditAction({
      session: req.session,
      action: 1,
      form: "Notas de Recurso (Bulk)",
      description: `Lançamento bulk: ${inserted} inseridas, ${updated} atualizadas.`,
    });

    return res.status(200).json({
      success: true,
      msg: `Lançamento concluído: ${inserted} inseridas, ${updated} atualizadas.`,
      inserted,
      updated,
      errors: errors.length ? errors : undefined,
    });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * POST /eduallstudentfeaturedscoreregister/post  (individual — já existia)
 */
const RegisterStudentFeaturedNotes = async (req, res) => {
  try {
    const { allowed } = await CheckSpecialExamPermission(req, res);
    if (!allowed) {
      return res.status(403).json({ success: false, msg: "Ação não permitida devido à restrição pedagógica!" });
    }

    const classId      = req.body.student_featured_class;
    const instituteCode = req.session.user.eduall_user_session_curentinstitute;

    const classQuery = `
      SELECT ed_class_academic_level FROM eduall_class
      WHERE ed_class_deleted = 0 AND ed_class_id = ? AND ed_class_institute_code = ?
      LIMIT 1
    `;
    const classResult = await ExecuteQuery(res, classQuery, [classId, instituteCode], true);
    if (!classResult || classResult.length === 0)
      return res.status(404).json({ success: false, msg: "Turma não encontrada ou inválida!" });

    const levelQuery = `
      SELECT ed_academic_level_forFt, ed_academic_level_avaliationtype_endat AS max_value
      FROM eduall_academic_level
      WHERE ed_academic_level_deleted = 0
        AND ed_academic_level_id = ? AND ed_academic_level_institute_code = ?
      LIMIT 1
    `;
    const levelResult = await ExecuteQuery(res, levelQuery,
      [classResult[0].ed_class_academic_level, instituteCode], true);

    if (!levelResult || levelResult.length === 0)
      return res.status(404).json({ success: false, msg: "Nível académico inválido!" });

    if (levelResult[0].ed_academic_level_forFt !== 1)
      return res.status(403).json({ success: false, msg: "Turma não permite notas de recurso!" });

    const maxValue   = levelResult[0].max_value || 20;
    const scoreNum   = parseFloat(String(req.body.student_featured_score ?? "").replace(",", "."));
    const safeScore  = isFinite(scoreNum) ? Math.min(Math.max(scoreNum, 0), maxValue) : 0;

    const checkQuery = `
      SELECT 1 FROM eduall_student_featured_notes
      WHERE ed_student_featured_note_studentCode  = ?
        AND ed_student_featured_note_class        = ?
        AND ed_student_featured_note_subject      = ?
        AND ed_student_featured_note_institute_code = ?
      LIMIT 1
    `;
    const existingNote = await ExecuteQuery(res, checkQuery, [
      req.body.student_featured_code, req.body.student_featured_class,
      req.body.student_featured_subject, instituteCode
    ], true);

    if (existingNote && existingNote.length > 0)
      return res.status(409).json({
        success: false,
        msg: "Nota de recurso já registada para este aluno, disciplina e turma!"
      });

    const insertQuery = `
      INSERT INTO eduall_student_featured_notes (
        ed_student_featured_note_studentCode,
        ed_student_featured_note_class,
        ed_student_featured_note_subject,
        ed_student_featured_note_score,
        ed_student_featured_note_institute_code
      ) VALUES (?, ?, ?, ?, ?)
    `;
    await ExecuteQuery(res, insertQuery, [
      req.body.student_featured_code, req.body.student_featured_class,
      req.body.student_featured_subject, safeScore, instituteCode
    ], false, { db: "eduall_student_featured_notes", type: "insert", data: req });

    await RegisterAuditAction({
      session: req.session, action: 1, form: "Notas de Recurso",
      description: `Registou nota de recurso para aluno #${req.body.student_featured_code}`,
    });

    return res.status(200).json({ success: true, msg: "Nota de recurso registada com sucesso!" });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * PUT /eduallstudentfeaturedscoreupdate/update/:ID  (individual — já existia)
 */
const UpdateStudentFeaturedNotes = async (req, res) => {
  try {
    const { allowed } = await CheckSpecialExamPermission(req, res);
    if (!allowed)
      return res.status(403).json({ success: false, msg: "Ação não permitida devido à restrição pedagógica!" });

    const { ID }        = req.params;
    const classId       = req.body.student_featured_class;
    const instituteCode = req.session.user.eduall_user_session_curentinstitute;

    const classQuery = `
      SELECT ed_class_academic_level FROM eduall_class
      WHERE ed_class_deleted = 0 AND ed_class_id = ? AND ed_class_institute_code = ?
      LIMIT 1
    `;
    const classResult = await ExecuteQuery(res, classQuery, [classId, instituteCode], true);
    if (!classResult || classResult.length === 0)
      return res.status(404).json({ success: false, msg: "Turma não encontrada ou inválida!" });

    const levelQuery = `
      SELECT ed_academic_level_forFt, ed_academic_level_avaliationtype_endat AS max_value
      FROM eduall_academic_level
      WHERE ed_academic_level_deleted = 0
        AND ed_academic_level_id = ? AND ed_academic_level_institute_code = ?
      LIMIT 1
    `;
    const levelResult = await ExecuteQuery(res, levelQuery,
      [classResult[0].ed_class_academic_level, instituteCode], true);

    if (!levelResult || levelResult.length === 0)
      return res.status(404).json({ success: false, msg: "Nível académico inválido!" });

    if (levelResult[0].ed_academic_level_forFt !== 1)
      return res.status(403).json({ success: false, msg: "Turma não permite atualização de notas de recurso!" });

    const maxValue  = levelResult[0].max_value || 20;
    const scoreNum  = parseFloat(String(req.body.student_featured_score ?? "").replace(",", "."));
    const safeScore = isFinite(scoreNum) ? Math.min(Math.max(scoreNum, 0), maxValue) : 0;

    const updateQuery = `
      UPDATE eduall_student_featured_notes
      SET ed_student_featured_note_studentCode = ?,
          ed_student_featured_note_class       = ?,
          ed_student_featured_note_subject     = ?,
          ed_student_featured_note_score       = ?
      WHERE ed_student_featured_note_deleted = 0
        AND ed_student_featured_note_id      = ?
    `;
    await ExecuteQuery(res, updateQuery, [
      req.body.student_featured_code, req.body.student_featured_class,
      req.body.student_featured_subject, safeScore, ID
    ], false, { db: "eduall_student_featured_notes", type: "update", data: req });

    await RegisterAuditAction({
      session: req.session, action: 2, form: "Notas de Recurso",
      description: `Atualizou nota de recurso do aluno #${req.body.student_featured_code} → ${safeScore}`,
    });

    return res.status(200).json({ success: true, msg: "Nota de recurso atualizada com sucesso!" });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * PUT /eduallstudentfeaturedscoredelete/delete/:ID
 */
const DeleteStudentFeaturedNotes = async (req, res) => {
  try {
    const { ID } = req.params;
    await ExecuteQuery(res,
      `UPDATE eduall_student_featured_notes SET ed_student_featured_note_deleted = 1 WHERE ed_student_featured_note_id = ?`,
      [ID], false, { db: "eduall_student_featured_notes", type: "delete", data: req }
    );
    await RegisterAuditAction({
      session: req.session, action: 3, form: "Notas de Recurso",
      description: `Eliminou nota de recurso com ID #${ID}`,
    });
    return res.status(200).json({ success: true, msg: "Nota de recurso eliminada com sucesso!" });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
};


// ════════════════════════════════════════════════════════════════════════════
//  EXPORTS
// ════════════════════════════════════════════════════════════════════════════
module.exports = {
  // Exame — listagem
  GetAllStudentExamNotesByClassSubject,
  GetAllStudentsWithExamNoteByClassSubject,
  // Exame — CRUD
  RegisterStudentExamNotes,
  UpdateStudentExamNotes,
  DeleteStudentExamNotes,
  BulkUpsertStudentExamNotes,
  // Recurso — listagem
  GetAllStudentFeaturedNotesByClassSubject,
  GetAllStudentsWithFeaturedNoteByClassSubject,
  // Recurso — CRUD
  RegisterStudentFeaturedNotes,
  UpdateStudentFeaturedNotes,
  DeleteStudentFeaturedNotes,
  BulkUpsertStudentFeaturedNotes,
  GetsingleStudentExamNotebYSubStCls
};




 