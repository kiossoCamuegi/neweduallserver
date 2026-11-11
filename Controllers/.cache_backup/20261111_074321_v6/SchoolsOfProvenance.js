const ExecuteQuery = require("../Functions/ExecuteQuery");
const { RegisterAuditAction } = require("./Auditory");

const GetSchoolsOfProvenance = async (req, res) => {
    try {
        const query = `SELECT * FROM eduall_schools_of_provenance 
        WHERE ed_schools_of_provenance_deleted = 0 
        AND ed_schools_of_provenance_institute_code = ?  ORDER BY ed_schools_of_provenance_name ASC`;
        const PARAMS = [req.session.user.eduall_user_session_curentinstitute];
        const rows = await ExecuteQuery(res, query, PARAMS, true, { db: "eduall_schools_of_provenance", type: "select", data: req });
        res.status(200).json(rows);
    } catch (error) {
        res.status(500).json({ success: false, message: "Failed to fetch schools of provenance!", error: error.message });
    }
};

const GetSingleSchoolsOfProvenance = async (req, res) => {
    try { 
        const { ID } = req.params;  
        const query = `SELECT * FROM eduall_schools_of_provenance 
        WHERE ed_schools_of_provenance_deleted = 0 
        AND ed_schools_of_provenance_id = ? 
        AND ed_schools_of_provenance_institute_code = ?`;
        const PARAMS = [ID, req.session.user.eduall_user_session_curentinstitute];
        const rows = await ExecuteQuery(res, query, PARAMS, true, { db: "eduall_schools_of_provenance", type: "select", data: req });
        res.status(200).json(rows);
    } catch (error) {
        res.status(500).json({ success: false, message: "Failed to fetch school of provenance!", error: error.message });
    }
};

const RegisterSchoolsOfProvenance = async (req, res) => {  
    try {
        const query = `INSERT INTO eduall_schools_of_provenance(
            ed_schools_of_provenance_name, ed_schools_of_provenance_email, 
            ed_schools_of_provenance_address, ed_schools_of_provenance_country, 
            ed_schools_of_provenance_description, ed_schools_of_provenance_institute_code
        ) VALUES(?,?,?,?,?,?)`;
        const PARAMS = [
            req.body.schools_of_provenance_name, 
            req.body.schools_of_provenance_email,
            req.body.schools_of_provenance_address, 
            req.body.schools_of_provenance_country,
            req.body.schools_of_provenance_description, 
            req.session.user.eduall_user_session_curentinstitute
        ];
        const rows = await ExecuteQuery(res, query, PARAMS, false, { db: "eduall_schools_of_provenance", type: "insert", data: req });

        // Registrar ação no histórico de auditoria
        await RegisterAuditAction({
            session: req.session,
            action: 1,  // Ação de registro
            form: "Escolas de Proveniência",
            description: `Registrou uma nova escola de proveniência (${req.body.schools_of_provenance_name})`,
        });

        res.status(200).json(rows);
    } catch (error) {
        res.status(500).json({ success: false, message: "Failed to register school of provenance!", error: error.message });
    }
};

const SchoolsOfProvenanceDelete = async (req, res) => {
    try {
        const { ID } = req.params; 
        const query = `UPDATE eduall_schools_of_provenance 
        SET ed_schools_of_provenance_deleted = 1
        WHERE ed_schools_of_provenance_deleted = 0 
        AND ed_schools_of_provenance_id = ? 
        AND ed_schools_of_provenance_institute_code = ?`;
        const PARAMS = [ID, req.session.user.eduall_user_session_curentinstitute];
        const rows = await ExecuteQuery(res, query, PARAMS, false, { db: "eduall_schools_of_provenance", type: "update", data: req });

        // Registrar ação no histórico de auditoria
        await RegisterAuditAction({
            session: req.session,
            action: 3,  // Ação de eliminação
            form: "Escolas de Proveniência",
            description: `Eliminou a escola de proveniência com ID ${ID}`,
        });

        res.status(200).json(rows);
    } catch (error) {
        res.status(500).json({ success: false, message: "Failed to delete school of provenance!", error: error.message });
    }
};

const SchoolsOfProvenanceUpdate = async (req, res) => {
    try {
        const { ID } = req.params; 
        const query = `UPDATE eduall_schools_of_provenance 
        SET ed_schools_of_provenance_name = ?, 
            ed_schools_of_provenance_email = ?, 
            ed_schools_of_provenance_address = ?, 
            ed_schools_of_provenance_country = ?, 
            ed_schools_of_provenance_description = ? 
        WHERE ed_schools_of_provenance_deleted = 0 
        AND ed_schools_of_provenance_id = ? 
        AND ed_schools_of_provenance_institute_code = ?`;
        const PARAMS = [
            req.body.schools_of_provenance_name, 
            req.body.schools_of_provenance_email, 
            req.body.schools_of_provenance_address, 
            req.body.schools_of_provenance_country, 
            req.body.schools_of_provenance_description, 
            ID, 
            req.session.user.eduall_user_session_curentinstitute
        ];
        const rows = await ExecuteQuery(res, query, PARAMS, false, { db: "eduall_schools_of_provenance", type: "update", data: req });

        // Registrar ação no histórico de auditoria
        await RegisterAuditAction({
            session: req.session,
            action: 2,  // Ação de atualização
            form: "Escolas de Proveniência",
            description: `Atualizou a escola de proveniência (${req.body.schools_of_provenance_name}) com ID ${ID}`,
        });

        res.status(200).json(rows);
    } catch (error) {
        res.status(500).json({ success: false, message: "Failed to update school of provenance!", error: error.message });
    }
};

module.exports = {
    GetSchoolsOfProvenance, 
    GetSingleSchoolsOfProvenance, 
    RegisterSchoolsOfProvenance, 
    SchoolsOfProvenanceDelete, 
    SchoolsOfProvenanceUpdate
};

 