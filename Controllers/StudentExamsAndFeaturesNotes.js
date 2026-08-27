const ExecuteQuery = require("../Functions/ExecuteQuery");
const { RegisterAuditAction } = require("./Auditory");
const { CheckExamPermission, CheckSpecialExamPermission } = require("./NotesRestrictions");


/**
 * Valida os campos obrigatórios de um item de nota e devolve uma lista
 * de mensagens específicas (uma por campo em falta), em vez de uma
 * mensagem genérica única.
 */
const ValidateRequiredFields = (item) => {
  const missing = [];
  if (!item.student_code) missing.push("student_code");
  if (!item.class_id) missing.push("class_id");
  if (!item.subject_id) missing.push("subject_id");
  return missing;
};

/**
 * Normaliza e valida o valor da nota. Devolve { valid, value, reason }.
 */
const ParseScore = (rawScore) => {
  if (rawScore === undefined || rawScore === null || String(rawScore).trim() === "") {
    return { valid: false, empty: true, value: null, reason: "Nota vazia." };
  }
  const scoreNum = parseFloat(String(rawScore).replace(",", "."));
  if (!isFinite(scoreNum)) {
    return { valid: false, empty: false, value: null, reason: `Valor de nota inválido: "${rawScore}".` };
  }
  if (scoreNum < 0) {
    return { valid: false, empty: false, value: null, reason: `Nota negativa não permitida (${scoreNum}).` };
  }
  return { valid: true, empty: false, value: scoreNum, reason: null };
};


/**
 * POST /eduallstudentexamnotesupsertbulk/post
 * Upsert em bulk de notas de exame: insere se não existir, atualiza se existir.
 * Valida que cada turma pertence a um nível académico "classe de exame" (ed_academic_level_forExam = 1).
 * Body: { items: [{ student_code, class_id, subject_id, score }] }
 */
const BulkUpsertStudentExamNote = async (req, res) => {
  try {
    // ── 1. Sessão ────────────────────────────────────────────────
    const instituteCode = req.session?.user?.eduall_user_session_curentinstitute;
    if (!instituteCode) {
      return res.status(401).json({ success: false, msg: "Sessão inválida — sem instituto na sessão." });
    }

    // ── 2. Permissão pedagógica ──────────────────────────────────
    const { allowed } = await CheckSpecialExamPermission(req, res);
    if (!allowed) {
      return res.status(403).json({ success: false, msg: "Ação não permitida devido à restrição pedagógica!" });
    }

    // ── 3. Body / items ───────────────────────────────────────────
    if (!Array.isArray(req.body?.items)) {
      return res.status(400).json({ success: false, msg: "Formato inválido: 'items' deve ser uma lista." });
    }
    const items = req.body.items;
    if (!items.length) {
      return res.status(400).json({ success: false, msg: "Nenhum item enviado para lançamento de notas de exame." });
    }

    // ── 4. Cache de turma → { forExam, maxValue } ───────────────────
    const classInfoCache = new Map();

    const getClassInfo = async (classId) => {
      if (classInfoCache.has(classId)) return classInfoCache.get(classId);

      const classQuery = `
        SELECT al.ed_academic_level_forExam,
               al.ed_academic_level_avaliationtype_endat AS max_value
        FROM eduall_class c
        LEFT JOIN eduall_academic_level al ON al.ed_academic_level_id = c.ed_class_academic_level
        WHERE c.ed_class_id = ? AND c.ed_class_deleted = 0 AND c.ed_class_institute_code = ?
        LIMIT 1
      `;
      const result = await ExecuteQuery(res, classQuery, [classId, instituteCode], true, {
        db: "eduall_class", type: "select", data: req
      });

      const info = result && result.length > 0
        ? { found: true, forExam: result[0].ed_academic_level_forExam, maxValue: result[0].max_value || 20 }
        : { found: false, forExam: 0, maxValue: 20 };

      classInfoCache.set(classId, info);
      return info;
    };

    // ── 5. Loop de items ──────────────────────────────────────────
    const report = { inserted: 0, updated: 0, ignored_empty: 0, rejected: 0, errors: [] };

    for (let i = 0; i < items.length; i++) {
      const it = items[i] || {};
      const { student_code, class_id, subject_id, score } = it;

      const missingFields = ValidateRequiredFields(it);
      if (missingFields.length > 0) {
        report.rejected++;
        report.errors.push({
          index: i,
          reason: `Campo(s) obrigatório(s) em falta: ${missingFields.join(", ")}.`,
          item: it
        });
        continue;
      }

      const parsedScore = ParseScore(score);
      if (parsedScore.empty) {
        // nota vazia: ignorar silenciosamente, mas contabilizar para relatório
        report.ignored_empty++;
        continue;
      }
      if (!parsedScore.valid) {
        report.rejected++;
        report.errors.push({ index: i, reason: parsedScore.reason, item: it });
        continue;
      }

      let classInfo;
      try {
        classInfo = await getClassInfo(class_id);
      } catch (err) {
        report.rejected++;
        report.errors.push({ index: i, reason: `Exceção ao validar turma "${class_id}": ${err.message}`, item: it });
        continue;
      }

      if (!classInfo.found) {
        report.rejected++;
        report.errors.push({ index: i, reason: `Turma "${class_id}" não encontrada ou inválida para este instituto.`, item: it });
        continue;
      }

      if (classInfo.forExam !== 1) {
        report.rejected++;
        report.errors.push({ index: i, reason: `Turma "${class_id}" não permite lançamento de notas de exame (nível académico não configurado como classe de exame).`, item: it });
        continue;
      }

      if (parsedScore.value > classInfo.maxValue) {
        report.rejected++;
        report.errors.push({
          index: i,
          reason: `Nota ${parsedScore.value} excede o valor máximo permitido (${classInfo.maxValue}) para a turma "${class_id}".`,
          item: it
        });
        continue;
      }

      const clampedScore = Math.min(Math.max(parsedScore.value, 0), classInfo.maxValue);

      try {
        const checkQuery = `
          SELECT ed_student_exam_id FROM eduall_student_exam_notes
          WHERE ed_student_exam_studentCode    = ?
            AND ed_student_exam_class          = ?
            AND ed_student_exam_subject        = ?
            AND ed_student_exam_institute_code = ?
            AND ed_student_exam_deleted        = 0
          LIMIT 1
        `;
        const existing = await ExecuteQuery(res, checkQuery,
          [student_code, class_id, subject_id, instituteCode], true);

        if (existing && existing.length > 0) {
          const existingId = existing[0].ed_student_exam_id;
          const updateQuery = `
            UPDATE eduall_student_exam_notes
            SET ed_student_exam_score = ?
            WHERE ed_student_exam_id  = ?
          `;
          await ExecuteQuery(res, updateQuery, [clampedScore, existingId], false, {
            db: "eduall_student_exam_notes", type: "update", data: req
          });
          report.updated++;
        } else {
          const insertQuery = `
            INSERT INTO eduall_student_exam_notes (
              ed_student_exam_studentCode,
              ed_student_exam_class,
              ed_student_exam_subject,
              ed_student_exam_score,
              ed_student_exam_institute_code
            ) VALUES (?, ?, ?, ?, ?)
          `;
          await ExecuteQuery(res, insertQuery,
            [student_code, class_id, subject_id, clampedScore, instituteCode], false, {
              db: "eduall_student_exam_notes", type: "insert", data: req
            });
          report.inserted++;
        }
      } catch (dbErr) {
        report.rejected++;
        report.errors.push({ index: i, reason: `Falha ao inserir/atualizar nota: ${dbErr.message || "erro desconhecido."}`, item: it });
      }
    }

    // ── 6. Auditoria ─────────────────────────────────────────────
    try {
      await RegisterAuditAction({
        session: req.session,
        action: 1,
        form: "Notas de Exame (Upsert Bulk)",
        description: `Upsert bulk: ${report.inserted} inseridas, ${report.updated} atualizadas, ${report.ignored_empty} ignoradas (vazias), ${report.rejected} rejeitadas.`,
      });
    } catch (_) {
      // não crítico
    }

    // ── 7. Resposta ──────────────────────────────────────────────
    const totalProcessed = report.inserted + report.updated;

    if (report.rejected > 0 && totalProcessed === 0) {
      return res.status(422).json({
        success: false,
        msg: `Nenhuma nota de exame pôde ser lançada. ${report.rejected} item(ns) rejeitado(s).`,
        report
      });
    }

    if (report.rejected > 0) {
      return res.status(207).json({
        success: true,
        msg: `${totalProcessed} nota(s) de exame lançada(s) com sucesso (${report.inserted} inseridas, ${report.updated} atualizadas). ${report.rejected} rejeitada(s) e ${report.ignored_empty} ignorada(s) por estarem vazias.`,
        report
      });
    }

    return res.status(200).json({
      success: true,
      msg: `${report.inserted} nota(s) de exame inserida(s) e ${report.updated} atualizada(s) com sucesso.${report.ignored_empty ? ` ${report.ignored_empty} ignorada(s) por estarem vazias.` : ""}`,
      report
    });

  } catch (error) {
    return res.status(500).json({ success: false, msg: "Erro interno ao processar notas de exame.", error: error.message });
  }
};


/**
 * POST /eduallstudentfeaturednotesupsertbulk/post
 * Upsert em bulk de notas de recurso: insere se não existir, atualiza se existir.
 * Valida que cada turma pertence a um nível académico "classe de recurso" (ed_academic_level_forFt = 1).
 * Body: { items: [{ student_code, class_id, subject_id, score }] }
 */
const BulkUpsertStudentFeaturedNote = async (req, res) => {
  try {
    // ── 1. Sessão ────────────────────────────────────────────────
    const instituteCode = req.session?.user?.eduall_user_session_curentinstitute;
    if (!instituteCode) {
      return res.status(401).json({ success: false, msg: "Sessão inválida — sem instituto na sessão." });
    }

    // ── 2. Permissão pedagógica ──────────────────────────────────
    const { allowed } = await CheckSpecialExamPermission(req, res);
    if (!allowed) {
      return res.status(403).json({ success: false, msg: "Ação não permitida devido à restrição pedagógica!" });
    }

    // ── 3. Body / items ───────────────────────────────────────────
    if (!Array.isArray(req.body?.items)) {
      return res.status(400).json({ success: false, msg: "Formato inválido: 'items' deve ser uma lista." });
    }
    const items = req.body.items;
    if (!items.length) {
      return res.status(400).json({ success: false, msg: "Nenhum item enviado para lançamento de notas de recurso." });
    }

    // ── 4. Cache de turma → { forFt, maxValue } ─────────────────────
    const classInfoCache = new Map();

    const getClassInfo = async (classId) => {
      if (classInfoCache.has(classId)) return classInfoCache.get(classId);

      const classQuery = `
        SELECT al.ed_academic_level_forFt,
               al.ed_academic_level_avaliationtype_endat AS max_value
        FROM eduall_class c
        LEFT JOIN eduall_academic_level al ON al.ed_academic_level_id = c.ed_class_academic_level
        WHERE c.ed_class_id = ? AND c.ed_class_deleted = 0 AND c.ed_class_institute_code = ?
        LIMIT 1
      `;
      const result = await ExecuteQuery(res, classQuery, [classId, instituteCode], true, {
        db: "eduall_class", type: "select", data: req
      });

      const info = result && result.length > 0
        ? { found: true, forFt: result[0].ed_academic_level_forFt, maxValue: result[0].max_value || 20 }
        : { found: false, forFt: 0, maxValue: 20 };

      classInfoCache.set(classId, info);
      return info;
    };

    // ── 5. Loop de items ──────────────────────────────────────────
    const report = { inserted: 0, updated: 0, ignored_empty: 0, rejected: 0, errors: [] };

    for (let i = 0; i < items.length; i++) {
      const it = items[i] || {};
      const { student_code, class_id, subject_id, score } = it;

      const missingFields = ValidateRequiredFields(it);
      if (missingFields.length > 0) {
        report.rejected++;
        report.errors.push({
          index: i,
          reason: `Campo(s) obrigatório(s) em falta: ${missingFields.join(", ")}.`,
          item: it
        });
        continue;
      }

      const parsedScore = ParseScore(score);
      if (parsedScore.empty) {
        report.ignored_empty++;
        continue;
      }
      if (!parsedScore.valid) {
        report.rejected++;
        report.errors.push({ index: i, reason: parsedScore.reason, item: it });
        continue;
      }

      let classInfo;
      try {
        classInfo = await getClassInfo(class_id);
      } catch (err) {
        report.rejected++;
        report.errors.push({ index: i, reason: `Exceção ao validar turma "${class_id}": ${err.message}`, item: it });
        continue;
      }

      if (!classInfo.found) {
        report.rejected++;
        report.errors.push({ index: i, reason: `Turma "${class_id}" não encontrada ou inválida para este instituto.`, item: it });
        continue;
      }

      if (classInfo.forFt !== 1) {
        report.rejected++;
        report.errors.push({ index: i, reason: `Turma "${class_id}" não permite lançamento de notas de recurso (nível académico não configurado como classe de recurso).`, item: it });
        continue;
      }

      if (parsedScore.value > classInfo.maxValue) {
        report.rejected++;
        report.errors.push({
          index: i,
          reason: `Nota ${parsedScore.value} excede o valor máximo permitido (${classInfo.maxValue}) para a turma "${class_id}".`,
          item: it
        });
        continue;
      }

      const clampedScore = Math.min(Math.max(parsedScore.value, 0), classInfo.maxValue);

      try {
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
          report.updated++;
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
          report.inserted++;
        }
      } catch (dbErr) {
        report.rejected++;
        report.errors.push({ index: i, reason: `Falha ao inserir/atualizar nota: ${dbErr.message || "erro desconhecido."}`, item: it });
      }
    }

    // ── 6. Auditoria ─────────────────────────────────────────────
    try {
      await RegisterAuditAction({
        session: req.session,
        action: 1,
        form: "Notas de Recurso (Upsert Bulk)",
        description: `Upsert bulk: ${report.inserted} inseridas, ${report.updated} atualizadas, ${report.ignored_empty} ignoradas (vazias), ${report.rejected} rejeitadas.`,
      });
    } catch (_) {
      // não crítico
    }

    // ── 7. Resposta ──────────────────────────────────────────────
    const totalProcessed = report.inserted + report.updated;

    if (report.rejected > 0 && totalProcessed === 0) {
      return res.status(422).json({
        success: false,
        msg: `Nenhuma nota de recurso pôde ser lançada. ${report.rejected} item(ns) rejeitado(s).`,
        report
      });
    }

    if (report.rejected > 0) {
      return res.status(207).json({
        success: true,
        msg: `${totalProcessed} nota(s) de recurso lançada(s) com sucesso (${report.inserted} inseridas, ${report.updated} atualizadas). ${report.rejected} rejeitada(s) e ${report.ignored_empty} ignorada(s) por estarem vazias.`,
        report
      });
    }

    return res.status(200).json({
      success: true,
      msg: `${report.inserted} nota(s) de recurso inserida(s) e ${report.updated} atualizada(s) com sucesso.${report.ignored_empty ? ` ${report.ignored_empty} ignorada(s) por estarem vazias.` : ""}`,
      report
    });

  } catch (error) {
    return res.status(500).json({ success: false, msg: "Erro interno ao processar notas de recurso.", error: error.message });
  }
};


/**
 * GET /eduallgetallnotesbyclasssubject/:CLASS,:SUBJECT
 * Devolve TODOS os alunos ligados à turma — os que estão atualmente
 * matriculados nela E os que já fizeram parte dela mas entretanto
 * mudaram de turma (histórico em "eduall_student_old_classes") —
 * com nota de exame E nota de recurso lado a lado, mais o
 * "forExam"/"forFt" da turma para o frontend saber que colunas mostrar.
 *
 * Isto garante que, se um aluno for movido para outra turma depois de já
 * ter notas lançadas nesta, ele continua visível aqui e as notas continuam
 * editáveis — em vez de "desaparecer" da turma onde a nota foi lançada.
 *
 * Cada aluno devolvido inclui "enrollment_type": "current" (está na turma
 * agora) ou "historical" (já não está, mas fez parte dela).
 *
 * NOTA: o JOIN com "eduall_student_class_enrollment" foi removido porque essa
 * tabela não existe na base de dados; a turma atual de cada aluno vem da
 * coluna "eduall_students.ed_student_class" e o histórico de
 * "eduall_student_old_classes" (mesmo padrão usado em GetStudentsByClass).
 */
const GetAllNotesByClassSubject = async (req, res) => {
  try {
    const { CLASS, SUBJECT } = req.params;

    if (!CLASS || !SUBJECT) {
      return res.status(400).json({
        success: false,
        msg: `Parâmetro(s) em falta: ${!CLASS ? "CLASS " : ""}${!SUBJECT ? "SUBJECT" : ""}`.trim()
      });
    }

    const instituteCode = req.session?.user?.eduall_user_session_curentinstitute;
    if (!instituteCode) {
      return res.status(401).json({ success: false, msg: "Sessão inválida — sem instituto na sessão." });
    }

    // Info da turma: se permite exame / recurso, e valor máximo
    const classInfoQuery = `
      SELECT al.ed_academic_level_forExam,
             al.ed_academic_level_forFt,
             al.ed_academic_level_avaliationtype_endat AS max_value,
             c.ed_class_title
      FROM eduall_class c
      LEFT JOIN eduall_academic_level al ON al.ed_academic_level_id = c.ed_class_academic_level
      WHERE c.ed_class_id = ? AND c.ed_class_deleted = 0 AND c.ed_class_institute_code = ?
      LIMIT 1
    `;
    const classInfo = await ExecuteQuery(res, classInfoQuery, [CLASS, instituteCode], true, {
      db: "eduall_class", type: "select", data: req
    });

    if (!classInfo || classInfo.length === 0) {
      return res.status(404).json({ success: false, msg: `Turma "${CLASS}" não encontrada ou não pertence a este instituto.` });
    }

    // Confirma que a disciplina existe (mensagem mais dinâmica em caso de falha adiante,
    // mas evita rebentar a query principal com um SUBJECT inexistente sem aviso).
    const subjectCheckQuery = `
      SELECT ed_subject_id FROM eduall_subjects
      WHERE ed_subject_id = ? AND ed_subject_deleted = 0 AND ed_subject_institute_code = ?
      LIMIT 1
    `;
    let subjectExists = true;
    try {
      const subjectResult = await ExecuteQuery(res, subjectCheckQuery, [SUBJECT, instituteCode], true, {
        db: "eduall_subjects", type: "select", data: req
      });
      subjectExists = !!(subjectResult && subjectResult.length > 0);
    } catch (_) {
      // Se a tabela de disciplinas tiver outro nome/estrutura, não bloqueia o fluxo principal.
      subjectExists = true;
    }

    if (!subjectExists) {
      return res.status(404).json({ success: false, msg: `Disciplina "${SUBJECT}" não encontrada ou não pertence a este instituto.` });
    }

    // Bloco de SELECT + JOINs de notas, reutilizado tanto para alunos
    // atuais como para os históricos (mesmos critérios de nota em ambos).
    const NOTES_SELECT = `
      SELECT
        s.ed_student_id,
        s.ed_student_name,
        s.ed_student_code,
        s.ed_student_picture,
        s.ed_student_class AS current_class,
        esn.ed_student_exam_id,
        esn.ed_student_exam_score,
        sfn.ed_student_featured_note_id,
        sfn.ed_student_featured_note_score
    `;

    const NOTES_JOINS = `
      FROM eduall_students s
      LEFT JOIN eduall_student_exam_notes esn
             ON esn.ed_student_exam_studentCode  = s.ed_student_id
            AND esn.ed_student_exam_class        = ?
            AND esn.ed_student_exam_subject      = ?
            AND esn.ed_student_exam_deleted      = 0
            AND esn.ed_student_exam_institute_code = ?
      LEFT JOIN eduall_student_featured_notes sfn
             ON sfn.ed_student_featured_note_studentCode  = s.ed_student_id
            AND sfn.ed_student_featured_note_class        = ?
            AND sfn.ed_student_featured_note_subject      = ?
            AND sfn.ed_student_featured_note_deleted      = 0
            AND sfn.ed_student_featured_note_institute_code = ?
    `;

    // ── 1) Alunos ATUAIS da turma ───────────────────────────────
    const currentQuery = `
      ${NOTES_SELECT}, 'current' AS enrollment_type
      ${NOTES_JOINS}
      WHERE s.ed_student_deleted        = 0
        AND s.ed_student_institute_code = ?
        AND s.ed_student_class          = ?
      ORDER BY s.ed_student_name ASC
    `;
    const currentStudents = await ExecuteQuery(
      res, currentQuery,
      [CLASS, SUBJECT, instituteCode, CLASS, SUBJECT, instituteCode, instituteCode, CLASS],
      true,
      { db: "eduall_students", type: "select", data: req }
    );

    // ── 2) Alunos ANTIGOS da turma (já mudaram, mas fizeram parte dela) ──
    const oldStudentIdQuery = `
      SELECT DISTINCT ed_student_old_class_student AS ed_student_id
      FROM eduall_student_old_classes
      WHERE ed_student_old_class = ?
    `;
    const oldStudentIds = await ExecuteQuery(res, oldStudentIdQuery, [CLASS], true, {
      db: "eduall_students", type: "select", data: req
    });

    const oldIds = oldStudentIds ? oldStudentIds.map(o => Number(o.ed_student_id)) : [];
    const currentIds = (currentStudents || []).map(s => Number(s.ed_student_id));
    const oldOnlyIds = oldIds.filter(id => !currentIds.includes(id));

    let historicalStudents = [];
    if (oldOnlyIds.length > 0) {
      const ph = oldOnlyIds.map(() => "?").join(",");
      const historicalQuery = `
        ${NOTES_SELECT}, 'historical' AS enrollment_type
        ${NOTES_JOINS}
        WHERE s.ed_student_deleted        = 0
          AND s.ed_student_institute_code = ?
          AND s.ed_student_id            IN (${ph})
        ORDER BY s.ed_student_name ASC
      `;
      historicalStudents = await ExecuteQuery(
        res, historicalQuery,
        [CLASS, SUBJECT, instituteCode, CLASS, SUBJECT, instituteCode, instituteCode, ...oldOnlyIds],
        true,
        { db: "eduall_students", type: "select", data: req }
      );
    }

    // ── 3) Combinar TODOS os alunos e ordenar alfabeticamente ────
    // (em vez de agrupar "atuais" primeiro e "antigos" depois, ordena
    // tudo junto por nome, para uma lista única A-Z)
    const sortByName = (arr) => arr.sort((a, b) =>
      (a.ed_student_name || "").localeCompare(b.ed_student_name || "", "pt")
    );

    const allStudents = sortByName([...(currentStudents || []), ...(historicalStudents || [])]);

    if (allStudents.length === 0) {
      return res.status(200).json({
        success: true,
        msg: `Nenhum aluno (atual ou antigo) encontrado para a turma "${classInfo[0].ed_class_title}".`,
        class_name: classInfo[0].ed_class_title,
        allows_exam: classInfo[0].ed_academic_level_forExam === 1,
        allows_recurso: classInfo[0].ed_academic_level_forFt === 1,
        max_value: classInfo[0].max_value || 20,
        students: []
      });
    }

    return res.status(200).json({
      success: true,
      msg: `${allStudents.length} aluno(s) encontrado(s) para a turma "${classInfo[0].ed_class_title}" (${currentStudents.length} atual(is), ${historicalStudents.length} antigo(s)).`,
      class_name: classInfo[0].ed_class_title,
      allows_exam: classInfo[0].ed_academic_level_forExam === 1,
      allows_recurso: classInfo[0].ed_academic_level_forFt === 1,
      max_value: classInfo[0].max_value || 20,
      total_current: currentStudents.length,
      total_historical: historicalStudents.length,
      students: allStudents
    });

  } catch (error) {
    return res.status(500).json({ success: false, msg: "Erro interno ao obter notas da turma.", error: error.message });
  }
};


module.exports = {
  BulkUpsertStudentExamNote,
  BulkUpsertStudentFeaturedNote,
  GetAllNotesByClassSubject
};