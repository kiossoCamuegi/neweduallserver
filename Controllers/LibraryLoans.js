'use strict'; 
const { RegisterAuditAction } = require('./Auditory');
const ExecuteQuery             = require('../Functions/ExecuteQuery');

/* ─────────────────────────────────────────
   HELPERS
───────────────────────────────────────── */
const inst    = req => req.session.user.eduall_user_session_curentinstitute;
const uid     = req => req.session.user.eduall_user_id;

// Dias de prazo por defeito — pode ser lido da tabela de configurações
const DEFAULT_LOAN_DAYS = 15;

function addDays(date, days) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

// ─────────────────────────────────────────────────────────────────────────────
//  GET — Lista de empréstimos (com filtros opcionais)
//  Query params: status, user_id, date_from, date_to, limit, offset
// ─────────────────────────────────────────────────────────────────────────────
const GetLoans = async (req, res) => {
  try {
    const institute = inst(req);
    const {
      status,
      user_id,
      date_from,
      date_to,
      limit  = 100,
      offset = 0,
    } = req.query;

    let where    = `WHERE l.ed_loan_deleted = 0 AND l.ed_loan_institute_code = ?`;
    const PARAMS = [institute];

    if (status)    { where += ' AND l.ed_loan_status = ?';                   PARAMS.push(status);    }
    if (user_id)   { where += ' AND l.ed_loan_user_id = ?';                  PARAMS.push(user_id);   }
    if (date_from) { where += ' AND l.ed_loan_date >= ?';                    PARAMS.push(date_from); }
    if (date_to)   { where += ' AND l.ed_loan_date <= ?';                    PARAMS.push(`${date_to} 23:59:59`); }

    PARAMS.push(Number(limit), Number(offset));

    const query = `
      SELECT
        l.*,
        /* utilizador */
        u.ed_user_account_name                              AS ed_loan_user_name,
        u.ed_user_account_picture                          AS ed_loan_user_picture,
        u.ed_user_account_charge                           AS ed_loan_user_charge,
        /* exemplar */
        ex.ed_exemplar_code,
        ex.ed_exemplar_barcode,
        ex.ed_exemplar_rfid,
        ex.ed_exemplar_status,
        /* livro */
        b.ed_library_book_title,
        b.ed_library_book_picture,
        b.ed_library_book_author,
        /* número de série formatado */
        CONCAT('EMP-', LPAD(l.ed_loan_id, 4, '0'))        AS ed_loan_number
      FROM eduall_library_loans l
      LEFT JOIN eduall_user_accounts u
             ON u.ed_user_account_id = l.ed_loan_user_id
      LEFT JOIN eduall_library_exemplares ex
             ON ex.ed_exemplar_id = l.ed_loan_exemplar_id
      LEFT JOIN eduall_library_books b
             ON b.ed_library_book_id = ex.ed_exemplar_book_id
      ${where}
      ORDER BY l.ed_loan_date DESC
      LIMIT ? OFFSET ?`;

    const rows = await ExecuteQuery(res, query, PARAMS, true, {
      db: 'eduall_library_loans', type: 'select', data: req,
    });
    res.status(200).json(rows);
  } catch (error) {
    res.status(500).json({ success: false, message: 'Falha ao buscar empréstimos!', error: error.message });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
//  GET — KPIs de empréstimos
// ─────────────────────────────────────────────────────────────────────────────
const GetLoansKpis = async (req, res) => {
  try {
    const institute = inst(req);

    const query = `
      SELECT
        COUNT(*)                                                                  AS total,
        SUM(CASE WHEN ed_loan_status = 'em_curso'   THEN 1 ELSE 0 END)           AS em_curso,
        SUM(CASE WHEN ed_loan_status = 'atrasado'   THEN 1 ELSE 0 END)           AS atrasados,
        SUM(CASE WHEN ed_loan_status = 'devolvido'  THEN 1 ELSE 0 END)           AS devolvidos,
        SUM(CASE WHEN ed_loan_status = 'renovado'   THEN 1 ELSE 0 END)           AS renovados,
        SUM(CASE WHEN ed_loan_status IN ('em_curso','atrasado')
                  AND DATE(ed_loan_limit_date) < CURDATE() THEN 1 ELSE 0 END)    AS vencidos_hoje,
        COUNT(DISTINCT ed_loan_user_id)                                           AS utilizadores_distintos
      FROM eduall_library_loans
      WHERE ed_loan_deleted = 0
        AND ed_loan_institute_code = ?`;

    const rows = await ExecuteQuery(res, query, [institute], true, {
      db: 'eduall_library_loans', type: 'select', data: req,
    });

    // Actualiza automaticamente os atrasados vencidos
    await ExecuteQuery(res,
      `UPDATE eduall_library_loans
          SET ed_loan_status = 'atrasado'
        WHERE ed_loan_deleted = 0
          AND ed_loan_status = 'em_curso'
          AND ed_loan_institute_code = ?
          AND DATE(ed_loan_limit_date) < CURDATE()`,
      [institute], false,
      { db: 'eduall_library_loans', type: 'update', data: req });

    res.status(200).json(rows[0] ?? {});
  } catch (error) {
    res.status(500).json({ success: false, message: 'Falha ao buscar KPIs!', error: error.message });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
//  GET — Empréstimos activos de um utilizador
// ─────────────────────────────────────────────────────────────────────────────
const GetActiveLoansByUser = async (req, res) => {
  try {
    const { USER_ID }   = req.params;
    const institute     = inst(req);

    const query = `
      SELECT
        l.*,
        CONCAT('EMP-', LPAD(l.ed_loan_id, 4, '0')) AS ed_loan_number,
        ex.ed_exemplar_code,
        b.ed_library_book_title,
        b.ed_library_book_picture
      FROM eduall_library_loans l
      LEFT JOIN eduall_library_exemplares ex ON ex.ed_exemplar_id = l.ed_loan_exemplar_id
      LEFT JOIN eduall_library_books      b  ON b.ed_library_book_id = ex.ed_exemplar_book_id
      WHERE l.ed_loan_deleted = 0
        AND l.ed_loan_user_id = ?
        AND l.ed_loan_institute_code = ?
        AND l.ed_loan_status IN ('em_curso','atrasado','renovado')
      ORDER BY l.ed_loan_limit_date ASC`;

    const rows = await ExecuteQuery(res, query, [USER_ID, institute], true, {
      db: 'eduall_library_loans', type: 'select', data: req,
    });
    res.status(200).json(rows);
  } catch (error) {
    res.status(500).json({ success: false, message: 'Falha ao buscar empréstimos do utilizador!', error: error.message });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
//  GET — Histórico completo de um utilizador
// ─────────────────────────────────────────────────────────────────────────────
const GetLoanHistoryByUser = async (req, res) => {
  try {
    const { USER_ID } = req.params;
    const institute   = inst(req);

    const query = `
      SELECT
        l.*,
        CONCAT('EMP-', LPAD(l.ed_loan_id, 4, '0')) AS ed_loan_number,
        ex.ed_exemplar_code,
        b.ed_library_book_title,
        b.ed_library_book_picture
      FROM eduall_library_loans l
      LEFT JOIN eduall_library_exemplares ex ON ex.ed_exemplar_id = l.ed_loan_exemplar_id
      LEFT JOIN eduall_library_books      b  ON b.ed_library_book_id = ex.ed_exemplar_book_id
      WHERE l.ed_loan_deleted = 0
        AND l.ed_loan_user_id = ?
        AND l.ed_loan_institute_code = ?
      ORDER BY l.ed_loan_date DESC`;

    const rows = await ExecuteQuery(res, query, [USER_ID, institute], true, {
      db: 'eduall_library_loans', type: 'select', data: req,
    });
    res.status(200).json(rows);
  } catch (error) {
    res.status(500).json({ success: false, message: 'Falha ao buscar histórico!', error: error.message });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
//  GET — Pesquisa de utilizadores da escola
//  Apenas utilizadores registados em eduall_user_accounts com o mesmo
//  ed_user_account_institute_code. Query param: q (nome ou username)
// ─────────────────────────────────────────────────────────────────────────────
const SearchUsersLoans = async (req, res) => {
  try {
    const institute = inst(req);
    const { q = '' } = req.query;
    const search    = `%${q.trim()}%`;

    const query = `
      SELECT
        ed_user_account_id       AS user_id,
        ed_user_account_name     AS user_name,
        ed_user_account_username AS user_username,
        ed_user_account_picture  AS user_picture,
        ed_user_account_charge   AS user_charge,
        ed_user_account_email    AS user_email,
        (
          SELECT COUNT(*) FROM eduall_library_loans
          WHERE ed_loan_user_id = ed_user_account_id
            AND ed_loan_status IN ('em_curso','atrasado','renovado')
            AND ed_loan_deleted = 0
        ) AS active_loans,
        (
          SELECT COUNT(*) FROM eduall_library_fines
          WHERE ed_fine_user_id = ed_user_account_id
            AND ed_fine_paid = 0
            AND ed_fine_deleted = 0
        ) AS pending_fines
      FROM eduall_user_accounts
      WHERE ed_user_account_deleted = 0
        AND ed_user_account_institute_code = ?
        AND (
          ed_user_account_name     LIKE ?
          OR ed_user_account_username LIKE ?
          OR ed_user_account_email    LIKE ?
        )
      ORDER BY ed_user_account_name ASC
      LIMIT 20`;

    const rows = await ExecuteQuery(res, query, [institute, search, search, search], true, {
      db: 'eduall_user_accounts', type: 'select', data: req,
    });
    res.status(200).json(rows);
  } catch (error) {
    res.status(500).json({ success: false, message: 'Falha ao pesquisar utilizadores!', error: error.message });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
//  GET — Pesquisa de exemplares disponíveis
//  Query param: q (código, código de barras, RFID, ou título do livro)
// ─────────────────────────────────────────────────────────────────────────────
const SearchExemplars = async (req, res) => {
  try {
    const institute = inst(req);
    const { q = '' } = req.query;
    const search    = `%${q.trim()}%`;

    const query = `
      SELECT
        ex.ed_exemplar_id,
        ex.ed_exemplar_code,
        ex.ed_exemplar_barcode,
        ex.ed_exemplar_rfid,
        ex.ed_exemplar_status,
        ex.ed_exemplar_rack_id,
        b.ed_library_book_id,
        b.ed_library_book_title,
        b.ed_library_book_picture,
        b.ed_library_book_author,
        b.ed_library_book_year
      FROM eduall_library_exemplares ex
      LEFT JOIN eduall_library_books b ON b.ed_library_book_id = ex.ed_exemplar_book_id
      WHERE ex.ed_exemplar_deleted = 0
        AND ex.ed_exemplar_status = 'disponivel'
        AND ex.ed_exemplar_institute_code = ?
        AND (
          ex.ed_exemplar_code     LIKE ?
          OR ex.ed_exemplar_barcode LIKE ?
          OR ex.ed_exemplar_rfid    LIKE ?
          OR b.ed_library_book_title LIKE ?
        )
      ORDER BY b.ed_library_book_title ASC
      LIMIT 20`;

    const rows = await ExecuteQuery(res, query,
      [institute, search, search, search, search], true,
      { db: 'eduall_library_exemplares', type: 'select', data: req });
    res.status(200).json(rows);
  } catch (error) {
    res.status(500).json({ success: false, message: 'Falha ao pesquisar exemplares!', error: error.message });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
//  POST — Registar Empréstimo
//  Body: user_id, exemplar_id, loan_date, renewals_allowed, notes
// ─────────────────────────────────────────────────────────────────────────────
const RegisterLoan = async (req, res) => {
  try {
    const institute = inst(req);
    const userId    = uid(req);
    const {
      user_id,
      exemplar_id,
      loan_date       = new Date().toISOString().slice(0, 10),
      renewals_allowed = 1,
      notes,
    } = req.body;

    if (!user_id || !exemplar_id) {
      return res.status(400).json({ success: false, message: 'Utilizador e exemplar são obrigatórios!' });
    }

    // ── 1. Verificar se utilizador pertence à escola ──────────────────────
    const userCheck = await ExecuteQuery(res,
      `SELECT ed_user_account_id, ed_user_account_name
         FROM eduall_user_accounts
        WHERE ed_user_account_id = ?
          AND ed_user_account_institute_code = ?
          AND ed_user_account_deleted = 0
        LIMIT 1`,
      [user_id, institute], true,
      { db: 'eduall_user_accounts', type: 'select', data: req });

    if (!userCheck.length) {
      return res.status(403).json({ success: false, message: 'Utilizador não encontrado ou não pertence a esta escola!' });
    }

    // ── 2. Verificar multas pendentes ─────────────────────────────────────
    const finesCheck = await ExecuteQuery(res,
      `SELECT COUNT(*) AS total FROM eduall_library_fines
        WHERE ed_fine_user_id = ? AND ed_fine_paid = 0 AND ed_fine_deleted = 0`,
      [user_id], true,
      { db: 'eduall_library_fines', type: 'select', data: req });

    if (finesCheck[0]?.total > 0) {
      return res.status(409).json({ success: false, message: `O utilizador tem ${finesCheck[0].total} multa(s) pendente(s). Regularize antes de efectuar o empréstimo.` });
    }

    // ── 3. Verificar limite de empréstimos activos (máx. 3 por defeito) ───
    const activeCheck = await ExecuteQuery(res,
      `SELECT COUNT(*) AS total FROM eduall_library_loans
        WHERE ed_loan_user_id = ? AND ed_loan_status IN ('em_curso','atrasado','renovado')
          AND ed_loan_deleted = 0`,
      [user_id], true,
      { db: 'eduall_library_loans', type: 'select', data: req });

    if (activeCheck[0]?.total >= 3) {
      return res.status(409).json({ success: false, message: 'O utilizador atingiu o limite máximo de 3 empréstimos activos.' });
    }

    // ── 4. Verificar se exemplar está disponível ──────────────────────────
    const exemplarCheck = await ExecuteQuery(res,
      `SELECT ed_exemplar_id, ed_exemplar_code, ed_exemplar_status
         FROM eduall_library_exemplares
        WHERE ed_exemplar_id = ?
          AND ed_exemplar_status = 'disponivel'
          AND ed_exemplar_deleted = 0
          AND ed_exemplar_institute_code = ?
        LIMIT 1`,
      [exemplar_id, institute], true,
      { db: 'eduall_library_exemplares', type: 'select', data: req });

    if (!exemplarCheck.length) {
      return res.status(409).json({ success: false, message: 'Exemplar não disponível para empréstimo!' });
    }

    // ── 5. Calcular data limite ───────────────────────────────────────────
    const limitDate = addDays(loan_date, DEFAULT_LOAN_DAYS);

    // ── 6. Inserir empréstimo + atualizar exemplar (em paralelo) ─────────
    const [result] = await Promise.all([
      ExecuteQuery(res,
        `INSERT INTO eduall_library_loans (
           ed_loan_user_id, ed_loan_exemplar_id, ed_loan_date,
           ed_loan_limit_date, ed_loan_status, ed_loan_renewals_allowed,
           ed_loan_renewals_count, ed_loan_notes, ed_loan_registered_by,
           ed_loan_institute_code
         ) VALUES (?, ?, ?, ?, 'em_curso', ?, 0, ?, ?, ?)`,
        [user_id, exemplar_id, loan_date, limitDate,
         renewals_allowed, notes || null, userId, institute],
        false, { db: 'eduall_library_loans', type: 'insert', data: req }),

      ExecuteQuery(res,
        `UPDATE eduall_library_exemplares SET ed_exemplar_status = 'emprestado'
          WHERE ed_exemplar_id = ?`,
        [exemplar_id], false,
        { db: 'eduall_library_exemplares', type: 'update', data: req }),
    ]);

    await RegisterAuditAction({
      session: req.session, action: 1,
      form: 'Empréstimo de Biblioteca',
      description: `Registou empréstimo EMP-${String(result.insertId).padStart(4, '0')} para utilizador ID ${user_id}`,
    });

    res.status(200).json({
      success:   true,
      loan_id:   result.insertId,
      loan_number: `EMP-${String(result.insertId).padStart(4, '0')}`,
      limit_date: limitDate,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Falha ao registar empréstimo!', error: error.message });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
//  POST — Empréstimo Rápido
//  Body: rfid_code | barcode (exemplar), user_search (nome/username)
//  Resolve utilizador e exemplar e cria o empréstimo numa só chamada.
// ─────────────────────────────────────────────────────────────────────────────
const QuickLoan = async (req, res) => {
  try {
    const institute = inst(req);
    const userId    = uid(req);
    const { rfid_code, barcode, user_search, notes } = req.body;

    if (!user_search) return res.status(400).json({ success: false, message: 'Identificador do utilizador é obrigatório!' });
    if (!rfid_code && !barcode) return res.status(400).json({ success: false, message: 'Código RFID ou código de barras do exemplar é obrigatório!' });

    // Resolver utilizador
    const userRows = await ExecuteQuery(res,
      `SELECT ed_user_account_id, ed_user_account_name
         FROM eduall_user_accounts
        WHERE ed_user_account_deleted = 0
          AND ed_user_account_institute_code = ?
          AND (ed_user_account_name LIKE ? OR ed_user_account_username LIKE ?)
        LIMIT 1`,
      [institute, `%${user_search}%`, `%${user_search}%`], true,
      { db: 'eduall_user_accounts', type: 'select', data: req });

    if (!userRows.length) return res.status(404).json({ success: false, message: 'Utilizador não encontrado!' });

    // Resolver exemplar
    const exCond  = rfid_code ? 'ed_exemplar_rfid = ?' : 'ed_exemplar_barcode = ?';
    const exParam = rfid_code || barcode;
    const exRows  = await ExecuteQuery(res,
      `SELECT ed_exemplar_id FROM eduall_library_exemplares
        WHERE ${exCond}
          AND ed_exemplar_status = 'disponivel'
          AND ed_exemplar_deleted = 0
          AND ed_exemplar_institute_code = ?
        LIMIT 1`,
      [exParam, institute], true,
      { db: 'eduall_library_exemplares', type: 'select', data: req });

    if (!exRows.length) return res.status(404).json({ success: false, message: 'Exemplar não encontrado ou não disponível!' });

    // Delegar para RegisterLoan reutilizando a lógica de validação
    req.body.user_id     = userRows[0].ed_user_account_id;
    req.body.exemplar_id = exRows[0].ed_exemplar_id;
    req.body.notes       = notes || null;
    return RegisterLoan(req, res);
  } catch (error) {
    res.status(500).json({ success: false, message: 'Falha no empréstimo rápido!', error: error.message });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
//  PUT — Registar Devolução
//  Body: return_notes (opcional)
// ─────────────────────────────────────────────────────────────────────────────
const ReturnLoan = async (req, res) => {
  try {
    const { ID }    = req.params;
    const institute = inst(req);

    // Buscar empréstimo
    const loanRows = await ExecuteQuery(res,
      `SELECT ed_loan_id, ed_loan_exemplar_id, ed_loan_status, ed_loan_limit_date
         FROM eduall_library_loans
        WHERE ed_loan_id = ? AND ed_loan_deleted = 0 AND ed_loan_institute_code = ?`,
      [ID, institute], true,
      { db: 'eduall_library_loans', type: 'select', data: req });

    if (!loanRows.length) return res.status(404).json({ success: false, message: 'Empréstimo não encontrado!' });

    const loan = loanRows[0];
    if (loan.ed_loan_status === 'devolvido') {
      return res.status(409).json({ success: false, message: 'Este empréstimo já foi devolvido.' });
    }

    const returnDate = new Date().toISOString().slice(0, 10);
    const wasLate    = new Date(returnDate) > new Date(loan.ed_loan_limit_date);

    // Atualizar empréstimo + exemplar em paralelo
    await Promise.all([
      ExecuteQuery(res,
        `UPDATE eduall_library_loans
            SET ed_loan_status = 'devolvido',
                ed_loan_return_date = NOW(),
                ed_loan_return_notes = ?,
                ed_loan_was_late = ?
          WHERE ed_loan_id = ? AND ed_loan_institute_code = ?`,
        [req.body.return_notes || null, wasLate ? 1 : 0, ID, institute],
        false, { db: 'eduall_library_loans', type: 'update', data: req }),

      ExecuteQuery(res,
        `UPDATE eduall_library_exemplares SET ed_exemplar_status = 'disponivel'
          WHERE ed_exemplar_id = ?`,
        [loan.ed_loan_exemplar_id], false,
        { db: 'eduall_library_exemplares', type: 'update', data: req }),
    ]);

    await RegisterAuditAction({
      session: req.session, action: 2,
      form: 'Empréstimo de Biblioteca',
      description: `Registou devolução do empréstimo ID ${ID}${wasLate ? ' (com atraso)' : ''}`,
    });

    res.status(200).json({ success: true, was_late: wasLate });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Falha ao registar devolução!', error: error.message });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
//  PUT — Renovar Empréstimo
//  Incrementa a data-limite em DEFAULT_LOAN_DAYS e o contador de renovações.
// ─────────────────────────────────────────────────────────────────────────────
const RenewLoan = async (req, res) => {
  try {
    const { ID }    = req.params;
    const institute = inst(req);

    const loanRows = await ExecuteQuery(res,
      `SELECT ed_loan_id, ed_loan_renewals_count, ed_loan_renewals_allowed, ed_loan_limit_date, ed_loan_status
         FROM eduall_library_loans
        WHERE ed_loan_id = ? AND ed_loan_deleted = 0 AND ed_loan_institute_code = ?`,
      [ID, institute], true,
      { db: 'eduall_library_loans', type: 'select', data: req });

    if (!loanRows.length) return res.status(404).json({ success: false, message: 'Empréstimo não encontrado!' });

    const loan = loanRows[0];
    if (loan.ed_loan_status === 'devolvido') return res.status(409).json({ success: false, message: 'Não é possível renovar um empréstimo já devolvido.' });
    if (loan.ed_loan_renewals_count >= loan.ed_loan_renewals_allowed) {
      return res.status(409).json({ success: false, message: `Limite de renovações atingido (${loan.ed_loan_renewals_allowed}).` });
    }

    const newLimitDate = addDays(loan.ed_loan_limit_date, DEFAULT_LOAN_DAYS);

    await ExecuteQuery(res,
      `UPDATE eduall_library_loans
          SET ed_loan_limit_date       = ?,
              ed_loan_renewals_count   = ed_loan_renewals_count + 1,
              ed_loan_status           = 'renovado'
        WHERE ed_loan_id = ? AND ed_loan_institute_code = ?`,
      [newLimitDate, ID, institute], false,
      { db: 'eduall_library_loans', type: 'update', data: req });

    await RegisterAuditAction({
      session: req.session, action: 2,
      form: 'Empréstimo de Biblioteca',
      description: `Renovou empréstimo ID ${ID} — nova data limite: ${newLimitDate}`,
    });

    res.status(200).json({ success: true, new_limit_date: newLimitDate });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Falha ao renovar empréstimo!', error: error.message });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
//  DELETE — Soft-delete de empréstimo
// ─────────────────────────────────────────────────────────────────────────────
const DeleteLoan = async (req, res) => {
  try {
    const { ID }    = req.params;
    const institute = inst(req);

    await ExecuteQuery(res,
      `UPDATE eduall_library_loans SET ed_loan_deleted = 1
        WHERE ed_loan_id = ? AND ed_loan_institute_code = ?`,
      [ID, institute], false,
      { db: 'eduall_library_loans', type: 'update', data: req });

    await RegisterAuditAction({
      session: req.session, action: 3,
      form: 'Empréstimo de Biblioteca',
      description: `Removeu empréstimo ID ${ID}`,
    });

    res.status(200).json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Falha ao remover empréstimo!', error: error.message });
  }
};

module.exports = {
  GetLoans,
  GetLoansKpis,
  GetActiveLoansByUser,
  GetLoanHistoryByUser,
  SearchUsersLoans,
  SearchExemplars,
  RegisterLoan,
  QuickLoan,
  ReturnLoan,
  RenewLoan,
  DeleteLoan,
};
 