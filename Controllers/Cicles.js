const ExecuteQuery = require("../Functions/ExecuteQuery");
const Cache = require("../Functions/CacheRoutes");
const { RegisterAuditAction } = require("./Auditory");

const CICLE_CACHE_TTL = 3600;

const CacheKeys = {
  list: (instituteCode) => `cicle:list:${instituteCode}`,
  single: (id, instituteCode) => `cicle:single:${id}:${instituteCode}`,
  all: () => "cicle:*",
};

// ─── Fetch base (sem cache) ────────────────────────────────────────────────────
const FetchCicles = async (req, res, instituteCode) => {
  const query = `
    SELECT * FROM eduall_cicles
    WHERE ed_cicle_deleted = 0
      AND ed_cicle_institute_code = ?
    ORDER BY ed_cicle_title ASC
  `;
  return ExecuteQuery(res, query, [instituteCode], true, {
    db: "eduall_cicles",
    type: "select",
    data: req,
  });
};

// ─── Refrescar cache (limpa tudo e repõe a lista) ─────────────────────────────
const RefreshCicleCache = async (req, res, instituteCode) => {
  const startTime = Date.now();

  await Cache.eduallClear(CacheKeys.all());
  console.log(`📦🧹 CACHE -> limpa para institute ${instituteCode}`);

  const rows = await FetchCicles(req, res, instituteCode);
  await Cache.eduallSet(CacheKeys.list(instituteCode), rows, CICLE_CACHE_TTL);

  const duration = Date.now() - startTime;
  console.log(`🗄️🐢 BASE DE DADOS (lento) -> cache reposta em ${duration}ms para institute ${instituteCode}`);

  return rows;
};

// ─── Validações reutilizáveis ─────────────────────────────────────────────────
const ValidateCicleFields = (body) => {
  const errors = [];

  if (!body.cicle_title || body.cicle_title.trim() === "")
    errors.push("Título do ciclo é obrigatório.");

  if (body.cicle_title && body.cicle_title.trim().length < 2)
    errors.push("Título do ciclo deve ter pelo menos 2 caracteres.");

  if (!body.cicle_code || body.cicle_code.trim() === "")
    errors.push("Código do ciclo é obrigatório.");

  return errors;
};

// ─── GET todos os ciclos ──────────────────────────────────────────────────────
const GetCicles = async (req, res) => {
  try {
    const instituteCode = req.session.user.eduall_user_session_curentinstitute;
    const cacheKey = CacheKeys.list(instituteCode);
    const startTime = Date.now();

    const cached = await Cache.eduallGet(cacheKey);
    if (cached !== null) {
      const duration = Date.now() - startTime;
      console.log(`📦⚡ CACHE (rápido) -> GetCicles demorou ${duration}ms (${cacheKey})`);
      return res.status(200).json(cached);
    }

    const rows = await FetchCicles(req, res, instituteCode);
    await Cache.eduallSet(cacheKey, rows, CICLE_CACHE_TTL);

    const duration = Date.now() - startTime;
    console.log(`🗄️🐢 BASE DE DADOS (lento) -> GetCicles demorou ${duration}ms (${cacheKey})`);

    res.status(200).json(rows);
  } catch (error) {
    res
      .status(500)
      .json({ success: false, message: "Falha ao buscar ciclos!", error: error.message });
  }
};

// ─── GET ciclo individual ─────────────────────────────────────────────────────
const GetSingleCicle = async (req, res) => {
  try {
    const { ID } = req.params;
    const instituteCode = req.session.user.eduall_user_session_curentinstitute;
    const cacheKey = CacheKeys.single(ID, instituteCode);
    const startTime = Date.now();

    const cached = await Cache.eduallGet(cacheKey);
    if (cached !== null) {
      const duration = Date.now() - startTime;
      console.log(`📦⚡ CACHE (rápido) -> GetSingleCicle demorou ${duration}ms (${cacheKey})`);
      return res.status(200).json(cached);
    }

    const query = `
      SELECT * FROM eduall_cicles
      WHERE ed_cicle_deleted = 0
        AND ed_cicle_id = ?
        AND ed_cicle_institute_code = ?
    `;
    const PARAMS = [ID, instituteCode];
    const rows = await ExecuteQuery(res, query, PARAMS, true, {
      db: "eduall_cicles",
      type: "select",
      data: req,
    });

    if (!rows || rows.length === 0)
      return res.status(404).json({ success: false, message: "Ciclo não encontrado." });

    await Cache.eduallSet(cacheKey, rows, CICLE_CACHE_TTL);

    const duration = Date.now() - startTime;
    console.log(`🗄️🐢 BASE DE DADOS (lento) -> GetSingleCicle demorou ${duration}ms (${cacheKey})`);

    res.status(200).json(rows);
  } catch (error) {
    res
      .status(500)
      .json({ success: false, message: "Falha ao buscar ciclo!", error: error.message });
  }
};

// ─── POST registar ciclo ──────────────────────────────────────────────────────
const RegisterCicle = async (req, res) => {
  try {
    const { cicle_title, cicle_code } = req.body;

    // Validações
    const errors = ValidateCicleFields(req.body);
    if (errors.length > 0)
      return res.status(422).json({ success: false, msg: errors.join(" "), errors });

    const instituteCode = req.session.user.eduall_user_session_curentinstitute;

    // Verificar se já existe um ciclo com o mesmo nome (ignorar espaços e case)
    const checkQuery = `
      SELECT ed_cicle_id FROM eduall_cicles
      WHERE REPLACE(LOWER(TRIM(ed_cicle_title)), ' ', '') = REPLACE(LOWER(TRIM(?)), ' ', '')
        AND ed_cicle_institute_code = ?
        AND ed_cicle_deleted = 0
    `;
    const existing = await ExecuteQuery(
      res,
      checkQuery,
      [cicle_title.trim(), instituteCode],
      true,
      { db: "eduall_cicles", type: "select", data: req }
    );

    if (existing && existing.length > 0)
      return res.status(409).json({
        success: false,
        msg: "Já existe um ciclo com este nome (verifique espaços ou letras maiúsculas/minúsculas).",
      });

    // Inserir novo ciclo
    const query = `
      INSERT INTO eduall_cicles (ed_cicle_title, ed_cicle_code, ed_cicle_institute_code)
      VALUES (?, ?, ?)
    `;
    const PARAMS = [cicle_title.trim(), cicle_code.trim(), instituteCode];

    const rows = await ExecuteQuery(res, query, PARAMS, false, {
      db: "eduall_cicles",
      type: "insert",
      data: req,
    });

    // Auditoria
    await RegisterAuditAction({
      session: req.session,
      action: 1,
      form: "Ciclos",
      description: `Registrou novo ciclo (${cicle_title.trim()}) com código ${cicle_code.trim()}`,
    });

    console.log(
      `🗄️🐢 BASE DE DADOS (lento) -> RegisterCicle: ciclo "${cicle_title.trim()}" registado`
    );
    await RefreshCicleCache(req, res, instituteCode);

    res
      .status(200)
      .json({ success: true, message: "Ciclo registado com sucesso!", data: rows });
  } catch (error) {
    res
      .status(500)
      .json({
        success: false,
        message: "Erro ao registar ciclo!",
        error: error.message,
      });
  }
};

// ─── PUT atualizar ciclo ──────────────────────────────────────────────────────
const CicleUpdate = async (req, res) => {
  try {
    const { ID } = req.params;
    const { cicle_title, cicle_code } = req.body;

    // Validações
    const errors = ValidateCicleFields(req.body);
    if (errors.length > 0)
      return res.status(422).json({ success: false, msg: errors.join(" "), errors });

    const instituteCode = req.session.user.eduall_user_session_curentinstitute;

    // Confirmar que o ciclo existe
    const checkExistQuery = `
      SELECT ed_cicle_id FROM eduall_cicles
      WHERE ed_cicle_deleted = 0
        AND ed_cicle_id = ?
        AND ed_cicle_institute_code = ?
    `;
    const found = await ExecuteQuery(res, checkExistQuery, [ID, instituteCode], true, {
      db: "eduall_cicles",
      type: "select",
      data: req,
    });
    if (!found || found.length === 0)
      return res
        .status(404)
        .json({ success: false, msg: "Ciclo não encontrado ou já foi removido." });

    // Verificar se já existe outro ciclo com o mesmo nome (ignorar espaços e case, excluindo o próprio)
    const checkQuery = `
      SELECT ed_cicle_id FROM eduall_cicles
      WHERE REPLACE(LOWER(TRIM(ed_cicle_title)), ' ', '') = REPLACE(LOWER(TRIM(?)), ' ', '')
        AND ed_cicle_institute_code = ?
        AND ed_cicle_deleted = 0
        AND ed_cicle_id != ?
    `;
    const existing = await ExecuteQuery(
      res,
      checkQuery,
      [cicle_title.trim(), instituteCode, ID],
      true,
      { db: "eduall_cicles", type: "select", data: req }
    );

    if (existing && existing.length > 0)
      return res.status(409).json({
        success: false,
        msg: "Já existe outro ciclo com este nome (verifique espaços ou letras maiúsculas/minúsculas).",
      });

    // Atualizar ciclo
    const query = `
      UPDATE eduall_cicles
      SET ed_cicle_title = ?, ed_cicle_code = ?
      WHERE ed_cicle_deleted = 0
        AND ed_cicle_id = ?
        AND ed_cicle_institute_code = ?
    `;
    const PARAMS = [cicle_title.trim(), cicle_code.trim(), ID, instituteCode];

    const rows = await ExecuteQuery(res, query, PARAMS, false, {
      db: "eduall_cicles",
      type: "update",
      data: req,
    });

    // Auditoria
    await RegisterAuditAction({
      session: req.session,
      action: 2,
      form: "Ciclos",
      description: `Atualizou ciclo (${cicle_title.trim()}) com código ${cicle_code.trim()} e ID ${ID}`,
    });

    console.log(`🗄️🐢 BASE DE DADOS (lento) -> CicleUpdate: ciclo ${ID} atualizado`);
    await RefreshCicleCache(req, res, instituteCode);

    res
      .status(200)
      .json({ success: true, message: "Ciclo atualizado com sucesso!", data: rows });
  } catch (error) {
    res
      .status(500)
      .json({
        success: false,
        msg: "Falha ao atualizar ciclo!",
        error: error.message,
      });
  }
};

// ─── DELETE (soft-delete) ciclo ────────────────────────────────────────────────
const CicleDelete = async (req, res) => {
  try {
    const { ID } = req.params;
    const instituteCode = req.session.user.eduall_user_session_curentinstitute;

    // Confirmar existência antes de apagar
    const checkQuery = `
      SELECT ed_cicle_title FROM eduall_cicles
      WHERE ed_cicle_deleted = 0
        AND ed_cicle_id = ?
        AND ed_cicle_institute_code = ?
    `;
    const found = await ExecuteQuery(res, checkQuery, [ID, instituteCode], true, {
      db: "eduall_cicles",
      type: "select",
      data: req,
    });
    if (!found || found.length === 0)
      return res
        .status(404)
        .json({
          success: false,
          msg: "Ciclo não encontrado ou já foi removido.",
        });

    const cicleTitle = found[0].ed_cicle_title;

    // Verificar se há classes associadas
    const checkClassesQuery = `
      SELECT COUNT(*) AS total FROM eduall_class
      WHERE ed_class_cicle = ?
        AND ed_class_institute_code = ?
        AND ed_class_deleted = 0
    `;
    const classCheckResult = await ExecuteQuery(
      res,
      checkClassesQuery,
      [ID, instituteCode],
      true,
      { db: "eduall_class", type: "select", data: req }
    );

    const classCount = classCheckResult[0]?.total || 0;

    if (classCount > 0)
      return res.status(400).json({
        success: false,
        msg: `Não é possível eliminar. Existem ${classCount} turma(s) ainda associada(s) a este ciclo.`,
      });

    // Soft delete
    const query = `
      UPDATE eduall_cicles
      SET ed_cicle_deleted = 1
      WHERE ed_cicle_deleted = 0
        AND ed_cicle_id = ?
        AND ed_cicle_institute_code = ?
    `;
    const PARAMS = [ID, instituteCode];

    const rows = await ExecuteQuery(res, query, PARAMS, false, {
      db: "eduall_cicles",
      type: "update",
      data: req,
    });

    // Auditoria
    await RegisterAuditAction({
      session: req.session,
      action: 3,
      form: "Ciclos",
      description: `Eliminou ciclo "${cicleTitle}" (ID: ${ID})`,
    });

    console.log(`🗄️🐢 BASE DE DADOS (lento) -> CicleDelete: ciclo ${ID} eliminado`);
    await RefreshCicleCache(req, res, instituteCode);

    res
      .status(200)
      .json({ success: true, message: "Ciclo eliminado com sucesso!", data: rows });
  } catch (error) {
    res
      .status(500)
      .json({
        success: false,
        msg: "Falha ao eliminar ciclo!",
        error: error.message,
      });
  }
};

module.exports = { GetCicles, GetSingleCicle, RegisterCicle, CicleDelete, CicleUpdate };
 