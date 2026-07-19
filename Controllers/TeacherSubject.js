const fs   = require("fs").promises;  // ← MUDANÇA: .promises para async
const path = require("path");
const ExecuteQuery = require("../Functions/ExecuteQuery");
const { RegisterAuditAction } = require("./Auditory");

const GetTeacherSubjects = async (req, res) => {
   try {
      const { CODE } = req.params;
      console.log("employee =", CODE)
      const query = 'SELECT * FROM eduall_teacher_subjects WHERE ed_tch_subject_deleted = 0 AND ed_tch_subject_teacher_code = ? AND ed_tch_subject_institute_code = ?';
      const PARAMS = [CODE, req.session.user.eduall_user_session_curentinstitute];
      const rows = await ExecuteQuery(res, query, PARAMS, true, { db: "eduall_teacher_subjects", type: "select", data: req });
      res.status(200).json(rows);
   } catch (err) {
      res.status(400).json({ status: 300, success: false, msg: err.message });
   }
};




 

const GetTeacherSubjectsData = async (req, res) => {
  try {
    const instituteCode = req.session?.user?.eduall_user_session_curentinstitute;

    if (!instituteCode) {
      return res.status(400).json({
        success: false,
        message: "Código da instituição não encontrado na sessão.",
      });
    }

    /* ══════════════════════════════════════════════════════════
       1. Todos os professores da instituição
    ══════════════════════════════════════════════════════════ */
    const teachersQuery = `
      SELECT *
      FROM eduall_employees
      WHERE ed_employee_deleted = 0
        AND ed_employee_institute_code = ?
      ORDER BY ed_employee_name ASC
    `;
    const teachers = await ExecuteQuery(res, teachersQuery, [instituteCode], true, {
      db: "eduall_employees", type: "select", data: req,
    });

    /* ══════════════════════════════════════════════════════════
       2. Disciplinas atribuídas
    ══════════════════════════════════════════════════════════ */
    const teacherSubjectsQuery = `
      SELECT
        ts.*,
        s.ed_subject_title,
        c.ed_class_title,
        c.ed_class_id,
        ay.ed_academic_year_title,
        cr.ed_classroom_title,
        co.ed_course_title,
        al.ed_academic_level_title,
        e.ed_employee_id AS matched_employee_id
      FROM eduall_teacher_subjects ts
      INNER JOIN eduall_employees e
        ON CAST(e.ed_employee_id AS CHAR) = CAST(ts.ed_tch_subject_teacher_code AS CHAR)
        AND e.ed_employee_deleted = 0
        AND e.ed_employee_institute_code = ?
      LEFT JOIN eduall_subjects s
        ON s.ed_subject_id = ts.ed_tch_subject_code
        AND s.ed_subject_deleted = 0
      LEFT JOIN eduall_class c
        ON c.ed_class_id = ts.ed_tch_subject_class
        AND c.ed_class_deleted = 0
      LEFT JOIN eduall_academic_year ay
        ON ay.ed_academic_year_id = c.ed_class_year
        AND ay.ed_academic_year_deleted = 0
      LEFT JOIN eduall_classrooms cr
        ON cr.ed_classroom_id = c.ed_class_room
        AND cr.ed_classroom_deleted = 0
      LEFT JOIN eduall_courses co
        ON co.ed_course_id = c.ed_class_course
        AND co.ed_course_deleted = 0
      LEFT JOIN eduall_academic_level al
        ON al.ed_academic_level_id = c.ed_class_academic_level
        AND al.ed_academic_level_deleted = 0
      WHERE ts.ed_tch_subject_deleted = 0
        AND ts.ed_tch_subject_institute_code = ?
    `;
    const teacherSubjects = await ExecuteQuery(
      res, teacherSubjectsQuery, [instituteCode, instituteCode], true,
      { db: "eduall_teacher_subjects", type: "select", data: req }
    );

    /* ══════════════════════════════════════════════════════════
       3. Horários
    ══════════════════════════════════════════════════════════ */
    const timingQuery = `
      SELECT
        tt.*,
        t.ed_timing_hour_start,
        t.ed_timing_minute_start,
        t.ed_timing_hour_end,
        t.ed_timing_minute_end,
        c.ed_class_title,
        c.ed_class_id,
        s.ed_subject_title,
        e.ed_employee_id AS matched_employee_id
      FROM eduall_teacher_timings tt
      INNER JOIN eduall_employees e
        ON CAST(e.ed_employee_id AS CHAR) = CAST(tt.ed_tch_timing_teacher_code AS CHAR)
        AND e.ed_employee_deleted = 0
        AND e.ed_employee_institute_code = ?
      LEFT JOIN eduall_timing t
        ON t.ed_timing_id = tt.ed_tch_timing_code
        AND t.ed_timing_deleted = 0
      LEFT JOIN eduall_class c
        ON c.ed_class_id = tt.ed_tch_timing_class
        AND c.ed_class_deleted = 0
      LEFT JOIN eduall_subjects s
        ON s.ed_subject_id = tt.ed_tch_timing_subject
        AND s.ed_subject_deleted = 0
      WHERE tt.ed_tch_timing_deleted = 0
        AND tt.ed_tch_timing_institute_code = ?
    `;
    let teacherTimings = await ExecuteQuery(
      res, timingQuery, [instituteCode, instituteCode], true,
      { db: "eduall_teacher_timings", type: "select", data: req }
    );

    teacherTimings = teacherTimings.map((tm) => ({
      ...tm,
      ed_timing_hour_start:   tm.ed_timing_hour_start   ?? 0,
      ed_timing_minute_start: tm.ed_timing_minute_start ?? 0,
      ed_timing_hour_end:     tm.ed_timing_hour_end     ?? 0,
      ed_timing_minute_end:   tm.ed_timing_minute_end   ?? 0,
    }));

    const normalizeTitles = (obj) => {
      const out = { ...obj };
      for (const key in out) {
        if (
          key.toLowerCase().includes("title") &&
          (out[key] === null || out[key] === undefined || out[key] === "")
        ) {
          out[key] = "—";
        }
      }
      return out;
    };

    /* ══════════════════════════════════════════════════════════
       4. Montar resultado final
    ══════════════════════════════════════════════════════════ */
    const result = teachers.map((teacher) => {
      const teacherId = String(teacher.ed_employee_id);
      const assignedSubjects = teacherSubjects
        .filter((ts) => String(ts.matched_employee_id) === teacherId)
        .map(normalizeTitles);
      const assignedTimings = teacherTimings
        .filter((tm) => String(tm.matched_employee_id) === teacherId)
        .map(normalizeTitles);
      return { employee: teacher, assignedSubjects, assignedTimings };
    });

    /* ══════════════════════════════════════════════════════════
       5. Gerar ficheiro TXT
          Caminho: <dir deste controller>/logs/teachers_report_YYYYMMDD_HHMMSS.txt
    ══════════════════════════════════════════════════════════ */

    const pad  = (str, n) => String(str ?? "—").substring(0, n).padEnd(n);
    const days = ["—", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"];
    const hhmm = (h, m) =>
      `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;

    // Timestamp
    const now       = new Date();
    const yyyy      = now.getFullYear();
    const mo        = String(now.getMonth() + 1).padStart(2, "0");
    const dd        = String(now.getDate()).padStart(2, "0");
    const hh        = String(now.getHours()).padStart(2, "0");
    const mi        = String(now.getMinutes()).padStart(2, "0");
    const ss        = String(now.getSeconds()).padStart(2, "0");
    const dateLabel = `${dd}/${mo}/${yyyy}`;
    const timeLabel = `${hh}:${mi}:${ss}`;
    const fileStamp = `${yyyy}${mo}${dd}_${hh}${mi}${ss}`;

    const W   = 82;
    const SEP = "═".repeat(W);
    const sep = "─".repeat(W);

    const lines = [];
    const L = (str = "") => lines.push(str);

    // ── Cabeçalho ──
    L(SEP);
    L(`  EDUALL — RELATÓRIO DE PROFESSORES, DISCIPLINAS E HORÁRIOS`);
    L(`  Instituto          : ${instituteCode}`);
    L(`  Data de geração    : ${dateLabel}   ${timeLabel}`);
    L(`  Total de professores: ${result.length}`);
    L(SEP);
    L();

    result.forEach(({ employee: t, assignedSubjects, assignedTimings }, idx) => {
      const name   = t.ed_employee_name    ?? "—";
      const id     = t.ed_employee_id      ?? "—";
      const charge = t.ed_employee_charge  ?? "—";
      const email  = t.ed_employee_email   ?? "—";
      const phone  = t.ed_employee_phone   ?? "—";
      const nif    = t.ed_employee_nif     ?? "—";
      const gender = t.ed_employee_gender  ?? "—";
      const bday   = t.ed_employee_birthday ?? "—";
      const civil  = t.ed_employee_civil_state ?? "—";
      const status = t.ed_employee_status === 1 ? "ATIVO" : "INATIVO";

      // Cabeçalho do professor
      L(`┌${sep}┐`);
      L(`│  #${String(idx + 1).padEnd(5)}${name.padEnd(48)}  ID: ${String(id).padEnd(8)}  ${status.padEnd(9)}│`);
      L(`│  Cargo     : ${pad(charge, 67)}│`);
      L(`│  Email     : ${pad(email,  67)}│`);
      L(`│  Telefone  : ${pad(phone,  20)}  NIF: ${pad(nif, 15)}  Género: ${pad(gender, 12)}│`);
      L(`│  Nasc.     : ${pad(bday,   15)}  Estado civil: ${pad(civil, 38)}│`);
      L(`├${sep}┤`);

      // ── Disciplinas ──
      if (assignedSubjects.length === 0) {
        L(`│  (sem disciplinas atribuídas)${" ".repeat(W - 30)}│`);
      } else {
        L(`│  DISCIPLINAS (${assignedSubjects.length})${" ".repeat(Math.max(1, W - 16 - String(assignedSubjects.length).length))}│`);
        L(`│  ${"#".padEnd(3)} ${"Disciplina".padEnd(22)} ${"Turma".padEnd(12)} ${"Ano Letivo".padEnd(14)} ${"Curso".padEnd(16)} ${"Nível".padEnd(9)}│`);
        L(`│  ${sep.substring(0, W - 4)}  │`);
        assignedSubjects.forEach((s, si) => {
          const row =
            `${String(si + 1).padEnd(3)} ` +
            `${pad(s.ed_subject_title,        22)} ` +
            `${pad(s.ed_class_title,          12)} ` +
            `${pad(s.ed_academic_year_title,  14)} ` +
            `${pad(s.ed_course_title,         16)} ` +
            `${pad(s.ed_academic_level_title,  9)}`;
          L(`│    ${row}│`);
        });
      }

      L(`├${sep}┤`);

      // ── Horários ──
      if (assignedTimings.length === 0) {
        L(`│  (sem horários atribuídos)${" ".repeat(W - 27)}│`);
      } else {
        L(`│  HORÁRIOS (${assignedTimings.length})${" ".repeat(Math.max(1, W - 13 - String(assignedTimings.length).length))}│`);
        L(`│  ${"#".padEnd(3)} ${"Dia".padEnd(5)} ${"Início".padEnd(8)} ${"Fim".padEnd(8)} ${"Disciplina".padEnd(22)} ${"Turma".padEnd(13)} ${"Cód. Timing".padEnd(14)}│`);
        L(`│  ${sep.substring(0, W - 4)}  │`);
        assignedTimings.forEach((tm, ti) => {
          const day   = days[tm.ed_tch_timing_weekday] ?? "—";
          const start = hhmm(tm.ed_timing_hour_start, tm.ed_timing_minute_start);
          const end   = hhmm(tm.ed_timing_hour_end,   tm.ed_timing_minute_end);
          const row   =
            `${String(ti + 1).padEnd(3)} ` +
            `${pad(day,                    5)} ` +
            `${pad(start,                  8)} ` +
            `${pad(end,                    8)} ` +
            `${pad(tm.ed_subject_title,   22)} ` +
            `${pad(tm.ed_class_title,     13)} ` +
            `${pad(tm.ed_tch_timing_code, 14)}`;
          L(`│    ${row}│`);
        });
      }

      L(`└${sep}┘`);
      L();
    });

    // ── Totais finais ──
    const totalSubs = result.reduce((a, r) => a + r.assignedSubjects.length, 0);
    const totalTims = result.reduce((a, r) => a + r.assignedTimings.length, 0);
    const semDisc   = result.filter(r => r.assignedSubjects.length === 0).length;
    const semHor    = result.filter(r => r.assignedTimings.length  === 0).length;

    L(SEP);
    L(`  TOTAIS GERAIS`);
    L(`  Professores listados  : ${result.length}`);
    L(`  Sem disciplinas       : ${semDisc}`);
    L(`  Sem horários          : ${semHor}`);
    L(`  Total de disciplinas  : ${totalSubs}`);
    L(`  Total de horários     : ${totalTims}`);
    L(SEP);
    L(`  Gerado em ${dateLabel} às ${timeLabel}`);
    L(SEP);

    // ── Escrever ficheiro ──
    const logsDir  = path.join(__dirname, "logs");
    const fileName = `teachers_report_${fileStamp}.txt`;
    const filePath = path.join(logsDir, fileName);

    // Verificar se diretório existe, se não, criar
    try {
      await fs.stat(logsDir);  // ← MUDANÇA: await fs.stat
    } catch {
      await fs.mkdir(logsDir, { recursive: true });  // ← MUDANÇA: await fs.mkdir
    }

    await fs.writeFile(filePath, lines.join("\n"), "utf8");  // ← MUDANÇA: await fs.writeFile

    console.log(`\n📄  Relatório gerado: ${filePath}\n`);

    res.status(200).json(result);

  } catch (err) {
    console.error("Erro em GetTeacherSubjectsData:", err);
    res.status(500).json({
      success: false,
      message: "Erro ao obter dados dos professores.",
      error: err.message,
    });
  }
};





const GetSingleTeacherSubject = async (req, res) => {
   try {
      const { ID, CODE, CLASS } = req.params;
      const query = `SELECT * FROM eduall_teacher_subjects WHERE ed_tch_subject_deleted = 0  
         AND ed_tch_subject_teacher_code = ? AND ed_tch_subject_code = ? AND ed_tch_subject_class = ? AND ed_tch_subject_institute_code = ?`;
      const PARAMS = [CODE, ID, CLASS, req.session.user.eduall_user_session_curentinstitute];
      const rows = await ExecuteQuery(res, query, PARAMS, true, { db: "eduall_teacher_subjects", type: "select", data: req });
      res.status(200).json(rows); 
   } catch (err) {
      res.status(400).json({ status: 300, success: false, msg: err.message });
   }
};

const GetSingleTeacherSubjectById = async (req, res) => {
   try {
      const { ID } = req.params;
      const query = `SELECT * FROM eduall_teacher_subjects 
         LEFT JOIN eduall_subjects ON ed_subject_id = ed_tch_subject_code 
         LEFT JOIN eduall_class ON ed_class_id = ed_tch_subject_class 
         WHERE eduall_class.ed_class_deleted = 0  AND eduall_subjects.ed_subject_deleted = 0 AND 
         ed_tch_subject_deleted = 0 AND ed_tch_subject_id = ? AND ed_tch_subject_institute_code = ?`;
      const PARAMS = [ID, req.session.user.eduall_user_session_curentinstitute];
      const rows = await ExecuteQuery(res, query, PARAMS, true, { db: "eduall_teacher_subjects", type: "select", data: req });
      res.status(200).json(rows);
   } catch (err) {
      res.status(400).json({ status: 300, success: false, msg: err.message });
   }
};

 





const TeacherSubjectDelete = async (req, res) => {
   try {
      const { ID } = req.params;
      const query = `UPDATE eduall_teacher_subjects SET ed_tch_subject_deleted = 1
         WHERE ed_tch_subject_deleted = 0 AND ed_tch_subject_id = ? AND ed_tch_subject_institute_code = ?`;
      const PARAMS = [ID, req.session.user.eduall_user_session_curentinstitute];

      await ExecuteQuery(res, query, PARAMS, false, { db: "eduall_teacher_subjects", type: "update", data: req });

      await RegisterAuditAction({
         session: req.session,
         action: 3, // Exclusão
         form: "Disciplinas dos Professores",
         description: `Removeu a atribuição da disciplina com ID ${ID} dos professores`,
      });

      res.status(200).json({ success: true, msg: "Disciplina do professor removida com sucesso." });
   } catch (err) {
      res.status(400).json({ status: 300, success: false, msg: err.message });
   }
};


 
const isFilled = (v) => String(v ?? "").trim() !== "";

const sendError = (res, httpStatus, code, msg, details = null) => { 
  const payload = { success: false, code, msg };
  if (details) payload.details = details;
  return res.status(httpStatus).json(payload);
};

const sendOk = (res, payload = {}) => res.status(200).json({ success: true, ...payload });

const dbFailMsg = "Ocorreu um erro ao comunicar com a base de dados.";

const RegisterTeacherSubject = async (req, res) => {
  try {
    const institute = req?.session?.user?.eduall_user_session_curentinstitute;

    const teacherCode = String(req.body.teacher_subject_teacher_code ?? "").trim();
    const classId = String(req.body.teacher_subject_class ?? "").trim();
    const subjectId = String(req.body.teacher_subject_code ?? "").trim();

    //  validação simples (PT-PT)
    if (!isFilled(institute)) {
      return sendError(res, 401, "SEM_INSTITUICAO", "Sessão inválida. Volte a iniciar sessão.");
    }
    if (!isFilled(teacherCode) || !isFilled(classId) || !isFilled(subjectId)) {
      return sendError(
        res,
        400,
        "CAMPOS_EM_FALTA",
        "Faltam dados. Escolha professor, turma e disciplina."
      );
    }

    // 1) já existe para o mesmo professor (turma + disciplina)
    const existingOwn = await ExecuteQuery(
      res,
      `SELECT ed_tch_subject_id FROM eduall_teacher_subjects
       WHERE ed_tch_subject_class = ?
         AND ed_tch_subject_teacher_code = ?
         AND ed_tch_subject_code = ?
         AND ed_tch_subject_institute_code = ?
         AND ed_tch_subject_deleted = 0
       LIMIT 1`,
      [classId, teacherCode, subjectId, institute],
      true,
      { db: "eduall_teacher_subjects", type: "select", data: req }
    );

    if (Array.isArray(existingOwn) && existingOwn.length > 0) {
      return sendError(
        res,
        400,
        "DUPLICADO_PROFESSOR",
        "Este professor já tem esta disciplina atribuída nesta turma."
      );
    }

    // 2) já existe para outro professor (mesma turma + disciplina)
    const existingOther = await ExecuteQuery(
      res,
      `SELECT ed_tch_subject_id FROM eduall_teacher_subjects
       WHERE ed_tch_subject_class = ?
         AND ed_tch_subject_code = ?
         AND ed_tch_subject_institute_code = ?
         AND ed_tch_subject_teacher_code != ?
         AND ed_tch_subject_deleted = 0
       LIMIT 1`,
      [classId, subjectId, institute, teacherCode],
      true,
      { db: "eduall_teacher_subjects", type: "select", data: req }
    );

    if (Array.isArray(existingOther) && existingOther.length > 0) {
      return sendError(
        res,
        400,
        "CONFLITO_OUTRO_PROFESSOR",
        "Esta disciplina já está atribuída a outro professor nesta turma."
      );
    }

    // 3) inserir
    const rows = await ExecuteQuery(
      res,
      `INSERT INTO eduall_teacher_subjects
        (ed_tch_subject_code, ed_tch_subject_class, ed_tch_subject_teacher_code, ed_tch_subject_institute_code)
       VALUES (?,?,?,?)`,
      [subjectId, classId, teacherCode, institute],
      false,
      { db: "eduall_teacher_subjects", type: "insert", data: req }
    );

    await RegisterAuditAction({
      session: req.session,
      action: 1,
      form: "Disciplinas dos Professores",
      description: `Atribuiu uma disciplina ao professor (ID: ${teacherCode})`,
    });

    return sendOk(res, { msg: "Disciplina atribuída com sucesso.", data: rows });
  } catch (err) { 
    return sendError(res, 500, "ERRO_SERVIDOR", dbFailMsg, err?.message ? { debug: err.message } : null);
  }
};

const UpdateTeacherSubject = async (req, res) => {
  try {
    const { ID } = req.params;
    const institute = req?.session?.user?.eduall_user_session_curentinstitute;

    const classId = String(req.body.teacher_subject_class ?? "").trim();
    const subjectId = String(req.body.teacher_subject_code ?? "").trim();

    if (!isFilled(institute)) {
      return sendError(res, 401, "SEM_INSTITUICAO", "Sessão inválida. Volte a iniciar sessão.");
    }
    if (!isFilled(ID)) {
      return sendError(res, 400, "ID_INVALIDO", "ID inválido.");
    }
    if (!isFilled(classId) || !isFilled(subjectId)) {
      return sendError(res, 400, "CAMPOS_EM_FALTA", "Faltam dados. Escolha turma e disciplina.");
    }

    // 1) buscar registo
    const current = await ExecuteQuery(
      res,
      `SELECT ed_tch_subject_id, ed_tch_subject_teacher_code
         FROM eduall_teacher_subjects
        WHERE ed_tch_subject_id = ?
          AND ed_tch_subject_institute_code = ?
          AND ed_tch_subject_deleted = 0
        LIMIT 1`,
      [ID, institute],
      true,
      { db: "eduall_teacher_subjects", type: "select", data: req }
    );

    if (!Array.isArray(current) || !current.length) {
      return sendError(res, 404, "NAO_ENCONTRADO", "Não foi possível encontrar este registo.");
    }

    const teacherCode = String(current[0].ed_tch_subject_teacher_code ?? "").trim();

    // 2) evitar duplicado para o mesmo professor
    const dup = await ExecuteQuery(
      res,
      `SELECT ed_tch_subject_id FROM eduall_teacher_subjects
       WHERE ed_tch_subject_deleted = 0
         AND ed_tch_subject_institute_code = ?
         AND ed_tch_subject_teacher_code = ?
         AND ed_tch_subject_class = ?
         AND ed_tch_subject_code = ?
         AND ed_tch_subject_id != ?
       LIMIT 1`,
      [institute, teacherCode, classId, subjectId, ID],
      true,
      { db: "eduall_teacher_subjects", type: "select", data: req }
    );

    if (Array.isArray(dup) && dup.length) {
      return sendError(
        res,
        400,
        "DUPLICADO_PROFESSOR",
        "Este professor já tem esta disciplina atribuída nesta turma."
      );
    }

    // 3) evitar conflito com outro professor (mesma turma + disciplina)
    const conflict = await ExecuteQuery(
      res,
      `SELECT ed_tch_subject_id FROM eduall_teacher_subjects
       WHERE ed_tch_subject_deleted = 0
         AND ed_tch_subject_institute_code = ?
         AND ed_tch_subject_class = ?
         AND ed_tch_subject_code = ?  
         AND ed_tch_subject_teacher_code != ?
       LIMIT 1`,
      [institute, classId, subjectId, teacherCode],
      true,
      { db: "eduall_teacher_subjects", type: "select", data: req }
    );

    if (Array.isArray(conflict) && conflict.length) {
      return sendError(
        res,
        400,
        "CONFLITO_OUTRO_PROFESSOR",
        "Esta disciplina já está atribuída a outro professor nesta turma."
      );
    }

    // 4) actualizar
    await ExecuteQuery(
      res,
      `UPDATE eduall_teacher_subjects
          SET ed_tch_subject_class = ?, ed_tch_subject_code = ?
        WHERE ed_tch_subject_id = ?
          AND ed_tch_subject_institute_code = ?
          AND ed_tch_subject_deleted = 0`,
      [classId, subjectId, ID, institute],
      false,
      { db: "eduall_teacher_subjects", type: "update", data: req }
    );

    await RegisterAuditAction({
      session: req.session,
      action: 2,
      form: "Disciplinas dos Professores",
      description: `Atualizou uma atribuição de disciplina (ID: ${ID})`,
    });

    return sendOk(res, { msg: "Atualizado com sucesso." });
  } catch (err) {
    return sendError(res, 500, "ERRO_SERVIDOR", dbFailMsg, err?.message ? { debug: err.message } : null);
  }
};
 

module.exports = { 
   TeacherSubjectDelete, 
   GetTeacherSubjects, 
   GetSingleTeacherSubjectById,
   GetTeacherSubjectsData, 
   GetSingleTeacherSubject, 
   RegisterTeacherSubject,
   UpdateTeacherSubject 
};