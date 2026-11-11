"use strict";

function configuredUserIds(value) {
  return new Set(
    String(value || "")
      .split(",")
      .map((item) => Number(item.trim()))
      .filter((item) => Number.isSafeInteger(item) && item > 0)
  );
}

function moderationCapabilities(ctx) {
  const userId = Number(ctx?.userId);
  const reviewers = configuredUserIds(process.env.MODERATION_REVIEWER_USER_IDS);
  const legal = configuredUserIds(process.env.MODERATION_LEGAL_USER_IDS);
  return {
    canModerate: Boolean(ctx?.isManager || reviewers.has(userId)),
    canLegalEscalate: Boolean(legal.has(userId)),
  };
}

function requireModerator(ctx) {
  if (!ctx?.canModerate) {
    const error = new Error("Só moderadores autorizados podem consultar ou decidir conteúdo.");
    error.status = 403;
    error.code = "MODERATION_REVIEWER_REQUIRED";
    throw error;
  }
}

function requireLegalEscalation(ctx) {
  if (!ctx?.canLegalEscalate) {
    const error = new Error("Só as pessoas autorizadas podem escalar conteúdo para o jurídico/DPO.");
    error.status = 403;
    error.code = "MODERATION_LEGAL_ESCALATION_REQUIRED";
    throw error;
  }
}

module.exports = {
  configuredUserIds,
  moderationCapabilities,
  requireLegalEscalation,
  requireModerator,
};

