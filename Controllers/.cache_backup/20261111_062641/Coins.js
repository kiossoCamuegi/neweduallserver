const ExecuteQuery = require("../Functions/ExecuteQuery");
const Cache = require("../Functions/CacheRoutes");
const { RegisterAuditAction } = require("./Auditory");

const COIN_CACHE_TTL = 3600;

const CacheKeys = {
  list: (instituteCode) => `coin:list:${instituteCode}`,
  single: (id, instituteCode) => `coin:single:${id}:${instituteCode}`,
  all: () => "coin:*",
};

// ─── Validações reutilizáveis ─────────────────────────────────────────────────
const ValidateCoinFields = (body) => {
  const errors = [];

  if (!body.coin_title || body.coin_title.trim() === "")
    errors.push("Título da moeda é obrigatório.");

  if (body.coin_title && body.coin_title.trim().length < 1)
    errors.push("Título da moeda deve ter pelo menos 1 carácter.");

  if (!body.coin_code || body.coin_code.trim() === "")
    errors.push("Código da moeda é obrigatório.");

  if (body.coin_code && body.coin_code.trim().length < 1)
    errors.push("Código da moeda deve ter pelo menos 1 carácter.");

  return errors;
};

// ─── Fetch base (sem cache) ────────────────────────────────────────────────────
const FetchCoins = async (req, res, instituteCode) => {
  const query = `
    SELECT * FROM eduall_coins
    WHERE ed_coin_deleted = 0
      AND ed_coin_institute_code = ?
  `;
  return ExecuteQuery(res, query, [instituteCode], true, {
    db: "eduall_coins",
    type: "select",
    data: req,
  });
};

// ─── Refrescar cache (limpa tudo e repõe a lista) ─────────────────────────────
const RefreshCoinCache = async (req, res, instituteCode) => {
  const startTime = Date.now();

  await Cache.eduallClear(CacheKeys.all());
  console.log(`📦🧹 CACHE -> limpa para institute ${instituteCode}`);

  const rows = await FetchCoins(req, res, instituteCode);
  await Cache.eduallSet(CacheKeys.list(instituteCode), rows, COIN_CACHE_TTL);

  const duration = Date.now() - startTime;
  console.log(`🗄️🐢 BASE DE DADOS (lento) -> cache reposta em ${duration}ms para institute ${instituteCode}`);

  return rows;
};

/* ===================== GET OPERATIONS (COM CACHE) ===================== */

/**
 * GET ALL — Listar todas as moedas
 */
const GetCoins = async (req, res) => {
  try {
    const instituteCode = req.session.user.eduall_user_session_curentinstitute;
    const cacheKey = CacheKeys.list(instituteCode);
    const startTime = Date.now();

    const cached = await Cache.eduallGet(cacheKey);
    if (cached !== null) {
      const duration = Date.now() - startTime;
      console.log(`📦⚡ CACHE (rápido) -> GetCoins demorou ${duration}ms (${cacheKey})`);
      return res.status(200).json(cached);
    }

    const rows = await FetchCoins(req, res, instituteCode);
    await Cache.eduallSet(cacheKey, rows, COIN_CACHE_TTL);

    const duration = Date.now() - startTime;
    console.log(`🗄️🐢 BASE DE DADOS (lento) -> GetCoins demorou ${duration}ms (${cacheKey})`);

    res.status(200).json(rows);
  } catch (error) {
    res
      .status(500)
      .json({
        success: false,
        message: "Falha ao buscar moedas!",
        error: error.message,
      });
  }
};

/**
 * GET SINGLE — Obter uma moeda individual
 */
const GetSingleCoin = async (req, res) => {
  try {
    const { ID } = req.params;
    const instituteCode = req.session.user.eduall_user_session_curentinstitute;
    const cacheKey = CacheKeys.single(ID, instituteCode);
    const startTime = Date.now();

    const cached = await Cache.eduallGet(cacheKey);
    if (cached !== null) {
      const duration = Date.now() - startTime;
      console.log(`📦⚡ CACHE (rápido) -> GetSingleCoin demorou ${duration}ms (${cacheKey})`);
      return res.status(200).json(cached);
    }

    const query = `
      SELECT * FROM eduall_coins
      WHERE ed_coin_deleted = 0
        AND ed_coin_id = ?
        AND ed_coin_institute_code = ?
    `;
    const PARAMS = [ID, instituteCode];
    const rows = await ExecuteQuery(res, query, PARAMS, true, {
      db: "eduall_coins",
      type: "select",
      data: req,
    });

    if (!rows || rows.length === 0)
      return res
        .status(404)
        .json({ success: false, message: "Moeda não encontrada." });

    await Cache.eduallSet(cacheKey, rows, COIN_CACHE_TTL);

    const duration = Date.now() - startTime;
    console.log(`🗄️🐢 BASE DE DADOS (lento) -> GetSingleCoin demorou ${duration}ms (${cacheKey})`);

    res.status(200).json(rows);
  } catch (error) {
    res
      .status(500)
      .json({
        success: false,
        message: "Falha ao buscar moeda!",
        error: error.message,
      });
  }
};

/* ===================== POST OPERATIONS (COM VALIDAÇÃO E CACHE REFRESH) ===================== */

/**
 * POST — Registar moeda (máximo 1 por instituto)
 */
const RegisterCoin = async (req, res) => {
  try {
    const { coin_title, coin_code, coin_iva } = req.body;
    const instituteCode = req.session.user.eduall_user_session_curentinstitute;

    // Validações
    const errors = ValidateCoinFields(req.body);
    if (errors.length > 0)
      return res.status(422).json({ success: false, msg: errors.join(" "), errors });

    // Verificar se já existe uma moeda registrada para este instituto
    const checkQuery = `
      SELECT COUNT(*) AS count FROM eduall_coins
      WHERE ed_coin_institute_code = ?
        AND ed_coin_deleted = 0
    `;
    const checkRows = await ExecuteQuery(
      res,
      checkQuery,
      [instituteCode],
      true,
      { db: "eduall_coins", type: "select", data: req }
    );

    if ((checkRows[0]?.count || 0) > 0) {
      return res.status(409).json({
        success: false,
        msg: "A instituição já tem uma moeda registada. Apenas uma moeda por instituto é permitida.",
      });
    }

    const query = `
      INSERT INTO eduall_coins (
        ed_coin_title,
        ed_coin_code,
        ed_coin_institute_code
      ) VALUES (?, ?, ?)
    `;
    const PARAMS = [coin_title.trim(), coin_code.trim(), instituteCode];

    const rows = await ExecuteQuery(res, query, PARAMS, false, {
      db: "eduall_coins",
      type: "insert",
      data: req,
    });

    await RegisterAuditAction({
      session: req.session,
      action: 1,
      form: "Moedas",
      description: `Registrou moeda (${coin_title.trim()}) com código ${coin_code.trim()}`,
    });

    console.log(
      `🗄️🐢 BASE DE DADOS (lento) -> RegisterCoin: moeda "${coin_title.trim()}" registada`
    );
    await RefreshCoinCache(req, res, instituteCode);

    res
      .status(200)
      .json({ success: true, message: "Moeda registada com sucesso!", data: rows });
  } catch (error) {
    res
      .status(500)
      .json({
        success: false,
        message: "Falha ao registar moeda!",
        error: error.message,
      });
  }
};

/* ===================== PUT OPERATIONS (COM VALIDAÇÃO E CACHE REFRESH) ===================== */

/**
 * PUT — Atualizar moeda
 */
const CoinUpdate = async (req, res) => {
  try {
    const { ID } = req.params;
    const { coin_title, coin_code } = req.body;
    const instituteCode = req.session.user.eduall_user_session_curentinstitute;

    // Validações
    const errors = ValidateCoinFields(req.body);
    if (errors.length > 0)
      return res.status(422).json({ success: false, msg: errors.join(" "), errors });

    // Confirmar que a moeda existe
    const checkExistQuery = `
      SELECT ed_coin_id FROM eduall_coins
      WHERE ed_coin_deleted = 0
        AND ed_coin_id = ?
        AND ed_coin_institute_code = ?
    `;
    const found = await ExecuteQuery(res, checkExistQuery, [ID, instituteCode], true, {
      db: "eduall_coins",
      type: "select",
      data: req,
    });

    if (!found || found.length === 0)
      return res
        .status(404)
        .json({
          success: false,
          msg: "Moeda não encontrada ou já foi removida.",
        });

    const query = `
      UPDATE eduall_coins
      SET ed_coin_title = ?, ed_coin_code = ?
      WHERE ed_coin_deleted = 0
        AND ed_coin_id = ?
        AND ed_coin_institute_code = ?
    `;
    const PARAMS = [coin_title.trim(), coin_code.trim(), ID, instituteCode];

    const rows = await ExecuteQuery(res, query, PARAMS, false, {
      db: "eduall_coins",
      type: "update",
      data: req,
    });

    // Auditoria
    await RegisterAuditAction({
      session: req.session,
      action: 2,
      form: "Moedas",
      description: `Atualizou moeda (${coin_title.trim()}) com código ${coin_code.trim()} e ID ${ID}`,
    });

    console.log(`🗄️🐢 BASE DE DADOS (lento) -> CoinUpdate: moeda ${ID} atualizada`);
    await RefreshCoinCache(req, res, instituteCode);

    res
      .status(200)
      .json({ success: true, message: "Moeda atualizada com sucesso!", data: rows });
  } catch (error) {
    res
      .status(500)
      .json({
        success: false,
        message: "Falha ao atualizar moeda!",
        error: error.message,
      });
  }
};

/* ===================== DELETE OPERATIONS (COM CACHE REFRESH) ===================== */

/**
 * DELETE (soft-delete) — Eliminar moeda
 */
const CoinDelete = async (req, res) => {
  try {
    const { ID } = req.params;
    const instituteCode = req.session.user.eduall_user_session_curentinstitute;

    // Confirmar existência antes de apagar
    const checkQuery = `
      SELECT ed_coin_title FROM eduall_coins
      WHERE ed_coin_deleted = 0
        AND ed_coin_id = ?
        AND ed_coin_institute_code = ?
    `;
    const found = await ExecuteQuery(res, checkQuery, [ID, instituteCode], true, {
      db: "eduall_coins",
      type: "select",
      data: req,
    });

    if (!found || found.length === 0)
      return res
        .status(404)
        .json({
          success: false,
          msg: "Moeda não encontrada ou já foi removida.",
        });

    const coinTitle = found[0].ed_coin_title;

    const query = `
      UPDATE eduall_coins
      SET ed_coin_deleted = 1
      WHERE ed_coin_deleted = 0
        AND ed_coin_id = ?
        AND ed_coin_institute_code = ?
    `;
    const PARAMS = [ID, instituteCode];

    const rows = await ExecuteQuery(res, query, PARAMS, false, {
      db: "eduall_coins",
      type: "update",
      data: req,
    });

    // Auditoria
    await RegisterAuditAction({
      session: req.session,
      action: 3,
      form: "Moedas",
      description: `Eliminou moeda "${coinTitle}" (ID: ${ID})`,
    });

    console.log(`🗄️🐢 BASE DE DADOS (lento) -> CoinDelete: moeda ${ID} eliminada`);
    await RefreshCoinCache(req, res, instituteCode);

    res
      .status(200)
      .json({ success: true, message: "Moeda eliminada com sucesso!", data: rows });
  } catch (error) {
    res
      .status(500)
      .json({
        success: false,
        message: "Falha ao eliminar moeda!",
        error: error.message,
      });
  }
};

module.exports = { GetCoins, GetSingleCoin, CoinUpdate, RegisterCoin, CoinDelete };