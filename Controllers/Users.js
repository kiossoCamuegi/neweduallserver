"use strict";

const bcrypt             = require("bcryptjs");
const jwt                = require("jsonwebtoken");
const multer             = require("multer");
const path               = require("path");
const fs                 = require("fs");
const fsPromises         = require("fs").promises;  // ← NOVO: fs.promises para async
const axios              = require("axios");
const nodeMailer         = require("nodemailer");
const { passwordStrength } = require("check-password-strength");

const { DATABASE }             = require("../config/Database");
const CheckInternet            = require("../config/CheckInternet");
const CalculateRemainingDays   = require("../config/CalculateRemainingDays");
const ExecuteQuery             = require("../Functions/ExecuteQuery");
const { MailOptions }          = require("../Functions/MailOptions");
const { OAuth2Client }         = require("google-auth-library");
const { decrypt } = require("../Functions/VENDUS");
const { safeDecrypt } = require("../Functions/VENDUS");

require("dotenv").config();
const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

// ─── Constantes ───────────────────────────────────────────────
const ACCESS_TTL  = process.env.ACCESS_TOKEN_TTL  || "15m";
const REFRESH_TTL = process.env.REFRESH_TOKEN_TTL || "7d";
const BCRYPT_ROUNDS = 12;
const VERIFICATION_CODE_LENGTH = 50;
const VERIFICATION_EXPIRE_HOURS = 42;
const CODE_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

   



const EMAIL_REGEXP =
  /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;

// ─── SQL base — definidos uma vez, reutilizados O(1) ─────────
const SQL = {
  USER_BY_EMAIL: `
    SELECT * FROM eduall_user_accounts
    WHERE ed_user_account_deleted = 0 AND ed_user_account_email = ?
    LIMIT 1`,

  USER_BY_ID: `
    SELECT * FROM eduall_user_accounts
    WHERE ed_user_account_deleted = 0 AND ed_user_account_id = ?
    LIMIT 1`,

  USERNAME_LOGIN: `
    SELECT *
    FROM eduall_employees
    LEFT JOIN eduall_system_accounts
      ON eduall_system_accounts.ed_system_account_employee = eduall_employees.ed_employee_id
    LEFT JOIN eduall_user_accounts
      ON eduall_user_accounts.ed_user_account_id = eduall_system_accounts.ed_system_account_userid
    LEFT JOIN eduall_institutes
      ON eduall_institutes.ed_institute_code = eduall_system_accounts.ed_system_account_institute_code
    LEFT JOIN eduall_institutes_licences
      ON eduall_institutes_licences.ed_institute_licence_instituteCode = eduall_system_accounts.ed_system_account_institute_code
    WHERE eduall_user_accounts.ed_user_account_deleted = 0
      AND eduall_employees.ed_employee_deleted = 0
      AND eduall_system_accounts.ed_system_account_deleted = 0
      AND eduall_system_accounts.ed_system_account_name = ?
    LIMIT 1`,

  VERIFICATION_LATEST: `
    SELECT * FROM eduall_accounts_verification
    WHERE ed_account_verification_user = ?
    ORDER BY ed_account_verification_createDate DESC
    LIMIT 1`,

  VERIFICATION_DELETE_BY_USER: `
    DELETE FROM eduall_accounts_verification
    WHERE ed_account_verification_user = ?`,

  VERIFICATION_DELETE_BY_ID: `
    DELETE FROM eduall_accounts_verification
    WHERE ed_account_verification_id = ?`,

  VERIFICATION_INSERT: `
    INSERT INTO eduall_accounts_verification
      (ed_account_verification_user, ed_account_verification_code,
       ed_account_verification_createDate, ed_account_verification_expireDate)
    VALUES (?, ?, NOW(), DATE_ADD(NOW(), INTERVAL ? HOUR))`,

  USER_ACTIVATE: `
    UPDATE eduall_user_accounts
    SET ed_user_account_status = 1
    WHERE ed_user_account_deleted = 0 AND ed_user_account_id = ?`,

  USER_UPDATE_PASSWORD: `
    UPDATE eduall_user_accounts
    SET ed_user_account_password = ?
    WHERE ed_user_account_deleted = 0 AND ed_user_account_id = ?`,

  USER_UPDATE_TOKEN: `
    UPDATE eduall_user_accounts
    SET ed_usertoken = ?
    WHERE ed_user_account_deleted = 0 AND ed_user_account_id = ?`,
};

// ─── Utilitarios puros — O(1) ─────────────────────────────────

/** Valida formato de email — O(n) onde n = len(str), pratico O(1) */
const isValidEmail = (v) => EMAIL_REGEXP.test(String(v || "").trim());

/** Gera codigo alfanumerico aleatorio — O(len) */
const generateCode = (len = VERIFICATION_CODE_LENGTH) =>
  Array.from({ length: len }, () =>
    CODE_ALPHABET.charAt(Math.floor(Math.random() * CODE_ALPHABET.length))
  ).join("");

/** Cor de avatar aleatoria — O(1) */
const randomAvatarColor = () => {
  const colors = [
    "#A2D2FF","#CDB4DB","#FB5607","#FF006E","#8D99AE","#57CC99",
    "#22577A","#80ED99","#E29578","#E56B6F","#A663CC","#FF9E00","#F9C74F",
  ];
  return colors[Math.floor(Math.random() * colors.length)];
};

/** Slug de tenant valido — O(n) */
const getValidTenant = (code) => {
  const isValid = (s) =>
    typeof s === "string" &&
    /^[a-z0-9]([a-z0-9\-]{0,61}[a-z0-9])?$/.test(s) &&
    s.length <= 63;

  if (isValid(code)) return code;
  const slug = String(code || "").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 50);
  return `tenant-${slug || "default"}`;
};

// ─── Auth helpers ─────────────────────────────────────────────

/** Emite access + refresh token — O(1) */
const issueTokens = (payload) => {
  const accessToken = jwt.sign(payload, process.env.ACCESS_TOKEN_SECRET, {
    expiresIn: ACCESS_TTL,
  });

  const refreshPayload = {
    cr_usercode:    payload.cr_usercode,
    cr_code:        payload.cr_user_largecode,
    cr_username:    payload.cr_username,
    cr_useremail:   payload.cr_useremail,
    ...(payload.cr_institutecode ? { cr_institutecode: payload.cr_institutecode } : {}),
  };

  const refreshToken = jwt.sign(refreshPayload, process.env.REFRESH_TOKEN_SECRET, {
    expiresIn: REFRESH_TTL,
  });

  return { accessToken, refreshToken };
};

/**
 * Persiste refresh token na BD — O(1)
 * CORRECAO: estava a faltar await em UPDATETOKEN, devolvia sempre true.
 */
const persistRefreshToken = async (userId, refreshToken) => {
  try {
    const result = await ExecuteQuery(
      null,
      SQL.USER_UPDATE_TOKEN,
      [refreshToken, userId],
      false,
      { db: "eduall_user_accounts", type: "update" }
    );
    return (result?.affectedRows ?? 0) > 0;
  } catch (e) {
    console.error("[persistRefreshToken]", e.message);
    return false;
  }
};

/** Regista login — O(1), nao bloqueia o fluxo em caso de erro */
const logLogin = async (userId, type) => {
  try {
    await ExecuteQuery(
      null,
      `INSERT INTO eduall_login_registers (ed_log_user, ed_log_zone, ed_log_type) VALUES (?, ?, ?)`,
      [userId, 2, type],
      false,
      { db: "eduall_login_registers", type: "insert", data: { userId, type } }
    );
  } catch (e) {
    console.warn("[logLogin] Falha ao registar login:", e.message);
  }
};

/** Escreve / actualiza sessao — O(1) */
const setSession = (req, data) => {
  req.session.user = { ...(req.session.user || {}), ...data };
};

/** Responde com tokens e sessao — O(1) */
const createSessionAndRespond = async (user, req, res, msg) => {
  const payload = {
    cr_usercode:      user.ed_user_account_id,
    cr_user_largecode: user.ed_user_account_code,
    cr_username:      user.ed_user_account_name,
    cr_useremail:     user.ed_user_account_email,
    cr_usertype:      1,
  };

  const { accessToken, refreshToken } = issueTokens(payload);
  if (!refreshToken)
    return res.status(500).json({ msg: "Erro ao gerar refresh token!", errorCode: "TOKEN_GENERATION_ERROR" });

  const persisted = await persistRefreshToken(payload.cr_usercode, refreshToken);
  if (!persisted)
    return res.status(400).json({ msg: "Erro ao actualizar o token.", errorCode: "TOKEN_UPDATE_ERROR" });

  await logLogin(payload.cr_usercode, "google");

  setSession(req, {
    eduall_user_session_refreshToken: refreshToken,
    eduall_user_session_ID: payload.cr_usercode,
    accessToken,
  });

  return res.status(200).json({
    msg,
    accessToken,
    refreshToken,
    extra: req.session.user,
    requestData: {
      email:   user.ed_user_account_email,
      name:    user.ed_user_account_name,
      picture: user.ed_user_account_picture,
    },
  });
};

// ─── Email ────────────────────────────────────────────────────

/** Envia email via transporter — O(1) de computacao, I/O async */
const sendMail = async ({ to, subject, html }) => {
  const transporter = nodeMailer.createTransport(MailOptions());
  return transporter.sendMail({
    from: "noreply@eduall.site",
    to,     // CORRECAO: sempre o email passado como argumento, nunca hardcoded
    subject,
    html,
  });
};

/**
 * Envia codigo de verificacao e grava hash na BD.
 *
 * CORRECOES:
 *   - `data: res` -> `data: req` em todos os ExecuteQuery internos
 *   - Rollback do utilizador removido: so apaga se for registo novo (rollbackUserId)
 *   - Email enviado para `ed_user_email` (parametro), nunca para fallback
 *
 * @param {string}  ed_user_email   - Destinatario correcto
 * @param {number}  id              - ID do utilizador
 * @param {object}  res             - Express response
 * @param {object}  req             - Express request (NOVO parametro obrigatorio)
 * @param {string|null} customHtml  - HTML personalizado (opcional)
 * @param {string|null} subject     - Assunto personalizado (opcional)
 * @param {string|null} codeOverride - Codigo pre-definido (para reset de senha)
 * @param {boolean} rollbackOnFail  - Se true, apaga o utilizador se o email falhar
 */
const SendVerificationCode = async (
  ed_user_email,
  id,
  res,
  req,                        // CORRECAO: req agora e passado explicitamente
  customHtml   = null,
  subject      = null,
  codeOverride = null,
  rollbackOnFail = false
) => {
  try {
    // Valida o email antes de qualquer operacao — O(1)
    if (!isValidEmail(ed_user_email)) {
      return res.status(400).json({ msg: "Email do destinatario invalido!" });
    }

    const Code = codeOverride || generateCode(VERIFICATION_CODE_LENGTH);

    // Hash do codigo — O(2^BCRYPT_ROUNDS)
    const salt     = await bcrypt.genSalt(BCRYPT_ROUNDS);
    const hashCode = await bcrypt.hash(Code, salt);

    // Apaga tokens antigos deste utilizador — O(1) com idx_user
    await ExecuteQuery(
      res,
      SQL.VERIFICATION_DELETE_BY_USER,
      [id],
      false,
      { db: "eduall_accounts_verification", type: "delete", data: req } // CORRECAO: req
    );

    // Grava novo token com expiracao — O(1)
    await ExecuteQuery(
      res,
      SQL.VERIFICATION_INSERT,
      [id, hashCode, VERIFICATION_EXPIRE_HOURS],
      false,
      { db: "eduall_accounts_verification", type: "insert", data: req } // CORRECAO: req
    );

    // Constroi o HTML do email
    const html = customHtml || EmailTemplate(
      `Active a sua conta Eduall clicando no botao abaixo.`,
      `${process.env.APP_CLIENT_URL}/eduall_user_account_verification/${id},${Code}`,
      `Clique Aqui`,
      `Confirmacao de registo de conta`
    );

    // Envia para o email correcto — CORRECAO principal
    await sendMail({
      to:      ed_user_email,   // nunca cai para fallback
      subject: subject || "Eduall - Confirmar registo de conta",
      html,
    });

    return res.status(200).json({ msg: "Conta criada com sucesso!" });

  } catch (error) {
    console.error("[SendVerificationCode]", error.message || error);

    // Rollback apenas se solicitado e for novo registo — O(1)
    if (rollbackOnFail && id) {
      try {
        await ExecuteQuery(
          res,
          `DELETE FROM eduall_user_accounts WHERE ed_user_account_id = ?`,
          [id],
          false,
          { db: "eduall_user_accounts", type: "delete", data: req }
        );
      } catch (rbErr) {
        console.error("[SendVerificationCode] Rollback falhou:", rbErr.message);
      }
    }

    if (!res.headersSent)
      return res.status(500).json({ msg: "Erro ao enviar email de verificacao!" });
  }
};

// ─── Verificacao de token — helper reutilizavel ───────────────

/**
 * Busca e valida o token de verificacao mais recente — O(1) com idx_user
 * Devolve { rec } se valido, ou envia resposta de erro e devolve null.
 */
const resolveVerificationToken = async (userId, code, res, req) => {
  const rows = await ExecuteQuery(
    res,
    SQL.VERIFICATION_LATEST,
    [userId],
    true,
    { db: "eduall_accounts_verification", type: "select", data: req }
  );

  const rec = rows?.[0];
  if (!rec) {
    res.status(400).json({ msg: "Codigo de verificacao invalido ou inexistente!" });
    return null;
  }

  // Verifica expiracao — O(1)
  if (new Date(rec.ed_account_verification_expireDate).getTime() <= Date.now()) {
    await ExecuteQuery(
      res,
      SQL.VERIFICATION_DELETE_BY_ID,
      [rec.ed_account_verification_id],
      false,
      { db: "eduall_accounts_verification", type: "delete", data: req }
    );
    res.status(400).json({ msg: "Codigo expirou, solicite outro!" });
    return null;
  }

  // Compara hash — O(2^cost)
  const ok = bcrypt.compareSync(code, rec.ed_account_verification_code);
  if (!ok) {
    res.status(400).json({ msg: "Codigo de verificacao errado!" });
    return null;
  }

  return rec;
};

// ─── Controllers ─────────────────────────────────────────────
 
 


const SQL_USERNAME = `
  SELECT u.ed_user_account_id,
         u.ed_user_account_code,
         u.ed_user_account_name,
         u.ed_user_account_email,
         u.ed_user_account_password,
         s.ed_system_account_id,
         s.ed_system_account_name,
         s.ed_system_account_status,
         s.ed_system_account_institute_code,
         s.ed_system_account_employee,
         i.ed_institute_type,
         l.ed_institute_licence_startDate,
         l.ed_institute_licence_endDate
  FROM   eduall_user_accounts       u
  JOIN   eduall_system_accounts     s ON s.ed_system_account_userid          = u.ed_user_account_id
  JOIN   eduall_institutes          i ON i.ed_institute_code                  = s.ed_system_account_institute_code
  JOIN   eduall_institutes_licences l ON l.ed_institute_licence_instituteCode = i.ed_institute_code
  WHERE  u.ed_user_account_deleted   = 0
    AND  s.ed_system_account_deleted = 0
    AND  LOWER(s.ed_system_account_name) = ?
  LIMIT  1`;
 

const SQL_VENDUS = `
  SELECT api_key_encrypted, country, register_id
  FROM   eduall_vendus_config
  WHERE  institute_code = ? AND is_active = 1
  LIMIT  1`;


  const SQL_EMAIL = `
  SELECT ed_user_account_id,
         ed_user_account_code,
         ed_user_account_name,
         ed_user_account_email,
         ed_user_account_password
  FROM   eduall_user_accounts
  WHERE  ed_user_account_deleted = 0
    AND  ed_user_account_email   = ?
  LIMIT  1`;
 
  const fetchUserAccessAndApps = async (accountId, employeeId, instituteCode) => {
  // Acessos de dashboard
  let accessRow = null;
  if (accountId) {
    const rows = await ExecuteQuery(
      null,
      `SELECT * FROM eduall_user_access WHERE ed_user_access_usercode = ? LIMIT 1`,
      [accountId],
      true,
      { db: "eduall_user_access", type: "select" }
    );
    accessRow = rows?.[0] ?? null;
  }
 
  // Apps atribuídas
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
      { db: "eduall_system_accounts", type: "select" }
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
 
  return { accessRow, apps, appTypes, redirectTo };
};
 
// ─── Controller de Login ──────────────────────────────────────────────────────
const Login = async (req, res) => {
  try {
    const identifier = (req.body?.ed_user_account_email ?? req.body?.identifier ?? "").trim();
    const password   =  req.body?.ed_user_account_password ?? req.body?.password;

    if (!identifier || !password)
      return res.status(400).json({ msg: "Preencha correctamente os campos!", errorCode: "FIELDS_MISSING" });

    // ── 1. Login por e-mail ───────────────────────────────────────────────────
    if (/^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(identifier)) {
      const rows = await ExecuteQuery(res, SQL_EMAIL, [identifier], true,
        { db: "eduall_user_accounts", type: "select", data: req }
      );

      const user = rows?.[0];
      if (!user)
        return res.status(400).json({ msg: "Conta nao encontrada!", errorCode: "USER_NOT_FOUND" });

      const passwordMatch = user.ed_user_account_password
        ? await bcrypt.compare(password, user.ed_user_account_password)
        : false;
      if (!passwordMatch)
        return res.status(400).json({ msg: "Credenciais invalidas!", errorCode: "INVALID_CREDENTIALS" });

      const payload = {
        cr_usercode:       user.ed_user_account_id,
        cr_user_largecode: user.ed_user_account_code,
        cr_username:       user.ed_user_account_name,
        cr_useremail:      user.ed_user_account_email,
        cr_usertype:       1,
      };

      const { accessToken, refreshToken } = issueTokens(payload);
      if (!refreshToken)
        return res.status(500).json({ msg: "Erro ao gerar refresh token!", errorCode: "TOKEN_GENERATION_ERROR" });

      const persisted = await persistRefreshToken(payload.cr_usercode, refreshToken);
      if (!persisted)
        return res.status(400).json({ msg: "Erro ao actualizar o token.", errorCode: "TOKEN_UPDATE_ERROR" });

      await logLogin(payload.cr_usercode, "email");
      setSession(req, {
        eduall_user_session_refreshToken: refreshToken,
        eduall_user_session_ID:           payload.cr_usercode,
        accessToken,
      });

      // Login por email → sempre portal (type 1), sem dashboard nem apps
      return res.status(200).json({ accessToken, redirectTo: null });
    }

    // ── 2. Login por username ─────────────────────────────────────────────────
    const username = identifier.toLowerCase();

    const rows = await ExecuteQuery(res, SQL_USERNAME, [username], true,
      { db: "eduall_user_accounts", type: "select", data: req }
    );

    const u = rows?.[0];
    if (!u)
      return res.status(400).json({ msg: "Credenciais invalidas!", errorCode: "INVALID_CREDENTIALS" });

    // ── Log Vendus ────────────────────────────────────────────────────────────
    try {
      const vendusRows = await ExecuteQuery(null, SQL_VENDUS,
        [u.ed_system_account_institute_code], true,
        { db: "eduall_institutes", type: "select", data: {} }
      );
      if (vendusRows?.length) {
        const { api_key_encrypted, country, register_id } = vendusRows[0];
        if (!api_key_encrypted) {
          console.log("[Vendus] Instituto sem chave configurada.");
        } else {
          const apiKey = safeDecrypt(api_key_encrypted);
          if (!apiKey) {
            console.warn(`[Vendus] Chave ilegivel para instituto: ${u.ed_system_account_institute_code} — use POST /vendus/reencrypt`);
          } else {
            const L = "═".repeat(60);
            console.log("\x1b[33m%s\x1b[0m", [
              "",
              `  ╔${L}╗`,
              `  ║  ${"VENDUS CONFIG DETECTADA".padEnd(56)}  ║`,
              `  ╠${L}╣`,
              `  ║  Instituto   :  ${String(u.ed_system_account_institute_code).padEnd(40)}  ║`,
              `  ║  Pais        :  ${String(country).padEnd(40)}  ║`,
              `  ║  Register ID :  ${String(register_id).padEnd(40)}  ║`,
              `  ║  API Key     :  ${String(apiKey).padEnd(40)}  ║`,
              `  ╚${L}╝`,
              "",
            ].join("\n"));
          }
        }
      }
    } catch (vendusErr) {
      console.warn("\x1b[33m[Vendus]\x1b[0m Nao foi possivel ler config no login:", vendusErr.message);
    }

    // ── Validações ────────────────────────────────────────────────────────────
    if (!u.ed_user_account_password)
      return res.status(400).json({ msg: "Esta conta nao tem senha associada!", errorCode: "NO_PASSWORD" });

    const passwordMatch = await bcrypt.compare(password, u.ed_user_account_password);
    if (!passwordMatch)
      return res.status(400).json({ msg: "Credenciais invalidas!", errorCode: "INVALID_CREDENTIALS" });

    if (u.ed_system_account_status === 1)
      return res.status(403).json({ msg: "Conta desactivada por um administrador!", errorCode: "ACCOUNT_DEACTIVATED" });

    const remainingDays = Math.floor(
      (new Date(u.ed_institute_licence_endDate) - new Date(u.ed_institute_licence_startDate)) / 86_400_000
    );
    if (remainingDays <= 0)
      return res.status(403).json({ msg: "Acesso bloqueado, renove a sua licenca!", errorCode: "LICENSE_EXPIRED" });

    // ── Acessos + apps + redirectTo ───────────────────────────────────────────
    const { accessRow, apps, appTypes, redirectTo } = await fetchUserAccessAndApps(
      u.ed_system_account_id,
      u.ed_system_account_employee,
      u.ed_system_account_institute_code
    );

    // ── Tokens + sessão ───────────────────────────────────────────────────────
    const instituteCode = getValidTenant(u.ed_system_account_institute_code);

    const payload = {
      cr_usercode:       u.ed_user_account_id,
      cr_user_largecode: u.ed_user_account_code,
      cr_username:       u.ed_user_account_name,
      cr_useremail:      u.ed_user_account_email,
      cr_institutecode:  instituteCode,
      cr_usertype:       0,
    };

    const { accessToken, refreshToken } = issueTokens(payload);
    if (!refreshToken)
      return res.status(500).json({ msg: "Erro ao gerar refresh token!", errorCode: "TOKEN_GENERATION_ERROR" });

    const persisted = await persistRefreshToken(payload.cr_usercode, refreshToken);
    if (!persisted)
      return res.status(400).json({ msg: "Erro ao actualizar o token.", errorCode: "TOKEN_UPDATE_ERROR" });

    await logLogin(payload.cr_usercode, "username");
    setSession(req, {
      eduall_user_session_refreshToken:         refreshToken,
      eduall_user_session_username:             u.ed_system_account_name,
      eduall_user_session_curentinstitute:      u.ed_system_account_institute_code,
      eduall_user_session_curentinstitute_type: u.ed_institute_type * 1,
      eduall_user_session_ID:                   payload.cr_usercode,
      accessToken,
    });

    // ── Sem nenhum acesso (nem dashboard nem apps) → bloquear login ──────────
    if (redirectTo === null) {
      return res.status(403).json({
        msg: "A sua conta não possui acesso a nenhum módulo ou aplicativo. Contacte o administrador.",
        errorCode: "NO_ACCESS",
      });
    }

    // ── Resposta com redirectTo e apps ────────────────────────────────────────
    return res.status(200).json({
      accessToken,
      sessions:    req.session,
      redirectTo,
      apps,
    });

  } catch (err) {
    console.error("[Login]", err.message || err);
    return res.status(500).json({ msg: "Erro interno no servidor!", errorCode: "SERVER_ERROR" });
  }
};
 


/** Registo de nova conta — O(1) */
const RegisterUserAccount = async (req, res) => {
  try {
    const { ed_user_name, ed_user_email, ed_user_password, ed_user_country, create_by_inst } = req.body;
    const instituteCode = req.session?.user?.eduall_user_session_curentinstitute;

    if (create_by_inst === 1 && !instituteCode)
      return res.status(403).json({ success: false, msg: "Accesso negado: instituicao nao encontrada na sessao." });

    if (!isValidEmail(ed_user_email))
      return res.status(300).json({ msg: "Email invalido!" });

    if (passwordStrength(ed_user_password).value.toLowerCase() === "weak")
      return res.status(300).json({ msg: "Password demasiado fraca!" });

    if ((ed_user_name || "").length < 7)
      return res.status(300).json({ msg: "Nome invalido (minimo 7 caracteres)!" });

    if ((ed_user_country || "").length < 2)
      return res.status(300).json({ msg: "Pais invalido!" });

    // Verifica email duplicado — O(1) com idx_email
    const existing = await ExecuteQuery(
      res,
      `SELECT ed_user_account_id FROM eduall_user_accounts WHERE ed_user_account_deleted = 0 AND ed_user_account_email = ? LIMIT 1`,
      [ed_user_email],
      true,
      { db: "eduall_user_accounts", type: "select", data: req }
    );

    if (existing?.length)
      return res.status(300).json({ msg: "Este email ja esta a ser utilizado!" });

    // Hash da senha — O(2^BCRYPT_ROUNDS)
    const salt         = await bcrypt.genSalt(BCRYPT_ROUNDS);
    const hashPassword = await bcrypt.hash(ed_user_password, salt);

    // Insere utilizador — O(1)
    await ExecuteQuery(
      res,
      `INSERT INTO eduall_user_accounts (ed_user_account_name, ed_user_account_email, ed_user_account_password, ed_user_account_country)
       VALUES (?, ?, ?, ?)`,
      [ed_user_name, ed_user_email, hashPassword, ed_user_country],
      false,
      { db: "eduall_user_accounts", type: "insert", data: req }
    );

    // Busca utilizador criado — O(1) com idx_email
    const newUser = await ExecuteQuery(
      res,
      `SELECT * FROM eduall_user_accounts WHERE ed_user_account_deleted = 0 AND ed_user_account_email = ? LIMIT 1`,
      [ed_user_email],
      true,
      { db: "eduall_user_accounts", type: "select", data: req }
    );

    if (!newUser?.[0])
      return res.status(500).json({ msg: "Erro ao recuperar o utilizador criado!" });

    const userId = newUser[0].ed_user_account_id;

    // Insere detalhes — O(1)
    await ExecuteQuery(
      res,
      `INSERT INTO eduall_user_account_details (ed_user_account_detUSERID, ed_user_account_detAvatarColor) VALUES (?, ?)`,
      [userId, randomAvatarColor()],
      false,
      { db: "eduall_user_account_details", type: "insert", data: req }
    );

    // Email de conta criada por instituicao — nao bloqueia o registo
    if (create_by_inst === 1) {
      sendEduallAccountEmail(ed_user_email, ed_user_name, ed_user_password, instituteCode)
        .catch((e) => console.warn("[RegisterUserAccount] Email inst. falhou:", e.message));
    }

    // Envia codigo de verificacao — rollback activado em caso de falha de email
    await SendVerificationCode(
      ed_user_email,  // destinatario correcto
      userId,
      res,
      req,            // CORRECAO: passa req explicitamente
      null,
      null,
      null,
      true            // rollbackOnFail = true para novo registo
    );

  } catch (err) {
    console.error("[RegisterUserAccount]", err.message || err);
    if (!res.headersSent)
      return res.status(500).json({ msg: "Erro ao estabelecer ligacao com o servidor!", bug: { a: err.message } });
  }
};

/** Reenvia codigo de verificacao — O(1) */
const ResendVerificationCode = async (req, res) => {
  try {
    const userId = req.body.ed_verification_user;
    if (!userId)
      return res.status(400).json({ msg: "Utilizador invalido." });

    // Busca email — O(1)
    const userRows = await ExecuteQuery(
      res,
      `SELECT ed_user_account_email FROM eduall_user_accounts WHERE ed_user_account_deleted = 0 AND ed_user_account_id = ? LIMIT 1`,
      [userId],
      true,
      { db: "eduall_user_accounts", type: "select", data: req }
    );

    const email = userRows?.[0]?.ed_user_account_email;
    if (!email)
      return res.status(404).json({ msg: "Utilizador nao encontrado!" });

    await SendVerificationCode(email, userId, res, req); // CORRECAO: req passado

    if (!res.headersSent)
      return res.status(200).json({ msg: "Codigo reenviado!" });

  } catch (error) {
    console.error("[ResendVerificationCode]", error.message);
    if (!res.headersSent)
      return res.status(500).json({ msg: "Erro ao reenviar codigo!" });
  }
};

/** Verifica codigo de activacao de conta — O(1) */
const CheckUserAccountVerificationCode = async (req, res) => {
  try {
    const { ed_verification_user, ed_verification_code } = req.body;

    const rec = await resolveVerificationToken(ed_verification_user, ed_verification_code, res, req);
    if (!rec) return; // resolveVerificationToken ja respondeu

    // Activa a conta — O(1)
    await ExecuteQuery(res, SQL.USER_ACTIVATE, [ed_verification_user], false, {
      db: "eduall_user_accounts", type: "update", data: req,
    });

    // Apaga token usado — O(1)
    await ExecuteQuery(res, SQL.VERIFICATION_DELETE_BY_ID, [rec.ed_account_verification_id], false, {
      db: "eduall_accounts_verification", type: "delete", data: req,
    });

    return res.status(200).json({ msg: "success!" });

  } catch (error) {
    console.error("[CheckUserAccountVerificationCode]", error.message);
    if (!res.headersSent)
      return res.status(500).json({ msg: "Erro ao verificar codigo!" });
  }
};

/** Actualiza senha via codigo de verificacao — O(1) */
const UpdateUserPassword = async (req, res) => {
  try {
    const { ed_user_password, ed_verification_code, ed_verification_user } = req.body;

    const rec = await resolveVerificationToken(ed_verification_user, ed_verification_code, res, req);
    if (!rec) return;

    if (passwordStrength(ed_user_password).value.toLowerCase() === "weak")
      return res.status(400).json({ msg: "Senha muito fraca!" });

    const salt         = await bcrypt.genSalt(BCRYPT_ROUNDS);
    const hashPassword = await bcrypt.hash(ed_user_password, salt);

    await ExecuteQuery(res, SQL.USER_UPDATE_PASSWORD, [hashPassword, ed_verification_user], false, {
      db: "eduall_user_accounts", type: "update", data: req,
    });

    await ExecuteQuery(res, SQL.VERIFICATION_DELETE_BY_ID, [rec.ed_account_verification_id], false, {
      db: "eduall_accounts_verification", type: "delete", data: req,
    });

    return res.status(200).json({ msg: "Senha actualizada com sucesso!" });

  } catch (error) {
    console.error("[UpdateUserPassword]", error.message);
    if (!res.headersSent)
      return res.status(500).json({ msg: "Erro inesperado no servidor!" });
  }
};

/** Reset de senha (nao autenticado) — O(1) */
const UserPasswordReset = async (req, res) => {
  try {
    const { ed_user_email } = req.body;

    if (!CheckInternet())
      return res.status(300).json({ msg: "Sem ligacao ao servidor!" });

    if (!isValidEmail(ed_user_email))
      return res.status(300).json({ msg: "Email invalido!" });

    const rows = await ExecuteQuery(
      res,
      `SELECT ed_user_account_id, ed_user_account_email FROM eduall_user_accounts WHERE ed_user_account_deleted = 0 AND ed_user_account_email = ? LIMIT 1`,
      [ed_user_email],
      true,
      { db: "eduall_user_accounts", type: "select", data: req }
    );

    // Resposta generica para nao expor se o email existe — seguranca O(1)
    if (!rows?.length)
      return res.status(300).json({ msg: "Nao existe nenhuma conta associada a este email!" });

    const user = rows[0];
    const Code = generateCode(VERIFICATION_CODE_LENGTH);

    const html = EmailTemplate(
      `Recebemos um pedido para recuperar a sua conta Eduall. Clique no link abaixo para redefinir a sua senha.`,
      `${process.env.APP_CLIENT_URL}/eduall_passwordreset/${user.ed_user_account_id},${Code}`,
      `Clique Aqui`,
      `Recuperar senha`
    );

    // CORRECAO: email vai para user.ed_user_account_email, req passado correctamente
    await SendVerificationCode(
      user.ed_user_account_email,
      user.ed_user_account_id,
      res,
      req,
      html,
      "Eduall - Recuperar password",
      Code,
      false // nao apaga o utilizador se o email falhar
    );

  } catch (error) {
    console.error("[UserPasswordReset]", error.message);
    if (!res.headersSent)
      return res.status(500).json({ msg: "Erro ao estabelecer ligacao com o servidor!" });
  }
};

/** Altera senha do utilizador autenticado — O(1) */
const ChangeCurrentUserPassword = async (req, res) => {
  try {
    const { ed_user_newpassword, ed_user_oldpassword } = req.body;
    const userId = req.session.user?.eduall_user_session_ID;

    const rows = await ExecuteQuery(res, SQL.USER_BY_ID, [userId], true, {
      db: "eduall_user_accounts", type: "select", data: req,
    });

    if (!rows?.[0])
      return res.status(400).json({ msg: "Erro de sessao!" });

    if (!bcrypt.compareSync(ed_user_oldpassword, rows[0].ed_user_account_password))
      return res.status(400).json({ msg: "A sua palavra-passe esta incorrecta!" });

    if (passwordStrength(ed_user_newpassword).value.toLowerCase() === "weak")
      return res.status(300).json({ msg: "A nova palavra-passe e demasiado fraca!" });

    const salt         = await bcrypt.genSalt(BCRYPT_ROUNDS);
    const hashPassword = await bcrypt.hash(ed_user_newpassword, salt);

    await ExecuteQuery(res, SQL.USER_UPDATE_PASSWORD, [hashPassword, userId], false, {
      db: "eduall_user_accounts", type: "update", data: req,
    });

    return res.status(200).json({ msg: "success!" });

  } catch (error) {
    console.error("[ChangeCurrentUserPassword]", error.message);
    if (!res.headersSent)
      return res.status(300).json({ msg: "Erro ao estabelecer ligacao com o servidor!" });
  }
};

/** Reset de senha com utilizador autenticado — O(1) */
const ResetUserPasswordWhileLoggedin = async (req, res) => {
  try {
    const { new_password, new_password_repeat, current_password } = req.body;
    const userId = req.session.user?.eduall_user_session_ID;

    if (!new_password || !new_password_repeat || !current_password)
      return res.status(400).json({ msg: "Todos os campos sao obrigatorios!" });

    if (new_password !== new_password_repeat)
      return res.status(400).json({ msg: "A nova senha e a repeticao nao coincidem!" });

    const rows = await ExecuteQuery(
      res,
      `SELECT ed_user_account_password FROM eduall_user_accounts WHERE ed_user_account_deleted = 0 AND ed_user_account_id = ? LIMIT 1`,
      [userId],
      true,
      { db: "eduall_user_accounts", type: "select", data: req }
    );

    if (!rows?.[0])
      return res.status(404).json({ msg: "Utilizador nao encontrado!" });

    if (!await bcrypt.compare(current_password, rows[0].ed_user_account_password))
      return res.status(400).json({ msg: "A senha actual esta incorrecta!" });

    if (passwordStrength(new_password).value.toLowerCase() === "weak")
      return res.status(400).json({ msg: "A nova senha e muito fraca!" });

    const salt         = await bcrypt.genSalt(BCRYPT_ROUNDS);
    const hashPassword = await bcrypt.hash(new_password, salt);

    await ExecuteQuery(res, SQL.USER_UPDATE_PASSWORD, [hashPassword, userId], false, {
      db: "eduall_user_accounts", type: "update", data: req,
    });

    return res.status(200).json({ msg: "Senha alterada com sucesso!" });

  } catch (error) {
    console.error("[ResetUserPasswordWhileLoggedin]", error.message);
    if (!res.headersSent)
      return res.status(500).json({ msg: "Erro ao estabelecer ligacao com o servidor!" });
  }
};

/** Google OAuth — O(1) */
const GoogleAuth = async (req, res) => {
  try {
    const { name, email, picture, locale: country } = req.body?.payload || {};

    if (!email)
      return res.status(400).json({ msg: "Email nao encontrado no Google!", errorCode: "GOOGLE_NO_EMAIL" });

    let rows = await ExecuteQuery(res, SQL.USER_BY_EMAIL, [email], true, {
      db: "eduall_user_accounts", type: "select", data: req,
    });

    let user = rows?.[0];

    if (!user) {
      let savedFileName = null;

      if (picture) {
        try {
          const imgExt      = path.extname(picture.split("?")[0] || "") || ".jpg";
          savedFileName     = `google_${Date.now()}${imgExt}`;
          const imgDir      = path.join(__dirname, "..", "public", "images", "users");

          // ✅ REFATORIZADO: usar fsPromises em vez de fs.existsSync + fs.mkdirSync
          try {
            await fsPromises.stat(imgDir);
          } catch {
            await fsPromises.mkdir(imgDir, { recursive: true });
          }

          const imgResponse = await axios.get(picture, { responseType: "arraybuffer" });
          await fsPromises.writeFile(path.join(imgDir, savedFileName), imgResponse.data);
        } catch (e) {
          console.warn("[GoogleAuth] Foto nao gravada:", e.message);
          savedFileName = null;
        }
      }

      await ExecuteQuery(
        res,
        `INSERT INTO eduall_user_accounts
           (ed_user_account_name, ed_user_account_email, ed_user_account_country,
            ed_user_account_picture, ed_user_account_status, ed_user_account_auth)
         VALUES (?, ?, ?, ?, 1, 'google')`,
        [
          name || email.split("@")[0],
          email,
          country || "",
          savedFileName ? `images/users/${savedFileName}` : null,
        ],
        false,
        { db: "eduall_user_accounts", type: "insert", data: req }
      );

      rows = await ExecuteQuery(res, SQL.USER_BY_EMAIL, [email], true, {
        db: "eduall_user_accounts", type: "select", data: req,
      });
      user = rows?.[0];

      if (!user)
        return res.status(500).json({ msg: "Erro ao recuperar novo utilizador.", errorCode: "USER_CREATE_READBACK_FAIL" });

      await ExecuteQuery(
        res,
        `INSERT INTO eduall_user_account_details (ed_user_account_detUSERID, ed_user_account_detAvatarColor) VALUES (?, ?)`,
        [user.ed_user_account_id, randomAvatarColor()],
        false,
        { db: "eduall_user_account_details", type: "insert", data: req }
      ).catch((e) => console.warn("[GoogleAuth] Detalhes:", e.message));

      return createSessionAndRespond(user, req, res, "Utilizador registado e autenticado com sucesso!");
    }

    if (user.ed_user_account_auth !== "google")
      return res.status(403).json({ msg: "Use email e senha para esta conta!", errorCode: "GOOGLE_AUTH_MISMATCH" });

    return createSessionAndRespond(user, req, res, "Login realizado com sucesso!");

  } catch (err) {
    console.error("[GoogleAuth]", err.message);
    return res.status(500).json({ msg: "Erro no servidor.", errorCode: "SERVER_ERROR" });
  }
};

// ─── CRUD utilizadores ────────────────────────────────────────

const getUsers = async (req, res) => {
  try {
    const rows = await ExecuteQuery(
      res,
      `SELECT * FROM eduall_user_accounts WHERE ed_user_account_deleted = 0`,
      [],
      true,
      { db: "eduall_user_accounts", type: "select", data: req }
    );
    return res.status(200).json({ users: rows });
  } catch (e) {
    console.error("[getUsers]", e.message);
    return res.status(500).json({ msg: "Erro ao buscar utilizadores!" });
  }
};

const SearchUsers = async (req, res) => {
  try {
    const term = `%${req.params.TEXT.toLowerCase()}%`;
    const rows = await ExecuteQuery(
      res,
      `SELECT * FROM eduall_user_accounts
       WHERE ed_user_account_deleted = 0
         AND (LOWER(ed_user_account_name) LIKE ? OR LOWER(ed_user_account_charge) LIKE ? OR LOWER(ed_user_account_email) LIKE ?)`,
      [term, term, term],
      true,
      { db: "eduall_user_accounts", type: "select", data: req }
    );
    return res.status(200).json({ users: rows });
  } catch (e) {
    console.error("[SearchUsers]", e.message);
    return res.status(500).json({ msg: "Erro ao pesquisar utilizadores!" });
  }
};

const getSingleUserData = async (req, res) => {
  try {
    const rows = await ExecuteQuery(res, SQL.USER_BY_ID, [req.params.ID], true, {
      db: "eduall_user_accounts", type: "select", data: req,
    });
    if (!rows?.[0]) return res.sendStatus(404);
    return res.status(200).json(rows[0]);
  } catch (e) {
    console.error("[getSingleUserData]", e.message);
    return res.status(500).json({ msg: "Erro ao buscar utilizador!" });
  }
};

const getCurrentUserInformation = async (req, res) => {
  try {
    const userId = req.session.user?.eduall_user_session_ID;
    if (!userId) return res.status(401).json({ msg: "Nao autenticado!" });

    const rows = await ExecuteQuery(
      res,
      `SELECT * FROM eduall_user_accounts WHERE ed_user_account_id = ? LIMIT 1`,
      [userId],
      true,
      { db: "eduall_user_accounts", type: "select", data: req }
    );
    return res.status(200).json(rows?.[0] || {});
  } catch (e) {
    console.error("[getCurrentUserInformation]", e.message);
    return res.status(500).json({ msg: "Erro ao buscar informacoes!" });
  }
};

const getSingleUserImageData = async (req, res) => {
  const { EMAIL } = req.params;
  try {
    if (isValidEmail(EMAIL)) {
      const rows = await ExecuteQuery(
        res,
        `SELECT ed_user_account_picture FROM eduall_user_accounts WHERE ed_user_account_deleted = 0 AND ed_user_account_email = ? LIMIT 1`,
        [EMAIL],
        true,
        { db: "eduall_user_accounts", type: "select", data: req }
      );
      return res.status(200).json(rows?.[0] || null);
    }

    // Busca por system account name — O(1) com idx
    const rows = await ExecuteQuery(
      res,
      `SELECT ua.ed_user_account_email
       FROM eduall_employees e
       LEFT JOIN eduall_user_accounts ua ON e.ed_employee_email = ua.ed_user_account_email
       LEFT JOIN eduall_system_accounts sa ON sa.ed_system_account_employee = e.ed_employee_id
       WHERE ua.ed_user_account_deleted = 0 AND e.ed_employee_deleted = 0 AND sa.ed_system_account_name = ?
       LIMIT 1`,
      [EMAIL.toLowerCase()],
      true,
      { db: "eduall_user_accounts", type: "select", data: req }
    );

    if (!rows?.[0]) return res.status(404).json(null);

    const picRows = await ExecuteQuery(
      res,
      `SELECT ed_user_account_picture FROM eduall_user_accounts WHERE ed_user_account_deleted = 0 AND ed_user_account_email = ? LIMIT 1`,
      [rows[0].ed_user_account_email],
      true,
      { db: "eduall_user_accounts", type: "select", data: req }
    );
    return res.status(200).json(picRows?.[0] || null);

  } catch (e) {
    console.error("[getSingleUserImageData]", e.message);
    return res.status(500).json({ msg: "Erro ao buscar imagem!" });
  }
};

const CheckExistentEmail = async (req, res) => {
  try {
    const rows = await ExecuteQuery(
      res,
      `SELECT ed_user_account_id FROM eduall_user_accounts WHERE ed_user_account_deleted = 0 AND ed_user_account_email = ? LIMIT 1`,
      [req.params.EMAIL],
      true,
      { db: "eduall_user_accounts", type: "select", data: req }
    );
    return res.status(200).json(rows);
  } catch (e) {
    return res.status(500).json({ msg: "Erro ao verificar email!" });
  }
};

const UserAccountDelete = async (req, res) => {
  try {
    await ExecuteQuery(
      res,
      `UPDATE eduall_user_accounts SET ed_user_account_deleted = 1 WHERE ed_user_account_deleted = 0 AND ed_user_account_id = ?`,
      [req.params.ID],
      false,
      { db: "eduall_user_accounts", type: "update", data: req }
    );
    return res.status(200).json({ msg: "Utilizador eliminado com sucesso!" });
  } catch (e) {
    console.error("[UserAccountDelete]", e.message);
    return res.status(500).json({ msg: "Erro ao eliminar utilizador!" });
  }
};

const UPDATEProfilePicture = async (req, res) => {
  try {
    const userId = req.session.user?.eduall_user_session_ID;
    if (!userId) return res.status(401).json({ msg: "Nao autenticado!" });

    const picturePath = req.file ? "images/users/" + req.file.filename : "";
    await ExecuteQuery(
      res,
      `UPDATE eduall_user_accounts SET ed_user_account_picture = ? WHERE ed_user_account_deleted = 0 AND ed_user_account_id = ?`,
      [picturePath, userId],
      false,
      { db: "eduall_user_accounts", type: "update", data: req }
    );
    return res.status(200).json({ msg: "Foto de perfil actualizada!" });
  } catch (e) {
    console.error("[UPDATEProfilePicture]", e.message);
    return res.status(500).json({ msg: "Erro ao actualizar foto!" });
  }
};

const UPDATEProfileCoverImage = async (req, res) => {
  try {
    const userId = req.session.user?.eduall_user_session_ID;
    if (!userId) return res.status(401).json({ msg: "Nao autenticado!" });

    const coverPath = req.file ? "images/users/covers/" + req.file.filename : "";
    await ExecuteQuery(
      res,
      `UPDATE eduall_user_account_details SET ed_user_account_detProfileCover = ? WHERE ed_user_account_detUSERID = ?`,
      [coverPath, userId],
      false,
      { db: "eduall_user_account_details", type: "update", data: req }
    );
    return res.status(200).json({ msg: "Imagem de capa actualizada!" });
  } catch (e) {
    console.error("[UPDATEProfileCoverImage]", e.message);
    return res.status(500).json({ msg: "Erro ao actualizar capa!" });
  }
};

const UpdateUserAccount = async (req, res) => {
  try {
    const { ID } = req.params;
    const { user_account_name, user_account_phone, user_account_email, user_account_charge } = req.body;

    await ExecuteQuery(
      res,
      `UPDATE eduall_user_accounts SET ed_user_account_name = ?, ed_user_account_email = ?, ed_userphone = ?, ed_user_account_charge = ?
       WHERE ed_user_account_deleted = 0 AND ed_user_account_id = ?`,
      [user_account_name, user_account_email, user_account_phone, user_account_charge, ID],
      false,
      { db: "eduall_user_accounts", type: "update", data: req }
    );
    return res.status(200).json({ success: true, message: "Conta actualizada!" });
  } catch (e) {
    console.error("[UpdateUserAccount]", e.message);
    return res.status(500).json({ success: false, message: "Falha ao actualizar conta.", error: e.message });
  }
};

const UpdateUserAccountWhileLoggedin = async (req, res) => {
  try {
    const { user_name, user_email, user_country, user_gender, user_phone } = req.body;
    const userId = req.session.user?.eduall_user_session_ID;

    if (!isValidEmail(user_email))
      return res.status(300).json({ msg: "Email invalido!" });

    if ((user_name || "").length < 7)
      return res.status(300).json({ msg: "Nome invalido!" });

    if ((user_country || "").length < 1)
      return res.status(300).json({ msg: "Pais invalido!" });

    // Verifica se email esta a ser usado por outro utilizador — O(1)
    const emailCheck = await ExecuteQuery(
      res,
      `SELECT ed_user_account_id FROM eduall_user_accounts WHERE ed_user_account_email = ? AND ed_user_account_id != ? AND ed_user_account_deleted = 0 LIMIT 1`,
      [user_email, userId],
      true,
      { db: "eduall_user_accounts", type: "select", data: req }
    );

    if (emailCheck?.length)
      return res.status(300).json({ msg: "Este email ja esta a ser utilizado!" });

    const params   = [user_name, user_email, user_country, user_gender, user_phone];
    let updateSQL  = `UPDATE eduall_user_accounts SET
                        ed_user_account_name = ?, ed_user_account_email = ?,
                        ed_user_account_country = ?, ed_user_account_gender = ?, ed_userphone = ?`;

    if (req.file) {
      updateSQL += `, ed_user_account_picture = ?`;
      params.push(req.file.path);
    }

    updateSQL += ` WHERE ed_user_account_id = ? AND ed_user_account_deleted = 0`;
    params.push(userId);

    await ExecuteQuery(res, updateSQL, params, false, {
      db: "eduall_user_accounts", type: "update", data: req,
    });

    await ExecuteQuery(
      res,
      `UPDATE eduall_user_account_details SET ed_user_account_detAvatarColor = ? WHERE ed_user_account_detUSERID = ?`,
      [randomAvatarColor(), userId],
      false,
      { db: "eduall_user_accounts", type: "update", data: req }
    );

    req.session.user.eduall_user_session_email = user_email;
    return res.status(200).json({ msg: "Utilizador actualizado com sucesso!" });

  } catch (error) {
    console.error("[UpdateUserAccountWhileLoggedin]", error.message);
    if (!res.headersSent)
      return res.status(500).json({ msg: "Erro ao actualizar dados!" });
  }
};
 

 const INTERNAL_APPS = {
  library:  { id: "library",  label: "Biblioteca",       route: "/libraryapp/dashboard" },
  hr:       { id: "hr",       label: "Recursos Humanos", route: "/hr/home"              },
  security: { id: "security", label: "Segurança / CCTV", route: "/monitoring_dashboard" },
};
 
// ─── Helper: determina para onde redirecionar após login ─────────────────────
// Recebe os acessos de dashboard e as apps atribuídas.
// Devolve a rota de destino como string.
const resolveRedirectTo = (accessRow, appTypes) => {
  const hasDashboard = accessRow && [
    "ed_user_access_myinstitute",
    "ed_user_access_secretary",
    "ed_user_access_administration",
    "ed_user_access_finances",
    "ed_user_access_pedagogicalarea",
    "ed_user_access_transportation",
    "ed_user_access_library",
    "ed_user_access_configuration",
    "ed_user_access_portal",
    "ed_user_access_system",
  ].some(k => accessRow[k] === 1);
 
  // Tem dashboard → vai para o dashboard
  if (hasDashboard) return "/Dashboard";
 
  // Não tem dashboard mas tem apps → vai para a primeira app
  if (Array.isArray(appTypes) && appTypes.length > 0) {
    for (const appType of appTypes) {
      if (INTERNAL_APPS[appType]?.route) return INTERNAL_APPS[appType].route;
    }
  }
 
  // Sem dashboard nem apps → null (frontend trata com mensagem de erro)
  return null;
};
 
// ─── Controller melhorado ─────────────────────────────────────────────────────
/**
 * GET /eduallgetuseraccess/get/:ID
 *
 * Parâmetro :ID = ed_system_account_name (username) do utilizador logado,
 * conforme vem do JWT (cr_username_id).
 *
 * Devolve:
 *   data[0]  — acessos de dashboard (eduall_user_access)
 *   apps     — apps atribuídas ao funcionário nesta instituição
 *   redirectTo — rota para onde o frontend deve redirecionar
 */
const GetUserAccounAccess = async (req, res) => {
  try {
    // cr_username_id no JWT = ed_system_account_id (número inteiro)
    const accountId     = req.params.ID;
    const instituteCode = req.session?.user?.eduall_user_session_curentinstitute;
 
    // ── 1. Buscar a conta de dashboard pelo ed_system_account_id ─────────────
    const accountRows = await ExecuteQuery(
      res,
      `SELECT
         sa.ed_system_account_id,
         sa.ed_system_account_employee,
         sa.ed_system_account_userid
       FROM eduall_system_accounts sa
       WHERE sa.ed_system_account_id             = ?
         AND sa.ed_system_account_institute_code = ?
         AND sa.ed_system_account_app_type IS NULL
         AND sa.ed_system_account_deleted        = 0
       LIMIT 1`,
      [accountId, instituteCode],
      true,
      { db: "eduall_system_accounts", type: "select", data: req }
    );
 
    const account    = accountRows?.[0];
    const accId      = account?.ed_system_account_id  ?? accountId; // fallback ao ID passado
    const employeeId = account?.ed_system_account_employee ?? null;
 
    // ── 2. Buscar acessos de dashboard directamente pelo accountId ────────────
    let accessRow = null;
    if (accId) {
      const accessRows = await ExecuteQuery(
        res,
        `SELECT * FROM eduall_user_access WHERE ed_user_access_usercode = ?`,
        [accId],
        true,
        { db: "eduall_user_access", type: "select", data: req }
      );
      accessRow = accessRows?.[0] ?? null;
    }
 
    // ── 3. Buscar apps atribuídas ao funcionário nesta instituição ────────────
    let apps = [];
    if (employeeId && instituteCode) {
      const appRows = await ExecuteQuery(
        res,
        `SELECT
           ed_system_account_id    AS accountId,
           ed_system_account_name  AS username,
           ed_system_account_app_type AS appType
         FROM eduall_system_accounts
         WHERE ed_system_account_employee        = ?
           AND ed_system_account_institute_code  = ?
           AND ed_system_account_app_type IS NOT NULL
           AND ed_system_account_deleted          = 0`,
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
 
    // ── 4. Calcular redirectTo ────────────────────────────────────────────────
    const appTypes   = apps.map(a => a.appType);
    const redirectTo = resolveRedirectTo(accessRow, appTypes);
 
    return res.status(200).json({
      success: true,
      data:       accessRow ? [accessRow] : [],   // mantém compatibilidade com o frontend
      apps,                                        // apps atribuídas
      redirectTo,                                  // rota de destino
    });
 
  } catch (e) {
    console.error("[GetUserAccounAccess]", e.message);
    return res.status(500).json({
      success: false,
      message: "Falha ao buscar acessos.",
      error:   e.message,
    });
  }
};
 

const sendEduallAccountEmail = async (email, name, password, instituteCode) => {
  try {
    const rows = await ExecuteQuery(
      null,
      `SELECT * FROM eduall_institutes
       LEFT JOIN eduall_institutes_licences
         ON eduall_institutes_licences.ed_institute_licence_instituteCode = eduall_institutes.ed_institute_code
       WHERE ed_institute_deleted = 0 AND ed_institute_code = ? LIMIT 1`,
      [instituteCode],
      true,
      { db: "eduall_institutes", type: "select", data: null }
    );

    if (!rows?.length) return { success: false, msg: "Instituicao nao encontrada!" };

    const subject = "A sua conta Eduall foi criada por uma instituicao";
    const html    = EmailTemplate(
      `Ola ${name}, uma conta Eduall foi criada em seu nome.\nEmail: ${email}\nSenha: ${password}\nRecomendamos alterar a senha no primeiro acesso.`,
      `${process.env.APP_CLIENT_URL}/`,
      `Aceder a Conta`,
      subject
    );

    await sendMail({ to: email, subject, html }); // email correcto passado aqui
    return { success: true };
  } catch (e) {
    console.error("[sendEduallAccountEmail]", e.message);
    return { success: false, msg: e.message };
  }
};

// ─── Template de email ────────────────────────────────────────
function EmailTemplate(message, link, link_text, title) {
  return `<!DOCTYPE html>
<html xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
  <meta charset="UTF-8"/>
  <meta http-equiv="Content-Type" content="text/html; charset=utf-8"/>
  <!--[if !mso]><!-->
  <meta http-equiv="X-UA-Compatible" content="IE=edge"/>
  <!--<![endif]-->
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <meta name="format-detection" content="telephone=no, date=no, address=no, email=no"/>
  <meta name="x-apple-disable-message-reformatting"/>
  <link href="https://fonts.googleapis.com/css?family=Dela+Gothic+One:ital,wght@0,400" rel="stylesheet"/>
  <link href="https://fonts.googleapis.com/css?family=Instrument+Sans:ital,wght@0,400;0,600" rel="stylesheet"/>
  <title>Eduall - ${title}</title>
  <style>html,body{margin:0!important;padding:0!important;min-height:100%!important;width:100%!important;-webkit-font-smoothing:antialiased}*{-ms-text-size-adjust:100%}#outlook a{padding:0}.ReadMsgBody,.ExternalClass{width:100%}.ExternalClass,.ExternalClass p,.ExternalClass td,.ExternalClass div,.ExternalClass span,.ExternalClass font{line-height:100%}table,td,th{mso-table-lspace:0!important;mso-table-rspace:0!important;border-collapse:collapse}body,td,th,p,div,li,a,span{-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%;mso-line-height-rule:exactly}img{border:0;outline:0;line-height:100%;text-decoration:none;-ms-interpolation-mode:bicubic}a[x-apple-data-detectors]{color:inherit!important;text-decoration:none!important}.body .pc-project-body{background-color:transparent!important}@media (min-width:621px){.pc-lg-hide{display:none}.pc-lg-bg-img-hide{background-image:none!important}}</style>
  <style>@media (max-width:620px){.pc-project-body{min-width:0px!important}.pc-project-container,.pc-component{width:100%!important}.pc-sm-hide{display:none!important}.pc-w620-padding-0-0-0-0{padding:0!important}.pc-w620-width-132{width:132px!important}.pc-w620-height-22{height:22px!important}.pc-w620-padding-30-30-0-30{padding:30px 30px 0 30px!important}.pc-w620-font-size-28px{font-size:28px!important}.pc-w620-line-height-32px{line-height:32px!important}.pc-w620-font-size-16px{font-size:16px!important}.pc-w620-line-height-24px{line-height:24px!important}.pc-w620-padding-13-20-13-20{padding:13px 20px!important}.pc-w620-width-100pc{width:100%!important}.pc-w620-padding-20-20-20-20{padding:20px!important}.pc-w620-align-center{text-align:center!important}.pc-w620-padding-32-20-20-20{padding:32px 20px 20px!important}}</style>
  <!--[if !mso]><!-->
  <style>@font-face{font-family:'Dela Gothic One';font-style:normal;font-weight:400;src:url('https://fonts.gstatic.com/s/delagothicone/v17/hESp6XxvMDRA-2eD0lXpDa6QkBA2TEEO.woff') format('woff'),url('https://fonts.gstatic.com/s/delagothicone/v17/hESp6XxvMDRA-2eD0lXpDa6QkBA2TEEI.woff2') format('woff2')}@font-face{font-family:'Instrument Sans';font-style:normal;font-weight:600;src:url('https://fonts.gstatic.com/s/instrumentsans/v1/pximypc9vsFDm051Uf6KVwgkfoSxQ0GsQv8ToedPibnr-yp2JGEJOH9npSQb_jf8kyo.woff') format('woff'),url('https://fonts.gstatic.com/s/instrumentsans/v1/pximypc9vsFDm051Uf6KVwgkfoSxQ0GsQv8ToedPibnr-yp2JGEJOH9npSQb_jf8kyw.woff2') format('woff2')}@font-face{font-family:'Instrument Sans';font-style:normal;font-weight:400;src:url('https://fonts.gstatic.com/s/instrumentsans/v1/pximypc9vsFDm051Uf6KVwgkfoSxQ0GsQv8ToedPibnr-yp2JGEJOH9npSTF-Tf8kyo.woff') format('woff'),url('https://fonts.gstatic.com/s/instrumentsans/v1/pximypc9vsFDm051Uf6KVwgkfoSxQ0GsQv8ToedPibnr-yp2JGEJOH9npSTF-Tf8kyw.woff2') format('woff2')}</style>
  <!--<![endif]-->
</head>
<body class="body pc-font-alt" style="width:100%!important;min-height:100%!important;margin:0!important;padding:0!important;font-weight:normal;color:#2D3A41;mso-line-height-rule:exactly;-webkit-font-smoothing:antialiased;background-color:#3C096C;" bgcolor="#3C096C">
  <table style="table-layout:fixed;width:100%;min-width:600px;background-color:#3C096C;" bgcolor="#3C096C" border="0" cellspacing="0" cellpadding="0" role="presentation">
    <tr>
      <td align="center" valign="top">
        <table align="center" border="0" cellpadding="0" cellspacing="0" role="presentation">
          <tr>
            <td style="padding:20px 0;" align="left" valign="top">
              <table border="0" cellpadding="0" cellspacing="0" role="presentation" width="100%">
                <tr>
                  <td valign="top">
                    <table width="100%" border="0" cellspacing="0" cellpadding="0" role="presentation" align="center" style="width:600px;max-width:600px;">
                      <tr>
                        <td width="100%" border="0" cellspacing="0" cellpadding="0" role="presentation">
                          <table align="center" width="100%" border="0" cellspacing="0" cellpadding="0" role="presentation">
                            <tr>
                              <td valign="top" style="background-image:url('https://cloudfilesdm.com/postcards/WhatsApp_Image_2025-09-22_at_18.14.39-057aedef.jpeg');background-size:cover;background-position:top center;background-repeat:no-repeat;padding:30px 30px 0;background-color:#1b0f4d;" bgcolor="#1b0f4d">
                                <table width="100%" border="0" cellpadding="0" cellspacing="0" role="presentation">
                                  <tr><td valign="top" style="padding:0 0 520px;height:auto;opacity:0;z-index:-100;"><img src="https://cloudfilesdm.com/postcards/image-17459687316650-fbae99d6.png" height="1" alt="" style="display:block;width:0;height:1px;border:0;"/></td></tr>
                                </table>
                              </td>
                            </tr>
                          </table>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
                <tr>
                  <td valign="top">
                    <table width="100%" border="0" cellspacing="0" cellpadding="0" role="presentation" align="center" style="width:600px;max-width:600px;">
                      <tr>
                        <td width="100%" border="0" cellspacing="0" cellpadding="0" role="presentation">
                          <table align="center" width="100%" border="0" cellspacing="0" cellpadding="0" role="presentation">
                            <tr>
                              <td valign="top" style="padding:54px 40px;background-color:#ffffff;" bgcolor="#ffffff">
                                <table border="0" cellpadding="0" cellspacing="0" role="presentation">
                                  <tr>
                                    <td valign="top">
                                      <table width="100%" border="0" cellpadding="0" cellspacing="0" role="presentation">
                                        <tr><td align="center" valign="top" style="padding:0 0 30px;"><img src="https://cloudfilesdm.com/postcards/c046ae1d922dce9ba1b3411f1199c01e.png" width="43" height="36" alt="" style="display:block;outline:0;line-height:100%;object-fit:contain;width:43px;height:auto;max-width:100%;border:0;"/></td></tr>
                                        <tr>
                                          <td align="left" valign="top" style="padding:0 0 16px;">
                                            <div style="font-size:48px;line-height:58px;text-align:center;color:#253e47;font-family:'Dela Gothic One',Arial,Helvetica,sans-serif;font-style:normal;letter-spacing:0;">${title}</div>
                                          </td>
                                        </tr>
                                        <tr>
                                          <td align="left" valign="top" style="padding:0 0 32px;">
                                            <div style="font-size:20px;line-height:30px;text-align:center;color:#253e47;font-family:'Instrument Sans',Arial,Helvetica,sans-serif;">${message}</div>
                                          </td>
                                        </tr>
                                        <tr>
                                          <td>
                                            <table width="100%" border="0" cellpadding="0" cellspacing="0" role="presentation">
                                              <tr>
                                                <th valign="top" align="center" style="padding:0 0 54px;text-align:center;font-weight:normal;">
                                                  <a style="display:inline-block;box-sizing:border-box;border-radius:100px;background-color:#6051ff;padding:16px 40px;text-align:center;text-decoration:none;" href="${link}" target="_blank">
                                                    <span style="font-size:18px;line-height:24px;color:#ffffff;font-family:'Instrument Sans',Arial,Helvetica,sans-serif;font-weight:600;letter-spacing:-0.01em;">${link_text}</span>
                                                  </a>
                                                </th>
                                              </tr>
                                            </table>
                                          </td>
                                        </tr>
                                      </table>
                                    </td>
                                  </tr>
                                </table>
                              </td>
                            </tr>
                          </table>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
                <tr>
                  <td valign="top">
                    <table width="100%" border="0" cellspacing="0" cellpadding="0" role="presentation" align="center" style="width:600px;max-width:600px;">
                      <tr>
                        <td width="100%" border="0" cellspacing="0" cellpadding="0" role="presentation">
                          <table align="center" width="100%" border="0" cellspacing="0" cellpadding="0" role="presentation">
                            <tr>
                              <td valign="top" style="padding:54px 40px 40px;background-color:#000000;" bgcolor="#000000">
                                <table width="100%" border="0" cellpadding="0" cellspacing="0" role="presentation">
                                  <tr><td align="center" valign="top" style="padding:0 0 40px;"><img src="https://cloudfilesdm.com/postcards/d1551c59e67bb4950b5221f8e78cf36e.png" width="142" height="36" alt="" style="display:block;outline:0;line-height:100%;object-fit:contain;width:142px;height:auto;max-width:100%;border:0;"/></td></tr>
                                </table>
                                <table width="100%" border="0" cellpadding="0" cellspacing="0" role="presentation">
                                  <tr>
                                    <td align="center" valign="top" style="padding:0 0 40px;">
                                      <div style="font-size:18px;line-height:28px;text-align:center;color:#ffffff;font-family:'Instrument Sans',Arial,Helvetica,sans-serif;">Eduall e a plataforma que integra gestao pedagogica, administrativa e financeira, trazendo eficiencia e inovacao para escolas e universidades.</div>
                                    </td>
                                  </tr>
                                </table>
                                <table width="100%" border="0" cellpadding="0" cellspacing="0" role="presentation">
                                  <tr><td valign="top" style="padding:0 0 40px;"><table width="100%" border="0" cellpadding="0" cellspacing="0" role="presentation"><tr><td valign="top" style="line-height:1px;font-size:1px;border-bottom:1px solid #253e4729;">&nbsp;</td></tr></table></td></tr>
                                </table>
                              </td>
                            </tr>
                          </table>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

// ─── Multer — upload de imagens ───────────────────────────────
const mkFilename = (prefix) => (req, file, cb) =>
  cb(null, `eduall_${prefix}_${Date.now()}_${Math.random().toString(36).slice(2)}${path.extname(file.originalname)}`);

const uploadUserAccountPicture = multer({
  storage: multer.diskStorage({
    destination: "images/users",
    filename: mkFilename("avatar"),
  }),
}).single("user_account_picture");

const uploadUserAccountBackgroundPicture = multer({
  storage: multer.diskStorage({
    destination: "images/users/covers",
    filename: mkFilename("cover"),
  }),
}).single("user_account_profile_cover");

// ─── Exports ──────────────────────────────────────────────────
module.exports = {
  // Auth
  Login,
  GoogleAuth,
  RegisterUserAccount,
  ResendVerificationCode,
  CheckUserAccountVerificationCode,
  UpdateUserPassword,
  UserPasswordReset,
  ChangeCurrentUserPassword,
  ResetUserPasswordWhileLoggedin,
  // CRUD
  getUsers,
  SearchUsers,
  getSingleUserData,
  getCurrentUserInformation,
  getSingleUserImageData,
  CheckExistentEmail,
  UserAccountDelete,
  UpdateUserAccount,
  UpdateUserAccountWhileLoggedin,
  GetUserAccounAccess,
  UPDATEProfilePicture,
  UPDATEProfileCoverImage,
  // Uploads
  uploadUserAccountPicture,
  uploadUserAccountBackgroundPicture,

  resolveRedirectTo, 
  INTERNAL_APPS
};