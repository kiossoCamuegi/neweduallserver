const ExecuteQuery = require("../Functions/ExecuteQuery");
const { RegisterAuditAction } = require("./Auditory");
const { CheckQuarterlyNotePermission } = require("./NotesRestrictions");

const GetQuarterlyNotes = async (req, res) => {
    try {
        const query = `SELECT * FROM eduall_quarterly_notes  
        LEFT JOIN eduall_students ON eduall_students.ed_student_id = eduall_quarterly_notes.ed_quarter_note_studentcode
        WHERE ed_quarter_note_deleted = 0 AND ed_quarter_note_institute_code = ?`; 
        const PARAMS = [req.session.user.eduall_user_session_curentinstitute];
        const rows = await ExecuteQuery(res, query, PARAMS, true, { db: "eduall_quarterly_notes", type: "select", data: req });
        res.status(200).json(rows);
    } catch (error) {
        res.status(500).json({ success: false, message: "Failed to fetch quarterly notes!", error: error.message });
    }
}; 

const GetsingleQuarterlyNote = async (req, res) => {
    try {
        const { STUDENTCODE } = req.params; 
        const query = `SELECT * FROM eduall_quarterly_notes 
        LEFT JOIN eduall_class 
        ON eduall_class.ed_class_id = eduall_quarterly_notes.ed_quarter_note_class
        LEFT JOIN eduall_academic_level ON eduall_academic_level.ed_academic_level_id  = eduall_class.ed_class_academic_level
        LEFT JOIN eduall_students ON eduall_students.ed_student_id = eduall_quarterly_notes.ed_quarter_note_studentcode 
        AND eduall_students.ed_student_class = eduall_quarterly_notes.ed_quarter_note_class
        WHERE ed_quarter_note_deleted = 0 AND ed_quarter_note_studentcode = ? AND ed_quarter_note_institute_code = ?`; 
        const PARAMS = [STUDENTCODE, req.session.user.eduall_user_session_curentinstitute];
        const rows = await ExecuteQuery(res, query, PARAMS, true, { db: "eduall_quarterly_notes", type: "select", data: req });
        res.status(200).json(rows);
    } catch (error) {
        res.status(500).json({ success: false, message: "Failed to fetch the quarterly note!", error: error.message });
    }
};

const GetsingleQuarterlyNotebYQrtSub = async (req, res) => {
    try {
        const { QUARTER, SUBJECT, CLASS } = req.params;

          console.log({ QUARTER, SUBJECT, CLASS });

          const query = `
          SELECT * FROM eduall_quarterly_notes

          LEFT JOIN eduall_students 
            ON eduall_students.ed_student_id = ed_quarter_note_studentcode 
            AND eduall_students.ed_student_deleted = 0

          LEFT JOIN eduall_class 
            ON eduall_class.ed_class_id = eduall_quarterly_notes.ed_quarter_note_class  
            AND eduall_class.ed_class_deleted = 0

          LEFT JOIN eduall_academic_level 
            ON eduall_academic_level.ed_academic_level_id = eduall_class.ed_class_academic_level 
            AND eduall_academic_level.ed_academic_level_deleted = 0

          WHERE ed_quarter_note_quarter = ?
          AND ed_quarter_note_subject = ?
          AND ed_quarter_note_deleted = 0
          AND ed_quarter_note_institute_code = ?
          AND ed_quarter_note_class = ?
          `;

          const PARAMS = [
            Number(QUARTER),
            Number(SUBJECT),
            req.session.user.eduall_user_session_curentinstitute,
            Number(CLASS)
          ];



        /*


        

        const query = `SELECT * FROM eduall_quarterly_notes 

        LEFT JOIN eduall_class ON eduall_class.ed_class_id = eduall_quarterly_notes.ed_quarter_note_class 
        LEFT JOIN eduall_academic_level ON eduall_academic_level.ed_academic_level_id  = eduall_class.ed_class_academic_level

        LEFT JOIN eduall_students ON eduall_students.ed_student_id = eduall_quarterly_notes.ed_quarter_note_studentcode


       

        WHERE ed_quarter_note_quarter = ? AND ed_quarter_note_subject = ? 
        AND ed_quarter_note_class = ? AND ed_quarter_note_deleted = 0 AND eduall_students.ed_student_class = ?  AND ed_quarter_note_institute_code = ?`; 


        const PARAMS = [QUARTER, SUBJECT, CLASS*1, CLASS*1,  req.session.user.eduall_user_session_curentinstitute];



        */
        const rows = await ExecuteQuery(res, query, PARAMS, true, { db: "eduall_quarterly_notes", type: "select", data: req });
        res.status(200).json(rows);
    } catch (error) {
        res.status(500).json({ success: false, message: "Failed to fetch the quarterly note by quarter and subject!", error: error.message });
    }
};

const GetsingleQuarterlyNoteByID = async (req, res) => {
    try {
        const { ID } = req.params; 
        const query = `SELECT * FROM eduall_quarterly_notes 
        LEFT JOIN eduall_class 
        ON eduall_class.ed_class_id = eduall_quarterly_notes.ed_quarter_note_class
        LEFT JOIN eduall_academic_level ON eduall_academic_level.ed_academic_level_id  = eduall_class.ed_class_academic_level
        LEFT JOIN eduall_students ON eduall_students.ed_student_id = eduall_quarterly_notes.ed_quarter_note_studentcode
        WHERE ed_quarter_note_id = ? AND ed_quarter_note_deleted = 0 AND ed_quarter_note_institute_code = ?`; 
        const PARAMS = [ID, req.session.user.eduall_user_session_curentinstitute];
        const rows = await ExecuteQuery(res, query, PARAMS, true, { db: "eduall_quarterly_notes", type: "select", data: req });
        res.status(200).json(rows);
    } catch (error) {
        res.status(500).json({ success: false, message: "Failed to fetch the quarterly note by ID!", error: error.message });
    }
};






/// codee do  notas triemstarsi no ficheito dee notas trimestrais
const GetsingleQuarterlyNotebYSubCls = async (req, res) => {
    try {
        const { SUBJECT, CLASS } = req.params; 
        const query = `SELECT * FROM eduall_quarterly_notes  
        LEFT JOIN eduall_class 
        ON eduall_class.ed_class_id = eduall_quarterly_notes.ed_quarter_note_class
        LEFT JOIN eduall_academic_level ON eduall_academic_level.ed_academic_level_id  = eduall_class.ed_class_academic_level
        LEFT JOIN eduall_students ON eduall_students.ed_student_id = eduall_quarterly_notes.ed_quarter_note_studentcode
        WHERE ed_quarter_note_subject = ? AND ed_quarter_note_deleted = 0
        AND ed_quarter_note_subject = ? AND ed_quarter_note_class = ? AND ed_quarter_note_institute_code = ?`; 
        const PARAMS = [SUBJECT, CLASS, req.session.user.eduall_user_session_curentinstitute];
        const rows = await ExecuteQuery(res, query, PARAMS, true, { db: "eduall_quarterly_notes", type: "select", data: req });
        res.status(200).json(rows);
    } catch (error) {
        res.status(500).json({ success: false, message: "Failed to fetch the quarterly notes by subject and class!", error: error.message });
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

async function FindQuarterlyNoteId(res, req, { student_code, subject_id, class_id, quarter }) {
  const inst = req.session.user.eduall_user_session_curentinstitute;
  const sql = `
    SELECT ed_quarter_note_id
    FROM eduall_quarterly_notes
    WHERE ed_quarter_note_deleted = 0
      AND ed_quarter_note_studentcode = ?
      AND ed_quarter_note_subject = ?
      AND ed_quarter_note_class = ?
      AND ed_quarter_note_quarter = ?
      AND ed_quarter_note_institute_code = ?
    LIMIT 1
  `;
  const rows = await ExecuteQuery(res, sql, [student_code, subject_id, class_id, quarter, inst], true, {
    db: "eduall_quarterly_notes",
    type: "select",
    data: req,
  });
  return Array.isArray(rows) && rows.length ? rows[0].ed_quarter_note_id : null;
}

//  LIST: todas as notas da turma/disciplina/trimestre (para preencher inputs)
const ListQuarterlyNotes = async (req, res) => {
  try {
    const inst = req.session?.user?.eduall_user_session_curentinstitute;
    if (!inst) return res.status(401).json({ success: false, msg: "Sessão inválida." });

    const { QUARTER, SUBJECT, CLASS } = req.params;

    const query = `
      SELECT *
      FROM eduall_quarterly_notes
      LEFT JOIN eduall_class ON eduall_class.ed_class_id = eduall_quarterly_notes.ed_quarter_note_class
      LEFT JOIN eduall_academic_level ON eduall_academic_level.ed_academic_level_id = eduall_class.ed_class_academic_level
      LEFT JOIN eduall_students ON eduall_students.ed_student_id = eduall_quarterly_notes.ed_quarter_note_studentcode
      WHERE ed_quarter_note_quarter = ?
        AND ed_quarter_note_subject = ?
        AND ed_quarter_note_class = ?
        AND ed_quarter_note_deleted = 0
        AND ed_quarter_note_institute_code = ?
    `;

    const rows = await ExecuteQuery(res, query, [QUARTER, SUBJECT, CLASS, inst], true, {
      db: "eduall_quarterly_notes",
      type: "select",
      data: req,
    });

    return res.status(200).json(rows);
  } catch (error) {
    return res.status(500).json({ success: false, msg: "Falha ao listar notas trimestrais.", error: error.message });
  }
};

//  UPSERT (bulk): se existir -> UPDATE, se não existir -> INSERT
const RegisterQuarterlyNote = async (req, res) => {
  sep2();
  console.log(`${tag.info} ${C.bold}RegisterQuarterlyNote${C.reset} — início`);
  console.log(`${C.dim}  Timestamp : ${new Date().toISOString()}${C.reset}`);
  console.log(`${C.dim}  IP        : ${req.ip || "n/a"}${C.reset}`);

  try {
    // ── 1. Sessão ─────────────────────────────────────────────────────────────
    sep();
    console.log(`${tag.step} ${C.bold}[1/6] Validar sessão${C.reset}`);

    const inst = req.session?.user?.eduall_user_session_curentinstitute;
    if (!inst) {
      console.log(`${tag.error} Sessão inválida — sem instituto na sessão.`);
      sep2();
      return res.status(401).json({
        success: false,
        msg: USER_ERRORS.SESSION_INVALID,
      });
    }
    console.log(`${tag.ok} Instituto: ${C.cyan}${inst}${C.reset}`);

    // ── 2. Body / items ───────────────────────────────────────────────────────
    sep();
    console.log(`${tag.step} ${C.bold}[2/6] Validar body / items${C.reset}`);

    const items = Array.isArray(req.body?.items) ? req.body.items : [];
    console.log(`${tag.info} Total de items recebidos: ${C.yellow}${items.length}${C.reset}`);

    if (!items.length) {
      console.log(`${tag.error} Body vazio ou items ausentes.`);
      console.log(`${C.dim}  Body recebido: ${fmt(req.body)}${C.reset}`);
      sep2();
      return res.status(400).json({
        success: false,
        msg: USER_ERRORS.NO_ITEMS,
      });
    }

    console.log(`${tag.ok} Items recebidos:\n${C.dim}${fmt(items)}${C.reset}`);

    // ── 3. Inicializar ────────────────────────────────────────────────────────
    sep();
    console.log(`${tag.step} ${C.bold}[3/6] Inicializar report e SQLs${C.reset}`);

    const report    = { inserted: 0, updated: 0, rejected: 0, errors: [] };
    const allowedMap = new Map();

    const insertSql = `
      INSERT INTO eduall_quarterly_notes(
        ed_quarter_note_studentcode,
        ed_quarter_note_subject,
        ed_quarter_note_quarter,
        ed_quarter_note_mac,
        ed_quarter_note_npp,
        ed_quarter_note_class,
        ed_quarter_note_npt,
        ed_quarter_note_institute_code
      ) VALUES(?,?,?,?,?,?,?,?)
    `;

    const updateSql = `
      UPDATE eduall_quarterly_notes
      SET ed_quarter_note_mac = ?,
          ed_quarter_note_npt = ?,
          ed_quarter_note_npp = ?
      WHERE ed_quarter_note_id = ?
        AND ed_quarter_note_institute_code = ?
        AND ed_quarter_note_deleted = 0
    `;

    console.log(`${tag.ok} SQLs prontos. A iniciar loop de ${C.yellow}${items.length}${C.reset} item(s).`);

    // ── 4. Loop de items ──────────────────────────────────────────────────────
    sep();
    console.log(`${tag.step} ${C.bold}[4/6] Processar cada item${C.reset}`);

    for (let i = 0; i < items.length; i++) {
      const it           = items[i] || {};
      sep();
      console.log(`${tag.info} ${C.bold}Item [${i + 1}/${items.length}]${C.reset}`);
      console.log(`${C.dim}  Payload bruto: ${fmt(it)}${C.reset}`);

      const student_code = Number(it.student_code);
      const class_id     = Number(it.class_id);
      const subject_id   = Number(it.subject_id);
      const quarter      = Number(it.quarter);
      const mac          = toNum(it.mac) ?? 0;
      const npt          = toNum(it.npt) ?? 0;
      const npp          = toNum(it.npp) ?? 0;

      console.log(
        `${tag.info} Campos parseados:`,
        `student_code=${C.cyan}${student_code}${C.reset}`,
        `class_id=${C.cyan}${class_id}${C.reset}`,
        `subject_id=${C.cyan}${subject_id}${C.reset}`,
        `quarter=${C.cyan}${quarter}${C.reset}`,
        `mac=${C.yellow}${mac}${C.reset}`,
        `npt=${C.yellow}${npt}${C.reset}`,
        `npp=${C.yellow}${npp}${C.reset}`
      );

      // 4a. Validação de IDs ──────────────────────────────────────────────────
      const idsOk =
        isValidId(student_code) &&
        isValidId(class_id) &&
        isValidId(subject_id) &&
        isValidId(quarter);

      if (!idsOk) {
        const userMsg = USER_ERRORS.INVALID_IDS(student_code, class_id, subject_id, quarter);
        console.log(`${tag.reject} ${C.red}IDs inválidos.${C.reset}`);
        console.log(`  isValidId(student_code=${student_code}) = ${C.red}${isValidId(student_code)}${C.reset}`);
        console.log(`  isValidId(class_id=${class_id})         = ${C.red}${isValidId(class_id)}${C.reset}`);
        console.log(`  isValidId(subject_id=${subject_id})     = ${C.red}${isValidId(subject_id)}${C.reset}`);
        console.log(`  isValidId(quarter=${quarter})           = ${C.red}${isValidId(quarter)}${C.reset}`);
        report.rejected++;
        report.errors.push({ index: i, reason: "IDs inválidos.", userMsg, item: it });
        continue;
      }
      console.log(`${tag.ok} IDs válidos.`);

      // 4b. Permissão pedagógica ──────────────────────────────────────────────
      console.log(`${tag.info} A verificar permissão para quarter=${C.cyan}${quarter}${C.reset}...`);
      let perm;
      try {
        perm = await CheckQuarterlyNotePermission(req, res, quarter);
        console.log(`${tag.info} Resultado da permissão: ${C.dim}${fmt(perm)}${C.reset}`);
      } catch (permErr) {
        const userMsg = USER_ERRORS.PERMISSION_EXCEPTION(permErr.message);
        console.log(`${tag.error} Excepção em CheckQuarterlyNotePermission: ${C.red}${permErr.message}${C.reset}`);
        console.error(permErr);
        report.rejected++;
        report.errors.push({ index: i, reason: `Excepção na permissão: ${permErr.message}`, userMsg, item: it });
        continue;
      }

      if (!perm?.allowed) {
        const userMsg = USER_ERRORS.PERMISSION_DENIED(quarter);
        console.log(`${tag.reject} ${C.red}Permissão negada.${C.reset} perm=${C.dim}${fmt(perm)}${C.reset}`);
        report.rejected++;
        report.errors.push({ index: i, reason: "Permissão pedagógica negada.", userMsg, item: it });
        continue;
      }
      console.log(`${tag.ok} Permissão concedida.`);

      // 4c. Disciplina vs. turma ──────────────────────────────────────────────
      console.log(`${tag.info} A verificar subject_id=${C.cyan}${subject_id}${C.reset} na class_id=${C.cyan}${class_id}${C.reset}...`);

      if (!allowedMap.has(class_id)) {
        console.log(`${tag.info} Cache vazia para class_id=${class_id}. A chamar GetAllowedSubjectsByClass...`);
        try {
          const allowedSubjects = await GetAllowedSubjectsByClass(res, req, class_id);
          console.log(`${tag.ok} Disciplinas permitidas: ${C.dim}${JSON.stringify(allowedSubjects)}${C.reset}`);
          allowedMap.set(class_id, new Set(allowedSubjects));
        } catch (subjErr) {
          const userMsg = USER_ERRORS.SUBJECT_FETCH_FAIL(subjErr.message);
          console.log(`${tag.error} Excepção em GetAllowedSubjectsByClass: ${C.red}${subjErr.message}${C.reset}`);
          console.error(subjErr);
          report.rejected++;
          report.errors.push({ index: i, reason: `Excepção ao obter disciplinas: ${subjErr.message}`, userMsg, item: it });
          continue;
        }
      } else {
        console.log(`${tag.info} A usar cache para class_id=${class_id}.`);
      }

      const allowedSet = allowedMap.get(class_id);
      console.log(
        `${tag.info} allowedSet size=${C.yellow}${allowedSet?.size ?? "n/a"}${C.reset}  has(${subject_id})=${C.yellow}${allowedSet?.has(subject_id)}${C.reset}`
      );

      if (allowedSet && allowedSet.size > 0 && !allowedSet.has(subject_id)) {
        const userMsg = USER_ERRORS.SUBJECT_NOT_IN_CLASS(subject_id, class_id);
        console.log(`${tag.reject} ${C.red}Disciplina ${subject_id} não associada à turma ${class_id}.${C.reset}`);
        report.rejected++;
        report.errors.push({ index: i, reason: "Disciplina não associada à turma.", userMsg, item: it });
        continue;
      }
      console.log(`${tag.ok} Disciplina válida para a turma.`);

      // 4d. Nota existente? ───────────────────────────────────────────────────
      console.log(`${tag.info} A procurar nota existente: student_code=${C.cyan}${student_code}${C.reset} subject=${C.cyan}${subject_id}${C.reset} class=${C.cyan}${class_id}${C.reset} quarter=${C.cyan}${quarter}${C.reset}...`);

      let noteId;
      try {
        noteId = await FindQuarterlyNoteId(res, req, { student_code, subject_id, class_id, quarter });
        console.log(`${tag.info} FindQuarterlyNoteId retornou: ${C.yellow}${noteId ?? "null (não existe)"}${C.reset}`);
      } catch (findErr) {
        const userMsg = USER_ERRORS.NOTE_FIND_FAIL(findErr.message);
        console.log(`${tag.error} Excepção em FindQuarterlyNoteId: ${C.red}${findErr.message}${C.reset}`);
        console.error(findErr);
        report.rejected++;
        report.errors.push({ index: i, reason: `Excepção ao procurar nota: ${findErr.message}`, userMsg, item: it });
        continue;
      }

      // 4e. INSERT ou UPDATE ──────────────────────────────────────────────────
      try {
        if (noteId) {
          console.log(`${tag.update} nota id=${C.cyan}${noteId}${C.reset} — a fazer UPDATE...`);
          console.log(`${C.dim}  Params: mac=${mac}, npt=${npt}, npp=${npp}, noteId=${noteId}, inst=${inst}${C.reset}`);

          const updateResult = await ExecuteQuery(
            res, updateSql,
            [mac, npt, npp, noteId, inst],
            false,
            { db: "eduall_quarterly_notes", type: "update", data: req }
          );

          console.log(`${tag.ok} ${C.bold}${C.cyan}UPDATE concluído.${C.reset} Resultado: ${C.dim}${fmt(updateResult)}${C.reset}`);
          report.updated++;
        } else {
          console.log(`${tag.insert} nota nova — a fazer INSERT...`);
          console.log(`${C.dim}  Params: student_code=${student_code}, subject_id=${subject_id}, quarter=${quarter}, mac=${mac}, npp=${npp}, class_id=${class_id}, npt=${npt}, inst=${inst}${C.reset}`);

          const insertResult = await ExecuteQuery(
            res, insertSql,
            [student_code, subject_id, quarter, mac, npp, class_id, npt, inst],
            false,
            { db: "eduall_quarterly_notes", type: "insert", data: req }
          );

          console.log(`${tag.ok} ${C.bold}${C.green}INSERT concluído.${C.reset} Resultado: ${C.dim}${fmt(insertResult)}${C.reset}`);
          report.inserted++;
        }
      } catch (dbErr) {
        const op      = noteId ? "update" : "insert";
        const userMsg = USER_ERRORS.DB_FAIL(op, dbErr.message);
        console.log(`${tag.error} ${C.red}Falha na query DB para item [${i}]:${C.reset} ${dbErr.message}`);
        console.error(dbErr);
        report.rejected++;
        report.errors.push({ index: i, reason: dbErr.message || "Falha ao inserir/actualizar.", userMsg, item: it });
      }
    }

    // ── 5. Auditoria ──────────────────────────────────────────────────────────
    sep();
    console.log(`${tag.step} ${C.bold}[5/6] Registar auditoria${C.reset}`);
    try {
      await RegisterAuditAction({
        session: req.session,
        action: 1,
        form: "Notas trimestrais (upsert bulk)",
        description: `Upsert: inseridos=${report.inserted}, actualizados=${report.updated}, rejeitados=${report.rejected}`,
      });
      console.log(`${tag.ok} Auditoria registada.`);
    } catch (auditErr) {
      console.log(`${tag.warn} Falha ao registar auditoria (não crítico): ${C.yellow}${auditErr.message}${C.reset}`);
    }

    // ── 6. Sumário + resposta ─────────────────────────────────────────────────
    sep();
    console.log(`${tag.step} ${C.bold}[6/6] Sumário final${C.reset}`);
    sep2();
    console.log(`${tag.summary}`);
    console.log(`  ${C.green}${C.bold}Inseridos   : ${report.inserted}${C.reset}`);
    console.log(`  ${C.cyan}${C.bold}Actualizados: ${report.updated}${C.reset}`);
    console.log(`  ${C.red}${C.bold}Rejeitados  : ${report.rejected}${C.reset}`);

    if (report.errors.length) {
      console.log(`\n  ${C.red}Erros detalhados:${C.reset}`);
      report.errors.forEach((e, idx) => {
        console.log(`  ${C.dim}[${idx}] index=${e.index} reason=${C.red}${e.reason}${C.reset}`);
        console.log(`       ${C.dim}item=${fmt(e.item)}${C.reset}`);
      });
    } else {
      console.log(`\n  ${C.green}Sem erros. Tudo processado com sucesso.${C.reset}`);
    }
    sep2();

    // Tudo rejeitado → 422
    if (report.rejected > 0 && report.inserted === 0 && report.updated === 0) {
      const userMessages = [...new Set(report.errors.map((e) => e.userMsg).filter(Boolean))];
      return res.status(422).json({
        success: false,
        msg:
          userMessages.length === 1
            ? userMessages[0]
            : `${report.rejected} nota(s) não puderam ser lançadas:\n• ${userMessages.join("\n• ")}`,
        report,
      });
    }

    // Parcialmente rejeitado → 207
    if (report.rejected > 0) {
      const userMessages = [...new Set(report.errors.map((e) => e.userMsg).filter(Boolean))];
      return res.status(207).json({
        success: true,
        msg: `${report.inserted + report.updated} nota(s) lançada(s) com sucesso. ${report.rejected} rejeitada(s):\n• ${userMessages.join("\n• ")}`,
        report,
      });
    }

    // Tudo OK → 200
    return res.status(200).json({
      success: true,
      msg: `${report.inserted} nota(s) inserida(s) e ${report.updated} actualizada(s) com sucesso.`,
      report,
    });

  } catch (error) {
    sep2();
    console.log(`${tag.error} ${C.bold}${C.red}ERRO GLOBAL não capturado:${C.reset} ${error.message}`);
    console.error(error);
    sep2();
    return res.status(500).json({
      success: false,
      msg: USER_ERRORS.GLOBAL(error.message),
      error: error.message,
    });
  }
};



const QuarterlyNoteDelete = async (req, res) => {
  try {

    
    const { ID } = req.params;
 
    const getQuarterQuery = `
      SELECT ed_quarter_note_quarter
      FROM eduall_quarterly_notes
      WHERE ed_quarter_note_id = ? AND ed_quarter_note_institute_code = ? AND ed_quarter_note_deleted = 0
      LIMIT 1
    `;
    const getQuarterParams = [ID, req.session.user.eduall_user_session_curentinstitute];
    const quarterResult = await ExecuteQuery(res, getQuarterQuery, getQuarterParams, true, { db: "eduall_quarterly_notes", type: "select", data: req });

    if (quarterResult.length === 0) { 
      return res.status(404).json({ success: false, msg: "Nota trimestral não encontrada!" });
    }

    const quarter = quarterResult[0].ed_quarter_note_quarter;
    const { allowed } = await CheckQuarterlyNotePermission(req, res, quarter);
    if (!allowed){return res.status(403).json({ success: false, msg: "Não é permitido deletar notas para este trimestre!" });}
 
    const deleteQuery = `
      UPDATE eduall_quarterly_notes 
      SET ed_quarter_note_deleted = 1  
      WHERE ed_quarter_note_deleted = 0 
        AND ed_quarter_note_id = ? 
        AND ed_quarter_note_institute_code = ?
    `;
    const deleteParams = [ID, req.session.user.eduall_user_session_curentinstitute];
    const rows = await ExecuteQuery(res, deleteQuery, deleteParams, false, { db: "eduall_quarterly_notes", type: "update", data: req });

    await RegisterAuditAction({
      session: req.session,
      action: 3,  // Ação de DELETAR
      form: "Notas trimestrais",
      description: `Deletou as notas do estudante onde o ID de registro (${ID})`,
    });

    res.status(200).json(rows);
  } catch (error) {
    res.status(500).json({ success: false, message: "Falha ao deletar a nota trimestral!", error: error.message });
  }
};

const QuarterlyNoteUpdate = async (req, res) => {
    try {
        const { allowed } = await CheckQuarterlyNotePermission(req, res, req.body.quarterly_note_quarter);
        if (!allowed) {
           return res.status(403).json({ success: false, msg: "Não é permitido atualizar as notas para este trimestre!" });
        }
        const { ID } = req.params;
        const { quarterly_note_npp, quarterly_note_mac, quarterly_note_quarter, quarterly_note_npt, quarterly_note_subject } = req.body; 
        const query = `UPDATE eduall_quarterly_notes SET ed_quarter_note_subject = ?, ed_quarter_note_quarter = ?, 
        ed_quarter_note_mac = ?, ed_quarter_note_npp = ?, ed_quarter_note_npt = ? 
        WHERE ed_quarter_note_deleted = 0 AND ed_quarter_note_id = ? AND ed_quarter_note_institute_code = ?`; 
        const PARAMS = [quarterly_note_subject, quarterly_note_quarter, quarterly_note_mac, quarterly_note_npp, quarterly_note_npt, ID, req.session.user.eduall_user_session_curentinstitute];
        const rows = await ExecuteQuery(res, query, PARAMS, false, { db: "eduall_quarterly_notes", type: "update", data: req });
        
        
       await RegisterAuditAction({
        session: req.session,
        action: 2,  // Ação de atualização
        form: "Notas trimestrais",
        description: `Atualizou as notas do estudante  (NPP : ${quarterly_note_npp}) -  (MAC : ${quarterly_note_mac}) -  (NPT : ${quarterly_note_npt}) - Trimestre (${quarterly_note_quarter}º)`,
      });

        
        res.status(200).json(rows);
    } catch (error) {
        res.status(500).json({ success: false, message: "Failed to update quarterly note!", error: error.message });
    }
};


 
const GetSingleQuarterlyNoteBySubStdQrtType = async (req, res) => {
    try {
        const { SUBJECT, QUARTER, STUDENT, CLASS } = req.params;
        const query = `SELECT * FROM eduall_quarterly_notes
            LEFT JOIN eduall_class 
            ON eduall_class.ed_class_id = eduall_quarterly_notes.ed_quarter_note_class
            LEFT JOIN eduall_academic_level ON eduall_academic_level.ed_academic_level_id = eduall_class.ed_class_academic_level
            LEFT JOIN eduall_students ON eduall_students.ed_student_id = eduall_quarterly_notes.ed_quarter_note_studentcode
            WHERE ed_quarter_note_deleted = 0 AND ed_quarter_note_subject = ? 
            AND ed_quarter_note_quarter = ? AND ed_quarter_note_studentcode = ? 
            AND ed_quarter_note_class = ? AND ed_quarter_note_institute_code = ?`;
        const PARAMS = [SUBJECT, QUARTER, STUDENT, CLASS, req.session.user.eduall_user_session_curentinstitute];
        const rows = await ExecuteQuery(res, query, PARAMS, true, { db: "eduall_quarterly_notes", type: "select", data: req });
        res.status(200).json(rows);
    } catch (error) {
        res.status(500).json({ success: false, message: "Failed to fetch quarterly note!", error: error.message });
    }
};

const GetSingleQuarterlyNoteBySubStdQrtTypeClass = async (req, res) => {
    try {
        const { SUBJECT, QUARTER, STUDENT, CLASS } = req.params;
        const query = `SELECT * FROM eduall_quarterly_notes
            LEFT JOIN eduall_class 
            ON eduall_class.ed_class_id = eduall_quarterly_notes.ed_quarter_note_class
            LEFT JOIN eduall_academic_level ON eduall_academic_level.ed_academic_level_id = eduall_class.ed_class_academic_level
            LEFT JOIN eduall_students ON eduall_students.ed_student_id = eduall_quarterly_notes.ed_quarter_note_studentcode
            WHERE ed_quarter_note_deleted = 0 AND ed_quarter_note_subject = ? 
            AND ed_quarter_note_quarter = ? AND ed_quarter_note_studentcode = ? 
            AND ed_quarter_note_class = ? AND ed_quarter_note_institute_code = ?`;
        const PARAMS = [SUBJECT, QUARTER, STUDENT, CLASS, req.session.user.eduall_user_session_curentinstitute];
        const rows = await ExecuteQuery(res, query, PARAMS, true, { db: "eduall_quarterly_notes", type: "select", data: req });
        console.log("NOTAS = ", rows)
        res.status(200).json(rows);
    } catch (error) {
        console.log(error);
        res.status(500).json({ success: false, message: "Failed to fetch quarterly note by class!", error: error.message });
    }
};

 
const GetSingleClassScoreByNumber = async (req, res) => {
    try {
        const { SUBJECT, CLASS } = req.params;
        const query = `
            SELECT c.objectiveID, JSON_ARRAY(JSON_OBJECT('text', d.description, 'text2', d.description)) AS records,
            JSON_ARRAY(c.text) AS text FROM completion AS c
            INNER JOIN record AS r ON c.userID = r.userID AND c.recordID = r.ID
            INNER JOIN code AS d ON r.codeID = d.ID
            GROUP BY c.objectiveID
        `;
        const PARAMS = [];
        const rows = await ExecuteQuery(res, query, PARAMS, true, { db: "completion", type: "select", data: req });
        res.status(200).json(rows);
    } catch (error) {
        res.status(500).json({ success: false, message: "Failed to fetch class score!", error: error.message });
    }
};
 



const C = {
  reset:     "\x1b[0m",
  bold:      "\x1b[1m",
  dim:       "\x1b[2m",
  red:       "\x1b[31m",
  green:     "\x1b[32m",
  yellow:    "\x1b[33m",
  cyan:      "\x1b[36m",
  white:     "\x1b[37m",
  bgRed:     "\x1b[41m",
  bgGreen:   "\x1b[42m",
  bgYellow:  "\x1b[43m",
  bgBlue:    "\x1b[44m",
  bgMagenta: "\x1b[45m",
  bgCyan:    "\x1b[46m",
};
 
const tag = {
  info:    `${C.bold}${C.bgBlue}${C.white} INFO  ${C.reset}`,
  ok:      `${C.bold}${C.bgGreen}${C.white} OK    ${C.reset}`,
  warn:    `${C.bold}${C.bgYellow}${C.white} WARN  ${C.reset}`,
  error:   `${C.bold}${C.bgRed}${C.white} ERROR ${C.reset}`,
  step:    `${C.bold}${C.bgCyan}${C.white} STEP  ${C.reset}`,
  reject:  `${C.bold}${C.bgMagenta}${C.white} REJECT${C.reset}`,
  insert:  `${C.bold}${C.green} ✚ INSERT${C.reset}`,
  update:  `${C.bold}${C.cyan} ✎ UPDATE${C.reset}`,
  summary: `${C.bold}${C.bgMagenta}${C.white} SUMÁRIO ${C.reset}`,
};
 
const sep  = () => console.log(`${C.dim}${"─".repeat(72)}${C.reset}`);
const sep2 = () => console.log(`${C.dim}${"═".repeat(72)}${C.reset}`);
const fmt  = (obj) => JSON.stringify(obj, null, 2);
 
const USER_ERRORS = {
  SESSION_INVALID:      "Sessão inválida ou expirada. Faça login novamente.",
  NO_ITEMS:             "Nenhuma nota foi enviada para lançamento.",
  INVALID_IDS:          (code, cls, subj, q) =>
    `Dados inválidos: aluno=${code}, turma=${cls}, disciplina=${subj}, trimestre=${q}. Verifique os valores e tente novamente.`,
  PERMISSION_DENIED:    (q) =>
    `O lançamento de notas para o ${q}º trimestre não é permitido neste momento (restrição pedagógica).`,
  PERMISSION_EXCEPTION: (msg) =>
    `Não foi possível verificar a permissão pedagógica: ${msg}`,
  SUBJECT_NOT_IN_CLASS: (subj, cls) =>
    `A disciplina (ID ${subj}) não está associada à turma (ID ${cls}). Verifique a configuração da turma.`,
  SUBJECT_FETCH_FAIL:   (msg) =>
    `Erro ao obter as disciplinas da turma: ${msg}`,
  NOTE_FIND_FAIL:       (msg) =>
    `Erro ao verificar se já existe nota para este aluno: ${msg}`,
  DB_FAIL:              (op, msg) =>
    `Falha ao ${op === "insert" ? "inserir" : "actualizar"} a nota na base de dados: ${msg}`,
  GLOBAL:               (msg) =>
    `Erro inesperado no servidor ao processar o lançamento de notas: ${msg}`,
};
  
const GetQuarterlyNotesFullData = async (req, res) => {
    try {
      const { student, subject, quarter, class: classID } = req.params;
  
      if (!classID) {
        return res.status(400).json({ success: false, message: "Parâmetro obrigatório faltando: class" });
      }
  
      const resolvedQuarter = quarter !== "null" && quarter !== undefined ? Number(quarter) : 0;
      const resolvedClass = Number(classID);
      const resolvedStudent = student !== "null" && student !== undefined ? Number(student) : null;
      const resolvedSubject = subject !== "null" && subject !== undefined ? Number(subject) : null;
  
      let subjectsList = [];
      if (!resolvedSubject) {
        const classQuery = `SELECT ed_class_subjects FROM eduall_class WHERE ed_class_id = ? AND ed_class_deleted = 0 LIMIT 1`;
        const classRes = await ExecuteQuery(res, classQuery, [resolvedClass], true, { db: "eduall_class", type: "select", data: req });
  
        if (classRes.length > 0 && classRes[0].ed_class_subjects) {
          const rawSubjects = classRes[0].ed_class_subjects.split(',');
          subjectsList = rawSubjects.filter(id => Math.floor(id) >= 1).map(id => Number(id));
        }
      }
  
      // === NOVO: buscar nome das disciplinas para todos os subjectIds da classe ===
      let subjectTitlesMap = new Map();
      if (subjectsList.length > 0) {
        const placeholders = subjectsList.map(() => '?').join(',');
        const subjectsQuery = `SELECT ed_subject_id, ed_subject_title FROM eduall_subjects WHERE ed_subject_id IN (${placeholders}) AND ed_subject_deleted = 0`;
        const subjectsRes = await ExecuteQuery(res, subjectsQuery, subjectsList, true, { db: "eduall_subjects", type: "select", data: req });
        subjectsRes.forEach(subj => {
          subjectTitlesMap.set(subj.ed_subject_id, subj.ed_subject_title);
        });
      } else if (resolvedSubject) {
        // Se veio um subject específico, buscar nome só dele
        const subjectsQuery = `SELECT ed_subject_id, ed_subject_title FROM eduall_subjects WHERE ed_subject_id = ? AND ed_subject_deleted = 0`;
        const subjectsRes = await ExecuteQuery(res, subjectsQuery, [resolvedSubject], true, { db: "eduall_subjects", type: "select", data: req });
        if (subjectsRes.length > 0) {
          subjectTitlesMap.set(resolvedSubject, subjectsRes[0].ed_subject_title);
        }
      }
  
      const studentsQuery = `SELECT ed_student_id, ed_student_name FROM eduall_students WHERE ed_student_class = ? AND ed_student_deleted = 0`;
      const allStudents = await ExecuteQuery(res, studentsQuery, [resolvedClass], true, { db: "eduall_students", type: "select", data: req });
  
      const baseQuery = `
        SELECT q.*, s.ed_student_name, sub.ed_subject_title, c.ed_class_title, 
               l.ed_academic_level_avaliationtype_endat as max_value
        FROM eduall_quarterly_notes q
        LEFT JOIN eduall_students s ON s.ed_student_id = q.ed_quarter_note_studentcode AND s.ed_student_deleted = 0
        LEFT JOIN eduall_subjects sub ON sub.ed_subject_id = q.ed_quarter_note_subject AND sub.ed_subject_deleted = 0
        LEFT JOIN eduall_class c ON c.ed_class_id = q.ed_quarter_note_class AND c.ed_class_deleted = 0
        LEFT JOIN eduall_academic_level l ON l.ed_academic_level_id = c.ed_class_academic_level AND l.ed_academic_level_deleted = 0
      `;
  
      const results = {};
      const quarters = [1, 2, 3];
  
      for (const q of quarters) {
        const params = [resolvedClass];
        let whereClause = `WHERE q.ed_quarter_note_class = ? AND q.ed_quarter_note_quarter = ? AND q.ed_quarter_note_deleted = 0`;
        params.push(q);
  
        if (resolvedStudent) {
          whereClause += ` AND q.ed_quarter_note_studentcode = ?`;
          params.push(resolvedStudent);
        }
        if (resolvedSubject) {
          whereClause += ` AND q.ed_quarter_note_subject = ?`;
          params.push(resolvedSubject);
        } else if (subjectsList.length > 0) {
          whereClause += ` AND q.ed_quarter_note_subject IN (${subjectsList.map(() => '?').join(',')})`;
          params.push(...subjectsList);
        }
  
        const finalQuery = `${baseQuery} ${whereClause}`;
        const rows = await ExecuteQuery(res, finalQuery, params, true, {
          db: "eduall_quarterly_notes",
          type: "select",
          data: req,
        });
  
        const notesMap = new Map();
        rows.forEach(item => {
          const mac = item.ed_quarter_note_mac * 1;
          const npp = item.ed_quarter_note_npp * 1;
          const npt = item.ed_quarter_note_npt * 1;
          const max = item.max_value * 1;
          const mt = Math.floor(((mac + npp + npt) / 3) * 100) / 100;
          const status = mt < (max / 2) ? 0 : 1;
          const warning = mt > max ? 1 : 0;
  
          const note = {
            student_id: item.ed_quarter_note_studentcode,
            student_name: item.ed_student_name,
            subject_name: item.ed_subject_title,
            class_name: item.ed_class_title,
            mac_note: mac,
            npp_note: npp,
            npt_note: npt,
            mt,
            max_value: max,
            status,
            warning,
            quarter: q,
            subject_id: item.ed_quarter_note_subject
          };
  
          notesMap.set(`${note.student_id}_${note.subject_id}`, note);
        });
  
        const resultList = [];
        for (const student of allStudents) {
          for (const subjectId of (resolvedSubject ? [resolvedSubject] : subjectsList)) {
            const key = `${student.ed_student_id}_${subjectId}`;
            if (notesMap.has(key)) {
              resultList.push(notesMap.get(key));
            } else {
              // Usar nome da disciplina do map caso não tenha nota lançada
              resultList.push({
                student_id: student.ed_student_id,
                student_name: student.ed_student_name,
                subject_id: subjectId,
                subject_name: subjectTitlesMap.get(subjectId) || "",  // <-- Alteração aqui
                class_name: "",
                mac_note: "Não lançado",
                npp_note: "Não lançado",
                npt_note: "Não lançado",
                mt: "Não lançado",
                max_value: null,
                status: null,
                warning: null,
                quarter: q
              });
            }
          }
        }
  
        results[`quarter_${q}`] = resultList;
      }
  
      // Buscar todas notas de exame
      const examQuery = `
        SELECT n.ed_student_exam_score as exam_note, n.ed_student_exam_subject as subject_id, 
               s.ed_student_name, sub.ed_subject_title, c.ed_class_title
        FROM eduall_student_exam_notes n
        LEFT JOIN eduall_students s ON s.ed_student_id = n.ed_student_exam_studentCode AND s.ed_student_deleted = 0
        LEFT JOIN eduall_subjects sub ON sub.ed_subject_id = n.ed_student_exam_subject AND sub.ed_subject_deleted = 0
        LEFT JOIN eduall_class c ON c.ed_class_id = n.ed_student_exam_class AND c.ed_class_deleted = 0
        WHERE n.ed_student_exam_class = ? AND n.ed_student_exam_deleted = 0 
        AND n.ed_student_exam_institute_code = ? ${resolvedStudent ? 'AND n.ed_student_exam_studentCode = ?' : ''}
      `;
      const examParams = resolvedStudent ? [resolvedClass, req.session.user.eduall_user_session_curentinstitute, resolvedStudent] : [resolvedClass, req.session.user.eduall_user_session_curentinstitute];
      const exam = await ExecuteQuery(res, examQuery, examParams, true, {
        db: "eduall_student_exam_notes", type: "select", data: req
      });
  
      // Buscar todas notas de destaque
      const featuredQuery = `
        SELECT n.ed_student_featured_note_score as featured_note, n.ed_student_featured_note_subject as subject_id,
               s.ed_student_name, sub.ed_subject_title, c.ed_class_title
        FROM eduall_student_featured_notes n
        LEFT JOIN eduall_students s ON s.ed_student_id = n.ed_student_featured_note_studentCode AND s.ed_student_deleted = 0
        LEFT JOIN eduall_subjects sub ON sub.ed_subject_id = n.ed_student_featured_note_subject AND sub.ed_subject_deleted = 0
        LEFT JOIN eduall_class c ON c.ed_class_id = n.ed_student_featured_note_class AND c.ed_class_deleted = 0
        WHERE n.ed_student_featured_note_class = ? AND n.ed_student_featured_note_deleted = 0 
        AND n.ed_student_featured_note_institute_code = ? ${resolvedStudent ? 'AND n.ed_student_featured_note_studentCode = ?' : ''}
      `;
      const featuredParams = resolvedStudent ? [resolvedClass, req.session.user.eduall_user_session_curentinstitute, resolvedStudent] : [resolvedClass, req.session.user.eduall_user_session_curentinstitute];
      const featured = await ExecuteQuery(res, featuredQuery, featuredParams, true, {
        db: "eduall_student_featured_notes", type: "select", data: req
      });
  
      res.status(200).json({
        success: true,
        data: {
          quarters: results,
          exams: exam,
          featured: featured,
        },
      });
  
    } catch (error) {
      console.error(error);
      return res.status(500).json({ success: false, message: "Erro interno do servidor." });
    }
  };
  


  // controllers/QuarterlyNotes.controller.js

const DEFAULT_LOGO_FALLBACK =
  "https://ik.imagekit.io/zks5iegia/eduall-logo%20(2).png?updatedAt=1765578949231";

const GetQuarterlyMiniPautaFullData = async (req, res) => {
  try {
    const { class: classID, quarter, student } = req.params;

    if (!classID) {
      return res.status(400).json({
        success: false,
        message: "Parâmetro obrigatório faltando: class",
      });
    }

    const instituteCode = req?.session?.user?.eduall_user_session_curentinstitute;
    if (!instituteCode) {
      return res.status(401).json({
        success: false,
        message: "Sessão inválida: instituição não encontrada.",
      });
    }

    const resolvedClass = Number(classID);
    const resolvedQuarter =
      quarter !== "null" && quarter !== undefined ? Number(quarter) : 0; // 0 => todos
    const resolvedStudent =
      student !== "null" && student !== undefined ? Number(student) : null;

    // =========================
    // 1) DADOS DA INSTITUIÇÃO
    // =========================
    const instituteQuery = `
      SELECT 
        ed_institute_id,
        ed_institute_name,
        ed_institute_state,
        ed_institute_principal,
        ed_institute_pedagogical_director,
        ed_institute_country,
        ed_institute_address,
        ed_institute_nif,
        ed_institute_phone1,
        ed_institute_phone2,
        ed_institute_email,
        ed_institute_website,
        ed_institute_slogan,
        ed_institute_docheader,
        ed_logo_urlcloudinary,
        ed_institute_logo
      FROM eduall_institutes
      WHERE ed_institute_code = ? 
      LIMIT 1
    `;
    const instituteRes = await ExecuteQuery(
      res,
      instituteQuery,
      [instituteCode],
      true,
      { db: "eduall_institutes", type: "select", data: req }
    );

    const institute = instituteRes?.[0] || {};
    const instituteLogo =
      institute?.ed_logo_urlcloudinary && String(institute.ed_logo_urlcloudinary).trim() !== ""
        ? institute.ed_logo_urlcloudinary
        : DEFAULT_LOGO_FALLBACK;

    // =========================
    // 2) DADOS COMPLETOS DA TURMA (JOIN QUE VOCÊ PASSOU)
    // =========================
    const classQuery = `
      SELECT * FROM eduall_class  
      LEFT JOIN eduall_classrooms 
        ON eduall_classrooms.ed_classroom_id = eduall_class.ed_class_room
      LEFT JOIN eduall_academic_level 
        ON eduall_academic_level.ed_academic_level_id = eduall_class.ed_class_academic_level
      LEFT JOIN eduall_cicles 
        ON eduall_cicles.ed_cicle_id = eduall_class.ed_class_cicle
      LEFT JOIN eduall_faculty 
        ON eduall_faculty.ed_faculty_id = eduall_class.ed_class_faculty
      LEFT JOIN eduall_academic_year 
        ON eduall_academic_year.ed_academic_year_id = eduall_class.ed_class_year
      LEFT JOIN eduall_courses 
        ON eduall_courses.ed_course_id = eduall_class.ed_class_course
      WHERE eduall_class.ed_class_deleted = 0
        AND eduall_class.ed_class_institute_code = ?
        AND eduall_class.ed_class_id = ?
      LIMIT 1
    `;
    const classInfoRes = await ExecuteQuery(
      res,
      classQuery,
      [instituteCode, resolvedClass],
      true,
      { db: "eduall_class", type: "select", data: req }
    );

    if (!classInfoRes?.length) {
      return res.status(404).json({
        success: false,
        message: "Turma não encontrada para esta instituição.",
      });
    }

    const classInfo = classInfoRes[0];

    // =========================
    // 3) LISTA DE DISCIPLINAS DA TURMA + MAP TITULOS
    // =========================
    let subjectsList = [];
    if (classInfo?.ed_class_subjects) {
      const rawSubjects = String(classInfo.ed_class_subjects).split(",");
      subjectsList = rawSubjects
        .filter((id) => Math.floor(id) >= 1)
        .map((id) => Number(id));
    }

    let subjectTitlesMap = new Map();
    if (subjectsList.length > 0) {
      const placeholders = subjectsList.map(() => "?").join(",");
      const subjectsQuery = `
        SELECT ed_subject_id, ed_subject_title
        FROM eduall_subjects
        WHERE ed_subject_id IN (${placeholders})
          AND ed_subject_deleted = 0
      `;
      const subjectsRes = await ExecuteQuery(
        res,
        subjectsQuery,
        subjectsList,
        true,
        { db: "eduall_subjects", type: "select", data: req }
      );

      subjectsRes.forEach((s) => {
        subjectTitlesMap.set(Number(s.ed_subject_id), s.ed_subject_title);
      });
    }

    // =========================
    // 4) ESTUDANTES (da turma) — se student vier, podemos filtrar
    // =========================
    const studentsQuery = `
      SELECT ed_student_id, ed_student_name
      FROM eduall_students
      WHERE ed_student_class = ?
        AND ed_student_deleted = 0
        ${resolvedStudent ? "AND ed_student_id = ?" : ""}
    `;
    const studentsParams = resolvedStudent ? [resolvedClass, resolvedStudent] : [resolvedClass];

    const allStudents = await ExecuteQuery(
      res,
      studentsQuery,
      studentsParams,
      true,
      { db: "eduall_students", type: "select", data: req }
    );

    // =========================
    // 5) NOTAS TRIMESTRAIS — SEM NPP
    // =========================
    const baseQuery = `
      SELECT 
        q.*,
        s.ed_student_name,
        sub.ed_subject_title,
        c.ed_class_title,
        l.ed_academic_level_avaliationtype_endat as max_value
      FROM eduall_quarterly_notes q
      LEFT JOIN eduall_students s 
        ON s.ed_student_id = q.ed_quarter_note_studentcode
        AND s.ed_student_deleted = 0
      LEFT JOIN eduall_subjects sub 
        ON sub.ed_subject_id = q.ed_quarter_note_subject
        AND sub.ed_subject_deleted = 0
      LEFT JOIN eduall_class c 
        ON c.ed_class_id = q.ed_quarter_note_class
        AND c.ed_class_deleted = 0
      LEFT JOIN eduall_academic_level l 
        ON l.ed_academic_level_id = c.ed_class_academic_level
        AND l.ed_academic_level_deleted = 0
    `;

    const quartersToFetch = resolvedQuarter >= 1 && resolvedQuarter <= 3 ? [resolvedQuarter] : [1, 2, 3];
    const results = {};

    for (const q of quartersToFetch) {
      const params = [resolvedClass, q];
      let whereClause = `
        WHERE q.ed_quarter_note_class = ?
          AND q.ed_quarter_note_quarter = ?
          AND q.ed_quarter_note_deleted = 0
      `;

      if (resolvedStudent) {
        whereClause += ` AND q.ed_quarter_note_studentcode = ?`;
        params.push(resolvedStudent);
      }

      if (subjectsList.length > 0) {
        whereClause += ` AND q.ed_quarter_note_subject IN (${subjectsList.map(() => "?").join(",")})`;
        params.push(...subjectsList);
      } else {
        // se a turma não tiver subjects registados, evita IN ()
        whereClause += ` AND q.ed_quarter_note_subject IS NOT NULL`;
      }

      const finalQuery = `${baseQuery} ${whereClause}`;
      const rows = await ExecuteQuery(res, finalQuery, params, true, {
        db: "eduall_quarterly_notes",
        type: "select",
        data: req,
      });

      // Map por (student,subject)
      const notesMap = new Map();

      rows.forEach((item) => {
        const mac = Number(item.ed_quarter_note_mac || 0);
        const npt = Number(item.ed_quarter_note_npt || 0);
        const max = Number(item.max_value || 0);

        //  MT SEM NPP: média de 2
        const mt = Math.floor(((mac + npt) / 2) * 100) / 100;

        const status = max > 0 ? (mt < max / 2 ? 0 : 1) : null;
        const warning = max > 0 ? (mt > max ? 1 : 0) : null;

        const note = {
          student_id: item.ed_quarter_note_studentcode,
          student_name: item.ed_student_name,
          subject_id: item.ed_quarter_note_subject,
          subject_name: item.ed_subject_title,
          class_name: item.ed_class_title,
          quarter: q,

          mac_note: mac,
          npt_note: npt,
          mt,

          max_value: max || null,
          status,
          warning,
        };

        notesMap.set(`${note.student_id}_${note.subject_id}`, note);
      });

      // Garante linhas mesmo sem nota lançada
      const resultList = [];
      for (const st of allStudents) {
        for (const subjectId of subjectsList) {
          const key = `${st.ed_student_id}_${subjectId}`;
          if (notesMap.has(key)) {
            resultList.push(notesMap.get(key));
          } else {
            resultList.push({
              student_id: st.ed_student_id,
              student_name: st.ed_student_name,

              subject_id: subjectId,
              subject_name: subjectTitlesMap.get(subjectId) || "",

              class_name: classInfo?.ed_class_title || "",
              quarter: q,

              mac_note: "Não lançado",
              npt_note: "Não lançado",
              mt: "Não lançado",

              max_value: null,
              status: null,
              warning: null,
            });
          }
        }
      }

      results[`quarter_${q}`] = resultList;
    }

    // =========================
    // 6) EXAMES e DESTAQUES (mantém, mas agora só dependem de class/student)
    // =========================
    const examQuery = `
      SELECT 
        n.ed_student_exam_score as exam_note,
        n.ed_student_exam_subject as subject_id,
        s.ed_student_name,
        sub.ed_subject_title,
        c.ed_class_title
      FROM eduall_student_exam_notes n
      LEFT JOIN eduall_students s 
        ON s.ed_student_id = n.ed_student_exam_studentCode
        AND s.ed_student_deleted = 0
      LEFT JOIN eduall_subjects sub 
        ON sub.ed_subject_id = n.ed_student_exam_subject
        AND sub.ed_subject_deleted = 0
      LEFT JOIN eduall_class c 
        ON c.ed_class_id = n.ed_student_exam_class
        AND c.ed_class_deleted = 0
      WHERE n.ed_student_exam_class = ?
        AND n.ed_student_exam_deleted = 0
        AND n.ed_student_exam_institute_code = ?
        ${resolvedStudent ? "AND n.ed_student_exam_studentCode = ?" : ""}
    `;
    const examParams = resolvedStudent
      ? [resolvedClass, instituteCode, resolvedStudent]
      : [resolvedClass, instituteCode];

    const exam = await ExecuteQuery(res, examQuery, examParams, true, {
      db: "eduall_student_exam_notes",
      type: "select",
      data: req,
    });

    const featuredQuery = `
      SELECT 
        n.ed_student_featured_note_score as featured_note,
        n.ed_student_featured_note_subject as subject_id,
        s.ed_student_name,
        sub.ed_subject_title,
        c.ed_class_title
      FROM eduall_student_featured_notes n
      LEFT JOIN eduall_students s 
        ON s.ed_student_id = n.ed_student_featured_note_studentCode
        AND s.ed_student_deleted = 0
      LEFT JOIN eduall_subjects sub 
        ON sub.ed_subject_id = n.ed_student_featured_note_subject
        AND sub.ed_subject_deleted = 0
      LEFT JOIN eduall_class c 
        ON c.ed_class_id = n.ed_student_featured_note_class
        AND c.ed_class_deleted = 0
      WHERE n.ed_student_featured_note_class = ?
        AND n.ed_student_featured_note_deleted = 0
        AND n.ed_student_featured_note_institute_code = ?
        ${resolvedStudent ? "AND n.ed_student_featured_note_studentCode = ?" : ""}
    `;
    const featuredParams = resolvedStudent
      ? [resolvedClass, instituteCode, resolvedStudent]
      : [resolvedClass, instituteCode];

    const featured = await ExecuteQuery(res, featuredQuery, featuredParams, true, {
      db: "eduall_student_featured_notes",
      type: "select",
      data: req,
    });

    // =========================
    // RESPONSE
    // =========================
    return res.status(200).json({
      success: true,
      data: {
        institute: {
          ...institute,
          institute_logo: instituteLogo, // <- logo final para usar no PDF
        },
        class_info: classInfo,
        subjects: subjectsList.map((id) => ({
          subject_id: id,
          subject_title: subjectTitlesMap.get(id) || "",
        })),
        quarters: results,
        exams: exam,
        featured: featured,
      },
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({
      success: false,
      message: "Erro interno do servidor.",
    });
  }
};



// controllers/QuarterlyNotes.controller.js
 
const GetStudentMTAll3Quarters = async (req, res) => {
  try {
    const { class: classID, student } = req.params;

    if (!classID) {
      return res.status(400).json({
        success: false,
        message: "Parâmetro obrigatório faltando: class",
      });
    }

    if (!student || student === "null" || student === "undefined") {
      return res.status(400).json({
        success: false,
        message: "Parâmetro obrigatório faltando: student",
      });
    }

    const instituteCode = req?.session?.user?.eduall_user_session_curentinstitute;
    if (!instituteCode) {
      return res.status(401).json({
        success: false,
        message: "Sessão inválida: instituição não encontrada.",
      });
    }

    const resolvedClass = Number(classID);
    const resolvedStudent = Number(student);

    if (!Number.isFinite(resolvedClass) || resolvedClass <= 0) {
      return res.status(400).json({
        success: false,
        message: "Parâmetro class inválido.",
      });
    }

    if (!Number.isFinite(resolvedStudent) || resolvedStudent <= 0) {
      return res.status(400).json({
        success: false,
        message: "Parâmetro student inválido.",
      });
    }

    // =========================
    // 1) INFO DA TURMA (para pegar disciplinas e max_value)
    // =========================
    const classQuery = `
      SELECT 
        c.*,
        l.ed_academic_level_avaliationtype_endat as max_value
      FROM eduall_class c
      LEFT JOIN eduall_academic_level l
        ON l.ed_academic_level_id = c.ed_class_academic_level
        AND l.ed_academic_level_deleted = 0
      WHERE c.ed_class_deleted = 0
        AND c.ed_class_institute_code = ?
        AND c.ed_class_id = ?
      LIMIT 1
    `;

    const classInfoRes = await ExecuteQuery(
      res,
      classQuery,
      [instituteCode, resolvedClass],
      true,
      { db: "eduall_class", type: "select", data: req }
    );

    if (!classInfoRes?.length) {
      return res.status(404).json({
        success: false,
        message: "Turma não encontrada para esta instituição.",
      });
    }

    const classInfo = classInfoRes[0];

    // =========================
    // 2) LISTA DE DISCIPLINAS DA TURMA
    // =========================
    let subjectsList = [];
    if (classInfo?.ed_class_subjects) {
      const rawSubjects = String(classInfo.ed_class_subjects).split(",");
      subjectsList = rawSubjects
        .map((id) => Number(String(id).trim()))
        .filter((id) => Number.isFinite(id) && id >= 1);
    }

    if (subjectsList.length === 0) {
      return res.status(200).json({
        success: true,
        data: {
          class_info: classInfo,
          max_value: Number(classInfo.max_value || 0) || null,
          student_id: resolvedStudent,
          rows: [],
        },
      });
    }

    // =========================
    // 3) TITULOS DAS DISCIPLINAS
    // =========================
    const placeholders = subjectsList.map(() => "?").join(",");
    const subjectsQuery = `
      SELECT ed_subject_id, ed_subject_title
      FROM eduall_subjects
      WHERE ed_subject_id IN (${placeholders})
        AND ed_subject_deleted = 0
    `;

    const subjectsRes = await ExecuteQuery(
      res,
      subjectsQuery,
      subjectsList,
      true,
      { db: "eduall_subjects", type: "select", data: req }
    );

    const subjectTitlesMap = new Map();
    (subjectsRes || []).forEach((s) => {
      subjectTitlesMap.set(Number(s.ed_subject_id), s.ed_subject_title);
    });

    // =========================
    // 4) VALIDAR SE O ALUNO PERTENCE À TURMA
    // =========================
    const studentQuery = `
      SELECT ed_student_id, ed_student_name
      FROM eduall_students
      WHERE ed_student_id = ?
        AND ed_student_class = ?
        AND ed_student_deleted = 0
      LIMIT 1
    `;

    const studentRes = await ExecuteQuery(
      res,
      studentQuery,
      [resolvedStudent, resolvedClass],
      true,
      { db: "eduall_students", type: "select", data: req }
    );

    if (!studentRes?.length) {
      return res.status(404).json({
        success: false,
        message: "Aluno não encontrado nesta turma.",
      });
    }

    const studentInfo = studentRes[0];

    // =========================
    // 5) NOTAS (somente desse aluno) para os 3 trimestres
    // =========================
    const notesQuery = `
      SELECT
        q.ed_quarter_note_subject as subject_id,
        q.ed_quarter_note_quarter as quarter,
        q.ed_quarter_note_mac as mac,
        q.ed_quarter_note_npt as npt
      FROM eduall_quarterly_notes q
      WHERE q.ed_quarter_note_deleted = 0
        AND q.ed_quarter_note_class = ?
        AND q.ed_quarter_note_studentcode = ?
        AND q.ed_quarter_note_quarter IN (1,2,3)
        AND q.ed_quarter_note_subject IN (${placeholders})
    `;

    const notesParams = [resolvedClass, resolvedStudent, ...subjectsList];

    const notesRows = await ExecuteQuery(
      res,
      notesQuery,
      notesParams,
      true,
      { db: "eduall_quarterly_notes", type: "select", data: req }
    );

    // Map: subjectId -> { q1, q2, q3 }
    const mtMap = new Map();
    subjectsList.forEach((sid) => {
      mtMap.set(sid, {
        q1: "Não lançado",
        q2: "Não lançado",
        q3: "Não lançado",
      });
    });

    (notesRows || []).forEach((r) => {
      const subjectId = Number(r.subject_id);
      const quarter = Number(r.quarter);

      if (!mtMap.has(subjectId)) return;
      if (![1, 2, 3].includes(quarter)) return;

      const mac = Number(r.mac || 0);
      const npt = Number(r.npt || 0);

      // MT SEM NPP
      const mt = Math.floor(((mac + npt) / 2) * 100) / 100;

      const entry = mtMap.get(subjectId);
      if (quarter === 1) entry.q1 = mt;
      if (quarter === 2) entry.q2 = mt;
      if (quarter === 3) entry.q3 = mt;
    });

    // =========================
    // 6) FORMATAR RESPOSTA
    // =========================
    const resultRows = subjectsList.map((sid, idx) => {
      const mt = mtMap.get(sid);
      return {
        index: idx + 1,
        subject_id: sid,
        subject_title: subjectTitlesMap.get(sid) || "",
        quarter_1_mt: mt.q1,
        quarter_2_mt: mt.q2,
        quarter_3_mt: mt.q3,
      };
    });

    return res.status(200).json({
      success: true,
      data: {
        class_id: resolvedClass,
        class_title: classInfo?.ed_class_title || "",
        max_value: Number(classInfo.max_value || 0) || null,
        student: {
          student_id: studentInfo.ed_student_id,
          student_name: studentInfo.ed_student_name,
        },
        rows: resultRows,
      },
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({
      success: false,
      message: "Erro interno do servidor.",
    });
  }
};

 


 
const GetFinalMiniPautaFullData = async (req, res) => {
  try {
    const { class: classParam } = req.params;

    //  filtros novos
    const subjectFilter = Number(req.query?.subject || 0); // 0 => todas
    const roundMode = String(req.query?.round || "default"); // "default" | "ceil"

    if (!classParam) {
      return res.status(400).json({
        success: false,
        message: "Parâmetro obrigatório faltando: class",
      });
    }

    const instituteCode = req?.session?.user?.eduall_user_session_curentinstitute;
    if (!instituteCode) {
      return res.status(401).json({
        success: false,
        message: "Sessão inválida: instituição não encontrada.",
      });
    }

    const classIDs = String(classParam)
      .split(",")
      .map((x) => Number(String(x).trim()))
      .filter((n) => Number.isFinite(n) && n > 0);

    if (classIDs.length === 0) {
      return res.status(400).json({
        success: false,
        message: "Parâmetro class inválido. Use ex: 12 ou 12,15,18",
      });
    }

    const classPlaceholders = classIDs.map(() => "?").join(",");

    // 1) INSTITUIÇÃO
    const instituteQuery = `
      SELECT 
        ed_institute_id,
        ed_institute_name,
        ed_institute_docheader,
        ed_logo_urlcloudinary,
        ed_institute_logo
      FROM eduall_institutes
      WHERE ed_institute_code = ? 
      LIMIT 1
    `;
    const instituteRes = await ExecuteQuery(
      res,
      instituteQuery,
      [instituteCode],
      true,
      { db: "eduall_institutes", type: "select", data: req }
    );

    const institute = instituteRes?.[0] || {};
    const instituteLogo =
      institute?.ed_logo_urlcloudinary &&
      String(institute.ed_logo_urlcloudinary).trim() !== ""
        ? institute.ed_logo_urlcloudinary
        : DEFAULT_LOGO_FALLBACK;

    // 2) TURMAS
    const classQuery = `
      SELECT * FROM eduall_class  
      LEFT JOIN eduall_classrooms 
        ON eduall_classrooms.ed_classroom_id = eduall_class.ed_class_room
      LEFT JOIN eduall_academic_level 
        ON eduall_academic_level.ed_academic_level_id = eduall_class.ed_class_academic_level
      LEFT JOIN eduall_cicles 
        ON eduall_cicles.ed_cicle_id = eduall_class.ed_class_cicle
      LEFT JOIN eduall_faculty 
        ON eduall_faculty.ed_faculty_id = eduall_class.ed_class_faculty
      LEFT JOIN eduall_academic_year 
        ON eduall_academic_year.ed_academic_year_id = eduall_class.ed_class_year
      LEFT JOIN eduall_courses 
        ON eduall_courses.ed_course_id = eduall_class.ed_class_course
      WHERE eduall_class.ed_class_deleted = 0
        AND eduall_class.ed_class_institute_code = ?
        AND eduall_class.ed_class_id IN (${classPlaceholders})
    `;
    const classInfoRes = await ExecuteQuery(
      res,
      classQuery,
      [instituteCode, ...classIDs],
      true,
      { db: "eduall_class", type: "select", data: req }
    );

    if (!classInfoRes?.length) {
      return res.status(404).json({
        success: false,
        message: "Nenhuma turma encontrada para esta instituição.",
      });
    }

    const classMap = new Map();
    classInfoRes.forEach((c) => classMap.set(Number(c.ed_class_id), c));

    // 3) DISCIPLINAS POR TURMA
    const subjectsByClass = new Map();
    const allSubjectIdsSet = new Set();

    for (const c of classInfoRes) {
      const cid = Number(c.ed_class_id);
      let subjectsList = [];

      if (c?.ed_class_subjects) {
        subjectsList = String(c.ed_class_subjects)
          .split(",")
          .map((x) => Number(String(x).trim()))
          .filter((n) => Number.isFinite(n) && n >= 1);
      }

      //  aplicar filtro de disciplina aqui também
      if (subjectFilter > 0) {
        subjectsList = subjectsList.filter((sid) => sid === subjectFilter);
      }

      subjectsByClass.set(cid, subjectsList);
      subjectsList.forEach((sid) => allSubjectIdsSet.add(sid));
    }

    const allSubjectIds = [...allSubjectIdsSet];
    const subjectTitlesMap = new Map();

    if (allSubjectIds.length > 0) {
      const subjPH = allSubjectIds.map(() => "?").join(",");
      const subjectsQuery = `
        SELECT ed_subject_id, ed_subject_title
        FROM eduall_subjects
        WHERE ed_subject_id IN (${subjPH})
          AND ed_subject_deleted = 0
      `;
      const subjectsRes = await ExecuteQuery(
        res,
        subjectsQuery,
        allSubjectIds,
        true,
        { db: "eduall_subjects", type: "select", data: req }
      );

      subjectsRes.forEach((s) => {
        subjectTitlesMap.set(Number(s.ed_subject_id), s.ed_subject_title);
      });
    }

    // 4) ESTUDANTES
    const studentsQuery = `
      SELECT ed_student_id, ed_student_name, ed_student_class
      FROM eduall_students
      WHERE ed_student_class IN (${classPlaceholders})
        AND ed_student_deleted = 0
    `;
    const allStudents = await ExecuteQuery(
      res,
      studentsQuery,
      [...classIDs],
      true,
      { db: "eduall_students", type: "select", data: req }
    );

    const studentsByClass = new Map();
    for (const cid of classIDs) studentsByClass.set(cid, []);
    allStudents.forEach((st) => {
      const cid = Number(st.ed_student_class);
      if (!studentsByClass.has(cid)) studentsByClass.set(cid, []);
      studentsByClass.get(cid).push(st);
    });

    // 5) NOTAS TRIMESTRAIS
    const notesQuery = `
      SELECT 
        q.ed_quarter_note_class as class_id,
        q.ed_quarter_note_quarter as quarter,
        q.ed_quarter_note_studentcode as student_id,
        q.ed_quarter_note_subject as subject_id,
        q.ed_quarter_note_mac as mac,
        q.ed_quarter_note_npt as npt,

        s.ed_student_name,
        sub.ed_subject_title,
        c.ed_class_title,
        l.ed_academic_level_avaliationtype_endat as max_value

      FROM eduall_quarterly_notes q
      LEFT JOIN eduall_students s 
        ON s.ed_student_id = q.ed_quarter_note_studentcode
        AND s.ed_student_deleted = 0
      LEFT JOIN eduall_subjects sub 
        ON sub.ed_subject_id = q.ed_quarter_note_subject
        AND sub.ed_subject_deleted = 0
      LEFT JOIN eduall_class c 
        ON c.ed_class_id = q.ed_quarter_note_class
        AND c.ed_class_deleted = 0
      LEFT JOIN eduall_academic_level l 
        ON l.ed_academic_level_id = c.ed_class_academic_level
        AND l.ed_academic_level_deleted = 0

      WHERE q.ed_quarter_note_deleted = 0
        AND q.ed_quarter_note_class IN (${classPlaceholders})
        AND q.ed_quarter_note_quarter IN (1,2,3)
        ${subjectFilter > 0 ? "AND q.ed_quarter_note_subject = ?" : ""}
    `;

    const notesParams =
      subjectFilter > 0 ? [...classIDs, subjectFilter] : [...classIDs];

    const noteRows = await ExecuteQuery(res, notesQuery, notesParams, true, {
      db: "eduall_quarterly_notes",
      type: "select",
      data: req,
    });

    // 6) AGREGAR MT1/2/3 e MFD
    const gradeMap = new Map();

    const applyRound = (n) => {
      if (typeof n !== "number" || !Number.isFinite(n)) return n;
      return roundMode === "ceil" ? Math.ceil(n) : Math.floor(n * 100) / 100;
    };

    const ensureEntry = (classId, studentId, studentName, subjectId, subjectName, className, max) => {
      const key = `${classId}_${studentId}_${subjectId}`;
      if (!gradeMap.has(key)) {
        gradeMap.set(key, {
          class_id: classId,
          class_name: className || (classMap.get(classId)?.ed_class_title || ""),
          student_id: studentId,
          student_name: studentName || "",
          subject_id: subjectId,
          subject_name: subjectName || subjectTitlesMap.get(subjectId) || "",
          mt1: null,
          mt2: null,
          mt3: null,
          mfd: null,
          max_value: max ?? null,
          status: null,
          warning: null,
        });
      }
      return gradeMap.get(key);
    };

    for (const r of noteRows) {
      const classId = Number(r.class_id);
      const quarter = Number(r.quarter);
      const studentId = Number(r.student_id);
      const subjectId = Number(r.subject_id);

      const allowedSubjects = subjectsByClass.get(classId) || [];
      if (allowedSubjects.length > 0 && !allowedSubjects.includes(subjectId)) continue;

      const mac = Number(r.mac || 0);
      const npt = Number(r.npt || 0);
      const max = Number(r.max_value || 0);

      const mtRaw = ((mac + npt) / 2);
      const mt = applyRound(Math.floor(mtRaw * 100) / 100);

      const entry = ensureEntry(
        classId,
        studentId,
        r.ed_student_name,
        subjectId,
        r.ed_subject_title,
        r.ed_class_title,
        max || null
      );

      if (quarter === 1) entry.mt1 = mt;
      if (quarter === 2) entry.mt2 = mt;
      if (quarter === 3) entry.mt3 = mt;

      if (entry.max_value == null && max) entry.max_value = max;
    }

    // garante linhas vazias (mesmo sem notas)
    for (const classId of classIDs) {
      const classInfo = classMap.get(classId);
      const subjectsList = subjectsByClass.get(classId) || [];
      const studentsList = studentsByClass.get(classId) || [];

      for (const st of studentsList) {
        for (const subjectId of subjectsList) {
          ensureEntry(
            classId,
            Number(st.ed_student_id),
            st.ed_student_name,
            Number(subjectId),
            subjectTitlesMap.get(Number(subjectId)) || "",
            classInfo?.ed_class_title || "",
            null
          );
        }
      }
    }

    // MFD (divide sempre por 3)
    for (const entry of gradeMap.values()) {
      const vals = [entry.mt1, entry.mt2, entry.mt3].filter((v) => typeof v === "number");
      if (vals.length > 0) {
        const sum = vals.reduce((a, b) => a + b, 0);
        const mfdRaw = (sum / 3);
        const mfd = applyRound(Math.floor(mfdRaw * 100) / 100);
        entry.mfd = mfd;
      } else {
        entry.mfd = null;
      }

      const max = Number(entry.max_value || 0);
      if (max > 0 && typeof entry.mfd === "number") {
        entry.status = entry.mfd < max / 2 ? 0 : 1;
        entry.warning = entry.mfd > max ? 1 : 0;
      } else {
        entry.status = null;
        entry.warning = null;
      }
    }

    // 7) saída por turma
    const dataByClass = {};
    for (const classId of classIDs) {
      const classInfo = classMap.get(classId);
      const subjectsList = subjectsByClass.get(classId) || [];

      dataByClass[`class_${classId}`] = {
        class_info: classInfo,
        subjects: subjectsList.map((id) => ({
          subject_id: id,
          subject_title: subjectTitlesMap.get(id) || "",
        })),
        final_grades: [],
      };
    }

    for (const entry of gradeMap.values()) {
      const bucket = dataByClass[`class_${entry.class_id}`];
      if (bucket) bucket.final_grades.push(entry);
    }

    return res.status(200).json({
      success: true,
      data: {
        institute: {
          ...institute,
          institute_logo: instituteLogo,
        },
        classes: dataByClass,
      },
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({
      success: false,
      message: "Erro interno do servidor.",
    });
  }
};


 
const GetFinalMiniPautaExamsAndResourceFullData = async (req, res) => {
  try {
    const { class: classParam } = req.params;

    const subjectFilter = Number(req.query?.subject || 0); // 0 => todas
    const roundMode = String(req.query?.round || "default"); // "default" | "ceil"
    const resourceRule = String(req.query?.resourceRule || "replace"); // replace | avg | max

    if (!classParam) {
      return res.status(400).json({ success: false, message: "Parâmetro obrigatório faltando: class" });
    }

    const instituteCode = req?.session?.user?.eduall_user_session_curentinstitute;
    if (!instituteCode) {
      return res.status(401).json({ success: false, message: "Sessão inválida: instituição não encontrada." });
    }

    const classIDs = String(classParam)
      .split(",")
      .map((x) => Number(String(x).trim()))
      .filter((n) => Number.isFinite(n) && n > 0);

    if (classIDs.length === 0) {
      return res.status(400).json({
        success: false,
        message: "Parâmetro class inválido. Use ex: 12 ou 12,15,18",
      });
    }

    const classPlaceholders = classIDs.map(() => "?").join(",");

    // helpers
    const periodLabel = (v) => {
      const n = Number(v);
      if (n === 0) return "Manhã";
      if (n === 1) return "Tarde";
      if (n === 2) return "Noturno";
      return "";
    };

    const applyRound = (n) => {
      if (typeof n !== "number" || !Number.isFinite(n)) return n;
      return roundMode === "ceil" ? Math.ceil(n) : Math.floor(n * 100) / 100;
    };

    // 1) INSTITUIÇÃO (para cabeçalho excel/preview)
    const instituteQuery = `
      SELECT 
        ed_institute_id,
        ed_institute_name,
        ed_institute_docheader,
        ed_logo_urlcloudinary,
        ed_institute_logo
      FROM eduall_institutes
      WHERE ed_institute_code = ?
      LIMIT 1
    `;
    const instituteRes = await ExecuteQuery(
      res,
      instituteQuery,
      [instituteCode],
      true,
      { db: "eduall_institutes", type: "select", data: req }
    );

    const institute = instituteRes?.[0] || {};
    const instituteLogo =
      institute?.ed_logo_urlcloudinary && String(institute.ed_logo_urlcloudinary).trim() !== ""
        ? String(institute.ed_logo_urlcloudinary).trim()
        : DEFAULT_LOGO_FALLBACK;

    // 2) TURMAS (com joins para devolver títulos e não IDs)
    const classQuery = `
      SELECT 
        c.*,

        cr.ed_classroom_title,
        cr.ed_classroom_id,

        al.ed_academic_level_title,
        al.ed_academic_level_avaliationtype_endat as max_value,

        cy.ed_cicle_title,
        f.ed_faculty_title,
        ay.ed_academic_year_title,
        co.ed_course_title

      FROM eduall_class c
      LEFT JOIN eduall_classrooms cr
        ON cr.ed_classroom_id = c.ed_class_room

      LEFT JOIN eduall_academic_level al
        ON al.ed_academic_level_id = c.ed_class_academic_level
        AND al.ed_academic_level_deleted = 0

      LEFT JOIN eduall_cicles cy
        ON cy.ed_cicle_id = c.ed_class_cicle

      LEFT JOIN eduall_faculty f
        ON f.ed_faculty_id = c.ed_class_faculty

      LEFT JOIN eduall_academic_year ay
        ON ay.ed_academic_year_id = c.ed_class_year

      LEFT JOIN eduall_courses co
        ON co.ed_course_id = c.ed_class_course

      WHERE c.ed_class_deleted = 0
        AND c.ed_class_institute_code = ?
        AND c.ed_class_id IN (${classPlaceholders})
    `;

    const classInfoRes = await ExecuteQuery(
      res,
      classQuery,
      [instituteCode, ...classIDs],
      true,
      { db: "eduall_class", type: "select", data: req }
    );

    if (!classInfoRes?.length) {
      return res.status(404).json({ success: false, message: "Nenhuma turma encontrada para esta instituição." });
    }

    // normalizar class_info (já com período em texto)
    const classMap = new Map();
    classInfoRes.forEach((c) => {
      const cid = Number(c.ed_class_id);

      const normalized = {
        ...c,
        //  período em texto
        ed_class_period_label: periodLabel(c.ed_class_period),
        //  sala em título (quando existir)
        ed_class_room_title: c.ed_classroom_title || "",
        //  max value
        max_value: Number(c.max_value || 0) || null,
      };

      classMap.set(cid, normalized);
    });

    // 3) DISCIPLINAS POR TURMA + títulos
    const subjectsByClass = new Map();
    const allSubjectIdsSet = new Set();

    for (const c of classInfoRes) {
      const cid = Number(c.ed_class_id);
      let subjectsList = [];

      if (c?.ed_class_subjects) {
        subjectsList = String(c.ed_class_subjects)
          .split(",")
          .map((x) => Number(String(x).trim()))
          .filter((n) => Number.isFinite(n) && n >= 1);
      }

      if (subjectFilter > 0) subjectsList = subjectsList.filter((sid) => sid === subjectFilter);

      subjectsByClass.set(cid, subjectsList);
      subjectsList.forEach((sid) => allSubjectIdsSet.add(sid));
    }

    const allSubjectIds = [...allSubjectIdsSet];
    const subjectTitlesMap = new Map();

    if (allSubjectIds.length > 0) {
      const subjPH = allSubjectIds.map(() => "?").join(",");
      const subjectsQuery = `
        SELECT ed_subject_id, ed_subject_title
        FROM eduall_subjects
        WHERE ed_subject_id IN (${subjPH})
          AND ed_subject_deleted = 0
      `;
      const subjectsRes = await ExecuteQuery(
        res,
        subjectsQuery,
        allSubjectIds,
        true,
        { db: "eduall_subjects", type: "select", data: req }
      );

      subjectsRes.forEach((s) => subjectTitlesMap.set(Number(s.ed_subject_id), s.ed_subject_title));
    }

    // 4) ESTUDANTES
    const studentsQuery = `
      SELECT ed_student_id, ed_student_name, ed_student_class
      FROM eduall_students
      WHERE ed_student_class IN (${classPlaceholders})
        AND ed_student_deleted = 0
    `;
    const allStudents = await ExecuteQuery(
      res,
      studentsQuery,
      [...classIDs],
      true,
      { db: "eduall_students", type: "select", data: req }
    );

    const studentsByClass = new Map();
    for (const cid of classIDs) studentsByClass.set(cid, []);
    allStudents.forEach((st) => {
      const cid = Number(st.ed_student_class);
      if (!studentsByClass.has(cid)) studentsByClass.set(cid, []);
      studentsByClass.get(cid).push(st);
    });

    // 5) NOTAS TRIMESTRAIS (MT1/2/3 para MFD)
    const notesQuery = `
      SELECT 
        q.ed_quarter_note_class as class_id,
        q.ed_quarter_note_quarter as quarter,
        q.ed_quarter_note_studentcode as student_id,
        q.ed_quarter_note_subject as subject_id,
        q.ed_quarter_note_mac as mac,
        q.ed_quarter_note_npt as npt
      FROM eduall_quarterly_notes q
      WHERE q.ed_quarter_note_deleted = 0
        AND q.ed_quarter_note_class IN (${classPlaceholders})
        AND q.ed_quarter_note_quarter IN (1,2,3)
        ${subjectFilter > 0 ? "AND q.ed_quarter_note_subject = ?" : ""}
    `;
    const notesParams = subjectFilter > 0 ? [...classIDs, subjectFilter] : [...classIDs];
    const noteRows = await ExecuteQuery(res, notesQuery, notesParams, true, {
      db: "eduall_quarterly_notes", type: "select", data: req,
    });

    // grade map
    const gradeMap = new Map();

    const ensureEntry = (classId, studentId, studentName, subjectId) => {
      const key = `${classId}_${studentId}_${subjectId}`;
      if (!gradeMap.has(key)) {
        const classInfo = classMap.get(classId);

        gradeMap.set(key, {
          class_id: classId,
          class_name: classInfo?.ed_class_title || "",
          student_id: studentId,
          student_name: studentName || "",
          subject_id: subjectId,
          subject_name: subjectTitlesMap.get(subjectId) || "",
          max_value: Number(classInfo?.max_value || 0) || null,

          mt1: null,
          mt2: null,
          mt3: null,
          mfd: null,

          ne: null,
          mf: null,
          rc: null,
          mf_final: null,

          status: null,
          warning: null,
        });
      }
      return gradeMap.get(key);
    };

    // preencher MT1/2/3
    const studentNameMap = new Map(allStudents.map((s) => [Number(s.ed_student_id), s.ed_student_name]));

    for (const r of noteRows) {
      const classId = Number(r.class_id);
      const quarter = Number(r.quarter);
      const studentId = Number(r.student_id);
      const subjectId = Number(r.subject_id);

      const allowedSubjects = subjectsByClass.get(classId) || [];
      if (allowedSubjects.length > 0 && !allowedSubjects.includes(subjectId)) continue;

      const mac = Number(r.mac || 0);
      const npt = Number(r.npt || 0);

      const mtRaw = (mac + npt) / 2;
      const mt = applyRound(Math.floor(mtRaw * 100) / 100);

      const entry = ensureEntry(classId, studentId, studentNameMap.get(studentId) || "", subjectId);

      if (quarter === 1) entry.mt1 = mt;
      if (quarter === 2) entry.mt2 = mt;
      if (quarter === 3) entry.mt3 = mt;
    }

    // garantir linhas vazias
    for (const classId of classIDs) {
      const subjectsList = subjectsByClass.get(classId) || [];
      const studentsList = studentsByClass.get(classId) || [];

      for (const st of studentsList) {
        for (const subjectId of subjectsList) {
          ensureEntry(classId, Number(st.ed_student_id), st.ed_student_name, Number(subjectId));
        }
      }
    }

    // calcular MFD (sempre /3)
    for (const entry of gradeMap.values()) {
      const vals = [entry.mt1, entry.mt2, entry.mt3].filter((v) => typeof v === "number");
      if (vals.length > 0) {
        const sum = vals.reduce((a, b) => a + b, 0);
        const mfdRaw = sum / 3;
        entry.mfd = applyRound(Math.floor(mfdRaw * 100) / 100);
      } else {
        entry.mfd = null;
      }
    }

    // 6) EXAME (NE)
    const examQuery = `
      SELECT 
        n.ed_student_exam_class as class_id,
        n.ed_student_exam_studentCode as student_id,
        n.ed_student_exam_subject as subject_id,
        n.ed_student_exam_score as exam_note
      FROM eduall_student_exam_notes n
      WHERE n.ed_student_exam_deleted = 0
        AND n.ed_student_exam_institute_code = ?
        AND n.ed_student_exam_class IN (${classPlaceholders})
        ${subjectFilter > 0 ? "AND n.ed_student_exam_subject = ?" : ""}
    `;
    const examParams = subjectFilter > 0
      ? [instituteCode, ...classIDs, subjectFilter]
      : [instituteCode, ...classIDs];

    const examRows = await ExecuteQuery(res, examQuery, examParams, true, {
      db: "eduall_student_exam_notes", type: "select", data: req
    });

    for (const r of examRows) {
      const classId = Number(r.class_id);
      const studentId = Number(r.student_id);
      const subjectId = Number(r.subject_id);

      const entry = ensureEntry(classId, studentId, studentNameMap.get(studentId) || "", subjectId);
      const neVal = Number(r.exam_note);
      entry.ne = Number.isFinite(neVal) ? applyRound(neVal) : null;
    }

    // 7) RECURSO (RC)   mantém try/catch até confirmares a tabela real
    const resourceQuery = `
      SELECT 
        r.ed_student_resource_note_class as class_id,
        r.ed_student_resource_note_studentCode as student_id,
        r.ed_student_resource_note_subject as subject_id,
        r.ed_student_resource_note_score as rc_note
      FROM eduall_student_resource_notes r
      WHERE r.ed_student_resource_note_deleted = 0
        AND r.ed_student_resource_note_institute_code = ?
        AND r.ed_student_resource_note_class IN (${classPlaceholders})
        ${subjectFilter > 0 ? "AND r.ed_student_resource_note_subject = ?" : ""}
    `;
    const resourceParams = subjectFilter > 0
      ? [instituteCode, ...classIDs, subjectFilter]
      : [instituteCode, ...classIDs];

    let resourceRows = [];
    try {
      resourceRows = await ExecuteQuery(res, resourceQuery, resourceParams, true, {
        db: "eduall_student_resource_notes", type: "select", data: req
      });
    } catch {
      resourceRows = [];
    }

    for (const r of resourceRows) {
      const classId = Number(r.class_id);
      const studentId = Number(r.student_id);
      const subjectId = Number(r.subject_id);

      const entry = ensureEntry(classId, studentId, studentNameMap.get(studentId) || "", subjectId);
      const rcVal = Number(r.rc_note);
      entry.rc = Number.isFinite(rcVal) ? applyRound(rcVal) : null;
    }

    // 8) MF / MF_FINAL + status/warning
    for (const entry of gradeMap.values()) {
      if (typeof entry.mfd === "number" && typeof entry.ne === "number") {
        const mfRaw = (entry.mfd + entry.ne) / 2;
        entry.mf = applyRound(Math.floor(mfRaw * 100) / 100);
      } else {
        entry.mf = null;
      }

      const max = Number(entry.max_value || 0);
      const half = max > 0 ? max / 2 : null;

      let mfFinal = entry.mf;

      // só “salva” com recurso se estiver negativa
      if (half != null && typeof entry.mf === "number" && entry.mf < half && typeof entry.rc === "number") {
        if (resourceRule === "avg") {
          mfFinal = applyRound(Math.floor((((entry.mf + entry.rc) / 2) * 100)) / 100);
        } else if (resourceRule === "max") {
          mfFinal = applyRound(Math.floor(Math.max(entry.mf, entry.rc) * 100) / 100);
        } else {
          mfFinal = entry.rc; // replace
        }
      }

      entry.mf_final = mfFinal;

      if (max > 0 && typeof entry.mf_final === "number") {
        entry.status = entry.mf_final < max / 2 ? 0 : 1;
        entry.warning = entry.mf_final > max ? 1 : 0;
      } else {
        entry.status = null;
        entry.warning = null;
      }
    }

    // 9) saída por turma (com class_info completo e institute no topo)
    const dataByClass = {};
    for (const classId of classIDs) {
      const classInfo = classMap.get(classId);
      const subjectsList = subjectsByClass.get(classId) || [];

      dataByClass[`class_${classId}`] = {
        class_info: classInfo,
        subjects: subjectsList.map((id) => ({
          subject_id: id,
          subject_title: subjectTitlesMap.get(id) || "",
        })),
        final_results: [],
      };
    }

    for (const entry of gradeMap.values()) {
      const bucket = dataByClass[`class_${entry.class_id}`];
      if (bucket) bucket.final_results.push(entry);
    }

    return res.status(200).json({
      success: true,
      data: {
        institute: {
          ...institute,
          institute_logo: instituteLogo,
        },
        classes: dataByClass,
      },
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ success: false, message: "Erro interno do servidor." });
  }
};

 




 
function safeNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function applyRound(n, mode) {
  if (typeof n !== "number" || !Number.isFinite(n)) return null;
  if (mode === "ceil") return Math.ceil(n); // por excesso (8.5 -> 9)
  return Math.round(n * 100) / 100; // por defeito (mantém decimal)
}

function parseIds(csv) {
  if (!csv) return [];
  return String(csv)
    .split(",")
    .map((x) => Number(String(x).trim()))
    .filter((n) => Number.isFinite(n) && n > 0);
}

/**
 * GET /pauta/minipauta-exame-disciplina/:class?subject=ID&round=default|ceil
 * - Sempre devolve 1 disciplina (subject obrigatório)
 * - Estrutura por turma: { class_info, subject, rows[] }
 */
const GetMiniPautaClasseExameBySubject = async (req, res) => {
  try {
    const classParam = req.params?.class;
    const subjectId = Number(req.query?.subject || 0);
    const roundMode = String(req.query?.round || "default");

    if (!classParam) {
      return res.status(400).json({ success: false, message: "Parâmetro obrigatório: class" });
    }
    if (!Number.isFinite(subjectId) || subjectId <= 0) {
      return res.status(400).json({ success: false, message: "Parâmetro obrigatório: subject (disciplina)" });
    }

    const instituteCode = req?.session?.user?.eduall_user_session_curentinstitute;
    if (!instituteCode) {
      return res.status(401).json({ success: false, message: "Sessão inválida: instituição não encontrada." });
    }

    const classIDs = String(classParam)
      .split(",")
      .map((x) => Number(String(x).trim()))
      .filter((n) => Number.isFinite(n) && n > 0);

    if (!classIDs.length) {
      return res.status(400).json({ success: false, message: "Parâmetro class inválido. Ex: 12 ou 12,15" });
    }

    const classPH = classIDs.map(() => "?").join(",");

    // 1) INSTITUTO (dados reais)
    const instituteQuery = `
      SELECT 
        ed_institute_id,
        ed_institute_name,
        ed_institute_docheader,
        ed_logo_urlcloudinary,
        ed_institute_logo
      FROM eduall_institutes
      WHERE ed_institute_code = ?
      LIMIT 1
    `;
    const instituteRes = await ExecuteQuery(
      res,
      instituteQuery,
      [instituteCode],
      true,
      { db: "eduall_institutes", type: "select", data: req }
    );
    const institute = instituteRes?.[0] || {};
    const instituteLogo =
      String(institute?.ed_logo_urlcloudinary || "").trim() ||
      String(institute?.ed_institute_logo || "").trim() ||
      DEFAULT_LOGO_FALLBACK;

    // 2) TURMAS (com joins)
    const classQuery = `
      SELECT 
        c.*,
        cr.ed_classroom_title,
        ay.ed_academic_year_title, 
        al.ed_academic_level_title,
        al.ed_academic_level_avaliationtype_endat as max_value
      FROM eduall_class c
      LEFT JOIN eduall_classrooms cr
        ON cr.ed_classroom_id = c.ed_class_room
      LEFT JOIN eduall_academic_year ay
        ON ay.ed_academic_year_id = c.ed_class_year
      LEFT JOIN eduall_academic_level al
        ON al.ed_academic_level_id = c.ed_class_academic_level
        AND al.ed_academic_level_deleted = 0
      WHERE c.ed_class_deleted = 0
        AND c.ed_class_institute_code = ?
        AND c.ed_class_id IN (${classPH})
    `;
    const classInfoRes = await ExecuteQuery(
      res,
      classQuery,
      [instituteCode, ...classIDs],
      true,
      { db: "eduall_class", type: "select", data: req }
    );

    if (!classInfoRes?.length) {
      return res.status(404).json({ success: false, message: "Nenhuma turma encontrada." });
    }

    const classMap = new Map();
    for (const c of classInfoRes) classMap.set(Number(c.ed_class_id), c);

    // 3) validar se a turma tem esta disciplina
    for (const c of classInfoRes) {
      const subjectsList = parseIds(c?.ed_class_subjects);
      if (subjectsList.length && !subjectsList.includes(subjectId)) {
        // se a turma não tiver a disciplina, vamos devolver vazio mas sem falhar
        // (assim o frontend só mostra quem tem)
      }
    }

    // 4) buscar título da disciplina
    const subjQuery = `
      SELECT ed_subject_id, ed_subject_title
      FROM eduall_subjects
      WHERE ed_subject_id = ?
        AND ed_subject_deleted = 0
      LIMIT 1
    `;
    const subjRes = await ExecuteQuery(
      res,
      subjQuery,
      [subjectId],
      true,
      { db: "eduall_subjects", type: "select", data: req }
    );
    const subjectTitle = String(subjRes?.[0]?.ed_subject_title || "").trim();
    if (!subjectTitle) {
      return res.status(404).json({ success: false, message: "Disciplina não encontrada." });
    }

    // 5) estudantes
    const studentsQuery = `
      SELECT ed_student_id, ed_student_name, ed_student_class
      FROM eduall_students
      WHERE ed_student_deleted = 0
        AND ed_student_class IN (${classPH})
    `;
    const studentsRes = await ExecuteQuery(
      res,
      studentsQuery,
      [...classIDs],
      true,
      { db: "eduall_students", type: "select", data: req }
    );

    const studentsByClass = new Map();
    for (const cid of classIDs) studentsByClass.set(cid, []);
    for (const st of studentsRes || []) {
      const cid = Number(st.ed_student_class);
      if (!studentsByClass.has(cid)) studentsByClass.set(cid, []);
      studentsByClass.get(cid).push(st);
    }

    // 6) notas trimestrais (MAC/NPT) para a disciplina única
    const notesQuery = `
      SELECT 
        q.ed_quarter_note_class as class_id,
        q.ed_quarter_note_quarter as quarter,
        q.ed_quarter_note_studentcode as student_id,
        q.ed_quarter_note_subject as subject_id,
        q.ed_quarter_note_mac as mac,
        q.ed_quarter_note_npt as npt
      FROM eduall_quarterly_notes q
      WHERE q.ed_quarter_note_deleted = 0
        AND q.ed_quarter_note_class IN (${classPH})
        AND q.ed_quarter_note_quarter IN (1,2,3)
        AND q.ed_quarter_note_subject = ?
    `;
    const noteRows = await ExecuteQuery(
      res,
      notesQuery,
      [...classIDs, subjectId],
      true,
      { db: "eduall_quarterly_notes", type: "select", data: req }
    );

    // pivot por class+student
    const map = new Map();
    const ensure = (classId, studentId, studentName, maxValue) => {
      const key = `${classId}_${studentId}`;
      if (!map.has(key)) {
        map.set(key, {
          class_id: classId,
          student_id: studentId,
          student_name: studentName || "",
          max_value: safeNum(maxValue) ?? null,
          mac1: null, npt1: null, mt1: null,
          mac2: null, npt2: null, mt2: null,
          mac3: null, npt3: null, mt3: null,
          mfd: null,
        });
      }
      return map.get(key);
    };

    // garantir linhas (mesmo sem notas)
    for (const cid of classIDs) {
      const classInfo = classMap.get(cid);
      const maxv = classInfo?.max_value;
      const studs = studentsByClass.get(cid) || [];
      for (const st of studs) {
        ensure(cid, Number(st.ed_student_id), st.ed_student_name, maxv);
      }
    }

    // preencher pelas notas
    for (const r of noteRows || []) {
      const classId = Number(r.class_id);
      const studentId = Number(r.student_id);
      const quarter = Number(r.quarter);

      const st = (studentsRes || []).find((x) => Number(x.ed_student_id) === studentId);
      const classInfo = classMap.get(classId);
      const entry = ensure(classId, studentId, st?.ed_student_name || "", classInfo?.max_value);

      const mac = safeNum(r.mac);
      const npt = safeNum(r.npt);
      const mtRaw = typeof mac === "number" && typeof npt === "number" ? (mac + npt) / 2 : null;
      const mt = mtRaw === null ? null : applyRound(mtRaw, roundMode);

      if (quarter === 1) { entry.mac1 = mac; entry.npt1 = npt; entry.mt1 = mt; }
      if (quarter === 2) { entry.mac2 = mac; entry.npt2 = npt; entry.mt2 = mt; }
      if (quarter === 3) { entry.mac3 = mac; entry.npt3 = npt; entry.mt3 = mt; }
    }

    // MFD = (MT1 + MT2 + MT3) / 3
    for (const entry of map.values()) {
      const vals = [entry.mt1, entry.mt2, entry.mt3].filter((v) => typeof v === "number");
      if (vals.length) {
        const sum = vals.reduce((a, b) => a + b, 0);
        entry.mfd = applyRound(sum / 3, roundMode);
      }
    }

    // saída: por turma
    const classes = {};
    for (const cid of classIDs) {
      const classInfo = classMap.get(cid);
      const rows = [];
      for (const v of map.values()) {
        if (v.class_id === cid) rows.push(v);
      }
      rows.sort((a, b) => String(a.student_name).localeCompare(String(b.student_name), "pt", { sensitivity: "base" }));

      classes[`class_${cid}`] = {
        class_info: classInfo,
        subject: { subject_id: subjectId, subject_title: subjectTitle },
        rows,
      };
    }

    return res.status(200).json({
      success: true,
      data: {
        institute: {
          ...institute,
          institute_logo: instituteLogo,
        },
        classes,
      },
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, message: "Erro interno do servidor." });
  }
};
 
 
module.exports = {
    GetSingleClassScoreByNumber,
    GetSingleQuarterlyNoteBySubStdQrtType,
     GetSingleQuarterlyNoteBySubStdQrtTypeClass ,
    GetQuarterlyNotes, 
    GetStudentMTAll3Quarters,
    GetsingleQuarterlyNote, 
    GetsingleQuarterlyNotebYQrtSub, 
    GetsingleQuarterlyNoteByID, 
    GetsingleQuarterlyNotebYSubCls, 
    RegisterQuarterlyNote, 
    QuarterlyNoteUpdate, 
    QuarterlyNoteDelete,
    GetQuarterlyNotesFullData,
    GetQuarterlyMiniPautaFullData,
    GetFinalMiniPautaFullData,
    GetFinalMiniPautaExamsAndResourceFullData,
    GetMiniPautaClasseExameBySubject,
    ListQuarterlyNotes
};
 