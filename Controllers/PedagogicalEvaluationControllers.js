// CACHE-OPT v5 (aplicado por apply_cache_optimizations.py)
/* ═══════════════════════════════════════════════════════════════════════════
   PedagogicalEvaluation.js — Controller de Avaliação Pedagógica
   Segue o mesmo padrão dos controllers Employees.js / TeacherTimings.js:
   ExecuteQuery + Cache.eduall* + RegisterAuditAction + validações dedicadas.
═══════════════════════════════════════════════════════════════════════════ */

const ExecuteQuery = require("../Functions/ExecuteQuery");
const Cache = require("../Functions/CacheRoutes");
const { RegisterAuditAction } = require("./Auditory");

const EVALUATION_CACHE_TTL = 3600;

 
/* ─── Chaves de cache ──────────────────────────────────────────────────── */
const CacheKeys = {
  list: (instituteCode) => `pedagogicalEvaluation:${instituteCode}:list`,
  single: (id, instituteCode) => `pedagogicalEvaluation:${instituteCode}:single:${id}`,
  byProfessor: (professorCode, instituteCode) => `pedagogicalEvaluation:${instituteCode}:byProfessor:${professorCode}`,
  byPeriod: (periodo, instituteCode) => `pedagogicalEvaluation:${instituteCode}:byPeriod:${periodo}`,
  dashboard: (instituteCode) => `pedagogicalEvaluation:${instituteCode}:dashboard`,
  all: (instituteCode) => `pedagogicalEvaluation:${instituteCode}:*`,
};

/* ─── Constantes de domínio (espelham o frontend) ─────────────────────── */
const PERIODOS = ["1º Trimestre", "2º Trimestre", "3º Trimestre", "4º Trimestre"];

const CRITERIA_KEYS = [
  "planeamento",
  "pontualidade",
  "assiduidade",
  "dominio",
  "metodologia",
  "gestao",
  "relacionamento",
  "cumprimentoCurricular",
  "entregaAvaliacoes",
  "participacao",
];

const PLAN_AREAS = ["Planeamento", "Pontualidade", "Metodologia", "Gestão da turma", "Avaliação", "Outro"];
const PLAN_RESPONSIBLES = ["Coordenador Pedagógico", "Direção Pedagógica", "Chefe de Departamento"];
const ESTADOS = ["Rascunho", "Concluída", "Em acompanhamento"];

/* ═══════════════════════════════════════════════════════════════════════════
   HELPERS DE CÁLCULO — espelham exactamente a lógica usada no frontend
   (calculateAverage / getClassification) para garantir que o valor gravado
   na BD é sempre consistente com o que o utilizador viu no formulário.
═══════════════════════════════════════════════════════════════════════════ */
const isFilled = (v) => String(v ?? "").trim() !== "";
const round1 = (n) => Math.round(n * 10) / 10;

function calculateAverage(criterios) {
  const vals = Object.values(criterios || {}).filter((v) => typeof v === "number" && v > 0);
  if (!vals.length) return 0;
  return round1(vals.reduce((a, b) => a + b, 0) / vals.length);
}

function getClassificationLabel(media) {
  if (media >= 4.5) return "Excelente";
  if (media >= 4.0) return "Muito Bom";
  if (media >= 3.0) return "Bom";
  if (media >= 2.0) return "Acompanhamento";
  if (media > 0) return "Insuficiente";
  return "Sem dados";
}

/* Estado final aplicado no guardar, espelhando EvaluationModal.handleSave do frontend */
function resolveEstado(requestedStatus, media) {
  if (requestedStatus !== "Concluída") return "Rascunho";
  return media < 3 ? "Em acompanhamento" : "Concluída";
}

/* ═══════════════════════════════════════════════════════════════════════════
   VALIDAÇÕES
═══════════════════════════════════════════════════════════════════════════ */
function ValidateEvaluationFields(body, { requireComplete } = {}) {
  const errors = [];

  if (!isFilled(body.evaluation_professor_code)) errors.push("Professor é obrigatório.");
  if (!isFilled(body.evaluation_periodo) || !PERIODOS.includes(body.evaluation_periodo))
    errors.push("Período inválido. Escolha um dos trimestres disponíveis.");
  if (!isFilled(body.evaluation_data)) errors.push("Data da avaliação é obrigatória.");

  const criterios = body.evaluation_criterios && typeof body.evaluation_criterios === "object"
    ? body.evaluation_criterios
    : {};

  const invalidKeys = Object.keys(criterios).filter((k) => !CRITERIA_KEYS.includes(k));
  if (invalidKeys.length) errors.push(`Critérios desconhecidos: ${invalidKeys.join(", ")}.`);

  const invalidValues = Object.entries(criterios).filter(
    ([, v]) => typeof v !== "number" || v < 1 || v > 5
  );
  if (invalidValues.length) errors.push("Cada critério deve ter uma pontuação entre 1 e 5.");

  if (requireComplete) {
    const missing = CRITERIA_KEYS.filter((k) => typeof criterios[k] !== "number");
    if (missing.length)
      errors.push("Para finalizar a avaliação é necessário preencher todos os critérios de desempenho.");
  }

  if (Array.isArray(body.evaluation_plano_melhoria)) {
    body.evaluation_plano_melhoria.forEach((p, idx) => {
      if (p.area && !PLAN_AREAS.includes(p.area))
        errors.push(`Área de melhoria inválida na ação #${idx + 1}.`);
      if (p.responsavel && !PLAN_RESPONSIBLES.includes(p.responsavel))
        errors.push(`Responsável inválido na ação #${idx + 1}.`);
    });
  }

  return errors;
}

/* ═══════════════════════════════════════════════════════════════════════════
   RESPOSTAS PADRÃO
═══════════════════════════════════════════════════════════════════════════ */
const sendError = (res, httpStatus, msg, errors = null) => {
  const payload = { success: false, msg };
  if (errors) payload.errors = errors;
  return res.status(httpStatus).json(payload);
};
const sendOk = (res, httpStatus, payload = {}) => res.status(httpStatus).json({ success: true, ...payload });

/* ═══════════════════════════════════════════════════════════════════════════
   FETCH BASE (sem cache) — inclui dados do professor (nome, avatar, cargo)
   e do avaliador via JOIN a eduall_employees.
═══════════════════════════════════════════════════════════════════════════ */
const FetchEvaluations = async (res, req, instituteCode) => {
  const query = `
    SELECT
      ev.*,
      prof.ed_employee_name    AS professor_nome,
      prof.ed_employee_picture AS professor_foto,
      COALESCE(jt.ed_job_title, 'Não atribuído') AS professor_cargo
    FROM eduall_pedagogical_evaluations ev
    LEFT JOIN eduall_employees prof
      ON prof.ed_employee_id = ev.ed_eval_professor_code
     AND prof.ed_employee_deleted = 0
    LEFT JOIN eduall_job_titles jt
      ON jt.ed_job_title_id = prof.ed_employee_charge
    WHERE ev.ed_eval_deleted = 0
      AND ev.ed_eval_institute_code = ?
    ORDER BY ev.ed_eval_data DESC
  `;
  return ExecuteQuery(res, query, [instituteCode], true, {
    db: "eduall_pedagogical_evaluations",
    type: "select",
    data: req,
  });
};

const FetchSingleEvaluation = async (res, req, id, instituteCode) => {
  const query = `
    SELECT
      ev.*,
      prof.ed_employee_name    AS professor_nome,
      prof.ed_employee_picture AS professor_foto,
      COALESCE(jt.ed_job_title, 'Não atribuído') AS professor_cargo
    FROM eduall_pedagogical_evaluations ev
    LEFT JOIN eduall_employees prof
      ON prof.ed_employee_id = ev.ed_eval_professor_code
     AND prof.ed_employee_deleted = 0
    LEFT JOIN eduall_job_titles jt
      ON jt.ed_job_title_id = prof.ed_employee_charge
    WHERE ev.ed_eval_deleted = 0
      AND ev.ed_eval_id = ?
      AND ev.ed_eval_institute_code = ?
  `;
  const rows = await ExecuteQuery(res, query, [id, instituteCode], true, {
    db: "eduall_pedagogical_evaluations",
    type: "select",
    data: req,
  });
  return rows && rows[0] ? rows[0] : null;
};

/* ─── Refrescar cache (limpa tudo e repõe a lista) ─────────────────────── */
const RefreshEvaluationCache = async (res, req, instituteCode) => {
  const startTime = Date.now();

  await Cache.eduallClear(CacheKeys.all(instituteCode));
  console.log(`📦🧹 CACHE -> limpa (avaliações) para institute ${instituteCode}`);

  const rows = await FetchEvaluations(res, req, instituteCode);
  await Cache.eduallSet(CacheKeys.list(instituteCode), rows, EVALUATION_CACHE_TTL);

  const duration = Date.now() - startTime;
  console.log(`🗄️🐢 BASE DE DADOS (lento) -> cache de avaliações reposta em ${duration}ms para institute ${instituteCode}`);

  return rows;
};

/* ===================== GET OPERATIONS (COM CACHE) ===================== */

/**
 * GET ALL — Listar todas as avaliações pedagógicas do instituto (inclui rascunhos)
 */
const GetEvaluations = async (req, res) => {
  try {
    const instituteCode = req.session.user.eduall_user_session_curentinstitute;
    const cacheKey = CacheKeys.list(instituteCode);
    const startTime = Date.now();

    const cached = await Cache.eduallGet(cacheKey);
    if (cached !== null) {
      const duration = Date.now() - startTime;
      console.log(`📦⚡ CACHE (rápido) -> GetEvaluations demorou ${duration}ms (${cacheKey})`);
      return res.status(200).json(cached);
    }

    const rows = await FetchEvaluations(res, req, instituteCode);
    await Cache.eduallSet(cacheKey, rows, EVALUATION_CACHE_TTL);

    const duration = Date.now() - startTime;
    console.log(`🗄️🐢 BASE DE DADOS (lento) -> GetEvaluations demorou ${duration}ms (${cacheKey})`);

    res.status(200).json(rows);
  } catch (error) {
    res.status(500).json({ success: false, message: "Falha ao buscar avaliações pedagógicas!", error: error.message });
  }
};

/**
 * GET SINGLE — Obter uma avaliação específica
 */
const GetSingleEvaluation = async (req, res) => {
  try {
    const { ID } = req.params;
    const instituteCode = req.session.user.eduall_user_session_curentinstitute;
    const cacheKey = CacheKeys.single(ID, instituteCode);
    const startTime = Date.now();

    const cached = await Cache.eduallGet(cacheKey);
    if (cached !== null) {
      const duration = Date.now() - startTime;
      console.log(`📦⚡ CACHE (rápido) -> GetSingleEvaluation demorou ${duration}ms (${cacheKey})`);
      return res.status(200).json(cached);
    }

    const result = await FetchSingleEvaluation(res, req, ID, instituteCode);
    if (!result) return sendError(res, 404, "Avaliação não encontrada.");

    await Cache.eduallSet(cacheKey, result, EVALUATION_CACHE_TTL);

    const duration = Date.now() - startTime;
    console.log(`🗄️🐢 BASE DE DADOS (lento) -> GetSingleEvaluation demorou ${duration}ms (${cacheKey})`);

    res.status(200).json(result);
  } catch (error) {
    res.status(500).json({ success: false, message: "Falha ao buscar avaliação!", error: error.message });
  }
};

/**
 * GET BY PROFESSOR — Histórico de avaliações de um professor (para o Perfil de Desempenho)
 */
const GetEvaluationsByProfessor = async (req, res) => {
  try {
    const { CODE } = req.params;
    const instituteCode = req.session.user.eduall_user_session_curentinstitute;
    const cacheKey = CacheKeys.byProfessor(CODE, instituteCode);
    const startTime = Date.now();

    const cached = await Cache.eduallGet(cacheKey);
    if (cached !== null) {
      const duration = Date.now() - startTime;
      console.log(`📦⚡ CACHE (rápido) -> GetEvaluationsByProfessor demorou ${duration}ms (${cacheKey})`);
      return res.status(200).json(cached);
    }

    const query = `
      SELECT ev.*
      FROM eduall_pedagogical_evaluations ev
      WHERE ev.ed_eval_deleted = 0
        AND ev.ed_eval_professor_code = ?
        AND ev.ed_eval_institute_code = ?
      ORDER BY ev.ed_eval_data ASC
    `;
    const rows = await ExecuteQuery(res, query, [CODE, instituteCode], true, {
      db: "eduall_pedagogical_evaluations",
      type: "select",
      data: req,
    });

    await Cache.eduallSet(cacheKey, rows, EVALUATION_CACHE_TTL);

    const duration = Date.now() - startTime;
    console.log(`🗄️🐢 BASE DE DADOS (lento) -> GetEvaluationsByProfessor demorou ${duration}ms (${cacheKey})`);

    res.status(200).json(rows);
  } catch (error) {
    res.status(500).json({ success: false, message: "Falha ao buscar avaliações do professor!", error: error.message });
  }
};

/**
 * GET BY PERIOD — Todas as avaliações concluídas de um dado trimestre (para gráficos de evolução)
 */
const GetEvaluationsByPeriod = async (req, res) => {
  try {
    const { PERIODO } = req.params;
    const instituteCode = req.session.user.eduall_user_session_curentinstitute;

    if (!PERIODOS.includes(PERIODO)) return sendError(res, 400, "Período inválido.");

    const cacheKey = CacheKeys.byPeriod(PERIODO, instituteCode);
    const startTime = Date.now();

    const cached = await Cache.eduallGet(cacheKey);
    if (cached !== null) {
      const duration = Date.now() - startTime;
      console.log(`📦⚡ CACHE (rápido) -> GetEvaluationsByPeriod demorou ${duration}ms (${cacheKey})`);
      return res.status(200).json(cached);
    }

    const query = `
      SELECT ev.*
      FROM eduall_pedagogical_evaluations ev
      WHERE ev.ed_eval_deleted = 0
        AND ev.ed_eval_periodo = ?
        AND ev.ed_eval_estado != 'Rascunho'
        AND ev.ed_eval_institute_code = ?
    `;
    const rows = await ExecuteQuery(res, query, [PERIODO, instituteCode], true, {
      db: "eduall_pedagogical_evaluations",
      type: "select",
      data: req,
    });

    await Cache.eduallSet(cacheKey, rows, EVALUATION_CACHE_TTL);

    const duration = Date.now() - startTime;
    console.log(`🗄️🐢 BASE DE DADOS (lento) -> GetEvaluationsByPeriod demorou ${duration}ms (${cacheKey})`);

    res.status(200).json(rows);
  } catch (error) {
    res.status(500).json({ success: false, message: "Falha ao buscar avaliações do período!", error: error.message });
  }
};

/**
 * GET DASHBOARD — Estatísticas agregadas para a Visão Geral (KPIs, alertas, watchlist).
 * O agrupamento por critério/professor é feito em memória porque os critérios
 * são guardados em JSON (ver nota na definição da tabela).
 */
const GetEvaluationsDashboard = async (req, res) => {
  try {
    const instituteCode = req.session.user.eduall_user_session_curentinstitute;
    const cacheKey = CacheKeys.dashboard(instituteCode);
    const startTime = Date.now();

    const cached = await Cache.eduallGet(cacheKey);
    if (cached !== null) {
      const duration = Date.now() - startTime;
      console.log(`📦⚡ CACHE (rápido) -> GetEvaluationsDashboard demorou ${duration}ms (${cacheKey})`);
      return res.status(200).json(cached);
    }

    const rows = await FetchEvaluations(res, req, instituteCode);
    const done = rows.filter((e) => e.ed_eval_estado !== "Rascunho");

    const evaluatedProfessors = new Set(done.map((e) => e.ed_eval_professor_code));
    const mediaGeral = done.length ? round1(done.reduce((s, e) => s + Number(e.ed_eval_media), 0) / done.length) : 0;

    const byProfessor = {};
    done.forEach((e) => {
      const key = e.ed_eval_professor_code;
      if (!byProfessor[key]) byProfessor[key] = [];
      byProfessor[key].push(e);
    });
    const professorAverages = Object.entries(byProfessor).map(([professorCode, evals]) => ({
      professorCode: Number(professorCode),
      professorNome: evals[0].professor_nome,
      media: round1(evals.reduce((s, e) => s + Number(e.ed_eval_media), 0) / evals.length),
    }));

    const excelentes = professorAverages.filter((p) => p.media >= 4.5).length;
    const emAcompanhamento = professorAverages
      .filter((p) => p.media < 3)
      .sort((a, b) => a.media - b.media);

    const pendentes = rows.filter((e) => e.ed_eval_estado === "Rascunho").length;

    const criteriaAverages = CRITERIA_KEYS.map((key) => {
      const vals = done
        .map((e) => (typeof e.ed_eval_criterios === "string" ? JSON.parse(e.ed_eval_criterios) : e.ed_eval_criterios))
        .map((c) => c && c[key])
        .filter((v) => typeof v === "number");
      return { key, media: vals.length ? round1(vals.reduce((a, b) => a + b, 0) / vals.length) : 0 };
    });

    const evolucaoPorPeriodo = PERIODOS.map((periodo) => {
      const evs = done.filter((e) => e.ed_eval_periodo === periodo);
      return { periodo, media: evs.length ? round1(evs.reduce((s, e) => s + Number(e.ed_eval_media), 0) / evs.length) : null };
    });

    const result = {
      avaliados: evaluatedProfessors.size,
      totalAvaliacoes: done.length,
      mediaGeral,
      excelentes,
      acompanhamento: emAcompanhamento.length,
      pendentes,
      watchlist: emAcompanhamento,
      criteriaAverages,
      evolucaoPorPeriodo,
    };

    await Cache.eduallSet(cacheKey, result, EVALUATION_CACHE_TTL);

    const duration = Date.now() - startTime;
    console.log(`🗄️🐢 BASE DE DADOS (lento) -> GetEvaluationsDashboard demorou ${duration}ms (${cacheKey})`);

    res.status(200).json(result);
  } catch (error) {
    res.status(500).json({ success: false, message: "Falha ao calcular estatísticas de avaliação!", error: error.message });
  }
};

/* ===================== POST OPERATIONS (COM VALIDAÇÃO E CACHE REFRESH) ===================== */

/**
 * POST — Registar nova avaliação pedagógica.
 * body.evaluation_status = 'Rascunho' | 'Concluída' controla se a validação
 * exige todos os critérios preenchidos e qual o estado final gravado.
 */
const RegisterEvaluation = async (req, res) => {
  try {
    const instituteCode = req.session.user.eduall_user_session_curentinstitute;
    const requestedStatus = req.body.evaluation_status === "Concluída" ? "Concluída" : "Rascunho";

    const errors = ValidateEvaluationFields(req.body, { requireComplete: requestedStatus === "Concluída" });
    if (errors.length > 0) return sendError(res, 422, errors.join(" "), errors);

    // Confirmar que o professor existe e obter dados para snapshot (disciplina/turma)
    const professorRows = await ExecuteQuery(
      res,
      `SELECT ed_employee_id, ed_employee_name FROM eduall_employees
       WHERE ed_employee_id = ? AND ed_employee_deleted = 0 AND ed_employee_institute_code = ?`,
      [req.body.evaluation_professor_code, instituteCode],
      true,
      { db: "eduall_employees", type: "select", data: req }
    );
    if (!professorRows || !professorRows.length) return sendError(res, 404, "Professor não encontrado.");

    const criterios = req.body.evaluation_criterios || {};
    const media = calculateAverage(criterios);
    const estadoFinal = resolveEstado(requestedStatus, media);
    const classificacao = getClassificationLabel(media);

    const avaliadorCode = req.body.evaluation_avaliador_code || req.session.user.eduall_user_session_ID || null;
    const avaliadorNome = req.body.evaluation_avaliador_nome || "Coordenador Pedagógico";

    const query = `
      INSERT INTO eduall_pedagogical_evaluations (
        ed_eval_professor_code,
        ed_eval_class_code,
        ed_eval_subject_code,
        ed_eval_disciplina,
        ed_eval_turma,
        ed_eval_periodo,
        ed_eval_data,
        ed_eval_avaliador_code,
        ed_eval_avaliador_nome,
        ed_eval_criterios,
        ed_eval_media,
        ed_eval_classificacao,
        ed_eval_pontos_fortes,
        ed_eval_areas_melhoria,
        ed_eval_observacoes,
        ed_eval_plano_melhoria,
        ed_eval_estado,
        ed_eval_institute_code
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;
    const PARAMS = [
      req.body.evaluation_professor_code,
      req.body.evaluation_class_code || null,
      req.body.evaluation_subject_code || null,
      req.body.evaluation_disciplina || null,
      req.body.evaluation_turma || null,
      req.body.evaluation_periodo,
      req.body.evaluation_data,
      avaliadorCode,
      avaliadorNome,
      JSON.stringify(criterios),
      media,
      classificacao,
      req.body.evaluation_pontos_fortes || null,
      req.body.evaluation_areas_melhoria || null,
      req.body.evaluation_observacoes || null,
      JSON.stringify(req.body.evaluation_plano_melhoria || []),
      estadoFinal,
      instituteCode,
    ];

    const rows = await ExecuteQuery(res, query, PARAMS, false, {
      db: "eduall_pedagogical_evaluations",
      type: "insert",
      data: req,
    });

    await RegisterAuditAction({
      session: req.session,
      action: 1,
      form: "Avaliação Pedagógica",
      description: `Registou avaliação (${estadoFinal}) do professor "${professorRows[0].ed_employee_name}" — ${req.body.evaluation_periodo}, média ${media}.`,
    });

    console.log(`🗄️🐢 BASE DE DADOS (lento) -> RegisterEvaluation: avaliação registada para professor ${req.body.evaluation_professor_code}`);
    await RefreshEvaluationCache(res, req, instituteCode);

    const insertedId = rows && rows.insertId ? rows.insertId : null;
    const fullEvaluation = insertedId ? await FetchSingleEvaluation(res, req, insertedId, instituteCode) : null;

    return sendOk(res, 201, {
      message: estadoFinal === "Rascunho" ? "Avaliação guardada como rascunho." : "Avaliação finalizada e registada no histórico.",
      data: fullEvaluation || rows,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: "Falha ao registar avaliação!", error: error.message });
  }
};

/* ===================== PUT OPERATIONS (COM VALIDAÇÃO E CACHE REFRESH) ===================== */

/**
 * PUT — Atualizar avaliação existente (edição de rascunho ou correção de avaliação concluída).
 */
const EvaluationUpdate = async (req, res) => {
  try {
    const { ID } = req.params;
    const instituteCode = req.session.user.eduall_user_session_curentinstitute;
    const requestedStatus = req.body.evaluation_status === "Concluída" ? "Concluída" : "Rascunho";

    const errors = ValidateEvaluationFields(req.body, { requireComplete: requestedStatus === "Concluída" });
    if (errors.length > 0) return sendError(res, 422, errors.join(" "), errors);

    const found = await ExecuteQuery(
      res,
      `SELECT ed_eval_id FROM eduall_pedagogical_evaluations
       WHERE ed_eval_deleted = 0 AND ed_eval_id = ? AND ed_eval_institute_code = ?`,
      [ID, instituteCode],
      true,
      { db: "eduall_pedagogical_evaluations", type: "select", data: req }
    );
    if (!found || !found.length) return sendError(res, 404, "Avaliação não encontrada ou já foi removida.");

    const criterios = req.body.evaluation_criterios || {};
    const media = calculateAverage(criterios);
    const estadoFinal = resolveEstado(requestedStatus, media);
    const classificacao = getClassificationLabel(media);

    const query = `
      UPDATE eduall_pedagogical_evaluations SET
        ed_eval_class_code     = ?,
        ed_eval_subject_code   = ?,
        ed_eval_disciplina     = ?,
        ed_eval_turma          = ?,
        ed_eval_periodo        = ?,
        ed_eval_data           = ?,
        ed_eval_criterios      = ?,
        ed_eval_media          = ?,
        ed_eval_classificacao  = ?,
        ed_eval_pontos_fortes  = ?,
        ed_eval_areas_melhoria = ?,
        ed_eval_observacoes    = ?,
        ed_eval_plano_melhoria = ?,
        ed_eval_estado         = ?
      WHERE ed_eval_deleted = 0
        AND ed_eval_id = ?
        AND ed_eval_institute_code = ?
    `;
    const PARAMS = [
      req.body.evaluation_class_code || null,
      req.body.evaluation_subject_code || null,
      req.body.evaluation_disciplina || null,
      req.body.evaluation_turma || null,
      req.body.evaluation_periodo,
      req.body.evaluation_data,
      JSON.stringify(criterios),
      media,
      classificacao,
      req.body.evaluation_pontos_fortes || null,
      req.body.evaluation_areas_melhoria || null,
      req.body.evaluation_observacoes || null,
      JSON.stringify(req.body.evaluation_plano_melhoria || []),
      estadoFinal,
      ID,
      instituteCode,
    ];

    await ExecuteQuery(res, query, PARAMS, false, {
      db: "eduall_pedagogical_evaluations",
      type: "update",
      data: req,
    });

    await RegisterAuditAction({
      session: req.session,
      action: 2,
      form: "Avaliação Pedagógica",
      description: `Atualizou avaliação (ID: ${ID}), novo estado "${estadoFinal}", média ${media}.`,
    });

    console.log(`🗄️🐢 BASE DE DADOS (lento) -> EvaluationUpdate: avaliação ${ID} atualizada`);
    await RefreshEvaluationCache(res, req, instituteCode);

    const fullEvaluation = await FetchSingleEvaluation(res, req, ID, instituteCode);

    return sendOk(res, 200, {
      message: "Avaliação atualizada com sucesso!",
      data: fullEvaluation,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: "Falha ao atualizar avaliação!", error: error.message });
  }
};

/* ===================== DELETE OPERATIONS (COM CACHE REFRESH) ===================== */

/**
 * DELETE (soft-delete) — Eliminar avaliação pedagógica
 */
const EvaluationDelete = async (req, res) => {
  try {
    const { ID } = req.params;
    const instituteCode = req.session.user.eduall_user_session_curentinstitute;

    const found = await ExecuteQuery(
      res,
      `SELECT ev.ed_eval_id, ev.ed_eval_periodo, prof.ed_employee_name
       FROM eduall_pedagogical_evaluations ev
       LEFT JOIN eduall_employees prof ON prof.ed_employee_id = ev.ed_eval_professor_code
       WHERE ev.ed_eval_deleted = 0 AND ev.ed_eval_id = ? AND ev.ed_eval_institute_code = ?`,
      [ID, instituteCode],
      true,
      { db: "eduall_pedagogical_evaluations", type: "select", data: req }
    );
    if (!found || !found.length) return sendError(res, 404, "Avaliação não encontrada ou já foi removida.");

    const query = `
      UPDATE eduall_pedagogical_evaluations
      SET ed_eval_deleted = 1
      WHERE ed_eval_deleted = 0
        AND ed_eval_id = ?
        AND ed_eval_institute_code = ?
    `;
    const rows = await ExecuteQuery(res, query, [ID, instituteCode], false, {
      db: "eduall_pedagogical_evaluations",
      type: "update",
      data: req,
    });

    await RegisterAuditAction({
      session: req.session,
      action: 3,
      form: "Avaliação Pedagógica",
      description: `Eliminou avaliação do professor "${found[0].ed_employee_name || "—"}" (${found[0].ed_eval_periodo}), ID: ${ID}.`,
    });

    console.log(`🗄️🐢 BASE DE DADOS (lento) -> EvaluationDelete: avaliação ${ID} eliminada`);
    await RefreshEvaluationCache(res, req, instituteCode);

    return sendOk(res, 200, { message: "Avaliação eliminada com sucesso!", data: rows });
  } catch (error) {
    res.status(500).json({ success: false, message: "Falha ao eliminar avaliação!", error: error.message });
  }
};

module.exports = {
  GetEvaluations,
  GetSingleEvaluation,
  GetEvaluationsByProfessor,
  GetEvaluationsByPeriod,
  GetEvaluationsDashboard,
  RegisterEvaluation,
  EvaluationUpdate,
  EvaluationDelete,
};



/*


// ── ROTAS DE AVALIAÇÃO PEDAGÓGICA ──────────────────────────────────────────

router.get("/eduallgetevaluations/get/", VerifyToken, GetEvaluations);
router.get("/eduallgetsingleevaluation/get/:ID", VerifyToken, GetSingleEvaluation);
router.get("/eduallevaluationbyprofessor/get/:CODE", VerifyToken, GetEvaluationsByProfessor);
router.get("/eduallevaluationbyperiod/get/:PERIODO", VerifyToken, GetEvaluationsByPeriod);
router.get("/eduallevaluationdashboard/get/", VerifyToken, GetEvaluationsDashboard);
router.post("/eduallregisterevaluation/post/", VerifyToken, RegisterEvaluation);
router.put("/eduallevaluationupdate/update/:ID", VerifyToken, EvaluationUpdate);
router.delete("/eduallevaluationdelete/delete/:ID", VerifyToken, EvaluationDelete);

*/