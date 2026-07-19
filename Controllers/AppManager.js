const bcrypt = require("bcryptjs");
const ExecuteQuery = require("../Functions/ExecuteQuery");
const { RegisterAuditAction } = require("./Auditory");
const Cache = require("../Functions/CacheRoutes");

// ══════════════════════════════════════════════════════════════════════════════
// 🎨 CONFIGURAÇÃO DE CORES PARA CONSOLE
// ══════════════════════════════════════════════════════════════════════════════

const C = {
  reset:      "\x1b[0m",
  bold:       "\x1b[1m",
  dim:        "\x1b[2m",
  red:        "\x1b[31m",
  green:      "\x1b[32m",
  yellow:     "\x1b[33m",
  blue:       "\x1b[34m",
  magenta:    "\x1b[35m",
  cyan:       "\x1b[36m",
  white:      "\x1b[37m",
  bgRed:      "\x1b[41m",
  bgGreen:    "\x1b[42m",
  bgBlue:     "\x1b[44m",
  bgYellow:   "\x1b[43m",
  bgCyan:     "\x1b[46m",
  bgMagenta:  "\x1b[45m",
};

const LINE  = "─".repeat(80);
const LINE2 = "═".repeat(80);

// ══════════════════════════════════════════════════════════════════════════════
// ⚙️ CONSTANTES E CONFIGURAÇÕES
// ══════════════════════════════════════════════════════════════════════════════

const BCRYPT_ROUNDS = 12;
const DEFAULT_PASSWORD = "123Eduallsoft@#";
const LIBRARY_ACCESS_CACHE_TTL = 1800; // 30 minutos

// ── Cache Keys ────────────────────────────────────────────────────────────────
const CacheKeys = {
  libraryAccess: (userId, instituteCode) => `library_access:${userId}:${instituteCode}`,
  libraryUsersList: (instituteCode) => `library_users:list:${instituteCode}`,
};

// ── Apps Internos ──────────────────────────────────────────────────────────────
const INTERNAL_APPS = {
  library:  { label: "Biblioteca",       licenceType: 10 },
  hr:       { label: "Recursos Humanos", licenceType: 11 },
  security: { label: "Segurança / CCTV", licenceType: 12 },
};
const VALID_APP_TYPES = Object.keys(INTERNAL_APPS);

// ── Tipos de Contas de Biblioteca ──────────────────────────────────────────────
const LIBRARY_ACCOUNT_TYPES = ["admin", "reader"];


// ══════════════════════════════════════════════════════════════════════════════
// 🔧 GERADOR DE USERNAME (definido cedo porque é usado por várias funções)
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Remover acentos de string
 */
const removeAccents = (str) =>
  str.normalize("NFD").replace(/[\u0300-\u036f]/g, "");

/**
 * Validar email
 */
const isValidEmail = (email) =>
  /^[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}$/.test(email);

/**
 * Gerar username único baseado no nome
 */
const generateUsername = async (name, appType) => {
  const clean = removeAccents(String(name || "user").toLowerCase().replace(/[^a-z\s]/g, "").trim());
  const parts = clean.split(/\s+/).filter(Boolean);

  let base = parts[0] || "user";
  if (parts.length > 1) {
    const last = parts[parts.length - 1];
    base += last.substring(0, Math.min(4, last.length));
  }
  base = base.substring(0, 8);

  const alphanum = "abcdefghjkmnpqrstuvwxyz23456789";
  const randomSuffix = () =>
    Array.from({ length: 6 }, () => alphanum[Math.floor(Math.random() * alphanum.length)]).join("");

  let username = `${base}${randomSuffix()}`;
  let attempts = 0;

  while (attempts < 20) {
    const exists = await ExecuteQuery(
      null,
      `SELECT COUNT(*) AS cnt FROM eduall_system_accounts
       WHERE ed_system_account_deleted = 0 AND ed_system_account_name = ?`,
      [username],
      true,
      { db: "eduall_system_accounts", type: "select" }
    );
    if ((exists?.[0]?.cnt ?? 1) === 0) break;
    username = `${base}${randomSuffix()}`;
    attempts++;
  }

  return username;
};


// ══════════════════════════════════════════════════════════════════════════════
// 🔑 GARANTIR ACESSO DE SISTEMA (CORRIGIDO)
// ══════════════════════════════════════════════════════════════════════════════
//
// CONCEITOS-CHAVE (importante para não voltar a partir isto):
//
//  • eduall_user_accounts        → a conta Eduall da pessoa (login/email/password)
//  • eduall_system_accounts      → "perfis" de sistema ligados a um funcionário.
//        - ed_system_account_app_type = 'library' / 'hr' / 'security'  → perfil de UMA app
//        - ed_system_account_app_type IS NULL                          → perfil "dashboard"
//          (é este que dá acesso ao painel principal / menus gerais)
//  • eduall_user_access          → permissões de menus do painel principal.
//        ed_user_access_usercode DEVE conter o ed_system_account_id da conta
//        de sistema "dashboard" (app_type IS NULL) — NÃO o ed_user_account_id.
//
// Esta é exactamente a relação usada pelo GetLibraryUsers para calcular
// "hasSystemAccess":
//
//   LEFT JOIN eduall_system_accounts sad
//          ON sad.ed_system_account_employee = ea.ed_employee_id
//         AND sad.ed_system_account_app_type IS NULL
//   LEFT JOIN eduall_user_access uac
//          ON uac.ed_user_access_usercode = sad.ed_system_account_id
//
// O bug anterior guardava ed_user_account_id em ed_user_access_usercode,
// o que nunca batia certo com este JOIN — por isso os utilizadores da
// Biblioteca apareciam sempre como "sem acesso de sistema", mesmo depois
// de correr createAccessIfNotExists.
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Garante que existe uma conta de sistema "dashboard" (app_type IS NULL)
 * para o funcionário indicado. Cria-a se não existir.
 */
async function ensureDashboardSystemAccount(res, employeeId, userAccountId, instituteCode, displayName) {
  const existingDash = await ExecuteQuery(
    res,
    `SELECT ed_system_account_id, ed_system_account_name
     FROM eduall_system_accounts
     WHERE ed_system_account_employee = ?
       AND ed_system_account_institute_code = ?
       AND ed_system_account_app_type IS NULL
       AND ed_system_account_deleted = 0
     LIMIT 1`,
    [employeeId, instituteCode],
    true,
    { db: "eduall_system_accounts", type: "select" }
  );

  if (existingDash?.length) {
    return {
      systemAccountId: existingDash[0].ed_system_account_id,
      username: existingDash[0].ed_system_account_name,
      created: false,
    };
  }

  const username = await generateUsername(displayName || "user", "dashboard");

  await ExecuteQuery(
    res,
    `INSERT INTO eduall_system_accounts
       (ed_system_account_name, ed_system_account_employee,
        ed_system_account_userid, ed_system_account_institute_code,
        ed_system_account_app_type)
     VALUES (?, ?, ?, ?, NULL)`,
    [username, employeeId, userAccountId, instituteCode],
    false,
    { db: "eduall_system_accounts", type: "insert" }
  );

  const created = await ExecuteQuery(
    res,
    `SELECT ed_system_account_id FROM eduall_system_accounts
     WHERE ed_system_account_employee = ?
       AND ed_system_account_institute_code = ?
       AND ed_system_account_app_type IS NULL
       AND ed_system_account_deleted = 0
     ORDER BY ed_system_account_id DESC
     LIMIT 1`,
    [employeeId, instituteCode],
    true,
    { db: "eduall_system_accounts", type: "select" }
  );

  return {
    systemAccountId: created?.[0]?.ed_system_account_id ?? null,
    username,
    created: true,
  };
}

/**
 * Garante que existe o registo em eduall_user_access para a conta de
 * sistema "dashboard" indicada (identificada por systemAccountId).
 */
async function ensureUserAccessRow(res, systemAccountId, instituteCode) {
  if (!systemAccountId) {
    return { created: false, reason: "systemAccountId em falta" };
  }

  const existingAccess = await ExecuteQuery(
    res,
    `SELECT ed_user_access_id FROM eduall_user_access WHERE ed_user_access_usercode = ?`,
    [String(systemAccountId)],
    true,
    { db: "eduall_user_access", type: "select" }
  );

  if (existingAccess && existingAccess.length > 0) {
    return { created: false, alreadyExisted: true };
  }

  await ExecuteQuery(
    res,
    `INSERT INTO eduall_user_access
       (ed_user_access_usercode, ed_user_access_pedagogicalarea, ed_user_access_myinstitute,
        ed_user_access_portal, ed_user_access_secretary, ed_user_access_configuration,
        ed_user_access_finances, ed_user_access_administration, ed_user_access_library,
        ed_user_access_transportation, ed_user_access_others, ed_user_access_apps,
        ed_user_access_system, ed_user_access_institute_code, ed_user_access_registerDate)
     VALUES (?, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, ?, NOW())`,
    [String(systemAccountId), instituteCode],
    false,
    { db: "eduall_user_access", type: "insert" }
  );

  return { created: true };
}

/**
 * Ponto de entrada principal.
 *
 *  - Com userId  → garante acesso de sistema para ESSE utilizador.
 *  - Sem userId  → garante acesso de sistema para TODOS os utilizadores
 *                  da Biblioteca (app_type = 'library') do instituto.
 */
async function createAccessIfNotExists(res, userId = null, instituteCode) {
  try {
    if (!instituteCode) {
      console.log(`${C.red}❌ instituteCode é obrigatório${C.reset}`);
      return { success: false, created: 0, error: "instituteCode é obrigatório" };
    }

    const startTime = Date.now();

    // ════════════════════════════════════════════════════════════════════════
    // MODO 1: userId específico
    // ════════════════════════════════════════════════════════════════════════
    if (userId) {
      // Localizar o funcionário associado a este utilizador, através de
      // qualquer conta de sistema existente (ex.: a de 'library').
      const employeeLookup = await ExecuteQuery(
        res,
        `SELECT sa.ed_system_account_employee AS employee_id, ua.ed_user_account_name AS user_name
         FROM eduall_system_accounts sa
         INNER JOIN eduall_user_accounts ua ON ua.ed_user_account_id = sa.ed_system_account_userid
         WHERE sa.ed_system_account_userid = ?
           AND sa.ed_system_account_institute_code = ?
           AND sa.ed_system_account_deleted = 0
           AND sa.ed_system_account_status = 1
         LIMIT 1`,
        [userId, instituteCode],
        true,
        { db: "eduall_system_accounts", type: "select" }
      );

      if (!employeeLookup || employeeLookup.length === 0) {
        console.log(`${C.red}❌ System account não encontrado (${userId})${C.reset}`);
        return { success: false, created: 0, message: "System account não encontrado" };
      }

      const employeeId = employeeLookup[0].employee_id;
      const displayName = employeeLookup[0].user_name;

      if (!employeeId) {
        console.log(`${C.red}❌ Utilizador ${userId} sem funcionário associado${C.reset}`);
        return { success: false, created: 0, message: "Utilizador sem funcionário associado" };
      }

      const dash = await ensureDashboardSystemAccount(res, employeeId, userId, instituteCode, displayName);
      const access = await ensureUserAccessRow(res, dash.systemAccountId, instituteCode);

      const elapsed = Date.now() - startTime;

      if (access.alreadyExisted) {
        console.log(`${C.yellow}📦 User ${userId} já tem acesso de sistema (${dash.username}) (+${elapsed}ms)${C.reset}`);
        return { success: true, created: 0, message: "User já tem acesso" };
      }

      console.log(`${C.green}✅ Acesso criado: ${displayName} / ${dash.username} (+${elapsed}ms)${C.reset}`);
      return { success: true, created: 1, message: "Acesso criado com sucesso" };
    }

    // ════════════════════════════════════════════════════════════════════════
    // MODO 2: TODOS os utilizadores da Biblioteca do instituto
    // ════════════════════════════════════════════════════════════════════════
    const libraryUsers = await ExecuteQuery(
      res,
      `SELECT DISTINCT
         sa.ed_system_account_userid   AS user_id,
         sa.ed_system_account_employee AS employee_id,
         ua.ed_user_account_name       AS user_name
       FROM eduall_system_accounts sa
       INNER JOIN eduall_user_accounts ua ON ua.ed_user_account_id = sa.ed_system_account_userid
       WHERE sa.ed_system_account_institute_code = ?
         AND sa.ed_system_account_app_type = 'library'
         AND sa.ed_system_account_deleted = 0
         AND sa.ed_system_account_status = 1
         AND ua.ed_user_account_deleted = 0
         AND ua.ed_user_account_status = 1`,
      [instituteCode],
      true,
      { db: "eduall_system_accounts", type: "select" }
    );

    if (!libraryUsers || libraryUsers.length === 0) {
      console.log(`${C.yellow}ℹ️  Nenhum user da Biblioteca encontrado em ${instituteCode}${C.reset}`);
      return { success: true, created: 0, message: "Nenhum user encontrado", total: 0, processed: 0 };
    }

    let successCount = 0;
    let skippedCount = 0;
    let errorCount = 0;

    console.log(`${C.blue}📋 Processando ${libraryUsers.length} users (${instituteCode})...${C.reset}`);

    for (const user of libraryUsers) {
      try {
        if (!user.employee_id) {
          console.log(`${C.yellow}⚠️  ${user.user_name} sem funcionário associado — ignorado${C.reset}`);
          errorCount++;
          continue;
        }

        const dash = await ensureDashboardSystemAccount(res, user.employee_id, user.user_id, instituteCode, user.user_name);
        const access = await ensureUserAccessRow(res, dash.systemAccountId, instituteCode);

        if (access.alreadyExisted) {
          console.log(`${C.dim}📦 ${user.user_name} já tinha acesso de sistema${C.reset}`);
          skippedCount++;
        } else {
          console.log(`${C.green}✅ ${user.user_name} (${dash.username})${C.reset}`);
          successCount++;
        }
      } catch (error) {
        console.log(`${C.red}❌ ${user.user_name} - ${error.message}${C.reset}`);
        errorCount++;
      }
    }

    const elapsed = Date.now() - startTime;
    console.log(`${C.cyan}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${C.reset}`);
    console.log(`${C.green}✅ Criados: ${successCount} | 📦 Já existiam: ${skippedCount} | ❌ Erros: ${errorCount} | ⏱️  ${elapsed}ms${C.reset}`);

    return {
      success: errorCount === 0,
      created: successCount,
      message: `${successCount} acesso(s) de sistema criado(s) com sucesso`,
      total: libraryUsers.length,
      processed: successCount + skippedCount,
      skipped: skippedCount,
      errors: errorCount,
    };

  } catch (error) {
    console.log(`${C.red}❌ ERRO: ${error.message}${C.reset}`);
    return { success: false, created: 0, error: error.message };
  }
}


// ══════════════════════════════════════════════════════════════════════════════
// 🔑 CHAVES DE ACESSO PADRONIZADAS (24 MENUS)
// ══════════════════════════════════════════════════════════════════════════════

const LIBRARY_MENU_KEYS = {
  dashboard: "lib_dashboard",
  books: "lib_books",
  authors: "lib_authors",
  categories: "lib_categories",
  publishers: "lib_publishers",
  shelves: "lib_shelves",
  digital_contents: "lib_digital_contents",
  scientific_publications: "lib_scientific_publications",
  exemplars: "lib_exemplars",
  rfid_movement: "lib_rfid_movement",
  loans: "lib_loans",
  reservations: "lib_reservations",
  fines: "lib_fines",
  products: "lib_products",
  orders: "lib_orders",
  payments: "lib_payments",
  reconciliation: "lib_reconciliation",
  users: "lib_users",
  notifications: "lib_notifications",
  audit: "lib_audit",
  most_borrowed: "lib_most_borrowed",
  fines_by_month: "lib_fines_by_month",
  sales_revenue: "lib_sales_revenue",
  usage_by_user: "lib_usage_by_user",
};

// ── Acessos ADMIN (todos os 24) ────────────────────────────────────────────────
const ADMIN_LIBRARY_ACCESS = Object.values(LIBRARY_MENU_KEYS).reduce((acc, key) => {
  acc[key] = 1;
  return acc;
}, {});

// ── Acessos READER (13 menus de leitura) ───────────────────────────────────────
const READER_LIBRARY_ACCESS = {
  lib_dashboard: 1,
  lib_books: 1,
  lib_authors: 1,
  lib_categories: 1,
  lib_publishers: 1,
  lib_shelves: 1,
  lib_digital_contents: 1,
  lib_scientific_publications: 1,
  lib_exemplars: 1,
  lib_loans: 1,
  lib_reservations: 1,
  lib_fines: 1,
  lib_products: 1,
};

// ══════════════════════════════════════════════════════════════════════════════
// 🛠️ FUNÇÕES HELPER
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Adicionar/atualizar acessos biblioteca (usando ed_user_account_id como FK)
 */
const ensureLibraryAccess = async (userId, instituteCode, libraryAccountType, libraryMenuAccess, req, res) => {
  let menuAccessObj = {};

  if (libraryAccountType === "admin") {
    menuAccessObj = { ...ADMIN_LIBRARY_ACCESS };
  } else if (libraryAccountType === "reader") {
    if (libraryMenuAccess && typeof libraryMenuAccess === "object") {
      menuAccessObj = libraryMenuAccess;
    } else if (libraryMenuAccess && typeof libraryMenuAccess === "string") {
      try {
        menuAccessObj = JSON.parse(libraryMenuAccess);
      } catch (e) {
        menuAccessObj = { ...READER_LIBRARY_ACCESS };
      }
    } else {
      menuAccessObj = { ...READER_LIBRARY_ACCESS };
    }
  }

  const menuAccessJson = JSON.stringify(menuAccessObj);

  const existing = await ExecuteQuery(
    res,
    `SELECT ed_library_access_id FROM eduall_library_access
     WHERE ed_library_access_user_id = ? 
       AND ed_library_access_institute_code = ?
       AND ed_library_access_deleted = 0
     LIMIT 1`,
    [userId, instituteCode],
    true,
    { db: "eduall_library_access", type: "select", data: req }
  );

  if (existing?.length) {
    // ATUALIZA acesso existente
    await ExecuteQuery(
      res,
      `UPDATE eduall_library_access 
       SET ed_library_access_account_type = ?,
           ed_library_access_menu_access = ?
       WHERE ed_library_access_user_id = ?
         AND ed_library_access_institute_code = ?`,
      [libraryAccountType, menuAccessJson, userId, instituteCode],
      false,
      { db: "eduall_library_access", type: "update", data: req }
    );
  } else {
    // CRIA novo registro de acesso
    await ExecuteQuery(
      res,
      `INSERT INTO eduall_library_access
         (ed_library_access_user_id, ed_library_access_institute_code,
          ed_library_access_account_type, ed_library_access_menu_access)
       VALUES (?, ?, ?, ?)`,
      [userId, instituteCode, libraryAccountType, menuAccessJson],
      false,
      { db: "eduall_library_access", type: "insert", data: req }
    );
  }

  const menuAccessCount = Object.values(menuAccessObj).filter(v => v === 1).length;

  return { success: true, menuAccessCount };
};

// ══════════════════════════════════════════════════════════════════════════════
// 🔐 REGISTER APP MANAGER
// ══════════════════════════════════════════════════════════════════════════════

const RegisterAppManager = async (req, res) => {
  try {
    const instituteCode = req.session?.user?.eduall_user_session_curentinstitute;
    if (!instituteCode)
      return res.status(403).json({ success: false, msg: "Acesso negado: instituição não encontrada na sessão." });

    const {
      manager_name,
      manager_email,
      manager_phone          = "",
      manager_country        = "",
      manager_app_type,
      libraryAccountType     = "admin",
      library_menu_access    = null,
    } = req.body;

    console.log(`\n${C.bold}${C.bgBlue}${C.white}  ▶ REGISTER APP MANAGER  ${C.reset}`);
    console.log(`${C.blue}${LINE2}${C.reset}`);
    console.log(`${C.yellow}Body:${C.reset} name=${manager_name}, email=${manager_email}, appType=${manager_app_type}`);

    // ── Validações básicas ────────────────────────────────────────────────────
    const nameTrimmed = (manager_name || "").trim();

    if (!nameTrimmed || nameTrimmed.length < 3)
      return res.status(400).json({ msg: "Nome inválido (mínimo 3 caracteres)!" });

    if (nameTrimmed.length > 100)
      return res.status(400).json({ msg: "Nome inválido (máximo 100 caracteres)!" });

    if (!isValidEmail(manager_email))
      return res.status(400).json({ msg: "Email inválido!" });

    if (!VALID_APP_TYPES.includes(manager_app_type))
      return res.status(400).json({ msg: `Tipo de app inválido: ${manager_app_type}` });

    const appMeta = INTERNAL_APPS[manager_app_type];

    // ── Validação específica para LIBRARY ─────────────────────────────────────
    if (manager_app_type === "library") {
      if (libraryAccountType !== "admin") {
        console.log(`${C.yellow}⚠️  Forçando libraryAccountType para admin (nova conta biblioteca)${C.reset}`);
      }
    }

    // ── Verificar se email já existe em eduall_user_accounts ──────────────────
    console.log(`${C.cyan}Verificando se utilizador já existe...${C.reset}`);

    const existingUser = await ExecuteQuery(
      res,
      `SELECT ed_user_account_id, ed_user_account_name, ed_user_account_email 
       FROM eduall_user_accounts
       WHERE ed_user_account_deleted = 0 AND ed_user_account_email = ?
       LIMIT 1`,
      [manager_email.trim().toLowerCase()],
      true,
      { db: "eduall_user_accounts", type: "select", data: req }
    );

    // ════════════════════════════════════════════════════════════════════════════
    // CASO 1: UTILIZADOR JÁ EXISTE → DAR ACESSOS BIBLIOTECA + GARANTIR SISTEMA
    // ════════════════════════════════════════════════════════════════════════════
    if (existingUser?.length) {
      const existingUserData = existingUser[0];
      const userId = existingUserData.ed_user_account_id;

      console.log(`${C.green}✅ Utilizador já existe:${C.reset} ${existingUserData.ed_user_account_name}`);
      console.log(`${C.cyan}Adicionando acessos à biblioteca...${C.reset}`);

      if (manager_app_type === "library") {
        const licence = await ExecuteQuery(
          res,
          `SELECT ed_institute_app_id FROM eduall_institute_apps
           WHERE ed_institute_app_instituteCode = ?
             AND ed_institute_app_type = ?
             AND ed_institute_app_deleted = 0
             AND ed_institute_app_endDate > NOW()
           LIMIT 1`,
          [instituteCode, manager_app_type],
          true,
          { db: "eduall_institute_apps", type: "select", data: req }
        );

        if (!licence?.length)
          return res.status(403).json({
            msg: `A instituição não possui licença válida para "${appMeta.label}".`,
          });
      }

      // ADICIONAR ACESSOS BIBLIOTECA COM ADMIN RIGHTS
      const libraryAccessResult = await ensureLibraryAccess(
        userId,
        instituteCode,
        "admin",
        null,
        req,
        res
      );

      if (res.headersSent) return;

      // ✅ GARANTIR TAMBÉM O ACESSO DE SISTEMA (conta dashboard)
      await createAccessIfNotExists(res, userId, instituteCode);
      if (res.headersSent) return;

      // Invalidar cache
      await Cache.eduallDel(CacheKeys.libraryAccess(userId, instituteCode));
      await Cache.eduallDel(CacheKeys.libraryUsersList(instituteCode));

      // Auditoria
      await RegisterAuditAction({
        session: req.session,
        action: 1,
        form: "Gestores de App",
        description: `Adicionou utilizador existente "${existingUserData.ed_user_account_name}" (${manager_email.trim().toLowerCase()}) à Biblioteca com admin rights (${libraryAccessResult.menuAccessCount} acessos)`,
      }).catch(() => {});

      console.log(`${C.green}✅ Acessos biblioteca adicionados com sucesso (admin, ${libraryAccessResult.menuAccessCount} menus)${C.reset}\n`);

      return res.status(200).json({
        success: true,
        msg: `Utilizador "${existingUserData.ed_user_account_name}" adicionado à Biblioteca com admin rights!`,
        isExistingUser: true,
        userId,
        name: existingUserData.ed_user_account_name,
        email: existingUserData.ed_user_account_email,
        appType: manager_app_type,
        appLabel: appMeta.label,
        libraryAccountType: "admin",
        libraryMenuAccessCount: libraryAccessResult.menuAccessCount,
      });
    }

    // ════════════════════════════════════════════════════════════════════════════
    // CASO 2: UTILIZADOR NÃO EXISTE → CRIAR TUDO
    // ════════════════════════════════════════════════════════════════════════════

    console.log(`${C.cyan}Utilizador não existe. Criando nova conta...${C.reset}`);

    // ── Verificar licença ─────────────────────────────────────────────────────
    const licence = await ExecuteQuery(
      res,
      `SELECT ed_institute_app_id FROM eduall_institute_apps
       WHERE ed_institute_app_instituteCode = ?
         AND ed_institute_app_type = ?
         AND ed_institute_app_deleted = 0
         AND ed_institute_app_endDate > NOW()
       LIMIT 1`,
      [instituteCode, manager_app_type],
      true,
      { db: "eduall_institute_apps", type: "select", data: req }
    );

    if (!licence?.length)
      return res.status(403).json({
        msg: `A instituição não possui licença válida para "${appMeta.label}". Adquira ou renove a licença.`,
      });

    // ── Criar funcionário ─────────────────────────────────────────────────────
    const picturePath = req.file ? `images/employees/${req.file.filename}` : "";

    const employeeCode = Array.from({ length: 32 }, () =>
      "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789"[
        Math.floor(Math.random() * 62)
      ]
    ).join("");

    await ExecuteQuery(
      res,
      `INSERT INTO eduall_employees
         (ed_employee_name, ed_employee_email, ed_employee_phone,
          ed_employee_picture, ed_employee_code,
          ed_employee_institute_code, ed_employee_status)
       VALUES (?, ?, ?, ?, ?, ?, 1)`,
      [
        nameTrimmed,
        manager_email.trim().toLowerCase(),
        manager_phone.trim(),
        picturePath,
        employeeCode,
        instituteCode,
      ],
      false,
      { db: "eduall_employees", type: "insert", data: req }
    );

    const empRows = await ExecuteQuery(
      res,
      `SELECT ed_employee_id FROM eduall_employees
       WHERE ed_employee_code = ? AND ed_employee_institute_code = ?
       LIMIT 1`,
      [employeeCode, instituteCode],
      true,
      { db: "eduall_employees", type: "select", data: req }
    );

    const employeeId = empRows?.[0]?.ed_employee_id;

    // ── Criar conta Eduall ────────────────────────────────────────────────────
    const rawPassword  = DEFAULT_PASSWORD;
    const salt         = await bcrypt.genSalt(BCRYPT_ROUNDS);
    const hashPassword = await bcrypt.hash(rawPassword, salt);

    await ExecuteQuery(
      res,
      `INSERT INTO eduall_user_accounts
         (ed_user_account_name, ed_user_account_email,
          ed_user_account_password, ed_user_account_country)
       VALUES (?, ?, ?, ?)`,
      [
        nameTrimmed,
        manager_email.trim().toLowerCase(),
        hashPassword,
        manager_country.trim() || "AO",
      ],
      false,
      { db: "eduall_user_accounts", type: "insert", data: req }
    );

    const userRows = await ExecuteQuery(
      res,
      `SELECT ed_user_account_id FROM eduall_user_accounts
       WHERE ed_user_account_deleted = 0
         AND ed_user_account_email = ?
       LIMIT 1`,
      [manager_email.trim().toLowerCase()],
      true,
      { db: "eduall_user_accounts", type: "select", data: req }
    );

    const userId = userRows?.[0]?.ed_user_account_id;

    // ── Criar conta de sistema (app_type = manager_app_type, ex.: 'library') ──
    const username = await generateUsername(nameTrimmed, manager_app_type);

    await ExecuteQuery(
      res,
      `INSERT INTO eduall_system_accounts
         (ed_system_account_name, ed_system_account_employee,
          ed_system_account_userid, ed_system_account_institute_code,
          ed_system_account_app_type)
       VALUES (?, ?, ?, ?, ?)`,
      [username, employeeId, userId, instituteCode, manager_app_type],
      false,
      { db: "eduall_system_accounts", type: "insert", data: req }
    );

    // ── Adicionar acessos biblioteca (se for library) ──────────────────────────
    let libraryMenuAccessCount = 0;
    if (manager_app_type === "library") {
      const libraryAccessResult = await ensureLibraryAccess(
        userId,
        instituteCode,
        "admin",
        null,
        req,
        res
      );
      if (res.headersSent) return;
      libraryMenuAccessCount = libraryAccessResult.menuAccessCount;

      await Cache.eduallDel(CacheKeys.libraryAccess(userId, instituteCode));
      await Cache.eduallDel(CacheKeys.libraryUsersList(instituteCode));
    }

    // ✅ GARANTIR TAMBÉM A CONTA DE SISTEMA "DASHBOARD" (app_type NULL)
    // — é o que permite que este utilizador apareça como "com acesso de
    // sistema" em GetLibraryUsers, e que tenha um eduall_user_access válido.
    await createAccessIfNotExists(res, userId, instituteCode);
    if (res.headersSent) return;

    // ── Registar auditoria ────────────────────────────────────────────────────
    const auditDescription = manager_app_type === "library"
      ? `Criou gestor "${nameTrimmed}" (${manager_email}) para a app "${appMeta.label}" com username "${username}" (admin, ${libraryMenuAccessCount} acessos)`
      : `Criou gestor "${nameTrimmed}" (${manager_email}) para a app "${appMeta.label}" com username "${username}"`;

    await RegisterAuditAction({
      session: req.session,
      action: 1,
      form: "Gestores de App",
      description: auditDescription,
    }).catch(() => {});

    console.log(`${C.green}✅ Conta criada com sucesso (funcionário + user Eduall + system account + acessos biblioteca + acesso de sistema)${C.reset}\n`);

    // ── Resposta de sucesso ───────────────────────────────────────────────────
    return res.status(200).json({
      success: true,
      msg: `Conta criada com sucesso para ${appMeta.label}!`,
      isExistingUser: false,
      username,
      password: rawPassword,
      employeeId,
      userId,
      appType: manager_app_type,
      appLabel: appMeta.label,
      name: nameTrimmed,
      email: manager_email.trim().toLowerCase(),
      libraryAccountType: manager_app_type === "library" ? "admin" : null,
      libraryMenuAccessCount: manager_app_type === "library" ? libraryMenuAccessCount : null,
    });

  } catch (err) {
    console.error("❌ [RegisterAppManager]", err.message || err);
    if (!res.headersSent)
      return res.status(500).json({ msg: "Erro ao estabelecer ligação com o servidor.", error: err.message });
  }
};

// ══════════════════════════════════════════════════════════════════════════════
// 📚 GET LIBRARY ACCESS
// ══════════════════════════════════════════════════════════════════════════════

const GetLibraryAccess = async (req, res) => {
  try {
    const userId = req.session?.user?.eduall_user_session_ID;
    const instituteCode = req.session?.user?.eduall_user_session_curentinstitute;

    console.log(`\n${C.bold}${C.bgCyan}${C.white}  GET LIBRARY ACCESS  ${C.reset}`);
    console.log(`${C.cyan}${LINE2}${C.reset}`);
    console.log(`${C.bold}${C.blue}Dados da Sessao:${C.reset}`);
    console.log(`${C.blue}  userId:${C.reset} ${C.yellow}${userId || 'undefined'}${C.reset}`);
    console.log(`${C.blue}  instituteCode:${C.reset} ${C.yellow}${instituteCode || 'undefined'}${C.reset}`);
    console.log(`${C.cyan}${LINE}${C.reset}\n`);

    if (!userId || !instituteCode) {
      console.log(`${C.red}${C.bold}ERRO:${C.reset} ${C.red}Utilizador nao autenticado${C.reset}\n`);
      return res.status(403).json({
        success: false,
        msg: "Utilizador nao autenticado ou instituicao nao encontrada.",
        accountType: null,
        menuAccess: {},
        userData: null,
      });
    }

    const cacheKey = CacheKeys.libraryAccess(userId, instituteCode);
    const cached = await Cache.eduallGet(cacheKey);

    if (cached !== null) {
      console.log(`${C.green}${C.bold}CACHE HIT${C.reset}\n`);
      return res.status(200).json(cached);
    }

    console.log(`${C.yellow}${C.bold}CACHE MISS${C.reset} - Buscando da BD\n`);

    console.log(`${C.bold}${C.magenta}1. Buscando dados de utilizador...${C.reset}`);

    const userAccount = await ExecuteQuery(
      res,
      `SELECT 
         ed_user_account_id,
         ed_user_account_name,
         ed_user_account_email,
         ed_user_account_picture,
         ed_user_account_country,
         ed_user_account_status,
         ed_userregisterdate
       FROM eduall_user_accounts
       WHERE ed_user_account_id = ? AND ed_user_account_deleted = 0
       LIMIT 1`,
      [userId],
      true,
      { db: "eduall_user_accounts", type: "select", data: req }
    );

    if (!userAccount?.length) {
      console.log(`${C.red}${C.bold}ERRO:${C.reset} ${C.red}Utilizador nao encontrado${C.reset}\n`);
      return res.status(404).json({
        success: false,
        msg: "Utilizador nao encontrado",
        userData: null,
      });
    }

    const user = userAccount[0];
    console.log(`${C.green}Utilizador encontrado: ${user.ed_user_account_name}${C.reset}`);
    console.log(`${C.cyan}${LINE}${C.reset}\n`);

    console.log(`${C.bold}${C.magenta}2. Buscando acessos a biblioteca...${C.reset}`);

    const libAccess = await ExecuteQuery(
      res,
      `SELECT 
         ed_library_access_id,
         ed_library_access_user_id,
         ed_library_access_account_type,
         ed_library_access_menu_access
       FROM eduall_library_access
       WHERE ed_library_access_user_id = ?
         AND ed_library_access_institute_code = ?
         AND ed_library_access_deleted = 0
       LIMIT 1`,
      [userId, instituteCode],
      true,
      { db: "eduall_library_access", type: "select", data: req }
    );

    let libAcc = null;
    let isNewAccess = false;

    if (!libAccess?.length) {
      console.log(`${C.yellow}Nenhum registo encontrado - criando novo registo reader${C.reset}`);

      const emptyMenuAccess = "{}";
      const readerType = "reader";

      console.log(`${C.bold}${C.magenta}2.1 Criando novo registo...${C.reset}`);
      console.log(`${C.blue}  accountType: ${readerType}${C.reset}`);
      console.log(`${C.blue}  menuAccess: ${emptyMenuAccess}${C.reset}`);

      await ExecuteQuery(
        res,
        `INSERT INTO eduall_library_access 
         (ed_library_access_user_id, ed_library_access_institute_code, ed_library_access_account_type, ed_library_access_menu_access)
         VALUES (?, ?, ?, ?)`,
        [userId, instituteCode, readerType, emptyMenuAccess],
        false,
        { db: "eduall_library_access", type: "insert", data: req }
      );

      if (res.headersSent) return;

      const newRecord = await ExecuteQuery(
        res,
        `SELECT ed_library_access_id FROM eduall_library_access
         WHERE ed_library_access_user_id = ?
           AND ed_library_access_institute_code = ?
           AND ed_library_access_deleted = 0
         ORDER BY ed_library_access_id DESC
         LIMIT 1`,
        [userId, instituteCode],
        true,
        { db: "eduall_library_access", type: "select", data: req }
      );

      if (!newRecord?.length) {
        console.log(`${C.red}Erro ao encontrar registo criado${C.reset}\n`);
        return res.status(500).json({
          success: false,
          msg: "Erro ao criar acesso a biblioteca",
          userData: {
            user: user,
            libraryAccess: null,
          },
        });
      }

      console.log(`${C.green}Registo criado com sucesso${C.reset}`);
      libAcc = {
        ed_library_access_id: newRecord[0].ed_library_access_id,
        ed_library_access_user_id: userId,
        ed_library_access_account_type: readerType,
        ed_library_access_menu_access: emptyMenuAccess,
      };
      isNewAccess = true;
    } else {
      console.log(`${C.green}Registo ja existe - usando existente${C.reset}`);
      libAcc = libAccess[0];
      isNewAccess = false;
    }

    let accountTypeRaw = libAcc.ed_library_access_account_type;
    if (accountTypeRaw === null || accountTypeRaw === undefined) {
      accountTypeRaw = "reader";
    }

    const normalizedType = String(accountTypeRaw).trim().toLowerCase();
    const isAdmin = (normalizedType === "1" || normalizedType === "admin");
    const accountType = isAdmin ? "admin" : "reader";

    let menuAccess = {};

    console.log(`${C.blue}  Tipo de Conta (raw):${C.reset} ${C.cyan}${accountTypeRaw}${C.reset}`);
    console.log(`${C.blue}  Tipo de Conta (parsed):${C.reset} ${C.cyan}${accountType.toUpperCase()}${C.reset}`);
    console.log(`${C.blue}  IsAdmin:${C.reset} ${C.cyan}${isAdmin}${C.reset}`);

    if (isAdmin) {
      console.log(`${C.green}Admin detectado - Todos os acessos${C.reset}`);
      menuAccess = { ...ADMIN_LIBRARY_ACCESS };
    } else {
      console.log(`${C.yellow}Nao e admin - usando menuAccess da BD${C.reset}`);

      if (libAcc.ed_library_access_menu_access) {
        try {
          const rawMenu = libAcc.ed_library_access_menu_access;
          const parsed = typeof rawMenu === "string" ? JSON.parse(rawMenu) : rawMenu;
          menuAccess = parsed || {};
        } catch (e) {
          console.warn(`${C.yellow}Erro ao parsear JSON${C.reset}`);
          menuAccess = {};
        }
      } else {
        menuAccess = {};
      }
    }

    const totalAccess = Object.values(menuAccess).filter(v => v === 1).length;
    console.log(`${C.blue}  Total de Acessos:${C.reset} ${C.cyan}${totalAccess} / 24${C.reset}`);

    console.log(`\n${C.bold}${C.magenta}3. Resumo de Acessos:${C.reset}`);
    const accessList = Object.entries(menuAccess)
      .filter(([_, value]) => value === 1)
      .map(([key, _]) => key);

    if (accessList.length > 0) {
      console.log(`${C.blue}Acessos permitidos:${C.reset}`);
      accessList.forEach(access => {
        console.log(`${C.green}  ✓ ${access}${C.reset}`);
      });
    } else {
      console.log(`${C.yellow}Sem acessos configurados${C.reset}`);
    }

    console.log(`${C.cyan}${LINE}${C.reset}\n`);

    const userData = {
      user: {
        id: user.ed_user_account_id,
        name: user.ed_user_account_name,
        email: user.ed_user_account_email,
        picture: user.ed_user_account_picture,
        country: user.ed_user_account_country,
        status: user.ed_user_account_status,
        registerDate: user.ed_userregisterdate,
      },
      libraryAccess: {
        id: libAcc.ed_library_access_id,
        accountType: accountType,
        menuAccess: menuAccess,
        totalMenuCount: totalAccess,
        isNewRecord: isNewAccess,
      },
    };

    const debugInfo = {
      timestamp: new Date().toISOString(),
      userId: userId,
      instituteCode: instituteCode,
      accountTypeRaw: accountTypeRaw,
      isAdmin: isAdmin,
      menuAccessCount: totalAccess,
      isNewRecord: isNewAccess,
      cacheStatus: 'MISS'
    };

    const response = {
      success: true,
      accountType: accountType,
      menuAccess: menuAccess,
      userData: userData,
      debug: debugInfo
    };

    await Cache.eduallSet(cacheKey, response, LIBRARY_ACCESS_CACHE_TTL);
    console.log(`${C.green}${C.bold}Armazenado em cache${C.reset}\n`);

    console.log(`${C.bold}${C.bgGreen}${C.white}  RESUMO FINAL  ${C.reset}`);
    console.log(`${C.cyan}${LINE2}${C.reset}`);
    console.log(`${C.bold}${C.blue}User:${C.reset} ${C.yellow}${user.ed_user_account_name}${C.reset}`);
    console.log(`${C.bold}${C.blue}Type:${C.reset} ${isAdmin ? C.red + 'ADMIN' : C.green + 'READER'}${C.reset}`);
    console.log(`${C.bold}${C.blue}Acessos:${C.reset} ${C.cyan}${totalAccess} / 24${C.reset}`);
    console.log(`${C.bold}${C.blue}Estado:${C.reset} ${isNewAccess ? C.yellow + 'NOVO' : C.green + 'EXISTENTE'}${C.reset}`);
    console.log(`${C.cyan}${LINE2}${C.reset}\n`);

    return res.status(200).json(response);

  } catch (err) {
    console.error(`${C.red}${C.bold}ERRO FATAL:${C.reset}`, err.message || err);

    if (!res.headersSent) {
      return res.status(500).json({
        success: false,
        msg: "Erro ao recuperar acessos da Biblioteca.",
        error: process.env.NODE_ENV === 'development' ? err.message : undefined,
      });
    }
  }
};

// ══════════════════════════════════════════════════════════════════════════════
// ✏️ UPDATE LIBRARY ACCOUNT TYPE
// ══════════════════════════════════════════════════════════════════════════════

const UpdateLibraryAccountType = async (req, res) => {
  try {
    const { userid } = req.params;
    const { accountType } = req.body;
    const instituteCode = req.session?.user?.eduall_user_session_curentinstitute;

    const result = await createAccessIfNotExists(res, userid, instituteCode);

    console.log(`\n${C.bold}${C.bgYellow}${C.white}  ▶ UPDATE LIBRARY ACCOUNT TYPE  ${C.reset}`);
    console.log(`${C.yellow}${LINE2}${C.reset}`);
    console.log(`${C.yellow}userid:${C.reset} ${userid}, ${C.yellow}newType:${C.reset} ${accountType}`);
    console.log(`${C.yellow}instituteCode:${C.reset} ${instituteCode}\n`);

    // ── Validações ─────────────────────────────────────────────────────────────
    if (!userid || isNaN(parseInt(userid))) {
      console.log(`${C.red}❌ userId inválido${C.reset}\n`);
      return res.status(400).json({
        success: false,
        msg: "userId inválido.",
      });
    }

    if (!instituteCode) {
      console.log(`${C.red}❌ Instituto não encontrado na sessão${C.reset}\n`);
      return res.status(403).json({
        success: false,
        msg: "Acesso negado: instituição não encontrada na sessão.",
      });
    }

    if (!accountType || !["admin", "reader"].includes(accountType)) {
      console.log(`${C.red}❌ Tipo de conta inválido${C.reset}\n`);
      return res.status(400).json({
        success: false,
        msg: "Tipo de conta inválido. Use 'admin' ou 'reader'.",
      });
    }

    // ── Validar que utilizador existe ──────────────────────────────────────────
    console.log(`${C.magenta}1. Validando utilizador...${C.reset}`);

    const userCheck = await ExecuteQuery(
      res,
      `SELECT ed_user_account_id, ed_user_account_name, ed_user_account_email, ed_user_account_deleted
       FROM eduall_user_accounts
       WHERE ed_user_account_id = ?
       LIMIT 1`,
      [userid],
      true,
      { db: "eduall_user_accounts", type: "select", data: req }
    );

    if (res.headersSent) return;

    if (!userCheck?.length) {
      console.log(`${C.red}❌ Utilizador não encontrado (ID: ${userid})${C.reset}\n`);
      return res.status(404).json({
        success: false,
        msg: "Utilizador não encontrado.",
      });
    }

    const user = userCheck[0];

    if (user.ed_user_account_deleted === 1) {
      console.log(`${C.red}❌ Utilizador foi eliminado${C.reset}\n`);
      return res.status(410).json({
        success: false,
        msg: "Utilizador foi eliminado.",
      });
    }

    console.log(`${C.green}✅ Utilizador encontrado: ${user.ed_user_account_name}${C.reset}`);
    console.log(`${C.cyan}${LINE}${C.reset}\n`);

    // ── Buscar acesso atual ────────────────────────────────────────────────────
    console.log(`${C.magenta}2. Buscando acesso à biblioteca...${C.reset}`);

    const currentAccess = await ExecuteQuery(
      res,
      `SELECT 
         ed_library_access_id,
         ed_library_access_user_id,
         ed_library_access_account_type,
         ed_library_access_menu_access
       FROM eduall_library_access
       WHERE ed_library_access_user_id = ?
         AND ed_library_access_institute_code = ?
         AND ed_library_access_deleted = 0
       LIMIT 1`,
      [userid, instituteCode],
      true,
      { db: "eduall_library_access", type: "select", data: req }
    );

    if (res.headersSent) return;

    let oldAccountType = null;
    let accessId = null;

    if (currentAccess?.length) {
      console.log(`${C.green}✅ Acesso encontrado${C.reset}`);

      const current = currentAccess[0];
      accessId = current.ed_library_access_id;
      oldAccountType = current.ed_library_access_account_type || "reader";

      console.log(`${C.blue}  ID Acesso:${C.reset} ${accessId}`);
      console.log(`${C.blue}  Tipo Atual:${C.reset} ${oldAccountType}`);
      console.log(`${C.cyan}${LINE}${C.reset}\n`);

      if (oldAccountType === accountType) {
        console.log(`${C.yellow}ℹ️  Tipo já é ${accountType}${C.reset}\n`);
        return res.status(200).json({
          success: true,
          msg: `Tipo de conta já é "${accountType}".`,
          accountType,
          accessCreated: false,
        });
      }

      console.log(`${C.magenta}3. Atualizando tipo de conta...${C.reset}`);

      let menuAccessJson;

      if (accountType === "admin") {
        menuAccessJson = JSON.stringify(ADMIN_LIBRARY_ACCESS);
        console.log(`${C.blue}  Tipo: ADMIN${C.reset}`);
        console.log(`${C.blue}  Permissões: Todas (24 menus)${C.reset}`);
      } else {
        if (current.ed_library_access_menu_access && current.ed_library_access_menu_access !== '{}') {
          menuAccessJson = current.ed_library_access_menu_access;
          console.log(`${C.blue}  Tipo: READER${C.reset}`);
          console.log(`${C.blue}  Permissões: Mantidas (acessos anteriores)${C.reset}`);
        } else {
          menuAccessJson = JSON.stringify(READER_LIBRARY_ACCESS);
          console.log(`${C.blue}  Tipo: READER${C.reset}`);
          console.log(`${C.blue}  Permissões: Padrão (13 menus básicos)${C.reset}`);
        }
      }

      console.log(`${C.cyan}${LINE}${C.reset}\n`);

      console.log(`${C.magenta}4. Atualizando na BD...${C.reset}`);

      await ExecuteQuery(
        res,
        `UPDATE eduall_library_access 
         SET ed_library_access_account_type = ?,
             ed_library_access_menu_access = ?
         WHERE ed_library_access_id = ?`,
        [accountType, menuAccessJson, accessId],
        false,
        { db: "eduall_library_access", type: "update", data: req }
      );

      if (res.headersSent) return;

      console.log(`${C.green}✅ Tipo atualizado de "${oldAccountType}" para "${accountType}"${C.reset}`);
      console.log(`${C.cyan}${LINE}${C.reset}\n`);

      console.log(`${C.magenta}5. Invalidando cache...${C.reset}`);

      await Cache.eduallDel(CacheKeys.libraryAccess(userid, instituteCode)).catch(() => {});
      await Cache.eduallDel(CacheKeys.libraryUsersList(instituteCode)).catch(() => {});

      console.log(`${C.green}✅ Cache invalidado (individual + lista)${C.reset}`);
      console.log(`${C.cyan}${LINE}${C.reset}\n`);

      console.log(`${C.magenta}6. Registando auditoria...${C.reset}`);

      await RegisterAuditAction({
        session: req.session,
        action: 2,
        form: "Gestão de Acessos Biblioteca",
        description: `Alterou tipo de conta de "${user.ed_user_account_name}" de "${oldAccountType}" para "${accountType}"`,
      }).catch(() => {});

      console.log(`${C.green}✅ Auditoria registada${C.reset}`);
      console.log(`${C.cyan}${LINE}${C.reset}\n`);

      console.log(`${C.bold}${C.bgGreen}${C.white}  ✅ SUCESSO - ATUALIZADO  ${C.reset}`);
      console.log(`${C.cyan}${LINE2}${C.reset}\n`);

      return res.status(200).json({
        success: true,
        msg: `Tipo de conta actualizado de "${oldAccountType}" para "${accountType}".`,
        accountType,
        accessId,
        userName: user.ed_user_account_name,
        accessCreated: false,
      });

    } else {
      console.log(`${C.yellow}⚠️  Acesso não encontrado - criando novo...${C.reset}`);
      console.log(`${C.cyan}${LINE}${C.reset}\n`);

      console.log(`${C.magenta}3. Criando novo registo de acesso...${C.reset}`);

      let menuAccessJson;
      let menuCountLabel;

      if (accountType === "admin") {
        menuAccessJson = JSON.stringify(ADMIN_LIBRARY_ACCESS);
        menuCountLabel = "Todas (24 menus)";
      } else {
        menuAccessJson = JSON.stringify(READER_LIBRARY_ACCESS);
        menuCountLabel = "Padrão (13 menus básicos)";
      }

      const insertResult = await ExecuteQuery(
        res,
        `INSERT INTO eduall_library_access (
           ed_library_access_user_id,
           ed_library_access_account_type,
           ed_library_access_menu_access,
           ed_library_access_institute_code,
           ed_library_access_deleted,
           ed_library_access_created_at
         ) VALUES (?, ?, ?, ?, 0, NOW())`,
        [userid, accountType, menuAccessJson, instituteCode],
        false,
        { db: "eduall_library_access", type: "insert", data: req }
      );

      if (res.headersSent) return;

      console.log(`${C.green}✅ Registo de acesso criado com sucesso${C.reset}`);
      console.log(`${C.blue}  Utilizador:${C.reset} ${user.ed_user_account_name}`);
      console.log(`${C.blue}  Tipo:${C.reset} ${accountType.toUpperCase()}`);
      console.log(`${C.blue}  Permissões:${C.reset} ${menuCountLabel}`);
      console.log(`${C.cyan}${LINE}${C.reset}\n`);

      console.log(`${C.magenta}4. Invalidando cache...${C.reset}`);

      await Cache.eduallDel(CacheKeys.libraryAccess(userid, instituteCode)).catch(() => {});
      await Cache.eduallDel(CacheKeys.libraryUsersList(instituteCode)).catch(() => {});

      console.log(`${C.green}✅ Cache invalidado (individual + lista)${C.reset}`);
      console.log(`${C.cyan}${LINE}${C.reset}\n`);

      console.log(`${C.magenta}5. Registando auditoria...${C.reset}`);

      await RegisterAuditAction({
        session: req.session,
        action: 1,
        form: "Gestão de Acessos Biblioteca",
        description: `Criou novo acesso de "${user.ed_user_account_name}" como "${accountType}" com ${menuCountLabel.toLowerCase()}`,
      }).catch(() => {});

      console.log(`${C.green}✅ Auditoria registada${C.reset}`);
      console.log(`${C.cyan}${LINE}${C.reset}\n`);

      console.log(`${C.bold}${C.bgGreen}${C.white}  ✅ SUCESSO - CRIADO  ${C.reset}`);
      console.log(`${C.cyan}${LINE2}${C.reset}\n`);

      return res.status(201).json({
        success: true,
        msg: `Acesso criado para "${user.ed_user_account_name}" como "${accountType}" com ${menuCountLabel.toLowerCase()}.`,
        accountType,
        userName: user.ed_user_account_name,
        accessCreated: true,
      });
    }

  } catch (err) {
    console.error(`${C.red}${C.bold}❌ ERRO FATAL:${C.reset}`, err.message || err);

    if (!res.headersSent) {
      return res.status(500).json({
        success: false,
        msg: "Erro ao actualizar/criar tipo de conta.",
        error: process.env.NODE_ENV === 'development' ? err.message : undefined,
      });
    }
  }
};

// ══════════════════════════════════════════════════════════════════════════════
// 📚 GET LIBRARY USERS
// ══════════════════════════════════════════════════════════════════════════════
const GetLibraryUsers = async (req, res) => {
  try {
    const instituteCode = req.session?.user?.eduall_user_session_curentinstitute || 'default';
    const result = await createAccessIfNotExists(res, null, instituteCode);

    console.log(`\n${C.bold}${C.bgCyan}${C.white}  ▶ GET LIBRARY USERS  ${C.reset}`);
    console.log(`${C.cyan}${LINE2}${C.reset}`);
    console.log(`${C.bold}${C.blue}Instituto: ${C.reset}${C.yellow}${instituteCode}${C.reset}`);
    console.log(`${C.cyan}${LINE}${C.reset}\n`);

    const users = await ExecuteQuery(
      res,
      `SELECT 
  ua.*,
  ea.*,
  sa.*,
  la.*,
  sad.ed_system_account_id AS dashboard_account_id,
  uac.*
FROM eduall_user_accounts ua
LEFT JOIN eduall_system_accounts sa 
       ON ua.ed_user_account_id = sa.ed_system_account_userid
      AND sa.ed_system_account_app_type = 'library'
LEFT JOIN eduall_employees ea 
       ON sa.ed_system_account_employee = ea.ed_employee_id
LEFT JOIN eduall_library_access la 
       ON ua.ed_user_account_id = la.ed_library_access_user_id 
      AND la.ed_library_access_institute_code = ? 
      AND la.ed_library_access_deleted = 0
LEFT JOIN eduall_system_accounts sad 
       ON sad.ed_system_account_employee = ea.ed_employee_id
      AND sad.ed_system_account_institute_code = ?
      AND sad.ed_system_account_app_type IS NULL
      AND sad.ed_system_account_deleted = 0
LEFT JOIN eduall_user_access uac 
       ON uac.ed_user_access_usercode = sad.ed_system_account_id
WHERE sa.ed_system_account_app_type = 'library'
  AND ua.ed_user_account_deleted = 0
ORDER BY ua.ed_user_account_name ASC`,
      [instituteCode, instituteCode],
      true,
      { db: "eduall_user_accounts", type: "select", data: req }
    );

    if (!users) {
      console.log(`${C.red}❌ Erro na query${C.reset}\n`);
      return res.status(500).json({
        success: false,
        msg: 'Erro ao buscar utilizadores'
      });
    }

    console.log(`${C.green}✅ ${users.length} users encontrados${C.reset}\n`);
    console.log(`${C.bold}${C.magenta}2. Formatando dados...${C.reset}`);

    // ─────────────────────────────────────────────────────────────────
    // Helper: agrupa TODAS as colunas de uma linha que comecem por um
    // determinado prefixo (ex: "ed_employee_") num único objeto, com os
    // nomes de coluna originais da tabela, sem escolher/omitir nenhuma.
    // ─────────────────────────────────────────────────────────────────
    const pickByPrefix = (row, prefix) => {
      const out = {};
      for (const key in row) {
        if (Object.prototype.hasOwnProperty.call(row, key) && key.startsWith(prefix)) {
          out[key] = row[key];
        }
      }
      return out;
    };

    const formattedUsers = users.map((item, index) => {
      let menuAccess = {};
      let menuAccessCount = 0;

      if (item.ed_library_access_account_type === 'admin') {
        menuAccess = { ...ADMIN_LIBRARY_ACCESS };
        menuAccessCount = 24;
      } else if (item.ed_library_access_account_type === 'reader') {
        if (item.ed_library_access_menu_access) {
          try {
            const parsed = JSON.parse(item.ed_library_access_menu_access);
            menuAccess = parsed;
            menuAccessCount = Object.values(parsed).filter(v => v === 1).length;
          } catch (e) {
            menuAccess = { ...READER_LIBRARY_ACCESS };
            menuAccessCount = Object.values(READER_LIBRARY_ACCESS).filter(v => v === 1).length;
          }
        } else {
          menuAccess = { ...READER_LIBRARY_ACCESS };
          menuAccessCount = Object.values(READER_LIBRARY_ACCESS).filter(v => v === 1).length;
        }
      } else {
        menuAccessCount = 0;
      }

      const funcionario = item.ed_employee_id ? pickByPrefix(item, 'ed_employee_') : null;
      const system      = item.ed_system_account_id ? pickByPrefix(item, 'ed_system_account_') : null;
      const conta       = pickByPrefix(item, 'ed_user_account_');
      const acesso      = item.ed_library_access_id ? pickByPrefix(item, 'ed_library_access_') : null;

      const acessoSistema = item.dashboard_account_id
        ? pickByPrefix(item, 'ed_user_access_')
        : null;

      return {
        id: item.ed_library_access_id || null,
        userId: item.ed_user_account_id,
        systemAccountId: item.ed_system_account_id,
        dashboardAccountId: item.dashboard_account_id || null,
        name: (item.ed_employee_name || item.ed_user_account_name || '').trim(),
        email: item.ed_user_account_email,
        picture: item.ed_employee_picture || '',
        systemName: item.ed_system_account_name || '—',
        country: item.ed_user_account_country || 'AO',
        userStatus: item.ed_user_account_status,
        accountType: item.ed_library_access_account_type || 'reader',
        permissions: menuAccess,
        menuCount: menuAccessCount,
        totalMenus: 24,
        hasSystemAccess: !!acessoSistema,
        index: index + 1,
        funcionario,
        system,
        conta,
        acesso,
        acessoSistema,
      };
    });

    formattedUsers.sort((a, b) =>
      (a.name || '').localeCompare(b.name || '', 'pt', { sensitivity: 'base' })
    );

    formattedUsers.forEach((u, i) => { u.index = i + 1; });

    const stats = {
      total: formattedUsers.length,
      withAccess: formattedUsers.filter(u => u.id).length,
      admins: formattedUsers.filter(u => u.accountType === 'admin').length,
      readers: formattedUsers.filter(u => u.accountType === 'reader').length,
      noAccess: formattedUsers.filter(u => !u.id).length,
      withSystemAccess: formattedUsers.filter(u => u.hasSystemAccess).length,
    };

    console.log(`${C.green}✅ Dados formatados${C.reset}`);
    console.log(`${C.cyan}${LINE}${C.reset}`);
    console.log(`${C.bold}${C.blue}Estatísticas:${C.reset}`);
    console.log(`${C.blue}  ├─ Total:${C.reset} ${C.yellow}${stats.total}${C.reset}`);
    console.log(`${C.blue}  ├─ Com Acesso:${C.reset} ${C.yellow}${stats.withAccess}${C.reset}`);
    console.log(`${C.blue}  ├─ Admins:${C.reset} ${C.green}${stats.admins}${C.reset}`);
    console.log(`${C.blue}  ├─ Readers:${C.reset} ${C.yellow}${stats.readers}${C.reset}`);
    console.log(`${C.blue}  ├─ Com Acesso Sistema:${C.reset} ${C.yellow}${stats.withSystemAccess}${C.reset}`);
    console.log(`${C.blue}  └─ Sem Acesso:${C.reset} ${C.red}${stats.noAccess}${C.reset}`);
    console.log(`${C.cyan}${LINE}${C.reset}\n`);

    console.log(`${C.green}${C.bold}✅ SUCESSO - ${formattedUsers.length} users retornados${C.reset}\n`);

    const data = {
      success: true,
      users: formattedUsers,
      stats: stats,
    };

    return res.status(200).json(data);

  } catch (err) {
    console.error(`${C.red}${C.bold}❌ ERRO FATAL:${C.reset}`, err.message || err);
    if (!res.headersSent) {
      return res.status(500).json({
        success: false,
        msg: 'Erro ao buscar utilizadores',
        error: process.env.NODE_ENV === 'development' ? err.message : undefined,
      });
    }
  }
};

const PASSWORD_MIN_LENGTH = 8;
const PASSWORD_MAX_LENGTH = 128;

const validatePasswordStrength = (password) => {
  if (!password || password.length < PASSWORD_MIN_LENGTH) {
    return {
      valid: false,
      msg: `Senha deve ter mínimo ${PASSWORD_MIN_LENGTH} caracteres.`,
    };
  }

  if (password.length > PASSWORD_MAX_LENGTH) {
    return {
      valid: false,
      msg: `Senha não pode exceder ${PASSWORD_MAX_LENGTH} caracteres.`,
    };
  }

  const hasUpperCase = /[A-Z]/.test(password);
  if (!hasUpperCase) {
    return {
      valid: false,
      msg: "Senha deve conter pelo menos 1 letra MAIÚSCULA.",
    };
  }

  const hasLowerCase = /[a-z]/.test(password);
  if (!hasLowerCase) {
    return {
      valid: false,
      msg: "Senha deve conter pelo menos 1 letra minúscula.",
    };
  }

  const hasDigit = /[0-9]/.test(password);
  if (!hasDigit) {
    return {
      valid: false,
      msg: "Senha deve conter pelo menos 1 número (0-9).",
    };
  }

  const hasSpecialChar = /[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password);
  if (!hasSpecialChar) {
    return {
      valid: false,
      msg: "Senha deve conter pelo menos 1 caractere especial (!@#$%^&* etc).",
    };
  }

  return {
    valid: true,
    msg: "Senha válida.",
  };
};

const EduallResetLibraryReaderPasswordByEmail = async (req, res) => {
  try {
    const { email } = req.params;
    const { newPassword, reason = "" } = req.body;
    const adminUserId = req.session?.user?.eduall_user_session_ID;
    const instituteCode = req.session?.user?.eduall_user_session_curentinstitute;

    console.log(`\n${C.bold}${C.bgBlue}${C.white}  ▶ RESET LIBRARY READER PASSWORD (BY EMAIL)  ${C.reset}`);
    console.log(`${C.blue}${LINE2}${C.reset}`);
    console.log(`${C.yellow}Email:${C.reset} ${email}`);
    console.log(`${C.yellow}Admin ID:${C.reset} ${adminUserId}`);
    console.log(`${C.blue}${LINE}${C.reset}\n`);

    if (!email || email.trim().length === 0) {
      return res.status(400).json({
        success: false,
        msg: "Email é obrigatório.",
      });
    }

    if (!instituteCode) {
      return res.status(403).json({
        success: false,
        msg: "Acesso negado: instituição não encontrada.",
      });
    }

    if (!newPassword || newPassword.trim().length === 0) {
      return res.status(400).json({
        success: false,
        msg: "Nova password é obrigatória.",
      });
    }

    console.log(`${C.magenta}1. Validando força de password...${C.reset}`);
    const passwordValidation = validatePasswordStrength(newPassword);

    if (!passwordValidation.valid) {
      console.log(`${C.red}❌ ${passwordValidation.msg}${C.reset}\n`);
      return res.status(400).json({
        success: false,
        msg: passwordValidation.msg,
      });
    }

    console.log(`${C.green}✅ Password válida${C.reset}`);
    console.log(`${C.cyan}${LINE}${C.reset}\n`);

    console.log(`${C.magenta}2. Buscando READER por email...${C.reset}`);

    const reader = await ExecuteQuery(
      res,
      `SELECT 
         la.ed_library_access_id,
         la.ed_library_access_user_id,
         la.ed_library_access_account_type,
         ua.ed_user_account_id,
         ua.ed_user_account_name, 
         ua.ed_user_account_email,
         ua.ed_user_account_deleted
       FROM eduall_library_access la
       INNER JOIN eduall_user_accounts ua ON ua.ed_user_account_id = la.ed_library_access_user_id
       WHERE ua.ed_user_account_email = ?
         AND la.ed_library_access_institute_code = ?
         AND la.ed_library_access_account_type = 'reader'
         AND la.ed_library_access_deleted = 0
         AND ua.ed_user_account_deleted = 0
       LIMIT 1`,
      [email.trim().toLowerCase(), instituteCode],
      true,
      { db: "eduall_library_access", type: "select", data: req }
    );

    if (!reader?.length) {
      console.log(`${C.red}❌ READER com este email não encontrado${C.reset}\n`);
      return res.status(404).json({
        success: false,
        msg: "READER com este email não encontrado nesta instituição.",
      });
    }

    const readerData = reader[0];
    const userId = readerData.ed_user_account_id;

    console.log(`${C.green}✅ READER encontrado: ${readerData.ed_user_account_name}${C.reset}`);
    console.log(`${C.cyan}${LINE}${C.reset}\n`);

    console.log(`${C.magenta}3. Hashando nova password...${C.reset}`);

    const salt = await bcrypt.genSalt(BCRYPT_ROUNDS);
    const hashedPassword = await bcrypt.hash(newPassword, salt);

    console.log(`${C.green}✅ Password hasheada${C.reset}`);
    console.log(`${C.cyan}${LINE}${C.reset}\n`);

    console.log(`${C.magenta}4. Atualizando password...${C.reset}`);

    await ExecuteQuery(
      res,
      `UPDATE eduall_user_accounts
       SET ed_user_account_password = ?
       WHERE ed_user_account_id = ?`,
      [hashedPassword, userId],
      false,
      { db: "eduall_user_accounts", type: "update", data: req }
    );

    if (res.headersSent) return;

    console.log(`${C.green}✅ Password atualizada${C.reset}`);
    console.log(`${C.cyan}${LINE}${C.reset}\n`);

    await Cache.eduallDel(CacheKeys.libraryAccess(userId, instituteCode)).catch(() => {});
    await Cache.eduallDel(CacheKeys.libraryUsersList(instituteCode)).catch(() => {});

    const auditDescription = `Resetou password de READER "${readerData.ed_user_account_name}" (${email})${reason ? ` - Motivo: ${reason}` : ''}`;;

    await RegisterAuditAction({
      session: req.session,
      action: 2,
      form: "Gestão de Biblioteca - Readers",
      description: auditDescription,
    }).catch(() => {});

    console.log(`${C.bold}${C.bgGreen}${C.white}  ✅ SUCESSO  ${C.reset}`);
    console.log(`${C.cyan}${LINE2}${C.reset}\n`);

    return res.status(200).json({
      success: true,
      msg: `Password do READER "${readerData.ed_user_account_name}" foi resetada com sucesso.`,
      accessId: readerData.ed_library_access_id,
      userId: readerData.ed_user_account_id,
      userName: readerData.ed_user_account_name,
      email: readerData.ed_user_account_email,
      accountType: "reader",
    });

  } catch (err) {
    console.error(`${C.red}${C.bold}❌ ERRO FATAL:${C.reset}`, err.message || err);

    if (!res.headersSent) {
      return res.status(500).json({
        success: false,
        msg: "Erro ao resetar password do reader.",
        error: process.env.NODE_ENV === 'development' ? err.message : undefined,
      });
    }
  }
};

const EduallResetLibraryReaderPassword = async (req, res) => {
  try {
    const { accessId } = req.params;
    const { newPassword, reason = "" } = req.body;
    const adminUserId = req.session?.user?.eduall_user_session_ID;
    const instituteCode = req.session?.user?.eduall_user_session_curentinstitute;

    console.log(`\n${C.bold}${C.bgBlue}${C.white}  ▶ REDEFINIR SENHA LIBRARY READER  ${C.reset}`);
    console.log(`${C.blue}${LINE2}${C.reset}`);
    console.log(`${C.yellow}Access/User ID:${C.reset} ${accessId || 'NÃO FORNECIDO'}`);
    console.log(`${C.yellow}Admin ID:${C.reset} ${adminUserId}`);
    console.log(`${C.yellow}Instituto:${C.reset} ${instituteCode}`);
    console.log(`${C.yellow}Reason:${C.reset} ${reason || 'N/A'}`);
    console.log(`${C.blue}${LINE}${C.reset}\n`);

    if (!accessId) {
      console.log(`${C.yellow}⚠️  Aviso: accessId não fornecido - será tratado como userId${C.reset}`);
    }

    if (!instituteCode) {
      console.log(`${C.red}❌ Instituto não encontrado na sessão${C.reset}\n`);
      return res.status(403).json({
        success: false,
        msg: "Acesso negado: instituição não encontrada na sessão.",
      });
    }

    if (!newPassword || newPassword.trim().length === 0) {
      console.log(`${C.red}❌ Nova senha não fornecida${C.reset}\n`);
      return res.status(400).json({
        success: false,
        msg: "Nova senha é obrigatória.",
      });
    }

    console.log(`${C.magenta}1. Validando força de senha...${C.reset}`);
    const passwordValidation = validatePasswordStrength(newPassword);

    if (!passwordValidation.valid) {
      console.log(`${C.red}❌ ${passwordValidation.msg}${C.reset}\n`);
      return res.status(400).json({
        success: false,
        msg: passwordValidation.msg,
      });
    }

    console.log(`${C.green}✅ Senha válida${C.reset}`);
    console.log(`${C.cyan}${LINE}${C.reset}\n`);

    console.log(`${C.magenta}2. Buscando acesso à biblioteca...${C.reset}`);

    const libraryAccess = await ExecuteQuery(
      res,
      `SELECT 
         la.ed_library_access_id,
         la.ed_library_access_user_id,
         la.ed_library_access_account_type,
         ua.ed_user_account_id,
         ua.ed_user_account_name,
         ua.ed_user_account_email,
         ua.ed_user_account_deleted
       FROM eduall_library_access la
       INNER JOIN eduall_user_accounts ua ON ua.ed_user_account_id = la.ed_library_access_user_id
       WHERE la.ed_library_access_id = ?
         AND la.ed_library_access_institute_code = ?
         AND la.ed_library_access_deleted = 0
       LIMIT 1`,
      [accessId, instituteCode],
      true,
      { db: "eduall_library_access", type: "select", data: req }
    );

    if (res.headersSent) return;

    let access;
    let userId;
    let accessCreated = false;

    if (!libraryAccess?.length) {
      console.log(`${C.yellow}⚠️  Acesso não encontrado - tentando criar novo registro...${C.reset}\n`);

      if (!accessId || accessId === '0' || isNaN(parseInt(accessId))) {
        console.log(`${C.red}❌ ID inválido - deve ser um número válido${C.reset}\n`);
        console.log(`${C.red}Recebido: ${accessId}${C.reset}\n`);
        return res.status(400).json({
          success: false,
          msg: "ID do utilizador/acesso inválido. Deve ser um número válido.",
        });
      }

      userId = parseInt(accessId);
      console.log(`${C.magenta}2a. Buscando utilizador (ID: ${userId})...${C.reset}`);

      const userQuery = await ExecuteQuery(
        res,
        `SELECT 
           ed_user_account_id,
           ed_user_account_name,
           ed_user_account_email,
           ed_user_account_deleted
         FROM eduall_user_accounts
         WHERE ed_user_account_id = ?
         LIMIT 1`,
        [userId],
        true,
        { db: "eduall_user_accounts", type: "select", data: req }
      );

      if (res.headersSent) return;

      if (!userQuery?.length) {
        console.log(`${C.red}❌ Utilizador não encontrado (ID: ${userId})${C.reset}\n`);
        return res.status(404).json({
          success: false,
          msg: "Utilizador não encontrado.",
        });
      }

      const user = userQuery[0];

      if (user.ed_user_account_deleted === 1) {
        console.log(`${C.red}❌ Utilizador foi eliminado${C.reset}\n`);
        return res.status(410).json({
          success: false,
          msg: "Utilizador foi eliminado e não pode ter senha alterada.",
        });
      }

      console.log(`${C.green}✅ Utilizador encontrado: ${user.ed_user_account_name}${C.reset}`);
      console.log(`${C.cyan}${LINE}${C.reset}\n`);

      console.log(`${C.magenta}2b. Criando novo registo de acesso...${C.reset}`);

      const insertResult = await ExecuteQuery(
        res,
        `INSERT INTO eduall_library_access (
           ed_library_access_user_id,
           ed_library_access_account_type,
           ed_library_access_menu_access,
           ed_library_access_institute_code,
           ed_library_access_deleted,
           ed_library_access_created_at
         ) VALUES (?, ?, ?, ?, 0, NOW())`,
        [user.ed_user_account_id, 'reader', '{}', instituteCode],
        false,
        { db: "eduall_library_access", type: "insert", data: req }
      );

      if (res.headersSent) return;

      console.log(`${C.green}✅ Registo de acesso criado com sucesso${C.reset}`);
      console.log(`${C.blue}  Utilizador:${C.reset} ${user.ed_user_account_name}`);
      console.log(`${C.blue}  Tipo:${C.reset} READER`);
      console.log(`${C.blue}  Permissões:${C.reset} Vazias`);
      console.log(`${C.cyan}${LINE}${C.reset}\n`);

      access = {
        ed_library_access_id: null,
        ed_user_account_id: user.ed_user_account_id,
        ed_user_account_name: user.ed_user_account_name,
        ed_user_account_email: user.ed_user_account_email,
        ed_library_access_account_type: 'reader'
      };

      userId = user.ed_user_account_id;
      accessCreated = true;

    } else {
      access = libraryAccess[0];
      userId = access.ed_user_account_id;
      const accountType = access.ed_library_access_account_type || "reader";

      console.log(`${C.green}✅ Acesso encontrado${C.reset}`);
      console.log(`${C.blue}  Utilizador:${C.reset} ${access.ed_user_account_name}`);
      console.log(`${C.blue}  Tipo de Conta:${C.reset} ${accountType.toUpperCase()}`);
      console.log(`${C.cyan}${LINE}${C.reset}\n`);

      console.log(`${C.magenta}3. Validando tipo de conta...${C.reset}`);

      if (accountType !== "reader") {
        console.log(`${C.red}❌ ERRO: Apenas READERS podem ter senha redefinida${C.reset}\n`);
        console.log(`${C.red}Este utilizador é ${accountType.toUpperCase()} (não permitido)${C.reset}\n`);

        return res.status(403).json({
          success: false,
          msg: `Apenas utilizadores READER podem ter senha redefinida. Este utilizador é ${accountType.toUpperCase()}.`,
          accountType: accountType,
        });
      }

      console.log(`${C.green}✅ Utilizador é READER (permitido)${C.reset}`);
      console.log(`${C.cyan}${LINE}${C.reset}\n`);

      if (access.ed_user_account_deleted === 1) {
        console.log(`${C.red}❌ Utilizador foi eliminado${C.reset}\n`);
        return res.status(410).json({
          success: false,
          msg: "Utilizador foi eliminado e não pode ter senha alterada.",
        });
      }
    }

    console.log(`${C.magenta}${accessCreated ? '3' : '4'}. Hashando nova senha...${C.reset}`);

    const salt = await bcrypt.genSalt(BCRYPT_ROUNDS);
    const hashedPassword = await bcrypt.hash(newPassword, salt);

    console.log(`${C.green}✅ Senha hasheada com sucesso${C.reset}`);
    console.log(`${C.cyan}${LINE}${C.reset}\n`);

    console.log(`${C.magenta}${accessCreated ? '4' : '5'}. Atualizando senha na BD...${C.reset}`);

    await ExecuteQuery(
      res,
      `UPDATE eduall_user_accounts
       SET ed_user_account_password = ?
       WHERE ed_user_account_id = ?`,
      [hashedPassword, userId],
      false,
      { db: "eduall_user_accounts", type: "update", data: req }
    );

    if (res.headersSent) return;

    console.log(`${C.green}✅ Senha atualizada${C.reset}`);
    console.log(`${C.cyan}${LINE}${C.reset}\n`);

    console.log(`${C.magenta}${accessCreated ? '5' : '6'}. Invalidando cache...${C.reset}`);

    await Cache.eduallDel(CacheKeys.libraryAccess(userId, instituteCode)).catch(() => {});
    await Cache.eduallDel(CacheKeys.libraryUsersList(instituteCode)).catch(() => {});

    console.log(`${C.green}✅ Cache invalidado (individual + lista)${C.reset}`);
    console.log(`${C.cyan}${LINE}${C.reset}\n`);

    console.log(`${C.magenta}${accessCreated ? '6' : '7'}. Registando auditoria...${C.reset}`);

    const auditDescription = `Redefiniu senha de READER "${access.ed_user_account_name}" (${access.ed_user_account_email})${accessCreated ? ' - Registo de acesso criado automaticamente' : ''}${reason ? ` - Motivo: ${reason}` : ''}`;

    await RegisterAuditAction({
      session: req.session,
      action: 2,
      form: "Gestão de Biblioteca - Readers",
      description: auditDescription,
    }).catch(() => {});

    console.log(`${C.green}✅ Auditoria registada${C.reset}`);
    console.log(`${C.cyan}${LINE}${C.reset}\n`);

    console.log(`${C.bold}${C.bgGreen}${C.white}  ✅ SUCESSO  ${C.reset}`);
    console.log(`${C.cyan}${LINE2}${C.reset}\n`);

    return res.status(200).json({
      success: true,
      msg: `Senha do READER "${access.ed_user_account_name}" foi redefinida com sucesso.${accessCreated ? ' (Registo de acesso criado automaticamente)' : ''}`,
      accessId: access.ed_library_access_id,
      userId: access.ed_user_account_id,
      userName: access.ed_user_account_name,
      email: access.ed_user_account_email,
      accountType: "reader",
      accessCreated: accessCreated,
    });

  } catch (err) {
    console.error(`${C.red}${C.bold}❌ ERRO FATAL:${C.reset}`, err.message || err);

    if (!res.headersSent) {
      return res.status(500).json({
        success: false,
        msg: "Erro ao redefinir senha do reader.",
        error: process.env.NODE_ENV === 'development' ? err.message : undefined,
      });
    }
  }
};

// ══════════════════════════════════════════════════════════════════════════════
// ✅ EXPORTS
// ══════════════════════════════════════════════════════════════════════════════

module.exports = {
  GetLibraryAccess,
  RegisterAppManager,
  UpdateLibraryAccountType,
  GetLibraryUsers,
  EduallResetLibraryReaderPassword,
  EduallResetLibraryReaderPasswordByEmail,
  LIBRARY_MENU_KEYS,
  ADMIN_LIBRARY_ACCESS,
  READER_LIBRARY_ACCESS,
  createAccessIfNotExists,
};