"use strict";

const jwt = require("jsonwebtoken");
const { DATABASE } = require("../config/Database");

const REFRESH_TTL = process.env.REFRESH_TOKEN_TTL || "7d";
const REFRESH_COOKIE_MAX_AGE = 7 * 24 * 60 * 60 * 1000;
const REFRESH_COOKIE_NAME = "refreshToken";

function refreshPayload(decoded) {
  return {
    cr_usercode: decoded.cr_usercode,
    cr_code: decoded.cr_code,
    cr_username: decoded.cr_username,
    cr_useremail: decoded.cr_useremail,
    ...(decoded.cr_institutecode
      ? { cr_institutecode: decoded.cr_institutecode }
      : {}),
  };
}

function refreshCookieOptions() {
  const isProd = process.env.NODE_ENV === "production";
  return {
    httpOnly: true,
    secure: isProd,
    sameSite: isProd ? "none" : "lax",
    maxAge: REFRESH_COOKIE_MAX_AGE,
    path: "/",
  };
}

/**
 * Mantém a sessão autenticada durante o período da sessão HTTP.
 * O refresh token é rodado apenas quando expirou ou está dentro da margem.
 */
async function ensureSessionRefreshToken(req, res, options = {}) {
  const currentToken = req.session?.user?.eduall_user_session_refreshToken;
  if (!currentToken) {
    const error = new Error("No token provided!");
    error.status = 401;
    error.code = "REFRESH_TOKEN_MISSING";
    throw error;
  }

  let decoded;
  let expired = false;
  try {
    decoded = jwt.verify(currentToken, process.env.REFRESH_TOKEN_SECRET);
  } catch (error) {
    if (!(error instanceof jwt.TokenExpiredError)) throw error;
    expired = true;
    try {
      decoded = jwt.verify(
        currentToken,
        process.env.REFRESH_TOKEN_SECRET,
        { ignoreExpiration: true }
      );
    } catch {
      throw error;
    }
  }

  const remainingSeconds = Number(decoded.exp || 0) - Math.floor(Date.now() / 1000);
  const rotateWithinSeconds = Math.max(0, Number(options.rotateWithinSeconds) || 0);
  if (!expired && remainingSeconds > rotateWithinSeconds) {
    return { token: currentToken, decoded, rotated: false };
  }

  const sessionUserId = Number(req.session?.user?.eduall_user_session_ID);
  const tokenUserId = Number(decoded.cr_usercode);
  if (!sessionUserId || !tokenUserId || sessionUserId !== tokenUserId) {
    const error = new Error("A sessão não corresponde ao token apresentado.");
    error.status = 401;
    error.code = "REFRESH_SESSION_MISMATCH";
    throw error;
  }

  const [accounts] = await DATABASE.query(
    `SELECT ed_user_account_id AS id
       FROM eduall_user_accounts
      WHERE ed_user_account_id = ?
        AND ed_user_account_deleted = 0
      LIMIT 1`,
    [sessionUserId]
  );
  if (!accounts.length) {
    const error = new Error("A conta da sessão já não está ativa.");
    error.status = 401;
    error.code = "REFRESH_ACCOUNT_INACTIVE";
    throw error;
  }

  const token = jwt.sign(
    refreshPayload(decoded),
    process.env.REFRESH_TOKEN_SECRET,
    { expiresIn: REFRESH_TTL }
  );
  await DATABASE.query(
    `UPDATE eduall_user_accounts
        SET ed_usertoken = ?
      WHERE ed_user_account_id = ?
        AND ed_user_account_deleted = 0`,
    [token, sessionUserId]
  );

  req.session.user.eduall_user_session_refreshToken = token;
  if (res?.cookie) {
    res.cookie(REFRESH_COOKIE_NAME, token, refreshCookieOptions());
  }
  return {
    token,
    decoded: jwt.verify(token, process.env.REFRESH_TOKEN_SECRET),
    rotated: true,
  };
}

module.exports = {
  REFRESH_TTL,
  ensureSessionRefreshToken,
  refreshCookieOptions,
};
