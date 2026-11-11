"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  inclusiveDays,
  validateVacation,
  validatePositiveAmount,
  normalizePage,
  buildMeta,
  canManageHr,
  overlap,
} = require("../hr/rules");

test("RH calcula dias inclusivos e rejeita intervalo invertido", () => {
  assert.equal(inclusiveDays("2026-11-01", "2026-11-05"), 5);
  assert.equal(inclusiveDays("2026-11-05", "2026-11-01"), -1);
});

test("pedido de ausência exige datas válidas e motivo", () => {
  const invalid = validateVacation({ startDate: "", endDate: "2026-10-30", reason: "" });
  assert.equal(invalid.ok, false);
  assert.ok(invalid.errors.startDate);
  assert.ok(invalid.errors.reason);

  const valid = validateVacation({
    startDate: "2026-12-20",
    endDate: "2026-12-31",
    leaveType: "ferias",
    reason: "Férias anuais",
  });
  assert.equal(valid.ok, true);
  assert.equal(valid.value.days, 12);
});

test("valores monetários e paginação são normalizados no servidor", () => {
  assert.deepEqual(validatePositiveAmount("125.509"), { ok: true, value: 125.51 });
  assert.equal(validatePositiveAmount("-1").ok, false);
  assert.deepEqual(normalizePage({ page: 0, limit: 250 }), {
    page: 1,
    limit: 100,
    offset: 0,
  });
  assert.deepEqual(buildMeta(201, 3, 100), {
    total: 201,
    page: 3,
    limit: 100,
    totalPages: 3,
  });
});

test("gestão RH usa perfil/âmbito e deteta sobreposição de ausências", () => {
  assert.equal(canManageHr({ accountType: 0 }), true);
  assert.equal(canManageHr({ appTypes: ["hr"] }), true);
  assert.equal(canManageHr({ role: "Diretora de Recursos Humanos" }), true);
  assert.equal(canManageHr({ role: "Assistente" }), false);
  assert.equal(
    overlap(
      { startDate: "2026-11-01", endDate: "2026-11-05" },
      { startDate: "2026-11-05", endDate: "2026-11-08" }
    ),
    true
  );
});
