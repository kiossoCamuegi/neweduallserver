const bcrypt = require("bcryptjs");
const ExecuteQuery = require("../Functions/ExecuteQuery");
const { RegisterAuditAction } = require("./Auditory");

const BCRYPT_ROUNDS = 12;
const CODE_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$";

// ─── Apps internas disponíveis ────────────────────────────────────────────────
const INTERNAL_APPS = {
  library:  { id: "library",  label: "Biblioteca",       route: "/libraryapp/dashboard",  licenceType: 10 },
  hr:       { id: "hr",       label: "Recursos Humanos", route: "/hr/home",               licenceType: 11 },
  principal_portal: { id: "principal_portal", label: "Portal da Direção", route: "/principal-portal", licenceType: 13 },
  security: { id: "security", label: "Segurança / CCTV", route: "/monitoring_dashboard",  licenceType: 12 },
};

const VALID_APP_TYPES     = Object.keys(INTERNAL_APPS);
const VALID_ACCOUNT_TYPES = ["teacher", "user", "dashboard", "user_dashboard", "user_dashboard_teacher"];
const LIBRARY_ACCOUNT_TYPES = ["admin", "reader"];
const DEFAULT_APP_END_DATE = "2099-12-31 23:59:59";

const ensureDefaultInstituteApps = async (instituteCode, req, res) => {
  for (const appType of VALID_APP_TYPES) {
    const existing = await ExecuteQuery(
      res,
      `SELECT ed_institute_app_id FROM eduall_institute_apps
       WHERE ed_institute_app_instituteCode = ?
         AND ed_institute_app_type = ?
       ORDER BY ed_institute_app_id DESC LIMIT 1`,
      [instituteCode, appType],
      true,
      { db: "eduall_institute_apps", type: "select", data: req }
    );

    if (existing?.length) {
      await ExecuteQuery(
        res,
        `UPDATE eduall_institute_apps
         SET ed_institute_app_startDate = COALESCE(ed_institute_app_startDate, NOW()),
             ed_institute_app_endDate = ?,
             ed_institute_app_deleted = 0
         WHERE ed_institute_app_id = ?`,
        [DEFAULT_APP_END_DATE, existing[0].ed_institute_app_id],
        false,
        { db: "eduall_institute_apps", type: "update", data: req }
      );
    } else {
      await ExecuteQuery(
        res,
        `INSERT INTO eduall_institute_apps
          (ed_institute_app_instituteCode, ed_institute_app_type, ed_institute_app_startDate, ed_institute_app_endDate, ed_institute_app_deleted)
         VALUES (?, ?, NOW(), ?, 0)`,
        [instituteCode, appType, DEFAULT_APP_END_DATE],
        false,
        { db: "eduall_institute_apps", type: "insert", data: req }
      );
    }
  }
};

// ─── Logger colorido ──────────────────────────────────────────────────────────
const C = {
  reset:   "\x1b[0m",
  bold:    "\x1b[1m",
  dim:     "\x1b[2m",
  red:     "\x1b[31m",
  green:   "\x1b[32m",
  yellow:  "\x1b[33m",
  blue:    "\x1b[34m",
  magenta: "\x1b[35m",
  cyan:    "\x1b[36m",
  white:   "\x1b[37m",
  bgRed:   "\x1b[41m",
  bgGreen: "\x1b[42m",
  bgBlue:  "\x1b[44m",
  bgYellow:"\x1b[43m",
};

const LINE  = "─".repeat(60);
const LINE2 = "═".repeat(60);

const log = {
  section: (title) => {
    console.log(`\n${C.bold}${C.cyan}${LINE2}${C.reset}`);
    console.log(`${C.bold}${C.cyan}  ▶  ${title.toUpperCase()}${C.reset}`);
    console.log(`${C.bold}${C.cyan}${LINE2}${C.reset}`);
  },
  step: (label, value) => {
    const val = typeof value === "object" ? JSON.stringify(value, null, 2) : String(value ?? "—");
    console.log(`${C.bold}${C.blue}  ┃ ${C.reset}${C.yellow}${label}:${C.reset} ${C.white}${val}${C.reset}`);
  },
  ok: (msg) => {
    console.log(`${C.bold}${C.green}  ✔  ${msg}${C.reset}`);
  },
  warn: (msg) => {
    console.log(`${C.bold}${C.yellow}  ⚠  ${msg}${C.reset}`);
  },
  error: (msg, detail) => {
    console.log(`${C.bold}${C.red}  ✖  ${msg}${C.reset}`);
    if (detail) console.log(`${C.dim}${C.red}     ${String(detail)}${C.reset}`);
  },
  result: (label, data) => {
    console.log(`\n${C.bold}${C.magenta}  ◆ ${label}${C.reset}`);
    console.log(`${C.dim}${JSON.stringify(data, null, 4)}${C.reset}`);
  },
  divider: () => console.log(`${C.dim}${C.blue}  ${LINE}${C.reset}`),
  banner: (text, type = "info") => {
    const color = type === "success" ? C.bgGreen : type === "error" ? C.bgRed : type === "warn" ? C.bgYellow : C.bgBlue;
    console.log(`\n${color}${C.bold}  ${text.padEnd(58)}  ${C.reset}\n`);
  },
};

// ─── Utilitários ──────────────────────────────────────────────────────────────

const generatePassword = (len = 12) =>
  Array.from({ length: len }, () =>
    CODE_ALPHABET.charAt(Math.floor(Math.random() * CODE_ALPHABET.length))
  ).join("");

const removeAccents = (str) =>
  str.normalize("NFD").replace(/[\u0300-\u036f]/g, "");

const generateUsername = async (employeeName) => {
  const clean = removeAccents((employeeName || "user").toLowerCase().replace(/[^a-z\s]/g, "").trim());
  const parts = clean.split(/\s+/);
  let base = parts[0] || "user";
  if (parts.length > 1) {
    const last = parts[parts.length - 1];
    base += last.length <= 7 ? last : last.substring(0, 5);
  }
  base = base.substring(0, 12);

  let username = base;
  let counter  = Math.floor(Math.random() * 100);
  let exists   = true;

  while (exists) {
    const rows = await ExecuteQuery(
      null,
      `SELECT COUNT(*) AS count FROM eduall_system_accounts
       WHERE ed_system_account_deleted = 0 AND ed_system_account_name = ?`,
      [username],
      true,
      { db: "eduall_system_accounts", type: "select" }
    );
    if ((rows[0]?.count ?? 1) === 0) {
      exists = false;
    } else {
      username = `${base}${counter++}`;
    }
  }
  return username;
};

// ─── Sub-rotinas ──────────────────────────────────────────────────────────────

const ensureEduallAccount = async (email, name, country = "ao", req, res) => {
  // Validar nome
  const nameTrimmed = (name || '').trim();
  if (!nameTrimmed || nameTrimmed.length < 3) {
    throw new Error('Nome inválido — mínimo 3 caracteres após trim.');
  }

  // Validar email
  const emailTrimmed = (email || '').trim().toLowerCase();
  if (!emailTrimmed || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailTrimmed)) {
    throw new Error('Email inválido.');
  }

  const existing = await ExecuteQuery(
    res,
    `SELECT ed_user_account_id FROM eduall_user_accounts
     WHERE ed_user_account_deleted = 0 AND ed_user_account_email = ? LIMIT 1`,
    [emailTrimmed],
    true,
    { db: "eduall_user_accounts", type: "select", data: req }
  );

  if (existing?.length) {
    return { userId: existing[0].ed_user_account_id, userAlreadyExisted: true, password: null };
  }

  const password     = generatePassword(12);
  const salt         = await bcrypt.genSalt(BCRYPT_ROUNDS);
  const hashPassword = await bcrypt.hash(password, salt);

  await ExecuteQuery(
    res,
    `INSERT INTO eduall_user_accounts
       (ed_user_account_name, ed_user_account_email, ed_user_account_password,
        ed_user_account_country, ed_user_account_status)
     VALUES (?, ?, ?, ?, 1)`,
    [nameTrimmed, emailTrimmed, hashPassword, country],
    false,
    { db: "eduall_user_accounts", type: "insert", data: req }
  );

  const newUser = await ExecuteQuery(
    res,
    `SELECT ed_user_account_id FROM eduall_user_accounts
     WHERE ed_user_account_deleted = 0 AND ed_user_account_email = ? LIMIT 1`,
    [emailTrimmed],
    true,
    { db: "eduall_user_accounts", type: "select", data: req }
  );

  if (newUser?.[0]) {
    await ExecuteQuery(
      res,
      `INSERT INTO eduall_user_account_details (ed_user_account_detUSERID) VALUES (?)`,
      [newUser[0].ed_user_account_id],
      false,
      { db: "eduall_user_account_details", type: "insert", data: req }
    );
  }

  return { userId: newUser?.[0]?.ed_user_account_id, userAlreadyExisted: false, password };
};

const ensureTeacherAccount = async (userId, employeeId, instituteCode, req, res) => {
  const existing = await ExecuteQuery(
    res,
    `SELECT ed_user_institute_id FROM eduall_user_institutes
     WHERE ed_user_institute_employeeCode = ?
       AND ed_user_institute_code = ?
       AND ed_user_institute_deleted = 0 LIMIT 1`,
    [employeeId, instituteCode],
    true,
    { db: "eduall_user_institutes", type: "select", data: req }
  );
  if (existing?.length) return;

  await ExecuteQuery(
    res,
    `INSERT INTO eduall_user_institutes
       (ed_user_institute_code, ed_user_institute_employeeCode,
        ed_user_institute_userCode, ed_user_institute_deleted, ed_user_institute_registerDate)
     VALUES (?, ?, ?, 0, NOW())`,
    [instituteCode, employeeId, userId],
    false,
    { db: "eduall_user_institutes", type: "insert", data: req }
  );
};

const ensureDashboardAccount = async (userId, employeeId, employeeName, instituteCode, accessMap, req, res) => {
  const existing = await ExecuteQuery(
    res,
    `SELECT ed_system_account_id, ed_system_account_name
     FROM eduall_system_accounts
     WHERE ed_system_account_employee = ?
       AND ed_system_account_institute_code = ?
       AND ed_system_account_app_type IS NULL
       AND ed_system_account_deleted = 0 LIMIT 1`,
    [employeeId, instituteCode],
    true,
    { db: "eduall_system_accounts", type: "select", data: req }
  );

  if (existing?.length) {
    const accId = existing[0].ed_system_account_id;
    await ExecuteQuery(
      res,
      `UPDATE eduall_user_access SET
         ed_user_access_myinstitute      = ?,
         ed_user_access_secretary        = ?,
         ed_user_access_administration   = ?,
         ed_user_access_finances         = ?,
         ed_user_access_pedagogicalarea  = ?,
         ed_user_access_transportation   = ?,
         ed_user_access_library          = ?,
         ed_user_access_system           = ?,
         ed_user_access_configuration    = ?,
         ed_user_access_portal           = ?
       WHERE ed_user_access_usercode = ?`,
      [...Object.values(accessMap), accId],
      false,
      { db: "eduall_user_access", type: "update", data: req }
    );
    return { username: existing[0].ed_system_account_name, accountId: accId, alreadyExisted: true };
  }

  const username = await generateUsername(employeeName);

  await ExecuteQuery(
    res,
    `INSERT INTO eduall_system_accounts
       (ed_system_account_name, ed_system_account_employee,
        ed_system_account_userid, ed_system_account_institute_code)
     VALUES (?, ?, ?, ?)`,
    [username, employeeId, userId, instituteCode],
    false,
    { db: "eduall_system_accounts", type: "insert", data: req }
  );

  const newAcc = await ExecuteQuery(
    res,
    `SELECT ed_system_account_id FROM eduall_system_accounts
     WHERE ed_system_account_name = ? AND ed_system_account_employee = ?
       AND ed_system_account_app_type IS NULL LIMIT 1`,
    [username, employeeId],
    true,
    { db: "eduall_system_accounts", type: "select", data: req }
  );

  const accId = newAcc?.[0]?.ed_system_account_id;
  if (!accId) throw new Error("Erro ao recuperar ID da conta de dashboard.");

  await ExecuteQuery(
    res,
    `INSERT INTO eduall_user_access
       (ed_user_access_usercode,
        ed_user_access_myinstitute, ed_user_access_secretary, ed_user_access_administration,
        ed_user_access_finances, ed_user_access_pedagogicalarea, ed_user_access_transportation,
        ed_user_access_library, ed_user_access_system, ed_user_access_configuration,
        ed_user_access_portal, ed_user_access_institute_code)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    [accId, ...Object.values(accessMap), instituteCode],
    false,
    { db: "eduall_user_access", type: "insert", data: req }
  );

  return { username, accountId: accId, alreadyExisted: false };
};

// ─── ensureAppAccount — com logging completo ──────────────────────────────────
const ensureAppAccount = async (userId, employeeId, employeeName, instituteCode, appType, req, res, libraryMenuAccess = null) => {
  const appMeta = INTERNAL_APPS[appType];

  await ensureDefaultInstituteApps(instituteCode, req, res);

  log.section(`ATRIBUIR APP — ${appMeta?.label || appType}`);
  log.step("appType",       appType);
  log.step("employeeId",    employeeId);
  log.step("employeeName",  employeeName);
  log.step("userId",        userId);
  log.step("instituteCode", instituteCode);
  log.divider();

  // ── 1. Verificar licença ────────────────────────────────────────────────────
  log.step("PASSO 1", "A verificar licença da instituição para esta app...");

  const licence = await ExecuteQuery(
    res,
    `SELECT ed_institute_app_id, ed_institute_app_endDate
     FROM eduall_institute_apps
     WHERE ed_institute_app_instituteCode = ?
       AND ed_institute_app_type = ?
       AND ed_institute_app_deleted = 0
       AND ed_institute_app_endDate > NOW()
     LIMIT 1`,
    [instituteCode, appType],
    true,
    { db: "eduall_institute_apps", type: "select", data: req }
  );

  log.result("Resultado da query de licença", licence);

  if (!licence?.length) {
    log.banner(`SEM LICENÇA VÁLIDA PARA "${appMeta?.label}" — OPERAÇÃO ABORTADA`, "error");
    log.error("A instituição não tem licença activa para esta app.");
    throw new Error(
      `A instituição não possui licença válida para o aplicativo "${appMeta.label}". Adquira ou renove a licença antes de atribuir acessos.`
    );
  }

  log.ok(`Licença válida encontrada — ID: ${licence[0].ed_institute_app_id} | Expira: ${licence[0].ed_institute_app_endDate}`);
  log.divider();

  // ── 2. Verificar se conta já existe ────────────────────────────────────────
  log.step("PASSO 2", "A verificar se conta de app já existe...");

  const existing = await ExecuteQuery(
    res,
    `SELECT ed_system_account_id, ed_system_account_name
     FROM eduall_system_accounts
     WHERE ed_system_account_employee = ?
       AND ed_system_account_institute_code = ?
       AND ed_system_account_app_type = ?
       AND ed_system_account_deleted = 0 LIMIT 1`,
    [employeeId, instituteCode, appType],
    true,
    { db: "eduall_system_accounts", type: "select", data: req }
  );

  log.result("Resultado da query de conta existente", existing);

  if (existing?.length) {
    log.warn(`Conta já existe para esta app — username: ${existing[0].ed_system_account_name} | ID: ${existing[0].ed_system_account_id}`);
    log.banner("APP JÁ ATRIBUÍDA — NENHUMA INSERÇÃO NECESSÁRIA", "warn");
    return {
      username:       existing[0].ed_system_account_name,
      accountId:      existing[0].ed_system_account_id,
      alreadyExisted: true,
    };
  }

  if (appType === "principal_portal") {
    const limitRows = await ExecuteQuery(
      res,
      `SELECT COUNT(*) AS total FROM eduall_system_accounts
       WHERE ed_system_account_institute_code = ?
         AND ed_system_account_app_type = 'principal_portal'
         AND ed_system_account_deleted = 0`,
      [instituteCode],
      true,
      { db: "eduall_system_accounts", type: "select", data: req }
    );
    if (Number(limitRows?.[0]?.total || 0) >= 2) {
      throw new Error("Esta escola já possui os 2 utilizadores permitidos no Portal da Direção. Remova um acesso existente antes de atribuir outro.");
    }
  }

  log.ok("Nenhuma conta existente — prosseguir para inserção.");
  log.divider();

  // ── 3. Gerar username ───────────────────────────────────────────────────────
  log.step("PASSO 3", "A gerar username único...");
  const username = await generateUsername(employeeName);
  log.ok(`Username gerado: ${username}`);
  log.divider();

  // ── 4. Inserir na DB ────────────────────────────────────────────────────────
  log.step("PASSO 4", "A inserir conta de app em eduall_system_accounts...");
  log.step("Valores a inserir", { username, employeeId, userId, instituteCode, appType });

  const insertResult = await ExecuteQuery(
    res,
    `INSERT INTO eduall_system_accounts
       (ed_system_account_name, ed_system_account_employee,
        ed_system_account_userid, ed_system_account_institute_code,
        ed_system_account_app_type)
     VALUES (?, ?, ?, ?, ?)`,
    [username, employeeId, userId, instituteCode, appType],
    false,
    { db: "eduall_system_accounts", type: "insert", data: req }
  );

  log.result("Resultado do INSERT", insertResult);
  log.divider();

  // ── 5. Recuperar ID da conta inserida ───────────────────────────────────────
  log.step("PASSO 5", "A recuperar ID da conta inserida...");

  const newAcc = await ExecuteQuery(
    res,
    `SELECT ed_system_account_id FROM eduall_system_accounts
     WHERE ed_system_account_name = ?
       AND ed_system_account_employee = ?
       AND ed_system_account_app_type = ? LIMIT 1`,
    [username, employeeId, appType],
    true,
    { db: "eduall_system_accounts", type: "select", data: req }
  );

  log.result("Resultado do SELECT pós-INSERT", newAcc);

  const accountId = newAcc?.[0]?.ed_system_account_id;

  if (!accountId) {
    log.banner("FALHA CRÍTICA — ID NÃO RECUPERADO APÓS INSERT", "error");
    throw new Error("Erro ao recuperar ID da conta de app.");
  }

  log.banner(`APP "${appMeta.label}" ATRIBUÍDA COM SUCESSO — ID: ${accountId} | username: ${username}`, "success");

  return { username, accountId, alreadyExisted: false };
};

// ─── ensureLibraryAccess — Processar acessos da Biblioteca ────────────────────
const ensureLibraryAccess = async (accountId, libraryAccountType, libraryMenuAccess, req, res) => {
  log.section("PROCESSAR ACESSOS DA BIBLIOTECA");
  log.step("accountId",           accountId);
  log.step("libraryAccountType",  libraryAccountType);
  log.step("menuAccessItems",     libraryMenuAccess ? Object.keys(libraryMenuAccess).length : 0);
  log.divider();

  // ── Verificar se tipo de conta é válido ────────────────────────────────────
  if (!LIBRARY_ACCOUNT_TYPES.includes(libraryAccountType)) {
    log.error(`Tipo de conta inválido: ${libraryAccountType}`);
    throw new Error(`Tipo de conta inválido: ${libraryAccountType}`);
  }

  log.step("Tipo de conta validado", libraryAccountType);

  // ── Verificar se já existe ─────────────────────────────────────────────────
  const existing = await ExecuteQuery(
    res,
    `SELECT ed_library_access_id FROM eduall_library_access
     WHERE ed_library_access_account_id = ?
       AND ed_library_access_deleted = 0 LIMIT 1`,
    [accountId],
    true,
    { db: "eduall_library_access", type: "select", data: req }
  );

  if (existing?.length) {
    log.warn("Acesso à biblioteca já existe para esta conta");
    log.divider();
    return;
  }

  // ── Preparar JSON de acessos (apenas para admin) ────────────────────────────
  let menuAccessJson = null;
  if (libraryAccountType === "admin" && libraryMenuAccess) {
    log.step("PASSO 1", "Processar acessos de menu para admin...");
    menuAccessJson = JSON.stringify(libraryMenuAccess);
    const countAccess = Object.values(libraryMenuAccess).filter(v => v === 1).length;
    log.ok(`${countAccess} acessos atribuídos`);
  } else if (libraryAccountType === "reader") {
    log.step("PASSO 1", "Tipo reader — sem acessos de menu");
    menuAccessJson = JSON.stringify({});
  }

  log.divider();

  // ── Inserir acesso na tabela eduall_library_access ────────────────────────
  log.step("PASSO 2", "Inserir acesso na tabela eduall_library_access...");
  log.step("Valores a inserir", {
    account_id: accountId,
    account_type: libraryAccountType,
    menu_access_items: menuAccessJson ? Object.keys(JSON.parse(menuAccessJson)).length : 0,
  });

  await ExecuteQuery(
    res,
    `INSERT INTO eduall_library_access
       (ed_library_access_account_id, ed_library_access_account_type,
        ed_library_access_menu_access, ed_library_access_deleted)
     VALUES (?, ?, ?, 0)`,
    [accountId, libraryAccountType, menuAccessJson],
    false,
    { db: "eduall_library_access", type: "insert", data: req }
  );

  log.ok("Acesso à biblioteca registado com sucesso");
  log.divider();
};

// ─── Controller: Registo unificado ────────────────────────────────────────────

const UnifiedAccountRegister = async (req, res) => {
  try {
    const instituteCode = req.session.user.eduall_user_session_curentinstitute;

    log.banner("UNIFIED ACCOUNT REGISTER — INÍCIO DO REQUEST", "info");
    log.step("Body recebido",   req.body);
    log.step("instituteCode",   instituteCode);
    log.divider();

    const {
      employeeId,
      employeeName,
      email,
      accountType,
      apps = [],
      libraryAccountType = null,
      library_menu_access = null,
      access_myinstitute    = 0,
      access_secretary      = 0,
      access_administration = 0,
      access_finances       = 0,
      access_pedagogy       = 0,
      access_transportation = 0,
      access_library        = 0,
      access_system         = 0,
      access_configuration  = 0,
      access_portal         = 0,
    } = req.body;

    log.step("employeeId",          employeeId);
    log.step("employeeName",        employeeName);
    log.step("email",               email);
    log.step("accountType",         accountType);
    log.step("apps",                apps);
    log.step("libraryAccountType",  libraryAccountType);
    log.divider();

    // ── Limpeza de inputs (trim) ──────────────────────────────────────────────
    const nameTrimmed = (employeeName || '').trim();
    const emailTrimmed = (email || '').trim().toLowerCase();

    // ── Validações ────────────────────────────────────────────────────────────
    if (!employeeId) {
      log.error("Validação falhou: employeeId em falta");
      return res.status(400).json({ success: false, msg: "Funcionário obrigatório!" });
    }

    if (!nameTrimmed || nameTrimmed.length < 3) {
      log.error(`Validação falhou: nome inválido → "${nameTrimmed}" (length: ${nameTrimmed.length})`);
      return res.status(400).json({ success: false, msg: "Nome inválido (mínimo 3 caracteres após trim)!" });
    }

    if (!VALID_ACCOUNT_TYPES.includes(accountType)) {
      log.error(`Validação falhou: accountType inválido → "${accountType}"`);
      return res.status(400).json({ success: false, msg: `Tipo de conta inválido: ${accountType}` });
    }

    const needsEmail = ["teacher", "user", "dashboard", "user_dashboard", "user_dashboard_teacher"];
    if (needsEmail.includes(accountType) && !emailTrimmed) {
      log.error("Validação falhou: email em falta");
      return res.status(400).json({ success: false, msg: "Email obrigatório para este tipo de conta!" });
    }

    if (needsEmail.includes(accountType) && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailTrimmed)) {
      log.error(`Validação falhou: email inválido → "${emailTrimmed}"`);
      return res.status(400).json({ success: false, msg: "Email inválido!" });
    }

    const invalidApps = (apps || []).filter(a => !VALID_APP_TYPES.includes(a));
    if (invalidApps.length) {
      log.error(`Validação falhou: apps inválidas → ${invalidApps.join(", ")}`);
      return res.status(400).json({ success: false, msg: `Apps inválidas: ${invalidApps.join(", ")}` });
    }

    if (apps.includes("principal_portal")) {
      const existingPortalAccess = await ExecuteQuery(
        res,
        `SELECT ed_system_account_id FROM eduall_system_accounts
         WHERE ed_system_account_employee = ?
           AND ed_system_account_institute_code = ?
           AND ed_system_account_app_type = 'principal_portal'
           AND ed_system_account_deleted = 0
         LIMIT 1`,
        [employeeId, instituteCode],
        true,
        { db: "eduall_system_accounts", type: "select", data: req }
      );

      if (!existingPortalAccess?.length) {
        const portalAccessCount = await ExecuteQuery(
          res,
          `SELECT COUNT(*) AS total FROM eduall_system_accounts
           WHERE ed_system_account_institute_code = ?
             AND ed_system_account_app_type = 'principal_portal'
             AND ed_system_account_deleted = 0`,
          [instituteCode],
          true,
          { db: "eduall_system_accounts", type: "select", data: req }
        );
        if (Number(portalAccessCount?.[0]?.total || 0) >= 2) {
          return res.status(409).json({
            success: false,
            code: "PRINCIPAL_PORTAL_LIMIT_REACHED",
            msg: "Esta escola já possui os 2 utilizadores permitidos no Portal da Direção. Remova um acesso existente antes de atribuir outro."
          });
        }
      }
    }

    // ── Validação de biblioteca ────────────────────────────────────────────────
    if (apps.includes("library")) {
      if (!libraryAccountType || !LIBRARY_ACCOUNT_TYPES.includes(libraryAccountType)) {
        log.error(`Validação falhou: libraryAccountType inválido → "${libraryAccountType}"`);
        return res.status(400).json({ 
          success: false, 
          msg: `Tipo de conta da biblioteca inválido: ${libraryAccountType}. Deve ser "admin" ou "reader".` 
        });
      }

      if (libraryAccountType === "admin" && !library_menu_access) {
        log.error("Validação falhou: library_menu_access obrigatório para admin");
        return res.status(400).json({ 
          success: false, 
          msg: "Acessos de menu são obrigatórios para administrador da biblioteca!" 
        });
      }

      if (libraryAccountType === "admin" && typeof library_menu_access === "string") {
        try {
          JSON.parse(library_menu_access);
        } catch (e) {
          log.error("Validação falhou: library_menu_access JSON inválido");
          return res.status(400).json({ success: false, msg: "Acessos de menu com formato JSON inválido!" });
        }
      }
    }

    log.ok("Todas as validações passaram.");
    log.divider();

    const doUser      = ["user", "user_dashboard", "user_dashboard_teacher"].includes(accountType);
    const doTeacher   = ["teacher", "user_dashboard_teacher"].includes(accountType);
    const doDashboard = ["dashboard", "user_dashboard", "user_dashboard_teacher"].includes(accountType);
    const doApps      = Array.isArray(apps) && apps.length > 0;

    log.step("doUser",      doUser);
    log.step("doTeacher",   doTeacher);
    log.step("doDashboard", doDashboard);
    log.step("doApps",      doApps);
    log.divider();

    const accessMap = {
      access_myinstitute, access_secretary, access_administration,
      access_finances, access_pedagogy, access_transportation,
      access_library, access_system, access_configuration, access_portal,
    };

    let userId             = null;
    let password           = null;
    let username           = null;
    let userAlreadyExisted = false;
    const appResults       = [];

    // ── Conta Eduall ──────────────────────────────────────────────────────────
    log.section("VERIFICAR / CRIAR CONTA EDUALL");
    const result = await ensureEduallAccount(emailTrimmed, nameTrimmed || "Utilizador", "ao", req, res);
    if (res.headersSent) return;
    userId             = result.userId;
    password           = result.password;
    userAlreadyExisted = result.userAlreadyExisted;
    log.step("userId obtido",        userId);
    log.step("userAlreadyExisted",   userAlreadyExisted);
    log.step("password gerada",      password ? "SIM (nova)" : "NÃO (conta existente)");

    if (doTeacher) {
      log.section("CRIAR CONTA DE PROFESSOR");
      await ensureTeacherAccount(userId, employeeId, instituteCode, req, res);
      if (res.headersSent) return;
      log.ok("Conta de professor processada.");
    }

    if (doDashboard) {
      log.section("CRIAR / ACTUALIZAR CONTA DE DASHBOARD");
      const dr = await ensureDashboardAccount(
        userId, employeeId, nameTrimmed || "Utilizador", instituteCode, accessMap, req, res
      );
      if (res.headersSent) return;
      username = dr.username;
      log.ok(`Dashboard processado — username: ${username} | alreadyExisted: ${dr.alreadyExisted}`);
    }

    if (doApps) {
      log.section(`PROCESSAR ${apps.length} APP(S): ${apps.join(", ")}`);
      for (const appType of apps) {
        log.divider();
        log.step("A processar app", appType);
        try {
          const libraryMenuAccessObj = appType === "library" && library_menu_access 
            ? (typeof library_menu_access === "string" ? JSON.parse(library_menu_access) : library_menu_access)
            : null;

          const ar = await ensureAppAccount(
            userId, employeeId, nameTrimmed || "Utilizador", instituteCode, appType, req, res, libraryMenuAccessObj
          );
          if (res.headersSent) return;
          if (!username) username = ar.username;

          // ── Processar acessos da biblioteca (apenas se for library) ─────────
          if (appType === "library" && libraryAccountType) {
            await ensureLibraryAccess(
              ar.accountId, 
              libraryAccountType, 
              libraryMenuAccessObj, 
              req, 
              res
            );
            if (res.headersSent) return;
          }

          appResults.push({
            appType,
            appLabel:            INTERNAL_APPS[appType].label,
            appRoute:            INTERNAL_APPS[appType].route,
            accountId:           ar.accountId,
            alreadyExisted:      ar.alreadyExisted,
            libraryAccountType:  appType === "library" ? libraryAccountType : null,
            libraryMenuCount:    appType === "library" && libraryMenuAccessObj 
              ? Object.values(libraryMenuAccessObj).filter(v => v === 1).length 
              : null,
          });
          log.ok(`App "${appType}" processada com sucesso.`);
        } catch (appErr) {
          log.error(`Falha ao processar app "${appType}"`, appErr.message);
          appResults.push({
            appType,
            appLabel: INTERNAL_APPS[appType].label,
            error:    appErr.message,
          });
        }
      }
    }

    // ── Resultado final ───────────────────────────────────────────────────────
    log.section("RESULTADO FINAL");
    log.step("username",          username);
    log.step("password",          password ? "(gerada)" : "null");
    log.step("userAlreadyExisted",userAlreadyExisted);
    log.result("appResults", appResults);
    log.banner("UNIFIED ACCOUNT REGISTER — CONCLUÍDO COM SUCESSO", "success");

    const appsLabel = appResults.map(a => a.appLabel).join(", ");
    await RegisterAuditAction({
      session:     req.session,
      action:      1,
      form:        "Criação unificada de conta",
      description: `Criou conta tipo "${accountType}"${appsLabel ? ` + apps [${appsLabel}]` : ""} para funcionário ID ${employeeId} (${employeeName})`,
    }).catch(() => {});

    return res.status(200).json({
      success: true,
      msg: "Conta(s) criada(s) com sucesso!",
      username: username || null,
      password: password || null,
      userAlreadyExisted,
      libraryAccountType: apps.includes("library") ? libraryAccountType : null,
      apps: appResults,
    });

  } catch (error) {
    log.banner("UNIFIED ACCOUNT REGISTER — ERRO FATAL", "error");
    log.error(error.message, error.stack);
    return res.status(500).json({ success: false, msg: "Erro ao criar conta!", error: error.message });
  }
};

// ─── Controller: Listar acessos da biblioteca (ATUALIZADO) ──────────────────────

const GetLibraryAccounts = async (req, res) => {
  try {
    const instituteCode = req.session.user.eduall_user_session_curentinstitute;
    const { accountType } = req.query;
 
    let whereClause = "sa.ed_system_account_app_type = 'library'";
    let params = [instituteCode];
 
    if (accountType) {
      if (!LIBRARY_ACCOUNT_TYPES.includes(accountType)) {
        return res.status(400).json({ success: false, msg: `Tipo de conta inválido: ${accountType}` });
      }
      whereClause += " AND COALESCE(la.ed_library_access_account_type, ?) = ?";
      params.push(accountType, accountType);
    }
 

    const rows = await ExecuteQuery(
      res,
      `SELECT DISTINCT
        COALESCE(la.ed_library_access_id, CONCAT('app_', sa.ed_system_account_id)) AS ed_library_access_id,
        sa.ed_system_account_id AS ed_library_access_account_id,
        sa.ed_system_account_id,
        COALESCE(la.ed_library_access_account_type, 'pending') AS ed_library_access_account_type,
        COALESCE(la.ed_library_access_menu_access, '{}') AS ed_library_access_menu_access,
        sa.ed_system_account_name,
        sa.ed_system_account_employee,
        sa.ed_system_account_app_type,
        e.ed_employee_name,
        e.ed_employee_email,
        e.ed_employee_picture,
        ua.ed_user_account_email
      FROM eduall_system_accounts sa
      INNER JOIN eduall_employees e
        ON sa.ed_system_account_employee = e.ed_employee_id
        AND e.ed_employee_deleted = 0
      INNER JOIN eduall_user_accounts ua
        ON sa.ed_system_account_userid = ua.ed_user_account_id
        AND ua.ed_user_account_deleted = 0
      LEFT JOIN eduall_library_access la
        ON sa.ed_system_account_id = la.ed_library_access_account_id
        AND la.ed_library_access_deleted = 0
      WHERE sa.ed_system_account_institute_code = ?
        AND ${whereClause}
        AND sa.ed_system_account_deleted = 0
      ORDER BY COALESCE(la.ed_library_access_account_type, 'pending') DESC, e.ed_employee_name`,
      params,
      true,
      { db: "eduall_library_access", type: "select", data: req }
    );
 
    const enriched = (rows || []).map((row) => {
      let menuAccessCount = 0;
      let menuAccessItems = {};
 
      try {
        if (row.ed_library_access_menu_access && row.ed_library_access_menu_access !== '{}') {
          const parsed = JSON.parse(row.ed_library_access_menu_access);
          menuAccessItems = parsed;
          menuAccessCount = Object.values(parsed).filter(v => v === 1).length;
        }
      } catch (e) {
        menuAccessItems = {};
        menuAccessCount = 0;
      }
 
      return {
        ...row,
        menuAccessCount,
        menuAccessItems,
        isPending: row.ed_library_access_account_type === 'pending',
      };
    });
 
    return res.status(200).json({ success: true, data: enriched });
  } catch (error) {
    return res.status(500).json({ success: false, msg: "Erro ao listar acessos da biblioteca!", error: error.message });
  }
};
 

// ─── Controller: Actualizar acessos de menu da biblioteca ──────────────────────

const UpdateLibraryAccess = async (req, res) => {
  try {
    const { id } = req.params;
    const { library_menu_access } = req.body;

    if (!library_menu_access) {
      return res.status(400).json({ success: false, msg: "Acessos de menu são obrigatórios!" });
    }

    let menuAccessJson = library_menu_access;
    if (typeof library_menu_access === "object") {
      menuAccessJson = JSON.stringify(library_menu_access);
    }

    // Validar JSON
    try {
      JSON.parse(menuAccessJson);
    } catch (e) {
      return res.status(400).json({ success: false, msg: "Formato JSON inválido para acessos de menu!" });
    }

    const countAccess = Object.values(JSON.parse(menuAccessJson)).filter(v => v === 1).length;

    log.section("ACTUALIZAR ACESSOS DE BIBLIOTECA");
    log.step("Access ID",      id);
    log.step("Menu Items",     countAccess);
    log.divider();

    await ExecuteQuery(
      res,
      `UPDATE eduall_library_access 
       SET ed_library_access_menu_access = ?
       WHERE ed_library_access_id = ? AND ed_library_access_deleted = 0`,
      [menuAccessJson, id],
      false,
      { db: "eduall_library_access", type: "update", data: req }
    );

    log.ok(`Acessos actualizados com sucesso — ${countAccess} items ativos`);

    await RegisterAuditAction({
      session:     req.session,
      action:      2,
      form:        "Acessos da Biblioteca",
      description: `Actualizou acessos de menu da biblioteca (ID ${id}) — ${countAccess} módulos activos`,
    }).catch(() => {});

    return res.status(200).json({ 
      success: true, 
      msg: "Acessos da biblioteca actualizados com sucesso!",
      menuAccessCount: countAccess,
    });
  } catch (error) {
    return res.status(500).json({ success: false, msg: "Erro ao actualizar acessos!", error: error.message });
  }
};

// ─── Controller: Remover acesso da biblioteca ───────────────────────────────────

const DeleteLibraryAccess = async (req, res) => {
  try {
    const { id } = req.params;

    await ExecuteQuery(
      res,
      `UPDATE eduall_library_access
       SET ed_library_access_deleted = 1
       WHERE ed_library_access_id = ? AND ed_library_access_deleted = 0`,
      [id],
      false,
      { db: "eduall_library_access", type: "update", data: req }
    );

    await RegisterAuditAction({
      session:     req.session,
      action:      3,
      form:        "Acessos da Biblioteca",
      description: `Removeu acesso da biblioteca com ID ${id}`,
    }).catch(() => {});

    return res.status(200).json({ success: true, msg: "Acesso da biblioteca removido com sucesso!" });
  } catch (error) {
    return res.status(500).json({ success: false, msg: "Erro ao remover acesso!", error: error.message });
  }
};

// ─── Controllers originais (mantidos) ──────────────────────────────────────────

const GetAppAccounts = async (req, res) => {
  try {
    const instituteCode = req.session.user.eduall_user_session_curentinstitute;
    const { appType, employeeId } = req.query;

    if (appType && !VALID_APP_TYPES.includes(appType))
      return res.status(400).json({ success: false, msg: `appType inválido: ${appType}` });

    const conditions = [
      "sa.ed_system_account_institute_code = ?",
      "sa.ed_system_account_deleted = 0",
      "sa.ed_system_account_app_type IS NOT NULL",
    ];
    const params = [instituteCode];

    if (appType) {
      conditions.push("sa.ed_system_account_app_type = ?");
      params.push(appType);
    }

    if (employeeId) {
      conditions.push("sa.ed_system_account_employee = ?");
      params.push(employeeId);
    }

    const rows = await ExecuteQuery(
      res,
      `SELECT
         sa.ed_system_account_id,
         sa.ed_system_account_name       AS username,
         sa.ed_system_account_app_type   AS appType,
         sa.ed_system_account_employee   AS employeeId,
         sa.ed_system_account_userid     AS userId,
         e.ed_employee_name,
         e.ed_employee_email,
         e.ed_employee_picture,
         ua.ed_user_account_email
       FROM eduall_system_accounts sa
       INNER JOIN eduall_employees e
         ON sa.ed_system_account_employee = e.ed_employee_id
         AND e.ed_employee_deleted = 0
       INNER JOIN eduall_user_accounts ua
         ON sa.ed_system_account_userid = ua.ed_user_account_id
         AND ua.ed_user_account_deleted = 0
       WHERE ${conditions.join(" AND ")}
       ORDER BY sa.ed_system_account_app_type, e.ed_employee_name`,
      params,
      true,
      { db: "eduall_system_accounts", type: "select", data: req }
    );

    const enriched = (rows || []).map((row) => ({
      ...row,
      appLabel: row.appType ? (INTERNAL_APPS[row.appType]?.label || row.appType) : "Dashboard",
      appRoute: row.appType ? (INTERNAL_APPS[row.appType]?.route || "/") : "/dashboard",
    }));

    return res.status(200).json({ success: true, data: enriched });
  } catch (error) {
    return res.status(500).json({ success: false, msg: "Erro ao listar contas!", error: error.message });
  }
};

const GetDashboardAccounts = async (req, res) => {
  try {
    const instituteCode = req.session.user.eduall_user_session_curentinstitute;

    const rows = await ExecuteQuery(
      res,
      `SELECT
         sa.ed_system_account_id,
         sa.ed_system_account_name       AS username,
         sa.ed_system_account_employee   AS employeeId,
         sa.ed_system_account_deleted,
         e.ed_employee_name,
         e.ed_employee_email,
         e.ed_employee_picture,
         e.ed_employee_charge,
         ua.ed_user_access_myinstitute,
         ua.ed_user_access_secretary,
         ua.ed_user_access_administration,
         ua.ed_user_access_finances,
         ua.ed_user_access_pedagogicalarea,
         ua.ed_user_access_transportation,
         ua.ed_user_access_library,
         ua.ed_user_access_system,
         ua.ed_user_access_configuration,
         ua.ed_user_access_portal
       FROM eduall_system_accounts sa
       INNER JOIN eduall_employees e
         ON sa.ed_system_account_employee = e.ed_employee_id
         AND e.ed_employee_deleted = 0
       LEFT JOIN eduall_user_access ua
         ON sa.ed_system_account_id = ua.ed_user_access_usercode
       WHERE sa.ed_system_account_institute_code = ?
         AND sa.ed_system_account_app_type IS NULL
         AND sa.ed_system_account_deleted = 0
       ORDER BY e.ed_employee_name`,
      [instituteCode],
      true,
      { db: "eduall_system_accounts", type: "select", data: req }
    );

    return res.status(200).json({ success: true, data: rows || [] });
  } catch (error) {
    return res.status(500).json({ success: false, msg: "Erro ao listar contas!", error: error.message });
  }
};

const DeleteAppAccount = async (req, res) => {
  try {
    const { id } = req.params;

    await ExecuteQuery(
      res,
      `UPDATE eduall_system_accounts
       SET ed_system_account_deleted = 1
       WHERE ed_system_account_id = ? AND ed_system_account_deleted = 0`,
      [id],
      false,
      { db: "eduall_system_accounts", type: "update", data: req }
    );

    await RegisterAuditAction({
      session:     req.session,
      action:      3,
      form:        "Contas de Sistema",
      description: `Removeu conta de sistema com ID ${id}`,
    }).catch(() => {});

    return res.status(200).json({ success: true, msg: "Conta removida com sucesso!" });
  } catch (error) {
    return res.status(500).json({ success: false, msg: "Erro ao remover conta!", error: error.message });
  }
};

const UpdateDashboardAccess = async (req, res) => {
  try {
    const { id } = req.params;

    const {
      access_myinstitute    = 0,
      access_secretary      = 0,
      access_administration = 0,
      access_finances       = 0,
      access_pedagogy       = 0,
      access_transportation = 0,
      access_library        = 0,
      access_configuration  = 0,
      access_portal         = 0,
    } = req.body;

    const RESET  = "\x1b[0m";
    const BOLD   = "\x1b[1m";
    const PURPLE = "\x1b[35m";
    const GREEN  = "\x1b[32m";
    const RED    = "\x1b[31m";
    const CYAN   = "\x1b[36m";
    const YELLOW = "\x1b[33m";
    const GRAY   = "\x1b[90m";

    const AREAS = [
      { dbKey: "ed_user_access_myinstitute",     payloadVal: access_myinstitute,    label: "A Minha Instituição", icon: "🏫" },
      { dbKey: "ed_user_access_secretary",       payloadVal: access_secretary,      label: "Secretaria",          icon: "📋" },
      { dbKey: "ed_user_access_administration",  payloadVal: access_administration, label: "Administração",       icon: "🏢" },
      { dbKey: "ed_user_access_finances",        payloadVal: access_finances,       label: "Finanças",            icon: "💰" },
      { dbKey: "ed_user_access_pedagogicalarea", payloadVal: access_pedagogy,       label: "Área Pedagógica",     icon: "📚" },
      { dbKey: "ed_user_access_transportation",  payloadVal: access_transportation, label: "Transportes",         icon: "🚌" },
      { dbKey: "ed_user_access_library",         payloadVal: access_library,        label: "Biblioteca",          icon: "📖" },
      { dbKey: "ed_user_access_configuration",   payloadVal: access_configuration,  label: "Configurações",       icon: "🔧" },
      { dbKey: "ed_user_access_portal",          payloadVal: access_portal,         label: "Portal",              icon: "🌐" },
    ];

    console.log(`\n${YELLOW}${BOLD}╔══════════════════════════════════════════╗${RESET}`);
    console.log(`${YELLOW}${BOLD}   📦 PAYLOAD RECEBIDO — Conta ID: ${id}${RESET}`);
    console.log(`${YELLOW}${BOLD}╚══════════════════════════════════════════╝${RESET}`);
    AREAS.forEach(({ label, icon, payloadVal }) =>
      console.log(
        Number(payloadVal) === 1
          ? `${GREEN}   ${icon}  ${label}: 1 (ativo)${RESET}`
          : `${GRAY}   ${icon}  ${label}: 0 (inativo)${RESET}`
      )
    );

    // ✅ CORRIGIDO: DELETE primeiro, depois INSERT (em vez de ON DUPLICATE KEY UPDATE)
    console.log(`\n${CYAN}${BOLD}🗑️  Removendo registos antigos...${RESET}`);
    await ExecuteQuery(
      res,
      `DELETE FROM eduall_user_access WHERE ed_user_access_usercode = ?`,
      [id],
      false,
      { db: "eduall_user_access", type: "delete", data: req }
    );

    console.log(`${CYAN}${BOLD}📝 Inserindo novos acessos...${RESET}\n`);
    await ExecuteQuery(
      res,
      `INSERT INTO eduall_user_access (
         ed_user_access_usercode,
         ed_user_access_myinstitute,
         ed_user_access_secretary,
         ed_user_access_administration,
         ed_user_access_finances,
         ed_user_access_pedagogicalarea,
         ed_user_access_transportation,
         ed_user_access_library,
         ed_user_access_configuration,
         ed_user_access_portal
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        access_myinstitute, access_secretary, access_administration,
        access_finances,    access_pedagogy,  access_transportation,
        access_library,     access_configuration, access_portal,
      ],
      false,
      { db: "eduall_user_access", type: "insert", data: req }
    );

    // ✅ SELECT para validação final
    const rows = await ExecuteQuery(
      res,
      `SELECT ua.*, u.ed_user_account_name
       FROM eduall_user_access ua
       LEFT JOIN eduall_user_accounts u
         ON CAST(u.ed_user_account_id AS CHAR) = CAST(ua.ed_user_access_usercode AS CHAR)
       WHERE ua.ed_user_access_usercode = ?
       LIMIT 1`,
      [id],
      true,
      { db: "eduall_user_access", type: "select", data: req }
    );

    const row  = Array.isArray(rows) && rows.length > 0 ? rows[0] : null;
    const nome = row?.ed_user_account_name ?? `ID ${id}`;
    const com  = AREAS.filter(a => Number(row?.[a.dbKey]) === 1);
    const sem  = AREAS.filter(a => Number(row?.[a.dbKey]) !== 1);

    console.log(`\n${PURPLE}${BOLD}╔══════════════════════════════════════════╗${RESET}`);
    console.log(`${PURPLE}${BOLD}   🎓 ACESSOS NA DB — ${nome.toUpperCase()}${RESET}`);
    console.log(`${PURPLE}${BOLD}╚══════════════════════════════════════════╝${RESET}`);

    console.log(`\n${GREEN}${BOLD}✅  COM ACESSO (${com.length})${RESET}`);
    com.length === 0
      ? console.log(`${GRAY}   (nenhum acesso atribuído)${RESET}`)
      : com.forEach(({ label, icon }) => console.log(`${GREEN}   ${icon}  ${label}${RESET}`));

    console.log(`\n${RED}${BOLD}🚫  SEM ACESSO (${sem.length})${RESET}`);
    sem.length === 0
      ? console.log(`${GRAY}   (acesso total concedido)${RESET}`)
      : sem.forEach(({ label, icon }) => console.log(`${RED}   ${icon}  ${label}${RESET}`));

    console.log(`\n${CYAN}   Total com acesso: ${com.length} / ${AREAS.length}${RESET}`);
    console.log(`${GRAY}══════════════════════════════════════════${RESET}\n`);

    // ✅ Auditoria
    await RegisterAuditAction({
      session:     req.session,
      action:      2,
      form:        "Contas de Sistema",
      description: `Actualizou acessos da conta ID ${id}`,
    }).catch(() => {});

    return res.status(200).json({ success: true, msg: "Acessos actualizados com sucesso!" });

  } catch (error) {
    console.error(`${RED}${BOLD}❌ ERRO: ${error.message}${RESET}`);
    return res.status(500).json({ success: false, msg: "Erro ao actualizar acessos!", error: error.message });
  }
};

 

const GetAvailableApps = async (req, res) => {
  try {
    const instituteCode = req.session.user.eduall_user_session_curentinstitute;

    await ensureDefaultInstituteApps(instituteCode, req, res);

    const licences = await ExecuteQuery(
      res,
      `SELECT ed_institute_app_type, ed_institute_app_endDate
       FROM eduall_institute_apps
       WHERE ed_institute_app_instituteCode = ?
         AND ed_institute_app_deleted = 0
         AND ed_institute_app_endDate > NOW()`,
      [instituteCode],
      true,
      { db: "eduall_institute_apps", type: "select", data: req }
    );

    const licencedTypes = new Set((licences || []).map(l => l.ed_institute_app_type));
    const portalAccessRows = await ExecuteQuery(
      res,
      `SELECT COUNT(*) AS total FROM eduall_system_accounts
       WHERE ed_system_account_institute_code = ?
         AND ed_system_account_app_type = 'principal_portal'
         AND ed_system_account_deleted = 0`,
      [instituteCode],
      true,
      { db: "eduall_system_accounts", type: "select", data: req }
    );
    const principalPortalAssigned = Number(portalAccessRows?.[0]?.total || 0);

    const data = Object.values(INTERNAL_APPS).map(app => ({
      ...app,
      hasLicence: licencedTypes.has(app.id),
      expireDate: licences.find(l => l.ed_institute_app_type === app.id)?.ed_institute_app_endDate || null,
      assignedCount: app.id === "principal_portal" ? principalPortalAssigned : null,
      assignmentLimit: app.id === "principal_portal" ? 2 : null,
    }));

    return res.status(200).json({ success: true, data });
  } catch (error) {
    return res.status(500).json({ success: false, msg: "Erro ao obter apps!", error: error.message });
  }
};

const GetInstituteApps = async (req, res) => {
  try {
    const instituteCode = req.session.user.eduall_user_session_curentinstitute;

    try {
      await ensureDefaultInstituteApps(instituteCode, req, res);
    } catch (installError) {
      console.error("Não foi possível persistir as apps padrão:", installError.message);
    }

    const rows = await ExecuteQuery(
      res,
      `SELECT * FROM eduall_institute_apps
       WHERE ed_institute_app_instituteCode = ? AND ed_institute_app_deleted = 0
       ORDER BY ed_institute_app_type`,
      [instituteCode],
      true,
      { db: "eduall_institute_apps", type: "select", data: req }
    );

    const rowsByType = new Map((rows || []).map(row => [row.ed_institute_app_type, row]));
    const enriched = Object.values(INTERNAL_APPS).map(app => {
      const row = rowsByType.get(app.id);
      const endDate = row?.ed_institute_app_endDate || DEFAULT_APP_END_DATE;
      return {
        ed_institute_app_id: row?.ed_institute_app_id || `default-${app.id}`,
        ed_institute_app_instituteCode: instituteCode,
        ed_institute_app_type: app.id,
        ed_institute_app_startDate: row?.ed_institute_app_startDate || new Date().toISOString(),
        ed_institute_app_endDate: endDate,
        ed_institute_app_deleted: 0,
        appLabel: app.label,
        appRoute: app.route,
        isExpired: new Date(endDate) <= new Date(),
      };
    });

    return res.status(200).json({ success: true, data: enriched });
  } catch (error) {
    return res.status(500).json({ success: false, msg: "Erro ao listar apps!", error: error.message });
  }
};

const RegisterInstituteApp = async (req, res) => {
  try {
    const instituteCode = req.session.user.eduall_user_session_curentinstitute;
    const { appType, startDate, endDate } = req.body;

    if (!VALID_APP_TYPES.includes(appType))
      return res.status(400).json({ success: false, msg: `Tipo de app inválido: ${appType}` });

    if (!endDate)
      return res.status(400).json({ success: false, msg: "Data de expiração obrigatória!" });

    await ExecuteQuery(
      res,
      `INSERT INTO eduall_institute_apps
         (ed_institute_app_instituteCode, ed_institute_app_type,
          ed_institute_app_startDate, ed_institute_app_endDate, ed_institute_app_deleted)
       VALUES (?, ?, ?, ?, 0)
       ON DUPLICATE KEY UPDATE
         ed_institute_app_startDate = VALUES(ed_institute_app_startDate),
         ed_institute_app_endDate   = VALUES(ed_institute_app_endDate),
         ed_institute_app_deleted   = 0`,
      [instituteCode, appType, startDate || new Date(), endDate],
      false,
      { db: "eduall_institute_apps", type: "insert", data: req }
    );

    await RegisterAuditAction({
      session:     req.session,
      action:      1,
      form:        "Apps da Instituição",
      description: `Registou licença da app "${INTERNAL_APPS[appType]?.label}" até ${endDate}`,
    }).catch(() => {});

    return res.status(200).json({ success: true, msg: "Licença de app registada com sucesso!" });
  } catch (error) {
    return res.status(500).json({ success: false, msg: "Erro ao registar app!", error: error.message });
  }
};

const DeleteInstituteApp = async (req, res) => {
  try {
    const { id } = req.params;

    await ExecuteQuery(
      res,
      `UPDATE eduall_institute_apps SET ed_institute_app_deleted = 1
       WHERE ed_institute_app_id = ? AND ed_institute_app_deleted = 0`,
      [id],
      false,
      { db: "eduall_institute_apps", type: "update", data: req }
    );

    return res.status(200).json({ success: true, msg: "Licença removida com sucesso!" });
  } catch (error) {
    return res.status(500).json({ success: false, msg: "Erro ao remover licença!", error: error.message });
  }
};

const RegisterInstituteAccount = async (req, res) => {
  try {
    const { email, employeeId } = req.body;
    const instituteCode = req.session.user.eduall_user_session_curentinstitute;

    if (!email || !employeeId)
      return res.status(400).json({ success: false, msg: "Email e funcionário são obrigatórios!" });

    const userRows = await ExecuteQuery(
      res,
      `SELECT ed_user_account_id FROM eduall_user_accounts
       WHERE ed_user_account_email = ? AND ed_user_account_deleted = 0`,
      [email],
      true,
      { db: "eduall_user_accounts", type: "select", data: req }
    );

    if (!userRows || userRows.length === 0)
      return res.status(400).json({ success: false, msg: "Usuário não encontrado!" });

    if (userRows.length > 1)
      return res.status(400).json({ success: false, msg: "Email duplicado! Contacte o administrador." });

    const userId = userRows[0].ed_user_account_id;

    const existingRows = await ExecuteQuery(
      res,
      `SELECT * FROM eduall_user_institutes
       WHERE ed_user_institute_userCode = ?
         AND ed_user_institute_code = ?
         AND ed_user_institute_deleted = 0`,
      [userId, instituteCode],
      true,
      { db: "eduall_user_institutes", type: "select", data: req }
    );

    if (existingRows.length > 0) {
      const existing = existingRows[0];
      if (existing.ed_user_institute_employeeCode == employeeId) {
        return res.status(400).json({ success: false, msg: "Este usuário já tem uma conta para este funcionário nesta escola!" });
      }
      await ExecuteQuery(
        res,
        `UPDATE eduall_user_institutes SET ed_user_institute_deleted = 1
         WHERE ed_user_institute_userCode = ? AND ed_user_institute_code = ? AND ed_user_institute_deleted = 0`,
        [userId, instituteCode],
        false,
        { db: "eduall_user_institutes", type: "update", data: req }
      );
    }

    const employeeExists = await ExecuteQuery(
      res,
      `SELECT * FROM eduall_user_institutes
       WHERE ed_user_institute_employeeCode = ?
         AND ed_user_institute_code = ?
         AND ed_user_institute_deleted = 0`,
      [employeeId, instituteCode],
      true,
      { db: "eduall_user_institutes", type: "select", data: req }
    );

    if (employeeExists.length > 0)
      return res.status(400).json({ success: false, msg: "Este funcionário já tem uma conta nesta escola!" });

    const insertResult = await ExecuteQuery(
      res,
      `INSERT INTO eduall_user_institutes
         (ed_user_institute_code, ed_user_institute_employeeCode,
          ed_user_institute_userCode, ed_user_institute_deleted, ed_user_institute_registerDate)
       VALUES (?, ?, ?, 0, ?)`,
      [instituteCode, employeeId, userId, new Date()],
      false,
      { db: "eduall_user_institutes", type: "insert", data: req }
    );

    await RegisterAuditAction({
      session:     req.session,
      action:      1,
      form:        "Contas de Instituto",
      description: `Conta registada para funcionário ID ${employeeId}`,
    });

    return res.status(200).json({ success: true, msg: "Conta registada com sucesso!", data: insertResult });
  } catch (error) {
    return res.status(500).json({ success: false, msg: "Erro ao registar conta!", error: error.message });
  }
};

const DeleteInstituteAccount = async (req, res) => {
  try {
    const { ID } = req.params;
    await ExecuteQuery(
      res,
      `UPDATE eduall_user_institutes SET ed_user_institute_deleted = 1
       WHERE ed_user_institute_id = ? AND ed_user_institute_deleted = 0`,
      [ID],
      false,
      { db: "eduall_user_institutes", type: "update", data: req }
    );
    await RegisterAuditAction({
      session: req.session, action: 3,
      form: "Contas de Instituto", description: `Eliminou conta de instituto com ID ${ID}`,
    });
    res.status(200).json({ success: true, msg: "Conta de instituto deletada com sucesso!" });
  } catch (error) {
    res.status(500).json({ success: false, msg: "Falha ao deletar a conta de instituto!", error: error.message });
  }
};

const UpdateInstituteAccount = async (req, res) => {
  try {
    const { ID } = req.params;
    const { employeeId, email } = req.body;
    const instituteCode = req.session.user.eduall_user_session_curentinstitute;

    const userRows = await ExecuteQuery(
      res,
      `SELECT * FROM eduall_user_accounts
       WHERE ed_user_account_email = ? AND ed_user_account_deleted = 0`,
      [email],
      true,
      { db: "eduall_user_accounts", type: "select", data: req }
    );

    if (userRows.length === 0)
      return res.status(400).json({ success: false, msg: "Usuário não encontrado ou foi deletado!" });

    const instituteRows = await ExecuteQuery(
      res,
      `SELECT * FROM eduall_user_institutes
       WHERE ed_user_institute_employeeCode = ?
         AND ed_user_institute_code = ?
         AND ed_user_institute_deleted = 0`,
      [employeeId, instituteCode],
      true,
      { db: "eduall_user_institutes", type: "select", data: req }
    );

    if (instituteRows.length > 0)
      return res.status(400).json({ success: false, msg: "Já existe uma conta de instituto para esse funcionário e instituição!" });

    const rows = await ExecuteQuery(
      res,
      `UPDATE eduall_user_institutes
       SET ed_user_institute_employeeCode = ?, ed_user_institute_userCode = ?
       WHERE ed_user_institute_id = ? AND ed_user_institute_deleted = 0`,
      [employeeId, userRows[0].ed_user_account_id, ID],
      false,
      { db: "eduall_user_institutes", type: "update", data: req }
    );

    await RegisterAuditAction({
      session: req.session, action: 2,
      form: "Contas de Instituto",
      description: `Actualizou conta de instituto com ID ${ID} para funcionário ${employeeId}`,
    });

    res.status(200).json({ success: true, msg: "Conta de instituto actualizada com sucesso!", data: rows });
  } catch (error) {
    res.status(500).json({ success: false, msg: "Falha ao actualizar a conta de instituto!", error: error.message });
  }
};

const GetInstituteAccounts = async (req, res) => {
  try {
    const instituteCode = req.session.user.eduall_user_session_curentinstitute;
    if (!instituteCode)
      return res.status(400).json({ success: false, msg: "Instituto inválido!" });

    const rows = await ExecuteQuery(
      res,
      `SELECT
         ui.ed_user_institute_id,
         ui.ed_user_institute_code,
         ui.ed_user_institute_employeeCode,
         ui.ed_user_institute_userCode,
         ua.ed_user_account_name,
         ua.ed_user_account_email,
         ua.ed_user_account_picture,
         e.ed_employee_name,
         e.ed_employee_picture,
         e.ed_employee_id,
         e.ed_employee_email
       FROM eduall_user_institutes ui
       INNER JOIN eduall_user_accounts ua
         ON ui.ed_user_institute_userCode = ua.ed_user_account_id AND ua.ed_user_account_deleted = 0
       INNER JOIN eduall_employees e
         ON ui.ed_user_institute_employeeCode = e.ed_employee_id AND e.ed_employee_deleted = 0
       WHERE ui.ed_user_institute_code = ? AND ui.ed_user_institute_deleted = 0`,
      [instituteCode],
      true,
      { db: "eduall_user_institutes", type: "select", data: req }
    );

    if (!rows || rows.length === 0)
      return res.status(404).json({ success: false, msg: "Nenhuma conta válida encontrada!" });

    return res.status(200).json(rows);
  } catch (error) {
    return res.status(500).json({ success: false, msg: "Falha ao obter as contas do instituto!", error: error.message });
  }
};

const GetSingleInstituteAccount = async (req, res) => {
  try {
    const { ID } = req.params;
    if (!ID) return res.status(400).json({ success: false, msg: "ID inválido!" });

    const rows = await ExecuteQuery(
      res,
      `SELECT ui.*, ua.*
       FROM eduall_user_institutes ui
       INNER JOIN eduall_user_accounts ua
         ON ui.ed_user_institute_userCode = ua.ed_user_account_id AND ua.ed_user_account_deleted = 0
       INNER JOIN eduall_employees e
         ON ui.ed_user_institute_employeeCode = e.ed_employee_id AND e.ed_employee_deleted = 0
       WHERE ui.ed_user_institute_id = ? AND ui.ed_user_institute_deleted = 0`,
      [ID],
      true,
      { db: "eduall_user_institutes", type: "select", data: req }
    );

    if (!rows || rows.length === 0)
      return res.status(404).json({ success: false, msg: "Conta não encontrada!" });

    return res.status(200).json(rows[0]);
  } catch (error) {
    return res.status(500).json({ success: false, msg: "Falha ao obter a conta!", error: error.message });
  }
};



const GetSingleUserInstitutes = async (req, res) => {
  try {
    const { CODE } = req.params;
    if (!CODE) {
      return res.status(400).json({ success: false, msg: "Código do usuário inválido!" });
    }

    const currentInstituteCode = req.session?.user?.eduall_user_session_curentinstitute;

  

    const systemAccounts = await ExecuteQuery(
      res,
      `SELECT 
        sa.ed_system_account_id,
        sa.ed_system_account_name,
        sa.ed_system_account_app_type,
        sa.ed_system_account_userid,
        sa.ed_system_account_employee,
        sa.ed_system_account_institute_code,
        sa.ed_system_account_status,
        e.*,
        i.*,
        ua.*,
        CASE WHEN i.ed_institute_code COLLATE utf8mb4_unicode_ci = ? THEN 1 ELSE 0 END as is_current_institute
       FROM eduall_system_accounts sa
       LEFT JOIN eduall_employees e ON sa.ed_system_account_employee = e.ed_employee_id AND e.ed_employee_deleted = 0
       LEFT JOIN eduall_institutes i ON sa.ed_system_account_institute_code = i.ed_institute_code COLLATE utf8mb4_unicode_ci
       LEFT JOIN eduall_user_accounts ua ON sa.ed_system_account_userid = ua.ed_user_account_id AND ua.ed_user_account_deleted = 0
       WHERE sa.ed_system_account_userid = ?
       AND sa.ed_system_account_deleted = 0
       ORDER BY is_current_institute DESC, i.ed_institute_name ASC`,
      [currentInstituteCode || '', CODE],
      true,
      { db: "eduall_system_accounts", type: "select", data: req }
    );

    if (systemAccounts && systemAccounts.length > 0) {
     
      const response = {
        success: true,
        user_code: CODE,
        current_institute: currentInstituteCode || null,
        total_accounts: systemAccounts.length,
        accounts: systemAccounts.map(acc => ({
          system_account: {
            id: acc.ed_system_account_id,
            username: acc.ed_system_account_name,
            app_type: acc.ed_system_account_app_type,
            status: acc.ed_system_account_status,
            institute_code: acc.ed_system_account_institute_code
          },
          institute: acc.ed_institute_code ? {
            code: acc.ed_institute_code,
            name: acc.ed_institute_name,
            city: acc.ed_institute_city,
            province: acc.ed_institute_province,
            country: acc.ed_institute_country,
            email: acc.ed_institute_email,
            phone: acc.ed_institute_phone,
            active: acc.ed_institute_active
          } : null,
          employee: acc.ed_employee_id ? {
            id: acc.ed_employee_id,
            code: acc.ed_employee_code,
            name: acc.ed_employee_name,
            email: acc.ed_employee_email,
            phone: acc.ed_employee_phone,
            phone2: acc.ed_employee_phone2,
            picture: acc.ed_employee_picture,
            address: acc.ed_employee_address,
            birthday: acc.ed_employee_birthday,
            nacionality: acc.ed_employee_nacionality,
            naturalness: acc.ed_employee_naturalness,
            avatar_color: acc.ed_employee_avatar_color,
            religion: acc.ed_employee_religion,
            civil_state: acc.ed_employee_civil_state,
            identity_card: acc.ed_employee_identityCard,
            gender: acc.ed_employee_gender,
            rfid_code: acc.ed_employee_rfid_code,
            nif: acc.ed_employee_nif,
            status: acc.ed_employee_status,
            institute_code: acc.ed_employee_institute_code,
            charge: acc.ed_employee_charge,
            subjects: acc.ed_employee_subjects,
            deleted: acc.ed_employee_deleted,
            register_date: acc.ed_employee_registerDate
          } : null,
          user: {
            id: acc.ed_user_account_id,
            code: acc.ed_user_account_code,
            name: acc.ed_user_account_name,
            email: acc.ed_user_account_email,
            picture: acc.ed_user_account_picture,
            phone: acc.ed_userphone,
            gender: acc.ed_user_account_gender,
            country: acc.ed_user_account_country,
            status: acc.ed_user_account_status,
            type: acc.ed_user_account_type,
            charge: acc.ed_user_account_charge,
            register_date: acc.ed_userregisterdate
          },
          is_current_institute: acc.is_current_institute === 1
        }))
      };

      console.log(`${C.bold}${C.bgGreen}${C.white}  ✅ SUCESSO  ${C.reset}\n`);
      return res.status(200).json(response);
    }

    console.log(`${C.yellow}⚠️  Nenhuma conta de sistema encontrada${C.reset}\n`);

    // ── 2. FALLBACK: Procurar só como user (sem sistema account) ────────────────
    console.log(`${C.magenta}2. Buscando como utilizador simples...${C.reset}`);

    const userOnly = await ExecuteQuery(
      res,
      `SELECT ua.*
       FROM eduall_user_accounts ua
       WHERE ua.ed_user_account_id = ?
       AND ua.ed_user_account_deleted = 0
       LIMIT 1`,
      [CODE],
      true,
      { db: "eduall_user_accounts", type: "select", data: req }
    );

    if (userOnly && userOnly.length > 0) {
      console.log(`${C.green}✅ Utilizador encontrado (sem conta de sistema)${C.reset}\n`);

      const response = {
        success: true,
        user_code: CODE,
        current_institute: currentInstituteCode || null,
        total_accounts: 0,
        user: {
          id: userOnly[0].ed_user_account_id,
          code: userOnly[0].ed_user_account_code,
          name: userOnly[0].ed_user_account_name,
          email: userOnly[0].ed_user_account_email,
          picture: userOnly[0].ed_user_account_picture,
          phone: userOnly[0].ed_userphone,
          gender: userOnly[0].ed_user_account_gender,
          country: userOnly[0].ed_user_account_country,
          status: userOnly[0].ed_user_account_status,
          type: userOnly[0].ed_user_account_type,
          charge: userOnly[0].ed_user_account_charge,
          register_date: userOnly[0].ed_userregisterdate
        },
        msg: "Utilizador encontrado mas sem contas de sistema associadas"
      };

      console.log(`${C.bold}${C.bgGreen}${C.white}  ✅ UTILIZADOR SEM SISTEMA ACCOUNT  ${C.reset}\n`);
      return res.status(200).json(response);
    }

    console.log(`${C.red}❌ Utilizador não encontrado${C.reset}\n`);

    // ── 3. NÃO ENCONTRADO ──────────────────────────────────────────────────────
    console.log(`${C.bold}${C.bgRed}${C.white}  ❌ NÃO ENCONTRADO  ${C.reset}\n`);

    return res.status(404).json({
      success: false,
      user_code: CODE,
      msg: "Utilizador não encontrado no sistema!"
    });

  } catch (err) {
    console.error(`${C.red}❌ GetSingleUserInstitutes${C.reset}`, err.message);
    return res.status(500).json({
      success: false,
      msg: "Erro ao buscar institutos!",
      error: err.message
    });
  }
};


const GetSingleUserInstitutesTeacherAccounts = async (req, res) => {
  try {
    const { CODE } = req.params;
    if (!CODE) return res.status(400).json({ success: false, msg: "Código do usuário inválido!" });

    const rows = await ExecuteQuery(
      res,
      `SELECT ui.*, i.*, e.*, l.*
       FROM eduall_user_institutes ui
       INNER JOIN eduall_institutes i ON ui.ed_user_institute_code = i.ed_institute_code
       INNER JOIN eduall_employees e
         ON ui.ed_user_institute_employeeCode = e.ed_employee_id AND e.ed_employee_deleted = 0
       INNER JOIN eduall_institutes_licences l
         ON l.ed_institute_licence_instituteCode = i.ed_institute_code
         AND l.ed_institute_licence_type IN (0, 2, 3, 4, 5)
         AND l.ed_institute_licence_endDate > NOW()
       WHERE ui.ed_user_institute_deleted = 0 AND ui.ed_user_institute_userCode = ?`,
      [CODE],
      true,
      { db: "eduall_user_institutes", type: "select", data: req }
    );

    if (!rows || rows.length === 0)
      return res.status(404).json({ success: false, msg: "Nenhum instituto válido encontrado para este usuário!" });

    return res.status(200).json(rows);
  } catch (err) {
    return res.status(500).json({ success: false, msg: "Erro ao buscar institutos!", error: err.message });
  }
};







// ─── Exports ──────────────────────────────────────────────────────────────────

module.exports = {
  UnifiedAccountRegister,
  GetAppAccounts,
  GetDashboardAccounts,
  DeleteAppAccount,
  UpdateDashboardAccess,
  GetAvailableApps,
  GetInstituteApps,
  RegisterInstituteApp,
  DeleteInstituteApp,
  RegisterInstituteAccount, 
  DeleteInstituteAccount,
  UpdateInstituteAccount,
  GetInstituteAccounts,
  GetSingleInstituteAccount,
  GetSingleUserInstitutes,
  GetSingleUserInstitutesTeacherAccounts,
  GetLibraryAccounts,
  UpdateLibraryAccess, 
  DeleteLibraryAccess,
  INTERNAL_APPS,
  VALID_APP_TYPES,
  LIBRARY_ACCOUNT_TYPES,
};