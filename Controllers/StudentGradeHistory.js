/**
 * StudentGradeHistoryController.js — EduAll Backend
 * Histórico de notas do aluno (escola atual + escola anterior)
 *
 * Tabelas:
 *   eduall_student_grade_history        — registo principal por aluno
 *   eduall_student_grade_history_records — grupos (por classe / escola)
 *   eduall_student_grade_history_subjects — disciplinas + notas por grupo
 *
 * Endpoints (registar no router):
 *   GET    /eduall-grade-history/get/:STUDENT_ID   → GetGradeHistory
 *   POST   /eduall-grade-history/post               → CreateGradeHistory
 *   PUT    /eduall-grade-history/update/:ID         → UpdateGradeHistory
 *   DELETE /eduall-grade-history/delete/:ID         → DeleteGradeHistory
 *
 * SQL de criação das tabelas:
 * ─────────────────────────────────────────────────────────────────
 * CREATE TABLE IF NOT EXISTS eduall_student_grade_history (
 *   ed_gh_id              INT AUTO_INCREMENT PRIMARY KEY,
 *   ed_gh_student_id      INT NOT NULL,
 *   ed_gh_institute_code  VARCHAR(64) NOT NULL,
 *   ed_gh_deleted         TINYINT DEFAULT 0,
 *   ed_gh_created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
 *   ed_gh_updated_at      DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
 *   UNIQUE KEY uq_student (ed_gh_student_id, ed_gh_institute_code)
 * );
 *
 * CREATE TABLE IF NOT EXISTS eduall_student_grade_history_records (
 *   ed_ghr_id              INT AUTO_INCREMENT PRIMARY KEY,
 *   ed_ghr_history_id      INT NOT NULL,
 *   ed_ghr_class_id        INT DEFAULT NULL,
 *   ed_ghr_academic_level_id INT DEFAULT NULL,   -- Nível académico (classe) a que este grupo de notas se refere.
 *                                                 -- Obrigatório também para grupos de "escola anterior", para que
 *                                                 -- o sistema saiba para que classe estas notas já foram lançadas
 *                                                 -- e não volte a pedir/lançar notas para essa mesma classe.
 *   ed_ghr_class_name      VARCHAR(255) NOT NULL,
 *   ed_ghr_is_previous     TINYINT DEFAULT 0,
 *   ed_ghr_school_name     VARCHAR(255) DEFAULT NULL,
 *   ed_ghr_scale           VARCHAR(8) DEFAULT '0-10',
 *   ed_ghr_active_trims    JSON DEFAULT NULL,
 *   ed_ghr_deleted         TINYINT DEFAULT 0,
 *   ed_ghr_created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
 *   FOREIGN KEY (ed_ghr_history_id) REFERENCES eduall_student_grade_history(ed_gh_id) ON DELETE CASCADE
 * );
 *
 * -- Caso a tabela já exista (instalações antigas), adicionar a coluna nova com:
 * -- ALTER TABLE eduall_student_grade_history_records
 * --   ADD COLUMN ed_ghr_academic_level_id INT DEFAULT NULL AFTER ed_ghr_class_id;
 *
 * CREATE TABLE IF NOT EXISTS eduall_student_grade_history_subjects (
 *   ed_ghs_id           INT AUTO_INCREMENT PRIMARY KEY,
 *   ed_ghs_record_id    INT NOT NULL,
 *   ed_ghs_subject_id   INT DEFAULT NULL,
 *   ed_ghs_subject_title VARCHAR(255) NOT NULL,
 *   ed_ghs_mac_1        DECIMAL(5,2) DEFAULT NULL,
 *   ed_ghs_npt_1        DECIMAL(5,2) DEFAULT NULL,
 *   ed_ghs_mt_1         DECIMAL(5,2) DEFAULT NULL,
 *   ed_ghs_mac_2        DECIMAL(5,2) DEFAULT NULL,
 *   ed_ghs_npt_2        DECIMAL(5,2) DEFAULT NULL,
 *   ed_ghs_mt_2         DECIMAL(5,2) DEFAULT NULL,
 *   ed_ghs_mac_3        DECIMAL(5,2) DEFAULT NULL,
 *   ed_ghs_npt_3        DECIMAL(5,2) DEFAULT NULL,
 *   ed_ghs_mt_3         DECIMAL(5,2) DEFAULT NULL,
 *   ed_ghs_mdf          DECIMAL(5,2) DEFAULT NULL,
 *   ed_ghs_deleted      TINYINT DEFAULT 0,
 *   FOREIGN KEY (ed_ghs_record_id) REFERENCES eduall_student_grade_history_records(ed_ghr_id) ON DELETE CASCADE
 * );
 *
 * NOTA IMPORTANTE — MT e MDF:
 *   Os campos ed_ghs_mt_1/2/3 e ed_ghs_mdf são SEMPRE calculados no frontend
 *   (MT = média de MAC + NPT; MDF = média dos MT activos) e gravados apenas
 *   como resultado desse cálculo. O backend não recalcula nem valida estes
 *   valores; apenas persiste o que o frontend envia, mas o frontend nunca
 *   permite a edição manual directa de MT/MDF (são sempre campos só-leitura).
 */

const ExecuteQuery      = require("../Functions/ExecuteQuery");
const { RegisterAuditAction } = require("./Auditory");

/* ── helpers ──────────────────────────────────────────────────── */
const inst  = (req) => req.session.user.eduall_user_session_curentinstitute;
const uid   = (req) => req.session.user.eduall_user_session_id;
const safeN = (v)   => { const n = parseFloat(v); return (isNaN(n) || v === "" || v === null || v === undefined) ? null : n; };
const safeI = (v)   => { const n = parseInt(v, 10); return (isNaN(n) || v === "" || v === null || v === undefined) ? null : n; };

/* ─────────────────────────────────────────────────────────────────
   GET — buscar histórico de um aluno
   GET /eduall-grade-history/get/:STUDENT_ID
───────────────────────────────────────────────────────────────── */
const GetGradeHistory = async (req, res) => {
  try {
    const { STUDENT_ID } = req.params;
    const instituteCode  = inst(req);

    /* 1. Header */
    const headers = await ExecuteQuery(res,
      `SELECT ed_gh_id, ed_gh_student_id, ed_gh_updated_at
       FROM eduall_student_grade_history
       WHERE ed_gh_student_id    = ?
         AND ed_gh_institute_code = ?
         AND ed_gh_deleted        = 0
       LIMIT 1`,
      [STUDENT_ID, instituteCode], true
    );

    if (!headers.length) {
      return res.status(200).json({ success: true, history_id: null, records: [] });
    }

    const historyId = headers[0].ed_gh_id;

    /* 2. Records (grupos por classe) */
    const dbRecords = await ExecuteQuery(res,
      `SELECT * FROM eduall_student_grade_history_records
       WHERE ed_ghr_history_id = ? AND ed_ghr_deleted = 0
       ORDER BY ed_ghr_id ASC`,
      [historyId], true
    );

    if (!dbRecords.length) {
      return res.status(200).json({ success: true, history_id: historyId, records: [] });
    }

    /* 3. Subjects + grades for all records */
    const recordIds  = dbRecords.map(r => r.ed_ghr_id);
    const placeholders = recordIds.map(() => "?").join(", ");
    const dbSubjects = await ExecuteQuery(res,
      `SELECT * FROM eduall_student_grade_history_subjects
       WHERE ed_ghs_record_id IN (${placeholders}) AND ed_ghs_deleted = 0
       ORDER BY ed_ghs_id ASC`,
      recordIds, true
    );

    /* 4. Assemble */
    const records = dbRecords.map(rec => {
      const subjects = dbSubjects
        .filter(s => s.ed_ghs_record_id === rec.ed_ghr_id)
        .map(s => ({
          subject_id:    s.ed_ghs_subject_id,
          subject_title: s.ed_ghs_subject_title,
          grades: {
            mac_1: s.ed_ghs_mac_1 !== null ? String(s.ed_ghs_mac_1) : "",
            npt_1: s.ed_ghs_npt_1 !== null ? String(s.ed_ghs_npt_1) : "",
            mt_1:  s.ed_ghs_mt_1  !== null ? String(s.ed_ghs_mt_1)  : "",
            mac_2: s.ed_ghs_mac_2 !== null ? String(s.ed_ghs_mac_2) : "",
            npt_2: s.ed_ghs_npt_2 !== null ? String(s.ed_ghs_npt_2) : "",
            mt_2:  s.ed_ghs_mt_2  !== null ? String(s.ed_ghs_mt_2)  : "",
            mac_3: s.ed_ghs_mac_3 !== null ? String(s.ed_ghs_mac_3) : "",
            npt_3: s.ed_ghs_npt_3 !== null ? String(s.ed_ghs_npt_3) : "",
            mt_3:  s.ed_ghs_mt_3  !== null ? String(s.ed_ghs_mt_3)  : "",
            mdf:   s.ed_ghs_mdf   !== null ? String(s.ed_ghs_mdf)   : "",
          },
        }));

      let activeTrims = [1, 2, 3];
      try { if (rec.ed_ghr_active_trims) activeTrims = JSON.parse(rec.ed_ghr_active_trims); } catch {}

      return {
        record_id:         rec.ed_ghr_id,
        class_id:          rec.ed_ghr_class_id,
        academic_level_id: rec.ed_ghr_academic_level_id,
        class_name:        rec.ed_ghr_class_name,
        is_previous:       !!rec.ed_ghr_is_previous,
        school_name:       rec.ed_ghr_school_name || "",
        scale:             rec.ed_ghr_scale || "0-10",
        active_trims:      activeTrims,
        subjects,
      };
    });

    return res.status(200).json({ success: true, history_id: historyId, records });

  } catch (err) {
    console.error("GetGradeHistory error:", err);
    return res.status(500).json({ success: false, msg: err.message });
  }
};

/* ─────────────────────────────────────────────────────────────────
   CREATE — POST /eduall-grade-history/post
   Body: { student_id, records: [ { class_id, academic_level_id,
           class_name, is_previous, school_name, scale, active_trims,
           subjects: [{ subject_id, subject_title, grades }] } ] }
───────────────────────────────────────────────────────────────── */
const CreateGradeHistory = async (req, res) => {
  console.log("hellow !!")
  try {
    const { student_id, records = [] } = req.body;
    const instituteCode = inst(req);

    if (!student_id) {
      return res.status(400).json({ success: false, msg: "student_id é obrigatório." });
    }

    /* Validar: todos os grupos têm de indicar o nível académico (classe) a que se referem */
    const missingLevel = records.find(r => !r.academic_level_id);
    if (missingLevel) {
      return res.status(400).json({
        success: false,
        msg: `O grupo "${missingLevel.class_name || missingLevel.school_name || "—"}" não tem nível académico (classe) seleccionado.`,
      });
    }

    /* Verificar se já existe */
    const existing = await ExecuteQuery(res,
      `SELECT ed_gh_id FROM eduall_student_grade_history
       WHERE ed_gh_student_id = ? AND ed_gh_institute_code = ? AND ed_gh_deleted = 0 LIMIT 1`,
      [student_id, instituteCode], true
    );

    if (existing.length) {
      return res.status(409).json({
        success:    false,
        msg:        "Já existe um histórico para este aluno. Use o endpoint de actualização.",
        history_id: existing[0].ed_gh_id,
      });
    }

    /* Header */
    const headerResult = await ExecuteQuery(res,
      `INSERT INTO eduall_student_grade_history (ed_gh_student_id, ed_gh_institute_code)
       VALUES (?, ?)`,
      [student_id, instituteCode], false,
      { db: "eduall_student_grade_history", type: "insert", data: req }
    );
    const historyId = headerResult.insertId;

    /* Records + subjects */
    await _upsertRecords(res, req, historyId, records);

    await RegisterAuditAction({
      session:     req.session,
      action:      1,
      form:        "Histórico de Notas",
      description: `Criou histórico de notas para o aluno #${student_id} (${records.length} grupo${records.length !== 1 ? "s" : ""})`,
    });

    return res.status(201).json({
      success:    true,
      msg:        "Histórico de notas criado com sucesso!",
      history_id: historyId,
    });

  } catch (err) {
    console.error("CreateGradeHistory error:", err);
    return res.status(500).json({ success: false, msg: err.message });
  }
};

/* ─────────────────────────────────────────────────────────────────
   UPDATE — PUT /eduall-grade-history/update/:ID
   Mesmo body que create. Faz hard-delete dos registos antigos e
   re-insere os novos (replace strategy — mais simples e seguro
   do que diff patch com as disciplinas).
───────────────────────────────────────────────────────────────── */
const UpdateGradeHistory = async (req, res) => {
  try {
    const { ID }     = req.params;
    const { records = [] } = req.body;
    const instituteCode    = inst(req);

    /* Validar: todos os grupos têm de indicar o nível académico (classe) a que se referem */
    const missingLevel = records.find(r => !r.academic_level_id);
    if (missingLevel) {
      return res.status(400).json({
        success: false,
        msg: `O grupo "${missingLevel.class_name || missingLevel.school_name || "—"}" não tem nível académico (classe) seleccionado.`,
      });
    }

    /* Verificar que pertence a esta escola */
    const header = await ExecuteQuery(res,
      `SELECT ed_gh_id, ed_gh_student_id FROM eduall_student_grade_history
       WHERE ed_gh_id = ? AND ed_gh_institute_code = ? AND ed_gh_deleted = 0 LIMIT 1`,
      [ID, instituteCode], true
    );

    if (!header.length) {
      return res.status(404).json({ success: false, msg: "Histórico não encontrado." });
    }

    const historyId = parseInt(ID, 10);

    /* Soft-delete all existing records (cascade hits subjects) */
    const oldRecords = await ExecuteQuery(res,
      `SELECT ed_ghr_id FROM eduall_student_grade_history_records
       WHERE ed_ghr_history_id = ? AND ed_ghr_deleted = 0`,
      [historyId], true
    );

    if (oldRecords.length) {
      const ids = oldRecords.map(r => r.ed_ghr_id);
      const ph  = ids.map(() => "?").join(", ");
      await ExecuteQuery(res,
        `UPDATE eduall_student_grade_history_subjects SET ed_ghs_deleted = 1
         WHERE ed_ghs_record_id IN (${ph})`,
        ids, false
      );
      await ExecuteQuery(res,
        `UPDATE eduall_student_grade_history_records SET ed_ghr_deleted = 1
         WHERE ed_ghr_id IN (${ph})`,
        ids, false
      );
    }

    /* Re-insert */
    await _upsertRecords(res, req, historyId, records);

    /* Touch updated_at */
    await ExecuteQuery(res,
      `UPDATE eduall_student_grade_history SET ed_gh_updated_at = NOW() WHERE ed_gh_id = ?`,
      [historyId], false
    );

    await RegisterAuditAction({
      session:     req.session,
      action:      2,
      form:        "Histórico de Notas",
      description: `Actualizou histórico de notas #${historyId} (aluno #${header[0].ed_gh_student_id})`,
    });

    return res.status(200).json({ success: true, msg: "Histórico actualizado com sucesso!", history_id: historyId });

  } catch (err) {
    console.error("UpdateGradeHistory error:", err);
    return res.status(500).json({ success: false, msg: err.message });
  }
};

/* ─────────────────────────────────────────────────────────────────
   DELETE — DELETE /eduall-grade-history/delete/:ID
───────────────────────────────────────────────────────────────── */
const DeleteGradeHistory = async (req, res) => {
  try {
    const { ID }        = req.params;
    const instituteCode = inst(req);

    const header = await ExecuteQuery(res,
      `SELECT ed_gh_id, ed_gh_student_id FROM eduall_student_grade_history
       WHERE ed_gh_id = ? AND ed_gh_institute_code = ? AND ed_gh_deleted = 0 LIMIT 1`,
      [ID, instituteCode], true
    );

    if (!header.length) {
      return res.status(404).json({ success: false, msg: "Histórico não encontrado." });
    }

    /* Cascade soft-delete */
    const historyId = parseInt(ID, 10);
    const recs = await ExecuteQuery(res,
      `SELECT ed_ghr_id FROM eduall_student_grade_history_records
       WHERE ed_ghr_history_id = ? AND ed_ghr_deleted = 0`,
      [historyId], true
    );

    if (recs.length) {
      const ids = recs.map(r => r.ed_ghr_id);
      const ph  = ids.map(() => "?").join(", ");
      await ExecuteQuery(res,
        `UPDATE eduall_student_grade_history_subjects SET ed_ghs_deleted = 1 WHERE ed_ghs_record_id IN (${ph})`,
        ids, false
      );
      await ExecuteQuery(res,
        `UPDATE eduall_student_grade_history_records SET ed_ghr_deleted = 1 WHERE ed_ghr_id IN (${ph})`,
        ids, false
      );
    }

    await ExecuteQuery(res,
      `UPDATE eduall_student_grade_history SET ed_gh_deleted = 1 WHERE ed_gh_id = ?`,
      [historyId], false
    );

    await RegisterAuditAction({
      session:     req.session,
      action:      3,
      form:        "Histórico de Notas",
      description: `Removeu histórico de notas #${historyId} (aluno #${header[0].ed_gh_student_id})`,
    });

    return res.status(200).json({ success: true, msg: "Histórico removido com sucesso." });

  } catch (err) {
    console.error("DeleteGradeHistory error:", err);
    return res.status(500).json({ success: false, msg: err.message });
  }
};

/* ─────────────────────────────────────────────────────────────────
   HELPER — inserir records + subjects
───────────────────────────────────────────────────────────────── */
async function _upsertRecords(res, req, historyId, records) {
  for (const rec of records) {
    const activeTrimJson = JSON.stringify(
      Array.isArray(rec.active_trims) ? rec.active_trims : [1, 2, 3]
    );

    const recResult = await ExecuteQuery(res,
      `INSERT INTO eduall_student_grade_history_records
         (ed_ghr_history_id, ed_ghr_class_id, ed_ghr_academic_level_id, ed_ghr_class_name,
          ed_ghr_is_previous, ed_ghr_school_name, ed_ghr_scale, ed_ghr_active_trims)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        historyId,
        rec.class_id    || null,
        safeI(rec.academic_level_id),
        rec.class_name  || "",
        rec.is_previous ? 1 : 0,
        rec.school_name || null,
        rec.scale       || "0-10",
        activeTrimJson,
      ],
      false
    );
    const recordId = recResult.insertId;

    /* Subjects — MT e MDF são sempre o valor calculado/enviado pelo frontend
       (lá nunca são editáveis manualmente; são derivados de MAC/NPT) */
    for (const subj of (rec.subjects || [])) {
      const g = subj.grades || {};
      await ExecuteQuery(res,
        `INSERT INTO eduall_student_grade_history_subjects
           (ed_ghs_record_id, ed_ghs_subject_id, ed_ghs_subject_title,
            ed_ghs_mac_1, ed_ghs_npt_1, ed_ghs_mt_1,
            ed_ghs_mac_2, ed_ghs_npt_2, ed_ghs_mt_2,
            ed_ghs_mac_3, ed_ghs_npt_3, ed_ghs_mt_3,
            ed_ghs_mdf)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [
          recordId,
          subj.subject_id    || null,
          subj.subject_title || "",
          safeN(g.mac_1), safeN(g.npt_1), safeN(g.mt_1),
          safeN(g.mac_2), safeN(g.npt_2), safeN(g.mt_2),
          safeN(g.mac_3), safeN(g.npt_3), safeN(g.mt_3),
          safeN(g.mdf),
        ],
        false
      );
    }
  }
}

/* ─────────────────────────────────────────────────────────────────
   ROUTER REGISTRATION (adicionar ao ficheiro de rotas principal)
   ─────────────────────────────────────────────────────────────────
   const {
     GetGradeHistory, CreateGradeHistory,
     UpdateGradeHistory, DeleteGradeHistory,
   } = require("./controllers/StudentGradeHistoryController");

   router.get   ("/eduall-grade-history/get/:STUDENT_ID", auth, GetGradeHistory);
   router.post  ("/eduall-grade-history/post",             auth, CreateGradeHistory);
   router.put   ("/eduall-grade-history/update/:ID",       auth, UpdateGradeHistory);
   router.delete("/eduall-grade-history/delete/:ID",       auth, DeleteGradeHistory);
───────────────────────────────────────────────────────────────── */

module.exports = {
  GetGradeHistory, 
  CreateGradeHistory,
  UpdateGradeHistory,
  DeleteGradeHistory,
};