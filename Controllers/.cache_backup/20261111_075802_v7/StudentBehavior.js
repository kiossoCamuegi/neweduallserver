const ExecuteQuery = require("../Functions/ExecuteQuery");
const { RegisterAuditAction } = require("./Auditory");

const GetAllStudentBehavior = async (req, res) => {
    try {
        const query = `SELECT * FROM eduall_student_behavior 
                       WHERE ed_student_behavior_deleted = 0 
                       AND ed_student_behavior_instituteCode = ?`; 
        const PARAMS = [req.session.user.eduall_user_session_curentinstitute];
        const rows = await ExecuteQuery(res, query, PARAMS, true, { db: "eduall_student_behavior", type: "select", data: req });
        res.status(200).json(rows);
    } catch (error) {
        res.status(500).json({ success: false, message: "Erro ao buscar comportamentos!", error: error.message });
    }
};

const GetAllStudentBehaviorByStudentCode = async (req, res) => {
    try {
        const query = `SELECT * FROM eduall_student_behavior 
                       LEFT JOIN eduall_employees ON eduall_employees.ed_employee_id = eduall_student_behavior.ed_student_behavior_employeeCode
                       LEFT JOIN eduall_user_accounts ON eduall_user_accounts.ed_user_account_id = eduall_student_behavior.ed_student_behavior_user
                       WHERE eduall_student_behavior.ed_student_behavior_deleted = 0 
                       AND eduall_student_behavior.ed_student_behavior_Studentcode = ? 
                       AND eduall_student_behavior.ed_student_behavior_instituteCode = ?`; 
        const { ID } = req.params;  
        const PARAMS = [ID, req.session.user.eduall_user_session_curentinstitute];
        const rows = await ExecuteQuery(res, query, PARAMS, true, { db: "eduall_student_behavior", type: "select", data: req });
        res.status(200).json(rows);
    } catch (error) {
        res.status(500).json({ success: false, message: "Erro ao buscar comportamentos do estudante!", error: error.message });
    }
};

const RegisterStudentBehavior = async (req, res) => {
    try {
        const query = `INSERT INTO eduall_student_behavior (
                       ed_student_behavior_Studentcode, ed_student_behavior_description, ed_student_behavior_employeeCode, 
                       ed_student_behavior_stars, ed_student_behavior_classSub, ed_student_behavior_type, 
                       ed_student_behavior_user, ed_student_behavior_instituteCode) 
                       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`;
        const PARAMS = [
            req.body.student_behavior_code, req.body.student_behavior_description, req.body.student_behavior_employee, 
            req.body.student_behavior_stars, req.body.student_behavior_subClass, req.body.student_behavior_type, 
            req.session.user.eduall_user_session_ID, req.session.user.eduall_user_session_curentinstitute
        ];
        await ExecuteQuery(res, query, PARAMS, false, { db: "eduall_student_behavior", type: "insert", data: req });

        // Registro da ação de auditoria
        await RegisterAuditAction({
            session: req.session,
            action: 1,  // Ação de registro
            form: "Comportamentos dos Estudantes",
            description: `Registrou um novo comportamento para o estudante com o nº de matrícula  #${req.body.student_behavior_code}`,
        });

        res.status(200).json({ success: true, msg: "Comportamento registrado com sucesso!" });
    } catch (error) {
        res.status(500).json({ success: false, message: "Erro ao registrar comportamento!", error: error.message });
    }
};

const GetSingleStudentBehavior = async (req, res) => {
    try {
        const query = `SELECT * FROM eduall_student_behavior 
                       WHERE ed_student_behavior_deleted = 0 
                       AND ed_academic_year_id = ? 
                       AND ed_student_behavior_instituteCode = ?`;
        const { ID } = req.params;
        const PARAMS = [ID, req.session.user.eduall_user_session_curentinstitute];
        const rows = await ExecuteQuery(res, query, PARAMS, true, { db: "eduall_student_behavior", type: "select", data: req });
        res.status(200).json(rows);
    } catch (error) {
        res.status(500).json({ success: false, message: "Erro ao buscar comportamento!", error: error.message });
    }
};

const StudentBehaviorDelete = async (req, res) => {
    try {
        const query = `UPDATE eduall_student_behavior 
                       SET ed_student_behavior_deleted = 1
                       WHERE ed_student_behavior_deleted = 0 
                       AND ed_academic_year_id = ? 
                       AND ed_student_behavior_instituteCode = ?`;
        const { ID } = req.params;  
        const PARAMS = [ID, req.session.user.eduall_user_session_curentinstitute];
        await ExecuteQuery(res, query, PARAMS, false, { db: "eduall_student_behavior", type: "update", data: req });

        // Registro da ação de auditoria
        await RegisterAuditAction({
            session: req.session,
            action: 3,  // Ação de eliminação
            form: "Comportamentos dos Estudantes",
            description: `Eliminou o comportamento do estudante com ID ${ID}`,
        });

        res.status(200).json({ success: true, msg: "Comportamento excluído com sucesso!" });
    } catch (error) {
        res.status(500).json({ success: false, message: "Erro ao excluir comportamento!", error: error.message });
    }
};

const StudentBehaviorUpdate = async (req, res) => {
    try {
        const { ID } = req.params;
        const { description, stars, type } = req.body;
        const query = `UPDATE eduall_student_behavior 
                       SET ed_student_behavior_description = ?, 
                           ed_student_behavior_stars = ?, 
                           ed_student_behavior_type = ?
                       WHERE ed_student_behavior_deleted = 0 
                       AND ed_academic_year_id = ? 
                       AND ed_student_behavior_instituteCode = ?`; 
        const PARAMS = [description, stars, type, ID, req.session.user.eduall_user_session_curentinstitute];
        await ExecuteQuery(res, query, PARAMS, false, { db: "eduall_student_behavior", type: "update", data: req });

        // Registro da ação de auditoria
        await RegisterAuditAction({
            session: req.session,
            action: 2,  // Ação de atualização
            form: "Comportamentos dos Estudantes",
            description: `Atualizou o comportamento do estudant. ID do registro -  ${ID}`,
        });

        res.status(200).json({ success: true, msg: "Comportamento atualizado com sucesso!" });
    } catch (error) {
        res.status(500).json({ success: false, message: "Erro ao atualizar comportamento!", error: error.message });
    }
};
 

module.exports = {
    RegisterStudentBehavior, 
    GetAllStudentBehavior, 
    GetAllStudentBehaviorByStudentCode, 
    GetSingleStudentBehavior, 
    StudentBehaviorDelete, 
    StudentBehaviorUpdate
};
