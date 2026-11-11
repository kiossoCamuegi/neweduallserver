"use strict";

const { DATABASE } = require("../config/Database");
const { normalizeText } = require("./textRules");

let cache = { at: 0, byInstitute: new Map() };
const CACHE_TTL_MS = Math.max(5_000, Number(process.env.MODERATION_TERMS_CACHE_MS) || 60_000);

async function termsForInstitute(instituteCode) {
  const cached = cache.byInstitute.get(instituteCode);
  if (cached && Date.now() - cache.at < CACHE_TTL_MS) return cached;
  const [rows] = await DATABASE.query(
    `SELECT ed_moderation_term_value AS value,
            ed_moderation_term_severity AS severity
       FROM moderation_terms
      WHERE BINARY ed_moderation_term_institute_code = BINARY ?
        AND ed_moderation_term_active = 1
      ORDER BY ed_moderation_term_severity DESC, ed_moderation_term_value ASC`,
    [instituteCode]
  );
  cache = { at: Date.now(), byInstitute: new Map([[instituteCode, rows]]) };
  return rows;
}

async function saveTerm(ctx, input) {
  const value = String(input?.value || "").trim().slice(0, 255);
  const normalized = normalizeText(value);
  if (!value || !normalized) {
    const error = new Error("O termo não pode estar vazio.");
    error.status = 422;
    error.code = "MODERATION_TERM_REQUIRED";
    throw error;
  }
  const severity = ["low", "medium", "high", "block"].includes(input?.severity)
    ? input.severity
    : "high";
  const locale = String(input?.locale || "pt").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 16) || "pt";
  await DATABASE.query(
    `INSERT INTO moderation_terms (
       ed_moderation_term_institute_code, ed_moderation_term_locale,
       ed_moderation_term_value, ed_moderation_term_normalized,
       ed_moderation_term_severity, ed_moderation_term_active,
       ed_moderation_term_created_by
     ) VALUES (?, ?, ?, ?, ?, 1, ?)
     ON DUPLICATE KEY UPDATE
       ed_moderation_term_value = VALUES(ed_moderation_term_value),
       ed_moderation_term_severity = VALUES(ed_moderation_term_severity),
       ed_moderation_term_active = 1`,
    [ctx.instituteCode, locale, value, normalized, severity, ctx.userId]
  );
  cache.byInstitute.delete(ctx.instituteCode);
}

async function listTerms(ctx) {
  const [rows] = await DATABASE.query(
    `SELECT ed_moderation_term_id AS id,
            ed_moderation_term_locale AS locale,
            ed_moderation_term_value AS value,
            ed_moderation_term_severity AS severity,
            ed_moderation_term_active AS active,
            ed_moderation_term_updated_at AS updatedAt
       FROM moderation_terms
      WHERE BINARY ed_moderation_term_institute_code = BINARY ?
      ORDER BY ed_moderation_term_active DESC, ed_moderation_term_value ASC`,
    [ctx.instituteCode]
  );
  return { items: rows };
}

module.exports = { listTerms, saveTerm, termsForInstitute };
