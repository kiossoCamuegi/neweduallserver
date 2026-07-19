const ExecuteQuery = require("../Functions/ExecuteQuery");
const { RegisterAuditAction } = require("./Auditory");

const GetFinesRestrictions = async (req, res) => {
    try {
        const query = 'SELECT * FROM eduall_fines_restrictions WHERE ed_fine_restriction_deleted = 0 AND ed_fine_restriction_institute_code = ?';
        const PARAMS = [req.session.user.eduall_user_session_curentinstitute];
        const result = await ExecuteQuery(res, query, PARAMS, true, { db: "eduall_fines_restrictions", type: "select", data: req });
        res.status(200).json(result);
    } catch (error) {
        res.status(500).json({ success: false, message: "Falha ao buscar restrições de multa!", error: error.message });
    }
};

const GetSingleFineRestriction = async (req, res) => {
    try {
        const { ID } = req.params;
        const query = 'SELECT * FROM eduall_fines_restrictions WHERE ed_fine_restriction_deleted = 0 AND ed_fine_restriction_id = ? AND ed_fine_restriction_institute_code = ?';
        const PARAMS = [ID, req.session.user.eduall_user_session_curentinstitute];
        const result = await ExecuteQuery(res, query, PARAMS, true, { db: "eduall_fines_restrictions", type: "select", data: req });
        res.status(200).json(result);
    } catch (error) {
        res.status(500).json({ success: false, message: "Falha ao buscar restrição de multa!", error: error.message });
    }
};

const GetAllFinesRestrictionsByCode = async (req, res) => {
    try {
        const { CODE } = req.params;
        const query = `SELECT * FROM eduall_fines_restrictions WHERE ed_fine_restriction_deleted = 0 
        AND ed_fine_restriction_for_elCode = ? AND ed_fine_restriction_institute_code = ?`;
        const PARAMS = [CODE, req.session.user.eduall_user_session_curentinstitute];
        const result = await ExecuteQuery(res, query, PARAMS, true, { db: "eduall_fines_restrictions", type: "select", data: req });
        res.status(200).json(result);
    } catch (error) {
        res.status(500).json({ success: false, message: "Falha ao buscar restrições de multa pelo código!", error: error.message });
    }
};

const RegisterFineRestriction = async (req, res) => {
    try {
        const query = `INSERT INTO eduall_fines_restrictions(ed_fine_restriction_fineCode, ed_fine_restriction_for,
        ed_fine_restriction_type, ed_fine_restriction_for_elCode, ed_fine_restriction_institute_code) VALUES(?,?,?,?,?)`;
        const PARAMS = [req.body.fine_restriction_fineCode, req.body.fine_restriction_for,
        req.body.fine_restriction_type, req.body.fine_restriction_for_elCode, req.session.user.eduall_user_session_curentinstitute];
        const result = await ExecuteQuery(res, query, PARAMS, false, { db: "eduall_fines_restrictions", type: "insert", data: req });

        // Registrar ação de auditoria
        await RegisterAuditAction({
            session: req.session,
            action: 1,  // Ação de registro
            form: "Restrições de Multa",
            description: `Registrou uma nova restrição de multa com o código ${req.body.fine_restriction_fineCode}`,
        });

        res.status(200).json({ success: true, message: "Restrição de multa registrada com sucesso!", data: result });
    } catch (error) {
        res.status(500).json({ success: false, message: "Falha ao registrar a restrição de multa!", error: error.message });
    }
};

const FineRestrictionDelete = async (req, res) => {
    try {
        const { ID } = req.params;
        const query = `UPDATE eduall_fines_restrictions SET ed_fine_restriction_deleted = 1
        WHERE ed_fine_restriction_deleted = 0 AND ed_fine_restriction_id = ? AND ed_fine_restriction_institute_code = ?`;
        const PARAMS = [ID, req.session.user.eduall_user_session_curentinstitute];
        const result = await ExecuteQuery(res, query, PARAMS, false, { db: "eduall_fines_restrictions", type: "update", data: req });

        // Registrar ação de auditoria
        await RegisterAuditAction({
            session: req.session,
            action: 3,  // Ação de eliminação
            form: "Restrições de Multa",
            description: `Eliminou a restrição de multa com ID ${ID}`,
        });

        res.status(200).json({ success: true, message: "Restrição de multa deletada com sucesso!", data: result });
    } catch (error) {
        res.status(500).json({ success: false, message: "Falha ao deletar a restrição de multa!", error: error.message });
    }
};

const FineRestrictionUpdate = async (req, res) => {
    try {
        const { ID } = req.params;
        const { fine_restriction_fineCode, fine_restriction_for, fine_restriction_type, fine_restriction_for_elCode } = req.body;
        const query = `UPDATE eduall_fines_restrictions SET ed_fine_restriction_fineCode = ? ,ed_fine_restriction_for = ?, 
        ed_fine_restriction_type = ?, ed_fine_restriction_for_elCode = ? 
        WHERE ed_fine_restriction_deleted = 0 AND ed_fine_restriction_id = ? AND ed_fine_restriction_institute_code = ?`;
        const PARAMS = [fine_restriction_fineCode, fine_restriction_for, fine_restriction_type, 
        fine_restriction_for_elCode, ID, req.session.user.eduall_user_session_curentinstitute];
        const result = await ExecuteQuery(res, query, PARAMS, false, { db: "eduall_fines_restrictions", type: "update", data: req });

        // Registrar ação de auditoria
        await RegisterAuditAction({
            session: req.session,
            action: 2,  // Ação de atualização
            form: "Restrições de Multa",
            description: `Atualizou a restrição de multa com código ${fine_restriction_fineCode} e ID ${ID}`,
        });

        res.status(200).json({ success: true, message: "Restrição de multa atualizada com sucesso!", data: result });
    } catch (error) {
        res.status(500).json({ success: false, message: "Falha ao atualizar a restrição de multa!", error: error.message });
    }
};

module.exports = { GetFinesRestrictions, GetSingleFineRestriction, GetAllFinesRestrictionsByCode, RegisterFineRestriction, FineRestrictionDelete, FineRestrictionUpdate };

 