const ExecuteQuery = require("../Functions/ExecuteQuery");
const { RegisterAuditAction } = require("./Auditory");

const GetFines = async (req, res) => {
    try {
        const query = `SELECT * FROM eduall_fines 
        LEFT JOIN eduall_services ON eduall_services.ed_service_id = eduall_fines.ed_fine_service
        LEFT JOIN eduall_coins ON eduall_coins.ed_coin_id = eduall_services.ed_service_coin
        WHERE eduall_services.ed_service_deleted = 0  AND ed_fine_deleted = 0 AND ed_fine_institute_code = ?`;
        const PARAMS = [req.session.user.eduall_user_session_curentinstitute];
        const result = await ExecuteQuery(res, query, PARAMS, true, { db: "eduall_fines", type: "select", data: req });
        res.status(200).json(result);
    } catch (error) {
        res.status(500).json({ success: false, message: "Falha ao buscar multas!", error: error.message });
    }
};

const GetSingleFine = async (req, res) => {
    try {
        const { ID } = req.params;
        const query = 'SELECT * FROM eduall_fines WHERE ed_fine_deleted = 0 AND ed_fine_institute_code = ? AND ed_fine_id = ?';
        const PARAMS = [req.session.user.eduall_user_session_curentinstitute, ID];
        const result = await ExecuteQuery(res, query, PARAMS, true, { db: "eduall_fines", type: "select", data: req });
        res.status(200).json(result);
    } catch (error) {
        res.status(500).json({ success: false, message: "Falha ao buscar multa!", error: error.message });
    }
};

const GetSingleFineByCode = async (req, res) => {
    try {
        const { CODE } = req.params;
        const query = 'SELECT * FROM eduall_fines WHERE ed_fine_deleted = 0 AND ed_fine_institute_code = ? AND ed_fine_code = ?';
        const PARAMS = [req.session.user.eduall_user_session_curentinstitute, CODE];
        const result = await ExecuteQuery(res, query, PARAMS, true, { db: "eduall_fines", type: "select", data: req });
        res.status(200).json(result);
    } catch (error) {
        res.status(500).json({ success: false, message: "Falha ao buscar multa pelo código!", error: error.message });
    }
};

const GetSingleFineByService = async (req, res) => {
    try {
        const { SERVICE } = req.params;
        const query = 'SELECT * FROM eduall_fines WHERE ed_fine_deleted = 0 AND ed_fine_service = ? AND ed_fine_institute_code = ?';
        const PARAMS = [SERVICE, req.session.user.eduall_user_session_curentinstitute];
        const result = await ExecuteQuery(res, query, PARAMS, true, { db: "eduall_fines", type: "select", data: req });
        res.status(200).json(result);
    } catch (error) {
        res.status(500).json({ success: false, message: "Falha ao buscar multa pelo serviço!", error: error.message });
    }
};

const RegisterFine = async (req, res) => {
    try {
        const query = `INSERT INTO eduall_fines(ed_fine_code, ed_fine_service, ed_fine_value_type, ed_fine_value, ed_fine_for_scholarshipholders,
        ed_fine_increment_value, ed_fine_parentsChildrens, ed_fine_daysafterprevmonth, ed_fine_institute_code) 
        VALUES(?,?,?,?,?,?,?,?,?)`;
        const PARAMS = [req.body.fine_code, req.body.fine_servicecode, req.body.fine_valuetype, req.body.fine_value,
        req.body.fine_scholarshipholders, req.body.fine_Incdaysafterprevmonth, req.body.fine_forparentswthMrCh,
        req.body.fine_daysafterprevmonth, req.session.user.eduall_user_session_curentinstitute];
        const result = await ExecuteQuery(res, query, PARAMS, false, { db: "eduall_fines", type: "insert", data: req });

        await RegisterAuditAction({
            session: req.session,
            action: 1,  // Ação de registro
            form: "Multas",
            description: `Registrou uma nova multa com o código ${req.body.fine_code}`,
        });

        res.status(200).json({ success: true, message: "Multa registrada com sucesso!", data: result });
    } catch (error) {
        res.status(500).json({ success: false, message: "Falha ao registrar a multa!", error: error.message });
    }
};

const FineDelete = async (req, res) => {
    try {
        const { ID } = req.params;
        const query = `UPDATE eduall_fines SET ed_fine_deleted = 1
        WHERE ed_fine_deleted = 0 AND ed_fine_id = ? AND ed_fine_institute_code = ?`;
        const PARAMS = [ID, req.session.user.eduall_user_session_curentinstitute];
        const result = await ExecuteQuery(res, query, PARAMS, false, { db: "eduall_fines", type: "update", data: req });

        await RegisterAuditAction({
            session: req.session,
            action: 3,  // Ação de eliminação
            form: "Multas",
            description: `Eliminou a multa com ID ${ID}`,
        });

        res.status(200).json({ success: true, message: "Multa deletada com sucesso!", data: result });
    } catch (error) {
        res.status(500).json({ success: false, message: "Falha ao deletar a multa!", error: error.message });
    }
};

const FineUpdate = async (req, res) => {
    try {
        const { ID } = req.params;
        const { fine_code, fine_servicecode, fine_valuetype, fine_value, fine_scholarshipholders, fine_Incdaysafterprevmonth,
        fine_forparentswthMrCh, fine_daysafterprevmonth } = req.body;
        const query = `UPDATE eduall_fines SET ed_fine_code = ?, ed_fine_service = ?, ed_fine_value_type = ?, ed_fine_value = ?, 
        ed_fine_for_scholarshipholders = ?, ed_fine_increment_value = ?, ed_fine_parentsChildrens = ?,
        ed_fine_daysafterprevmonth = ? WHERE ed_fine_deleted = 0 AND ed_fine_id = ? AND ed_fine_institute_code = ?`;
        const PARAMS = [fine_code, fine_servicecode, fine_valuetype, fine_value, fine_scholarshipholders,
        fine_Incdaysafterprevmonth, fine_forparentswthMrCh, fine_daysafterprevmonth, ID, req.session.user.eduall_user_session_curentinstitute];
        const result = await ExecuteQuery(res, query, PARAMS, false, { db: "eduall_fines", type: "update", data: req });

        await RegisterAuditAction({
            session: req.session,
            action: 2,  // Ação de atualização
            form: "Multas",
            description: `Atualizou a multa com o código ${fine_code} e ID ${ID}`,
        });

        res.status(200).json({ success: true, message: "Multa atualizada com sucesso!", data: result });
    } catch (error) {
        res.status(500).json({ success: false, message: "Falha ao atualizar a multa!", error: error.message });
    }
};

module.exports = { GetFines, GetSingleFine, GetSingleFineByCode, GetSingleFineByService, RegisterFine, FineDelete, FineUpdate };
 