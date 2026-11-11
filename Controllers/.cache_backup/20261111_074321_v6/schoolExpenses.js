// controllers/schoolExpenses.controller.js

const path    = require("path");
const multer  = require("multer");
const ExecuteQuery       = require("../Functions/ExecuteQuery");
const { RegisterAuditAction } = require("./Auditory");

 
// ─── Constantes ───────────────────────────────────────────────────────────────

const VALID_CATEGORIES = [
  'salarios', 'material', 'manutencao', 'utilities',
  'eventos', 'equipamento', 'servicos', 'outro',
];
const VALID_STATUS = [0, 1, 2]; // 0=pendente 1=pago 2=cancelado
const STATUS_LABELS = ['pendente', 'pago', 'cancelado'];

// ─── Multer — upload de comprovativo ─────────────────────────────────────────

const receiptStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, path.join(__dirname, "../public/images/expenses"));
  },
  filename: (req, file, cb) => {
    const ext  = path.extname(file.originalname).toLowerCase();
    const name = `receipt_${Date.now()}_${Math.random().toString(16).slice(2)}${ext}`;
    cb(null, name);
  },
});

const receiptFilter = (req, file, cb) => {
  const allowed = [".pdf", ".jpg", ".jpeg", ".png", ".webp"];
  if (allowed.includes(path.extname(file.originalname).toLowerCase())) {
    cb(null, true);
  } else {
    cb(new Error("Tipo de ficheiro não permitido. Use PDF, JPG ou PNG."), false);
  }
};

// Exportado para usar no router: upload.single("expense_receipt")
const uploadExpenses = multer({
  storage: receiptStorage,
  fileFilter: receiptFilter,
  limits: { fileSize: 8 * 1024 * 1024 }, // 8 MB
});

// ─── Helper: dados do operador (padrão do projecto) ──────────────────────────

async function getOperatorData(res, userId) {
  if (!userId) return null;
  try {
    const query = `
      SELECT ed_user_account_id, ed_user_account_name
      FROM eduall_user_accounts
      WHERE ed_user_account_id = ?
        AND ed_user_account_deleted = 0
      LIMIT 1
    `;
    const [operator] = await ExecuteQuery(res, query, [userId], true, {
      db:   "eduall_user_accounts",
      type: "select",
      data: { operatorLookup: true },
    });
    if (operator) {
      return {
        id:   operator.ed_user_account_id,
        name: operator.ed_user_account_name || "Operador Desconhecido",
      };
    }
    return null;
  } catch (error) {
    console.warn("Erro ao buscar dados do operador:", error.message);
    return null;
  }
}

// ─── GET /eduallexpenseslist/get ─────────────────────────────────────────────

const GetExpenses = async (req, res) => {
  try {
    const operatorId = req.session?.user?.eduall_user_session_ID;
    const operator   = await getOperatorData(res, operatorId);
    const institute  = req.session.user.eduall_user_session_curentinstitute;

    // Filtros opcionais: ?category=salarios&status=0&year=2025&month=3
    const { category, status, year, month } = req.query;

    let where  = "WHERE e.ed_expense_deleted = 0 AND e.ed_expense_institute = ?";
    const params = [institute];

    if (category && VALID_CATEGORIES.includes(category)) {
      where += " AND e.ed_expense_category = ?";
      params.push(category);
    }
    if (status !== undefined && VALID_STATUS.includes(Number(status))) {
      where += " AND e.ed_expense_status = ?";
      params.push(Number(status));
    }
    if (year) {
      where += " AND YEAR(e.ed_expense_date) = ?";
      params.push(Number(year));
    }
    if (month) {
      where += " AND MONTH(e.ed_expense_date) = ?";
      params.push(Number(month));
    }

    // Adicionar operatorId para o JOIN (mesmo padrão de GetServicePayments)
    params.unshift(operatorId); // vai para o 1º ? do JOIN com ua

    const rows = await ExecuteQuery(
      res,
      `SELECT
         e.ed_expense_id,
         e.ed_expense_title,
         e.ed_expense_category,
         e.ed_expense_amount,
         e.ed_expense_currency,
         e.ed_expense_date,
         e.ed_expense_description,
         e.ed_expense_responsible,
         e.ed_expense_status,
         e.ed_expense_receipt,
         e.ed_expense_created_at,
         e.ed_expense_updated_at,
         e.ed_expense_created_by,
         ua.ed_user_account_name AS operator_name,
         ua.ed_user_account_id   AS operator_id
       FROM eduall_school_expenses e
       LEFT JOIN eduall_user_accounts ua
              ON ua.ed_user_account_id = ?
             AND ua.ed_user_account_deleted = 0
       ${where}
       ORDER BY e.ed_expense_date DESC, e.ed_expense_created_at DESC`,
      params,
      true,
      { db: "eduall_school_expenses", type: "select", data: req }
    );

    // Enriquecer com dados do operador (mesmo padrão de GetServicePayments)
    const enrichedRows = rows.map((row) => ({
      ...row,
      operator:    operator?.name || "operator:null",
      operator_id: operator?.id   || null,
    }));

    return res.status(200).json(enrichedRows);
  } catch (err) {
    console.error("GetExpenses:", err);
    return res.status(400).json({ success: false, msg: err.message });
  }
};

// ─── GET /eduallexpensessingle/get/:ID ───────────────────────────────────────

const GetSingleExpense = async (req, res) => {
  try {
    const { ID }    = req.params;
    const institute = req.session.user.eduall_user_session_curentinstitute;
    const operatorId = req.session?.user?.eduall_user_session_ID;

    const rows = await ExecuteQuery(
      res,
      `SELECT
         e.*,
         ua.ed_user_account_name AS operator_name,
         ua.ed_user_account_id   AS operator_id
       FROM eduall_school_expenses e
       LEFT JOIN eduall_user_accounts ua
              ON ua.ed_user_account_id = ?
             AND ua.ed_user_account_deleted = 0
       WHERE e.ed_expense_deleted = 0
         AND e.ed_expense_id      = ?
         AND e.ed_expense_institute = ?
       LIMIT 1`,
      [operatorId, ID, institute],
      true,
      { db: "eduall_school_expenses", type: "select", data: req }
    );

    if (!rows.length) {
      return res.status(404).json({ success: false, msg: "Despesa não encontrada." });
    }
    return res.status(200).json(rows);
  } catch (err) {
    return res.status(400).json({ success: false, msg: err.message });
  }
};

// ─── POST /eduallexpensesregister/post ───────────────────────────────────────
// Usar no router: upload.single("expense_receipt"), RegisterExpense

const RegisterExpense = async (req, res) => {
  try {
    const operatorId = req.session?.user?.eduall_user_session_ID;
    const operator   = await getOperatorData(res, operatorId);
    const institute  = req.session.user.eduall_user_session_curentinstitute;

    const {
      expense_title,
      expense_category  = "outro",
      expense_amount,
      expense_currency  = "AOA",
      expense_date,
      expense_description,
      expense_responsible,
      expense_status    = 0,
    } = req.body;

    // Validações
    if (!expense_title?.trim())
      return res.status(400).json({ success: false, msg: "Título obrigatório." });
    if (!expense_amount || Number(expense_amount) <= 0)
      return res.status(400).json({ success: false, msg: "Valor inválido." });
    if (!expense_date)
      return res.status(400).json({ success: false, msg: "Data obrigatória." });
    if (!VALID_CATEGORIES.includes(expense_category))
      return res.status(400).json({ success: false, msg: "Categoria inválida." });

    // Comprovativo: vem de multer (req.file) ou path existente no body
    const receiptPath = req.file
      ? `images/expenses/${req.file.filename}`
      : null;

    const result = await ExecuteQuery(
      res,
      `INSERT INTO eduall_school_expenses
         (ed_expense_title, ed_expense_category, ed_expense_amount, ed_expense_currency,
          ed_expense_date, ed_expense_description, ed_expense_responsible,
          ed_expense_status, ed_expense_receipt, ed_expense_institute, ed_expense_created_by)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      [
        expense_title.trim(),
        expense_category,
        Number(expense_amount),
        expense_currency,
        expense_date,
        expense_description || null,
        expense_responsible || null,
        Number(expense_status),
        receiptPath,
        institute,
        operatorId || null,
      ],
      false,
      { db: "eduall_school_expenses", type: "insert", data: req }
    );

    await RegisterAuditAction({
      session:     req.session,
      action:      1,
      form:        "Despesas",
      description: `Registou despesa "${expense_title.trim()}" — ${expense_amount} ${expense_currency} (operador: ${operator?.name || operatorId})`,
    });

    return res.status(201).json({
      success:  true,
      msg:      "Despesa registada com sucesso.",
      id:       result.insertId,
      receipt:  receiptPath,
      operator: operator?.name || null,
    });
  } catch (err) {
    console.error("RegisterExpense:", err);
    return res.status(400).json({ success: false, msg: err.message });
  }
};

// ─── PUT /eduallexpensesupdate/update/:ID ────────────────────────────────────
// Usar no router: upload.single("expense_receipt"), UpdateExpense

const UpdateExpense = async (req, res) => {
  try {
    const { ID }     = req.params;
    const operatorId = req.session?.user?.eduall_user_session_ID;
    const operator   = await getOperatorData(res, operatorId);
    const institute  = req.session.user.eduall_user_session_curentinstitute;

    const {
      expense_title, expense_category,
      expense_amount, expense_currency,
      expense_date, expense_description,
      expense_responsible, expense_status,
    } = req.body;

    // Verificar que existe e pertence à instituição
    const existing = await ExecuteQuery(
      res,
      `SELECT ed_expense_id, ed_expense_receipt
       FROM eduall_school_expenses
       WHERE ed_expense_deleted = 0
         AND ed_expense_id = ?
         AND ed_expense_institute = ?
       LIMIT 1`,
      [ID, institute],
      true
    );
    if (!existing.length) {
      return res.status(404).json({ success: false, msg: "Despesa não encontrada." });
    }

    // Novo comprovativo via multer, ou manter o existente
    const receiptPath = req.file
      ? `images/expenses/${req.file.filename}`
      : existing[0].ed_expense_receipt; // mantém o anterior se não enviar novo

    await ExecuteQuery(
      res,
      `UPDATE eduall_school_expenses SET
         ed_expense_title       = ?,
         ed_expense_category    = ?,
         ed_expense_amount      = ?,
         ed_expense_currency    = ?,
         ed_expense_date        = ?,
         ed_expense_description = ?,
         ed_expense_responsible = ?,
         ed_expense_status      = ?,
         ed_expense_receipt     = ?
       WHERE ed_expense_id = ?
         AND ed_expense_institute = ?`,
      [
        expense_title?.trim(),
        expense_category,
        Number(expense_amount),
        expense_currency,
        expense_date,
        expense_description || null,
        expense_responsible || null,
        Number(expense_status),
        receiptPath,
        ID,
        institute,
      ],
      false,
      { db: "eduall_school_expenses", type: "update", data: req }
    );

    await RegisterAuditAction({
      session:     req.session,
      action:      2,
      form:        "Despesas",
      description: `Actualizou despesa #${ID} "${expense_title}" (operador: ${operator?.name || operatorId})`,
    });

    return res.status(200).json({
      success:  true,
      msg:      "Despesa actualizada com sucesso.",
      receipt:  receiptPath,
      operator: operator?.name || null,
    });
  } catch (err) {
    return res.status(400).json({ success: false, msg: err.message });
  }
};

// ─── PUT /eduallexpensesstatus/update/:ID ────────────────────────────────────

const UpdateExpenseStatus = async (req, res) => {
  try {
    const { ID }     = req.params;
    const operatorId = req.session?.user?.eduall_user_session_ID;
    const operator   = await getOperatorData(res, operatorId);
    const institute  = req.session.user.eduall_user_session_curentinstitute;
    const status     = Number(req.body.expense_status);

    if (!VALID_STATUS.includes(status)) {
      return res.status(400).json({ success: false, msg: "Status inválido." });
    }

    await ExecuteQuery(
      res,
      `UPDATE eduall_school_expenses SET ed_expense_status = ?
       WHERE ed_expense_deleted = 0
         AND ed_expense_id      = ?
         AND ed_expense_institute = ?`,
      [status, ID, institute],
      false,
      { db: "eduall_school_expenses", type: "update", data: req }
    );

    await RegisterAuditAction({
      session:     req.session,
      action:      2,
      form:        "Despesas",
      description: `Alterou estado da despesa #${ID} para "${STATUS_LABELS[status]}" (operador: ${operator?.name || operatorId})`,
    });

    return res.status(200).json({ success: true, msg: "Estado actualizado.", operator: operator?.name || null });
  } catch (err) {
    return res.status(400).json({ success: false, msg: err.message });
  }
};

// ─── PUT /eduallexpensesdelete/delete/:ID ────────────────────────────────────

const DeleteExpense = async (req, res) => {
  try {
    const { ID }     = req.params;
    const operatorId = req.session?.user?.eduall_user_session_ID;
    const operator   = await getOperatorData(res, operatorId);
    const institute  = req.session.user.eduall_user_session_curentinstitute;

    await ExecuteQuery(
      res,
      `UPDATE eduall_school_expenses SET ed_expense_deleted = 1
       WHERE ed_expense_deleted = 0
         AND ed_expense_id      = ?
         AND ed_expense_institute = ?`,
      [ID, institute],
      false,
      { db: "eduall_school_expenses", type: "update", data: req }
    );

    await RegisterAuditAction({
      session:     req.session,
      action:      3,
      form:        "Despesas",
      description: `Eliminou despesa #${ID} (operador: ${operator?.name || operatorId})`,
    });

    return res.status(200).json({ success: true, msg: "Despesa eliminada.", operator: operator?.name || null });
  } catch (err) {
    return res.status(400).json({ success: false, msg: err.message });
  }
};

// ─── GET /eduallexpensessummary/get ──────────────────────────────────────────

const GetExpensesSummary = async (req, res) => {
  try {
    const institute = req.session.user.eduall_user_session_curentinstitute;
    const year      = req.query.year || new Date().getFullYear();

    const [byCategory, byMonth, byStatus] = await Promise.all([
      ExecuteQuery(res,
        `SELECT ed_expense_category AS category,
                COUNT(*)            AS count,
                SUM(ed_expense_amount) AS total
         FROM eduall_school_expenses
         WHERE ed_expense_deleted = 0
           AND ed_expense_institute = ?
           AND YEAR(ed_expense_date) = ?
           AND ed_expense_status    != 2
         GROUP BY ed_expense_category
         ORDER BY total DESC`,
        [institute, year], true),

      ExecuteQuery(res,
        `SELECT MONTH(ed_expense_date)  AS month,
                SUM(ed_expense_amount)  AS total,
                COUNT(*)                AS count
         FROM eduall_school_expenses
         WHERE ed_expense_deleted = 0
           AND ed_expense_institute = ?
           AND YEAR(ed_expense_date) = ?
           AND ed_expense_status    != 2
         GROUP BY MONTH(ed_expense_date)
         ORDER BY month`,
        [institute, year], true),

      ExecuteQuery(res,
        `SELECT ed_expense_status       AS status,
                COUNT(*)                AS count,
                SUM(ed_expense_amount)  AS total
         FROM eduall_school_expenses
         WHERE ed_expense_deleted = 0
           AND ed_expense_institute = ?
           AND YEAR(ed_expense_date) = ?
         GROUP BY ed_expense_status`,
        [institute, year], true),
    ]);

    return res.status(200).json({ byCategory, byMonth, byStatus, year: Number(year) });
  } catch (err) {
    return res.status(400).json({ success: false, msg: err.message });
  }
};

// ─── Exportações ──────────────────────────────────────────────────────────────

module.exports = {
  uploadExpenses,                 // multer middleware — usar no router
  GetExpenses,
  GetSingleExpense,
  RegisterExpense,
  UpdateExpense,
  UpdateExpenseStatus,
  DeleteExpense,
  GetExpensesSummary,
};