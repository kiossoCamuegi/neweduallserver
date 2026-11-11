"use strict";

const DEFAULT_TERMS = Object.freeze([
  "idiota",
  "imbecil",
  "burro",
  "estupido",
  "otario",
  "vai morrer",
  "matar te",
]);

function normalizeText(value) {
  return String(value || "")
    .normalize("NFKC")
    .replace(/\u200B|\u200C|\u200D|\uFEFF/gu, "")
    .replace(/[\u0400-\u04FF]/g, (character) => {
      const confusables = {
        а: "a", в: "b", е: "e", к: "k", м: "m", н: "h", о: "o",
        р: "p", с: "c", т: "t", у: "y", х: "x",
        А: "a", В: "b", Е: "e", К: "k", М: "m", Н: "h", О: "o",
        Р: "p", С: "c", Т: "t", У: "y", Х: "x",
      };
      return confusables[character] || character;
    })
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    // Runs like "!!!" or "|||" are emphasis, not repeated leet substitutions.
    .replace(/([!|])\1+/g, " ")
    .replace(/[@]/g, "a")
    .replace(/[0]/g, "o")
    .replace(/[1!|]/g, "i")
    .replace(/[3]/g, "e")
    .replace(/[4]/g, "a")
    .replace(/[5$]/g, "s")
    .replace(/[7]/g, "t")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\b(?:[\p{L}\p{N}]\s+){2,}[\p{L}\p{N}]\b/gu, (match) =>
      match.replace(/\s+/g, "")
    )
    .replace(/([\p{L}\p{N}])\1+/gu, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

function termPattern(term) {
  const escaped = normalizeText(term)
    .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    .replace(/\s+/g, "\\s+");
  return escaped ? new RegExp(`(?:^|\\s)${escaped}(?:$|\\s)`, "iu") : null;
}

function analyzeTextRules(text, terms = []) {
  const normalized = normalizeText(text);
  const compactNormalized = normalized.replace(/\s+/g, "");
  const configured = terms.length ? terms : DEFAULT_TERMS;
  const matches = [];
  let blocked = false;
  for (const entry of configured) {
    const value = typeof entry === "string" ? entry : entry.value;
    const severity = typeof entry === "string" ? "high" : entry.severity || "high";
    const pattern = termPattern(value);
    const compactTerm = normalizeText(value).replace(/\s+/g, "");
    const spacedPhraseMatch = /\s/.test(String(value))
      && compactTerm.length >= 4
      && compactNormalized.includes(compactTerm);
    if (!pattern || (!pattern.test(normalized) && !spacedPhraseMatch)) continue;
    matches.push({ term: value, severity });
    if (severity === "high" || severity === "block") blocked = true;
  }
  return {
    analyzer: "pt_rules",
    model: "editable_pt_terms",
    version: "1",
    scores: {
      rule_matches: matches.length,
      rule_severity: blocked ? 1 : matches.length ? 0.6 : 0,
    },
    maxScore: blocked ? 1 : matches.length ? 0.6 : 0,
    blocked,
    reasons: matches.map((match) => `Termo proibido: ${match.term}`),
    matches,
  };
}

module.exports = {
  DEFAULT_TERMS,
  analyzeTextRules,
  normalizeText,
};
