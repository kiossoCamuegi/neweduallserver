/// contas de acessos ao dashboard + apps internas
const ExecuteQuery = require("../Functions/ExecuteQuery");
const { RegisterAuditAction } = require("./Auditory");

// ─── Apps internas disponíveis ────────────────────────────────────────────────
// Partilhado com o UnifiedAccountRegister — mantém a mesma estrutura
const INTERNAL_APPS = {
  library:  { id: "library",  label: "Biblioteca",       route: "/libraryapp/dashboard",  licenceType: 10 },
  hr:       { id: "hr",       label: "Recursos Humanos", route: "/hr/home",               licenceType: 11 },
  security: { id: "security", label: "Segurança / CCTV", route: "/monitoring_dashboard",  licenceType: 12 },
};

const VALID_APP_TYPES = Object.keys(INTERNAL_APPS);

// ─── Utilitários ──────────────────────────────────────────────────────────────

const removeAccents = (str) =>
  str.normalize("NFD").replace(/[\u0300-\u036f]/g, "");

const generateUsername = async (employeeName) => {
  const cleanName = removeAccents(employeeName.toLowerCase().replace(/[^a-zA-Z\s]/g, "").trim());
  const nameParts = cleanName.split(/\s+/);

  let baseUsername = nameParts[0];
  if (nameParts.length > 1) {
    const lastPart = nameParts[nameParts.length - 1];
    baseUsername += lastPart.length <= 7 ? lastPart : lastPart.substring(0, 5);
  }
  baseUsername = baseUsername.substring(0, 12);

  let username = baseUsername;
  let counter  = Math.floor(Math.random() * 100);
  let exists   = true;

  while (exists) {
    const result = await ExecuteQuery(
      null,
      `SELECT COUNT(*) AS count FROM eduall_system_accounts
       WHERE ed_system_account_deleted = 0 AND ed_system_account_name = ?`,
      [username],
      true,
      { db: "eduall_system_accounts", type: "select" }
    );
    if (result[0].count === 0) {
      exists = false;
    } else {
      username = `${baseUsername}${counter++}`;
    }
  }
  return username;
};

// ─── Sub-rotina: garante conta de app ────────────────────────────────────────
// Idêntica à do UnifiedAccountRegister — valida licença, cria se não existe.
const ensureAppAccount = async (userId, employeeId, employeeName, instituteCode, appType, req, res) => {
  const appMeta = INTERNAL_APPS[appType];

  // Valida licença da instituição para esta app
  const licence = await ExecuteQuery(
    res,
    `SELECT ed_institute_app_id FROM eduall_institute_apps
     WHERE ed_institute_app_instituteCode = ?
       AND ed_institute_app_type = ?
       AND ed_institute_app_deleted = 0
       AND ed_institute_app_endDate > NOW()
     LIMIT 1`,
    [instituteCode, appType],
    true,
    { db: "eduall_institute_apps", type: "select", data: req }
  );

  if (!licence?.length) {
    throw new Error(
      `A instituição não possui licença válida para "${appMeta.label}". Adquira ou renove a licença antes de atribuir acessos.`
    );
  }

  // Verifica se já existe conta para este funcionário + app + instituto
  const existing = await ExecuteQuery(
    res,
    `SELECT ed_system_account_id, ed_system_account_name
     FROM eduall_system_accounts
     WHERE ed_system_account_employee = ?
       AND ed_system_account_institute_code = ?
       AND ed_system_account_app_type = ?
       AND ed_system_account_deleted = 0
     LIMIT 1`,
    [employeeId, instituteCode, appType],
    true,
    { db: "eduall_system_accounts", type: "select", data: req }
  );

  if (existing?.length) {
    return {
      username:      existing[0].ed_system_account_name,
      accountId:     existing[0].ed_system_account_id,
      alreadyExisted: true,
    };
  }

  const username = await generateUsername(employeeName);

  await ExecuteQuery(
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

  const newAcc = await ExecuteQuery(
    res,
    `SELECT ed_system_account_id FROM eduall_system_accounts
     WHERE ed_system_account_name = ?
       AND ed_system_account_employee = ?
       AND ed_system_account_app_type = ?
     LIMIT 1`,
    [username, employeeId, appType],
    true,
    { db: "eduall_system_accounts", type: "select", data: req }
  );

  const accountId = newAcc?.[0]?.ed_system_account_id;
  if (!accountId) throw new Error("Erro ao recuperar ID da conta de app.");

  return { username, accountId, alreadyExisted: false };
};

// ─── Sub-rotina: remove conta de app (soft delete) ───────────────────────────
const removeAppAccount = async (employeeId, instituteCode, appType, req, res) => {
  await ExecuteQuery(
    res,
    `UPDATE eduall_system_accounts
     SET ed_system_account_deleted = 1
     WHERE ed_system_account_employee = ?
       AND ed_system_account_institute_code = ?
       AND ed_system_account_app_type = ?
       AND ed_system_account_deleted = 0`,
    [employeeId, instituteCode, appType],
    false,
    { db: "eduall_system_accounts", type: "update", data: req }
  );
};

// ─── Sub-rotina: lista apps atribuídas a um funcionário ──────────────────────
const getAssignedApps = async (employeeId, instituteCode, req, res) => {
  const rows = await ExecuteQuery(
    res,
    `SELECT ed_system_account_app_type AS appType
     FROM eduall_system_accounts
     WHERE ed_system_account_employee = ?
       AND ed_system_account_institute_code = ?
       AND ed_system_account_app_type IS NOT NULL
       AND ed_system_account_deleted = 0`,
    [employeeId, instituteCode],
    true,
    { db: "eduall_system_accounts", type: "select", data: req }
  );
  return (rows || []).map(r => r.appType);
};

// ─── Controllers ─────────────────────────────────────────────────────────────

/**
 * GET /eduallinstituteuseraccountsget/get
 * Lista todas as contas de sistema da instituição.
 */
const GetInstituteUserAccounts = async (req, res) => {
  try {
    const CODE = req.session.user.eduall_user_session_curentinstitute;
    const query = `
      SELECT * FROM eduall_system_accounts
      LEFT JOIN eduall_employees
        ON eduall_system_accounts.ed_system_account_employee = eduall_employees.ed_employee_id
      WHERE eduall_employees.ed_employee_deleted = 0
        AND eduall_system_accounts.ed_system_account_institute_code = ?
      ORDER BY eduall_employees.ed_employee_name ASC`;
    const result = await ExecuteQuery(res, query, [CODE], true, {
      db: "eduall_system_accounts", type: "select", data: req,
    });
    res.status(200).json(result);
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Erro ao buscar contas dos usuários do instituto!",
      error: error.message,
    });
  }
};

/**
 * GET /eduallgetsinglesystemuseracccount/get/:ID
 * Devolve conta + acessos + apps atribuídas para um ID de system_account.
 */
const GetSingleInstituteUserAccount = async (req, res) => {
  try {
    const CODE = req.session.user.eduall_user_session_curentinstitute;
    const { ID } = req.params;

    const query = `
      SELECT
        eduall_system_accounts.*,
        eduall_user_access.*,
        eduall_employees.*
      FROM eduall_system_accounts
      LEFT JOIN eduall_user_access
        ON eduall_user_access.ed_user_access_usercode = eduall_system_accounts.ed_system_account_id
      LEFT JOIN eduall_employees
        ON eduall_employees.ed_employee_id = eduall_system_accounts.ed_system_account_employee
      WHERE eduall_system_accounts.ed_system_account_id = ?
        AND eduall_system_accounts.ed_system_account_institute_code = ?`;

    const result = await ExecuteQuery(res, query, [ID, CODE], true, {
      db: "eduall_system_accounts", type: "select", data: req,
    });

    if (!result || result.length === 0) {
      return res.status(404).json({ success: false, msg: "Conta não encontrada!" });
    }

    const account = result[0];

    // Adiciona lista de apps atribuídas ao funcionário nesta instituição
    const assignedApps = await getAssignedApps(
      account.ed_system_account_employee,
      CODE,
      req, res
    );

    res.status(200).json([{ ...account, assignedApps }]);
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Erro ao buscar conta de usuário do instituto!",
      error: error.message,
    });
  }
};

/**
 * GET /eduallgetavailableapps/get
 * Devolve lista de apps com flag hasLicence para a instituição actual.
 * (Endpoint necessário para o EditUserModal carregar a secção de apps.)
 */
const GetAvailableApps = async (req, res) => {
  try {
    const instituteCode = req.session.user.eduall_user_session_curentinstitute;

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

    const data = Object.values(INTERNAL_APPS).map(app => ({
      ...app,
      hasLicence: licencedTypes.has(app.id),
      expireDate: licences.find(l => l.ed_institute_app_type === app.id)?.ed_institute_app_endDate || null,
    }));

    return res.status(200).json({ success: true, data });
  } catch (error) {
    return res.status(500).json({ success: false, msg: "Erro ao obter apps!", error: error.message });
  }
};

/**
 * GET /eduallgetallappaccounts/get?employeeId=X
 * Devolve todas as contas de app de um funcionário na instituição actual.
 * (Endpoint necessário para o EditUserModal saber quais apps já estão atribuídas.)
 */
const GetEmployeeAppAccounts = async (req, res) => {
  try {
    const instituteCode = req.session.user.eduall_user_session_curentinstitute;
    const { employeeId } = req.query;

    if (!employeeId)
      return res.status(400).json({ success: false, msg: "employeeId obrigatório!" });

    const rows = await ExecuteQuery(
      res,
      `SELECT
         ed_system_account_id,
         ed_system_account_app_type AS appType,
         ed_system_account_name     AS username
       FROM eduall_system_accounts
       WHERE ed_system_account_employee = ?
         AND ed_system_account_institute_code = ?
         AND ed_system_account_app_type IS NOT NULL
         AND ed_system_account_deleted = 0`,
      [employeeId, instituteCode],
      true,
      { db: "eduall_system_accounts", type: "select", data: req }
    );

    return res.status(200).json({ success: true, data: rows || [] });
  } catch (error) {
    return res.status(500).json({ success: false, msg: "Erro ao listar apps do funcionário!", error: error.message });
  }
};

/**
 * PUT /edualldeleteappaccount/delete/:id
 * Soft-delete de uma conta de app pelo ed_system_account_id.
 */
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
      form:        "Contas do sistema",
      description: `Removeu conta de app com ID ${id}`,
    }).catch(() => {});

    return res.status(200).json({ success: true, msg: "Conta de app removida com sucesso!" });
  } catch (error) {
    return res.status(500).json({ success: false, msg: "Erro ao remover conta de app!", error: error.message });
  }
};

/**
 * POST /eduallinstituteuseraccountregister/post
 * Regista conta de sistema + acessos de dashboard + apps (opcional).
 *
 * Body:
 *   user_account_employee  — ID do funcionário
 *   access_pedagogy, access_myinstitute, access_portal, access_secretary,
 *   access_configuration, access_finances, access_administration,
 *   access_library, access_transportation  — acessos de dashboard (0 ou 1)
 *   apps  — array de appTypes a atribuir, ex: ["library", "hr"]  (opcional)
 */
const RegisterInstituteUserAccount = async (req, res) => {
  try {
    const CODE = req.session.user.eduall_user_session_curentinstitute;
    const {
      user_account_employee,
      access_pedagogy, access_myinstitute, access_portal, access_secretary,
      access_configuration, access_finances, access_administration,
      access_library, access_transportation,
      apps = [],
    } = req.body;

    // ── Valida funcionário ────────────────────────────────────────────────────
    const EmployeeData = await ExecuteQuery(
      res,
      `SELECT * FROM eduall_employees WHERE ed_employee_deleted = 0 AND ed_employee_id = ?`,
      [user_account_employee],
      true,
      { db: "eduall_employees", type: "select", data: req }
    );

    if (!EmployeeData.length)
      return res.status(400).json({ msg: "Funcionário não encontrado!" });

    // ── Valida conta Eduall do funcionário ────────────────────────────────────
    const existingUserAccount = await ExecuteQuery(
      res,
      `SELECT * FROM eduall_user_accounts
       WHERE ed_user_account_deleted = 0 AND ed_user_account_email = ?`,
      [EmployeeData[0].ed_employee_email],
      true,
      { db: "eduall_user_accounts", type: "select" }
    );

    if (!existingUserAccount.length)
      return res.status(400).json({ msg: "Nenhuma conta de usuário associada a este e-mail!" });

    // ── Verifica duplicado ────────────────────────────────────────────────────
    const existingAccount = await ExecuteQuery(
      res,
      `SELECT * FROM eduall_system_accounts
       WHERE ed_system_account_employee = ?
         AND ed_system_account_institute_code = ?
         AND ed_system_account_app_type IS NULL`,
      [user_account_employee, CODE],
      true,
      { db: "eduall_system_accounts", type: "select" }
    );

    if (existingAccount.length > 0)
      return res.status(400).json({ msg: "Este funcionário já tem uma conta associada a esta instituição!" });

    // ── Valida appTypes recebidos ─────────────────────────────────────────────
    const invalidApps = (apps || []).filter(a => !VALID_APP_TYPES.includes(a));
    if (invalidApps.length)
      return res.status(400).json({ msg: `Apps inválidas: ${invalidApps.join(", ")}` });

    // ── Cria system_account de dashboard ─────────────────────────────────────
    const user_account_name = await generateUsername(EmployeeData[0].ed_employee_name);
    const userId = existingUserAccount[0].ed_user_account_id;

    await ExecuteQuery(
      res,
      `INSERT INTO eduall_system_accounts
         (ed_system_account_name, ed_system_account_employee,
          ed_system_account_userid, ed_system_account_institute_code)
       VALUES (?, ?, ?, ?)`,
      [user_account_name, user_account_employee, userId, CODE],
      false,
      { db: "eduall_system_accounts", type: "insert" }
    );

    const newUser = await ExecuteQuery(
      res,
      `SELECT ed_system_account_id FROM eduall_system_accounts
       WHERE ed_system_account_name = ? AND ed_system_account_employee = ?
         AND ed_system_account_app_type IS NULL`,
      [user_account_name, user_account_employee],
      true,
      { db: "eduall_system_accounts", type: "select" }
    );

    if (!newUser.length)
      return res.status(500).json({ msg: "Erro ao recuperar ID da conta criada!" });

    const accountId = newUser[0].ed_system_account_id;

    // ── Insere acessos de dashboard ───────────────────────────────────────────
    await ExecuteQuery(
      res,
      `INSERT INTO eduall_user_access
         (ed_user_access_usercode, ed_user_access_pedagogicalarea,
          ed_user_access_myinstitute, ed_user_access_portal, ed_user_access_secretary,
          ed_user_access_configuration, ed_user_access_finances, ed_user_access_administration,
          ed_user_access_library, ed_user_access_transportation, ed_user_access_institute_code)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      [
        accountId, access_pedagogy, access_myinstitute, access_portal, access_secretary,
        access_configuration, access_finances, access_administration,
        access_library, access_transportation, CODE,
      ],
      false,
      { db: "eduall_user_access", type: "insert" }
    );

    // ── Cria contas de apps (se pedido) ───────────────────────────────────────
    const appResults = [];
    for (const appType of (apps || [])) {
      try {
        const ar = await ensureAppAccount(
          userId, user_account_employee, EmployeeData[0].ed_employee_name,
          CODE, appType, req, res
        );
        if (res.headersSent) return;
        appResults.push({ appType, appLabel: INTERNAL_APPS[appType].label, ...ar });
      } catch (appErr) {
        appResults.push({ appType, appLabel: INTERNAL_APPS[appType].label, error: appErr.message });
      }
    }

    await RegisterAuditAction({
      session:     req.session,
      action:      1,
      form:        "Contas do sistema",
      description: `Registou nova conta do sistema (${user_account_name})${apps.length ? ` + apps [${apps.join(", ")}]` : ""}`,
    });

    return res.status(200).json({
      msg:      "Conta de usuário registrada com sucesso!",
      username: user_account_name,
      apps:     appResults,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Erro ao registrar conta de usuário do instituto!",
      error: error.message,
    });
  }
};

/**
 * PUT /edualluserinstituteaccountupdate/update/:ID
 * Actualiza acessos de dashboard + sincroniza apps do funcionário.
 *
 * Body:
 *   access_pedagogy, access_myinstitute, access_portal, access_secretary,
 *   access_configuration, access_finances, access_administration,
 *   access_library, access_transportation  — acessos de dashboard (0 ou 1)
 *   apps  — array com os appTypes que DEVEM ficar atribuídos após o update.
 *           O endpoint calcula o diff (adiciona os novos, remove os que saíram).
 *           Se apps não for enviado, os acessos de apps não são alterados.
 */
const UpdateInstituteUserAccount = async (req, res) => {
  try {
    const CODE = req.session.user.eduall_user_session_curentinstitute;
    const { ID } = req.params;
    const {
      access_pedagogy, access_myinstitute, access_portal, access_secretary,
      access_configuration, access_finances, access_administration,
      access_library, access_transportation,
      apps, // undefined = não alterar apps; [] = remover todas; ["library"] = manter só esta
    } = req.body;

    // ── Valida conta ──────────────────────────────────────────────────────────
    const userAccount = await ExecuteQuery(
      res,
      `SELECT ed_system_account_employee, ed_system_account_userid
       FROM eduall_system_accounts
       WHERE ed_system_account_id = ? AND ed_system_account_institute_code = ?`,
      [ID, CODE],
      true,
      { db: "eduall_system_accounts", type: "select" }
    );

    if (!userAccount.length)
      return res.status(400).json({ msg: "Conta de usuário não encontrada!" });

    const employeeId = userAccount[0].ed_system_account_employee;
    const userId     = userAccount[0].ed_system_account_userid;

    // ── Actualiza acessos de dashboard ────────────────────────────────────────
    await ExecuteQuery(
      res,
      `UPDATE eduall_user_access SET
         ed_user_access_pedagogicalarea  = ?,
         ed_user_access_myinstitute      = ?,
         ed_user_access_portal           = ?,
         ed_user_access_secretary        = ?,
         ed_user_access_configuration    = ?,
         ed_user_access_finances         = ?,
         ed_user_access_administration   = ?,
         ed_user_access_library          = ?,
         ed_user_access_transportation   = ?
       WHERE ed_user_access_usercode = ? AND ed_user_access_institute_code = ?`,
      [
        access_pedagogy, access_myinstitute, access_portal, access_secretary,
        access_configuration, access_finances, access_administration,
        access_library, access_transportation,
        ID, CODE,
      ],
      false,
      { db: "eduall_user_access", type: "update" }
    );

    // ── Sincroniza apps (só se apps foi enviado no body) ──────────────────────
    const appResults = [];
    if (Array.isArray(apps)) {
      // Valida appTypes recebidos
      const invalidApps = apps.filter(a => !VALID_APP_TYPES.includes(a));
      if (invalidApps.length)
        return res.status(400).json({ msg: `Apps inválidas: ${invalidApps.join(", ")}` });

      // Busca nome do funcionário para gerar username nas novas contas
      const empRows = await ExecuteQuery(
        res,
        `SELECT ed_employee_name FROM eduall_employees WHERE ed_employee_id = ?`,
        [employeeId],
        true,
        { db: "eduall_employees", type: "select", data: req }
      );
      const employeeName = empRows?.[0]?.ed_employee_name || "Utilizador";

      // Diff: o que existe agora vs o que deve ficar
      const currentApps = await getAssignedApps(employeeId, CODE, req, res);
      const toAdd    = apps.filter(a => !currentApps.includes(a));
      const toRemove = currentApps.filter(a => !apps.includes(a));

      // Adiciona novas apps
      for (const appType of toAdd) {
        try {
          const ar = await ensureAppAccount(userId, employeeId, employeeName, CODE, appType, req, res);
          if (res.headersSent) return;
          appResults.push({ appType, appLabel: INTERNAL_APPS[appType].label, action: "added", ...ar });
        } catch (appErr) {
          appResults.push({ appType, appLabel: INTERNAL_APPS[appType].label, action: "add_failed", error: appErr.message });
        }
      }

      // Remove apps desmarcadas
      for (const appType of toRemove) {
        try {
          await removeAppAccount(employeeId, CODE, appType, req, res);
          appResults.push({ appType, appLabel: INTERNAL_APPS[appType].label, action: "removed" });
        } catch (appErr) {
          appResults.push({ appType, appLabel: INTERNAL_APPS[appType].label, action: "remove_failed", error: appErr.message });
        }
      }
    }

    await RegisterAuditAction({
      session:     req.session,
      action:      2,
      form:        "Contas do sistema",
      description: `Actualizou acessos da conta ID ${ID}${appResults.length ? ` | apps: ${appResults.map(a => `${a.action}:${a.appType}`).join(", ")}` : ""}`,
    }).catch(() => {});

    return res.status(200).json({
      msg:  "Acessos do usuário atualizados com sucesso!",
      apps: appResults,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Erro ao atualizar acessos do usuário!",
      error: error.message,
    });
  }
};

/**
 * PUT /edualluserinstituteaccountdelete/delete/:ID
 * Toggle deleted (activa/desactiva conta).
 */
const DeleteUserInstituteAccount = async (req, res) => {
  try {
    const CODE = req.session.user.eduall_user_session_curentinstitute;
    const { ID } = req.params;

    const userAccount = await ExecuteQuery(
      res,
      `SELECT ed_system_account_deleted FROM eduall_system_accounts
       WHERE ed_system_account_id = ? AND ed_system_account_institute_code = ?`,
      [ID, CODE],
      true,
      { db: "eduall_system_accounts", type: "select" }
    );

    if (!userAccount.length)
      return res.status(400).json({ msg: "Conta de usuário não encontrada!" });

    const newStatus = userAccount[0].ed_system_account_deleted === 1 ? 0 : 1;

    await ExecuteQuery(
      res,
      `UPDATE eduall_system_accounts SET ed_system_account_deleted = ?
       WHERE ed_system_account_id = ? AND ed_system_account_institute_code = ?`,
      [newStatus, ID, CODE],
      false,
      { db: "eduall_system_accounts", type: "update" }
    );

    await RegisterAuditAction({
      session:     req.session,
      action:      3,
      form:        "Contas do sistema",
      description: `${newStatus === 1 ? "Desactivou" : "Reactivou"} conta do sistema com ID ${ID}`,
    });

    const message = newStatus === 1
      ? "Conta de usuário desactivada com sucesso!"
      : "Conta de usuário reactivada com sucesso!";

    return res.status(200).json({ msg: message });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Erro ao atualizar status da conta de usuário!",
      error: error.message,
    });
  }
};

module.exports = {
  RegisterInstituteUserAccount,
  GetInstituteUserAccounts,
  GetSingleInstituteUserAccount,
  UpdateInstituteUserAccount,
  DeleteUserInstituteAccount,
  // Novos endpoints necessários para o EditUserModal
  GetAvailableApps,
  GetEmployeeAppAccounts,
  DeleteAppAccount,
};