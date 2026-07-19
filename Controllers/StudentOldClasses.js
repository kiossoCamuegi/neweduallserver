const ExecuteQuery = require("../Functions/ExecuteQuery");
const { RegisterAuditAction } = require("./Auditory");

const GetSingleStudentOldClasses = async (req, res) => {
  try {
    const { CODE } = req.params;
    const query = `SELECT * FROM eduall_student_old_classes 
      WHERE ed_student_old_class_student = ?`;
    const PARAMS = [CODE];
    const rows = await ExecuteQuery(res, query, PARAMS, true, { db: "eduall_student_old_classes", type: "select", data: req });
    res.status(200).json(rows);
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
};

const RegisterOldClass = async (req, res) => {
  try {
    const query = `INSERT INTO eduall_student_old_classes(
      ed_student_old_class_student, 
      ed_student_old_class
    ) VALUES (?, ?)`;
    const PARAMS = [req.body.old_class_student, req.body.old_class_code];
    await ExecuteQuery(res, query, PARAMS, false, { db: "eduall_student_old_classes", type: "insert", data: req });

    await RegisterAuditAction({
      session: req.session,
      action: 1,  // Ação de registro
      form: "Classes antigas",
      description: `Registrou uma classe antiga ao atualizar os dados`,
    });
    res.status(200).json({ success: true, msg: "Classe antiga registrada com sucesso!" });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
};

module.exports = { GetSingleStudentOldClasses, RegisterOldClass };
