const ExecuteQuery = require("../Functions/ExecuteQuery");
const { RegisterAuditAction } = require("./Auditory");

/* ═══════════════════════════════════════════════════════════════════
   FUNÇÕES DE UTILIDADE
═══════════════════════════════════════════════════════════════════ */

function parseIds(csv) {
  if (!csv) return [];
  return String(csv)
    .split(",")
    .map((n) => Number(n.trim()))
    .filter((n) => !isNaN(n) && n > 0);
}

function serializeIds(arr) {
  return [...new Set(arr)].join(",");
}

//  NOVO: Parse behaviors (formato: "1:negative_reprova,2:approve_anyway")
function parseBehaviors(csv) {
  const map = new Map();
  if (!csv) return map;
  
  const pairs = String(csv).split(",").filter(Boolean);
  pairs.forEach(pair => {
    const [id, behavior] = pair.split(":");
    if (id && behavior) {
      map.set(Number(id), behavior);
    }
  });
  return map;
}

//  NOVO: Serialize behaviors
function serializeBehaviors(map) {
  return Array.from(map)
    .map(([id, behavior]) => `${id}:${behavior}`)
    .join(",");
}

async function fetchClassRow(res, req, classID, inst) {
  const rows = await ExecuteQuery(
    res,
    `SELECT ed_class_subjects, ed_class_key_subjects, ed_class_subject_averages, ed_class_subject_behaviors
     FROM eduall_class
     WHERE ed_class_id = ? AND ed_class_deleted = 0 AND ed_class_institute_code = ?
     LIMIT 1`,
    [classID, inst],
    true,
    { db: "eduall_class", type: "select", data: req }
  );
  return rows?.[0] ?? null;
}

/* ═══════════════════════════════════════════════════════════════════
   GET SUBJECTS
═══════════════════════════════════════════════════════════════════ */

const GetSubjects = async (req, res) => {
   try {
      const query = 'SELECT * FROM eduall_subjects WHERE ed_subject_deleted = 0 AND ed_subject_institute_code = ? ORDER BY ed_subject_title ASC';
      const PARAMS = [req.session.user.eduall_user_session_curentinstitute];
      const rows = await ExecuteQuery(res, query, PARAMS, true, { db: "eduall_subjects", type: "select", data: req });
      res.status(200).json(rows);
   } catch (err) {
      res.status(400).json({ status: 300, success: false, msg: err.message });
   }
};

const GetSingleSubject = async (req, res) => {
   try {
      const { ID } = req.params;
      const query = 'SELECT * FROM eduall_subjects WHERE ed_subject_deleted = 0 AND ed_subject_id = ?';
      const PARAMS = [ID];
      const rows = await ExecuteQuery(res, query, PARAMS, true, { db: "eduall_subjects", type: "select", data: req });
      res.status(200).json(rows);
   } catch (err) {
      res.status(400).json({ status: 300, success: false, msg: err.message });
   }
};

const RegisterSubject = async (req, res) => {
   try {
      const { subject_title, subject_category, subject_type } = req.body;

      const checkQuery = `
         SELECT * FROM eduall_subjects
         WHERE LOWER(ed_subject_title) = LOWER(?) AND ed_subject_deleted = 0
         AND ed_subject_institute_code = ?
      `;
      const checkParams = [subject_title, req.session.user.eduall_user_session_curentinstitute];
      const existingSubject = await ExecuteQuery(res, checkQuery, checkParams, true, {
         db: "eduall_subjects",
         type: "select",
         data: req
      });

      if (existingSubject.length > 0) {
         return res.status(400).json({
            success: false,
            msg: "Já existe uma disciplina com esse nome!"
         });
      }

      const query = `INSERT INTO eduall_subjects(ed_subject_title, ed_subject_category, ed_subject_type, ed_subject_institute_code) VALUES(?,?,?,?)`;
      const PARAMS = [subject_title, subject_category, subject_type, req.session.user.eduall_user_session_curentinstitute];
      const rows = await ExecuteQuery(res, query, PARAMS, false, { db: "eduall_subjects", type: "insert", data: req });

      await RegisterAuditAction({
         session: req.session,
         action: 1,
         form: "Disciplinas",
         description: `Registrou uma nova disciplina (${subject_title})`,
      });

      res.status(200).json(rows);
   } catch (err) {
      res.status(400).json({ status: 300, success: false, msg: err.message });
   }
};

const SubjectUpdate = async (req, res) => {
   try {
      const { ID } = req.params;
      const { subject_title, subject_category, subject_type } = req.body;

      const checkQuery = `
         SELECT * FROM eduall_subjects
         WHERE LOWER(ed_subject_title) = LOWER(?) AND ed_subject_deleted = 0
         AND ed_subject_institute_code = ? AND ed_subject_id != ?
      `;
      const checkParams = [subject_title, req.session.user.eduall_user_session_curentinstitute, ID];
      const existingSubject = await ExecuteQuery(res, checkQuery, checkParams, true, {
         db: "eduall_subjects",
         type: "select",
         data: req
      });

      if (existingSubject.length > 0) {
         return res.status(400).json({
            success: false,
            msg: "Já existe uma disciplina com esse nome!"
         });
      }

      const query = `UPDATE eduall_subjects SET ed_subject_title = ?, ed_subject_category = ?, ed_subject_type = ? WHERE ed_subject_deleted = 0 AND ed_subject_id = ?`;
      const PARAMS = [subject_title, subject_category, subject_type, ID];
      await ExecuteQuery(res, query, PARAMS, false, { db: "eduall_subjects", type: "update", data: req });

      await RegisterAuditAction({
         session: req.session,
         action: 2,
         form: "Disciplinas",
         description: `Atualizou a disciplina (${subject_title}) com ID ${ID}`,
      });

      res.status(200).json({ success: true, msg: "Disciplina atualizada com sucesso." });
   } catch (err) {
      res.status(400).json({ status: 300, success: false, msg: err.message });
   }
};

const SubjectDelete = async (req, res) => {
   try {
      const { ID } = req.params; 
      const query = `UPDATE eduall_subjects SET ed_subject_deleted = 1 WHERE ed_subject_deleted = 0 AND ed_subject_id = ?`;
      const PARAMS = [ID];
      await ExecuteQuery(res, query, PARAMS, false, { db: "eduall_subjects", type: "update", data: req });

      await RegisterAuditAction({
         session: req.session,
         action: 3,
         form: "Disciplinas",
         description: `Eliminou a disciplina com ID ${ID}`,
      });

      res.status(200).json({ success: true, msg: "Disciplina eliminada com sucesso." });
   } catch (err) {
      res.status(400).json({ status: 300, success: false, msg: err.message });
   }
};

/* ═══════════════════════════════════════════════════════════════════
   GET CLASS SUBJECTS COM MÉDIAS E COMPORTAMENTOS
═══════════════════════════════════════════════════════════════════ */

const GetSubjectsByClass2 = async (req, res) => {
  try {
    const { classID } = req.params;
    const inst = req.session?.user?.eduall_user_session_curentinstitute;

    const row = await fetchClassRow(res, req, classID, inst);
    if (!row) {
      return res.status(404).json({ success: false, msg: "Turma não encontrada." });
    }

    const subjectIds = parseIds(row.ed_class_subjects);
    const keyIds = new Set(parseIds(row.ed_class_key_subjects));
    
    //  Parse averages (formato: "1:15.5,2:12.0,3:")
    const averageMap = new Map();
    if (row.ed_class_subject_averages) {
      const pairs = String(row.ed_class_subject_averages).split(",").filter(Boolean);
      pairs.forEach(pair => {
        const [id, avg] = pair.split(":");
        if (id && avg !== undefined) {
          averageMap.set(Number(id), Number(avg) || null);
        }
      });
    }

    //  Parse behaviors (formato: "1:negative_reprova,2:approve_anyway")
    const behaviorMap = parseBehaviors(row.ed_class_subject_behaviors);

    if (!subjectIds.length) {
      return res.json({ success: true, subjects: [] });
    }

    const placeholders = subjectIds.map(() => "?").join(",");
    const rows = await ExecuteQuery(
      res,
      `SELECT ed_subject_id, ed_subject_title
       FROM eduall_subjects
       WHERE ed_subject_id IN (${placeholders})
       ORDER BY ed_subject_title ASC`,
      subjectIds,
      true,
      { db: "eduall_subjects", type: "select", data: req }
    );

    const subjects = rows.map((s) => ({
      subjectID:    s.ed_subject_id,
      subjectTitle: s.ed_subject_title,
      isKey:        keyIds.has(Number(s.ed_subject_id)),
      average:      averageMap.get(Number(s.ed_subject_id)) || null,
      behavior:     behaviorMap.get(Number(s.ed_subject_id)) || "negative_reprova",
    }));

    return res.json({ success: true, subjects });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, msg: "Erro ao obter disciplinas.", error: err.message });
  }
};

/* ═══════════════════════════════════════════════════════════════════
   ADD SUBJECT TO CLASS
═══════════════════════════════════════════════════════════════════ */

const AddSubjectToClass = async (req, res) => {
  try {
    const { classID, subjectID } = req.body;

    if (!classID || !subjectID) {
      return res.status(400).json({ success: false, msg: "ID da turma e disciplina são obrigatórios." });
    }

    const inst = req.session?.user?.eduall_user_session_curentinstitute;
    const row  = await fetchClassRow(res, req, classID, inst);

    if (!row) {
      return res.status(404).json({ success: false, msg: "Turma não encontrada." });
    }

    const arr    = parseIds(row.ed_class_subjects);
    const idNum  = Number(subjectID);

    if (arr.includes(idNum)) {
      return res.status(409).json({ success: false, msg: "Esta disciplina já foi adicionada à turma." });
    }

    arr.push(idNum);

    await ExecuteQuery(
      res,
      `UPDATE eduall_class SET ed_class_subjects = ?
       WHERE ed_class_id = ? AND ed_class_institute_code = ?`,
      [serializeIds(arr), classID, inst],
      false,
      { db: "eduall_class", type: "update", data: req }
    );

    return res.json({ success: true, msg: "Disciplina adicionada com sucesso!", subjects: arr });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, msg: "Erro ao adicionar disciplina.", error: err.message });
  }
};

/* ═══════════════════════════════════════════════════════════════════
   REMOVE SUBJECT FROM CLASS
═══════════════════════════════════════════════════════════════════ */

const RemoveSubjectFromClass = async (req, res) => {
  try { 
    const { classID, subjectID } = req.body;

    if (!classID || !subjectID) {
      return res.status(400).json({
        success: false,
        msg: "ID da turma e disciplina são obrigatórios."
      });
    }

    const inst = req.session?.user?.eduall_user_session_curentinstitute;

    const querySelect = `
      SELECT ed_class_subjects 
      FROM eduall_class
      WHERE ed_class_id = ?
        AND ed_class_deleted = 0
        AND ed_class_institute_code = ?
      LIMIT 1
    `;

    const rows = await ExecuteQuery(res, querySelect, [classID, inst], true);

    if (!rows.length) {
      return res.status(404).json({ success: false, msg: "Turma não encontrada." });
    }

    let arr = rows[0].ed_class_subjects
      .split(",")
      .map(Number)
      .filter(id => !isNaN(id) && id !== Number(subjectID));

    const newString = arr.join(",");

    const queryUpdate = `
      UPDATE eduall_class
      SET ed_class_subjects = ?
      WHERE ed_class_id = ?
        AND ed_class_institute_code = ?
    `;

    await ExecuteQuery(res, queryUpdate, [newString, classID, inst], false);

    return res.json({
      success: true,
      msg: "Disciplina removida com sucesso!",
      subjects: arr
    });

  } catch (err) {
    console.error(err);
    return res.status(500).json({
      success: false,
      msg: "Erro ao remover disciplina.",
      error: err.message
    });
  }
};

/* ═══════════════════════════════════════════════════════════════════
   TOGGLE KEY SUBJECT
═══════════════════════════════════════════════════════════════════ */

const ToggleKeySubject = async (req, res) => {
  try {
    const { classID, subjectID, isKey } = req.body;

    if (!classID || !subjectID) {
      return res.status(400).json({ success: false, msg: "ID da turma e disciplina são obrigatórios." });
    }

    const inst  = req.session?.user?.eduall_user_session_curentinstitute;
    const row   = await fetchClassRow(res, req, classID, inst);

    if (!row) {
      return res.status(404).json({ success: false, msg: "Turma não encontrada." });
    }

    const subjectIds = parseIds(row.ed_class_subjects);
    const idNum      = Number(subjectID);

    if (!subjectIds.includes(idNum)) {
      return res.status(400).json({ success: false, msg: "Esta disciplina não está atribuída à turma." });
    }

    let keyIds = parseIds(row.ed_class_key_subjects);

    if (isKey) {
      if (!keyIds.includes(idNum)) keyIds.push(idNum);
    } else {
      keyIds = keyIds.filter((n) => n !== idNum);
    }

    await ExecuteQuery(
      res,
      `UPDATE eduall_class SET ed_class_key_subjects = ?
       WHERE ed_class_id = ? AND ed_class_institute_code = ?`,
      [serializeIds(keyIds), classID, inst],
      false,
      { db: "eduall_class", type: "update", data: req }
    );

    return res.json({
      success: true,
      msg: isKey ? "Disciplina marcada como chave!" : "Disciplina removida das chave!",
      keySubjects: keyIds,
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, msg: "Erro ao alterar disciplina chave.", error: err.message });
  }
};



/* ═══════════════════════════════════════════════════════════════════
    UPDATE SUBJECT BEHAVIOR (NOVA FUNÇÃO)
═══════════════════════════════════════════════════════════════════ */

const UpdateSubjectBehavior = async (req, res) => {
  try {
    const { classID, subjectID, behavior } = req.body;

    if (!classID || !subjectID || !behavior) {
      return res.status(400).json({ 
        success: false, 
        msg: "ID da turma, disciplina e comportamento são obrigatórios." 
      });
    }

    // Validar comportamento
    const validBehaviors = ["negative_reprova", "approve_anyway"];
    if (!validBehaviors.includes(behavior)) {
      return res.status(400).json({ 
        success: false, 
        msg: "Comportamento inválido." 
      });
    }

    const inst = req.session?.user?.eduall_user_session_curentinstitute;
    const row = await fetchClassRow(res, req, classID, inst);

    if (!row) {
      return res.status(404).json({ success: false, msg: "Turma não encontrada." });
    }

    const subjectIds = parseIds(row.ed_class_subjects);
    const idNum = Number(subjectID);

    if (!subjectIds.includes(idNum)) {
      return res.status(400).json({ 
        success: false, 
        msg: "Esta disciplina não está atribuída à turma." 
      });
    }

    // Parse behaviors
    const behaviorMap = parseBehaviors(row.ed_class_subject_behaviors);
    
    // Actualizar comportamento
    behaviorMap.set(idNum, behavior);

    const serializedBehaviors = serializeBehaviors(behaviorMap);

    await ExecuteQuery(
      res,
      `UPDATE eduall_class SET ed_class_subject_behaviors = ?
       WHERE ed_class_id = ? AND ed_class_institute_code = ?`,
      [serializedBehaviors, classID, inst],
      false,
      { db: "eduall_class", type: "update", data: req }
    );

    await RegisterAuditAction({
      session: req.session,
      action: 2,
      form: "Disciplinas da Turma",
      description: `Actualizou o comportamento da disciplina ${subjectID} para ${behavior} na turma ${classID}`,
    });

    return res.json({
      success: true,
      msg: "Comportamento actualizado com sucesso!",
      subjectID: idNum,
      behavior: behavior,
    });

  } catch (err) {
    console.error(err);
    return res.status(500).json({ 
      success: false, 
      msg: "Erro ao actualizar comportamento.", 
      error: err.message 
    });
  }
};

/* ═══════════════════════════════════════════════════════════════════
   UPDATE SUBJECT AVERAGE
═══════════════════════════════════════════════════════════════════ */

const UpdateSubjectAverage = async (req, res) => {
  try {
    const { classID, subjectID, average } = req.body;

    if (!classID || !subjectID) {
      return res.status(400).json({ 
        success: false, 
        msg: "ID da turma e disciplina são obrigatórios." 
      });
    }

    const inst = req.session?.user?.eduall_user_session_curentinstitute;
    const row = await fetchClassRow(res, req, classID, inst);

    if (!row) {
      return res.status(404).json({ success: false, msg: "Turma não encontrada." });
    }

    const subjectIds = parseIds(row.ed_class_subjects);
    const idNum = Number(subjectID);

    if (!subjectIds.includes(idNum)) {
      return res.status(400).json({ 
        success: false, 
        msg: "Esta disciplina não está atribuída à turma." 
      });
    }

    // Parse averages current
    const averageMap = new Map();
    if (row.ed_class_subject_averages) {
      const pairs = String(row.ed_class_subject_averages).split(",").filter(Boolean);
      pairs.forEach(pair => {
        const [id, avg] = pair.split(":");
        if (id) {
          averageMap.set(Number(id), Number(avg) || null);
        }
      });
    }

    // Actualizar a média
    const newAverage = average === "" || average === null ? null : Number(average);
    if (newAverage !== null && (isNaN(newAverage) || newAverage < 0 || newAverage > 20)) {
      return res.status(400).json({ 
        success: false, 
        msg: "A média deve estar entre 0 e 20." 
      });
    }

    averageMap.set(idNum, newAverage);

    const serializedAverages = Array.from(averageMap)
      .map(([id, avg]) => `${id}:${avg === null ? "" : avg}`)
      .join(",");

    await ExecuteQuery(
      res,
      `UPDATE eduall_class SET ed_class_subject_averages = ?
       WHERE ed_class_id = ? AND ed_class_institute_code = ?`,
      [serializedAverages, classID, inst],
      false,
      { db: "eduall_class", type: "update", data: req }
    );

    await RegisterAuditAction({
      session: req.session,
      action: 2,
      form: "Disciplinas da Turma",
      description: `Actualizou a média da disciplina ${subjectID} para ${newAverage} na turma ${classID}`,
    });

    return res.json({
      success: true,
      msg: "Média actualizada com sucesso!",
      subjectID: idNum,
      average: newAverage,
    });

  } catch (err) {
    console.error(err);
    return res.status(500).json({ 
      success: false, 
      msg: "Erro ao actualizar média.", 
      error: err.message 
    });
  }
};
 
/* ═══════════════════════════════════════════════════════════════════
   REGISTER TEACHER SUBJECT BULK
═══════════════════════════════════════════════════════════════════ */

const RegisterTeacherSubjectBulk = async (req, res) => {
  try {
    const institute = req.session.user.eduall_user_session_curentinstitute;
    const items = Array.isArray(req.body.items) ? req.body.items : [];

    if (!items.length) {
      return res.status(400).json({ success: false, msg: "Envie items[] com pelo menos 1 atribuição." });
    }

    let inserted = 0;
    const failed = [];

    for (const it of items) {
      const teacherCode = it.teacher_subject_teacher_code;
      const classId = it.teacher_subject_class;
      const subjectId = it.teacher_subject_code;

      if (!teacherCode || !classId || !subjectId) {
        failed.push({ item: it, error: "Campos obrigatórios em falta." });
        continue;
      }

      const checkOwnQuery = `
        SELECT ed_tch_subject_id FROM eduall_teacher_subjects
        WHERE ed_tch_subject_class = ?
          AND ed_tch_subject_teacher_code = ?
          AND ed_tch_subject_code = ?
          AND ed_tch_subject_institute_code = ?
          AND ed_tch_subject_deleted = 0
        LIMIT 1
      `;
      const existingOwn = await ExecuteQuery(res, checkOwnQuery, [classId, teacherCode, subjectId, institute], true, {
        db: "eduall_teacher_subjects", type: "select", data: req
      });

      if (existingOwn.length) {
        failed.push({ item: it, error: "Já existe esta disciplina atribuída para este professor nesta turma." });
        continue;
      }

      const checkOtherQuery = `
        SELECT ed_tch_subject_id FROM eduall_teacher_subjects
        WHERE ed_tch_subject_class = ?
          AND ed_tch_subject_code = ?
          AND ed_tch_subject_institute_code = ?
          AND ed_tch_subject_teacher_code != ?
          AND ed_tch_subject_deleted = 0
        LIMIT 1
      `;
      const existingOther = await ExecuteQuery(res, checkOtherQuery, [classId, subjectId, institute, teacherCode], true, {
        db: "eduall_teacher_subjects", type: "select", data: req
      });

      if (existingOther.length) {
        failed.push({ item: it, error: "Esta disciplina já foi atribuída a outro professor nesta turma." });
        continue;
      }

      const insertQuery = `
        INSERT INTO eduall_teacher_subjects(
          ed_tch_subject_code, ed_tch_subject_class, ed_tch_subject_teacher_code, ed_tch_subject_institute_code
        ) VALUES (?,?,?,?)
      `;
      await ExecuteQuery(res, insertQuery, [subjectId, classId, teacherCode, institute], false, {
        db: "eduall_teacher_subjects", type: "insert", data: req
      });

      inserted++;
    }

    if (inserted > 0) {
      await RegisterAuditAction({
        session: req.session,
        action: 1,
        form: "Disciplinas dos Professores (Lote)",
        description: `Atribuiu ${inserted} disciplina(s) em lote.`,
      });
    }

    return res.status(200).json({
      success: true,
      inserted,
      failed: failed.length,
      details: { failed },
    });
  } catch (err) {
    console.log("Error : ", err);
    return res.status(400).json({ success: false, msg: err.message });
  }
};

/* ═══════════════════════════════════════════════════════════════════
   GET CLASS SUBJECTS FROM CLASS TABLE BY CLASS ID
═══════════════════════════════════════════════════════════════════ */

const GetClassSubjectsFromClassTableByClassID = async (req, res) => {
  try {
    const { classID } = req.params;

    if (!classID) {
      return res.status(400).json({
        success: false,
        msg: "É necessário informar o ID da turma.",
      });
    }

    const instituteCode =
      req.session?.user?.eduall_user_session_curentinstitute ?? null;

    if (!instituteCode) {
      return res.status(401).json({
        success: false,
        msg: "Sessão inválida ou instituto não encontrado.",
      });
    }

    const classQuery = `
      SELECT 
        ed_class_id,
        ed_class_subjects,
        ed_class_subject_averages,
        ed_class_subject_behaviors
      FROM eduall_class
      WHERE ed_class_deleted = 0
        AND ed_class_institute_code = ?
        AND ed_class_id = ?
      LIMIT 1
    `;

    const clsRows = await ExecuteQuery(
      res,
      classQuery,
      [instituteCode, classID],
      true,
      { db: "eduall_class", type: "select", data: req }
    );

    if (!clsRows || clsRows.length === 0) {
      return res.status(404).json({
        success: false,
        msg: "Turma não encontrada.",
      });
    }

    const rawCsv = clsRows[0]?.ed_class_subjects ?? "";
    const rawAverages = clsRows[0]?.ed_class_subject_averages ?? "";
    const rawBehaviors = clsRows[0]?.ed_class_subject_behaviors ?? "";

    // Parse averages
    const averageMap = new Map();
    if (rawAverages) {
      const pairs = String(rawAverages).split(",").filter(Boolean);
      pairs.forEach(pair => {
        const [id, avg] = pair.split(":");
        if (id) {
          averageMap.set(Number(id), Number(avg) || null);
        }
      });
    }

    // Parse behaviors
    const behaviorMap = parseBehaviors(rawBehaviors);

    const ids = String(rawCsv)
      .split(",")
      .map((x) => String(x).trim())
      .filter(Boolean);

    const uniqueIds = [...new Set(ids)];

    if (uniqueIds.length === 0) {
      return res.status(200).json({
        success: true,
        classID,
        subjects: [],
      });
    }

    const placeholders = uniqueIds.map(() => "?").join(",");

    const subjQuery = `
      SELECT 
        ed_subject_id,
        ed_subject_title
      FROM eduall_subjects
      WHERE ed_subject_deleted = 0
        AND ed_subject_institute_code = ?
        AND ed_subject_id IN (${placeholders})
      ORDER BY ed_subject_title ASC
    `;

    const subjRows = await ExecuteQuery(
      res,
      subjQuery,
      [instituteCode, ...uniqueIds],
      true,
      { db: "eduall_subjects", type: "select", data: req }
    );

    const titleMap = new Map();
    for (const r of subjRows || []) {
      titleMap.set(String(r.ed_subject_id), r.ed_subject_title);
    }

    const formatted = uniqueIds.map((id) => ({
      subjectID: id,
      subjectTitle: titleMap.get(String(id)) || "Disciplina não encontrada",
      average: averageMap.get(Number(id)) || null,
      behavior: behaviorMap.get(Number(id)) || "negative_reprova",
      classID,
    }));

    return res.status(200).json({
      success: true,
      classID,
      subjects: formatted,
    });
  } catch (err) {
    console.log("ERRO em GetClassSubjectsFromClassTableByClassID:", err);
    return res.status(500).json({
      success: false,
      msg: "Erro interno no servidor.",
      error: err.message,
    });
  }
};

/* ═══════════════════════════════════════════════════════════════════
   GET CLASS SUBJECTS BY CLASS ID
═══════════════════════════════════════════════════════════════════ */

const GetClassSubjectsByClassID = async (req, res) => {
  try {
    const { classID } = req.params;

    if (!classID) {
      return res.status(400).json({
        success: false,
        msg: "É necessário informar o ID da turma."
      });
    }

    const instituteCode =
      req.session?.user?.eduall_user_session_curentinstitute ?? null;

    const query = `
      SELECT 
        ts.ed_tch_subject_id,
        ts.ed_tch_subject_code,
        ts.ed_tch_subject_teacher_code,
        ts.ed_tch_subject_class,
        s.ed_subject_title
      FROM eduall_teacher_subjects ts
      LEFT JOIN eduall_subjects s
        ON s.ed_subject_id = ts.ed_tch_subject_code
      WHERE ts.ed_tch_subject_deleted = 0
        AND ts.ed_tch_subject_institute_code = ?
        AND ts.ed_tch_subject_class = ?
      ORDER BY s.ed_subject_title ASC
    `;

    const rows = await ExecuteQuery(
      res,
      query,
      [instituteCode, classID],
      true,
      { db: "eduall_teacher_subjects", type: "select", data: req }
    );

    if (!rows || rows.length === 0) {
      return res.status(200).json({
        success: true,
        classID,
        subjects: []
      });
    }

    const unique = [];
    const map = new Set();

    for (const r of rows) {
      if (!map.has(r.ed_tch_subject_id)) {
        map.add(r.ed_tch_subject_id);
        unique.push(r);
      }
    }

    const formatted = unique.map((item) => ({
      subjectTeacherID: item.ed_tch_subject_id,
      subjectID: item.ed_tch_subject_code,
      subjectTitle: item.ed_subject_title || "Disciplina não encontrada",
      teacherID: item.ed_tch_subject_teacher_code,
      classID: item.ed_tch_subject_class
    }));

    return res.status(200).json({
      success: true,
      classID,
      subjects: formatted
    });

  } catch (err) {
    console.log("❌ ERRO em GetClassSubjectsByClassID:", err);
    return res.status(500).json({
      success: false,
      msg: "Erro interno no servidor.",
      error: err.message
    });
  }
};

/* ═══════════════════════════════════════════════════════════════════
   EXPORTS
═══════════════════════════════════════════════════════════════════ */

module.exports = {
  GetSubjectsByClass2, 
  ToggleKeySubject,
  UpdateSubjectAverage,
  UpdateSubjectBehavior,  //  NOVA FUNÇÃO
  GetSubjects,
  RegisterTeacherSubjectBulk,
  GetSingleSubject,
  RegisterSubject,
  SubjectDelete,
  AddSubjectToClass,
  RemoveSubjectFromClass,
  GetClassSubjectsByClassID,
  SubjectUpdate,
  GetClassSubjectsFromClassTableByClassID
};