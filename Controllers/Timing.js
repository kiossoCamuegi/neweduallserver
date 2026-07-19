 
const ExecuteQuery = require("../Functions/ExecuteQuery");
const { RegisterAuditAction } = require("./Auditory");

const GetTimings = async (req, res) => {
   try {
      const query = 'SELECT * FROM eduall_timing WHERE ed_timing_deleted = 0 AND ed_timing_institute_code = ?';
      const PARAMS = [req.session.user.eduall_user_session_curentinstitute];
      const rows = await ExecuteQuery(res, query, PARAMS, true, { db: "eduall_timing", type: "select", data: req });
      res.status(200).json(rows);
   } catch (err) {
      res.status(400).json({ status: 300, success: false, msg: err.message });
   }
};

const GetSingleTiming = async (req, res) => {
   try {
      const { ID } = req.params;
      const query = 'SELECT * FROM eduall_timing WHERE ed_timing_deleted = 0 AND ed_timing_id = ? AND ed_timing_institute_code = ?';
      const PARAMS = [ID, req.session.user.eduall_user_session_curentinstitute];
      const rows = await ExecuteQuery(res, query, PARAMS, true, { db: "eduall_timing", type: "select", data: req });
      res.status(200).json(rows);
   } catch (err) {
      res.status(400).json({ status: 300, success: false, msg: err.message });
   }
};

const isValidTime = (hStart, mStart, hEnd, mEnd) => {
  const hs = parseInt(hStart), ms = parseInt(mStart);
  const he = parseInt(hEnd), me = parseInt(mEnd);

  if (
    isNaN(hs) || isNaN(ms) || isNaN(he) || isNaN(me) ||
    hs < 0 || hs > 23 || he < 0 || he > 23 ||
    ms < 0 || ms > 59 || me < 0 || me > 59
  ) {
    return false;
  }

  // Comparar horários
  if (hs > he || (hs === he && ms >= me)) {
    return false;
  }

  return true;
};

const RegisterTiming = async (req, res) => {
  try {
    const { timing_hour_start, timing_minute_start, timing_hour_end, timing_minute_end } = req.body;

    if (!isValidTime(timing_hour_start, timing_minute_start, timing_hour_end, timing_minute_end)) {
      return res.status(400).json({ success: false, msg: "Horário inválido! Verifique os valores informados." });
    }

    const checkQuery = `
      SELECT * FROM eduall_timing 
      WHERE ed_timing_hour_start = ? AND ed_timing_minute_start = ?
      AND ed_timing_hour_end = ? AND ed_timing_minute_end = ?
      AND ed_timing_deleted = 0 AND ed_timing_institute_code = ?
    `;
    const checkParams = [
      timing_hour_start, timing_minute_start, timing_hour_end, timing_minute_end,
      req.session.user.eduall_user_session_curentinstitute
    ];
    const existingTiming = await ExecuteQuery(res, checkQuery, checkParams, true, {
      db: "eduall_timing", type: "select", data: req
    });

    if (existingTiming.length > 0) {
      return res.status(400).json({ success: false, msg: "Já existe um horário com os mesmos horários!" });
    }

    const query = `INSERT INTO eduall_timing(ed_timing_hour_start, ed_timing_minute_start, ed_timing_hour_end, ed_timing_minute_end, ed_timing_institute_code) VALUES(?,?,?,?,?)`;
    const PARAMS = [
      timing_hour_start, timing_minute_start, timing_hour_end, timing_minute_end,
      req.session.user.eduall_user_session_curentinstitute
    ];
    await ExecuteQuery(res, query, PARAMS, false, { db: "eduall_timing", type: "insert", data: req });

    await RegisterAuditAction({
      session: req.session,
      action: 1,
      form: "Horários",
      description: `Registrou um novo horário das ${timing_hour_start}:${timing_minute_start} às ${timing_hour_end}:${timing_minute_end}`,
    });

    res.status(200).json({ success: true, msg: "Horário registrado com sucesso!" });
  } catch (err) {
    res.status(400).json({ status: 300, success: false, msg: err.message });
  }
};

const TimingUpdate = async (req, res) => {
  try {
    const { ID } = req.params;
    const { timing_hour_start, timing_minute_start, timing_hour_end, timing_minute_end } = req.body;

    if (!isValidTime(timing_hour_start, timing_minute_start, timing_hour_end, timing_minute_end)) {
      return res.status(400).json({ success: false, msg: "Horário inválido! Verifique os valores informados." });
    }

    const checkQuery = `
      SELECT * FROM eduall_timing 
      WHERE ed_timing_hour_start = ? AND ed_timing_minute_start = ?
      AND ed_timing_hour_end = ? AND ed_timing_minute_end = ?
      AND ed_timing_deleted = 0 AND ed_timing_institute_code = ? AND ed_timing_id != ?
    `;
    const checkParams = [
      timing_hour_start, timing_minute_start, timing_hour_end, timing_minute_end,
      req.session.user.eduall_user_session_curentinstitute, ID
    ];
    const existingTiming = await ExecuteQuery(res, checkQuery, checkParams, true, {
      db: "eduall_timing", type: "select", data: req
    });

    if (existingTiming.length > 0) {
      return res.status(400).json({ success: false, msg: "Já existe um horário com os mesmos horários!" });
    }

    const query = `UPDATE eduall_timing SET ed_timing_hour_start = ?, ed_timing_minute_start = ?, ed_timing_hour_end = ?, ed_timing_minute_end = ? 
    WHERE ed_timing_deleted = 0 AND ed_timing_id = ? AND ed_timing_institute_code = ?`;
    const PARAMS = [
      timing_hour_start, timing_minute_start, timing_hour_end, timing_minute_end,
      ID, req.session.user.eduall_user_session_curentinstitute
    ];
    await ExecuteQuery(res, query, PARAMS, false, { db: "eduall_timing", type: "update", data: req });

    await RegisterAuditAction({
      session: req.session,
      action: 2,
      form: "Horários",
      description: `Atualizou o horário com ID ${ID} para ${timing_hour_start}:${timing_minute_start} às ${timing_hour_end}:${timing_minute_end}`,
    });

    res.status(200).json({ success: true, msg: "Horário atualizado com sucesso." });
  } catch (err) {
    res.status(400).json({ status: 300, success: false, msg: err.message });
  }
};

 
const TimingDelete = async (req, res) => {
   try {
      const { ID } = req.params;

      const checkQuery = `SELECT COUNT(*) AS total FROM eduall_teacher_timings 
         WHERE ed_tch_timing_code = ? AND ed_tch_timing_deleted = 0 AND ed_tch_timing_institute_code = ?`;

      const checkParams = [ID, req.session.user.eduall_user_session_curentinstitute];
      const result = await ExecuteQuery(res, checkQuery, checkParams, true, { db: "eduall_teacher_timings", type: "select", data: req });

      if (result[0].total > 0) {
         return res.status(400).json({
            success: false,
            msg: "Este horário não pode ser removido porque está atribuído a um ou mais professores.",
         });
      }

      const deleteQuery = `UPDATE eduall_timing SET ed_timing_deleted = 1
         WHERE ed_timing_deleted = 0 AND ed_timing_id = ? AND ed_timing_institute_code = ?`;

      const deleteParams = [ID, req.session.user.eduall_user_session_curentinstitute];
      await ExecuteQuery(res, deleteQuery, deleteParams, false, { db: "eduall_timing", type: "update", data: req });

      await RegisterAuditAction({
         session: req.session,
         action: 3, // Eliminação
         form: "Horários",
         description: `Eliminou o horário com ID ${ID}`
      });

      res.status(200).json({ success: true, msg: "Horário removido com sucesso." });

   } catch (err) {
      res.status(400).json({ success: false, msg: err.message });
   }
};


 

const RegisterTeacherTimingBulk = async (req, res) => {
  try {
    const institute = req.session.user.eduall_user_session_curentinstitute;
    const items = Array.isArray(req.body.items) ? req.body.items : [];

    if (!items.length) {
      return res.status(400).json({ success: false, msg: "Envie items com pelo menos 1 horário." });
    }

    let inserted = 0;
    const failed = [];

    for (const it of items) {
      const teacher = it.teacher_timing_teacher_code;
      const classId = it.teacher_timing_class;
      const subjectId = it.teacher_timing_subject;
      const timingCode = it.teacher_timing_code;
      const weekday = it.teacher_timing_weekday;

      if (
        teacher === undefined || classId === undefined || subjectId === undefined ||
        timingCode === undefined || weekday === undefined
      ) {
        failed.push({ item: it, error: "Campos obrigatórios em falta *" });
        continue;
      }

      // 1) professor tem disciplina atribuída na turma?
      const subjectCheckQuery = `
        SELECT ed_tch_subject_id FROM eduall_teacher_subjects
        WHERE ed_tch_subject_class = ?
          AND ed_tch_subject_teacher_code = ?
          AND ed_tch_subject_code = ?
          AND ed_tch_subject_institute_code = ?
          AND ed_tch_subject_deleted = 0
        LIMIT 1
      `;
      const subjectExists = await ExecuteQuery(res, subjectCheckQuery, [classId, teacher, subjectId, institute], true, {
        db: "eduall_teacher_subjects", type: "select", data: req
      });

      if (!subjectExists.length) {
        failed.push({ item: it, error: "O professor não tem esta disciplina atribuída para a turma selecionada." });
        continue;
      }

      // 2) já existe igual para o mesmo professor?
      const checkQuery = `
        SELECT ed_tch_timing_id FROM eduall_teacher_timings
        WHERE ed_tch_timing_code = ?
          AND ed_tch_timing_weekday = ?
          AND ed_tch_timing_class = ?
          AND ed_tch_timing_subject = ?
          AND ed_tch_timing_teacher_code = ?
          AND ed_tch_timing_institute_code = ?
          AND ed_tch_timing_deleted = 0
        LIMIT 1
      `;
      const existing = await ExecuteQuery(res, checkQuery, [timingCode, weekday, classId, subjectId, teacher, institute], true, {
        db: "eduall_teacher_timings", type: "select", data: req
      });

      if (existing.length) {
        failed.push({ item: it, error: "Já existe um horário com esta combinação para este professor." });
        continue;
      }

      // 3) conflito com outro professor (mesma turma+disciplina+dia+horário)
      const conflictQuery = `
        SELECT ed_tch_timing_id FROM eduall_teacher_timings
        WHERE ed_tch_timing_code = ?
          AND ed_tch_timing_weekday = ?
          AND ed_tch_timing_class = ?
          AND ed_tch_timing_subject = ?
          AND ed_tch_timing_teacher_code != ?
          AND ed_tch_timing_institute_code = ?
          AND ed_tch_timing_deleted = 0
        LIMIT 1
      `;
      const conflict = await ExecuteQuery(res, conflictQuery, [timingCode, weekday, classId, subjectId, teacher, institute], true, {
        db: "eduall_teacher_timings", type: "select", data: req
      });

      if (conflict.length) {
        failed.push({ item: it, error: "Este horário já foi atribuído a outro professor para esta disciplina e turma." });
        continue;
      }

      // Insert
      const insertQuery = `
        INSERT INTO eduall_teacher_timings(
          ed_tch_timing_code, ed_tch_timing_weekday, ed_tch_timing_class, ed_tch_timing_subject,
          ed_tch_timing_teacher_code, ed_tch_timing_institute_code
        ) VALUES (?,?,?,?,?,?)
      `;
      await ExecuteQuery(res, insertQuery, [timingCode, weekday, classId, subjectId, teacher, institute], false, {
        db: "eduall_teacher_timings", type: "insert", data: req
      });

      inserted++;
    }

    if (inserted > 0) {
      await RegisterAuditAction({
        session: req.session,
        action: 1,
        form: "Horários dos Professores (Lote)",
        description: `Atribuiu ${inserted} horário(s) em lote.`,
      });
    }

    return res.status(200).json({
      success: true,
      inserted,
      failed: failed.length,
      details: { failed },
    });
  } catch (err) {
    console.log("TIMING ERRROR : ", err)
    return res.status(400).json({ success: false, msg: err.message });
  }
};

 
 
module.exports = { GetTimings, RegisterTeacherTimingBulk, GetSingleTiming, RegisterTiming, TimingDelete, TimingUpdate };
