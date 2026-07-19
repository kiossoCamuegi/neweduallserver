
const ExecuteQuery = require("../Functions/ExecuteQuery");
const { RegisterAuditAction } = require("./Auditory");

const GetStudentTransferences = async (req, res) => {
   try {
      const query = `SELECT * FROM eduall_student_transference 
      LEFT JOIN eduall_students ON eduall_students.ed_student_id =  eduall_student_transference.ed_student_transference_code
      LEFT JOIN eduall_class   ON eduall_students.ed_student_class =  eduall_class.ed_class_id  
      LEFT JOIN eduall_cicles ON ed_cicle_id = eduall_class.ed_class_cicle 
      LEFT JOIN eduall_students_details  ON eduall_students_details.ed_detail_student_code = eduall_students.ed_student_id
      WHERE eduall_student_transference.ed_student_transference_deleted = 0 AND eduall_student_transference.ed_student_transference_institute_code = ?`;

      const PARAMS = [req.session.user.eduall_user_session_curentinstitute];
      const rows = await ExecuteQuery(res, query, PARAMS, true, { db: "eduall_student_transference", type: "select", data: req });
      res.status(200).json(rows);
   } catch (err) {
      res.status(400).json({ status: 300, success: false, msg: err.message });
   }
}

const GetSingleStudentTransference = async (req, res) => {
   try {
      const { ID } = req.params;
      const query = `SELECT * FROM eduall_student_transference  
         LEFT JOIN eduall_students ON eduall_students.ed_student_id =  eduall_student_transference.ed_student_transference_code
         LEFT JOIN eduall_class   ON eduall_students.ed_student_class =  eduall_class.ed_class_id  
         LEFT JOIN eduall_classrooms ON eduall_classrooms.ed_classroom_id = eduall_class.ed_class_room
         LEFT JOIN eduall_academic_level ON eduall_academic_level.ed_academic_level_id = eduall_class.ed_class_academic_level
         LEFT JOIN eduall_cicles ON eduall_cicles.ed_cicle_id = eduall_class.ed_class_cicle
         LEFT JOIN eduall_academic_year ON eduall_academic_year.ed_academic_year_id = eduall_class.ed_class_year
         LEFT JOIN eduall_courses ON eduall_courses.ed_course_id = eduall_class.ed_class_course
         LEFT JOIN eduall_students_details  ON eduall_students_details.ed_detail_student_code = eduall_students.ed_student_id
         WHERE ed_student_transference_deleted = 0 AND ed_student_transference_id = ?`;

      const PARAMS = [ID];
      const rows = await ExecuteQuery(res, query, PARAMS, true, { db: "eduall_student_transference", type: "select", data: req });
      res.status(200).json(rows);
   } catch (err) {
      res.status(400).json({ status: 300, success: false, msg: err.message });
   }
}

const RegisterStudentTransference = async (req, res) => {
   try {
      const query = `INSERT INTO eduall_student_transference(ed_student_transference_code , ed_student_transference_reason,
      ed_student_transference_to, ed_student_transference_with_marks, ed_student_transference_description,ed_student_transference_institute_code) 
      VALUES(?,?,?,?,?,?)`;

      const PARAMS = [req.body.transference_student, req.body.transference_reason, req.body.transference_place,
      req.body.transference_with_marks, req.body.transference_description, req.session.user.eduall_user_session_curentinstitute];

      const rows = await ExecuteQuery(res, query, PARAMS, false, { db: "eduall_student_transference", type: "insert", data: req });

      // Registrar a ação de auditoria
      await RegisterAuditAction({
         session: req.session,
         action: 1,  // Ação de registro
         form: "Transferências de Estudantes",
         description: `Registrou uma nova transferência para o estudante com o nº de matrícula #${req.body.transference_student}`,
      });

      res.status(200).json(rows);
   } catch (err) {
      res.status(400).json({ status: 300, success: false, msg: err.message });
   }
}

const StudentTransferenceDelete = async (req, res) => {
   try {
      const { ID } = req.params;
      const query = `UPDATE eduall_student_transference SET ed_student_transference_deleted = 1
      WHERE ed_student_transference_deleted = 0 AND ed_student_transference_id = ?`;

      const PARAMS = [ID];
      await ExecuteQuery(res, query, PARAMS, false, { db: "eduall_student_transference", type: "update", data: req });

      // Registrar a ação de auditoria
      await RegisterAuditAction({
         session: req.session,
         action: 3,  // Ação de eliminação
         form: "Transferências de Estudantes",
         description: `Eliminou a transferência do estudante com ID ${ID}`,
      });

      res.status(200).json({ success: true, msg: "Transference deleted successfully." });
   } catch (err) {
      res.status(400).json({ status: 300, success: false, msg: err.message });
   }
}

const StudentTransferenceUpdate = async (req, res) => {
   try {
      const { ID } = req.params;
      const { transference_student, transference_reason, transference_place, transference_with_marks, transference_description } = req.body;
      const query = `UPDATE eduall_student_transference SET ed_student_transference_code = ? ,ed_student_transference_reason = ?,
      ed_student_transference_to = ?, ed_student_transference_with_marks = ?,  ed_student_transference_description = ? 
      WHERE ed_student_transference_deleted = 0  AND ed_student_transference_id = ?`;

      const PARAMS = [transference_student, transference_reason, transference_place, transference_with_marks, transference_description, ID];
      await ExecuteQuery(res, query, PARAMS, false, { db: "eduall_student_transference", type: "update", data: req });

      // Registrar a ação de auditoria
      await RegisterAuditAction({
         session: req.session,
         action: 2,  // Ação de atualização
         form: "Transferências de Estudantes",
         description: `Atualizou a transferência para o estudante com o nº de matrícula #${transference_student}`,
      });

      res.status(200).json({ success: true, msg: "Transference updated successfully." });
   } catch (err) {
      res.status(400).json({ status: 300, success: false, msg: err.message });
   }
}
 


module.exports = {
   GetStudentTransferences, GetSingleStudentTransference,
   RegisterStudentTransference, StudentTransferenceDelete, StudentTransferenceUpdate
};
