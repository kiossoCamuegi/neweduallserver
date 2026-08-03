"use strict";

/**
 * RefreshToken.js
 * ─────────────────────────────────────────────────────────────
 * Emite um novo accessToken a partir da sessão activa.
 * Também devolve redirectTo, apps e dedidatedAppType para que o frontend
 * saiba para onde navegar sem fazer requests adicionais.
 * 
 * LÓGICA DE APP DEDICADA:
 * - Se o utilizador tem ed_system_account_app_type explícita (library, hr, security)
 *   essa app é DEDICADA e tem prioridade sobre o dashboard access
 * - Se não tem app_type dedicada, segue lógica normal (dashboard > app > denied)
 */
 
const jwt  = require("jsonwebtoken");
const CalculateRemainingDays = require("../config/CalculateRemainingDays");
const ExecuteQuery           = require("../Functions/ExecuteQuery");
const { resolveRedirectTo, INTERNAL_APPS } = require("./Users");

const ACCESS_TTL = process.env.ACCESS_TOKEN_TTL || "15m";

// ─── SQL ─────────────────────────────────────────────────────
const SQL_USERNAME_LOOKUP = `
  SELECT *
  FROM eduall_employees
  LEFT JOIN eduall_system_accounts
    ON eduall_system_accounts.ed_system_account_employee = eduall_employees.ed_employee_id
  LEFT JOIN eduall_user_accounts
    ON eduall_user_accounts.ed_user_account_email = eduall_employees.ed_employee_email
  LEFT JOIN eduall_institutes
    ON eduall_institutes.ed_institute_code = eduall_system_accounts.ed_system_account_institute_code
  LEFT JOIN eduall_institutes_licences
    ON eduall_institutes_licences.ed_institute_licence_instituteCode = eduall_system_accounts.ed_system_account_institute_code
  WHERE eduall_user_accounts.ed_user_account_deleted    = 0
    AND eduall_employees.ed_employee_deleted             = 0
    AND eduall_system_accounts.ed_system_account_deleted = 0
    AND eduall_system_accounts.ed_system_account_name    = ?
  LIMIT 1`;

const SQL_USER_BY_REFRESH = `
  SELECT *
  FROM eduall_user_accounts
  WHERE ed_user_account_deleted = 0
    AND ed_usertoken = ?
  LIMIT 1`;

const SQL_ACCOUNT_AND_LICENCE = `
  SELECT *
  FROM eduall_system_accounts
  LEFT JOIN eduall_institutes
    ON eduall_system_accounts.ed_system_account_institute_code = eduall_institutes.ed_institute_code
  LEFT JOIN eduall_institutes_licences
    ON eduall_institutes_licences.ed_institute_licence_instituteCode = eduall_system_accounts.ed_system_account_institute_code
  WHERE eduall_system_accounts.ed_system_account_deleted = 0
    AND eduall_system_accounts.ed_system_account_userid   = ?
    AND eduall_institutes.ed_institute_code               = ?
  LIMIT 1`;

// ─── Helpers ──────────────────────────────────────────────────
const getValidTenant = (code) => {
  const isValid = (str) =>
    typeof str === "string" &&
    /^[a-z0-9]([a-z0-9\-]{0,61}[a-z0-9])?$/.test(str) &&
    str.length <= 63;

  if (isValid(code)) return code;
  const slug = String(code || "").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 50);
  return `tenant-${slug || "default"}`;
};

const issueAccessToken = (payload) =>
  jwt.sign(payload, process.env.ACCESS_TOKEN_SECRET, { expiresIn: ACCESS_TTL });

/**
 * fetchUserAccessAndApps
 * Idêntica à do Login.js — centraliza a lógica de acessos, apps e redirectTo.
 *
 * @param {number|string} accountId    - ed_system_account_id  (conta de sistema)
 * @param {number|string} employeeId   - ed_system_account_employee
 * @param {string}        instituteCode
 * @param {string}        dedicatedAppType - ed_system_account_app_type (se existir)
 */
const fetchUserAccessAndApps = async (accountId, employeeId, instituteCode, dedicatedAppType, req) => {
  // ── Acessos de dashboard ────────────────────────────────────
  let accessRow = null;
  if (accountId) {
    const rows = await ExecuteQuery(
      null,
      `SELECT * FROM eduall_user_access WHERE ed_user_access_usercode = ? LIMIT 1`,
      [accountId],
      true,
      { db: "eduall_user_access", type: "select", data: req }
    );
    accessRow = rows?.[0] ?? null;
  }

  // ── Apps atribuídas ─────────────────────────────────────────
  let apps = [];
  if (employeeId && instituteCode) {
    const appRows = await ExecuteQuery(
      null,
      `SELECT
         ed_system_account_id       AS accountId,
         ed_system_account_name     AS username,
         ed_system_account_app_type AS appType
       FROM eduall_system_accounts
       WHERE ed_system_account_employee       = ?
         AND ed_system_account_institute_code = ?
         AND ed_system_account_app_type IS NOT NULL
         AND ed_system_account_deleted        = 0`,
      [employeeId, instituteCode],
      true,
      { db: "eduall_system_accounts", type: "select", data: req }
    );

    apps = (appRows || []).map(r => ({
      accountId: r.accountId,
      username:  r.username,
      appType:   r.appType,
      appLabel:  INTERNAL_APPS[r.appType]?.label || r.appType,
      appRoute:  INTERNAL_APPS[r.appType]?.route || "/",
    }));
  }

  const appTypes   = apps.map(a => a.appType);
  const redirectTo = resolveRedirectTo(accessRow, appTypes);

  return { accessRow, apps, appTypes, redirectTo, dedicatedAppType };
};

// ─── Controller ───────────────────────────────────────────────
const RefreshToken = async (req, res) => {
  try {
    if (!req.session?.user) {
      return res.status(200).json({ data: null, sessions: req.session });
    }

    const {
      eduall_user_session_refreshToken:         refreshToken,
      eduall_user_session_username:             adminUsername,
      eduall_user_session_curentinstitute:      currentInstitute,
      eduall_user_session_curentinstitute_type: instituteType,
    } = req.session.user;

    if (!refreshToken) {
      return res.status(401).json({ msg: "Token de sessão em falta." });
    }

    // ── Sessão admin / staff ──────────────────────────────────
    if (adminUsername) {
      const row = (
        await ExecuteQuery(res, SQL_USERNAME_LOOKUP, [adminUsername], true, {
          db: "eduall_employees", type: "select", data: req,
        })
      )?.[0];

      if (!row) {
        return res.status(401).json({ msg: "Utilizador não encontrado na sessão." });
      }

      if (CalculateRemainingDays(row.ed_institute_licence_startDate, row.ed_institute_licence_endDate) <= 0) {
        return res.status(403).json({ msg: "Acesso bloqueado, por favor renove a sua licença." });
      }

      const cr_institutecode = getValidTenant(currentInstitute);

      const pair = (
        await ExecuteQuery(res, SQL_ACCOUNT_AND_LICENCE,
          [row.ed_system_account_userid, row.ed_system_account_institute_code],
          true,
          { db: "eduall_system_accounts", type: "select", data: req }
        )
      )?.[0];

      if (!pair) {
        req.session.user.eduall_user_session_curentinstitute = null;
        return res.status(403).json({ msg: "Não foi possível validar a licença da instituição." });
      }

      const remaining = CalculateRemainingDays(
        pair.ed_institute_licence_startDate,
        pair.ed_institute_licence_endDate
      );

      if (remaining <= 0) {
        req.session.user.eduall_user_session_curentinstitute = null;
        return res.status(403).json({ msg: "A sua licença expirou. Por favor renove." });
      }

      const accessToken = issueAccessToken({
        cr_usercode:       row.ed_user_account_id,
        cr_institutecode,
        cr_user_largecode: row.ed_user_account_code,
        cr_institutetype:  instituteType,
        cr_username_id:    row.ed_system_account_id,
        cr_username:       row.ed_user_account_name,
        cr_useremail:      row.ed_user_account_email,
        cr_usertype:       0,
        userapp:row.ed_system_account_app_type,
      });

      const LicenceData = { ...pair, remaining };

      // ── Acessos + apps + redirectTo + dedicatedAppType ───────
      let redirectTo = "/Dashboard";
      let apps       = [];
      let dedicatedAppType = null;

      try {
        // 🔑 CHAVE: o appType da conta de sistema do utilizador
        const accountAppType = row.ed_system_account_app_type || null;
        
        const result = await fetchUserAccessAndApps(
          row.ed_system_account_id,       // accountId  (conta de sistema, igual ao Login)
          row.ed_system_account_employee, // employeeId
          row.ed_system_account_institute_code, // instituteCode
          accountAppType, // 👈 Passar o appType dedicado
          req
        );

        apps             = result.apps;
        redirectTo       = result.redirectTo ?? "/Dashboard";
        dedicatedAppType = result.dedicatedAppType; // 👈 Retornar

        console.log(`[RefreshToken] ✅ AppType dedicada: "${dedicatedAppType}"`);
      } catch (accessErr) {
        // Falha ao carregar acessos não deve bloquear o refresh
        console.warn("[RefreshToken] Aviso ao carregar acessos:", accessErr.message);
      }

      const mydata = {
        accessToken,
        LicenceData,
        redirectTo,
        cr_institutecode,
        apps,
        dedicatedAppType, // 👈 Retornar no response
      };
      
      return res.status(200).json(mydata);
    }

    // ── Sessão utilizador comum (email login) ─────────────────
    const user = (
      await ExecuteQuery(res, SQL_USER_BY_REFRESH, [refreshToken], true, {
        db: "eduall_user_accounts", type: "select", data: req,
      })
    )?.[0];

    if (!user) {
      return res.status(401).json({ msg: "Não foi possível validar as suas credenciais." });
    }

    const accessToken = issueAccessToken({
      cr_usercode:       user.ed_user_account_id,
      cr_user_largecode: user.ed_user_account_code,
      cr_username:       user.ed_user_account_name,
      cr_useremail:      user.ed_user_account_email,
      cr_usertype:       1,
    });

    // Utilizador portal → destino fixo, sem apps de gestão
    return res.status(200).json({
      accessToken,
      redirectTo: "/WorkSpaces",
      apps:       [],
      dedicatedAppType: null, // Utilizador comum não tem app dedicada
    });

  } catch (err) {
    console.error("[RefreshToken]", err?.message || err);
    return res.status(500).json({ msg: "Erro ao estabelecer ligação com o servidor." });
  }
};

module.exports = RefreshToken;