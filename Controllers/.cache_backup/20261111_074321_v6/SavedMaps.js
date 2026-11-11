// ═══════════════════════════════════════════════════════════════════════════
//  FICHEIRO 1: AcademicYearController.js  (ADIÇÕES ao controller existente)
//  Adicionar estas funções ao AcademicYearController.js existente
//  e registar as rotas novas no ficheiro de rotas.
// ═══════════════════════════════════════════════════════════════════════════

/*
─────────────────────────────────────────────────────────────────────────────
  MIGRATION SQL — Executar uma vez na BD
  Adiciona as colunas de datas dos trimestres ao eduall_academic_year
─────────────────────────────────────────────────────────────────────────────

ALTER TABLE `eduall_academic_year`
  ADD COLUMN `ed_academic_year_t1_start` DATE DEFAULT NULL COMMENT 'Início do 1º Trimestre',
  ADD COLUMN `ed_academic_year_t1_end`   DATE DEFAULT NULL COMMENT 'Fim do 1º Trimestre',
  ADD COLUMN `ed_academic_year_t2_start` DATE DEFAULT NULL COMMENT 'Início do 2º Trimestre',
  ADD COLUMN `ed_academic_year_t2_end`   DATE DEFAULT NULL COMMENT 'Fim do 2º Trimestre',
  ADD COLUMN `ed_academic_year_t3_start` DATE DEFAULT NULL COMMENT 'Início do 3º Trimestre',
  ADD COLUMN `ed_academic_year_t3_end`   DATE DEFAULT NULL COMMENT 'Fim do 3º Trimestre';

─────────────────────────────────────────────────────────────────────────────
  MIGRATION SQL — Tabela para guardar mapas de aproveitamento gerados
─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS `eduall_performance_maps` (
  `ed_pm_id`               INT(11)       NOT NULL AUTO_INCREMENT,
  `ed_pm_institute_code`   VARCHAR(50)   NOT NULL,
  `ed_pm_academic_year_id` INT(11)       NOT NULL,
  `ed_pm_academic_year`    VARCHAR(50)   DEFAULT NULL COMMENT 'Label do ano (ex: 2024/2025)',
  `ed_pm_term`             TINYINT(1)    NOT NULL COMMENT '1, 2 ou 3',
  `ed_pm_template`         TINYINT(1)    NOT NULL DEFAULT 1,
  `ed_pm_map_data`         LONGTEXT      DEFAULT NULL COMMENT 'JSON completo do mapa',
  `ed_pm_edited_data`      LONGTEXT      DEFAULT NULL COMMENT 'JSON das edições inline feitas pelo utilizador',
  `ed_pm_logo_data_url`    LONGTEXT      DEFAULT NULL COMMENT 'Base64 do logotipo personalizado',
  `ed_pm_header_lines`     TEXT          DEFAULT NULL COMMENT 'JSON das linhas do cabeçalho',
  `ed_pm_cycle_order`      TEXT          DEFAULT NULL COMMENT 'JSON da ordem dos ciclos',
  `ed_pm_label`            VARCHAR(100)  DEFAULT NULL COMMENT 'Etiqueta legível: ex: T1 - 2024/2025',
  `ed_pm_deleted`          TINYINT(1)    NOT NULL DEFAULT 0,
  `ed_pm_created_at`       DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `ed_pm_updated_at`       DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`ed_pm_id`),
  KEY `idx_pm_institute`   (`ed_pm_institute_code`),
  KEY `idx_pm_year`        (`ed_pm_academic_year_id`),
  KEY `idx_pm_deleted`     (`ed_pm_deleted`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Mapas de Aproveitamento guardados';

*/

// ─────────────────────────────────────────────────────────────────────────────
//  DEPENDÊNCIAS (já existem no AcademicYearController.js)
// ─────────────────────────────────────────────────────────────────────────────
const ExecuteQuery        = require("../Functions/ExecuteQuery");
const { RegisterAuditAction } = require("./Auditory");


// ═══════════════════════════════════════════════════════════════════════════
//  [NOVO] SetAcademicYearTermDates
//  PUT /eduallacademicyeartermdates/put/:ID
//
//  Body:
//  {
//    t1_start: "2025-01-15",
//    t1_end:   "2025-04-15",
//    t2_start: "2025-05-02",
//    t2_end:   "2025-08-08",
//    t3_start: "2025-08-25",
//    t3_end:   "2025-11-28"
//  }
// ═══════════════════════════════════════════════════════════════════════════
const SetAcademicYearTermDates = async (req, res) => {
  try {
    const { ID } = req.params;
    const institute = req.session.user.eduall_user_session_curentinstitute;

    const {
      t1_start, t1_end,
      t2_start, t2_end,
      t3_start, t3_end,
    } = req.body;

    // ── Verificar existência ──────────────────────────────────────────────
    const existing = await ExecuteQuery(res,
      `SELECT ed_academic_year_title
       FROM eduall_academic_year
       WHERE ed_academic_year_id = ?
         AND ed_academic_year_institute_code = ?
         AND ed_academic_year_deleted = 0
       LIMIT 1`,
      [ID, institute], true
    );

    if (!existing.length) {
      return res.status(404).json({ success: false, msg: "Ano académico não encontrado." });
    }

    // ── Validação básica das datas (se fornecidas) ─────────────────────────
    const parseOrNull = (d) => {
      if (!d || d === "" || d === "null") return null;
      const dt = new Date(d);
      return isNaN(dt.getTime()) ? null : d;
    };

    const t1s = parseOrNull(t1_start);
    const t1e = parseOrNull(t1_end);
    const t2s = parseOrNull(t2_start);
    const t2e = parseOrNull(t2_end);
    const t3s = parseOrNull(t3_start);
    const t3e = parseOrNull(t3_end);

    // Validar que fim > início (quando ambos presentes)
    const checkRange = (label, start, end) => {
      if (start && end && new Date(end) <= new Date(start)) {
        throw new Error(`${label}: a data de fim deve ser posterior à data de início.`);
      }
    };
    checkRange("1º Trimestre", t1s, t1e);
    checkRange("2º Trimestre", t2s, t2e);
    checkRange("3º Trimestre", t3s, t3e);

    // ── UPDATE ──────────────────────────────────────────────────────────────
    await ExecuteQuery(res,
      `UPDATE eduall_academic_year SET
         ed_academic_year_t1_start = ?,
         ed_academic_year_t1_end   = ?,
         ed_academic_year_t2_start = ?,
         ed_academic_year_t2_end   = ?,
         ed_academic_year_t3_start = ?,
         ed_academic_year_t3_end   = ?
       WHERE ed_academic_year_id = ?
         AND ed_academic_year_institute_code = ?
         AND ed_academic_year_deleted = 0`,
      [t1s, t1e, t2s, t2e, t3s, t3e, ID, institute],
      false,
      { db: "eduall_academic_year", type: "update", data: req }
    );

    await RegisterAuditAction({
      session:     req.session,
      action:      2,
      form:        "Ano Académico",
      description: `Definiu datas dos trimestres do ano académico "${existing[0].ed_academic_year_title}" (ID ${ID})`,
    });

    return res.status(200).json({
      success: true,
      msg:     "Datas dos trimestres actualizadas com sucesso!",
      dates:   { t1_start: t1s, t1_end: t1e, t2_start: t2s, t2_end: t2e, t3_start: t3s, t3_end: t3e },
    });

  } catch (err) {
    console.error("Erro ao definir datas dos trimestres:", err);
    return res.status(err.message.includes("deve ser") ? 400 : 500)
           .json({ success: false, msg: err.message });
  }
};


// ═══════════════════════════════════════════════════════════════════════════
//  [NOVO] GetAcademicYearTermDates
//  GET /eduallacademicyeartermdates/get/:ID
//  Devolve as datas dos trimestres de um ano académico específico
// ═══════════════════════════════════════════════════════════════════════════
const GetAcademicYearTermDates = async (req, res) => {
  try {
    const { ID } = req.params;
    const institute = req.session.user.eduall_user_session_curentinstitute;

    const rows = await ExecuteQuery(res,
      `SELECT
         ed_academic_year_id,
         ed_academic_year_title,
         ed_academic_year_startDate,
         ed_academic_year_endDate,
         ed_academic_year_t1_start,
         ed_academic_year_t1_end,
         ed_academic_year_t2_start,
         ed_academic_year_t2_end,
         ed_academic_year_t3_start,
         ed_academic_year_t3_end
       FROM eduall_academic_year
       WHERE ed_academic_year_id = ?
         AND ed_academic_year_institute_code = ?
         AND ed_academic_year_deleted = 0
       LIMIT 1`,
      [ID, institute], true
    );

    if (!rows.length) {
      return res.status(404).json({ success: false, msg: "Ano académico não encontrado." });
    }

    return res.status(200).json(rows[0]);
  } catch (err) {
    return res.status(500).json({ success: false, msg: err.message });
  }
};


// ═══════════════════════════════════════════════════════════════════════════
//  FICHEIRO 2: PerformanceMapController.js  (NOVO FICHEIRO)
//  Colocar em: /Controllers/PerformanceMapController.js
// ═══════════════════════════════════════════════════════════════════════════

/*
  ROTAS A ADICIONAR:

  const {
    GetPerformanceMap,
    SavePerformanceMap,
    GetSavedPerformanceMaps,
    GetSingleSavedPerformanceMap,
    DeleteSavedPerformanceMap,
  } = require("../Controllers/PerformanceMapController");

  // ── Mapa de Aproveitamento ──────────────────────────────────
  router.post('/eduallgetperformancemap/get/',              VerifyToken, GetPerformanceMap);
  router.post('/eduallsaveperformancemap/post',             VerifyToken, SavePerformanceMap);
  router.get ('/eduallgetsavedperformancemaps/get',         VerifyToken, GetSavedPerformanceMaps);
  router.get ('/eduallgetsingleperformancemap/get/:ID',     VerifyToken, GetSingleSavedPerformanceMap);
  router.put ('/edualldeleteperformancemap/delete/:ID',     VerifyToken, DeleteSavedPerformanceMap);

  // ── Datas dos trimestres (adicionar ao router do academic year) ──
  router.get ('/eduallacademicyeartermdates/get/:ID',       VerifyToken, GetAcademicYearTermDates);
  router.put ('/eduallacademicyeartermdates/put/:ID',       VerifyToken, SetAcademicYearTermDates);
*/


// ─────────────────────────────────────────────────────────────────────────────
//  LÓGICA PRINCIPAL: GetPerformanceMap
//  POST /eduallgetperformancemap/get/
//
//  Body:
//  {
//    term:           1 | 2 | 3,
//    template:       1 | 2,
//    academicYearId: number
//  }
//
//  Como se calculam os valores (regras da imagem):
//  ┌─────────────────────────────────────────────────────────────────────────┐
//  │ MATRICULADOS MF/F  = alunos inscritos na turma (ed_student_deleted=0)   │
//  │ DESISTENTES  MF/F  = alunos com ed_student_dropout = 1                  │
//  │ AVALIADOS    MF/F  = MATRICULADOS − DESISTENTES                         │
//  │ COM APROVEIT MF/F  = alunos com nota final >= 10 (ou limite da escola)  │
//  │ COM APROVEIT %     = (COM_APROVEIT / AVALIADOS) × 100                   │
//  │ SEM APROVEIT MF/F  = AVALIADOS − COM APROVEIT                           │
//  │ SEM APROVEIT %     = 100 − COM_APROVEIT_%  (ou SEM/AVALIADOS × 100)    │
//  └─────────────────────────────────────────────────────────────────────────┘
//
//  Para os dados de avaliações (nota final), é necessária a tabela de notas.
//  Este controller usa a estrutura genérica — adaptar o nome da tabela/coluna
//  de notas ao projecto real (comentado abaixo).
// ─────────────────────────────────────────────────────────────────────────────
const GetPerformanceMap = async (req, res) => {
  try {
    const institute  = req.session.user.eduall_user_session_curentinstitute;
    const { term, template, academicYearId } = req.body;

    const termNum     = parseInt(term, 10);
    const templateNum = parseInt(template, 10) || 1;
    const yearId      = parseInt(academicYearId, 10);

    if (!termNum || !yearId) {
      return res.status(400).json({ success: false, message: "Parâmetros inválidos." });
    }

    // ── 1. Buscar dados do ano académico (incluindo datas dos trimestres) ───
    const yearRows = await ExecuteQuery(res,
      `SELECT *
       FROM eduall_academic_year
       WHERE ed_academic_year_id = ?
         AND ed_academic_year_institute_code = ?
         AND ed_academic_year_deleted = 0
       LIMIT 1`,
      [yearId, institute], true
    );

    if (!yearRows.length) {
      return res.status(404).json({ success: false, message: "Ano académico não encontrado." });
    }

    const yearData  = yearRows[0];
    const schoolYear = yearData.ed_academic_year_title;

    // Datas do trimestre seleccionado
    const termStartCol = `ed_academic_year_t${termNum}_start`;
    const termEndCol   = `ed_academic_year_t${termNum}_end`;
    const termStart    = yearData[termStartCol] || null;
    const termEnd      = yearData[termEndCol]   || null;

    // ── 2. Buscar dados do instituto ────────────────────────────────────────
    const instRows = await ExecuteQuery(res,
      `SELECT * FROM eduall_institutes WHERE ed_institute_code = ? LIMIT 1`,
      [institute], true
    );
    const instituteData = instRows[0] || {};

    // ── 3. Buscar todas as turmas do ano académico ──────────────────────────
    const classRows = await ExecuteQuery(res,
      `SELECT
         c.ed_class_id,
         c.ed_class_title,
         ci.ed_cicle_id,
         ci.ed_cicle_title
       FROM eduall_class c
       LEFT JOIN eduall_cicles ci ON ci.ed_cicle_id = c.ed_class_cicle AND ci.ed_cicle_deleted = 0
       WHERE c.ed_class_deleted = 0
         AND c.ed_class_year   = ?
         AND c.ed_class_institute_code = ?
       ORDER BY c.ed_class_title ASC`,
      [yearId, institute], true
    );

    if (!classRows.length) {
      return res.status(200).json({
        success: false,
        message: "Não existem turmas para o ano académico seleccionado.",
      });
    }

    // ── 4. Buscar TODOS os alunos das turmas de uma vez (evita N+1) ─────────
    const classIds = classRows.map(c => c.ed_class_id);
    const placeholders = classIds.map(() => "?").join(",");

    //  4a. Contagem por turma: TOTAL, FEMININO, DESISTENTES, DESISTENTES FEMININO
    const studentCountRows = await ExecuteQuery(res,
      `SELECT
         s.ed_student_class,
         COUNT(*)                                                        AS total_mf,
         SUM(CASE WHEN s.ed_student_gender = 'F' THEN 1 ELSE 0 END)    AS total_f,
         SUM(CASE WHEN s.ed_student_dropout = 1  THEN 1 ELSE 0 END)    AS dropout_mf,
         SUM(CASE WHEN s.ed_student_dropout = 1
                   AND s.ed_student_gender = 'F'  THEN 1 ELSE 0 END)   AS dropout_f
       FROM eduall_students s
       WHERE s.ed_student_deleted = 0
         AND s.ed_student_class IN (${placeholders})
       GROUP BY s.ed_student_class`,
      classIds, true
    );

    //  Mapear contagens por turma
    const countMap = {};
    for (const row of studentCountRows) {
      countMap[row.ed_student_class] = {
        matMF:  parseInt(row.total_mf   || 0, 10),
        matF:   parseInt(row.total_f    || 0, 10),
        drpMF:  parseInt(row.dropout_mf || 0, 10),
        drpF:   parseInt(row.dropout_f  || 0, 10),
      };
    }

    //  4b. Contagem de aprovados por turma (nota final >= 10)
    //  ATENÇÃO: adaptar o nome da tabela e coluna de notas ao projecto real.
    //  Aqui usamos a tabela genérica `eduall_grades` com coluna `ed_grade_final`.
    //  Se a tabela de notas se chamar diferente, basta alterar abaixo.
    //
    //  Lógica de "avaliado":
    //    Um aluno é "avaliado" se tem pelo menos uma nota registada para o trimestre.
    //    Usa-se a coluna ed_grade_term para filtrar pelo trimestre.
    //
    //  Se não houver tabela de notas implementada ainda, os valores de avaliados
    //  serão calculados como: AVALIADOS = MATRICULADOS − DESISTENTES (sem filtro de nota)
    //  e aprovados = 0 (a preencher manualmente no modo de edição).

    let gradeMap = {}; // { classId: { evalMF, evalF, aprvMF, aprvF } }

    try {
      const gradeRows = await ExecuteQuery(res,
        `SELECT
           s.ed_student_class,
           COUNT(DISTINCT s.ed_student_id)                                          AS eval_mf,
           COUNT(DISTINCT CASE WHEN s.ed_student_gender = 'F'
                               THEN s.ed_student_id END)                            AS eval_f,
           COUNT(DISTINCT CASE WHEN g.ed_grade_final >= 10
                               THEN s.ed_student_id END)                            AS aprv_mf,
           COUNT(DISTINCT CASE WHEN g.ed_grade_final >= 10
                                AND s.ed_student_gender = 'F'
                               THEN s.ed_student_id END)                            AS aprv_f
         FROM eduall_students s
         INNER JOIN eduall_grades g
           ON g.ed_grade_student = s.ed_student_id
          AND g.ed_grade_term    = ?
          AND g.ed_grade_year    = ?
          AND g.ed_grade_deleted = 0
         WHERE s.ed_student_deleted = 0
           AND s.ed_student_dropout = 0
           AND s.ed_student_class IN (${placeholders})
         GROUP BY s.ed_student_class`,
        [termNum, yearId, ...classIds], true
      );

      for (const row of gradeRows) {
        gradeMap[row.ed_student_class] = {
          evalMF: parseInt(row.eval_mf || 0, 10),
          evalF:  parseInt(row.eval_f  || 0, 10),
          aprvMF: parseInt(row.aprv_mf || 0, 10),
          aprvF:  parseInt(row.aprv_f  || 0, 10),
        };
      }
    } catch (_gradeErr) {
      // Tabela de notas não existe ou estrutura diferente:
      // Calcular avaliados = matriculados − desistentes, aprovados = 0
      // O utilizador pode preencher manualmente no modo de edição.
      for (const cls of classRows) {
        const cnt = countMap[cls.ed_class_id] || {};
        gradeMap[cls.ed_class_id] = {
          evalMF: Math.max(0, (cnt.matMF || 0) - (cnt.drpMF || 0)),
          evalF:  Math.max(0, (cnt.matF  || 0) - (cnt.drpF  || 0)),
          aprvMF: 0,
          aprvF:  0,
        };
      }
    }

    // ── 5. Montar estrutura por ciclo ───────────────────────────────────────
    const fmt = (n) => Number.isFinite(n) ? n.toFixed(2).replace(".", ",") : "0,00";

    const buildStats = (classId) => {
      const cnt = countMap[classId] || { matMF: 0, matF: 0, drpMF: 0, drpF: 0 };
      const gr  = gradeMap[classId] || { evalMF: 0, evalF: 0, aprvMF: 0, aprvF: 0 };

      const matMF  = cnt.matMF  || 0;
      const matF   = cnt.matF   || 0;
      const drpMF  = cnt.drpMF  || 0;
      const drpF   = cnt.drpF   || 0;
      const evalMF = gr.evalMF  || 0;
      const evalF  = gr.evalF   || 0;
      const aprvMF = gr.aprvMF  || 0;
      const aprvF  = gr.aprvF   || 0;
      const repMF  = Math.max(0, evalMF - aprvMF);
      const repF   = Math.max(0, evalF  - aprvF);

      const pctAprv = evalMF > 0 ? (aprvMF / evalMF) * 100 : 0;
      const pctRep  = evalMF > 0 ? (repMF  / evalMF) * 100 : 0;

      return { matMF, matF, drpMF, drpF, evalMF, evalF, aprvMF, aprvF, repMF, repF, pctAprv: fmt(pctAprv), pctRep: fmt(pctRep) };
    };

    const addStats = (a, b) => {
      const keys = ["matMF","matF","drpMF","drpF","evalMF","evalF","aprvMF","aprvF","repMF","repF"];
      const out  = {};
      for (const k of keys) out[k] = (a[k] || 0) + (b[k] || 0);
      const pctAprv = out.evalMF > 0 ? (out.aprvMF / out.evalMF) * 100 : 0;
      const pctRep  = out.evalMF > 0 ? (out.repMF  / out.evalMF) * 100 : 0;
      out.pctAprv = fmt(pctAprv);
      out.pctRep  = fmt(pctRep);
      return out;
    };

    // Agrupar turmas por ciclo
    const cycleMap = new Map();
    for (const cls of classRows) {
      const key = cls.ed_cicle_id || 0;
      if (!cycleMap.has(key)) {
        cycleMap.set(key, {
          key:     String(key),
          label:   cls.ed_cicle_title || "Sem Ciclo",
          order:   cls.ed_cicle_order || 0,
          classes: [],
        });
      }
      cycleMap.get(key).classes.push({
        id:    cls.ed_class_id,
        name:  cls.ed_class_title,
        stats: buildStats(cls.ed_class_id),
      });
    }

    const ZERO_STAT = { matMF:0,matF:0,drpMF:0,drpF:0,evalMF:0,evalF:0,aprvMF:0,aprvF:0,repMF:0,repF:0,pctAprv:"0,00",pctRep:"0,00" };

    const cyclesData = Array.from(cycleMap.values()).map(cy => ({
      ...cy,
      subtotal: cy.classes.reduce((acc, cls) => addStats(acc, cls.stats), { ...ZERO_STAT }),
    }));

    // ── 6. Total geral ──────────────────────────────────────────────────────
    const grand = cyclesData.reduce((acc, cy) => addStats(acc, cy.subtotal), { ...ZERO_STAT });

    // Termos labels
    const TERM_LABELS = { 1: "1º", 2: "2º", 3: "3º" };

    // ── 7. Datas de todos os trimestres (para exibir no frontend) ───────────
    const termDates = {
      t1: { start: yearData.ed_academic_year_t1_start || null, end: yearData.ed_academic_year_t1_end || null },
      t2: { start: yearData.ed_academic_year_t2_start || null, end: yearData.ed_academic_year_t2_end || null },
      t3: { start: yearData.ed_academic_year_t3_start || null, end: yearData.ed_academic_year_t3_end || null },
    };

    return res.status(200).json({
      success: true,
      mapData: {
        institute:  instituteData,
        schoolYear,
        termLabel:  TERM_LABELS[termNum] || `${termNum}º`,
        term:       termNum,
        template:   templateNum,
        termStart,
        termEnd,
        termDates,
        academicYearId: yearId,
        cyclesData,
        grand,
      },
    });

  } catch (err) {
    console.error("Erro ao gerar mapa de aproveitamento:", err);
    return res.status(500).json({ success: false, message: err.message });
  }
};


// ═══════════════════════════════════════════════════════════════════════════
//  SavePerformanceMap
//  POST /eduallsaveperformancemap/post
//
//  Guarda (ou actualiza) o mapa de aproveitamento de um dado trimestre+ano.
//  Um mapa por (institute, year, term) — se já existir, actualiza.
//
//  Body:
//  {
//    academicYearId : number,
//    term           : 1|2|3,
//    template       : 1|2,
//    mapData        : object,   // dados brutos gerados pelo endpoint
//    editedData     : object,   // edições inline feitas pelo utilizador
//    logoDataUrl    : string|null,
//    headerLines    : array|null,
//    cycleOrder     : array|null,
//    label          : string    // ex: "T1 - 2024/2025"
//  }
// ═══════════════════════════════════════════════════════════════════════════
const SavePerformanceMap = async (req, res) => {
  try {
    const institute = req.session.user.eduall_user_session_curentinstitute;
    const {
      academicYearId, term, template,
      mapData, editedData, logoDataUrl,
      headerLines, cycleOrder, label,
    } = req.body;

    if (!academicYearId || !term) {
      return res.status(400).json({ success: false, msg: "Parâmetros inválidos." });
    }

    const toJson = (v) => v ? JSON.stringify(v) : null;

    // Verificar se já existe
    const existing = await ExecuteQuery(res,
      `SELECT ed_pm_id FROM eduall_performance_maps
       WHERE ed_pm_deleted = 0
         AND ed_pm_institute_code   = ?
         AND ed_pm_academic_year_id = ?
         AND ed_pm_term             = ?
       LIMIT 1`,
      [institute, academicYearId, term], true
    );

    let savedId;

    if (existing.length) {
      // UPDATE
      savedId = existing[0].ed_pm_id;
      await ExecuteQuery(res,
        `UPDATE eduall_performance_maps SET
           ed_pm_template      = ?,
           ed_pm_map_data      = ?,
           ed_pm_edited_data   = ?,
           ed_pm_logo_data_url = ?,
           ed_pm_header_lines  = ?,
           ed_pm_cycle_order   = ?,
           ed_pm_label         = ?
         WHERE ed_pm_id = ?
           AND ed_pm_institute_code = ?`,
        [
          template || 1,
          toJson(mapData),
          toJson(editedData),
          logoDataUrl  || null,
          toJson(headerLines),
          toJson(cycleOrder),
          label || null,
          savedId,
          institute,
        ],
        false,
        { db: "eduall_performance_maps", type: "update", data: req }
      );
    } else {
      // INSERT
      const result = await ExecuteQuery(res,
        `INSERT INTO eduall_performance_maps (
           ed_pm_institute_code, ed_pm_academic_year_id, ed_pm_academic_year,
           ed_pm_term, ed_pm_template,
           ed_pm_map_data, ed_pm_edited_data, ed_pm_logo_data_url,
           ed_pm_header_lines, ed_pm_cycle_order, ed_pm_label
         ) VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
        [
          institute,
          academicYearId,
          mapData?.schoolYear || null,
          term,
          template || 1,
          toJson(mapData),
          toJson(editedData),
          logoDataUrl  || null,
          toJson(headerLines),
          toJson(cycleOrder),
          label || null,
        ],
        false,
        { db: "eduall_performance_maps", type: "insert", data: req }
      );
      savedId = result.insertId;
    }

    await RegisterAuditAction({
      session:     req.session,
      action:      existing.length ? 2 : 1,
      form:        "Mapa de Aproveitamento",
      description: `${existing.length ? "Actualizou" : "Guardou"} mapa de aproveitamento: ${label || `T${term} - ${mapData?.schoolYear}`}`,
    });

    return res.status(200).json({ success: true, saved_id: savedId, msg: "Mapa guardado com sucesso!" });

  } catch (err) {
    console.error("Erro ao guardar mapa:", err);
    return res.status(500).json({ success: false, msg: err.message });
  }
};


// ═══════════════════════════════════════════════════════════════════════════
//  GetSavedPerformanceMaps
//  GET /eduallgetsavedperformancemaps/get
//  Lista todos os mapas guardados do instituto (sem o JSON pesado)
// ═══════════════════════════════════════════════════════════════════════════
const GetSavedPerformanceMaps = async (req, res) => {
  try {
    const institute = req.session.user.eduall_user_session_curentinstitute;

    const rows = await ExecuteQuery(res,
      `SELECT
         ed_pm_id,
         ed_pm_academic_year_id,
         ed_pm_academic_year,
         ed_pm_term,
         ed_pm_template,
         ed_pm_label,
         ed_pm_created_at,
         ed_pm_updated_at
       FROM eduall_performance_maps
       WHERE ed_pm_deleted = 0
         AND ed_pm_institute_code = ?
       ORDER BY ed_pm_updated_at DESC`,
      [institute], true
    );

    return res.status(200).json(rows);
  } catch (err) {
    return res.status(500).json({ success: false, msg: err.message });
  }
};


// ═══════════════════════════════════════════════════════════════════════════
//  GetSingleSavedPerformanceMap
//  GET /eduallgetsingleperformancemap/get/:ID
//  Devolve o mapa completo com todos os JSON (para re-carregar o estado)
// ═══════════════════════════════════════════════════════════════════════════
const GetSingleSavedPerformanceMap = async (req, res) => {
  try {
    const { ID }    = req.params;
    const institute = req.session.user.eduall_user_session_curentinstitute;

    const rows = await ExecuteQuery(res,
      `SELECT * FROM eduall_performance_maps
       WHERE ed_pm_id = ?
         AND ed_pm_institute_code = ?
         AND ed_pm_deleted = 0
       LIMIT 1`,
      [ID, institute], true
    );

    if (!rows.length) {
      return res.status(404).json({ success: false, msg: "Mapa não encontrado." });
    }

    const row = rows[0];
    const parse = (v) => { try { return v ? JSON.parse(v) : null; } catch { return null; } };

    return res.status(200).json({
      ...row,
      ed_pm_map_data:    parse(row.ed_pm_map_data),
      ed_pm_edited_data: parse(row.ed_pm_edited_data),
      ed_pm_header_lines: parse(row.ed_pm_header_lines),
      ed_pm_cycle_order:  parse(row.ed_pm_cycle_order),
    });
  } catch (err) {
    return res.status(500).json({ success: false, msg: err.message });
  }
};


// ═══════════════════════════════════════════════════════════════════════════
//  DeleteSavedPerformanceMap  (soft delete)
//  PUT /edualldeleteperformancemap/delete/:ID
// ═══════════════════════════════════════════════════════════════════════════
const DeleteSavedPerformanceMap = async (req, res) => {
  try {
    const { ID }    = req.params;
    const institute = req.session.user.eduall_user_session_curentinstitute;

    const existing = await ExecuteQuery(res,
      `SELECT ed_pm_label FROM eduall_performance_maps
       WHERE ed_pm_id = ? AND ed_pm_institute_code = ? AND ed_pm_deleted = 0 LIMIT 1`,
      [ID, institute], true
    );

    if (!existing.length) {
      return res.status(404).json({ success: false, msg: "Mapa não encontrado." });
    }

    await ExecuteQuery(res,
      `UPDATE eduall_performance_maps SET ed_pm_deleted = 1 WHERE ed_pm_id = ? AND ed_pm_institute_code = ?`,
      [ID, institute], false,
      { db: "eduall_performance_maps", type: "update", data: req }
    );

    await RegisterAuditAction({
      session:     req.session,
      action:      3,
      form:        "Mapa de Aproveitamento",
      description: `Eliminou mapa de aproveitamento: ${existing[0].ed_pm_label || `ID ${ID}`}`,
    });

    return res.status(200).json({ success: true, msg: "Mapa eliminado com sucesso." });
  } catch (err) {
    return res.status(500).json({ success: false, msg: err.message });
  }
};


module.exports = {
  // Academic Year additions
  SetAcademicYearTermDates,
  GetAcademicYearTermDates,
  // Performance Map
  GetPerformanceMap,
  SavePerformanceMap,
  GetSavedPerformanceMaps,
  GetSingleSavedPerformanceMap,
  DeleteSavedPerformanceMap,
};