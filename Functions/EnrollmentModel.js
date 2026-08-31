// Functions/EnrollmentModel.js
const ExecuteQuery = require("./ExecuteQuery");

const ENROLLMENT_MODEL = {
  ACTUAL: "actual",
  MATRICULA_CONFIRMACAO_FINANCEIRA: "matricula_confirmacao_financeira",
};

/**
 * Garante que as colunas necessárias existem (auto-migração, mesmo padrão
 * usado em InstituteUpdate para ed_logo_urlcloudinary). Chamado de forma
 * "preguiçosa" (lazy) — só corre o ALTER TABLE se a coluna não existir.
 */ 
async function ensureEnrollmentModelColumns(res) {
  const checks = [
    {
      table: "eduall_institutes",
      column: "ed_institute_enrollment_model",
      alter: `ALTER TABLE eduall_institutes
              ADD COLUMN ed_institute_enrollment_model VARCHAR(40) NOT NULL DEFAULT 'actual'
              AFTER ed_institute_type`,
    },
    {
      table: "eduall_students",
      column: "ed_student_awaiting_payment",
      alter: `ALTER TABLE eduall_students
              ADD COLUMN ed_student_awaiting_payment TINYINT(1) NOT NULL DEFAULT 0
              AFTER ed_student_enrolled`,
    },
  ];

  for (const c of checks) {
    const [row] = await ExecuteQuery(
      res,
      `SELECT COUNT(*) AS exist
         FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME = ?
          AND COLUMN_NAME = ?`,
      [c.table, c.column],
      true
    );
    if (row && row.exist === 0) {
      await ExecuteQuery(res, c.alter, [], true);
      console.log(`[EnrollmentModel] Coluna '${c.column}' criada em '${c.table}' automaticamente.`);
    }
  }
}

/**
 * Devolve o modelo de matrícula configurado para o instituto.
 * Nunca rebenta se a coluna ainda não existir (ensureEnrollmentModelColumns
 * deve ser chamado antes, mas há aqui um fallback defensivo).
 */
async function getInstituteEnrollmentModel(res, instituteCode) {
  try {
    const [row] = await ExecuteQuery(
      res,
      `SELECT ed_institute_enrollment_model
         FROM eduall_institutes
        WHERE ed_institute_code = ? AND ed_institute_deleted = 0
        LIMIT 1`,
      [instituteCode],
      true
    );
    return row?.ed_institute_enrollment_model || ENROLLMENT_MODEL.ACTUAL;
  } catch (err) {
    console.warn(`[EnrollmentModel] Falha ao ler modelo do instituto ${instituteCode}, a assumir 'actual': ${err.message}`);
    return ENROLLMENT_MODEL.ACTUAL;
  }
}

function usesFinancialConfirmation(model) {
  return model === ENROLLMENT_MODEL.MATRICULA_CONFIRMACAO_FINANCEIRA;
}

module.exports = {
  ENROLLMENT_MODEL,
  ensureEnrollmentModelColumns,
  getInstituteEnrollmentModel,
  usesFinancialConfirmation,
};