// CACHE-OPT v5 (aplicado por apply_cache_optimizations.py)
const { RegisterAuditAction } = require("./Auditory");
const ExecuteQuery = require("../Functions/ExecuteQuery");

// CACHE-OPT v5: cache por escola (chaves "<entidade>:<escola>:..."); uma falha de cache nunca parte o pedido
const Cache = require("../Functions/CacheRoutes");
const _cacheGet = async (key) => { try { const v = await Cache.eduallGet(key); return v === undefined ? null : v; } catch (e) { return null; } };
const _cacheSet = async (key, value, ttl) => { try { if (value !== undefined && value !== null) await Cache.eduallSet(key, value, ttl); } catch (e) { /* cache indisponível: ignorado */ } };
const _cacheClear = async (...patterns) => { for (const p of patterns) { try { await Cache.eduallClear(p); } catch (e) { /* ignorado */ } } };

// GET - Todos os pagamentos antigos
const GetOldPayments = async (req, res) => {
  try {
      const _ck = `oldPayments:${req.session.user.eduall_user_session_curentinstitute}:list`;
      const _hit = await _cacheGet(_ck);
      if (_hit !== null) return res.status(200).json(_hit);
    const query = `
      SELECT * FROM eduall_school_old_payments
      WHERE ed_sc_old_pay_deleted = 0
        AND ed_sc_old_pay_institute_code = ?
      ORDER BY ed_sc_old_pay_date DESC
    `;
    const PARAMS = [req.session.user.eduall_user_session_curentinstitute];
    const rows = await ExecuteQuery(res, query, PARAMS, true,
      { db: "eduall_school_old_payments", type: "select", data: req });
    await _cacheSet(_ck, rows, 300);
    res.status(200).json(rows);
  } catch (error) {
    res.status(500).json({ success: false, message: "Falha ao buscar pagamentos antigos!", error: error.message });
  }
};

// GET - Pagamento antigo único
const GetSingleOldPayment = async (req, res) => {
  try {
      const _ck = `oldPayments:${req.session.user.eduall_user_session_curentinstitute}:single:${req.params.ID}`;
      const _hit = await _cacheGet(_ck);
      if (_hit !== null) return res.status(200).json(_hit);
    const { ID } = req.params;
    const query = `
      SELECT * FROM eduall_school_old_payments
      WHERE ed_sc_old_pay_deleted = 0
        AND ed_sc_old_pay_id = ?
        AND ed_sc_old_pay_institute_code = ?
    `;
    const PARAMS = [ID, req.session.user.eduall_user_session_curentinstitute];
    const rows = await ExecuteQuery(res, query, PARAMS, true,
      { db: "eduall_school_old_payments", type: "select", data: req });
    await _cacheSet(_ck, rows, 300);
    res.status(200).json(rows);
  } catch (error) {
    res.status(500).json({ success: false, message: "Falha ao buscar o pagamento antigo!", error: error.message });
  }
};

// POST - Registrar pagamento antigo
const RegisterOldPayment = async (req, res) => {
  try {
    let { client, bank, reference, state, date, year, description, value, receipt_link } = req.body;
    let clientName = client;

    // Se o cliente for numérico, tenta buscar na tabela de alunos
    if (!isNaN(clientName)) {
      const studentQuery = `
        SELECT ed_student_name AS full_name
        FROM eduall_students
        WHERE ed_student_code = ?
          AND ed_student_institute_code = ?
          AND ed_student_status != 'deleted'
      `;
      const studentParams = [clientName, req.session.user.eduall_user_session_curentinstitute];
      const studentResult = await ExecuteQuery(res, studentQuery, studentParams, true, { db: "eduall_students", type: "select", data: req });
      if (studentResult.length > 0) {
        clientName = studentResult[0].full_name;
      }
    }

    const query = `
      INSERT INTO eduall_school_old_payments(
        ed_sc_old_pay_client, ed_sc_old_pay_bank, ed_sc_old_pay_reference, ed_sc_old_pay_state,
        ed_sc_old_pay_date, ed_sc_old_pay_year, ed_sc_old_pay_description, ed_sc_old_pay_value, ed_sc_old_pay_receipt_link,
        ed_sc_old_pay_institute_code
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;
    const PARAMS = [
      clientName, bank, reference, state,
      date, year, description, value, receipt_link,
      req.session.user.eduall_user_session_curentinstitute
    ];

    const rows = await ExecuteQuery(res, query, PARAMS, false,
      { db: "eduall_school_old_payments", type: "insert", data: req });

    await RegisterAuditAction({
      session: req.session,
      action: 1,
      form: "Pagamento Antigo",
      description: `Registrou pagamento antigo do cliente "${clientName}"`,
    });

    await _cacheClear(`oldPayments:${req.session.user.eduall_user_session_curentinstitute}:*`);
    res.status(200).json(rows);
  } catch (error) {
    res.status(500).json({ success: false, message: "Falha ao registrar pagamento antigo!", error: error.message });
  }
};

// PUT - Atualizar pagamento antigo
const UpdateOldPayment = async (req, res) => {
  try {
    const { ID } = req.params;
    let { client, bank, reference, state, date, year, description, value, receipt_link } = req.body;
    let clientName = client;

    if (!isNaN(clientName)) {
      const studentQuery = `
        SELECT ed_student_name AS full_name
        FROM eduall_students
        WHERE ed_student_code = ?
          AND ed_student_institute_code = ?
          AND ed_student_status != 'deleted'
      `;
      const studentParams = [clientName, req.session.user.eduall_user_session_curentinstitute];
      const studentResult = await ExecuteQuery(res, studentQuery, studentParams, true, { db: "eduall_students", type: "select", data: req });
      if (studentResult.length > 0) {
        clientName = studentResult[0].full_name;
      }
    }

    const query = `
      UPDATE eduall_school_old_payments
      SET ed_sc_old_pay_client = ?, ed_sc_old_pay_bank = ?, ed_sc_old_pay_reference = ?, ed_sc_old_pay_state = ?,
          ed_sc_old_pay_date = ?, ed_sc_old_pay_year = ?, ed_sc_old_pay_description = ?, ed_sc_old_pay_value = ?, ed_sc_old_pay_receipt_link = ?
      WHERE ed_sc_old_pay_deleted = 0
        AND ed_sc_old_pay_id = ?
        AND ed_sc_old_pay_institute_code = ?
    `;
    const PARAMS = [
      clientName, bank, reference, state,
      date, year, description, value, receipt_link,
      ID, req.session.user.eduall_user_session_curentinstitute
    ];

    const rows = await ExecuteQuery(res, query, PARAMS, false,
      { db: "eduall_school_old_payments", type: "update", data: req });

    await RegisterAuditAction({
      session: req.session,
      action: 2,
      form: "Pagamento Antigo",
      description: `Atualizou pagamento antigo do cliente "${clientName}" (ID: ${ID})`,
    });

    await _cacheClear(`oldPayments:${req.session.user.eduall_user_session_curentinstitute}:*`);
    res.status(200).json(rows);
  } catch (error) {
    res.status(500).json({ success: false, message: "Falha ao atualizar pagamento antigo!", error: error.message });
  }
};

// DELETE - Remover pagamento antigo
const DeleteOldPayment = async (req, res) => {
  try {
    const { ID } = req.params;
    const query = `
      UPDATE eduall_school_old_payments
      SET ed_sc_old_pay_deleted = 1
      WHERE ed_sc_old_pay_deleted = 0
        AND ed_sc_old_pay_id = ?
        AND ed_sc_old_pay_institute_code = ?
    `;
    const PARAMS = [ID, req.session.user.eduall_user_session_curentinstitute];
    const rows = await ExecuteQuery(res, query, PARAMS, false,
      { db: "eduall_school_old_payments", type: "update", data: req });

    await RegisterAuditAction({
      session: req.session,
      action: 3,
      form: "Pagamento Antigo",
      description: `Deletou pagamento antigo com ID "${ID}"`,
    });

    await _cacheClear(`oldPayments:${req.session.user.eduall_user_session_curentinstitute}:*`);
    res.status(200).json(rows);
  } catch (error) {
    res.status(500).json({ success: false, message: "Falha ao remover pagamento antigo!", error: error.message });
  }
};

module.exports = { GetOldPayments, GetSingleOldPayment, RegisterOldPayment, UpdateOldPayment, DeleteOldPayment };
