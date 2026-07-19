const ExecuteQuery = require("../Functions/ExecuteQuery");
const { RegisterAuditAction } = require("./Auditory");

const GetSemesterNotes = async (req, res) => {
   try {
      const query = `SELECT * FROM eduall_semester_notes  
         LEFT JOIN eduall_students ON eduall_students.ed_student_id = eduall_semester_notes.ed_semester_note_studentcode
         WHERE ed_semester_note_deleted = 0 AND ed_semester_note_institute_code = ?`;
      const PARAMS = [req.session.user.eduall_user_session_curentinstitute];
      const rows = await ExecuteQuery(res, query, PARAMS, true, { db: "eduall_requests", type: "select", data: req });
      res.status(200).json(rows);
   } catch (error) {
      return res.status(300).json({ status: 300, success: false, error: error.message });
   }
};

const GetsingleSemesterNote = async (req, res) => {
   try {
      const { STUDENTCODE } = req.params;
      const query = `SELECT * FROM eduall_semester_notes 
         LEFT JOIN eduall_class ON eduall_class.ed_class_id = eduall_semester_notes.ed_semester_note_class
         LEFT JOIN eduall_academic_level ON eduall_academic_level.ed_academic_level_id  = eduall_class.ed_class_academic_level
         LEFT JOIN eduall_students ON eduall_students.ed_student_id = eduall_semester_notes.ed_semester_note_studentcode
         WHERE ed_semester_note_deleted = 0 AND ed_semester_note_studentcode = ? AND ed_semester_note_institute_code = ?`;
      const PARAMS = [STUDENTCODE, req.session.user.eduall_user_session_curentinstitute];
      const rows = await ExecuteQuery(res, query, PARAMS, true, { db: "eduall_requests", type: "select", data: req });
      res.status(200).json(rows);
   } catch (error) {
      return res.status(300).json({ status: 300, success: false, error: error.message });
   }
};
 

const GetsingleSemesterNoteByID = async (req, res) => {
   try {
      const { ID } = req.params;
      const query = `SELECT * FROM eduall_semester_notes 
         LEFT JOIN eduall_class ON eduall_class.ed_class_id = eduall_semester_notes.ed_semester_note_class
         LEFT JOIN eduall_academic_level ON eduall_academic_level.ed_academic_level_id  = eduall_class.ed_class_academic_level
         LEFT JOIN eduall_students ON eduall_students.ed_student_id = eduall_semester_notes.ed_semester_note_studentcode
         WHERE ed_semester_note_id = ?  AND ed_semester_note_deleted = 0 AND ed_semester_note_institute_code = ?`;
      const PARAMS = [ID, req.session.user.eduall_user_session_curentinstitute];
      const rows = await ExecuteQuery(res, query, PARAMS, true, { db: "eduall_requests", type: "select", data: req });
      res.status(200).json(rows);
   } catch (error) {
      return res.status(300).json({ status: 300, success: false, error: error.message });
   }
};

const GetsingleSemesterNotebYSubCls = async (req, res) => {
   try {
      const { SUBJECT, CLASS } = req.params;
      const query = `SELECT * FROM eduall_semester_notes  
         LEFT JOIN eduall_class ON eduall_class.ed_class_id = eduall_semester_notes.ed_semester_note_class
         LEFT JOIN eduall_academic_level ON eduall_academic_level.ed_academic_level_id  = eduall_class.ed_class_academic_level
         LEFT JOIN eduall_students ON eduall_students.ed_student_id = eduall_semester_notes.ed_semester_note_studentcode
         WHERE ed_semester_note_subject = ? AND ed_semester_note_deleted = 0
         AND ed_semester_note_subject = ? AND ed_semester_note_class = ? AND ed_semester_note_institute_code = ?`;
      const PARAMS = [SUBJECT, CLASS, req.session.user.eduall_user_session_curentinstitute];
      const rows = await ExecuteQuery(res, query, PARAMS, true, { db: "eduall_requests", type: "select", data: req });
      res.status(200).json(rows);
   } catch (error) {
      return res.status(300).json({ status: 300, success: false, error: error.message });
   }
};

const GetsingleStudentSemesterNotebYCls = async (req, res) => {
   try {
      const { CLASS, STUDENT, SEMESTER } = req.params;
      const query = `SELECT * FROM eduall_semester_notes  
         LEFT JOIN eduall_class  ON eduall_class.ed_class_id = eduall_semester_notes.ed_semester_note_class
         LEFT JOIN eduall_academic_level ON eduall_academic_level.ed_academic_level_id  = eduall_class.ed_class_academic_level
         LEFT JOIN eduall_students ON eduall_students.ed_student_id = eduall_semester_notes.ed_semester_note_studentcode
         LEFT JOIN eduall_subjects ON eduall_subjects.ed_subject_id = eduall_semester_notes.ed_semester_note_subject
         WHERE ed_semester_note_deleted = 0 AND ed_semester_note_studentcode = ? AND ed_semester_note_class = ? 
         AND ed_semester_note_semester =  ? AND ed_semester_note_institute_code = ?`;
      const PARAMS = [STUDENT, CLASS, SEMESTER, req.session.user.eduall_user_session_curentinstitute];
      const rows = await ExecuteQuery(res, query, PARAMS, true, { db: "eduall_requests", type: "select", data: req });
      res.status(200).json(rows);
   } catch (error) {
      return res.status(300).json({ status: 300, success: false, error: error.message });
   }
};

const GetsingleClassScoreByNumber = async (req, res) => {
   try {
      const { CLASSID, STUDENTCODE } = req.params;
      const query = `SELECT * FROM eduall_class_scores
         LEFT JOIN eduall_students ON eduall_students.ed_student_id = eduall_class_scores.ed_class_score_studentcode
         LEFT JOIN eduall_class ON eduall_class.ed_class_id = eduall_class_scores.ed_class_score_classid
         WHERE ed_class_score_classid = ? AND ed_class_score_studentcode = ? AND ed_class_score_institute_code = ?`;
      const PARAMS = [CLASSID, STUDENTCODE, req.session.user.eduall_user_session_curentinstitute];
      const rows = await ExecuteQuery(res, query, PARAMS, true, { db: "eduall_requests", type: "select", data: req });
      res.status(200).json(rows);
   } catch (error) {
      return res.status(300).json({ status: 300, success: false, error: error.message });
   }
};


/// code do semester


const GetsingleSemesterNotebYQrtSub = async (req, res) => {
   try {
      const { SEMESTER, SUBJECT, CLASS } = req.params;
      const query = `SELECT * FROM eduall_semester_notes 
         LEFT JOIN eduall_class ON eduall_class.ed_class_id = eduall_semester_notes.ed_semester_note_class
         LEFT JOIN eduall_academic_level ON eduall_academic_level.ed_academic_level_id  = eduall_class.ed_class_academic_level
         LEFT JOIN eduall_students ON eduall_students.ed_student_id = eduall_semester_notes.ed_semester_note_studentcode
         WHERE ed_semester_note_semester = ? AND ed_semester_note_subject = ? AND
         ed_semester_note_class = ? AND ed_semester_note_deleted = 0 AND ed_semester_note_institute_code = ?`;
      const PARAMS = [SEMESTER, SUBJECT, CLASS, req.session.user.eduall_user_session_curentinstitute];
      const rows = await ExecuteQuery(res, query, PARAMS, true, { db: "eduall_requests", type: "select", data: req });
      res.status(200).json(rows);
   } catch (error) {
      return res.status(300).json({ status: 300, success: false, error: error.message });
   }
};









 
function toNum(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(String(v).replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

function isValidId(v) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0;
}

async function GetAllowedSubjectsByClass(res, req, classId) {
  const inst = req.session?.user?.eduall_user_session_curentinstitute;
  if (!inst) return [];
  const sql = `
    SELECT DISTINCT ed_tch_subject_code AS subject_id
    FROM eduall_teacher_subjects
    WHERE ed_tch_subject_deleted = 0
      AND ed_tch_subject_class = ?
      AND ed_tch_subject_institute_code = ?
  `;
  try {
    const rows = await ExecuteQuery(res, sql, [classId, inst], true, {
      db: "eduall_teacher_subjects",
      type: "select",
      data: req,
    });
    return (Array.isArray(rows) ? rows : [])
      .map((r) => Number(r.subject_id))
      .filter((n) => Number.isFinite(n) && n > 0);
  } catch {
    return [];
  }
}

async function FindSemesterNoteId(res, req, { student_code, subject_id, class_id, semester }) {
  const inst = req.session.user.eduall_user_session_curentinstitute;
  const sql = `
    SELECT ed_semester_note_id
    FROM eduall_semester_notes
    WHERE ed_semester_note_deleted = 0
      AND ed_semester_note_studentcode = ?
      AND ed_semester_note_subject = ?
      AND ed_semester_note_class = ?
      AND ed_semester_note_semester = ?
      AND ed_semester_note_institute_code = ?
    LIMIT 1
  `;
  const rows = await ExecuteQuery(res, sql, [student_code, subject_id, class_id, semester, inst], true, {
    db: "eduall_semester_notes",
    type: "select",
    data: req,
  });
  return Array.isArray(rows) && rows.length ? rows[0].ed_semester_note_id : null;
}

//  LIST: todas as notas da turma/disciplina/semestre (para preencher inputs no frontend)
const ListSemesterNotes = async (req, res) => {
  try {
    const inst = req.session?.user?.eduall_user_session_curentinstitute;
    if (!inst) return res.status(401).json({ success: false, msg: "Sessão inválida." });

    const { SEMESTER, SUBJECT, CLASS } = req.params;
    const query = `
      SELECT *
      FROM eduall_semester_notes
      LEFT JOIN eduall_class ON eduall_class.ed_class_id = eduall_semester_notes.ed_semester_note_class
      LEFT JOIN eduall_academic_level ON eduall_academic_level.ed_academic_level_id = eduall_class.ed_class_academic_level
      LEFT JOIN eduall_students ON eduall_students.ed_student_id = eduall_semester_notes.ed_semester_note_studentcode
      WHERE ed_semester_note_semester = ?
        AND ed_semester_note_subject = ?
        AND ed_semester_note_class = ?
        AND ed_semester_note_deleted = 0
        AND ed_semester_note_institute_code = ?
    `;
    const rows = await ExecuteQuery(res, query, [SEMESTER, SUBJECT, CLASS, inst], true, {
      db: "eduall_semester_notes",
      type: "select",
      data: req,
    });
    return res.status(200).json(rows);
  } catch (error) {
    return res.status(500).json({ success: false, msg: "Falha ao listar notas semestrais.", error: error.message });
  }
};

//  UPSERT (bulk): se existir -> UPDATE, se não existir -> INSERT
const RegisterSemesterNote = async (req, res) => {
  try {
    const inst = req.session?.user?.eduall_user_session_curentinstitute;
    if (!inst) return res.status(401).json({ success: false, msg: "Sessão inválida." });

    const items = Array.isArray(req.body?.items) ? req.body.items : [];
    if (!items.length) return res.status(400).json({ success: false, msg: "Nenhum item enviado." });

    const report = { inserted: 0, updated: 0, rejected: 0, errors: [] };
    const allowedMap = new Map(); // classId -> Set(subjectId)

    const insertSql = `
      INSERT INTO eduall_semester_notes(
        ed_semester_note_studentcode,
        ed_semester_note_subject,
        ed_semester_note_semester,
        ed_semester_note_p1,
        ed_semester_note_p2,
        ed_semester_note_exam,
        ed_semester_note_specialexam,
        ed_semester_note_class,
        ed_semester_note_institute_code
      ) VALUES(?,?,?,?,?,?,?,?,?)
    `;

    const updateSql = `
      UPDATE eduall_semester_notes
      SET ed_semester_note_p1 = ?,
          ed_semester_note_p2 = ?,
          ed_semester_note_exam = ?,
          ed_semester_note_specialexam = ?
      WHERE ed_semester_note_id = ?
        AND ed_semester_note_institute_code = ?
        AND ed_semester_note_deleted = 0
    `;

    for (let i = 0; i < items.length; i++) {
      const it = items[i] || {};
      const student_code = Number(it.student_code);
      const class_id = Number(it.class_id);
      const subject_id = Number(it.subject_id);
      const semester = Number(it.semester);

      const p1 = toNum(it.p1) ?? 0;
      const p2 = toNum(it.p2) ?? 0;
      const exam = toNum(it.exam) ?? 0;
      const special_test = toNum(it.special_test) ?? 0;

      if (!isValidId(student_code) || !isValidId(class_id) || !isValidId(subject_id) || !isValidId(semester)) {
        report.rejected++;
        report.errors.push({ index: i, reason: "Dados inválidos (student/class/subject/semester).", item: it });
        continue;
      }

      // disciplina tem de pertencer à turma
      if (!allowedMap.has(class_id)) {
        const allowedSubjects = await GetAllowedSubjectsByClass(res, req, class_id);
        allowedMap.set(class_id, new Set(allowedSubjects));
      }
      const allowedSet = allowedMap.get(class_id);
      if (allowedSet && allowedSet.size > 0 && !allowedSet.has(subject_id)) {
        report.rejected++;
        report.errors.push({ index: i, reason: "Disciplina não associada à turma.", item: it });
        continue;
      }

      const noteId = await FindSemesterNoteId(res, req, { student_code, subject_id, class_id, semester });

      try {
        if (noteId) {
          await ExecuteQuery(
            res,
            updateSql,
            [p1, p2, exam, special_test, noteId, inst],
            false,
            { db: "eduall_semester_notes", type: "update", data: req }
          );
          report.updated++;
        } else {
          await ExecuteQuery(
            res,
            insertSql,
            [student_code, subject_id, semester, p1, p2, exam, special_test, class_id, inst],
            false,
            { db: "eduall_semester_notes", type: "insert", data: req }
          );
          report.inserted++;
        }
      } catch (e) {
        report.rejected++;
        report.errors.push({ index: i, reason: e.message || "Falha ao inserir/actualizar.", item: it });
      }
    }

    await RegisterAuditAction({
      session: req.session,
      action: 1,
      form: "Notas semestrais (upsert bulk)",
      description: `Upsert: inseridos=${report.inserted}, actualizados=${report.updated}, rejeitados=${report.rejected}`,
    });

    return res.status(200).json({ success: true, report });
  } catch (error) {
    return res.status(500).json({ success: false, msg: "Falha no upsert semestral.", error: error.message });
  }
};
 



const SemesterNoteUpdate = async (req, res) => {
  try {
    const { ID } = req.params;
    const {
      semester_note_p2,
      semester_note_p1,
      semester_note_special_test,
      semester_note_exam
    } = req.body;

    const inst = req.session.user.eduall_user_session_curentinstitute;

    // 1️⃣ - Verificar se a nota existe
    const checkQuery = `
      SELECT ed_semester_note_id 
      FROM eduall_semester_notes
      WHERE ed_semester_note_deleted = 0
        AND ed_semester_note_id = ?
        AND ed_semester_note_institute_code = ?
      LIMIT 1`;

    const checkParams = [ID, inst];

    const exists = await ExecuteQuery(res, checkQuery, checkParams, true, {
      db: "eduall_semester_notes",
      type: "select",
      data: req
    });

    if (exists.length === 0) {
      return res.status(404).json({
        status: 404,
        success: false,
        msg: "A nota que está a tentar atualizar não existe."
      });
    }

    // 2️⃣ - Atualizar
    const query = `
      UPDATE eduall_semester_notes 
      SET ed_semester_note_p1 = ?,
          ed_semester_note_p2 = ?,
          ed_semester_note_exam = ?,
          ed_semester_note_specialexam = ?
      WHERE ed_semester_note_deleted = 0
        AND ed_semester_note_id = ?
        AND ed_semester_note_institute_code = ?`;

    const params = [
      semester_note_p1,
      semester_note_p2,
      semester_note_exam,
      semester_note_special_test,
      ID,
      inst
    ];

    const rows = await ExecuteQuery(res, query, params, false, {
      db: "eduall_semester_notes",
      type: "update",
      data: req
    });

    // Auditoria
    await RegisterAuditAction({
      session: req.session,
      action: 2,
      form: "Notas semestrais",
      description: `Atualizou a nota ID #${ID} (P1:${semester_note_p1}, P2:${semester_note_p2}, Exame:${semester_note_exam}, Recurso:${semester_note_special_test})`
    });

    res.status(200).json({
      status: 200,
      success: true,
      msg: "Nota atualizada com sucesso!",
      data: rows
    });

  } catch (error) {
    return res.status(500).json({
      status: 500,
      success: false,
      error: error.message
    });
  }
};



const SemesterNoteDelete = async (req, res) => {
   try {
      const { ID } = req.params;
      const query = `UPDATE eduall_semester_notes SET ed_semester_note_deleted = 1  
         WHERE ed_semester_note_deleted = 0 AND ed_semester_note_id = ?`;
      const PARAMS = [ID];
      const rows = await ExecuteQuery(res, query, PARAMS, false, { db: "eduall_requests", type: "update", data: req });
         
      await RegisterAuditAction({
         session: req.session,
         action: 3,  // Ação de deleção
         form: "Notas semestrais",
         description: `Deletou a nota do semestre com o ID (${ID})`,
       });
      res.status(200).json(rows);
   } catch (error) {
      return res.status(300).json({ status: 300, success: false, error: error.message });
   }
};
 
const GetSingleSemesterNotebYSubStdQrtTypeClass = async (req, res) => {
    try {
        const { SUBJECT, SEMESTER, STUDENT, CLASS } = req.params;
        const inst = req.session.user.eduall_user_session_curentinstitute;

        // QUERY PARA BUSCAR TURMA
        const Classquery = `
            SELECT * FROM eduall_class 
            WHERE ed_class_deleted = 0 AND ed_class_id = ?
        `;

        // QUERY PRINCIPAL
        const query = `
            SELECT * FROM eduall_semester_notes
            LEFT JOIN eduall_class 
                ON eduall_class.ed_class_id = eduall_semester_notes.ed_semester_note_class
            LEFT JOIN eduall_academic_level 
                ON eduall_academic_level.ed_academic_level_id = eduall_class.ed_class_academic_level
            LEFT JOIN eduall_students 
                ON eduall_students.ed_student_id = eduall_semester_notes.ed_semester_note_studentcode
            WHERE ed_semester_note_deleted = 0 
                AND ed_semester_note_subject = ?
                AND ed_semester_note_semester = ?
                AND ed_semester_note_studentcode = ?
                AND ed_semester_note_class = ?
                AND ed_semester_note_institute_code = ?
        `;

        // 1) BUSCAR TURMA USANDO ExecuteQuery
        const classRows = await ExecuteQuery(
            res,
            Classquery,
            [CLASS],
            true,
            { db: "eduall_class", type: "select", data: req }
        );

        if (!classRows.length) {
            return res.status(300).json({
                status: 300,
                success: false,
                error: "Turma não encontrada!"
            });
        }

        // 2) PEGAR AS DISCIPLINAS DA TURMA
        const subjects = classRows[0].ed_class_subjects.split(",");
        const total = [];

        // Função para carregar a nota completa de uma disciplina
        const loadData = async (subjectCode) => {
            const PARAMS = [
                subjectCode * 1,
                SEMESTER,
                STUDENT,
                CLASS,
                inst
            ];

            const resp = await ExecuteQuery(
                res,
                query,
                PARAMS,
                true,
                { db: "eduall_semester_notes", type: "select", data: req }
            );

            return resp.length
                ? { code: subjectCode * 1, data: resp[0] }
                : { code: subjectCode * 1, data: "NOT FOUNDED" };
        };

        // 3) LOOP SOBRE TODAS AS DISCIPLINAS
        for (let s of subjects) {
            const data = await loadData(s);
            total.push(data);
        }

        // 4) RETORNO FINAL
        return res.json({ total });

    } catch (error) {
        return res.status(300).json({
            status: 300,
            success: false,
            error: error.message
        });
    }
};




const GetAllSubjectsNotesByStudent = async (req, res) => {
  try {
    const { student_id, class_id, semester } = req.params;
    const institute = req.session.user.eduall_user_session_curentinstitute;

    // Buscar disciplinas da turma
    const classQuery = `
      SELECT ed_class_subjects 
      FROM eduall_class 
      WHERE ed_class_id = ? AND ed_class_deleted = 0
    `;

    const classData = await ExecuteQuery(res, classQuery, [class_id], true, {
      db: "eduall_class", type: "select", data: req
    });

    if (classData.length === 0) {
      return res.status(404).json({ error: "Class not found = " + class_id });
    }

    // Extrair IDs de disciplinas
    let subjectIds = [];

    if (classData[0].ed_class_subjects) {
      subjectIds = classData[0].ed_class_subjects
        .split(",")
        .filter(x => x.trim() !== "")
        .map(x => Number(x));
    }

    if (subjectIds.length === 0) {
      return res.status(200).json([]); // Nenhuma disciplina = nenhuma nota
    }

    // Buscar as disciplinas
    const subjects = await ExecuteQuery(
      res,
      `SELECT * FROM eduall_subjects WHERE ed_subject_id IN (${subjectIds.join(",")})`,
      [],
      true,
      { db: "eduall_subjects", type: "select", data: req }
    );

    // Buscar notas do aluno
    const notes = await ExecuteQuery(
      res,
      `SELECT * FROM eduall_semester_notes
       WHERE ed_semester_note_studentcode = ?
       AND ed_semester_note_class = ?
       AND (ed_semester_note_semester = ? OR ed_semester_note_semester = 0)
       AND (ed_semester_note_institute_code = ? OR ed_semester_note_institute_code = 1)
       AND ed_semester_note_deleted = 0`,
      [student_id, class_id, semester, institute],
      true,
      { db: "eduall_semester_notes", type: "select", data: req }
    );

    // Combinar disciplinas + notas (sem calcular md/final aqui)
    const result = subjects.map(sub => {
      const n = notes.find(
        x => Number(x.ed_semester_note_subject) === Number(sub.ed_subject_id)
      );

      const p1 = n ? Number(n.ed_semester_note_p1) || 0 : 0;
      const p2 = n ? Number(n.ed_semester_note_p2) || 0 : 0;
      const exam = n ? Number(n.ed_semester_note_exam) || 0 : 0;
      const specialexam = n ? Number(n.ed_semester_note_specialexam) || 0 : 0;

      return {
        subject_id: sub.ed_subject_id,
        subject_name: sub.ed_subject_title,
        p1,
        p2,
        exam,
        specialexam,
        // deixa o cálculo para o frontend
      };
    });

    return res.status(200).json(result);

  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: err.message });
  }
};

 const GetAllNotesByTrimester = async (req, res) => {
  try {
    const semester = Number(req.params.semester);
    const class_id_filter = req.query.class_id ? Number(req.query.class_id) : null;
    const institute = req.session.user.eduall_user_session_curentinstitute;

    // ---------------------------
    // 1. CARREGAR TODAS AS TURMAS + RELACIONAMENTOS
    // ---------------------------
    const classesQuery = `
      SELECT 
        cls.ed_class_id,
        cls.ed_class_title,
        cls.ed_class_subjects,

        cr.ed_course_title,
        lvl.ed_academic_level_title,
        cyc.ed_cicle_title,
        room.ed_classroom_title,
        fac.ed_faculty_title,
        year.ed_academic_year_title

      FROM eduall_class cls
      LEFT JOIN eduall_courses cr ON cr.ed_course_id = cls.ed_class_course
      LEFT JOIN eduall_academic_level lvl ON lvl.ed_academic_level_id = cls.ed_class_academic_level
      LEFT JOIN eduall_cicles cyc ON cyc.ed_cicle_id = cls.ed_class_cicle
      LEFT JOIN eduall_classrooms room ON room.ed_classroom_id = cls.ed_class_room
      LEFT JOIN eduall_faculty fac ON fac.ed_faculty_id = cls.ed_class_faculty
      LEFT JOIN eduall_academic_year year ON year.ed_academic_year_id = cls.ed_class_year

      WHERE cls.ed_class_deleted = 0
      AND cls.ed_class_institute_code = ?
    `;

    let classes = await ExecuteQuery(
      res, classesQuery, [institute], true,
      { db: "eduall_class", type: "select", data: req }
    );

    if (!classes.length) {
      return res.status(200).json({ semester, classes: [] });
    }

    // FILTRAR turma específica (opcional)
    if (class_id_filter) {
      classes = classes.filter(c => c.ed_class_id === class_id_filter);
    }

    const finalData = [];

    // ---------------------------
    // 2. PROCESSAR CADA TURMA
    // ---------------------------
    for (let cls of classes) {

      //---------------------------------------------
      // 2.1 OBTER DISCIPLINAS DA TURMA
      //---------------------------------------------
      const subjectIds = cls.ed_class_subjects
        ? cls.ed_class_subjects.split(",").map(x => Number(x.trim())).filter(x => x)
        : [];

      let subjects = [];
      if (subjectIds.length > 0) {
        subjects = await ExecuteQuery(
          res,
          `SELECT ed_subject_id, ed_subject_title
           FROM eduall_subjects 
           WHERE ed_subject_id IN (${subjectIds.join(",")})`,
          [],
          true
        );
      }

      //---------------------------------------------
      // 2.2 OBTER ALUNOS DA TURMA
      //---------------------------------------------
      const students = await ExecuteQuery(
        res,
        `SELECT 
           stu.ed_student_id,
           stu.ed_student_name,
           stu.ed_student_code,
           stu.ed_student_gender,
           stu.ed_student_birthday,
           stu.ed_student_identityCard,
           stu.ed_student_picture,
           stu.ed_student_nacionality,
           stu.ed_student_address
         FROM eduall_students stu
         WHERE stu.ed_student_class = ?
         AND stu.ed_student_deleted = 0
         AND stu.ed_student_institute_code = ?`,
        [cls.ed_class_id, institute],
        true
      );

      //---------------------------------------------
      // 2.3 NOTAS DO TRIMESTRE
      //---------------------------------------------
      const notes = await ExecuteQuery(
        res,
        `SELECT *
         FROM eduall_semester_notes
         WHERE ed_semester_note_class = ?
         AND (ed_semester_note_semester = ? OR ed_semester_note_semester = 0)
         AND (ed_semester_note_institute_code = ? OR ed_semester_note_institute_code = 1)
         AND ed_semester_note_deleted = 0`,
        [cls.ed_class_id, semester, institute],
        true
      );

      //---------------------------------------------
      // 2.4 COMBINAR ALUNO + NOTAS + CÁLCULOS
      //---------------------------------------------
      const processedStudents = students.map(stu => {
        const stuNotes = subjects.map(sub => {
          const n = notes.find(
            nt =>
              nt.ed_semester_note_studentcode == stu.ed_student_id &&
              nt.ed_semester_note_subject == sub.ed_subject_id
          );

          const p1 = n ? Number(n.ed_semester_note_p1) : 0;
          const p2 = n ? Number(n.ed_semester_note_p2) : 0;
          const exam = n ? Number(n.ed_semester_note_exam) : 0;
          const specialexam = n ? Number(n.ed_semester_note_specialexam) : 0;

          const md = (p1 + p2) / 2;
          const finalScore =
            md > 13
              ? md
              : exam > 0
              ? Math.round((md + exam) / 2)
              : specialexam;

          return {
            subject_id: sub.ed_subject_id,
            subject_name: sub.ed_subject_title,
            p1,
            p2,
            exam,
            specialexam,
            md,
            final: finalScore
          };
        });

        return {
          student_id: stu.ed_student_id,
          student_name: stu.ed_student_name,
          student_code: stu.ed_student_code,
          gender: stu.ed_student_gender,
          birth_date: stu.ed_student_birthday,
          bi: stu.ed_student_identityCard,
          picture: stu.ed_student_picture,
          nationality: stu.ed_student_nacionality,
          address: stu.ed_student_address,

          notes: stuNotes,

          // MÉDIA GERAL DO TRIMESTRE (usado no ranking)
          trimester_average:
            stuNotes.reduce((sum, n) => sum + (n.final || 0), 0) /
            (stuNotes.length || 1)
        };
      });

      //---------------------------------------------
      // 2.5 MONTAR OBJETO FINAL DA TURMA
      //---------------------------------------------
      finalData.push({
        class_id: cls.ed_class_id,
        class_title: cls.ed_class_title,
        course: cls.ed_course_title,
        level: cls.ed_academic_level_title,
        cicle: cls.ed_cicle_title,
        room: cls.ed_classroom_title,
        faculty: cls.ed_faculty_title,
        academic_year: cls.ed_academic_year_title,
        subjects,
        students: processedStudents
      });
    }

    // ---------------------------
    // RESPOSTA FINAL
    // ---------------------------
    return res.status(200).json({
      semester,
      total_classes: finalData.length,
      classes: finalData
    });

  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, error: err.message });
  }
};

 
module.exports = {
   GetsingleClassScoreByNumber, GetSemesterNotes, GetsingleSemesterNote, GetSingleSemesterNotebYSubStdQrtTypeClass,
   GetsingleSemesterNotebYQrtSub, GetsingleSemesterNotebYSubCls, GetsingleSemesterNoteByID, GetAllSubjectsNotesByStudent,
   RegisterSemesterNote, SemesterNoteUpdate, SemesterNoteDelete, GetsingleStudentSemesterNotebYCls, GetAllNotesByTrimester,
     ListSemesterNotes, 
};



