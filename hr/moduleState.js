"use strict";

const { DATABASE } = require("../config/Database");

const MODULES = Object.freeze({
  employees: new Set(["directory"]),
  organization: new Set(["structure"]),
  performance: new Set(["workspace"]),
  documents: new Set(["workspace"]),
});

function fail(status, code, message) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  throw error;
}

function validateTarget(moduleName, key) {
  const resources = MODULES[moduleName];
  if (!resources || !resources.has(key)) {
    fail(404, "HR_MODULE_STATE_NOT_FOUND", "Estado de módulo inválido.");
  }
}

function parseData(value) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

async function getModuleState(ctx, moduleName, key) {
  validateTarget(moduleName, key);
  const [rows] = await DATABASE.query(
    `SELECT ed_hr_module_state_data AS data,
            ed_hr_module_state_updated_at AS updatedAt
       FROM eduall_hr_module_state
      WHERE BINARY ed_hr_module_state_institute_code = BINARY ?
        AND ed_hr_module_state_module = ?
        AND ed_hr_module_state_key = ?
        AND ed_hr_module_state_deleted = 0
      LIMIT 1`,
    [ctx.instituteCode, moduleName, key]
  );
  if (!rows.length) return { data: null, updatedAt: null };
  return {
    data: parseData(rows[0].data),
    updatedAt: rows[0].updatedAt,
  };
}

async function saveModuleState(ctx, moduleName, key, input) {
  validateTarget(moduleName, key);
  const value = input?.data;
  if (value === undefined || value === null || typeof value !== "object") {
    fail(422, "HR_MODULE_STATE_INVALID", "Os dados do módulo são inválidos.");
  }
  const serialized = JSON.stringify(value);
  if (serialized.length > 1_500_000) {
    fail(422, "HR_MODULE_STATE_TOO_LARGE", "O estado do módulo excede o limite permitido.");
  }
  await DATABASE.query(
    `INSERT INTO eduall_hr_module_state (
       ed_hr_module_state_institute_code,
       ed_hr_module_state_module,
       ed_hr_module_state_key,
       ed_hr_module_state_data,
       ed_hr_module_state_created_by,
       ed_hr_module_state_updated_by,
       ed_hr_module_state_deleted
     ) VALUES (?, ?, ?, ?, ?, ?, 0)
     ON DUPLICATE KEY UPDATE
       ed_hr_module_state_data = VALUES(ed_hr_module_state_data),
       ed_hr_module_state_updated_by = VALUES(ed_hr_module_state_updated_by),
       ed_hr_module_state_deleted = 0`,
    [ctx.instituteCode, moduleName, key, serialized, ctx.userId, ctx.userId]
  );
  return getModuleState(ctx, moduleName, key);
}

module.exports = {
  getModuleState,
  saveModuleState,
};
