// CACHE-OPT v1 (aplicado por apply_cache_optimizations.py)
const { RegisterAuditAction } = require("./Auditory");
const ExecuteQuery = require("../Functions/ExecuteQuery");

const FetchAccountsPayableAndReceivable = async (req, res, instituteCode) => {
  const query = `SELECT * FROM eduall_accounts_payable_and_receivable 
       LEFT JOIN eduall_coins ON eduall_coins.ed_coin_institute_code = ed_accounts_payable_and_receivable_institute_code 
       WHERE ed_accounts_payable_and_receivable_deleted = 0 
       AND ed_accounts_payable_and_receivable_institute_code = ?`;
  return ExecuteQuery(res, query, [instituteCode], true, {
    db: "eduall_accounts_payable_and_receivable",
    type: "select",
    data: req,
  });
};

const GetAccountsPayableAndReceivable = async (req, res) => {
  try {
    const instituteCode = req.session.user.eduall_user_session_curentinstitute;
    const rows = await FetchAccountsPayableAndReceivable(req, res, instituteCode);
    res.status(200).json(rows);
  } catch (error) {
    res.status(500).json({ success: false, message: "Falha ao buscar contas!", error: error.message });
  }
};

const GetSingleAccountPayableAndReceivable = async (req, res) => {
  try {
    const { ID } = req.params;
    const instituteCode = req.session.user.eduall_user_session_curentinstitute;

    const query = 'SELECT * FROM eduall_accounts_payable_and_receivable WHERE ed_accounts_payable_and_receivable_deleted = 0 AND ed_account_payable_receivable_id = ? AND ed_accounts_payable_and_receivable_institute_code = ?';
    const rows = await ExecuteQuery(res, query, [ID, instituteCode], true, {
      db: "eduall_accounts_payable_and_receivable",
      type: "select",
      data: req,
    });

    res.status(200).json(rows);
  } catch (error) {
    res.status(500).json({ success: false, message: "Falha ao buscar conta!", error: error.message });
  }
};

const RegisterAccountPayableAndReceivable = async (req, res) => {
  try {
    const instituteCode = req.session.user.eduall_user_session_curentinstitute;

    const query = `INSERT INTO eduall_accounts_payable_and_receivable (ed_account_payable_and_receivable_competence_date, ed_accounts_payable_and_receivable_description, 
       ed_accounts_payable_and_receivable_client_or_supplier, ed_accounts_payable_and_receivable_payment_method, ed_accounts_payable_and_receivable_amount_payable, ed_accounts_payable_and_receivable_amount_receivable, ed_accounts_payable_and_receivable_institute_code) VALUES(?,?,?,?,?,?,?)`;
    const PARAMS = [
      req.body.ac_pay_rec_competence_date,
      req.body.ac_pay_rec_description,
      req.body.ac_pay_rec_client_or_supplier,
      req.body.ac_pay_rec_payment_method,
      req.body.ac_pay_rec_amount_payable,
      req.body.ac_pay_rec_amount_receivable,
      instituteCode,
    ];
    const rows = await ExecuteQuery(res, query, PARAMS, false, { db: "eduall_accounts_payable_and_receivable", type: "insert", data: req });

    await RegisterAuditAction({
      session: req.session,
      action: 1,
      form: "Contas a pagar e a receber",
      description: `Registrou uma nova conta.`,
    });

    console.log(`🗄️🐢 BASE DE DADOS (lento) -> RegisterAccountPayableAndReceivable: conta registada`);

    res.status(200).json(rows);
  } catch (error) {
    res.status(500).json({ success: false, message: "Falha ao registrar conta!", error: error.message });
  }
};

const DeleteAccountPayableAndReceivable = async (req, res) => {
  try {
    const { ID } = req.params;
    const instituteCode = req.session.user.eduall_user_session_curentinstitute;

    const query = `UPDATE eduall_accounts_payable_and_receivable SET ed_accounts_payable_and_receivable_deleted = 1 WHERE ed_accounts_payable_and_receivable_deleted = 0 AND ed_account_payable_receivable_id = ? AND ed_accounts_payable_and_receivable_institute_code = ?`;
    const rows = await ExecuteQuery(res, query, [ID, instituteCode], false, { db: "eduall_accounts_payable_and_receivable", type: "update", data: req });

    await RegisterAuditAction({
      session: req.session,
      action: 3,
      form: "Contas a pagar e a receber",
      description: `Eliminou a conta com ID ${ID}.`,
    });

    console.log(`🗄️🐢 BASE DE DADOS (lento) -> DeleteAccountPayableAndReceivable: registo ${ID} eliminado`);

    res.status(200).json(rows);
  } catch (error) {
    res.status(500).json({ success: false, message: "Falha ao eliminar conta!", error: error.message });
  }
};

const UpdateAccountPayableAndReceivable = async (req, res) => {
  try {
    const { ID } = req.params;
    const instituteCode = req.session.user.eduall_user_session_curentinstitute;
    const {
      ac_pay_rec_competence_date,
      ac_pay_rec_description,
      ac_pay_rec_client_or_supplier,
      ac_pay_rec_payment_method,
      ac_pay_rec_amount_payable,
      ac_pay_rec_amount_receivable,
    } = req.body;

    const query = `UPDATE eduall_accounts_payable_and_receivable SET ed_account_payable_and_receivable_competence_date = ?, ed_accounts_payable_and_receivable_description = ?, ed_accounts_payable_and_receivable_client_or_supplier = ?, ed_accounts_payable_and_receivable_payment_method = ?, ed_accounts_payable_and_receivable_amount_payable = ?, ed_accounts_payable_and_receivable_amount_receivable = ? WHERE ed_accounts_payable_and_receivable_deleted = 0 AND ed_account_payable_receivable_id = ? AND ed_accounts_payable_and_receivable_institute_code = ?`;
    const PARAMS = [
      ac_pay_rec_competence_date,
      ac_pay_rec_description,
      ac_pay_rec_client_or_supplier,
      ac_pay_rec_payment_method,
      ac_pay_rec_amount_payable,
      ac_pay_rec_amount_receivable,
      ID,
      instituteCode,
    ];
    const rows = await ExecuteQuery(res, query, PARAMS, false, { db: "eduall_accounts_payable_and_receivable", type: "update", data: req });

    await RegisterAuditAction({
      session: req.session,
      action: 2,
      form: "Contas a pagar e a receber",
      description: `Atualizou a conta com ID ${ID}.`,
    });

    console.log(`🗄️🐢 BASE DE DADOS (lento) -> UpdateAccountPayableAndReceivable: registo ${ID} atualizado`);

    res.status(200).json(rows);
  } catch (error) {
    res.status(500).json({ success: false, message: "Falha ao atualizar conta!", error: error.message });
  }
};

module.exports = {
  GetAccountsPayableAndReceivable,
  GetSingleAccountPayableAndReceivable,
  RegisterAccountPayableAndReceivable,
  DeleteAccountPayableAndReceivable,
  UpdateAccountPayableAndReceivable,
};