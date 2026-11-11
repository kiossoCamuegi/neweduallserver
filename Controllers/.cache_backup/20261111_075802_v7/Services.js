 const ExecuteQuery = require("../Functions/ExecuteQuery");
const { RegisterAuditAction } = require("./Auditory");
const Cache = require("../Functions/CacheRoutes");

const SERVICES_CACHE_TTL = 3600;

const CacheKeys = {
  list: (instituteCode, userId) => `services:list:${instituteCode}:${userId}`,
  single: (id, instituteCode, userId) => `services:single:${id}:${instituteCode}:${userId}`,
  allByInstitute: (instituteCode, userId) => `services:${instituteCode}:${userId}:*`,
};

// ---------------------------------------------------------------------------
// Log colorido de erros (para o console/servidor). Nunca é isto que vai
// para o cliente — serve só para quem está a olhar para os logs perceber
// rapidamente onde e porquê rebentou.
// ---------------------------------------------------------------------------
const LogError = (context, error) => {
  const red = "\x1b[31m";
  const bgRed = "\x1b[41m\x1b[37m";
  const yellow = "\x1b[33m";
  const reset = "\x1b[0m";

  console.error(`${bgRed} 🔴 ERRO [${context}] ${reset}`);
  console.error(`${red}Mensagem:${reset} ${error?.message || error}`);
  if (error?.code) console.error(`${yellow}Code:${reset} ${error.code}`);
  if (error?.sqlMessage) console.error(`${yellow}SQL Message:${reset} ${error.sqlMessage}`);
  if (error?.sql) console.error(`${yellow}SQL:${reset} ${error.sql}`);
  if (error?.stack) console.error(`${red}Stack:${reset}\n${error.stack}`);
};

// Mensagem genérica e amigável para devolver ao cliente, sem detalhes técnicos.
const FRIENDLY_ERROR = "Ocorreu um erro ao processar o pedido. Tente novamente ou contacte o suporte.";

const FetchServices = async (req, res, instituteCode) => {
  const query = `SELECT * FROM eduall_services  
    LEFT JOIN eduall_providers ON eduall_providers.ed_provider_id = eduall_services.ed_service_provider 
    LEFT JOIN eduall_coins ON eduall_coins.ed_coin_institute_code = ?
    WHERE ed_service_deleted = 0 AND ed_service_institute_code = ?  
    ORDER BY ed_service_title ASC`;

  const PARAMS = [instituteCode, instituteCode];
  return ExecuteQuery(res, query, PARAMS, true, {
    db: "eduall_services",
    type: "select",
    data: req,
  });
};

const RefreshServicesCache = async (req, res, instituteCode, userId) => {
  const startTime = Date.now();

  await Cache.eduallClear(CacheKeys.allByInstitute(instituteCode, userId));
  console.log(`📦🧹 CACHE -> limpa para institute ${instituteCode} | user ${userId} (Serviços)`);

  const rows = await FetchServices(req, res, instituteCode);
  await Cache.eduallSet(CacheKeys.list(instituteCode, userId), rows, SERVICES_CACHE_TTL);

  const duration = Date.now() - startTime;
  console.log(
    `🗄️🐢 BASE DE DADOS (lento) -> cache reposta em ${duration}ms para institute ${instituteCode} | user ${userId} (Serviços)`
  );

  return rows;
};

const GetServices = async (req, res) => {
  try {
    const instituteCode = req.session.user.eduall_user_session_curentinstitute;
    const userId = req.session.user.eduall_user_session_ID;
    const cacheKey = CacheKeys.list(instituteCode, userId);
    const startTime = Date.now();

    const cached = await Cache.eduallGet(cacheKey);
    if (cached !== null) {
      const duration = Date.now() - startTime;
      console.log(
        `📦⚡ CACHE (rápido) -> GetServices demorou ${duration}ms (${cacheKey})`
      );
      return res.status(200).json(cached);
    }

    const rows = await FetchServices(req, res, instituteCode);
    await Cache.eduallSet(cacheKey, rows, SERVICES_CACHE_TTL);

    const duration = Date.now() - startTime;
    console.log(
      `🗄️🐢 BASE DE DADOS (lento) -> GetServices demorou ${duration}ms (${cacheKey})`
    );

    res.status(200).json(rows);
  } catch (error) {
    LogError("GetServices", error);
    res.status(400).json({ success: false, msg: FRIENDLY_ERROR });
  }
};

const GetSingleService = async (req, res) => {
  try {
    const { ID } = req.params;
    const instituteCode = req.session.user.eduall_user_session_curentinstitute;
    const userId = req.session.user.eduall_user_session_ID;
    const cacheKey = CacheKeys.single(ID, instituteCode, userId);
    const startTime = Date.now();

    const cached = await Cache.eduallGet(cacheKey);
    if (cached !== null) {
      const duration = Date.now() - startTime;
      console.log(
        `📦⚡ CACHE (rápido) -> GetSingleService demorou ${duration}ms (${cacheKey})`
      );
      return res.status(200).json(cached);
    }

    const query = `SELECT * FROM eduall_services 
      LEFT JOIN eduall_coins ON eduall_coins.ed_coin_institute_code = ? 
      WHERE ed_service_deleted = 0 AND ed_service_id = ? AND ed_service_institute_code = ?`;

    const PARAMS = [instituteCode, ID, instituteCode];
    const rows = await ExecuteQuery(res, query, PARAMS, true, {
      db: "eduall_services",
      type: "select",
      data: req,
    });

    await Cache.eduallSet(cacheKey, rows, SERVICES_CACHE_TTL);

    console.log(rows.length > 0 ? rows[0] : "Nada foi encontrado !");

    const duration = Date.now() - startTime;
    console.log(
      `🗄️🐢 BASE DE DADOS (lento) -> GetSingleService demorou ${duration}ms (${cacheKey})`
    );

    res.status(200).json(rows);
  } catch (error) {
    LogError("GetSingleService", error);
    res.status(400).json({ success: false, msg: FRIENDLY_ERROR });
  }
};

const RegisterService = async (req, res) => {
  try {
    const instituteCode = req.session.user.eduall_user_session_curentinstitute;
    const userId = req.session.user.eduall_user_session_ID;

    // Fornecedor deixou de ser obrigatório: se não vier preenchido, grava-se null.
    const serviceProvider =
      req.body.service_provider === undefined ||
      req.body.service_provider === null ||
      req.body.service_provider === ""
        ? null
        : req.body.service_provider;

    const query = `INSERT INTO eduall_services 
      (ed_service_title, ed_service_type, ed_service_provider, ed_service_price, ed_service_iva, 
      ed_service_description, ed_service_coin, ed_service_is_matricula, ed_service_is_confirmation, ed_service_institute_code) 
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

    const PARAMS = [
      req.body.service_title,
      req.body.service_type,
      serviceProvider,
      req.body.service_price,
      req.body.service_iva,
      req.body.service_description,
      req.body.service_coin,
      req.body.service_is_matricula ? 1 : 0,
      req.body.service_is_confirmation ? 1 : 0,
      instituteCode,
    ];

    console.log("DADOS = ", PARAMS);

    await ExecuteQuery(res, query, PARAMS, false, {
      db: "eduall_services",
      type: "insert",
      data: req,
    });

    await RegisterAuditAction({
      session: req.session,
      action: 1,
      form: "Serviços",
      description: `Registrou o serviço (${req.body.service_title})`,
    });

    console.log(
      `🗄️🐢 BASE DE DADOS (lento) -> RegisterService: novo serviço gravado`
    );
    await RefreshServicesCache(req, res, instituteCode, userId);

    res.status(200).json({ success: true, msg: "Serviço registrado com sucesso!" });
  } catch (error) {
    LogError("RegisterService", error);
    res.status(400).json({ success: false, msg: "Não foi possível registrar o serviço. Tente novamente." });
  }
};

const ServiceDelete = async (req, res) => {
  try {
    const { ID } = req.params;
    const instituteCode = req.session.user.eduall_user_session_curentinstitute;
    const userId = req.session.user.eduall_user_session_ID;

    const query = `UPDATE eduall_services SET ed_service_deleted = 1 
      WHERE ed_service_deleted = 0 AND ed_service_id = ? AND ed_service_institute_code = ?`;

    const PARAMS = [ID, instituteCode];
    await ExecuteQuery(res, query, PARAMS, false, {
      db: "eduall_services",
      type: "update",
      data: req,
    });

    await RegisterAuditAction({
      session: req.session,
      action: 3,
      form: "Serviços",
      description: `Eliminou o serviço com ID ${ID}`,
    });

    console.log(`🗄️🐢 BASE DE DADOS (lento) -> ServiceDelete: registo ${ID} eliminado`);
    await RefreshServicesCache(req, res, instituteCode, userId);

    res.status(200).json({ success: true, msg: "Serviço excluído com sucesso!" });
  } catch (error) {
    LogError("ServiceDelete", error);
    res.status(400).json({ success: false, msg: "Não foi possível excluir o serviço. Tente novamente." });
  }
};

const ServiceUpdate = async (req, res) => {
  try {
    const { ID } = req.params;
    const {
      service_title,
      service_type,
      service_coin,
      service_iva,
      service_provider,
      service_price,
      service_description,
      service_is_matricula,
      service_is_confirmation,
    } = req.body;

    const instituteCode = req.session.user.eduall_user_session_curentinstitute;
    const userId = req.session.user.eduall_user_session_ID;

    // Fornecedor continua opcional na edição.
    const resolvedProvider =
      service_provider === undefined || service_provider === null || service_provider === ""
        ? null
        : service_provider;

    const query = `UPDATE eduall_services SET ed_service_title = ?, ed_service_type = ?, ed_service_provider = ?, ed_service_price = ?,
      ed_service_iva = ?, ed_service_coin = ?, ed_service_description = ?, ed_service_is_matricula = ?, ed_service_is_confirmation = ? 
      WHERE ed_service_deleted = 0 AND ed_service_id = ? AND ed_service_institute_code = ?`;

    const PARAMS = [
      service_title,
      service_type,
      resolvedProvider,
      service_price,
      service_iva,
      service_coin,
      service_description,
      service_is_matricula ? 1 : 0,
      service_is_confirmation ? 1 : 0,
      ID,
      instituteCode,
    ];

    await ExecuteQuery(res, query, PARAMS, false, {
      db: "eduall_services",
      type: "update",
      data: req,
    });

    await RegisterAuditAction({
      session: req.session,
      action: 2,
      form: "Serviços",
      description: `Atualizou o serviço (${service_title}) com ID ${ID}`,
    });

    console.log(
      `🗄️🐢 BASE DE DADOS (lento) -> ServiceUpdate: registo ${ID} atualizado`
    );
    await RefreshServicesCache(req, res, instituteCode, userId);

    res.status(200).json({ success: true, msg: "Serviço atualizado com sucesso!" });
  } catch (error) {
    LogError("ServiceUpdate", error);
    res.status(400).json({ success: false, msg: "Não foi possível atualizar o serviço. Tente novamente." });
  }
};

const ServiceUpdateDiscountData = async (req, res) => {
  try {
    const { ID } = req.params;
    const {
      discount_parents_childrens,
      discount_years_of_study,
      discount_for_scholarship_holders,
      discount_value,
    } = req.body;

    const instituteCode = req.session.user.eduall_user_session_curentinstitute;
    const userId = req.session.user.eduall_user_session_ID;

    const query = `UPDATE eduall_services SET ed_service_scholarshipHolder = ?, ed_service_guardionChildrens = ?,
      ed_service_studentInstitutePresence = ?, ed_service_discount = ? 
      WHERE ed_service_deleted = 0 AND ed_service_id = ? AND ed_service_institute_code = ?`;

    const PARAMS = [
      discount_for_scholarship_holders,
      discount_parents_childrens,
      discount_years_of_study,
      discount_value,
      ID,
      instituteCode,
    ];

    await ExecuteQuery(res, query, PARAMS, false, {
      db: "eduall_services",
      type: "update",
      data: req,
    });

    await RegisterAuditAction({
      session: req.session,
      action: 2,
      form: "Serviços",
      description: `Atualizou os dados de desconto do serviço com ID ${ID}`,
    });

    console.log(
      `🗄️🐢 BASE DE DADOS (lento) -> ServiceUpdateDiscountData: registo ${ID} atualizado`
    );
    await RefreshServicesCache(req, res, instituteCode, userId);

    res.status(200).json({
      success: true,
      msg: "Descontos do serviço atualizados com sucesso!",
    });
  } catch (error) {
    LogError("ServiceUpdateDiscountData", error);
    res.status(400).json({ success: false, msg: "Não foi possível atualizar os descontos do serviço. Tente novamente." });
  }
};

const ServiceUpdateMatriculaConfirmation = async (req, res) => {
  try {
    const { ID } = req.params;
    const { service_is_matricula, service_is_confirmation } = req.body;

    const instituteCode = req.session.user.eduall_user_session_curentinstitute;
    const userId = req.session.user.eduall_user_session_ID;

    const query = `UPDATE eduall_services SET ed_service_is_matricula = ?, ed_service_is_confirmation = ? 
      WHERE ed_service_deleted = 0 AND ed_service_id = ? AND ed_service_institute_code = ?`;

    const PARAMS = [
      service_is_matricula ? 1 : 0,
      service_is_confirmation ? 1 : 0,
      ID,
      instituteCode,
    ];

    await ExecuteQuery(res, query, PARAMS, false, {
      db: "eduall_services",
      type: "update",
      data: req,
    });

    await RegisterAuditAction({
      session: req.session,
      action: 2,
      form: "Serviços",
      description: `Atualizou os dados de matrícula/confirmação do serviço com ID ${ID} (Matrícula: ${service_is_matricula ? "Sim" : "Não"}, Confirmação: ${service_is_confirmation ? "Sim" : "Não"})`,
    });

    console.log(
      `🗄️🐢 BASE DE DADOS (lento) -> ServiceUpdateMatriculaConfirmation: registo ${ID} atualizado`
    );
    await RefreshServicesCache(req, res, instituteCode, userId);

    res.status(200).json({
      success: true,
      msg: "Dados de matrícula e confirmação do serviço atualizados com sucesso!",
    });
  } catch (error) {
    LogError("ServiceUpdateMatriculaConfirmation", error);
    res.status(400).json({ success: false, msg: "Não foi possível atualizar os dados de matrícula/confirmação. Tente novamente." });
  }
};

module.exports = {
  GetServices,
  GetSingleService,
  RegisterService,
  ServiceDelete,
  ServiceUpdate,
  ServiceUpdateDiscountData,
  ServiceUpdateMatriculaConfirmation,
};