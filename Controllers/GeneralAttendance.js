 

const express = require("express");
const ExecuteQuery = require("../Functions/ExecuteQuery");
const { RegisterAuditAction } = require("./Auditory");

const router = express.Router();

 
const AutoDBSetup = async (req, res, next) => {
  try {
    console.log("🛠 AutoDBSetup: Checking/Creating RFID and Suspensions tables...");

    // Tabela de logs RFID
    const createLogsTable = `
      CREATE TABLE IF NOT EXISTS eduall_rfid_logs (
        ed_rfidlog_id INT AUTO_INCREMENT PRIMARY KEY,
        ed_rfidlog_code VARCHAR(255) NOT NULL,
        ed_rfidlog_type ENUM('student','employee') NOT NULL,
        ed_rfidlog_student_id INT DEFAULT NULL,
        ed_rfidlog_employee_id INT DEFAULT NULL,
        ed_rfidlog_event_type ENUM('entrada','saida','outro') DEFAULT 'outro',
        ed_rfidlog_institute_code INT NOT NULL,
        ed_rfidlog_timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
        INDEX(ed_rfidlog_student_id),
        INDEX(ed_rfidlog_employee_id),
        INDEX(ed_rfidlog_code),
        INDEX(ed_rfidlog_institute_code)
      );
    `;
    await ExecuteQuery(res, createLogsTable, [], false, {
      db: "eduall_rfid_logs",
      type: "create",
      data: req,
    });

    // Tabela de suspensões
    const createSuspTable = `
      CREATE TABLE IF NOT EXISTS eduall_suspensions (
        ed_susp_id INT AUTO_INCREMENT PRIMARY KEY,
        ed_susp_student_id INT NOT NULL,
        ed_susp_reason TEXT NOT NULL,
        ed_susp_start_date DATE NOT NULL,
        ed_susp_end_date DATE DEFAULT NULL,
        ed_susp_status ENUM('active','lifted') DEFAULT 'active',
        ed_susp_institute_code INT NOT NULL,
        ed_susp_deleted TINYINT(1) DEFAULT 0,
        ed_susp_created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        INDEX(ed_susp_student_id),
        INDEX(ed_susp_institute_code),
        INDEX(ed_susp_status),
        INDEX(ed_susp_deleted)
      );
    `;
    await ExecuteQuery(res, createSuspTable, [], false, {
      db: "eduall_suspensions",
      type: "create",
      data: req,
    });

    next();
  } catch (error) {
    console.error("❌ AutoDBSetup error:", error.message);
    next();
  }
};

/************************************************************************************************
 *  2) HELPERS — RFID único / geração / etc.
 ************************************************************************************************/

// Verificar se o código RFID já está em uso na escola (aluno/funcionário)
const isRFIDInUse = async (res, institute, code, ignoreStudentId = null, ignoreEmployeeId = null, req = null) => {
  const query = `
    SELECT 'student' AS type, ed_student_id AS id
    FROM eduall_students 
    WHERE ed_student_rfid_code = ? 
      AND ed_student_institute_code = ?
      AND ed_student_deleted = 0
      ${ignoreStudentId ? "AND ed_student_id <> ?" : ""}

    UNION

    SELECT 'employee' AS type, ed_employee_id AS id
    FROM eduall_employees
    WHERE ed_employee_rfid_code = ?
      AND ed_employee_institute_code = ?
      AND ed_employee_deleted = 0
      ${ignoreEmployeeId ? "AND ed_employee_id <> ?" : ""}
  `;

  const params = [
    code,
    institute,
    ...(ignoreStudentId ? [ignoreStudentId] : []),
    code,
    institute,
    ...(ignoreEmployeeId ? [ignoreEmployeeId] : []),
  ];

  const rows = await ExecuteQuery(res, query, params, true, {
    db: "eduall_students",
    type: "select",
    data: req || {},
  });

  return rows;
};

// Gerar RFID único por escola
const generateUniqueRFID = async (req, res) => {
  const institute = req.session.user.eduall_user_session_curentinstitute;
  let code = "";
  let exists = true;
  let tries = 0;

  while (exists && tries < 20) {
    code =
      Date.now().toString(36).toUpperCase() +
      Math.random().toString(36).substr(2, 5).toUpperCase();

    const used = await isRFIDInUse(res, institute, code, null, null, req);
    exists = used.length > 0;
    tries++;
  }

  if (exists) {
    throw new Error("Não foi possível gerar um código RFID único.");
  }

  return code;
};

/************************************************************************************************
 *  3) RFID — LEITURA SIMPLES (só identifica aluno/funcionário)
 ************************************************************************************************/
const RFIDRead = async (req, res) => {
  try {
    const { code } = req.params;
    const institute = req.session.user.eduall_user_session_curentinstitute;

    const studentQuery = `
      SELECT * FROM eduall_students 
      WHERE ed_student_rfid_code = ?
        AND ed_student_institute_code = ?
        AND ed_student_deleted = 0
      LIMIT 1
    `;
    const studentRows = await ExecuteQuery(res, studentQuery, [code, institute], true, {
      db: "eduall_students",
      type: "select",
      data: req,
    });

    const employeeQuery = `
      SELECT * FROM eduall_employees 
      WHERE ed_employee_rfid_code = ?
        AND ed_employee_institute_code = ?
        AND ed_employee_deleted = 0
      LIMIT 1
    `;
    const employeeRows = await ExecuteQuery(res, employeeQuery, [code, institute], true, {
      db: "eduall_employees",
      type: "select",
      data: req,
    });

    if (studentRows.length > 0) {
      return res.status(200).json({
        success: true,
        type: "student",
        data: studentRows[0],
      });
    }

    if (employeeRows.length > 0) {
      return res.status(200).json({
        success: true,
        type: "employee",
        data: employeeRows[0],
      });
    }

    return res.status(404).json({
      success: false,
      msg: "Código RFID não associado a nenhum aluno ou funcionário.",
    });
  } catch (error) {
    console.error("RFIDRead error:", error);
    res.status(500).json({ success: false, msg: error.message });
  }
};

/************************************************************************************************
 *  4) ATRIBUIR / ATUALIZAR RFID (Aluno / Funcionário)
 ************************************************************************************************/

const AssignStudentRFID = async (req, res) => {
  try {
    const { ID } = req.params;
    const { code } = req.body;
    const institute = req.session.user.eduall_user_session_curentinstitute;

    if (!code) {
      return res.status(400).json({ success: false, msg: "Código RFID inválido!" });
    }

    const used = await isRFIDInUse(res, institute, code, ID, null, req);
    if (used.length > 0) {
      return res.status(400).json({
        success: false,
        msg: `Este código RFID já está atribuído a um ${used[0].type === "student" ? "aluno" : "funcionário"}.`,
      });
    }

    const query = `
      UPDATE eduall_students
      SET ed_student_rfid_code = ?
      WHERE ed_student_id = ?
        AND ed_student_institute_code = ?
        AND ed_student_deleted = 0
    `;
    await ExecuteQuery(res, query, [code, ID, institute], false, {
      db: "eduall_students",
      type: "update",
      data: req,
    });

    await RegisterAuditAction({
      session: req.session,
      action: 2,
      form: "RFID",
      description: `Atribuiu/Atualizou RFID (${code}) ao aluno ID ${ID}`,
    });

    res.status(200).json({ success: true, msg: "RFID atribuído ao aluno com sucesso!" });
  } catch (error) {
    console.error("AssignStudentRFID error:", error);
    res.status(500).json({ success: false, msg: error.message });
  }
};

const AssignEmployeeRFID = async (req, res) => {
  try {
    const { ID } = req.params;
    const { code } = req.body;
    const institute = req.session.user.eduall_user_session_curentinstitute;

    if (!code) {
      return res.status(400).json({ success: false, msg: "Código RFID inválido!" });
    }

    const used = await isRFIDInUse(res, institute, code, null, ID, req);
    if (used.length > 0) {
      return res.status(400).json({
        success: false,
        msg: `Este código RFID já está atribuído a um ${used[0].type === "student" ? "aluno" : "funcionário"}.`,
      });
    }

    const query = `
      UPDATE eduall_employees
      SET ed_employee_rfid_code = ?
      WHERE ed_employee_id = ?
        AND ed_employee_institute_code = ?
        AND ed_employee_deleted = 0
    `;
    await ExecuteQuery(res, query, [code, ID, institute], false, {
      db: "eduall_employees",
      type: "update",
      data: req,
    });

    await RegisterAuditAction({
      session: req.session,
      action: 2,
      form: "RFID",
      description: `Atribuiu/Atualizou RFID (${code}) ao funcionário ID ${ID}`,
    });

    res.status(200).json({ success: true, msg: "RFID atribuído ao funcionário com sucesso!" });
  } catch (error) {
    console.error("AssignEmployeeRFID error:", error);
    res.status(500).json({ success: false, msg: error.message });
  }
};

/************************************************************************************************
 *  5) GERAR RFID ÚNICO
 ************************************************************************************************/
const GenerateRFIDCode = async (req, res) => {
  try {
    const code = await generateUniqueRFID(req, res);
    res.status(200).json({ success: true, code });
  } catch (error) {
    res.status(500).json({ success: false, msg: error.message });
  }
};

/************************************************************************************************
 *  6) REGISTAR LOG RFID (pichagem)
 ************************************************************************************************/
const RegisterRFIDLog = async (req, res) => {
  try {
    const { code, event_type } = req.body;
    const institute = req.session.user.eduall_user_session_curentinstitute;

    if (!code) {
      return res.status(400).json({ success: false, msg: "Código RFID inválido!" });
    }

    const detectQuery = `
      SELECT ed_student_id AS id, 'student' AS type 
      FROM eduall_students
      WHERE ed_student_rfid_code = ?
        AND ed_student_institute_code = ?
        AND ed_student_deleted = 0

      UNION

      SELECT ed_employee_id AS id, 'employee' AS type
      FROM eduall_employees
      WHERE ed_employee_rfid_code = ?
        AND ed_employee_institute_code = ?
        AND ed_employee_deleted = 0
      LIMIT 1
    `;
    const detect = await ExecuteQuery(
      res,
      detectQuery,
      [code, institute, code, institute],
      true,
      { db: "eduall_students", type: "select", data: req }
    );

    if (detect.length === 0) {
      return res.status(404).json({
        success: false,
        msg: "Este código RFID não está atribuído a nenhum aluno ou funcionário.",
      });
    }

    const { id, type } = detect[0];

    const insert = `
      INSERT INTO eduall_rfid_logs
      (ed_rfidlog_code, ed_rfidlog_type, ed_rfidlog_student_id, ed_rfidlog_employee_id, ed_rfidlog_event_type, ed_rfidlog_institute_code)
      VALUES (?, ?, ?, ?, ?, ?)
    `;
    await ExecuteQuery(
      res,
      insert,
      [
        code,
        type,
        type === "student" ? id : null,
        type === "employee" ? id : null,
        event_type || "outro",
        institute,
      ],
      false,
      { db: "eduall_rfid_logs", type: "insert", data: req }
    );

    res.status(200).json({ success: true, msg: "Pichagem registrada com sucesso!" });
  } catch (error) {
    console.error("RegisterRFIDLog error:", error);
    res.status(500).json({ success: false, msg: error.message });
  }
};

/************************************************************************************************
 *  7) LISTAR LOGS RFID
 ************************************************************************************************/
const GetRFIDLogs = async (req, res) => {
  try {
    const institute = req.session.user.eduall_user_session_curentinstitute;

    const query = `
      SELECT l.*, 
             s.ed_student_name,
             e.ed_employee_name
      FROM eduall_rfid_logs l
      LEFT JOIN eduall_students s ON s.ed_student_id = l.ed_rfidlog_student_id
      LEFT JOIN eduall_employees e ON e.ed_employee_id = l.ed_rfidlog_employee_id
      WHERE l.ed_rfidlog_institute_code = ?
      ORDER BY l.ed_rfidlog_timestamp DESC
    `;
    const rows = await ExecuteQuery(res, query, [institute], true, {
      db: "eduall_rfid_logs",
      type: "select",
      data: req,
    });

    res.status(200).json(rows);
  } catch (error) {
    console.error("GetRFIDLogs error:", error);
    res.status(500).json({ success: false, msg: error.message });
  }
};

/************************************************************************************************
 *  8) CRUD DE SUSPENSÕES (com regra: 1 ativa por aluno)
 ************************************************************************************************/

const CreateSuspension = async (req, res) => {
  try {
    const { student_id, reason, start_date, end_date } = req.body;
    const institute = req.session.user.eduall_user_session_curentinstitute;

    if (!student_id || !reason || !start_date) {
      return res.status(400).json({
        success: false,
        msg: "Campos obrigatórios: student_id, reason, start_date",
      });
    }

    const checkQuery = `
      SELECT * FROM eduall_suspensions
      WHERE ed_susp_student_id = ?
        AND ed_susp_institute_code = ?
        AND ed_susp_status = 'active'
        AND ed_susp_deleted = 0
      LIMIT 1
    `;
    const active = await ExecuteQuery(
      res,
      checkQuery,
      [student_id, institute],
      true,
      { db: "eduall_suspensions", type: "select", data: req }
    );

    if (active.length > 0) {
      return res.status(400).json({
        success: false,
        msg: "Este aluno já possui uma suspensão ativa. Não é possível criar outra.",
      });
    }

    const insert = `
      INSERT INTO eduall_suspensions
      (ed_susp_student_id, ed_susp_reason, ed_susp_start_date, ed_susp_end_date, ed_susp_institute_code)
      VALUES (?, ?, ?, ?, ?)
    `;
    await ExecuteQuery(
      res,
      insert,
      [student_id, reason, start_date, end_date || null, institute],
      false,
      { db: "eduall_suspensions", type: "insert", data: req }
    );

    await RegisterAuditAction({
      session: req.session,
      action: 1,
      form: "Suspensões",
      description: `Registrou suspensão para o aluno ID ${student_id}`,
    });

    res.status(200).json({ success: true, msg: "Suspensão registrada com sucesso!" });
  } catch (error) {
    console.error("CreateSuspension error:", error);
    res.status(500).json({ success: false, msg: error.message });
  }
};

const UpdateSuspension = async (req, res) => {
  try {
    const { ID } = req.params;
    const { reason, start_date, end_date, status } = req.body;
    const institute = req.session.user.eduall_user_session_curentinstitute;

    const getQuery = `
      SELECT * FROM eduall_suspensions
      WHERE ed_susp_id = ?
        AND ed_susp_institute_code = ?
        AND ed_susp_deleted = 0
      LIMIT 1
    `;
    const suspRows = await ExecuteQuery(
      res,
      getQuery,
      [ID, institute],
      true,
      { db: "eduall_suspensions", type: "select", data: req }
    );

    if (suspRows.length === 0) {
      return res.status(404).json({ success: false, msg: "Suspensão não encontrada!" });
    }

    const susp = suspRows[0];

    if (status === "active") {
      const checkQuery = `
        SELECT * FROM eduall_suspensions
        WHERE ed_susp_student_id = ?
          AND ed_susp_institute_code = ?
          AND ed_susp_status = 'active'
          AND ed_susp_deleted = 0
          AND ed_susp_id <> ?
        LIMIT 1
      `;
      const active = await ExecuteQuery(
        res,
        checkQuery,
        [susp.ed_susp_student_id, institute, ID],
        true,
        { db: "eduall_suspensions", type: "select", data: req }
      );

      if (active.length > 0) {
        return res.status(400).json({
          success: false,
          msg: "Já existe outra suspensão ativa para este aluno. Não é possível ativar esta.",
        });
      }
    }

    const update = `
      UPDATE eduall_suspensions
      SET 
        ed_susp_reason = ?,
        ed_susp_start_date = ?,
        ed_susp_end_date = ?,
        ed_susp_status = ?
      WHERE ed_susp_id = ?
        AND ed_susp_institute_code = ?
        AND ed_susp_deleted = 0
    `;
    await ExecuteQuery(
      res,
      update,
      [
        reason || susp.ed_susp_reason,
        start_date || susp.ed_susp_start_date,
        end_date || susp.ed_susp_end_date,
        status || susp.ed_susp_status,
        ID,
        institute,
      ],
      false,
      { db: "eduall_suspensions", type: "update", data: req }
    );

    await RegisterAuditAction({
      session: req.session,
      action: 2,
      form: "Suspensões",
      description: `Atualizou suspensão ID ${ID}`,
    });

    res.status(200).json({ success: true, msg: "Suspensão atualizada com sucesso!" });
  } catch (error) {
    console.error("UpdateSuspension error:", error);
    res.status(500).json({ success: false, msg: error.message });
  }
};

const LiftSuspension = async (req, res) => {
  try {
    const { ID } = req.params;
    const institute = req.session.user.eduall_user_session_curentinstitute;

    const query = `
      UPDATE eduall_suspensions
      SET ed_susp_status = 'lifted'
      WHERE ed_susp_id = ?
        AND ed_susp_institute_code = ?
        AND ed_susp_deleted = 0
    `;
    await ExecuteQuery(res, query, [ID, institute], false, {
      db: "eduall_suspensions",
      type: "update",
      data: req,
    });

    await RegisterAuditAction({
      session: req.session,
      action: 2,
      form: "Suspensões",
      description: `Levantou suspensão ID ${ID}`,
    });

    res.status(200).json({ success: true, msg: "Suspensão levantada com sucesso!" });
  } catch (error) {
    console.error("LiftSuspension error:", error);
    res.status(500).json({ success: false, msg: error.message });
  }
};

const DeleteSuspension = async (req, res) => {
  try {
    const { ID } = req.params;
    const institute = req.session.user.eduall_user_session_curentinstitute;

    const query = `
      UPDATE eduall_suspensions
      SET ed_susp_deleted = 1
      WHERE ed_susp_id = ?
        AND ed_susp_institute_code = ?
    `;
    await ExecuteQuery(res, query, [ID, institute], false, {
      db: "eduall_suspensions",
      type: "update",
      data: req,
    });

    await RegisterAuditAction({
      session: req.session,
      action: 3,
      form: "Suspensões",
      description: `Eliminou suspensão ID ${ID}`,
    });

    res.status(200).json({ success: true, msg: "Suspensão eliminada com sucesso!" });
  } catch (error) {
    console.error("DeleteSuspension error:", error);
    res.status(500).json({ success: false, msg: error.message });
  }
};

const CheckSuspension = async (req, res) => {
  try {
    const { studentId } = req.params;
    const institute = req.session.user.eduall_user_session_curentinstitute;

    const query = `
      SELECT * FROM eduall_suspensions
      WHERE ed_susp_student_id = ?
        AND ed_susp_institute_code = ?
        AND ed_susp_status = 'active'
        AND ed_susp_deleted = 0
    `;
    const rows = await ExecuteQuery(res, query, [studentId, institute], true, {
      db: "eduall_suspensions",
      type: "select",
      data: req,
    });

    res.status(200).json({
      success: true,
      suspended: rows.length > 0,
      data: rows,
    });
  } catch (error) {
    console.error("CheckSuspension error:", error);
    res.status(500).json({ success: false, msg: error.message });
  }
};

const ListSuspensionsByStudent = async (req, res) => {
  try {
    const { studentId } = req.params;
    const institute = req.session.user.eduall_user_session_curentinstitute;

    const query = `
      SELECT * FROM eduall_suspensions
      WHERE ed_susp_student_id = ?
        AND ed_susp_institute_code = ?
        AND ed_susp_deleted = 0
      ORDER BY ed_susp_created_at DESC
    `;
    const rows = await ExecuteQuery(res, query, [studentId, institute], true, {
      db: "eduall_suspensions",
      type: "select",
      data: req,
    });

    res.status(200).json(rows);
  } catch (error) {
    console.error("ListSuspensionsByStudent error:", error);
    res.status(500).json({ success: false, msg: error.message });
  }
};

const GetAllSuspensions = async (req, res) => {
  try {
    const institute = req.session.user.eduall_user_session_curentinstitute;

    const query = `
      SELECT s.*, st.ed_student_name
      FROM eduall_suspensions s
      LEFT JOIN eduall_students st ON st.ed_student_id = s.ed_susp_student_id
      WHERE s.ed_susp_institute_code = ?
        AND s.ed_susp_deleted = 0
      ORDER BY s.ed_susp_created_at DESC
    `;
    const rows = await ExecuteQuery(res, query, [institute], true, {
      db: "eduall_suspensions",
      type: "select",
      data: req,
    });

    res.status(200).json(rows);
  } catch (error) {
    console.error("GetAllSuspensions error:", error);
    res.status(500).json({ success: false, msg: error.message });
  }
};

/************************************************************************************************
 *  9) FULL INFO POR RFID: GET /eduallrfid/fullinfo/:code
 *     - Híbrido: retorna trimestral + semestral
 ************************************************************************************************/

// Buscar dados básicos completos do aluno (já com turma/curso/faculdade)
const getStudentFullBasicData = async (req, res, studentId) => {
  const institute = req.session.user.eduall_user_session_curentinstitute;
  const instituteType = req.session.user.eduall_user_session_curentinstitute_type * 1;

  let query;
  let params;

  if (instituteType === 0) {
    // Escola
    query = `
      SELECT * FROM eduall_students 
      LEFT JOIN eduall_class ON eduall_students.ed_student_class = eduall_class.ed_class_id  
      LEFT JOIN eduall_cicles ON ed_cicle_id = eduall_class.ed_class_cicle  
      LEFT JOIN eduall_classrooms ON eduall_classrooms.ed_classroom_id = eduall_class.ed_class_room 
      LEFT JOIN eduall_academic_year ON eduall_academic_year.ed_academic_year_id = eduall_class.ed_class_year
      LEFT JOIN eduall_courses ON eduall_courses.ed_course_id = eduall_class.ed_class_course
      LEFT JOIN eduall_academic_level ON ed_academic_level_id = ed_class_academic_level AND ed_academic_level_deleted = 0
      WHERE 
        eduall_classrooms.ed_classroom_deleted = 0  AND
        eduall_cicles.ed_cicle_deleted = 0 AND
        eduall_class.ed_class_deleted = 0 AND
        eduall_courses.ed_course_deleted = 0 AND
        eduall_academic_year.ed_academic_year_deleted = 0 AND 
        eduall_academic_level.ed_academic_level_deleted = 0 AND
        ed_student_deleted = 0 AND 
        eduall_students.ed_student_institute_code = ? AND
        eduall_students.ed_student_id = ?
      LIMIT 1
    `;
    params = [institute, studentId];
  } else {
    // Universidade / híbrido
    query = `
      SELECT * FROM eduall_students 
      LEFT JOIN eduall_class ON eduall_students.ed_student_class = eduall_class.ed_class_id  
      LEFT JOIN eduall_cicles ON ed_cicle_id = eduall_class.ed_class_cicle  
      LEFT JOIN eduall_classrooms ON eduall_classrooms.ed_classroom_id = eduall_class.ed_class_room 
      LEFT JOIN eduall_academic_year ON eduall_academic_year.ed_academic_year_id = eduall_class.ed_class_year
      LEFT JOIN eduall_courses ON eduall_courses.ed_course_id = eduall_class.ed_class_course
      LEFT JOIN eduall_academic_level ON ed_academic_level_id = ed_class_academic_level AND ed_academic_level_deleted = 0
      LEFT JOIN eduall_students_details ON eduall_students_details.ed_detail_student_code = eduall_students.ed_student_id
      LEFT JOIN eduall_faculty ON eduall_faculty.ed_faculty_id = eduall_class.ed_class_faculty
      WHERE
        eduall_classrooms.ed_classroom_deleted = 0  AND
        eduall_cicles.ed_cicle_deleted = 0 AND
        eduall_class.ed_class_deleted = 0 AND
        eduall_courses.ed_course_deleted = 0 AND
        eduall_academic_year.ed_academic_year_deleted = 0 AND 
        eduall_academic_level.ed_academic_level_deleted = 0 AND 
        ed_student_deleted = 0 AND 
        eduall_students.ed_student_institute_code = ? AND
        eduall_students.ed_student_id = ?
      LIMIT 1
    `;
    params = [institute, studentId];
  }

  const rows = await ExecuteQuery(res, query, params, true, {
    db: "eduall_students",
    type: "select",
    data: req,
  });

  return rows.length > 0 ? rows[0] : null;
};

// Pagamentos de propinas + extras (base no GetFeepayments)
const getStudentFeePayments = async (req, res, studentId) => {
  const institute = req.session.user.eduall_user_session_curentinstitute;

  const query = `
    SELECT 
      fp.*,
      st.ed_student_name,
      srv.ed_service_title,
      coins.*
    FROM eduall_fees_payments fp
    LEFT JOIN eduall_students st 
      ON fp.ed_fee_payment_student = st.ed_student_id
    LEFT JOIN eduall_services srv 
      ON fp.ed_fee_payment_service = srv.ed_service_id
    LEFT JOIN eduall_coins coins 
      ON coins.ed_coin_institute_code = ?
    WHERE 
      fp.ed_fee_payment_deleted = 0
      AND st.ed_student_deleted = 0
      AND srv.ed_service_deleted = 0
      AND fp.ed_fee_payment_institute_code = ?
      AND fp.ed_fee_payment_student = ?
    ORDER BY fp.ed_fee_payment_registerDate DESC
  `;

  const rows = await ExecuteQuery(res, query, [institute, institute, studentId], true, {
    db: "eduall_fees_payments",
    type: "select",
    data: req,
  });

  return rows;
};

// Pagamentos de serviços do aluno
const getStudentServicePayments = async (req, res, studentId) => {
  const institute = req.session.user.eduall_user_session_curentinstitute;

  const query = `
    SELECT * FROM eduall_service_payments 
    LEFT JOIN eduall_services ON ed_service_id = ed_service_payment_service
    LEFT JOIN eduall_students ON ed_student_id = ed_service_payment_student_code
    LEFT JOIN eduall_coins ON eduall_coins.ed_coin_institute_code = ?
    WHERE 
      ed_service_payment_deleted = 0 
      AND ed_service_payment_institute_code = ? 
      AND ed_service_payment_student_code = ?
    ORDER BY ed_service_payment_registerDate DESC
  `;
  const rows = await ExecuteQuery(
    res,
    query,
    [institute, institute, studentId],
    true,
    { db: "eduall_service_payments", type: "select", data: req }
  );

  return rows;
};

// Estado mensal de pagamentos (similar ao GetClassPaymentsStatusById, mas só para 1 aluno)
const getStudentMonthlyFeeStatus = async (req, res, studentBasic) => {
  try {
    if (!studentBasic || !studentBasic.ed_student_class) return [];

    const institute = req.session.user.eduall_user_session_curentinstitute;
    const classId = studentBasic.ed_student_class;

    const MonthsList = [
      "Janeiro","Fevereiro","Março","Abril","Maio","Junho",
      "Julho","Agosto","Setembro","Outubro","Novembro","Dezembro"
    ];

    const classQuery = `
      SELECT c.*, y.ed_academic_year_id, y.ed_academic_year_startDate, y.ed_academic_year_endDate
      FROM eduall_class c
      INNER JOIN eduall_academic_year y ON y.ed_academic_year_id = c.ed_class_year
      WHERE c.ed_class_deleted = 0 
      AND c.ed_class_institute_code = ?
      AND c.ed_class_id = ?
      AND y.ed_academic_year_institute_code = ?
      LIMIT 1
    `;
    const classes = await ExecuteQuery(
      res,
      classQuery,
      [institute, classId, institute],
      true,
      { db: "eduall_class", type: "select", data: req }
    );

    if (!classes || classes.length === 0) {
      return [];
    }

    const cls = classes[0];
    const [startY, startM] = cls.ed_academic_year_startDate.split("-").map(Number);
    const [endY, endM] = cls.ed_academic_year_endDate.split("-").map(Number);

    const buildMonths = () => {
      const months = [];
      const startMonthIndex = startM - 1;
      const endMonthIndex = endM - 1;

      if (endY > startY) {
        for (let i = startMonthIndex; i <= 11; i++) {
          months.push({ 
            month: `${MonthsList[i]} de ${startY}`, 
            code: parseFloat(`${i}.${startY}`), 
            status: "other" 
          });
        }
        for (let i = 0; i <= endMonthIndex; i++) {
          months.push({ 
            month: `${MonthsList[i]} de ${endY}`, 
            code: parseFloat(`${i}.${endY}`), 
            status: "other" 
          });
        }
      } else {
        for (let i = startMonthIndex; i <= endMonthIndex; i++) {
          months.push({
            month: `${MonthsList[i]} de ${startY}`,
            code: parseFloat(`${i}.${startY}`),
            status: "other",
          });
        }
      }
      return months;
    };

    const months = buildMonths();

    const paymentsQuery = `
      SELECT p.*
      FROM eduall_fees_payments p
      WHERE p.ed_fee_payment_deleted = 0
      AND p.ed_fee_payment_institute_code = ?
      AND p.ed_fee_payment_student = ?
      AND p.ed_fee_payment_academic_year = ?
    `;
    const allPayments = await ExecuteQuery(
      res,
      paymentsQuery,
      [institute, studentBasic.ed_student_id, cls.ed_class_year],
      true,
      { db: "eduall_fees_payments", type: "select", data: req }
    );

    const currentYear = new Date().getFullYear();
    const currentMonth = new Date().getMonth();

    const monthsStatus = months.map(m => {
      const paid = allPayments.find(p => parseFloat(p.ed_fee_payment_month) === m.code);
      let status = paid ? "paid" : "other";

      const mYear = parseInt(m.month.split(" ")[2]);
      const mMonth = parseInt(m.code.toString().split(".")[0]);

      if (!paid && (mYear < currentYear || (mYear === currentYear && mMonth < currentMonth))) {
        status = "notpaid";
      }

      return { ...m, status };
    });

    return monthsStatus;
  } catch (error) {
    console.error("getStudentMonthlyFeeStatus error:", error);
    return [];
  }
};

// Notas trimestrais / exames / destaque (baseado em GetQuarterlyNotesFullData)
const getStudentQuarterlyAndExamNotes = async (req, res, studentBasic) => {
  try {
    if (!studentBasic || !studentBasic.ed_student_class) {
      return { quarters: {}, exams: [], featured: [] };
    }

    const institute = req.session.user.eduall_user_session_curentinstitute;
    const resolvedClass = Number(studentBasic.ed_student_class);
    const resolvedStudent = Number(studentBasic.ed_student_id);

    // Buscar lista de disciplinas da turma
    let subjectsList = [];
    const classQuery = `SELECT ed_class_subjects FROM eduall_class WHERE ed_class_id = ? AND ed_class_deleted = 0 LIMIT 1`;
    const classRes = await ExecuteQuery(
      res,
      classQuery,
      [resolvedClass],
      true,
      { db: "eduall_class", type: "select", data: req }
    );

    if (classRes.length > 0 && classRes[0].ed_class_subjects) {
      const rawSubjects = classRes[0].ed_class_subjects.split(',');
      subjectsList = rawSubjects.filter(id => Math.floor(id) >= 1).map(id => Number(id));
    }

    let subjectTitlesMap = new Map();
    if (subjectsList.length > 0) {
      const placeholders = subjectsList.map(() => '?').join(',');
      const subjectsQuery = `SELECT ed_subject_id, ed_subject_title FROM eduall_subjects WHERE ed_subject_id IN (${placeholders}) AND ed_subject_deleted = 0`;
      const subjectsRes = await ExecuteQuery(
        res,
        subjectsQuery,
        subjectsList,
        true,
        { db: "eduall_subjects", type: "select", data: req }
      );
      subjectsRes.forEach(subj => {
        subjectTitlesMap.set(subj.ed_subject_id, subj.ed_subject_title);
      });
    }

    const baseQuery = `
      SELECT q.*, s.ed_student_name, sub.ed_subject_title, c.ed_class_title, 
             l.ed_academic_level_avaliationtype_endat as max_value
      FROM eduall_quarterly_notes q
      LEFT JOIN eduall_students s ON s.ed_student_id = q.ed_quarter_note_studentcode AND s.ed_student_deleted = 0
      LEFT JOIN eduall_subjects sub ON sub.ed_subject_id = q.ed_quarter_note_subject AND sub.ed_subject_deleted = 0
      LEFT JOIN eduall_class c ON c.ed_class_id = q.ed_quarter_note_class AND c.ed_class_deleted = 0
      LEFT JOIN eduall_academic_level l ON l.ed_academic_level_id = c.ed_class_academic_level AND l.ed_academic_level_deleted = 0
    `;

    const quarters = [1, 2, 3];
    const results = {};

    for (const q of quarters) {
      const params = [resolvedClass, q, resolvedStudent];
      let whereClause = `
        WHERE q.ed_quarter_note_class = ? 
          AND q.ed_quarter_note_quarter = ? 
          AND q.ed_quarter_note_deleted = 0
          AND q.ed_quarter_note_studentcode = ?
      `;

      if (subjectsList.length > 0) {
        whereClause += ` AND q.ed_quarter_note_subject IN (${subjectsList.map(() => '?').join(',')})`;
        params.push(...subjectsList);
      }

      const finalQuery = `${baseQuery} ${whereClause}`;
      const rows = await ExecuteQuery(res, finalQuery, params, true, {
        db: "eduall_quarterly_notes",
        type: "select",
        data: req,
      });

      const notesMap = new Map();
      rows.forEach(item => {
        const mac = item.ed_quarter_note_mac * 1;
        const npp = item.ed_quarter_note_npp * 1;
        const npt = item.ed_quarter_note_npt * 1;
        const max = item.max_value * 1;
        const mt = Math.floor(((mac + npp + npt) / 3) * 100) / 100;
        const status = mt < (max / 2) ? 0 : 1;
        const warning = mt > max ? 1 : 0;

        const note = {
          student_id: item.ed_quarter_note_studentcode,
          student_name: item.ed_student_name,
          subject_name: item.ed_subject_title,
          class_name: item.ed_class_title,
          mac_note: mac,
          npp_note: npp,
          npt_note: npt,
          mt,
          max_value: max,
          status,
          warning,
          quarter: q,
          subject_id: item.ed_quarter_note_subject
        };

        notesMap.set(`${note.student_id}_${note.subject_id}`, note);
      });

      const resultList = [];
      for (const subjectId of subjectsList) {
        const key = `${resolvedStudent}_${subjectId}`;
        if (notesMap.has(key)) {
          resultList.push(notesMap.get(key));
        } else {
          resultList.push({
            student_id: resolvedStudent,
            student_name: studentBasic.ed_student_name,
            subject_id: subjectId,
            subject_name: subjectTitlesMap.get(subjectId) || "",
            class_name: "",
            mac_note: "Não lançado",
            npp_note: "Não lançado",
            npt_note: "Não lançado",
            mt: "Não lançado",
            max_value: null,
            status: null,
            warning: null,
            quarter: q
          });
        }
      }

      results[`quarter_${q}`] = resultList;
    }

    // Notas de exame
    const examQuery = `
      SELECT n.ed_student_exam_score as exam_note, n.ed_student_exam_subject as subject_id, 
             s.ed_student_name, sub.ed_subject_title, c.ed_class_title
      FROM eduall_student_exam_notes n
      LEFT JOIN eduall_students s ON s.ed_student_id = n.ed_student_exam_studentCode AND s.ed_student_deleted = 0
      LEFT JOIN eduall_subjects sub ON sub.ed_subject_id = n.ed_student_exam_subject AND sub.ed_subject_deleted = 0
      LEFT JOIN eduall_class c ON c.ed_class_id = n.ed_student_exam_class AND c.ed_class_deleted = 0
      WHERE n.ed_student_exam_class = ? 
        AND n.ed_student_exam_deleted = 0 
        AND n.ed_student_exam_institute_code = ?
        AND n.ed_student_exam_studentCode = ?
    `;
    const exam = await ExecuteQuery(
      res,
      examQuery,
      [resolvedClass, institute, resolvedStudent],
      true,
      { db: "eduall_student_exam_notes", type: "select", data: req }
    );

    // Notas em destaque
    const featuredQuery = `
      SELECT n.ed_student_featured_note_score as featured_note, n.ed_student_featured_note_subject as subject_id,
             s.ed_student_name, sub.ed_subject_title, c.ed_class_title
      FROM eduall_student_featured_notes n
      LEFT JOIN eduall_students s ON s.ed_student_id = n.ed_student_featured_note_studentCode AND s.ed_student_deleted = 0
      LEFT JOIN eduall_subjects sub ON sub.ed_subject_id = n.ed_student_featured_note_subject AND sub.ed_subject_deleted = 0
      LEFT JOIN eduall_class c ON c.ed_class_id = n.ed_student_featured_note_class AND c.ed_class_deleted = 0
      WHERE n.ed_student_featured_note_class = ? 
        AND n.ed_student_featured_note_deleted = 0 
        AND n.ed_student_featured_note_institute_code = ?
        AND n.ed_student_featured_note_studentCode = ?
    `;
    const featured = await ExecuteQuery(
      res,
      featuredQuery,
      [resolvedClass, institute, resolvedStudent],
      true,
      { db: "eduall_student_featured_notes", type: "select", data: req }
    );

    return {
      quarters: results,
      exams: exam,
      featured: featured,
    };
  } catch (error) {
    console.error("getStudentQuarterlyAndExamNotes error:", error);
    return { quarters: {}, exams: [], featured: [] };
  }
};

// Notas semestrais (universidade)
const getStudentSemesterNotes = async (req, res, studentBasic) => {
  try {
    const institute = req.session.user.eduall_user_session_curentinstitute;
    const studentId = studentBasic.ed_student_id;

    const query = `
      SELECT n.*, sub.ed_subject_title, c.ed_class_title
      FROM eduall_semester_notes n
      LEFT JOIN eduall_subjects sub ON sub.ed_subject_id = n.ed_semester_note_subject AND sub.ed_subject_deleted = 0
      LEFT JOIN eduall_class c ON c.ed_class_id = n.ed_semester_note_class AND c.ed_class_deleted = 0
      WHERE 
        n.ed_semester_note_studentcode = ?
        AND n.ed_semester_note_institute_code = ?
    `;
    const rows = await ExecuteQuery(
      res,
      query,
      [studentId, institute],
      true,
      { db: "eduall_semester_notes", type: "select", data: req }
    );

    return rows;
  } catch (error) {
    console.error("getStudentSemesterNotes error:", error);
    return [];
  }
};

// Assiduidade do aluno
const getStudentAttendance = async (req, res, studentBasic) => {
  try {
    const studentId = studentBasic.ed_student_id;
    const institute = req.session.user.eduall_user_session_curentinstitute;

    const query = `
      SELECT a.*, s.ed_student_name, t.*, sub.ed_subject_title, c.ed_class_title
      FROM eduall_student_attendence a
      LEFT JOIN eduall_students s ON s.ed_student_id = a.ed_student_attd_student_code
      LEFT JOIN eduall_timing t ON t.ed_timing_id = a.ed_student_attd_timing
      LEFT JOIN eduall_subjects sub ON sub.ed_subject_id = a.ed_student_attd_subject
      LEFT JOIN eduall_class c ON c.ed_class_id = a.ed_student_attd_class
      WHERE 
        a.ed_student_attd_deleted = 0
        AND a.ed_student_attd_student_code = ?
        AND a.ed_student_attd_institute_code = ?
      ORDER BY a.ed_student_attd_date DESC
    `;
    const rows = await ExecuteQuery(
      res,
      query,
      [studentId, institute],
      true,
      { db: "eduall_student_attendence", type: "select", data: req }
    );

    return rows;
  } catch (error) {
    console.error("getStudentAttendance error:", error);
    return [];
  }
};

// Assiduidade do funcionário
const getEmployeeAttendance = async (req, res, employeeId) => {
  try {
    const institute = req.session.user.eduall_user_session_curentinstitute;

    const query = `
      SELECT ea.*, sub.ed_subject_title, c.ed_class_title, t.*, e.ed_employee_name
      FROM eduall_employee_attendence ea
      LEFT JOIN eduall_subjects sub ON ea.ed_employee_attd_subject = sub.ed_subject_id  
      LEFT JOIN eduall_class c ON ea.ed_employee_attd_class = c.ed_class_id
      LEFT JOIN eduall_timing t ON ea.ed_employee_attd_timing = t.ed_timing_id
      LEFT JOIN eduall_employees e ON ea.ed_employee_attd_code = e.ed_employee_id
      WHERE 
        ea.ed_employee_attd_deleted = 0 
        AND ea.ed_employee_attd_institute_code = ?
        AND ea.ed_employee_attd_code = ?
      ORDER BY ea.ed_employee_attd_date DESC
    `;
    const rows = await ExecuteQuery(
      res,
      query,
      [institute, employeeId],
      true,
      { db: "eduall_employee_attendence", type: "select", data: req }
    );

    return rows;
  } catch (error) {
    console.error("getEmployeeAttendance error:", error);
    return [];
  }
};

// Suspensões do aluno
const getStudentSuspensions = async (req, res, studentId) => {
  const institute = req.session.user.eduall_user_session_curentinstitute;

  const query = `
    SELECT * FROM eduall_suspensions
    WHERE ed_susp_student_id = ?
      AND ed_susp_institute_code = ?
      AND ed_susp_deleted = 0
    ORDER BY ed_susp_created_at DESC
  `;
  const rows = await ExecuteQuery(
    res,
    query,
    [studentId, institute],
    true,
    { db: "eduall_suspensions", type: "select", data: req }
  );

  return rows;
};

// Logs RFID do aluno
const getStudentRFIDLogs = async (req, res, studentId) => {
  const institute = req.session.user.eduall_user_session_curentinstitute;

  const query = `
    SELECT * FROM eduall_rfid_logs
    WHERE ed_rfidlog_institute_code = ?
      AND ed_rfidlog_student_id = ?
    ORDER BY ed_rfidlog_timestamp DESC
  `;
  const rows = await ExecuteQuery(
    res,
    query,
    [institute, studentId],
    true,
    { db: "eduall_rfid_logs", type: "select", data: req }
  );

  return rows;
};

// Logs RFID do funcionário
const getEmployeeRFIDLogs = async (req, res, employeeId) => {
  const institute = req.session.user.eduall_user_session_curentinstitute;

  const query = `
    SELECT * FROM eduall_rfid_logs
    WHERE ed_rfidlog_institute_code = ?
      AND ed_rfidlog_employee_id = ?
    ORDER BY ed_rfidlog_timestamp DESC
  `;
  const rows = await ExecuteQuery(
    res,
    query,
    [institute, employeeId],
    true,
    { db: "eduall_rfid_logs", type: "select", data: req }
  );

  return rows;
};

// Dados básicos do funcionário (sem join pesado)
const getEmployeeBasicDataByRFID = async (req, res, code) => {
  const institute = req.session.user.eduall_user_session_curentinstitute;

  const query = `
    SELECT * FROM eduall_employees
    WHERE 
      ed_employee_rfid_code = ?
      AND ed_employee_institute_code = ?
      AND ed_employee_deleted = 0
    LIMIT 1
  `;
  const rows = await ExecuteQuery(
    res,
    query,
    [code, institute],
    true,
    { db: "eduall_employees", type: "select", data: req }
  );

  return rows.length > 0 ? rows[0] : null;
};

// Dados básicos do aluno por RFID
const getStudentBasicByRFID = async (req, res, code) => {
  const institute = req.session.user.eduall_user_session_curentinstitute;

  const query = `
    SELECT ed_student_id 
    FROM eduall_students
    WHERE 
      ed_student_rfid_code = ?
      AND ed_student_institute_code = ?
      AND ed_student_deleted = 0
    LIMIT 1
  `;
  const rows = await ExecuteQuery(
    res,
    query,
    [code, institute],
    true,
    { db: "eduall_students", type: "select", data: req }
  );

  return rows.length > 0 ? rows[0].ed_student_id : null;
};

// FULL INFO: student ou employee
const RFIDFullInfo = async (req, res) => {
  try {
    const { code } = req.params;
 
    if (!code) {
      return res.status(400).json({
        success: false,
        msg: "Código RFID não informado.",
      });
    }
 
    const studentId = await getStudentBasicByRFID(req, res, code);

    if (studentId) {

      const basic = await getStudentFullBasicData(req, res, studentId);
 
      if (!basic) {
        return res.status(404).json({
          success: false,
          msg: "Aluno encontrado, mas os dados acadêmicos não estão disponíveis. Verifique se a turma ainda existe.",
        });
      }
 
      const [
        paymentsFees,
        paymentsServices,
        quarterlyAndExams,
        semesterNotes,
        attendance,
        suspensions,
        logs
      ] = await Promise.all([
        getStudentFeePayments(req, res, studentId),
        getStudentServicePayments(req, res, studentId),
        getStudentQuarterlyAndExamNotes(req, res, basic),
        getStudentSemesterNotes(req, res, basic),
        getStudentAttendance(req, res, basic),
        getStudentSuspensions(req, res, studentId),
        getStudentRFIDLogs(req, res, studentId),
      ]);

      const monthlyStatus = await getStudentMonthlyFeeStatus(req, res, basic);

      const hasActiveSuspension = suspensions?.some(
        s => s.ed_susp_status === "active" && s.ed_susp_deleted * 1 === 0
      ) || false;

      return res.status(200).json({
        success: true,
        type: "student",
        basic,
        
        class: basic.ed_class_id
          ? {
              id: basic.ed_class_id,
              title: basic.ed_class_title,
            }
          : null,

        faculty: basic.ed_faculty_id
          ? {
              faculty_id: basic.ed_faculty_id,
              faculty_name: basic.ed_faculty_title,
              course_id: basic.ed_course_id,
              course_title: basic.ed_course_title,
            }
          : null,

        payments: {
          fees: paymentsFees || [],
          services: paymentsServices || [],
          monthlyStatus: monthlyStatus || [],
        },

        notes: {
          quarterly: quarterlyAndExams?.quarters || {},
          exams: quarterlyAndExams?.exams || [],
          featured: quarterlyAndExams?.featured || [],
          semester: semesterNotes || [],
        },

        attendance: attendance || [],
        suspensions: suspensions || [],
        suspended: hasActiveSuspension,
        logs: logs || [],
      });
    }
 
    const employeeBasic = await getEmployeeBasicDataByRFID(req, res, code);

    if (employeeBasic) {

      const [attendance, logs] = await Promise.all([
        getEmployeeAttendance(req, res, employeeBasic.ed_employee_id),
        getEmployeeRFIDLogs(req, res, employeeBasic.ed_employee_id),
      ]);

      return res.status(200).json({
        success: true,
        type: "employee",
        basic: employeeBasic,
        attendance: attendance || [],
        logs: logs || [],
      });
    }
 
    return res.status(404).json({
      success: false,
      msg: "Este cartão RFID não está associado a nenhum aluno ou funcionário ativo.",
    });

  } catch (error) {

    console.error(" RFIDFullInfo error:", error);

    return res.status(500).json({
      success: false,
      msg: "Não foi possível consultar o RFID agora. Tente novamente em instantes.",
    });
  }
};


 
module.exports = {
  AutoDBSetup,
  RFIDRead,
  AssignStudentRFID,
  AssignEmployeeRFID,
  GenerateRFIDCode,
  RegisterRFIDLog,
  GetRFIDLogs,
  CreateSuspension,
  UpdateSuspension,
  LiftSuspension,
  DeleteSuspension,
  CheckSuspension,
  ListSuspensionsByStudent,
  GetAllSuspensions,
  RFIDFullInfo,
  router,
};
 