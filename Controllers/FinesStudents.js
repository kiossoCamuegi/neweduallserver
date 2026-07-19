const ExecuteQuery = require("../Functions/ExecuteQuery");
const { RegisterAuditAction } = require("./Auditory");

const GetFinesStudents = async (req, res) => {
    try {
        const query = 'SELECT * FROM eduall_fines_students WHERE ed_fine_student_deleted = 0 AND ed_fine_student_institute_code = ?';
        const PARAMS = [req.session.user.eduall_user_session_curentinstitute];
        const result = await ExecuteQuery(res, query, PARAMS, true, { db: "eduall_fines_students", type: "select", data: req });
        res.status(200).json(result);
    } catch (error) {
        res.status(500).json({ success: false, message: "Falha ao buscar as multas dos alunos!", error: error.message });
    }
};

const GetSingleFineStudent = async (req, res) => {
    try {
        const { ID } = req.params;
        const query = 'SELECT * FROM eduall_fines_students WHERE ed_fine_student_deleted = 0 AND ed_fine_students_id = ?';
        const PARAMS = [ID];
        const result = await ExecuteQuery(res, query, PARAMS, true, { db: "eduall_fines_students", type: "select", data: req });
        res.status(200).json(result);
    } catch (error) {
        res.status(500).json({ success: false, message: "Falha ao buscar a multa do aluno!", error: error.message });
    }
};

const GetAllFinesStudentByCode = async (req, res) => {
    try {
        const { CODE } = req.params;
        const query = 'SELECT * FROM eduall_fines_students WHERE ed_fine_student_deleted = 0 AND ed_fine_student_fineCode = ?';
        const PARAMS = [CODE];
        const result = await ExecuteQuery(res, query, PARAMS, true, { db: "eduall_fines_students", type: "select", data: req });
        res.status(200).json(result);
    } catch (error) {
        res.status(500).json({ success: false, message: "Falha ao buscar as multas dos alunos pelo código!", error: error.message });
    }
};

const RegisterFineStudent = async (req, res) => {
    try {
        const query = `INSERT INTO eduall_fines_students(ed_fine_student_id, ed_fine_student_fineCode, ed_fine_student_institute_code) VALUES(?,?,?)`;
        const PARAMS = [req.body.fine_student_code, req.body.fine_student_fineCode, req.session.user.eduall_user_session_curentinstitute];
        const result = await ExecuteQuery(res, query, PARAMS, false, { db: "eduall_fines_students", type: "insert", data: req });

        // Registrar ação de auditoria
        await RegisterAuditAction({
            session: req.session,
            action: 1,  // Ação de registro
            form: "Multas de Alunos",
            description: `Registrou uma nova multa para o aluno com o nº de matrícula #${req.body.fine_student_code} e multa ${req.body.fine_student_fineCode}`,
        });

        res.status(200).json({ success: true, message: "Multa do aluno registrada com sucesso!", data: result });
    } catch (error) {
        res.status(500).json({ success: false, message: "Falha ao registrar a multa do aluno!", error: error.message });
    }
};

const FineStudentDelete = async (req, res) => {
    try {
        const { ID } = req.params;
        const query = `UPDATE eduall_fines_students SET ed_fine_student_deleted = 1
        WHERE ed_fine_student_deleted = 0 AND ed_fine_students_id = ?`;
        const PARAMS = [ID];
        const result = await ExecuteQuery(res, query, PARAMS, false, { db: "eduall_fines_students", type: "update", data: req });

        // Registrar ação de auditoria
        await RegisterAuditAction({
            session: req.session,
            action: 3,  // Ação de eliminação
            form: "Multas de Alunos",
            description: `Eliminou a multa com ID ${ID}`,
        });

        res.status(200).json({ success: true, message: "Multa do aluno deletada com sucesso!", data: result });
    } catch (error) {
        res.status(500).json({ success: false, message: "Falha ao deletar a multa do aluno!", error: error.message });
    }
};

const FineStudentsUpdate = async (req, res) => {
    try {
        const { ID } = req.params;
        const { fine_student_fineCode, fine_student_code } = req.body;
        const query = `UPDATE eduall_fines_students SET ed_fine_student_fineCode = ?, ed_fine_student_id = ?
        WHERE ed_fine_student_deleted = 0 AND ed_fine_students_id = ?`;
        const PARAMS = [fine_student_fineCode, fine_student_code, ID];
        const result = await ExecuteQuery(res, query, PARAMS, false, { db: "eduall_fines_students", type: "update", data: req });

        // Registrar ação de auditoria
        await RegisterAuditAction({
            session: req.session,
            action: 2,  // Ação de atualização
            form: "Multas de Alunos",
            description: `Atualizou a multa do aluno com nº de matrícula #${fine_student_code}, código de multa: ${fine_student_fineCode}`,
        });

        res.status(200).json({ success: true, message: "Multa do aluno atualizada com sucesso!", data: result });
    } catch (error) {
        res.status(500).json({ success: false, message: "Falha ao atualizar a multa do aluno!", error: error.message });
    }
};

module.exports = { GetFinesStudents, GetSingleFineStudent, GetAllFinesStudentByCode, RegisterFineStudent, FineStudentDelete, FineStudentsUpdate };

 