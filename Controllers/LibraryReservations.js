'use strict'; 
const { RegisterAuditAction } = require('./Auditory');
const ExecuteQuery             = require('../Functions/ExecuteQuery');

/* ── Helpers ──────────────────────────────────────────────────────────────── */
const inst = (req) => req.session.user.eduall_user_session_curentinstitute;
const uid  = (req) => req.session.user.eduall_user_session_ID;
 
const DEFAULT_EXPIRY_DAYS = 3;

function addDays(date, days) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function fmtNumber(id) {
  return `RES-${String(id).padStart(4, '0')}`;
}

/* ════════════════════════════════════════════════════════════════════════════
   GET — Minhas reservas (usuário logado)
════════════════════════════════════════════════════════════════════════════ */
const GetMyReservations = async (req, res) => {
  try {
    const institute = inst(req);
    const userId    = uid(req);

    const query = `
      SELECT
        r.*,
        CONCAT('RES-', LPAD(r.ed_reservation_id, 4, '0'))  AS ed_reservation_number,
        b.ed_library_book_title,
        b.ed_library_book_picture,
        b.ed_library_book_author,
        b.ed_library_book_year,
        ex.ed_exemplar_code AS ed_reserved_exemplar_code
      FROM eduall_library_reservations r
      LEFT JOIN eduall_library_books b ON b.ed_library_book_id = r.ed_reservation_book_id
      LEFT JOIN eduall_library_exemplares ex ON ex.ed_exemplar_id = r.ed_reservation_exemplar_id
      WHERE r.ed_reservation_deleted = 0
        AND r.ed_reservation_user_id = ?
        AND r.ed_reservation_institute_code = ?
      ORDER BY r.ed_reservation_date DESC`;

    const rows = await ExecuteQuery(res, query, [userId, institute], true, {
      db: 'eduall_library_reservations', type: 'select', data: req,
    });

    res.status(200).json(rows);
  } catch (error) {
    res.status(500).json({ success: false, message: 'Erro ao buscar suas reservas', error: error.message });
  }
};

/* ════════════════════════════════════════════════════════════════════════════
   GET — Lista de reservas (admin)
   Query params: status | user_id | date_from | date_to | limit | offset
════════════════════════════════════════════════════════════════════════════ */
const GetReservations = async (req, res) => {
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

    /* Expirar automaticamente reservas pendentes vencidas */
    await ExecuteQuery(
      res,
      `UPDATE eduall_library_reservations
          SET ed_reservation_status = 'expirada'
        WHERE ed_reservation_deleted = 0
          AND ed_reservation_status = 'pendente'
          AND ed_reservation_institute_code = ?
          AND DATE(ed_reservation_expiry_date) < CURDATE()`,
      [institute], false,
      { db: 'eduall_library_reservations', type: 'update', data: req },
    );

    let where    = `WHERE r.ed_reservation_deleted = 0 AND r.ed_reservation_institute_code = ?`;
    const PARAMS = [institute];

    if (status)    { where += ' AND r.ed_reservation_status = ?';             PARAMS.push(status);    }
    if (user_id)   { where += ' AND r.ed_reservation_user_id = ?';            PARAMS.push(user_id);   }
    if (date_from) { where += ' AND r.ed_reservation_date >= ?';              PARAMS.push(date_from); }
    if (date_to)   { where += ' AND r.ed_reservation_date <= ?';              PARAMS.push(`${date_to} 23:59:59`); }

    PARAMS.push(Number(limit), Number(offset));

    const query = `
      SELECT
        r.*,
        CONCAT('RES-', LPAD(r.ed_reservation_id, 4, '0'))  AS ed_reservation_number,
        u.ed_user_account_name                              AS ed_reservation_user_name,
        u.ed_user_account_picture                          AS ed_reservation_user_picture,
        u.ed_user_account_charge                           AS ed_reservation_user_charge,
        b.ed_library_book_title,
        b.ed_library_book_picture,
        b.ed_library_book_author,
        b.ed_library_book_year,
        ex.ed_exemplar_code                                AS ed_reserved_exemplar_code
      FROM eduall_library_reservations r
      LEFT JOIN eduall_user_accounts u
             ON u.ed_user_account_id = r.ed_reservation_user_id
      LEFT JOIN eduall_library_books b
             ON b.ed_library_book_id = r.ed_reservation_book_id
      LEFT JOIN eduall_library_exemplares ex
             ON ex.ed_exemplar_id = r.ed_reservation_exemplar_id
      ${where}
      ORDER BY r.ed_reservation_date DESC
      LIMIT ? OFFSET ?`;

    const rows = await ExecuteQuery(res, query, PARAMS, true, {
      db: 'eduall_library_reservations', type: 'select', data: req,
    });

    res.status(200).json(rows);
  } catch (error) {
    res.status(500).json({ success: false, message: 'Erro ao buscar reservas', error: error.message });
  }
};

/* ════════════════════════════════════════════════════════════════════════════
   GET — KPIs
════════════════════════════════════════════════════════════════════════════ */
const GetReservationsKpis = async (req, res) => {
  try {
    const institute = inst(req);

    /* Expirar pendentes antes de calcular */
    await ExecuteQuery(
      res,
      `UPDATE eduall_library_reservations
          SET ed_reservation_status = 'expirada'
        WHERE ed_reservation_deleted = 0
          AND ed_reservation_status = 'pendente'
          AND ed_reservation_institute_code = ?
          AND DATE(ed_reservation_expiry_date) < CURDATE()`,
      [institute], false,
      { db: 'eduall_library_reservations', type: 'update', data: req },
    );

    const query = `
      SELECT
        COUNT(*)                                                                        AS total,
        SUM(CASE WHEN ed_reservation_status = 'pendente'   THEN 1 ELSE 0 END)          AS pendentes,
        SUM(CASE WHEN ed_reservation_status = 'confirmada' THEN 1 ELSE 0 END)          AS confirmadas,
        SUM(CASE WHEN ed_reservation_status = 'cancelada'  THEN 1 ELSE 0 END)          AS canceladas,
        SUM(CASE WHEN ed_reservation_status = 'concluida'  THEN 1 ELSE 0 END)          AS concluidas,
        SUM(CASE WHEN ed_reservation_status = 'expirada'   THEN 1 ELSE 0 END)          AS expiradas,
        COUNT(DISTINCT ed_reservation_user_id)                                          AS utilizadores
      FROM eduall_library_reservations
      WHERE ed_reservation_deleted = 0
        AND ed_reservation_institute_code = ?`;

    const rows = await ExecuteQuery(res, query, [institute], true, {
      db: 'eduall_library_reservations', type: 'select', data: req,
    });

    res.status(200).json(rows[0] ?? {});
  } catch (error) {
    res.status(500).json({ success: false, message: 'Erro ao buscar indicadores', error: error.message });
  }
};

/* ════════════════════════════════════════════════════════════════════════════
   GET — Dados do gráfico (últimos 7 dias)
════════════════════════════════════════════════════════════════════════════ */
const GetReservationsChart = async (req, res) => {
  try {
    const institute = inst(req);

    const query = `
      SELECT
        DATE(ed_reservation_date)                                       AS day,
        COUNT(*)                                                        AS reservations,
        SUM(CASE WHEN ed_reservation_status = 'confirmada' THEN 1 ELSE 0 END) AS confirmed
      FROM eduall_library_reservations
      WHERE ed_reservation_deleted = 0
        AND ed_reservation_institute_code = ?
        AND ed_reservation_date >= DATE_SUB(CURDATE(), INTERVAL 6 DAY)
      GROUP BY DATE(ed_reservation_date)
      ORDER BY day ASC`;

    const rows = await ExecuteQuery(res, query, [institute], true, {
      db: 'eduall_library_reservations', type: 'select', data: req,
    });

    const labels      = [];
    const reservations = [];
    const confirmed   = [];

    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const dayStr = d.toISOString().slice(0, 10);
      const row    = rows.find((r) => r.day?.toISOString?.().slice(0, 10) === dayStr
                                   || r.day === dayStr) ?? {};

      const weekday = d.toLocaleDateString('pt-PT', { weekday: 'short' });
      labels.push(weekday.charAt(0).toUpperCase() + weekday.slice(1));
      reservations.push(row.reservations ?? 0);
      confirmed.push(row.confirmed ?? 0);
    }

    res.status(200).json({ labels, reservations, confirmed });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Erro ao buscar gráfico', error: error.message });
  }
};

/* ════════════════════════════════════════════════════════════════════════════
   GET — Livros disponíveis para reserva (pesquisa)
   Query param: q (título, autor, ISBN) | limit
════════════════════════════════════════════════════════════════════════════ */
const GetAvailableBooksForReservation = async (req, res) => {
  try {
    const institute = inst(req);
    const { q = '', limit = 24 } = req.query;
    const search = `%${q.trim()}%`;

    const query = `
      SELECT
        b.ed_library_book_id,
        b.ed_library_book_title,
        b.ed_library_book_picture,
        b.ed_library_book_author,
        b.ed_library_book_year,
        b.ed_library_book_classification,
        (
          SELECT COUNT(*) FROM eduall_library_exemplares ex
          WHERE ex.ed_exemplar_book_id      = b.ed_library_book_id
            AND ex.ed_exemplar_status       = 'disponivel'
            AND ex.ed_exemplar_deleted      = 0
            AND ex.ed_exemplar_institute_code = ?
        ) AS available_copies,
        (
          SELECT COUNT(*) FROM eduall_library_reservations rv
          WHERE rv.ed_reservation_book_id   = b.ed_library_book_id
            AND rv.ed_reservation_status    IN ('pendente','confirmada')
            AND rv.ed_reservation_deleted   = 0
            AND rv.ed_reservation_institute_code = ?
        ) AS active_reservations
      FROM eduall_library_books b
      WHERE b.ed_library_book_deleted = 0
        AND b.ed_library_book_institute_code = ?
        AND (
          b.ed_library_book_title  LIKE ?
          OR b.ed_library_book_author LIKE ?
          OR b.ed_library_book_classification LIKE ?
        )
      ORDER BY b.ed_library_book_title ASC
      LIMIT ?`;

    const rows = await ExecuteQuery(
      res, query,
      [institute, institute, institute, search, search, search, Number(limit)],
      true,
      { db: 'eduall_library_books', type: 'select', data: req },
    );

    res.status(200).json(rows);
  } catch (error) {
    res.status(500).json({ success: false, message: 'Erro ao buscar livros', error: error.message });
  }
};

/* ════════════════════════════════════════════════════════════════════════════
   GET — Histórico de reservas de um utilizador
════════════════════════════════════════════════════════════════════════════ */
const GetReservationHistoryByUser = async (req, res) => {
  try {
    const { USER_ID } = req.params;
    const institute   = inst(req);

    const query = `
      SELECT
        r.*,
        CONCAT('RES-', LPAD(r.ed_reservation_id, 4, '0')) AS ed_reservation_number,
        b.ed_library_book_title,
        b.ed_library_book_picture,
        b.ed_library_book_author
      FROM eduall_library_reservations r
      LEFT JOIN eduall_library_books b ON b.ed_library_book_id = r.ed_reservation_book_id
      WHERE r.ed_reservation_deleted = 0
        AND r.ed_reservation_user_id = ?
        AND r.ed_reservation_institute_code = ?
      ORDER BY r.ed_reservation_date DESC`;

    const rows = await ExecuteQuery(res, query, [USER_ID, institute], true, {
      db: 'eduall_library_reservations', type: 'select', data: req,
    });

    res.status(200).json(rows);
  } catch (error) {
    res.status(500).json({ success: false, message: 'Erro ao buscar histórico', error: error.message });
  }
};

/* ════════════════════════════════════════════════════════════════════════════
   POST — Registar Reserva Simplificada (usuário logado)
   Body: book_id
   Validação automática: multas, duplicados, livro válido
════════════════════════════════════════════════════════════════════════════ */
const RegisterReservationSimple = async (req, res) => {
  try {
    const institute = inst(req);
    const userId    = uid(req);
    const { book_id } = req.body;

    if (!book_id) {
      return res.status(400).json({ success: false, message: 'Selecione um livro' });
    }

    /* ── 1. Multas pendentes ──────────────────────────────────────────── */
    const finesCheck = await ExecuteQuery(res,
      `SELECT COUNT(*) AS total FROM eduall_library_fines
        WHERE ed_fine_user_id = ? AND ed_fine_status = 'pendente' AND ed_fine_deleted = 0`,
      [userId], true,
      { db: 'eduall_library_fines', type: 'select', data: req });

    if (finesCheck[0]?.total > 0) {
      return res.status(409).json({
        success: false,
        message: `Tem ${finesCheck[0].total} multa(s). Regularize para continuar`,
      });
    }

    /* ── 2. Já tem reserva activa para este livro? ────────────────────── */
    const dupCheck = await ExecuteQuery(res,
      `SELECT ed_reservation_id FROM eduall_library_reservations
        WHERE ed_reservation_user_id = ?
          AND ed_reservation_book_id = ?
          AND ed_reservation_status IN ('pendente','confirmada')
          AND ed_reservation_deleted = 0
        LIMIT 1`,
      [userId, book_id], true,
      { db: 'eduall_library_reservations', type: 'select', data: req });

    if (dupCheck.length) {
      return res.status(409).json({ success: false, message: 'Já tem esta reserva' });
    }

    /* ── 3. Livro existe nesta escola? ───────────────────────────────── */
    const bookCheck = await ExecuteQuery(res,
      `SELECT ed_library_book_id, ed_library_book_title FROM eduall_library_books
        WHERE ed_library_book_id = ? AND ed_library_book_institute_code = ? AND ed_library_book_deleted = 0 LIMIT 1`,
      [book_id, institute], true,
      { db: 'eduall_library_books', type: 'select', data: req });

    if (!bookCheck.length) {
      return res.status(404).json({ success: false, message: 'Livro não encontrado' });
    }

    /* ── 4. Calcular data de expiração ───────────────────────────────── */
    const reservation_date = new Date().toISOString().slice(0, 10);
    const expiryDate = addDays(reservation_date, DEFAULT_EXPIRY_DAYS);

    /* ── 5. Inserir reserva ──────────────────────────────────────────── */
    const result = await ExecuteQuery(res,
      `INSERT INTO eduall_library_reservations (
         ed_reservation_user_id,
         ed_reservation_book_id,
         ed_reservation_date,
         ed_reservation_expiry_date,
         ed_reservation_status,
         ed_reservation_registered_by,
         ed_reservation_institute_code
       ) VALUES (?, ?, ?, ?, 'pendente', ?, ?)`,
      [userId, book_id, reservation_date, expiryDate, userId, institute],
      false,
      { db: 'eduall_library_reservations', type: 'insert', data: req });

    await RegisterAuditAction({
      session:     req.session,
      action:      1,
      form:        'Reserva de Biblioteca',
      description: `Reservou "${bookCheck[0].ed_library_book_title}" — ${fmtNumber(result.insertId)}`,
    });

    res.status(200).json({
      success:            true,
      reservation_id:     result.insertId,
      reservation_number: fmtNumber(result.insertId),
      expiry_date:        expiryDate,
      message:            'Reserva registada com sucesso'
    });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Erro ao registar reserva', error: error.message });
  }
};

/* ════════════════════════════════════════════════════════════════════════════
   POST — Registar Reserva (admin, com user_id explícito)
   Body: user_id | book_id | reservation_date | expiry_days | notes
════════════════════════════════════════════════════════════════════════════ */
const RegisterReservation = async (req, res) => {
  try {
    const institute = inst(req);
    const userId    = uid(req);
    const {
      user_id,
      book_id,
      reservation_date = new Date().toISOString().slice(0, 10),
      expiry_days      = DEFAULT_EXPIRY_DAYS,
      notes,
    } = req.body;

    if (!user_id || !book_id) {
      return res.status(400).json({ success: false, message: 'Utilizador e livro são obrigatórios' });
    }

    /* ── 1. Utilizador pertence à escola? ─────────────────────────────── */
    const userCheck = await ExecuteQuery(res,
      `SELECT ed_user_account_id FROM eduall_user_accounts
        WHERE ed_user_account_id = ? AND ed_user_account_institute_code = ? AND ed_user_account_deleted = 0 LIMIT 1`,
      [user_id, institute], true,
      { db: 'eduall_user_accounts', type: 'select', data: req });

    if (!userCheck.length) {
      return res.status(403).json({ success: false, message: 'Utilizador não encontrado' });
    }

    /* ── 2. Multas pendentes ──────────────────────────────────────────── */
    const finesCheck = await ExecuteQuery(res,
      `SELECT COUNT(*) AS total FROM eduall_library_fines
        WHERE ed_fine_user_id = ? AND ed_fine_status = 'pendente' AND ed_fine_deleted = 0`,
      [user_id], true,
      { db: 'eduall_library_fines', type: 'select', data: req });

    if (finesCheck[0]?.total > 0) {
      return res.status(409).json({
        success: false,
        message: `Utilizador tem ${finesCheck[0].total} multa(s). Regularize para continuar`,
      });
    }

    /* ── 3. Já tem reserva activa para este livro? ────────────────────── */
    const dupCheck = await ExecuteQuery(res,
      `SELECT ed_reservation_id FROM eduall_library_reservations
        WHERE ed_reservation_user_id = ?
          AND ed_reservation_book_id = ?
          AND ed_reservation_status IN ('pendente','confirmada')
          AND ed_reservation_deleted = 0
        LIMIT 1`,
      [user_id, book_id], true,
      { db: 'eduall_library_reservations', type: 'select', data: req });

    if (dupCheck.length) {
      return res.status(409).json({ success: false, message: 'Este utilizador já tem esta reserva' });
    }

    /* ── 4. Livro existe nesta escola? ───────────────────────────────── */
    const bookCheck = await ExecuteQuery(res,
      `SELECT ed_library_book_id, ed_library_book_title FROM eduall_library_books
        WHERE ed_library_book_id = ? AND ed_library_book_institute_code = ? AND ed_library_book_deleted = 0 LIMIT 1`,
      [book_id, institute], true,
      { db: 'eduall_library_books', type: 'select', data: req });

    if (!bookCheck.length) {
      return res.status(404).json({ success: false, message: 'Livro não encontrado' });
    }

    /* ── 5. Calcular data de expiração ───────────────────────────────── */
    const expiryDate = addDays(reservation_date, Number(expiry_days) || DEFAULT_EXPIRY_DAYS);

    /* ── 6. Inserir reserva ──────────────────────────────────────────── */
    const result = await ExecuteQuery(res,
      `INSERT INTO eduall_library_reservations (
         ed_reservation_user_id,
         ed_reservation_book_id,
         ed_reservation_date,
         ed_reservation_expiry_date,
         ed_reservation_status,
         ed_reservation_notes,
         ed_reservation_registered_by,
         ed_reservation_institute_code
       ) VALUES (?, ?, ?, ?, 'pendente', ?, ?, ?)`,
      [user_id, book_id, reservation_date, expiryDate, notes || null, userId, institute],
      false,
      { db: 'eduall_library_reservations', type: 'insert', data: req });

    await RegisterAuditAction({
      session:     req.session,
      action:      1,
      form:        'Reserva de Biblioteca',
      description: `Registou reserva ${fmtNumber(result.insertId)} para utilizador ID ${user_id} — livro "${bookCheck[0].ed_library_book_title}"`,
    });

    res.status(200).json({
      success:            true,
      reservation_id:     result.insertId,
      reservation_number: fmtNumber(result.insertId),
      expiry_date:        expiryDate,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Erro ao registar reserva', error: error.message });
  }
};

/* ════════════════════════════════════════════════════════════════════════════
   PUT — Confirmar Reserva
   Atribui automaticamente o primeiro exemplar disponível do livro.
   Body: notes (opcional)
════════════════════════════════════════════════════════════════════════════ */
const ConfirmReservation = async (req, res) => {
  try {
    const { ID }    = req.params;
    const institute = inst(req);

    /* ── Buscar reserva ─────────────────────────────────────────────── */
    const resRows = await ExecuteQuery(res,
      `SELECT r.*, b.ed_library_book_title
         FROM eduall_library_reservations r
         LEFT JOIN eduall_library_books b ON b.ed_library_book_id = r.ed_reservation_book_id
        WHERE r.ed_reservation_id = ? AND r.ed_reservation_deleted = 0 AND r.ed_reservation_institute_code = ?`,
      [ID, institute], true,
      { db: 'eduall_library_reservations', type: 'select', data: req });

    if (!resRows.length) return res.status(404).json({ success: false, message: 'Reserva não encontrada' });

    const reservation = resRows[0];
    if (reservation.ed_reservation_status !== 'pendente') {
      return res.status(409).json({ success: false, message: 'Só é possível confirmar reservas pendentes' });
    }

    /* ── Verificar expiração ─────────────────────────────────────────── */
    if (new Date(reservation.ed_reservation_expiry_date) < new Date()) {
      await ExecuteQuery(res,
        `UPDATE eduall_library_reservations SET ed_reservation_status = 'expirada' WHERE ed_reservation_id = ?`,
        [ID], false,
        { db: 'eduall_library_reservations', type: 'update', data: req });
      return res.status(409).json({ success: false, message: 'Esta reserva expirou' });
    }

    /* ── Encontrar exemplar disponível ───────────────────────────────── */
    const exemplarRows = await ExecuteQuery(res,
      `SELECT ed_exemplar_id FROM eduall_library_exemplares
        WHERE ed_exemplar_book_id     = ?
          AND ed_exemplar_status      = 'disponivel'
          AND ed_exemplar_deleted     = 0
          AND ed_exemplar_institute_code = ?
        ORDER BY ed_exemplar_id ASC
        LIMIT 1`,
      [reservation.ed_reservation_book_id, institute], true,
      { db: 'eduall_library_exemplares', type: 'select', data: req });

    if (!exemplarRows.length) {
      return res.status(409).json({ success: false, message: 'Sem exemplares disponíveis agora' });
    }

    const exemplarId = exemplarRows[0].ed_exemplar_id;

    /* ── Atualizar reserva + reservar exemplar (em paralelo) ─────────── */
    await Promise.all([
      ExecuteQuery(res,
        `UPDATE eduall_library_reservations
            SET ed_reservation_status      = 'confirmada',
                ed_reservation_exemplar_id = ?,
                ed_reservation_confirm_notes = ?,
                ed_reservation_confirmed_at  = NOW()
          WHERE ed_reservation_id = ? AND ed_reservation_institute_code = ?`,
        [exemplarId, req.body.notes || null, ID, institute],
        false,
        { db: 'eduall_library_reservations', type: 'update', data: req }),

      ExecuteQuery(res,
        `UPDATE eduall_library_exemplares SET ed_exemplar_status = 'reservado'
          WHERE ed_exemplar_id = ?`,
        [exemplarId], false,
        { db: 'eduall_library_exemplares', type: 'update', data: req }),
    ]);

    await RegisterAuditAction({
      session:     req.session,
      action:      2,
      form:        'Reserva de Biblioteca',
      description: `Confirmou reserva ID ${ID} — exemplar ID ${exemplarId} atribuído`,
    });

    res.status(200).json({ success: true, exemplar_id: exemplarId, message: 'Reserva confirmada' });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Erro ao confirmar reserva', error: error.message });
  }
};

/* ════════════════════════════════════════════════════════════════════════════
   PUT — Cancelar Reserva
════════════════════════════════════════════════════════════════════════════ */
const CancelReservation = async (req, res) => {
  try {
    const { ID }    = req.params;
    const institute = inst(req);

    const resRows = await ExecuteQuery(res,
      `SELECT ed_reservation_id, ed_reservation_status, ed_reservation_exemplar_id
         FROM eduall_library_reservations
        WHERE ed_reservation_id = ? AND ed_reservation_deleted = 0 AND ed_reservation_institute_code = ?`,
      [ID, institute], true,
      { db: 'eduall_library_reservations', type: 'select', data: req });

    if (!resRows.length) return res.status(404).json({ success: false, message: 'Reserva não encontrada' });

    const reservation = resRows[0];
    if (!['pendente', 'confirmada'].includes(reservation.ed_reservation_status)) {
      return res.status(409).json({ success: false, message: 'Não é possível cancelar esta reserva' });
    }

    /* Se tinha exemplar reservado, libertar */
    const ops = [
      ExecuteQuery(res,
        `UPDATE eduall_library_reservations SET ed_reservation_status = 'cancelada', ed_reservation_cancelled_at = NOW()
          WHERE ed_reservation_id = ? AND ed_reservation_institute_code = ?`,
        [ID, institute], false,
        { db: 'eduall_library_reservations', type: 'update', data: req }),
    ];

    if (reservation.ed_reservation_exemplar_id) {
      ops.push(ExecuteQuery(res,
        `UPDATE eduall_library_exemplares SET ed_exemplar_status = 'disponivel'
          WHERE ed_exemplar_id = ? AND ed_exemplar_status = 'reservado'`,
        [reservation.ed_reservation_exemplar_id], false,
        { db: 'eduall_library_exemplares', type: 'update', data: req }));
    }

    await Promise.all(ops);

    await RegisterAuditAction({
      session:     req.session,
      action:      2,
      form:        'Reserva de Biblioteca',
      description: `Cancelou reserva ID ${ID}`,
    });

    res.status(200).json({ success: true, message: 'Reserva cancelada' });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Erro ao cancelar reserva', error: error.message });
  }
};

/* ════════════════════════════════════════════════════════════════════════════
   DELETE — Soft-delete de Reserva
════════════════════════════════════════════════════════════════════════════ */
const DeleteReservation = async (req, res) => {
  try {
    const { ID }    = req.params;
    const institute = inst(req);

    await ExecuteQuery(res,
      `UPDATE eduall_library_reservations SET ed_reservation_deleted = 1
        WHERE ed_reservation_id = ? AND ed_reservation_institute_code = ?`,
      [ID, institute], false,
      { db: 'eduall_library_reservations', type: 'update', data: req });

    await RegisterAuditAction({
      session:     req.session,
      action:      3,
      form:        'Reserva de Biblioteca',
      description: `Removeu reserva ID ${ID}`,
    }); 

    res.status(200).json({ success: true, message: 'Reserva removida' });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Erro ao remover reserva', error: error.message });
  }
};

/* ════════════════════════════════════════════════════════════════════════════
   Exports
════════════════════════════════════════════════════════════════════════════ */
module.exports = {
  GetMyReservations,
  GetReservations,
  GetReservationsKpis,
  GetReservationsChart,
  GetAvailableBooksForReservation,
  GetReservationHistoryByUser,
  RegisterReservationSimple,
  RegisterReservation,
  ConfirmReservation,
  CancelReservation,
  DeleteReservation,
};