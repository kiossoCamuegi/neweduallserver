const ExecuteQuery = require("../Functions/ExecuteQuery");
const { RegisterAuditAction } = require("./Auditory");

const VALID_CATEGORIES = ['propinas', 'servico', 'transporte', 'multa', 'deposito', 'outro'];

const ensureBalanceRow = async (res, studentId, instituteCode, currency = 'AOA') => {
  try {
    await ExecuteQuery(
      res,
      `INSERT INTO eduall_student_balance (sb_student_id, sb_institute_code, sb_currency, sb_balance)
       VALUES (?, ?, ?, 0.00)
       ON DUPLICATE KEY UPDATE sb_id = sb_id`,
      [studentId, instituteCode, currency],
      false
    );
  } catch (err) {
    console.error('ensureBalanceRow error:', err);
  }
};

const ensureBalanceRowPerUser = async (res, studentId, instituteCode) => {
  try {
    const existing = await ExecuteQuery(
      res,
      `SELECT sb_id FROM eduall_student_balance 
       WHERE sb_student_id = ? AND sb_institute_code = ? LIMIT 1`,
      [studentId, instituteCode],
      true
    );

    if (!existing || existing.length === 0) {
      await ExecuteQuery(
        res,
        `INSERT INTO eduall_student_balance 
         (sb_student_id, sb_institute_code, sb_currency, sb_balance, sb_updated_at)
         VALUES (?, ?, 'AOA', 0.00, NOW())`,
        [studentId, instituteCode],
        false
      );
    }
  } catch (err) {
    console.error('ensureBalanceRowPerUser error:', err);
    throw err;
  }
};

const recalculateBalance = async (res, studentId, instituteCode) => {
  const logs = await ExecuteQuery(
    res,
    `SELECT 
       SUM(CASE WHEN sb_log_type = 'deposit' THEN sb_log_amount ELSE -sb_log_amount END) as total
     FROM eduall_student_balance_logs
     WHERE sb_log_student_id = ? AND sb_log_institute = ?`,
    [studentId, instituteCode],
    true
  );

  const newBalance = parseFloat(logs[0]?.total || 0);

  await ExecuteQuery(
    res,
    `UPDATE eduall_student_balance SET sb_balance = ? 
     WHERE sb_student_id = ? AND sb_institute_code = ?`,
    [newBalance, studentId, instituteCode],
    false
  );

  return newBalance;
};

const GetStudentBalance = async (req, res) => {
  try {
    const { studentId } = req.params;

    if (!req.session?.user?.eduall_user_session_curentinstitute) {
      return res.status(401).json({ success: false, msg: 'Sessão inválida.' });
    }

    const instituteCode = req.session.user.eduall_user_session_curentinstitute;

    console.log(`[GetStudentBalance] studentId=${studentId}, institute=${instituteCode}`);

    await ensureBalanceRowPerUser(res, studentId, instituteCode);

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
             AND b.sb_institute_code COLLATE utf8mb4_unicode_ci = s.ed_student_institute_code COLLATE utf8mb4_unicode_ci
       LEFT JOIN eduall_class c ON c.ed_class_id = s.ed_student_class
       WHERE s.ed_student_id = ?
         AND s.ed_student_institute_code = ?
         AND s.ed_student_deleted = 0
       LIMIT 1`,
      [studentId, instituteCode],
      true
    );

    if (!rows || !rows.length) {
      return res.status(404).json({ success: false, msg: 'Aluno não encontrado.' });
    }

    const { sb_balance, sb_currency, sb_updated_at, ...student } = rows[0];

    return res.json({
      success: true,
      student,
      sb_balance,
      sb_currency,
      sb_updated_at
    });

  } catch (err) {
    console.error('GetStudentBalance:', err);
    return res.status(500).json({ success: false, msg: err.message });
  }
};

const GetStudentBalanceLogs = async (req, res) => {
  try {
    const { studentId } = req.params;

    if (!req.session?.user?.eduall_user_session_curentinstitute) {
      return res.status(401).json({ success: false, msg: 'Sessão inválida.' });
    }

    const instituteCode = req.session.user.eduall_user_session_curentinstitute;
    const limit = Math.min(parseInt(req.query.limit) || 50, 200);
    const offset = parseInt(req.query.offset) || 0;

    const logs = await ExecuteQuery(
      res,
      `SELECT
         l.sb_log_id, l.sb_log_type, l.sb_log_category,
         l.sb_log_amount, l.sb_log_balance_before, l.sb_log_balance_after,
         l.sb_log_description, l.sb_log_reference, l.sb_log_date
       FROM eduall_student_balance_logs l
       WHERE l.sb_log_student_id = ?
         AND l.sb_log_institute = ?
       ORDER BY l.sb_log_date DESC
       LIMIT ? OFFSET ?`,
      [studentId, instituteCode, limit, offset],
      true
    );

    return res.json(logs || []);

  } catch (err) {
    console.error('GetStudentBalanceLogs:', err);
    return res.status(500).json({ success: false, msg: err.message });
  }
};

const SearchStudentsBalance = async (req, res) => {
  try {
    const q = (req.query.q || '').trim();

    if (!req.session?.user?.eduall_user_session_curentinstitute) {
      return res.status(401).json({ success: false, msg: 'Sessão inválida.' });
    }

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
             AND b.sb_institute_code COLLATE utf8mb4_unicode_ci = s.ed_student_institute_code COLLATE utf8mb4_unicode_ci
       LEFT JOIN eduall_class c ON c.ed_class_id = s.ed_student_class
       WHERE s.ed_student_institute_code = ?
         AND s.ed_student_deleted = 0
         AND (s.ed_student_name LIKE ? OR s.ed_student_code LIKE ?)
       ORDER BY s.ed_student_name
       LIMIT 20`,
      [instituteCode, like, like],
      true
    );

    return res.json(rows || []);

  } catch (err) {
    console.error('SearchStudentsBalance:', err);
    return res.status(500).json({ success: false, msg: err.message });
  }
};

const DepositStudentBalance = async (req, res) => {
  try {
    const { student_id, amount, description, reference, currency = 'AOA' } = req.body;

    if (!req.session?.user?.eduall_user_session_curentinstitute) {
      return res.status(401).json({ success: false, msg: 'Sessão inválida.' });
    }

    const instituteCode = req.session.user.eduall_user_session_curentinstitute;
    const userId = req.session.user?.eduall_user_session_id;

    const amt = parseFloat(amount);
    if (!student_id) return res.status(400).json({ success: false, msg: 'ID do aluno obrigatório.' });
    if (!amt || amt <= 0) return res.status(400).json({ success: false, msg: 'Valor inválido.' });
    if (amt > 9_999_999) return res.status(400).json({ success: false, msg: 'Valor demasiado elevado.' });

    const student = await ExecuteQuery(
      res,
      `SELECT ed_student_id, ed_student_name, ed_student_code 
       FROM eduall_students
       WHERE ed_student_id = ? AND ed_student_institute_code = ? AND ed_student_deleted = 0 
       LIMIT 1`,
      [student_id, instituteCode],
      true
    );

    if (!student || !student.length) {
      return res.status(404).json({ success: false, msg: 'Aluno não encontrado.' });
    }

    await ensureBalanceRow(res, student_id, instituteCode, currency);

    const current = await ExecuteQuery(
      res,
      `SELECT sb_balance FROM eduall_student_balance
       WHERE sb_student_id = ? AND sb_institute_code = ?
       LIMIT 1`,
      [student_id, instituteCode],
      true
    );

    const balanceBefore = parseFloat(current?.[0]?.sb_balance ?? 0);
    const balanceAfter = balanceBefore + amt;

    await ExecuteQuery(
      res,
      `UPDATE eduall_student_balance SET sb_balance = ?, sb_updated_at = NOW()
       WHERE sb_student_id = ? AND sb_institute_code = ?`,
      [balanceAfter, student_id, instituteCode],
      false
    );

    await ExecuteQuery(
      res,
      `INSERT INTO eduall_student_balance_logs
         (sb_log_student_id, sb_log_institute, sb_log_type, sb_log_category,
          sb_log_amount, sb_log_balance_before, sb_log_balance_after,
          sb_log_description, sb_log_reference, sb_log_user_id, sb_log_date)
       VALUES (?,?,?,?,?,?,?,?,?,?,NOW())`,
      [
        student_id, instituteCode, 'deposit', 'deposito',
        amt, balanceBefore, balanceAfter,
        description || null, reference || null, userId || null
      ],
      false
    );

    if (RegisterAuditAction) {
      await RegisterAuditAction({
        session: req.session,
        action: 1,
        form: 'Saldo de Aluno',
        description: `Depósito de ${amt} ${currency} no aluno ${student[0].ed_student_name} (#${student[0].ed_student_code})`
      });
    }

    return res.status(200).json({
      success: true,
      msg: 'Depósito efectuado com sucesso.',
      balance_before: balanceBefore,
      balance_after: balanceAfter,
      amount: amt,
      currency
    });

  } catch (err) {
    console.error('DepositStudentBalance:', err);
    return res.status(500).json({ success: false, msg: err.message });
  }
};

const DeductStudentBalance = async (req, res) => {
  try {
    const { student_id, amount, category = 'outro', description, reference } = req.body;

    if (!req.session?.user?.eduall_user_session_curentinstitute) {
      return res.status(401).json({ success: false, msg: 'Sessão inválida.' });
    }

    const instituteCode = req.session.user.eduall_user_session_curentinstitute;
    const userId = req.session.user?.eduall_user_session_id;

    const amt = parseFloat(amount);
    if (!student_id) return res.status(400).json({ success: false, msg: 'ID do aluno obrigatório.' });
    if (!amt || amt <= 0) return res.status(400).json({ success: false, msg: 'Valor inválido.' });
    if (!VALID_CATEGORIES.includes(category)) {
      return res.status(400).json({ success: false, msg: 'Categoria inválida.' });
    }

    const student = await ExecuteQuery(
      res,
      `SELECT ed_student_id, ed_student_name, ed_student_code 
       FROM eduall_students
       WHERE ed_student_id = ? AND ed_student_institute_code = ? AND ed_student_deleted = 0 
       LIMIT 1`,
      [student_id, instituteCode],
      true
    );

    if (!student || !student.length) {
      return res.status(404).json({ success: false, msg: 'Aluno não encontrado.' });
    }

    await ensureBalanceRow(res, student_id, instituteCode);

    const current = await ExecuteQuery(
      res,
      `SELECT sb_balance, sb_currency FROM eduall_student_balance
       WHERE sb_student_id = ? AND sb_institute_code = ?
       LIMIT 1`,
      [student_id, instituteCode],
      true
    );

    const balanceBefore = parseFloat(current?.[0]?.sb_balance ?? 0);
    const currency = current?.[0]?.sb_currency || 'AOA';

    if (amt > balanceBefore) {
      return res.status(422).json({
        success: false,
        msg: `Saldo insuficiente. Saldo actual: ${balanceBefore} ${currency}.`,
        balance: balanceBefore
      });
    }

    const balanceAfter = balanceBefore - amt;

    await ExecuteQuery(
      res,
      `UPDATE eduall_student_balance SET sb_balance = ?, sb_updated_at = NOW()
       WHERE sb_student_id = ? AND sb_institute_code = ?`,
      [balanceAfter, student_id, instituteCode],
      false
    );

    await ExecuteQuery(
      res,
      `INSERT INTO eduall_student_balance_logs
         (sb_log_student_id, sb_log_institute, sb_log_type, sb_log_category,
          sb_log_amount, sb_log_balance_before, sb_log_balance_after,
          sb_log_description, sb_log_reference, sb_log_user_id, sb_log_date)
       VALUES (?,?,?,?,?,?,?,?,?,?,NOW())`,
      [
        student_id, instituteCode, 'deduct', category,
        amt, balanceBefore, balanceAfter,
        description || null, reference || null, userId || null
      ],
      false
    );

    if (RegisterAuditAction) {
      await RegisterAuditAction({
        session: req.session,
        action: 2,
        form: 'Saldo de Aluno',
        description: `Desconto de ${amt} ${currency} (${category}) no aluno ${student[0].ed_student_name} (#${student[0].ed_student_code})`
      });
    }

    return res.status(200).json({
      success: true,
      msg: 'Desconto efectuado com sucesso.',
      balance_before: balanceBefore,
      balance_after: balanceAfter,
      amount: amt,
      category,
      currency
    });

  } catch (err) {
    console.error('DeductStudentBalance:', err);
    return res.status(500).json({ success: false, msg: err.message });
  }
};

const UpdateBalanceLog = async (req, res) => {
  try {
    const { logId } = req.params;
    const { amount, description } = req.body;

    if (!req.session?.user?.eduall_user_session_curentinstitute) {
      return res.status(401).json({ success: false, msg: 'Sessão inválida.' });
    }

    const instituteCode = req.session.user.eduall_user_session_curentinstitute;

    const newAmount = parseFloat(amount);
    if (!newAmount || newAmount <= 0) {
      return res.status(400).json({ success: false, msg: 'Valor inválido.' });
    }

    const log = await ExecuteQuery(
      res,
      `SELECT sb_log_id, sb_log_student_id, sb_log_amount, sb_log_type 
       FROM eduall_student_balance_logs
       WHERE sb_log_id = ? AND sb_log_institute = ?
       LIMIT 1`,
      [logId, instituteCode],
      true
    );

    if (!log || !log.length) {
      return res.status(404).json({ success: false, msg: 'Transação não encontrada.' });
    }

    const studentId = log[0].sb_log_student_id;
    const oldAmount = log[0].sb_log_amount;

    await ExecuteQuery(
      res,
      `UPDATE eduall_student_balance_logs 
       SET sb_log_amount = ?, sb_log_description = ?
       WHERE sb_log_id = ? AND sb_log_institute = ?`,
      [newAmount, description || null, logId, instituteCode],
      false
    );

    const newBalance = await recalculateBalance(res, studentId, instituteCode);

    if (RegisterAuditAction) {
      await RegisterAuditAction({
        session: req.session,
        action: 3,
        form: 'Saldo de Aluno',
        description: `Editou transação #${logId}: ${oldAmount} → ${newAmount}`
      });
    }

    return res.json({
      success: true,
      msg: 'Transação atualizada com sucesso.',
      new_balance: newBalance,
      old_amount: oldAmount,
      new_amount: newAmount
    });

  } catch (err) {
    console.error('UpdateBalanceLog:', err);
    return res.status(500).json({ success: false, msg: err.message });
  }
};

const DeleteBalanceLog = async (req, res) => {
  try {
    const { logId } = req.params;

    if (!req.session?.user?.eduall_user_session_curentinstitute) {
      return res.status(401).json({ success: false, msg: 'Sessão inválida.' });
    }

    const instituteCode = req.session.user.eduall_user_session_curentinstitute;

    const log = await ExecuteQuery(
      res,
      `SELECT sb_log_id, sb_log_student_id, sb_log_amount, sb_log_type, sb_log_description
       FROM eduall_student_balance_logs
       WHERE sb_log_id = ? AND sb_log_institute = ?
       LIMIT 1`,
      [logId, instituteCode],
      true
    );

    if (!log || !log.length) {
      return res.status(404).json({ success: false, msg: 'Transação não encontrada.' });
    }

    const studentId = log[0].sb_log_student_id;

    await ExecuteQuery(
      res,
      `DELETE FROM eduall_student_balance_logs
       WHERE sb_log_id = ? AND sb_log_institute = ?`,
      [logId, instituteCode],
      false
    );

    const newBalance = await recalculateBalance(res, studentId, instituteCode);

    if (RegisterAuditAction) {
      await RegisterAuditAction({
        session: req.session,
        action: 4,
        form: 'Saldo de Aluno',
        description: `Removeu transação #${logId}: ${log[0].sb_log_type} de ${log[0].sb_log_amount}`
      });
    }

    return res.json({
      success: true,
      msg: 'Transação removida com sucesso.',
      new_balance: newBalance,
      deleted_log: {
        id: logId,
        amount: log[0].sb_log_amount,
        type: log[0].sb_log_type,
        description: log[0].sb_log_description
      }
    });

  } catch (err) {
    console.error('DeleteBalanceLog:', err);
    return res.status(500).json({ success: false, msg: err.message });
  }
};

module.exports = {
  GetStudentBalance,
  SearchStudentsBalance,
  GetStudentBalanceLogs,
  DepositStudentBalance,
  DeductStudentBalance,
  UpdateBalanceLog,
  DeleteBalanceLog
};