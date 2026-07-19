const ExecuteQuery = require("../Functions/ExecuteQuery");
const { RegisterAuditAction } = require("./Auditory");

const GetStudentEnrollments = async (req, res) => {
    try {
        const query = `SELECT * FROM eduall_student_enrollment WHERE ed_student_enrollment_deleted = 0 AND ed_enrollment_institute_code = ?`;
        const PARAMS = [req.session.user.eduall_user_session_curentinstitute];
        const rows = await ExecuteQuery(res, query, PARAMS, true, { db: "eduall_student_enrollment", type: "select", data: req });
        res.status(200).json(rows);
    } catch (error) {
        res.status(500).json({ success: false, message: "Erro ao buscar matrículas!", error: error.message });
    }
};

const GetSingleStudentEnrollment = async (req, res) => {
    try {
        const { ID } = req.params;
        const query = `SELECT * FROM eduall_student_enrollment WHERE ed_student_enrollment_deleted = 0 AND ed_student_enrollment_id = ? AND ed_enrollment_institute_code = ?`;
        const PARAMS = [ID, req.session.user.eduall_user_session_curentinstitute];
        const rows = await ExecuteQuery(res, query, PARAMS, true, { db: "eduall_student_enrollment", type: "select", data: req });
        res.status(200).json(rows);
    } catch (error) {
        res.status(500).json({ success: false, message: "Erro ao buscar matrícula!", error: error.message });
    }
};

const CheckExistentStudentEnrollment = async (req, res) => {
    try {
        const { STUDENT } = req.params;
        const query = `SELECT * FROM eduall_student_enrollment WHERE ed_student_enrollment_deleted = 0 AND ed_student_enrollment_studentcode = ? AND ed_enrollment_institute_code = ?`;
        const PARAMS = [STUDENT, req.session.user.eduall_user_session_curentinstitute];
        const rows = await ExecuteQuery(res, query, PARAMS, true, { db: "eduall_student_enrollment", type: "select", data: req });
        res.status(200).json(rows);
    } catch (error) {
        res.status(500).json({ success: false, message: "Erro ao verificar matrícula existente!", error: error.message });
    }
};


const RegisterStudentEnrollment = async (req, res) => {
    try {

        const institute = req.session.user.eduall_user_session_curentinstitute;
        const studentCode = req.body.student_enrollment_code;
        const newClass = req.body.student_enrollment_class;

        /* 1. Registrar matrícula */
        const query = `
        INSERT INTO eduall_student_enrollment 
        (ed_student_enrollment_studentcode, ed_student_enrollment_service, ed_student_enrollment_class, ed_enrollment_institute_code) 
        VALUES (?, ?, ?, ?)
        `;

        const PARAMS = [
            studentCode,
            req.body.student_enrollment_service,
            newClass,
            institute
        ];

        await ExecuteQuery(res, query, PARAMS, false, { db: "eduall_student_enrollment", type: "insert", data: req });


        /* 2. Buscar aluno */
        const studentQuery = `
        SELECT ed_student_id, ed_student_class
        FROM eduall_students
        WHERE ed_student_code = ? 
        AND ed_student_institute_code = ?
        LIMIT 1
        `;

        const student = await ExecuteQuery(res, studentQuery, [studentCode, institute]);

        if (!student.length) {
            return res.status(404).json({ success: false, message: "Aluno não encontrado." });
        }

        const studentId = student[0].ed_student_id;
        const oldClass = student[0].ed_student_class;


        /* 3. Verificar se o aluno já tinha turma */
        if (oldClass && oldClass != newClass) {

            const oldYearQuery = `
            SELECT ed_class_year
            FROM eduall_class
            WHERE ed_class_id = ?
            `;

            const newYearQuery = `
            SELECT ed_class_year
            FROM eduall_class
            WHERE ed_class_id = ?
            `;

            const oldYear = await ExecuteQuery(res, oldYearQuery, [oldClass]);
            const newYear = await ExecuteQuery(res, newYearQuery, [newClass]);

            /* 4. Se o ano lectivo for diferente, guardar turma antiga */
            if (
                oldYear.length &&
                newYear.length &&
                oldYear[0].ed_class_year !== newYear[0].ed_class_year
            ) {

                const insertOldClassQuery = `
                INSERT INTO eduall_student_old_classes 
                (ed_student_old_class_student, ed_student_old_class)
                VALUES (?, ?)
                `;

                await ExecuteQuery(res, insertOldClassQuery, [studentId, oldClass]);
            }
        }


        /* 5. Atualizar turma atual do aluno */
        const updateStudentClassQuery = `
        UPDATE eduall_students
        SET ed_student_class = ?
        WHERE ed_student_id = ?
        `;

        await ExecuteQuery(res, updateStudentClassQuery, [newClass, studentId]);


        /* 6. Auditoria */
        await RegisterAuditAction({
            session: req.session,
            action: 1,
            form: "Matrículas",
            description: `Registrou uma nova matrícula para o estudante #${studentCode}`,
        });


        res.status(200).json({
            success: true,
            msg: "Matrícula registrada e turma do aluno atualizada com sucesso."
        });

    } catch (error) {

        res.status(500).json({
            success: false,
            message: "Erro ao registrar matrícula.",
            error: error.message
        });

    }
};











const StudentEnrollmentDelete = async (req, res) => {
    try {
        const { ID } = req.params;
        const query = `UPDATE eduall_student_enrollment SET ed_student_enrollment_deleted = 1 WHERE ed_student_enrollment_deleted = 0 AND ed_student_enrollment_id = ? AND ed_enrollment_institute_code = ?`;
        const PARAMS = [ID, req.session.user.eduall_user_session_curentinstitute];
        await ExecuteQuery(res, query, PARAMS, false, { db: "eduall_student_enrollment", type: "update", data: req });

        await RegisterAuditAction({
            session: req.session,
            action: 3,  // Ação de eliminação
            form: "Matrículas",
            description: `Eliminou a matrícula com ID ${ID}`,
        });

        res.status(200).json({ success: true, msg: "Matrícula excluída com sucesso!" });
    } catch (error) {
        res.status(500).json({ success: false, message: "Erro ao excluir matrícula!", error: error.message });
    }
};

const StudentEnrollmentUpdate = async (req, res) => {
    try {
        const { ID } = req.params;
        const { enrollment_service, enrollment_class } = req.body;
        const query = `UPDATE eduall_student_enrollment SET ed_student_enrollment_service = ? WHERE ed_student_enrollment_deleted = 0 AND ed_student_enrollment_id = ? AND ed_enrollment_institute_code = ?`;
        const PARAMS = [enrollment_service, ID, req.session.user.eduall_user_session_curentinstitute];
        await ExecuteQuery(res, query, PARAMS, false, { db: "eduall_student_enrollment", type: "update", data: req });

        await RegisterAuditAction({
            session: req.session,
            action: 2,  // Ação de atualização
            form: "Matrículas",
            description: `Atualizou a matrícula com ID ${ID}`,
        });

        res.status(200).json({ success: true, msg: "Matrícula atualizada com sucesso!" });
    } catch (error) {
        res.status(500).json({ success: false, message: "Erro ao atualizar matrícula!", error: error.message });
    }
};

module.exports = {
    GetStudentEnrollments,
    GetSingleStudentEnrollment,
    CheckExistentStudentEnrollment,
    RegisterStudentEnrollment,
    StudentEnrollmentDelete,
    StudentEnrollmentUpdate
};
 