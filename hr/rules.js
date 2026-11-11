"use strict";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function cleanText(value, max = 5000) {
  return String(value ?? "").trim().slice(0, max);
}

function dateOnly(value) {
  const text = cleanText(value, 10);
  return ISO_DATE.test(text) ? text : "";
}

function inclusiveDays(startDate, endDate) {
  const start = dateOnly(startDate);
  const end = dateOnly(endDate);
  if (!start || !end) return 0;
  const startTime = Date.UTC(
    Number(start.slice(0, 4)),
    Number(start.slice(5, 7)) - 1,
    Number(start.slice(8, 10))
  );
  const endTime = Date.UTC(
    Number(end.slice(0, 4)),
    Number(end.slice(5, 7)) - 1,
    Number(end.slice(8, 10))
  );
  if (endTime < startTime) return -1;
  return Math.floor((endTime - startTime) / 86400000) + 1;
}

function validateVacation(input) {
  const errors = {};
  const startDate = dateOnly(input?.startDate);
  const endDate = dateOnly(input?.endDate);
  const totalDays = inclusiveDays(startDate, endDate);
  if (!startDate) errors.startDate = "Indique uma data de início válida.";
  if (!endDate) errors.endDate = "Indique uma data de fim válida.";
  if (totalDays < 0) errors.endDate = "A data de fim não pode anteceder o início.";
  if (!cleanText(input?.reason, 2000)) errors.reason = "O motivo é obrigatório.";
  return {
    ok: Object.keys(errors).length === 0,
    errors,
    value: {
      startDate,
      endDate,
      days: Math.max(0, totalDays),
      leaveType: cleanText(input?.leaveType || "ferias", 40),
      reason: cleanText(input?.reason, 2000),
    },
  };
}

function validatePositiveAmount(value) {
  const amount = Number(value);
  return Number.isFinite(amount) && amount > 0
    ? { ok: true, value: Math.round(amount * 100) / 100 }
    : { ok: false, value: 0 };
}

function normalizePage(input = {}) {
  const page = Math.max(1, Number.parseInt(input.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, Number.parseInt(input.limit, 10) || 25));
  return { page, limit, offset: (page - 1) * limit };
}

function buildMeta(total, page, limit) {
  const count = Math.max(0, Number(total) || 0);
  return {
    total: count,
    page,
    limit,
    totalPages: Math.max(1, Math.ceil(count / limit)),
  };
}

function canManageHr({ accountType, userType, role, appTypes = [] }) {
  if (Number(accountType) === 0 || Number(userType) === 0) return true;
  if (appTypes.includes("hr")) return true;
  return /admin|director|dire[cç][aã]o|gestor|chefe|coorden|rh|recursos humanos/i.test(
    String(role || "")
  );
}

function overlap(range, other) {
  return Boolean(
    range &&
    other &&
    dateOnly(range.startDate) &&
    dateOnly(range.endDate) &&
    dateOnly(other.startDate) &&
    dateOnly(other.endDate) &&
    range.startDate <= other.endDate &&
    other.startDate <= range.endDate
  );
}

module.exports = {
  cleanText,
  dateOnly,
  inclusiveDays,
  validateVacation,
  validatePositiveAmount,
  normalizePage,
  buildMeta,
  canManageHr,
  overlap,
};
