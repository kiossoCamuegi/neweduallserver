 
const ExecuteQuery = require("../Functions/ExecuteQuery");
const { RegisterAuditAction } = require("./Auditory");// controllers/studentBalance.controller.js
// Requer: ExecuteQuery, RegisterAuditAction (padrão do projecto)

// ─── SQL de criação das tabelas (executar uma vez na migração) ────────────────
/*
CREATE TABLE IF NOT EXISTS eduall_student_balance (
  sb_id              BIGINT AUTO_INCREMENT PRIMARY KEY,
  sb_student_id      BIGINT          NOT NULL,
  sb_institute_code  VARCHAR(50)     NOT NULL,
  sb_balance         DECIMAL(15,2)   NOT NULL DEFAULT 0.00,
  sb_currency        VARCHAR(10)     NOT NULL DEFAULT 'AOA',
  sb_updated_at      DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_student (sb_student_id, sb_institute_code),
  KEY idx_institute  (sb_institute_code)
);

CREATE TABLE IF NOT EXISTS eduall_student_balance_logs (
  sb_log_id          BIGINT AUTO_INCREMENT PRIMARY KEY,
  sb_log_student_id  BIGINT          NOT NULL,
  sb_log_institute   VARCHAR(50)     NOT NULL,
  sb_log_type        ENUM('deposit','deduct') NOT NULL,
  sb_log_category    VARCHAR(50)     NOT NULL DEFAULT 'outro',
  sb_log_amount      DECIMAL(15,2)   NOT NULL,
  sb_log_balance_before DECIMAL(15,2) NOT NULL,
  sb_log_balance_after  DECIMAL(15,2) NOT NULL,
  sb_log_description VARCHAR(255)    DEFAULT NULL,
  sb_log_reference   VARCHAR(100)    DEFAULT NULL,
  sb_log_user_id     BIGINT          DEFAULT NULL,
  sb_log_date        DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_student    (sb_log_student_id),
  KEY idx_institute  (sb_log_institute),
  KEY idx_date       (sb_log_date)
);
*/

const VALID_CATEGORIES = ['propinas', 'servico', 'transporte', 'multa', 'deposito', 'outro'];

// ─── Helper: garante linha de saldo (upsert) ──────────────────────────────────
const ensureBalanceRow = async (res, studentId, instituteCode, currency = 'AOA') => {
  await ExecuteQuery(
    res,
    `INSERT INTO eduall_student_balance (sb_student_id, sb_institute_code, sb_currency, sb_balance)
     VALUES (?, ?, ?, 0.00)
     ON DUPLICATE KEY UPDATE sb_id = sb_id`,
    [studentId, instituteCode, currency],
    false
  );
};

// ─── GET /studentbalance/:studentId ──────────────────────────────────────────
const GetStudentBalance = async (req, res) => {
  try {
    const { studentId } = req.params;
    const instituteCode = req.session.user.eduall_user_session_curentinstitute;

    const rows = await ExecuteQuery(
      res,
      `SELECT
         s.ed_student_id, s.ed_student_name, s.ed_student_code,
         s.ed_student_phone, s.ed_student_email,
         c.ed_class_title AS ed_student_class_name,
         COALESCE(b.sb_balance, 0.00)   AS sb_balance,
         COALESCE(b.sb_currency, 'AOA') AS sb_currency,
         b.sb_updated_at
       FROM eduall_students s
       LEFT JOIN eduall_student_balance b
              ON b.sb_student_id = s.ed_student_id
             AND b.sb_institute_code = s.ed_student_institute_code
       LEFT JOIN eduall_class c ON c.ed_class_id = s.ed_student_class
       WHERE s.ed_student_id = ?
         AND s.ed_student_institute_code = ?
         AND s.ed_student_deleted = 0
       LIMIT 1`,
      [studentId, instituteCode],
      true
    );

    if (!rows.length) {
      return res.status(404).json({ success: false, msg: 'Aluno não encontrado.' });
    }

    const { sb_balance, sb_currency, sb_updated_at, ...student } = rows[0];
    return res.json({ success: true, student, sb_balance, sb_currency, sb_updated_at });

  } catch (err) {
    console.error('GetStudentBalance:', err);
    return res.status(500).json({ success: false, msg: err.message });
  }
};

// ─── GET /studentbalance/search?q=... ────────────────────────────────────────
const SearchStudentsBalance = async (req, res) => {
  try {
    const q             = (req.query.q || '').trim();
    const instituteCode = req.session.user.eduall_user_session_curentinstitute;

    if (!q || q.length < 2) return res.json([]);

    const like = `%${q}%`;
    const rows = await ExecuteQuery(
      res,
      `SELECT
         s.ed_student_id, s.ed_student_name, s.ed_student_code,
         s.ed_student_phone, s.ed_student_picture,
         c.ed_class_name AS ed_student_class_name,
         COALESCE(b.sb_balance, 0.00)   AS sb_balance,
         COALESCE(b.sb_currency, 'AOA') AS sb_currency
       FROM eduall_students s
       LEFT JOIN eduall_student_balance b
              ON b.sb_student_id = s.ed_student_id
             AND b.sb_institute_code = s.ed_student_institute_code
       LEFT JOIN eduall_class c ON c.ed_class_id = s.ed_student_class
       WHERE s.ed_student_institute_code = ?
         AND s.ed_student_deleted = 0
         AND (s.ed_student_name LIKE ? OR s.ed_student_code LIKE ?)
       ORDER BY s.ed_student_name
       LIMIT 20`,
      [instituteCode, like, like],
      true
    );

    return res.json(rows);

  } catch (err) {
    console.error('SearchStudentsBalance:', err);
    return res.status(500).json({ success: false, msg: err.message });
  }
};

// ─── GET /studentbalance/logs/:studentId ─────────────────────────────────────
const GetStudentBalanceLogs = async (req, res) => {
  try {
    const { studentId } = req.params;
    const instituteCode = req.session.user.eduall_user_session_curentinstitute;
    const limit         = Math.min(parseInt(req.query.limit) || 50, 200);
    const offset        = parseInt(req.query.offset) || 0;

    const logs = await ExecuteQuery(
      res,
      `SELECT
         l.sb_log_id, l.sb_log_type, l.sb_log_category,
         l.sb_log_amount, l.sb_log_balance_before, l.sb_log_balance_after,
         l.sb_log_description, l.sb_log_reference, l.sb_log_date
       FROM eduall_student_balance_logs l
       WHERE l.sb_log_student_id = ?
         AND l.sb_log_institute   = ?
       ORDER BY l.sb_log_date DESC
       LIMIT ? OFFSET ?`,
      [studentId, instituteCode, limit, offset],
      true
    );

    return res.json(logs);

  } catch (err) {
    console.error('GetStudentBalanceLogs:', err);
    return res.status(500).json({ success: false, msg: err.message });
  }
};

// ─── POST /studentbalance/deposit ────────────────────────────────────────────
const DepositStudentBalance = async (req, res) => {
  try {
    const { student_id, amount, description, reference, currency = 'AOA' } = req.body;
    const instituteCode = req.session.user.eduall_user_session_curentinstitute;
    const userId        = req.session.user.eduall_user_session_id;

    // Validações
    const amt = parseFloat(amount);
    if (!student_id)     return res.status(400).json({ success: false, msg: 'ID do aluno obrigatório.' });
    if (!amt || amt <= 0) return res.status(400).json({ success: false, msg: 'Valor inválido.' });
    if (amt > 9_999_999) return res.status(400).json({ success: false, msg: 'Valor demasiado elevado.' });

    // Verificar aluno
    const student = await ExecuteQuery(res,
      `SELECT ed_student_id, ed_student_name, ed_student_code FROM eduall_students
       WHERE ed_student_id = ? AND ed_student_institute_code = ? AND ed_student_deleted = 0 LIMIT 1`,
      [student_id, instituteCode], true);
    if (!student.length) return res.status(404).json({ success: false, msg: 'Aluno não encontrado.' });

    await ensureBalanceRow(res, student_id, instituteCode, currency);

    // Lock + leitura do saldo actual
    const [current] = await ExecuteQuery(res,
      `SELECT sb_balance FROM eduall_student_balance
       WHERE sb_student_id = ? AND sb_institute_code = ? FOR UPDATE`,
      [student_id, instituteCode], true);

    const balanceBefore = parseFloat(current?.sb_balance ?? 0);
    const balanceAfter  = balanceBefore + amt;

    // UPDATE saldo
    await ExecuteQuery(res,
      `UPDATE eduall_student_balance SET sb_balance = ?
       WHERE sb_student_id = ? AND sb_institute_code = ?`,
      [balanceAfter, student_id, instituteCode], false);

    // Registo no log
    await ExecuteQuery(res,
      `INSERT INTO eduall_student_balance_logs
         (sb_log_student_id, sb_log_institute, sb_log_type, sb_log_category,
          sb_log_amount, sb_log_balance_before, sb_log_balance_after,
          sb_log_description, sb_log_reference, sb_log_user_id)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
      [student_id, instituteCode, 'deposit', 'deposito',
       amt, balanceBefore, balanceAfter,
       description || null, reference || null, userId || null],
      false);

    await RegisterAuditAction({
      session: req.session, action: 1, form: 'Saldo de Aluno',
      description: `Depósito de ${amt} ${currency} no aluno ${student[0].ed_student_name} (#${student[0].ed_student_code})`
    });

    return res.status(200).json({
      success: true,
      msg:            'Depósito efectuado com sucesso.',
      balance_before: balanceBefore,
      balance_after:  balanceAfter,
      amount:         amt,
      currency,
    });

  } catch (err) {
    console.error('DepositStudentBalance:', err);
    return res.status(500).json({ success: false, msg: err.message });
  }
};

// ─── POST /studentbalance/deduct ─────────────────────────────────────────────
const DeductStudentBalance = async (req, res) => {
  try {
    const { student_id, amount, category = 'outro', description, reference } = req.body;
    const instituteCode = req.session.user.eduall_user_session_curentinstitute;
    const userId        = req.session.user.eduall_user_session_id;

    // Validações
    const amt = parseFloat(amount);
    if (!student_id)      return res.status(400).json({ success: false, msg: 'ID do aluno obrigatório.' });
    if (!amt || amt <= 0) return res.status(400).json({ success: false, msg: 'Valor inválido.' });
    if (!VALID_CATEGORIES.includes(category))
      return res.status(400).json({ success: false, msg: 'Categoria inválida.' });

    // Verificar aluno
    const student = await ExecuteQuery(res,
      `SELECT ed_student_id, ed_student_name, ed_student_code FROM eduall_students
       WHERE ed_student_id = ? AND ed_student_institute_code = ? AND ed_student_deleted = 0 LIMIT 1`,
      [student_id, instituteCode], true);
    if (!student.length) return res.status(404).json({ success: false, msg: 'Aluno não encontrado.' });

    await ensureBalanceRow(res, student_id, instituteCode);

    // Lock + leitura
    const [current] = await ExecuteQuery(res,
      `SELECT sb_balance, sb_currency FROM eduall_student_balance
       WHERE sb_student_id = ? AND sb_institute_code = ? FOR UPDATE`,
      [student_id, instituteCode], true);

    const balanceBefore = parseFloat(current?.sb_balance ?? 0);
    const currency      = current?.sb_currency || 'AOA';

    if (amt > balanceBefore) {
      return res.status(422).json({
        success: false,
        msg: `Saldo insuficiente. Saldo actual: ${balanceBefore} ${currency}.`,
        balance: balanceBefore,
      });
    }

    const balanceAfter = balanceBefore - amt;

    // UPDATE saldo
    await ExecuteQuery(res,
      `UPDATE eduall_student_balance SET sb_balance = ?
       WHERE sb_student_id = ? AND sb_institute_code = ?`,
      [balanceAfter, student_id, instituteCode], false);

    // Log
    await ExecuteQuery(res,
      `INSERT INTO eduall_student_balance_logs
         (sb_log_student_id, sb_log_institute, sb_log_type, sb_log_category,
          sb_log_amount, sb_log_balance_before, sb_log_balance_after,
          sb_log_description, sb_log_reference, sb_log_user_id)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
      [student_id, instituteCode, 'deduct', category,
       amt, balanceBefore, balanceAfter,
       description || null, reference || null, userId || null],
      false);

    await RegisterAuditAction({
      session: req.session, action: 2, form: 'Saldo de Aluno',
      description: `Desconto de ${amt} ${currency} (${category}) no aluno ${student[0].ed_student_name} (#${student[0].ed_student_code})`
    });

    return res.status(200).json({
      success: true,
      msg:            'Desconto efectuado com sucesso.',
      balance_before: balanceBefore,
      balance_after:  balanceAfter,
      amount:         amt,
      category,
      currency,
    });

  } catch (err) {
    console.error('DeductStudentBalance:', err);
    return res.status(500).json({ success: false, msg: err.message });
  }
};

// ─── Exportações ──────────────────────────────────────────────────────────────
module.exports = {
  GetStudentBalance,
  SearchStudentsBalance,
  GetStudentBalanceLogs,
  DepositStudentBalance,
  DeductStudentBalance,
};

 