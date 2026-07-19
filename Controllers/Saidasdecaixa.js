/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  CONTROLLERS — CASH OUTFLOWS (SAÍDAS DE CAIXA)
 *  File: controllers/CashOutflowController.js
 *
 *  Expected routes (in routes/CashOutflowRoutes.js or equivalent):
 *
 *  GET    /eduallcashoutflowlist/get/              → GetAllCashOutflows
 *  GET    /eduallcashoutflowsingle/get/:ID         → GetSingleCashOutflow
 *  POST   /eduallcashoutflowregister/post/         → RegisterCashOutflow
 *  PUT    /eduallcashoutflowupdate/put/:ID         → UpdateCashOutflow
 *  DELETE /eduallcashoutflowdelete/delete/:ID      → DeleteCashOutflow
 *  GET    /eduallcashoutflowreport/get/            → GetCashOutflowReport  (filters via query string)
 *
 *  MySQL table: eduall_cash_outflow
 *  DDL at the bottom of this file.
 * ═══════════════════════════════════════════════════════════════════════════════
 */

const ExecuteQuery            = require('../Functions/ExecuteQuery');
const { RegisterAuditAction } = require('./Auditory');


// ───────────────────────────────────────────────────────────────
//  Helpers
// ───────────────────────────────────────────────────────────────

function getInstitute(req) {
  return req.session?.user?.eduall_user_session_curentinstitute || null;
}

function getOperatorName(req) {
  return (
    req.session?.user?.eduall_user_name ||
    req.session?.user?.eduall_user_session_name ||
    'Unknown'
  );
}


// ───────────────────────────────────────────────────────────────
//  1. GET ALL — list all cash outflows for the institute
// ───────────────────────────────────────────────────────────────

const GetAllCashOutflows = async (req, res) => {
  try {
    const institute = getInstitute(req);

    if (!institute) {
      return res.status(401).json({ success: false, msg: 'Invalid session.' });
    }

    const query = `
      SELECT
        co_id,
        co_number,
        co_category,
        co_description,
        co_amount,
        co_bank,
        co_date,
        co_beneficiary,
        co_beneficiary_id,
        co_operator,
        co_institute_code,
        co_created_at,
        co_updated_at
      FROM eduall_cash_outflow
      WHERE co_deleted = 0
        AND co_institute_code = ?
      ORDER BY co_date DESC, co_id DESC
    `;

    const rows = await ExecuteQuery(res, query, [institute], true, {
      db   : 'eduall_cash_outflow',
      type : 'select',
      data : req,
    });

    return res.status(200).json(rows);

  } catch (error) {
    console.error('[GetAllCashOutflows]', error);
    return res.status(500).json({
      success : false,
      msg     : 'Failed to retrieve cash outflows.',
      error   : error.message,
    });
  }
};


// ───────────────────────────────────────────────────────────────
//  2. GET SINGLE — retrieve one cash outflow by ID
// ───────────────────────────────────────────────────────────────

const GetSingleCashOutflow = async (req, res) => {
  try {
    const institute = getInstitute(req);
    const { ID }    = req.params;

    if (!institute) {
      return res.status(401).json({ success: false, msg: 'Invalid session.' });
    }
    if (!ID) {
      return res.status(400).json({ success: false, msg: 'ID not provided.' });
    }

    const query = `
      SELECT *
      FROM eduall_cash_outflow
      WHERE co_deleted = 0
        AND co_id = ?
        AND co_institute_code = ?
      LIMIT 1
    `;

    const rows = await ExecuteQuery(res, query, [ID, institute], true, {
      db   : 'eduall_cash_outflow',
      type : 'select',
      data : req,
    });

    if (!rows || rows.length === 0) {
      return res.status(404).json({ success: false, msg: 'Record not found.' });
    }

    return res.status(200).json(rows[0]);

  } catch (error) {
    console.error('[GetSingleCashOutflow]', error);
    return res.status(500).json({
      success : false,
      msg     : 'Failed to retrieve cash outflow.',
      error   : error.message,
    });
  }
};


// ───────────────────────────────────────────────────────────────
//  3. POST — register a new cash outflow
// ───────────────────────────────────────────────────────────────

const RegisterCashOutflow = async (req, res) => {
  try {
    const institute = getInstitute(req);

    if (!institute) {
      return res.status(401).json({ success: false, msg: 'Invalid session.' });
    }

    // ── Required field validation ──
    const {
      co_category,
      co_description,
      co_amount,
      co_bank,
      co_date,
      co_beneficiary,
      co_beneficiary_id,
      co_operator,
    } = req.body;

    const missing = [];
    if (!co_category)    missing.push('co_category');
    if (!co_description) missing.push('co_description');
    if (co_amount === undefined || co_amount === null || isNaN(Number(co_amount))) missing.push('co_amount');
    if (!co_beneficiary) missing.push('co_beneficiary');
    if (!co_operator)    missing.push('co_operator');

    if (missing.length > 0) {
      return res.status(400).json({
        success : false,
        msg     : `Missing required fields: ${missing.join(', ')}`,
      });
    }

    if (Number(co_amount) <= 0) {
      return res.status(400).json({ success: false, msg: 'Amount must be greater than zero.' });
    }

    // ── Generate sequential number per institute per year ──
    const year = co_date
      ? new Date(co_date).getFullYear()
      : new Date().getFullYear();

    const seqQuery = `
      SELECT COALESCE(MAX(co_number), 0) + 1 AS next_num
      FROM eduall_cash_outflow
      WHERE co_institute_code = ?
        AND YEAR(co_date) = ?
        AND co_deleted = 0
    `;
    const seqResult = await ExecuteQuery(res, seqQuery, [institute, year], true, {
      db   : 'eduall_cash_outflow',
      type : 'select',
      data : req,
    });
    const nextNum = seqResult?.[0]?.next_num || 1;

    // ── Insert ──
    const insertQuery = `
      INSERT INTO eduall_cash_outflow (
        co_number,
        co_category,
        co_description,
        co_amount,
        co_bank,
        co_date,
        co_beneficiary,
        co_beneficiary_id,
        co_operator,
        co_institute_code,
        co_deleted,
        co_created_at,
        co_updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, NOW(), NOW())
    `;

    const params = [
      nextNum,
      String(co_category).trim(),
      String(co_description).trim(),
      Number(co_amount),
      co_bank   ? String(co_bank).trim() : '-- (Cash)',
      co_date   ? co_date : new Date().toISOString().slice(0, 19).replace('T', ' '),
      String(co_beneficiary).trim(),
      co_beneficiary_id ? String(co_beneficiary_id).trim() : null,
      String(co_operator).trim(),
      institute,
    ];

    await ExecuteQuery(res, insertQuery, params, false, {
      db   : 'eduall_cash_outflow',
      type : 'insert',
      data : req,
    });

    // ── Audit log ──
    await RegisterAuditAction({
      session     : req.session,
      action      : 1,                             // 1 = create
      form        : 'Cash Outflows',
      description : `Registered cash outflow No. ${String(nextNum).padStart(6, '0')}/${year} — ${co_category} — ${Number(co_amount).toFixed(2)} AOA`,
    });

    return res.status(201).json({
      success : true,
      msg     : 'Cash outflow registered successfully.',
      number  : nextNum,
      year,
    });

  } catch (error) {
    console.error('[RegisterCashOutflow]', error);
    return res.status(500).json({
      success : false,
      msg     : 'Failed to register cash outflow.',
      error   : error.message,
    });
  }
};


// ───────────────────────────────────────────────────────────────
//  4. PUT — update existing cash outflow
// ───────────────────────────────────────────────────────────────

const UpdateCashOutflow = async (req, res) => {
  try {
    const institute = getInstitute(req);
    const { ID }    = req.params;

    if (!institute) {
      return res.status(401).json({ success: false, msg: 'Invalid session.' });
    }
    if (!ID) {
      return res.status(400).json({ success: false, msg: 'ID not provided.' });
    }

    // ── Check record exists ──
    const checkQuery = `
      SELECT co_id, co_number, co_date
      FROM eduall_cash_outflow
      WHERE co_id = ? AND co_institute_code = ? AND co_deleted = 0
      LIMIT 1
    `;
    const existing = await ExecuteQuery(res, checkQuery, [ID, institute], true, {
      db   : 'eduall_cash_outflow',
      type : 'select',
      data : req,
    });

    if (!existing || existing.length === 0) {
      return res.status(404).json({ success: false, msg: 'Record not found.' });
    }

    // ── Validation ──
    const {
      co_category,
      co_description,
      co_amount,
      co_bank,
      co_date,
      co_beneficiary,
      co_beneficiary_id,
      co_operator,
    } = req.body;

    const missing = [];
    if (!co_category)    missing.push('co_category');
    if (!co_description) missing.push('co_description');
    if (co_amount === undefined || co_amount === null || isNaN(Number(co_amount))) missing.push('co_amount');
    if (!co_beneficiary) missing.push('co_beneficiary');
    if (!co_operator)    missing.push('co_operator');

    if (missing.length > 0) {
      return res.status(400).json({
        success : false,
        msg     : `Missing required fields: ${missing.join(', ')}`,
      });
    }

    if (Number(co_amount) <= 0) {
      return res.status(400).json({ success: false, msg: 'Amount must be greater than zero.' });
    }

    // ── Update ──
    const updateQuery = `
      UPDATE eduall_cash_outflow SET
        co_category       = ?,
        co_description    = ?,
        co_amount         = ?,
        co_bank           = ?,
        co_date           = ?,
        co_beneficiary    = ?,
        co_beneficiary_id = ?,
        co_operator       = ?,
        co_updated_at     = NOW()
      WHERE co_id = ? AND co_institute_code = ? AND co_deleted = 0
    `;

    const params = [
      String(co_category).trim(),
      String(co_description).trim(),
      Number(co_amount),
      co_bank   ? String(co_bank).trim() : '-- (Cash)',
      co_date   ? co_date : new Date().toISOString().slice(0, 19).replace('T', ' '),
      String(co_beneficiary).trim(),
      co_beneficiary_id ? String(co_beneficiary_id).trim() : null,
      String(co_operator).trim(),
      ID,
      institute,
    ];

    await ExecuteQuery(res, updateQuery, params, false, {
      db   : 'eduall_cash_outflow',
      type : 'update',
      data : req,
    });

    // ── Audit log ──
    const rec  = existing[0];
    const num  = String(rec.co_number || 0).padStart(6, '0');
    const year = rec.co_date ? new Date(rec.co_date).getFullYear() : new Date().getFullYear();

    await RegisterAuditAction({
      session     : req.session,
      action      : 2,                             // 2 = update
      form        : 'Cash Outflows',
      description : `Updated cash outflow No. ${num}/${year} — ${co_category} — ${Number(co_amount).toFixed(2)} AOA`,
    });

    return res.status(200).json({ success: true, msg: 'Cash outflow updated successfully.' });

  } catch (error) {
    console.error('[UpdateCashOutflow]', error);
    return res.status(500).json({
      success : false,
      msg     : 'Failed to update cash outflow.',
      error   : error.message,
    });
  }
};


// ───────────────────────────────────────────────────────────────
//  5. DELETE (soft) — mark record as deleted
// ───────────────────────────────────────────────────────────────

const DeleteCashOutflow = async (req, res) => {
  try {
    const institute = getInstitute(req);
    const { ID }    = req.params;

    if (!institute) {
      return res.status(401).json({ success: false, msg: 'Invalid session.' });
    }
    if (!ID) {
      return res.status(400).json({ success: false, msg: 'ID not provided.' });
    }

    // ── Verify record before deleting ──
    const checkQuery = `
      SELECT co_id, co_number, co_category, co_amount, co_date
      FROM eduall_cash_outflow
      WHERE co_id = ? AND co_institute_code = ? AND co_deleted = 0
      LIMIT 1
    `;
    const existing = await ExecuteQuery(res, checkQuery, [ID, institute], true, {
      db   : 'eduall_cash_outflow',
      type : 'select',
      data : req,
    });

    if (!existing || existing.length === 0) {
      return res.status(404).json({ success: false, msg: 'Record not found or already deleted.' });
    }

    // ── Soft delete ──
    const deleteQuery = `
      UPDATE eduall_cash_outflow
      SET co_deleted = 1, co_updated_at = NOW()
      WHERE co_id = ? AND co_institute_code = ?
    `;
    await ExecuteQuery(res, deleteQuery, [ID, institute], false, {
      db   : 'eduall_cash_outflow',
      type : 'update',
      data : req,
    });

    // ── Audit log ──
    const rec  = existing[0];
    const num  = String(rec.co_number || 0).padStart(6, '0');
    const year = rec.co_date ? new Date(rec.co_date).getFullYear() : new Date().getFullYear();

    await RegisterAuditAction({
      session     : req.session,
      action      : 3,                             // 3 = delete
      form        : 'Cash Outflows',
      description : `Deleted cash outflow No. ${num}/${year} — ${rec.co_category} — ${Number(rec.co_amount).toFixed(2)} AOA`,
    });

    return res.status(200).json({ success: true, msg: 'Cash outflow deleted successfully.' });

  } catch (error) {
    console.error('[DeleteCashOutflow]', error);
    return res.status(500).json({
      success : false,
      msg     : 'Failed to delete cash outflow.',
      error   : error.message,
    });
  }
};


// ───────────────────────────────────────────────────────────────
//  6. GET REPORT — filter by period, category, operator
//     Query params: dateStart, dateEnd, category, operator
// ───────────────────────────────────────────────────────────────

const GetCashOutflowReport = async (req, res) => {
  try {
    const institute = getInstitute(req);

    if (!institute) {
      return res.status(401).json({ success: false, msg: 'Invalid session.' });
    }

    const { dateStart, dateEnd, category, operator } = req.query;

    // ── Dynamic query builder ──
    let query = `
      SELECT *
      FROM eduall_cash_outflow
      WHERE co_deleted = 0
        AND co_institute_code = ?
    `;
    const params = [institute];

    if (dateStart) {
      query += ` AND co_date >= ?`;
      params.push(`${dateStart} 00:00:00`);
    }
    if (dateEnd) {
      query += ` AND co_date <= ?`;
      params.push(`${dateEnd} 23:59:59`);
    }
    if (category && category !== 'all') {
      query += ` AND co_category = ?`;
      params.push(category);
    }
    if (operator && operator !== 'all') {
      query += ` AND co_operator = ?`;
      params.push(operator);
    }

    query += ` ORDER BY co_date DESC, co_id DESC`;

    const rows = await ExecuteQuery(res, query, params, true, {
      db   : 'eduall_cash_outflow',
      type : 'select',
      data : req,
    });

    // ── Aggregates for the report ──
    const totalAmount = rows.reduce((s, r) => s + (Number(r.co_amount) || 0), 0);

    const categoryMap = {};
    rows.forEach(r => {
      const k = r.co_category || 'Other';
      categoryMap[k] = (categoryMap[k] || 0) + (Number(r.co_amount) || 0);
    });

    const operatorMap = {};
    rows.forEach(r => {
      const k = r.co_operator || 'Unknown';
      operatorMap[k] = (operatorMap[k] || 0) + (Number(r.co_amount) || 0);
    });

    return res.status(200).json({
      success     : true,
      count       : rows.length,
      totalAmount,
      categoryMap,
      operatorMap,
      rows,
    });

  } catch (error) {
    console.error('[GetCashOutflowReport]', error);
    return res.status(500).json({
      success : false,
      msg     : 'Failed to generate report.',
      error   : error.message,
    });
  }
};


// ───────────────────────────────────────────────────────────────
//  Exports
// ───────────────────────────────────────────────────────────────

module.exports = {
  GetAllCashOutflows,
  GetSingleCashOutflow,
  RegisterCashOutflow,
  UpdateCashOutflow,
  DeleteCashOutflow,
  GetCashOutflowReport,
};


// ═══════════════════════════════════════════════════════════════
//  DDL — MySQL Table: eduall_cash_outflow
//
//  Run this script ONCE to create the table in the database.
//
/*

CREATE TABLE IF NOT EXISTS `eduall_cash_outflow` (
  `co_id`               INT(11)        NOT NULL AUTO_INCREMENT,
  `co_number`           INT(11)        NOT NULL DEFAULT 1
                          COMMENT 'Sequential number per institute per year (e.g. 006285)',
  `co_category`         VARCHAR(100)   NOT NULL
                          COMMENT 'Expense category (e.g. Travel/Taxi, Fuel, Salaries...)',
  `co_description`      TEXT           NOT NULL
                          COMMENT 'Detailed description of the expense',
  `co_amount`           DECIMAL(15,2)  NOT NULL DEFAULT 0.00
                          COMMENT 'Outflow amount in AOA',
  `co_bank`             VARCHAR(100)   DEFAULT '-- (Cash)'
                          COMMENT 'Bank or payment method used',
  `co_date`             DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP
                          COMMENT 'Date and time of the cash outflow',
  `co_beneficiary`      VARCHAR(200)   NOT NULL
                          COMMENT 'Beneficiary name (e.g. Administrative Sector)',
  `co_beneficiary_id`   VARCHAR(100)   DEFAULT NULL
                          COMMENT 'Beneficiary identification (e.g. CEPMS, ID card number...)',
  `co_operator`         VARCHAR(150)   NOT NULL
                          COMMENT 'Operator responsible (e.g. AUX CASHIER (7))',
  `co_institute_code`   VARCHAR(100)   NOT NULL
                          COMMENT 'Institute code for multi-tenant isolation',
  `co_deleted`          TINYINT(1)     NOT NULL DEFAULT 0
                          COMMENT 'Soft delete flag: 0 = active, 1 = deleted',
  `co_created_at`       DATETIME       DEFAULT CURRENT_TIMESTAMP,
  `co_updated_at`       DATETIME       DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`co_id`),
  KEY `idx_co_institute`  (`co_institute_code`),
  KEY `idx_co_date`       (`co_date`),
  KEY `idx_co_deleted`    (`co_deleted`),
  KEY `idx_co_category`   (`co_category`),
  KEY `idx_co_number`     (`co_number`, `co_institute_code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Cash outflow records per institute — Eduall Software';

*/
// ═══════════════════════════════════════════════════════════════


// ═══════════════════════════════════════════════════════════════
//  ROUTES — CashOutflowRoutes.js
//
//  Copy the content below into your routes file and import it
//  in app.js / server.js:
//     const cashOutflowRoutes = require('./routes/CashOutflowRoutes');
//     app.use('/', cashOutflowRoutes);
//
/*

const express = require('express');
const router  = express.Router();
const {
  GetAllCashOutflows,
  GetSingleCashOutflow,
  RegisterCashOutflow,
  UpdateCashOutflow,
  DeleteCashOutflow,
  GetCashOutflowReport,
} = require('../controllers/CashOutflowController');

// Authentication middleware (adapt to your project's pattern)
const AuthMiddleware = require('../Middleware/AuthMiddleware');

router.get   ('/eduallcashoutflowlist/get/',              AuthMiddleware, GetAllCashOutflows);
router.get   ('/eduallcashoutflowsingle/get/:ID',         AuthMiddleware, GetSingleCashOutflow);
router.post  ('/eduallcashoutflowregister/post/',         AuthMiddleware, RegisterCashOutflow);
router.put   ('/eduallcashoutflowupdate/put/:ID',         AuthMiddleware, UpdateCashOutflow);
router.delete('/eduallcashoutflowdelete/delete/:ID',      AuthMiddleware, DeleteCashOutflow);
router.get   ('/eduallcashoutflowreport/get/',            AuthMiddleware, GetCashOutflowReport);

module.exports = router;

*/
// ═══════════════════════════════════════════════════════════════