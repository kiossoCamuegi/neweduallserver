const ExecuteQuery = require("../Functions/ExecuteQuery");
const { RegisterAuditAction } = require("./Auditory");

const GetRacks = async(req, res) => {
    try {
        const query = 'SELECT * FROM eduall_library_racks WHERE ed_library_rack_deleted = 0 AND ed_library_rack_institute_code = ?  ORDER BY ed_library_rack_name ASC';
        const PARAMS = [req.session.user.eduall_user_session_curentinstitute];
        const result = await ExecuteQuery(res, query, PARAMS, true, { db: "eduall_library_racks", type: "select" });
        res.status(200).json(result);
    } catch (error) {
        res.status(500).json({ msg: "Falha ao obter a prateleira !", success: false, error: error.message });
    }
};

const GetSingleRack = async(req, res) => {
    try {
        const { ID } = req.params;
        const query = 'SELECT * FROM eduall_library_racks WHERE ed_library_rack_deleted = 0 AND ed_library_rack_id = ? AND ed_library_rack_institute_code = ?';
        const PARAMS = [ID, req.session.user.eduall_user_session_curentinstitute];
        const result = await ExecuteQuery(res, query, PARAMS, true, { db: "eduall_library_racks", type: "select" });
        res.status(200).json(result);
    } catch (error) {
        res.status(500).json({ msg: "Falha ao obter a prateleira!", success: false, error: error.message });
    }
};

const RegisterRack = async(req, res) => {
    try {
        const query = `INSERT INTO eduall_library_racks(ed_library_rack_name, ed_library_rack_status, ed_library_rack_institute_code) VALUES(?,?,?)`;
        const PARAMS = [req.body.rack_name, req.body.rack_status, req.session.user.eduall_user_session_curentinstitute];
        const result = await ExecuteQuery(res, query, PARAMS, false, { db: "eduall_library_racks", type: "insert", data: req });

        await RegisterAuditAction({
            session: req.session,
            action: 1,  // Ação de registro
            form: "Prateleiras",
            description: `Registrou uma nova prateleira (${req.body.rack_name}) com o status ${req.body.rack_status}`,
        });

        res.status(201).json(result);
    } catch (error) {
        res.status(500).json({ msg: "Falha ao registrar a prateleira!", success: false, error: error.message });
    }
};

const RackDelete = async(req, res) => {
    try {
        const { ID } = req.params;
        const query = `UPDATE eduall_library_racks SET ed_library_rack_deleted = 1 WHERE ed_library_rack_deleted = 0 AND ed_library_rack_id = ? AND ed_library_rack_institute_code = ?`;
        const PARAMS = [ID, req.session.user.eduall_user_session_curentinstitute];
        const result = await ExecuteQuery(res, query, PARAMS, false, { db: "eduall_library_racks", type: "update", data: req });

        await RegisterAuditAction({
            session: req.session,
            action: 3,  // Ação de eliminação
            form: "Prateleiras",
            description: `Eliminou a prateleira com ID ${ID}`,
        });

        res.status(200).json(result);
    } catch (error) {
        res.status(500).json({ msg: "Falha ao deletar a prateleira!", success: false, error: error.message });
    }
};

const RackUpdate = async(req, res) => {
    try {
        const { ID } = req.params;
        const { rack_name, rack_status } = req.body;
        const query = `UPDATE eduall_library_racks SET ed_library_rack_name = ?, ed_library_rack_status = ? WHERE ed_library_rack_deleted = 0 AND ed_library_rack_id = ? AND ed_library_rack_institute_code = ?`;
        const PARAMS = [rack_name, rack_status, ID, req.session.user.eduall_user_session_curentinstitute];
        const result = await ExecuteQuery(res, query, PARAMS, false, { db: "eduall_library_racks", type: "update", data: req });

        await RegisterAuditAction({
            session: req.session,
            action: 2,  // Ação de atualização
            form: "Prateleiras",
            description: `Atualizou a prateleira (${rack_name}) com o status ${rack_status} e ID ${ID}`,
        });

        res.status(200).json(result);
    } catch (error) {
        res.status(500).json({ msg: "Falha ao atualizar a prateleira !", success: false, error: error.message });
    }
};

module.exports = { GetRacks, GetSingleRack, RegisterRack, RackDelete, RackUpdate };
