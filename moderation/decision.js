"use strict";

function number(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

const DEFAULT_WEIGHTS = Object.freeze({
  porn: 1,
  hentai: 1,
  nudity_explicit: 1,
  sexual_explicit: 1,
  sexual_content: 0.95,
  violence_gore: 1,
  hate_symbols: 1,
  sexy: 0.72,
  toxic: 0.9,
  toxicity: 0.9,
  threat: 1,
  identity_attack: 1,
  severe_toxicity: 1,
  rule_severity: 1,
});
const NON_RISK_CATEGORIES = new Set([
  "drawing",
  "neutral",
  "safe",
  "contextual",
  "rule_matches",
]);

function numericScores(result) {
  if (!result?.scores || typeof result.scores !== "object") return [];
  return Object.entries(result.scores)
    .filter(([category, value]) => (
      !NON_RISK_CATEGORIES.has(String(category))
      && Number.isFinite(Number(value))
    ))
    .map(([category, value]) => ({
      category: String(category),
      value: Math.max(0, Math.min(1, number(value))),
    }));
}

function decideModeration(results = [], options = {}) {
  const low = Math.max(0, Math.min(1, number(options.lowThreshold, 0.3)));
  const high = Math.max(low, Math.min(1, number(options.highThreshold, 0.72)));
  const weights = { ...DEFAULT_WEIGHTS, ...(options.weights || {}) };
  const failed = results.find((result) => result?.error || result?.unavailable);
  if (failed) {
    return {
      decision: "needs_review",
      score: 0,
      reasons: [failed.reason || `${failed.analyzer || "Analisador"} indisponível`],
      failedAnalyzer: failed.analyzer || "unknown",
    };
  }
  if (results.some((result) => result?.blocked)) {
    return {
      decision: "rejected",
      score: 1,
      category: "blocked_rule",
      reasons: results.flatMap((result) => result?.reasons || []).slice(0, 10),
    };
  }
  const scored = results
    .flatMap((result) => numericScores(result).map((entry) => ({
      result,
      category: entry.category,
      rawScore: entry.value,
      score: entry.value * number(weights[entry.category], 1),
    })));
  const highest = scored.sort((a, b) =>
    b.score - a.score || b.rawScore - a.rawScore
  )[0];
  const score = highest?.score || 0;
  const reasons = scored
    .flatMap((entry) => entry.result.reasons || [])
    .filter(Boolean)
    .slice(0, 10);
  if (score >= high) {
    return { decision: "rejected", score, category: highest?.category || null, reasons };
  }
  if (score >= low) {
    return { decision: "needs_review", score, category: highest?.category || null, reasons };
  }
  return { decision: "approved", score, category: highest?.category || null, reasons };
}

function decideModerationByInputType(results, options = {}) {
  const visual = results.filter((result) => result.thresholdType === "image");
  const text = results.filter((result) => result.thresholdType !== "image");
  const decisions = [];
  if (text.length) {
    decisions.push(decideModeration(text, options.text || {}));
  }
  if (visual.length) {
    decisions.push(decideModeration(visual, options.image || {}));
  }
  const rank = { approved: 0, pending: 1, needs_review: 2, rejected: 3 };
  const sorted = decisions.sort((left, right) =>
    (rank[right.decision] || 0) - (rank[left.decision] || 0)
    || Number(right.score) - Number(left.score)
  );
  const highest = sorted[0] || {
    decision: "needs_review",
    score: 0,
    reasons: ["Não foi possível calcular a decisão."],
    failedAnalyzer: "decision",
  };
  return {
    ...highest,
    reasons: decisions.flatMap((decision) => decision.reasons || [])
      .filter((reason, index, list) => list.indexOf(reason) === index)
      .slice(0, 12),
    failedAnalyzer: decisions.find((decision) => decision.failedAnalyzer)
      ?.failedAnalyzer || null,
  };
}

module.exports = { decideModeration, decideModerationByInputType };
