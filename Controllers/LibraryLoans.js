'use strict';
const { RegisterAuditAction } = require('./Auditory');
const ExecuteQuery             = require('../Functions/ExecuteQuery');

/* ─────────────────────────────────────────────────────────────────────────────
   NOTAS DE MIGRAÇÃO NECESSÁRIAS (correr uma vez na base de dados):

   ALTER TABLE eduall_library_loans
     ADD COLUMN ed_loan_fine_amount DECIMAL(10,2) NOT NULL DEFAULT 0
     AFTER ed_loan_notes;

   -- Nesta versão o empréstimo é feito directamente sobre o LIVRO,
   -- sem passar por exemplares individuais. Para não obrigar a alterar
   -- o schema existente, continua a usar-se a coluna ed_loan_exemplar_id,
   -- mas nela é guardado o ed_library_book_id directamente — não há
   -- resolução nem verificação de exemplar físico.

   -- Tabela eduall_library_fines assume-se com, pelo menos, estas colunas:
   --   ed_fine_id, ed_fine_user_id, ed_fine_loan_id, ed_fine_amount,
   --   ed_fine_reason, ed_fine_paid, ed_fine_deleted,
   --   ed_fine_institute_code, ed_fine_date
   -- Se a tua tabela tiver nomes diferentes, ajusta o INSERT em ReturnLoan().

   -- NOVO ENDPOINT DE EDIÇÃO (ver EditLoan() em baixo) — adicionar no ficheiro
   -- de rotas correspondente (ex.: routes/library.routes.js):
   --
   --   router.put('/edualllibraryloans/edit/:ID', EditLoan);
   --
   -- (importar EditLoan a partir deste controller, junto dos restantes)
───────────────────────────────────────────────────────────────────────────── */

/* ─────────────────────────────────────────
   HELPERS
───────────────────────────────────────── */
const inst = req => req.session.user.eduall_user_session_curentinstitute;
const uid  = req => req.session.user.eduall_user_id;

const DEFAULT_RENEWAL_DAYS = 15; // usado só para renovações (extensão automática)
const MAX_ACTIVE_LOANS     = 3;

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
        u.ed_user_account_name    AS ed_loan_user_name,
        u.ed_user_account_picture AS ed_loan_user_picture,
        u.ed_user_account_charge  AS ed_loan_user_charge,
        b.ed_library_book_title,
        b.ed_library_book_picture,
        b.ed_library_book_author,
        CONCAT('EMP-', LPAD(l.ed_loan_id, 4, '0')) AS ed_loan_number
      FROM eduall_library_loans l
      LEFT JOIN eduall_user_accounts u
             ON u.ed_user_account_id = l.ed_loan_user_id
      LEFT JOIN eduall_library_books b
             ON b.ed_library_book_id = l.ed_loan_exemplar_id
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
    const { USER_ID } = req.params;
    const institute   = inst(req);

    const query = `
      SELECT
        l.*,
        CONCAT('EMP-', LPAD(l.ed_loan_id, 4, '0')) AS ed_loan_number,
        b.ed_library_book_title,
        b.ed_library_book_picture
      FROM eduall_library_loans l
      LEFT JOIN eduall_library_books b ON b.ed_library_book_id = l.ed_loan_exemplar_id
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
        b.ed_library_book_title,
        b.ed_library_book_picture
      FROM eduall_library_loans l
      LEFT JOIN eduall_library_books b ON b.ed_library_book_id = l.ed_loan_exemplar_id
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
//  GET — Lista de LEITORES da biblioteca (para o select do novo empréstimo)
//  Só devolve utilizadores com acesso de biblioteca do tipo 'reader'.
// ─────────────────────────────────────────────────────────────────────────────
const GetLibraryReaders = async (req, res) => {
  try {
    const institute = inst(req);

    const query = `
      SELECT
        u.ed_user_account_id       AS user_id,
        u.ed_user_account_name     AS user_name,
        u.ed_user_account_username AS user_username,
        u.ed_user_account_picture  AS user_picture,
        u.ed_user_account_charge   AS user_charge,
        la.ed_library_access_type  AS account_type,
        (
          SELECT COUNT(*) FROM eduall_library_loans
           WHERE ed_loan_user_id = u.ed_user_account_id
             AND ed_loan_status IN ('em_curso','atrasado','renovado')
             AND ed_loan_deleted = 0
        ) AS active_loans,
        (
          SELECT COUNT(*) FROM eduall_library_fines
           WHERE ed_fine_user_id = u.ed_user_account_id
             AND ed_fine_paid = 0
             AND ed_fine_deleted = 0
        ) AS pending_fines
      FROM eduall_library_access la
      INNER JOIN eduall_user_accounts u
              ON u.ed_user_account_id = la.ed_library_access_user_id
      WHERE la.ed_library_access_deleted = 0
        AND la.ed_library_access_institute_code = ?
        AND (la.ed_library_access_type = 'reader' OR la.ed_library_access_type IS NULL)
        AND u.ed_user_account_deleted = 0
      ORDER BY u.ed_user_account_name ASC`;

    const rows = await ExecuteQuery(res, query, [institute], true, {
      db: 'eduall_library_access', type: 'select', data: req,
    });
    res.status(200).json(rows);
  } catch (error) {
    res.status(500).json({ success: false, message: 'Falha ao buscar leitores da biblioteca!', error: error.message });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
//  GET — Pesquisa de LIVROS (para o select do novo empréstimo)
//  Query param: q (título ou autor)
// ─────────────────────────────────────────────────────────────────────────────
const SearchBooksForLoan = async (req, res) => {
  try {
    const institute  = inst(req);
    const { q = '' } = req.query;
    const search     = `%${q.trim()}%`;

    const query = `
      SELECT
        b.ed_library_book_id,
        b.ed_library_book_title,
        b.ed_library_book_author,
        b.ed_library_book_picture,
        b.ed_library_book_year
      FROM eduall_library_books b
      WHERE b.ed_library_book_deleted = 0
        AND b.ed_library_book_institute_code = ?
        AND (b.ed_library_book_title LIKE ? OR b.ed_library_book_author LIKE ?)
      ORDER BY b.ed_library_book_title ASC
      LIMIT 20`;

    const rows = await ExecuteQuery(res, query,
      [institute, search, search], true,
      { db: 'eduall_library_books', type: 'select', data: req });
    res.status(200).json(rows);
  } catch (error) {
    res.status(500).json({ success: false, message: 'Falha ao pesquisar livros!', error: error.message });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
//  POST — Registar Empréstimo (simplificado)
//  Body: user_id, book_id, loan_date, return_date, fine_amount, renewals_allowed, notes
//  Não há verificação nem associação de exemplares — o empréstimo é feito
//  directamente sobre o livro (ed_loan_exemplar_id).
// ─────────────────────────────────────────────────────────────────────────────
const RegisterLoan = async (req, res) => {
  try {
    const institute = inst(req);
    const userId    = uid(req);
    const {
      user_id,
      book_id,
      loan_date        = new Date().toISOString().slice(0, 10),
      return_date,
      fine_amount      = 0,
      renewals_allowed = 1,
      notes,
    } = req.body;

    if (!user_id || !book_id) {
      return res.status(400).json({ success: false, message: 'Utilizador e livro são obrigatórios!' });
    }
    if (!return_date) {
      return res.status(400).json({ success: false, message: 'Data de devolução é obrigatória!' });
    }
    if (new Date(return_date) < new Date(loan_date)) {
      return res.status(400).json({ success: false, message: 'A data de devolução não pode ser anterior à data de empréstimo!' });
    }

    // ── 1. Verificar se utilizador pertence à escola ──────────────────────
    const userCheck = await ExecuteQuery(res,
      `SELECT u.ed_user_account_id, u.ed_user_account_name
         FROM eduall_user_accounts u
         INNER JOIN eduall_library_access la
                 ON la.ed_library_access_user_id = u.ed_user_account_id
                AND la.ed_library_access_institute_code = ?
                AND la.ed_library_access_deleted = 0
        WHERE u.ed_user_account_id = ?
          AND u.ed_user_account_deleted = 0
        LIMIT 1`,
      [institute, user_id], true,
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

    // ── 3. Verificar limite de empréstimos activos ────────────────────────
    const activeCheck = await ExecuteQuery(res,
      `SELECT COUNT(*) AS total FROM eduall_library_loans
        WHERE ed_loan_user_id = ? AND ed_loan_status IN ('em_curso','atrasado','renovado')
          AND ed_loan_deleted = 0`,
      [user_id], true,
      { db: 'eduall_library_loans', type: 'select', data: req });

    if (activeCheck[0]?.total >= MAX_ACTIVE_LOANS) {
      return res.status(409).json({ success: false, message: `O utilizador atingiu o limite máximo de ${MAX_ACTIVE_LOANS} empréstimos activos.` });
    }

    // ── 4. Inserir empréstimo directamente sobre o livro ──────────────────
    const result = await ExecuteQuery(res,
      `INSERT INTO eduall_library_loans (
         ed_loan_user_id, ed_loan_exemplar_id, ed_loan_date,
         ed_loan_limit_date, ed_loan_status, ed_loan_renewals_allowed,
         ed_loan_renewals_count, ed_loan_notes, ed_loan_fine_amount,
         ed_loan_registered_by, ed_loan_institute_code
       ) VALUES (?, ?, ?, ?, 'em_curso', ?, 0, ?, ?, ?, ?)`,
      [user_id, book_id, loan_date, return_date,
       renewals_allowed, notes || null, Number(fine_amount) || 0, userId, institute],
      false, { db: 'eduall_library_loans', type: 'insert', data: req });

    await RegisterAuditAction({
      session: req.session, action: 1,
      form: 'Empréstimo de Biblioteca',
      description: `Registou empréstimo EMP-${String(result.insertId).padStart(4, '0')} para utilizador ID ${user_id}`,
    });

    res.status(200).json({
      success:     true,
      loan_id:     result.insertId,
      loan_number: `EMP-${String(result.insertId).padStart(4, '0')}`,
      limit_date:  return_date,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Falha ao registar empréstimo!', error: error.message });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
//  PUT — Editar Empréstimo (NOVO)
//  Permite corrigir/actualizar utilizador, livro, datas, multa, renovações
//  permitidas e notas de um empréstimo já existente, desde que este ainda
//  não tenha sido devolvido.
//  Body: user_id, book_id, loan_date, return_date, fine_amount,
//        renewals_allowed, notes
// ─────────────────────────────────────────────────────────────────────────────
const EditLoan = async (req, res) => {
  try {
    const { ID }    = req.params;
    const institute = inst(req);
    const {
      user_id,
      book_id,
      loan_date,
      return_date,
      fine_amount      = 0,
      renewals_allowed = 1,
      notes,
    } = req.body;

    if (!user_id || !book_id) {
      return res.status(400).json({ success: false, message: 'Utilizador e livro são obrigatórios!' });
    }
    if (!loan_date || !return_date) {
      return res.status(400).json({ success: false, message: 'Datas de empréstimo e devolução são obrigatórias!' });
    }
    if (new Date(return_date) < new Date(loan_date)) {
      return res.status(400).json({ success: false, message: 'A data de devolução não pode ser anterior à data de empréstimo!' });
    }

    // ── 1. Verificar se o empréstimo existe e ainda não foi devolvido ─────
    const loanRows = await ExecuteQuery(res,
      `SELECT ed_loan_id, ed_loan_status
         FROM eduall_library_loans
        WHERE ed_loan_id = ? AND ed_loan_deleted = 0 AND ed_loan_institute_code = ?`,
      [ID, institute], true,
      { db: 'eduall_library_loans', type: 'select', data: req });

    if (!loanRows.length) {
      return res.status(404).json({ success: false, message: 'Empréstimo não encontrado!' });
    }
    if (loanRows[0].ed_loan_status === 'devolvido') {
      return res.status(409).json({ success: false, message: 'Não é possível editar um empréstimo já devolvido.' });
    }

    // ── 2. Verificar se o novo utilizador pertence à escola ───────────────
    const userCheck = await ExecuteQuery(res,
      `SELECT u.ed_user_account_id
         FROM eduall_user_accounts u
         INNER JOIN eduall_library_access la
                 ON la.ed_library_access_user_id = u.ed_user_account_id
                AND la.ed_library_access_institute_code = ?
                AND la.ed_library_access_deleted = 0
        WHERE u.ed_user_account_id = ?
          AND u.ed_user_account_deleted = 0
        LIMIT 1`,
      [institute, user_id], true,
      { db: 'eduall_user_accounts', type: 'select', data: req });

    if (!userCheck.length) {
      return res.status(403).json({ success: false, message: 'Utilizador não encontrado ou não pertence a esta escola!' });
    }

    // ── 3. Actualizar o empréstimo ─────────────────────────────────────────
    await ExecuteQuery(res,
      `UPDATE eduall_library_loans
          SET ed_loan_user_id          = ?,
              ed_loan_exemplar_id      = ?,
              ed_loan_date             = ?,
              ed_loan_limit_date       = ?,
              ed_loan_fine_amount      = ?,
              ed_loan_renewals_allowed = ?,
              ed_loan_notes            = ?
        WHERE ed_loan_id = ? AND ed_loan_institute_code = ?`,
      [user_id, book_id, loan_date, return_date,
       Number(fine_amount) || 0, renewals_allowed, notes || null, ID, institute],
      false, { db: 'eduall_library_loans', type: 'update', data: req });

    await RegisterAuditAction({
      session: req.session, action: 2,
      form: 'Empréstimo de Biblioteca',
      description: `Editou empréstimo ID ${ID}`,
    });

    res.status(200).json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Falha ao editar empréstimo!', error: error.message });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
//  PUT — Registar Devolução
//  Se a devolução for tardia e o empréstimo tiver um valor de multa definido,
//  gera automaticamente um registo em eduall_library_fines.
//  Body: return_notes (opcional)
// ─────────────────────────────────────────────────────────────────────────────
const ReturnLoan = async (req, res) => {
  try {
    const { ID }    = req.params;
    const institute = inst(req);

    const loanRows = await ExecuteQuery(res,
      `SELECT ed_loan_id, ed_loan_user_id, ed_loan_status,
              ed_loan_limit_date, ed_loan_fine_amount
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
    const wasLate     = new Date(returnDate) > new Date(loan.ed_loan_limit_date);
    const fineAmount  = Number(loan.ed_loan_fine_amount) || 0;
    const shouldFine  = wasLate && fineAmount > 0;

    // ── 1. Marcar a devolução/pagamento — isto TEM de acontecer sempre que
    //       os dados são válidos, independentemente do que se passar a seguir
    //       com o registo (opcional) na tabela de multas. ────────────────────
    await ExecuteQuery(res,
      `UPDATE eduall_library_loans
          SET ed_loan_status = 'devolvido',
              ed_loan_return_date = NOW(),
              ed_loan_return_notes = ?,
              ed_loan_was_late = ?
        WHERE ed_loan_id = ? AND ed_loan_institute_code = ?`,
      [req.body.return_notes || null, wasLate ? 1 : 0, ID, institute],
      false, { db: 'eduall_library_loans', type: 'update', data: req });

    // ── 2. Registo (best-effort) na tabela eduall_library_fines. Isolado
    //       num try/catch próprio: se a tabela não existir ou tiver colunas
    //       diferentes das assumidas, isto NÃO deve fazer falhar o pagamento
    //       que já foi confirmado no passo 1 acima. ────────────────────────
    let fineLogWarning = null;
    if (shouldFine) {
      try {
        await ExecuteQuery(res,
          `INSERT INTO eduall_library_fines (
             ed_fine_user_id, ed_fine_loan_id, ed_fine_amount, ed_fine_reason,
             ed_fine_paid, ed_fine_deleted, ed_fine_institute_code, ed_fine_date
           ) VALUES (?, ?, ?, ?, 0, 0, ?, NOW())`,
          [loan.ed_loan_user_id, ID, fineAmount,
           `Devolução em atraso do empréstimo EMP-${String(ID).padStart(4, '0')}`, institute],
          false, { db: 'eduall_library_fines', type: 'insert', data: req });
      } catch (fineErr) {
        fineLogWarning = fineErr.message;
      }
    }

    await RegisterAuditAction({
      session: req.session, action: 2,
      form: 'Empréstimo de Biblioteca',
      description: `Registou devolução do empréstimo ID ${ID}${wasLate ? ' (com atraso)' : ''}${shouldFine ? ` — multa de ${fineAmount} aplicada${fineLogWarning ? ' (falha ao registar em eduall_library_fines)' : ''}` : ''}`,
    });

    res.status(200).json({
      success: true,
      was_late: wasLate,
      fine_applied: shouldFine && !fineLogWarning,
      fine_amount: shouldFine ? fineAmount : 0,
      ...(fineLogWarning ? { fine_log_warning: fineLogWarning } : {}),
    });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Falha ao registar devolução!', error: error.message });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
//  PUT — Renovar Empréstimo
//  Incrementa a data-limite em DEFAULT_RENEWAL_DAYS e o contador de renovações.
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

    const newLimitDate = addDays(loan.ed_loan_limit_date, DEFAULT_RENEWAL_DAYS);

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
  GetLibraryReaders,
  SearchBooksForLoan,
  RegisterLoan,
  EditLoan,
  ReturnLoan,
  RenewLoan,
  DeleteLoan,
};