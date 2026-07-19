const ExecuteQuery = require("../Functions/ExecuteQuery");
const { RegisterAuditAction } = require("./Auditory");
const { CheckQuarterlyNotePermission, CheckPresencePermission } = require("./NotesRestrictions");

const GetStudentAttendance = async (req, res) => {
    try {
        const query = `SELECT * FROM eduall_student_attendence WHERE ed_student_attd_deleted = 0 AND ed_student_attd_institute_code = ?`;
        const PARAMS = [req.session.user.eduall_user_session_curentinstitute];
        const rows = await ExecuteQuery(res, query, PARAMS, true, { db: "eduall_student_attendence", type: "select", data: req });
        res.status(200).json(rows);
    } catch (error) {
        res.status(400).json({ success: false, msg: error.message });
    }
};

const GetStudentAttendanceByTeacher = async (req, res) => {
    try {
        const query = `SELECT * FROM eduall_student_attendence WHERE ed_student_attd_deleted = 0 AND ed_student_attd_institute_code = ?`;
        const PARAMS = [req.session.user.eduall_user_session_curentinstitute];
        const rows = await ExecuteQuery(res, query, PARAMS, true, { db: "eduall_student_attendence", type: "select", data: req });
        res.status(200).json(rows);
    } catch (error) {
        res.status(400).json({ success: false, msg: error.message });
    }
};

const GetStudentAttendanceByTeacherAndClassSub = async (req, res) => {
    try {
        const { ID } = req.params;
        const query = `SELECT * FROM eduall_student_attendence 
        LEFT JOIN eduall_students ON eduall_students.ed_student_id = eduall_student_attendence.ed_student_attd_student_code
        LEFT JOIN eduall_timing ON eduall_timing.ed_timing_id = eduall_student_attendence.ed_student_attd_timing
        LEFT JOIN eduall_subjects ON eduall_subjects.ed_subject_id = eduall_student_attendence.ed_student_attd_subject
        WHERE eduall_student_attendence.ed_student_attd_deleted = 0 AND eduall_student_attendence.ed_student_attd_teacherSubClass = ?`;
        const PARAMS = [ID];
        const rows = await ExecuteQuery(res, query, PARAMS, true, { db: "eduall_student_attendence", type: "select", data: req });
        res.status(200).json(rows);
    } catch (error) {
        res.status(400).json({ success: false, msg: error.message });
    }
};

const GetSingleStudentAttendance = async (req, res) => {
    try {
        const { ID } = req.params;
        const query = `SELECT * FROM eduall_student_attendence WHERE ed_student_attd_deleted = 0 AND ed_student_attd_id = ?`;
        const PARAMS = [ID];
        const rows = await ExecuteQuery(res, query, PARAMS, true, { db: "eduall_student_attendence", type: "select", data: req });
        res.status(200).json(rows);
    } catch (error) {
        res.status(400).json({ success: false, msg: error.message });
    }
};

const CheckExistentSingleStudentAttendance = async (req, res) => {
    try {
        const { CLASS, STUDENT, TIME, SUBJECT, DATE, ID } = req.params;
        const query = `SELECT * FROM eduall_student_attendence WHERE ed_student_attd_class = ? AND ed_student_attd_student_code = ? 
        AND ed_student_attd_timing = ? AND ed_student_attd_subject = ? AND ed_student_attd_date = ? AND ed_student_attd_deleted = 0 AND ed_student_attd_id = ?`;
        const PARAMS = [CLASS, STUDENT, TIME, SUBJECT, DATE, ID];
        const rows = await ExecuteQuery(res, query, PARAMS, true, { db: "eduall_student_attendence", type: "select", data: req });
        res.status(200).json(rows);
    } catch (error) {
        res.status(400).json({ success: false, msg: error.message });
    }
};

const GetStudentAttendanceByClassSubStuQrt = async (req, res) => {
    try {
        const { CLASS, STUDENT, QRT, SUBJECT } = req.params;
        const query = `SELECT * FROM eduall_student_attendence WHERE ed_student_attd_class = ? AND ed_student_attd_student_code = ? 
        AND ed_student_attd_quarter = ? AND ed_student_attd_subject = ? AND ed_student_attd_deleted = 0`;
        const PARAMS = [CLASS, STUDENT, QRT, SUBJECT];
        const rows = await ExecuteQuery(res, query, PARAMS, true, { db: "eduall_student_attendence", type: "select", data: req });
        res.status(200).json(rows);
    } catch (error) {
        res.status(400).json({ success: false, msg: error.message });
    }
};

const UpdateExistentSingleStudentAttendance = async (req, res) => {
    try {
        const { ID } = req.params;
        const query = `UPDATE eduall_student_attendence SET ed_student_attd_deleted = 1 WHERE ed_student_attd_deleted = 0 AND ed_student_attd_id = ?`;
        const PARAMS = [ID];
        await ExecuteQuery(res, query, PARAMS, false, { db: "eduall_student_attendence", type: "update", data: req });
        res.status(200).json({ success: true, msg: "Atualização efetuada com sucesso!" });
    } catch (error) {
        res.status(400).json({ success: false, msg: error.message });
    }
};

const GetAllStudentAttendance = async (req, res) => {
    try {
        const { CODE, CLASS } = req.params;
        const query = `SELECT * FROM eduall_student_attendence   
        LEFT JOIN eduall_timing ON eduall_timing.ed_timing_id = eduall_student_attendence.ed_student_attd_timing
        LEFT JOIN eduall_subjects ON eduall_subjects.ed_subject_id = eduall_student_attendence.ed_student_attd_subject
        WHERE ed_student_attd_deleted = 0 and eduall_subjects.ed_subject_deleted = 0 AND eduall_timing.ed_timing_deleted = 0 AND ed_student_attd_student_code = ? AND ed_student_attd_class = ?`;
        const PARAMS = [CODE, CLASS];
        const rows = await ExecuteQuery(res, query, PARAMS, true, { db: "eduall_student_attendence", type: "select", data: req });

        console.log(rows)
        res.status(200).json(rows);
    } catch (error) {
        res.status(400).json({ success: false, msg: error.message });
    }
};

const RegisterStudentAttendance = async (req, res) => {
    try {
        
        const { allowed } = await CheckPresencePermission(req, res);
        if (!allowed) {return res.status(403).json({ success: false, msg: "Ação não permitida devido a restrição  pedagógica !"});}
        
        const query = `INSERT INTO eduall_student_attendence(ed_student_attd_class, ed_student_attd_student_code, ed_student_attd_timing, ed_student_attd_status, ed_student_attd_subject, ed_student_attd_teacherSubClass, ed_student_attd_date, ed_student_attd_institute_code) VALUES(?,?,?,?,?,?,?,?)`;
        const PARAMS = [
            req.body.student_attendance_class, req.body.student_attendance_code, req.body.student_attendance_time, 
            req.body.student_attendance_status, req.body.student_attendance_subject, req.body.student_attendance_subClass, 
            req.body.student_attendance_date, req.session.user.eduall_user_session_curentinstitute
        ];
        await ExecuteQuery(res, query, PARAMS, false, { db: "eduall_student_attendence", type: "insert", data: req });

        await RegisterAuditAction({
            session: req.session,
            action: 1,  // Ação de registro
            form: "Presenças",
            description: `Registrou a presença do aluno com o nº de matrícula #${req.body.student_attendance_code}`,
        });

        res.status(200).json({ success: true, msg: "Presença registrada com sucesso!" });
    } catch (error) {
        res.status(400).json({ success: false, msg: error.message });
    }
};

const StudentAttendanceDelete = async (req, res) => {
    try {
        const { allowed } = await CheckPresencePermission(req, res);
        if (!allowed) {return res.status(403).json({ success: false, msg: "Marcação de presença não permitida devido a restrição !"});}

        const { ID } = req.params;
        const query = `UPDATE eduall_student_attendence SET ed_student_attd_deleted = 1 WHERE ed_student_attd_deleted = 0 AND ed_student_attd_id = ?`;
        const PARAMS = [ID];
        await ExecuteQuery(res, query, PARAMS, false, { db: "eduall_student_attendence", type: "update", data: req });

        await RegisterAuditAction({
            session: req.session,
            action: 3,  // Ação de eliminação
            form: "Presenças",
            description: `Eliminou a presença com ID ${ID}`,
        });

        res.status(200).json({ success: true, msg: "Presença excluída com sucesso!" });
    } catch (error) {
        res.status(400).json({ success: false, msg: error.message });
    }
};

const StudentAttendanceUpdate = async (req, res) => {
    try {
        
        const { allowed } = await CheckPresencePermission(req, res);
        if (!allowed) {return res.status(403).json({ success: false, msg: "Ação não permitida devido a restrição  pedagógica !"});}

        const { ID } = req.params;
        const { student_attendance_time, student_attendance_status, student_attendance_date } = req.body;
        const query = `UPDATE eduall_student_attendence SET ed_student_attd_timing = ?, ed_student_attd_status = ?, ed_student_attd_date = ? WHERE ed_student_attd_deleted = 0 AND ed_student_attd_id = ?`;
        const PARAMS = [student_attendance_time, student_attendance_status, student_attendance_date, ID];
        await ExecuteQuery(res, query, PARAMS, false, { db: "eduall_student_attendence", type: "update", data: req });

        await RegisterAuditAction({
            session: req.session,
            action: 2,  // Ação de atualização
            form: "Presenças",
            description: `Atualizou a presença do aluno com o nº de matrícula #${req.body.student_attendance_code} `,
        });

        res.status(200).json({ success: true, msg: "Presença atualizada com sucesso!" });
    } catch (error) {
        res.status(400).json({ success: false, msg: error.message });
    }
};

 
module.exports = {
    GetStudentAttendanceByClassSubStuQrt,
    GetStudentAttendance,
    UpdateExistentSingleStudentAttendance,
    GetStudentAttendanceByTeacher,
    GetStudentAttendanceByTeacherAndClassSub,
    GetSingleStudentAttendance,
    CheckExistentSingleStudentAttendance,
    GetAllStudentAttendance,
    RegisterStudentAttendance,
    StudentAttendanceDelete,
    StudentAttendanceUpdate
};