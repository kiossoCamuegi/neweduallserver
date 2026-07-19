const ExecuteQuery = require("../Functions/ExecuteQuery"); 
const { RegisterAuditAction } = require("./Auditory");
const crypto = require("crypto");
const bcrypt  = require("bcryptjs")


// garanatir qu não existam contas de users com o emsmso email no sistema

// remover ed_user_account_type, ed_user_account_instituteCode e por  ed_user_account_gender e ed_user_account_country padraoa "ao"
const RegisterBulkStudentUserAccounts = async (req, res) => {
  try {
    const { class_id, students } = req.body;
    const instituteCode = req.session.user.eduall_user_session_curentinstitute;

    if (!Array.isArray(students) || students.length === 0) {
      return res.status(400).json({ msg: "Nenhum estudante selecionado!" });
    }

    // 1️⃣ Verifica licença da instituição
    const licenceQuery = `
      SELECT ed_institute_licence_type 
      FROM eduall_institutes_licences 
      WHERE ed_institute_licence_instituteCode = ?`;
    const [licence] = await ExecuteQuery(res, licenceQuery, [instituteCode], true, {
      db: "eduall_institutes_licences",
      type: "select",
      data: req
    });

    if (!licence) {
      return res.status(300).json({ msg: "Licença do software não encontrada!" });
    }

    // 2️⃣ Verifica limite de contas (licença gratuita = tipo 3)
    if (licence.ed_institute_licence_type * 1 === 3) {
      const totalAccountsQuery = `
        SELECT COUNT(*) AS total 
        FROM eduall_users_student_accounts 
        WHERE ed_user_std_account_deleted = 0 
        AND ed_user_std_account_instituteCode = ?`;
      const [totalAccounts] = await ExecuteQuery(res, totalAccountsQuery, [instituteCode], true, {
        db: "eduall_users_student_accounts",
        type: "select",
        data: req
      });

      if ((totalAccounts.total || 0) + students.length > 4000) {
        return res.status(301).json({
          msg: "Atingiu o limite máximo de contas para a licença atual!"
        });
      }
    }

    // 3️⃣ Buscar estudantes que já têm conta
    const studentIds = students.map((s) => s.ed_student_id);
    const placeholders = studentIds.map(() => "?").join(",");
    const existingQuery = `
      SELECT ed_user_std_account_studentCode 
      FROM eduall_users_student_accounts 
      WHERE ed_user_std_account_deleted = 0 
      AND ed_user_std_account_instituteCode = ? 
      AND ed_user_std_account_studentCode IN (${placeholders})`;

    const existingAccounts = await ExecuteQuery(
      res,
      existingQuery,
      [instituteCode, ...studentIds],
      true,
      { db: "eduall_users_student_accounts", type: "select", data: req }
    );

    const existingIds = new Set(existingAccounts.map(a => a.ed_user_std_account_studentCode));

    // 4️⃣ Filtra apenas estudantes sem conta
    const studentsToCreate = students.filter(s => !existingIds.has(s.ed_student_id));

    if (studentsToCreate.length === 0) {
      return res.status(200).json({
        msg: "Todos os estudantes já possuem conta registrada."
      });
    }

    // 5️⃣ Gerar hash da senha padrão uma única vez
    const DEFAULT_PASSWORD = "765*eduall#";
    const salt = await bcrypt.genSalt(12);
    const hashPassword = await bcrypt.hash(DEFAULT_PASSWORD, salt);

    // 6️⃣ Buscar todos os emails existentes de uma vez
    const existingEmailsQuery = `
      SELECT ed_user_account_email 
      FROM eduall_user_accounts 
      WHERE ed_user_account_deleted = 0`;
    const existingEmailsRows = await ExecuteQuery(
      res,
      existingEmailsQuery,
      [],
      true,
      { db: "eduall_user_accounts", type: "select", data: req }
    );
    const existingEmailSet = new Set(existingEmailsRows.map(e => e.ed_user_account_email));

    // 7️⃣ Gerar e-mails únicos e preparar inserts
    let userValues = [];
    const studentLinkValues = [];
    const generatedEmails = new Set(existingEmailSet);

    for (const student of studentsToCreate) {
      const { ed_student_id, ed_student_name, ed_student_gender } = student;

      // Primeiro + último nome
      const nameParts = ed_student_name.trim().split(/\s+/);
      let firstLast = nameParts[0] + (nameParts.length > 1 ? nameParts[nameParts.length - 1] : "");
      const cleanName = firstLast.toLowerCase();

      // Gera email único
      let email, attempts = 0;
      do {
        const randomCode = crypto.randomBytes(3).toString("hex");
        email = `${cleanName}${randomCode}@eduall.ao`;
        attempts++;
      } while (generatedEmails.has(email) && attempts < 5);
      generatedEmails.add(email);

      userValues.push([
        ed_student_name,
        email,
        hashPassword,
        ed_student_gender || "male", // adiciona gênero
        "ao" // país padrão
      ]);
    }

    if (userValues.length === 0) {
      return res.status(200).json({
        msg: "Nenhuma nova conta criada — todos os e-mails já existiam no sistema."
      });
    }

    // 8️⃣ Inserir usuários
    const userInsert = `
      INSERT INTO eduall_user_accounts 
      (ed_user_account_name, ed_user_account_email, ed_user_account_password, ed_user_account_gender, ed_user_account_country)
      VALUES ?`;

    const userResult = await ExecuteQuery(
      res,
      userInsert,
      [userValues],
      false,
      { db: "eduall_user_accounts", type: "insert", data: req }
    );

    // 9️⃣ Associar usuários aos estudantes
    const firstUserId = userResult.insertId;
    for (let i = 0; i < userValues.length; i++) {
      const newUserId = firstUserId + i;
      const studentId = studentsToCreate[i].ed_student_id;
      studentLinkValues.push([newUserId, studentId, instituteCode]);
    }

    const studentAccountInsert = `
      INSERT INTO eduall_users_student_accounts
      (ed_user_std_account_userCode, ed_user_std_account_studentCode, ed_user_std_account_instituteCode)
      VALUES ?`;

    await ExecuteQuery(
      res,
      studentAccountInsert,
      [studentLinkValues],
      false,
      { db: "eduall_users_student_accounts", type: "insert", data: req }
    );

    // 10️⃣ Registrar auditoria
    await RegisterAuditAction({
      session: req.session,
      action: 1,
      form: "Contas de Estudantes (Criação em Massa)",
      description: `Criou ${userValues.length} novas contas de estudante na turma #${class_id}`
    });

    // 11️⃣ Resposta final
    res.status(200).json({
      msg: `Foram criadas ${userValues.length} novas contas de estudante com sucesso!`,
      created: userValues.length,
      skipped_students: existingIds.size,
      skipped_emails: existingEmailSet.size,
      total_requested: students.length,
      default_password: DEFAULT_PASSWORD
    });

  } catch (err) {
    console.error("[RegisterBulkStudentUserAccounts] Erro:", err);
    res.status(500).json({ msg: "Erro ao estabelecer ligação com o servidor!" });
  }
};
const RegisterStudentUserAccount = async (req, res) => {
    try {
        const { student_account_usercode, student_account_studentcode } = req.body;

        const query2 = `SELECT * FROM eduall_users_student_accounts WHERE ed_user_std_account_deleted = 0 
        AND ed_user_std_account_userCode = ? AND ed_user_std_account_studentCode = ? AND ed_user_std_account_instituteCode = ?`;
        const PARAMS2 = [student_account_usercode, student_account_studentcode, req.session.user.eduall_user_session_curentinstitute];
        const rows = await ExecuteQuery(res, query2, PARAMS2, true, { db: "eduall_users_student_accounts", type: "select", data: req });

        if (rows.length >= 1) {
            return res.status(300).json({ msg: "O usuário mencionado já tem acesso aos dados deste estudante ou já está registrado!" });
        }

        const query3 = `SELECT * FROM eduall_students WHERE ed_student_deleted = 0 AND ed_student_id = ?`;
        const PARAMS3 = [student_account_studentcode];
        const studentRows = await ExecuteQuery(res, query3, PARAMS3, true, { db: "eduall_students", type: "select", data: req });

        if (studentRows.length <= 0) {
            return res.status(300).json({ msg: "O estudante foi deletado do sistema!" });
        }

        const query0 = `SELECT * FROM eduall_institutes_licences WHERE ed_institute_licence_instituteCode = ?`;
        const PARAMS0 = [req.session.user.eduall_user_session_curentinstitute];
        const LicRows = await ExecuteQuery(res, query0, PARAMS0, true, { db: "eduall_institutes_licences", type: "select", data: req });

        if (LicRows.length === 0) {
            return res.status(300).json({ msg: "Licença do software não encontrada!" });
        }

        if (LicRows[0].ed_institute_licence_type * 1 === 3) {
            const query00 = `SELECT COUNT(*) AS total FROM eduall_users_student_accounts WHERE ed_user_std_account_deleted = 0 AND ed_user_std_account_instituteCode = ?`;
            const totalAccount = await ExecuteQuery(res, query00, PARAMS0, true, { db: "eduall_users_student_accounts", type: "select", data: req });
            
            if (totalAccount[0].total >= 4000) {
                return res.status(301).json({ msg: "Atingiu o limite máximo de contas de estudante para a licença atual!" });
            }
        }

        const query = `INSERT INTO eduall_users_student_accounts(ed_user_std_account_userCode, ed_user_std_account_studentCode, 
        ed_user_std_account_instituteCode) VALUES(?,?,?)`;
        const PARAMS = [student_account_usercode, student_account_studentcode, req.session.user.eduall_user_session_curentinstitute];
        await ExecuteQuery(res, query, PARAMS, false, { db: "eduall_users_student_accounts", type: "insert", data: req });

        // Registra a ação no audit log
        await RegisterAuditAction({
            session: req.session,
            action: 1,  // Ação de registro
            form: "Contas de Estudantes",
            description: `Registrou uma nova conta de estudante para o estudante com o nº de matrícula #${student_account_studentcode}`,
        });

        res.status(200).json({ msg: "Success!" });
    } catch (err) {
        res.status(500).json({ msg: "Erro ao estabelecer ligação com o servidor!" });
    }
};

// Exemplo de outras funções com auditoria semelhante:
const UserStudentAccountDelete = async (req, res) => {
    try {
        const { ID } = req.params;
        const query = `UPDATE eduall_users_student_accounts SET ed_user_std_account_deleted = 1
        WHERE ed_user_std_account_deleted = 0 AND ed_user_std_account_id = ? AND ed_user_std_account_instituteCode = ?`;
        const PARAMS = [ID, req.session.user.eduall_user_session_curentinstitute];
        await ExecuteQuery(res, query, PARAMS, false, { db: "eduall_users_student_accounts", type: "update", data: req });

        // Registra a ação no audit log
        await RegisterAuditAction({
            session: req.session,
            action: 3,  // Ação de eliminação
            form: "Contas de Estudantes",
            description: `Eliminou a conta de estudante com ID ${ID}`,
        });

        res.status(200).json({ success: true, msg: "Conta de estudante deletada com sucesso!" });
    } catch (err) {
        res.status(400).json({ status: 300, success: false, msg: err.message });
    }
};

const GetStudentsUserAccounts = async (req, res) => {
    try {
        const query = `SELECT * FROM eduall_users_student_accounts 
        LEFT JOIN eduall_students ON eduall_users_student_accounts.ed_user_std_account_studentCode = eduall_students.ed_student_id
        LEFT JOIN eduall_class ON eduall_students.ed_student_class = eduall_class.ed_class_id  
        WHERE eduall_users_student_accounts.ed_user_std_account_deleted = 0 
        AND eduall_students.ed_student_deleted = 0 
        AND eduall_class.ed_class_deleted = 0
        AND eduall_users_student_accounts.ed_user_std_account_instituteCode = ? 
        ORDER BY eduall_students.ed_employee_name ASC`;
        const PARAMS = [req.session.user.eduall_user_session_curentinstitute];
        const rows = await ExecuteQuery(res, query, PARAMS, true, { db: "eduall_users_student_accounts", type: "select", data: req });
        res.status(200).json(rows);
    } catch (err) {
        res.status(400).json({ status: 300, success: false, msg: err.message });
    }
};

const GetSingleUserStudentAccounts = async (req, res) => {
  try {
    const { ID } = req.params;
 
   const query = `
  SELECT 
      usac.*, 
      us.ed_user_account_picture, 
      us.ed_user_account_id, 
      us.ed_user_account_name,

      -- dados do estudante
      es.*, 

      -- dados institucionais
      ei.*,

      -- joins adicionais (mesmo padrão do GetSingleStudent)
      cl.ed_class_id, cl.ed_class_title,
      fa.ed_faculty_id, fa.ed_faculty_title,
      cr.ed_classroom_id, cr.ed_classroom_title,
      ci.ed_cicle_id, ci.ed_cicle_title,
      co.ed_course_id, co.ed_course_title,
      al.ed_academic_level_id, al.ed_academic_level_title,
      ay.ed_academic_year_id, ay.ed_academic_year_title

  FROM 
      eduall_users_student_accounts AS usac

  LEFT JOIN 
      eduall_user_accounts AS us 
      ON usac.ed_user_std_account_userCode = us.ed_user_account_id

  INNER JOIN 
      eduall_students AS es 
      ON es.ed_student_id = usac.ed_user_std_account_studentCode
      AND es.ed_student_deleted = 0

  INNER JOIN 
      eduall_institutes AS ei 
      ON ei.ed_institute_code = es.ed_student_institute_code
      AND ei.ed_institute_deleted = 0
      AND LENGTH(ei.ed_institute_code) >= 5

  INNER JOIN 
      eduall_institutes_licences AS lic 
      ON lic.ed_institute_licence_instituteCode = ei.ed_institute_code
      AND lic.ed_institute_licence_endDate IS NOT NULL
      AND lic.ed_institute_licence_endDate > NOW()
      AND lic.ed_institute_licence_type IN (0, 3, 4, 5)

  -- mesmos relacionamentos do GetSingleStudent
  LEFT JOIN 
      eduall_class AS cl 
      ON cl.ed_class_id = es.ed_student_class 
      AND cl.ed_class_deleted = 0

  LEFT JOIN 
      eduall_faculty AS fa 
      ON fa.ed_faculty_id = cl.ed_class_faculty 
      AND fa.ed_faculty_deleted = 0

  LEFT JOIN 
      eduall_classrooms AS cr 
      ON cr.ed_classroom_id = cl.ed_class_room 
      AND cr.ed_classroom_deleted = 0

  LEFT JOIN 
      eduall_cicles AS ci 
      ON ci.ed_cicle_id = cl.ed_class_cicle 
      AND ci.ed_cicle_deleted = 0

  LEFT JOIN 
      eduall_courses AS co 
      ON co.ed_course_id = cl.ed_class_course 
      AND co.ed_course_deleted = 0

  LEFT JOIN 
      eduall_academic_level AS al 
      ON al.ed_academic_level_id = cl.ed_class_academic_level 
      AND al.ed_academic_level_deleted = 0

  LEFT JOIN 
      eduall_academic_year AS ay 
      ON ay.ed_academic_year_id = cl.ed_class_year 
      AND ay.ed_academic_year_deleted = 0

  WHERE 
      usac.ed_user_std_account_userCode = ? 
      AND usac.ed_user_std_account_deleted = 0
`;


    const PARAMS = [ID];

    const rows = await ExecuteQuery(res, query, PARAMS, true, {
      db: "eduall_users_student_accounts",
      type: "select",
      data: req
    });

    res.status(200).json(rows);
  } catch (err) {
    res.status(400).json({ 
      status: 300, 
      success: false, 
      msg: err.message 
    });
  }
};








const GetSingleUserStudentAccountsByStudentWorkspaces = async (req, res) => {
    try {
      const { ID } = req.params;
  
      const query = `
        SELECT usac.*, us.ed_user_account_picture, us.ed_user_account_id, us.ed_user_account_name
        FROM eduall_users_student_accounts AS usac
        LEFT JOIN eduall_user_accounts AS us ON usac.ed_user_std_account_userCode = us.ed_user_account_id 
        LEFT JOIN eduall_institutes AS inst ON usac.ed_user_std_account_instituteCode = inst.ed_institute_code 
        LEFT JOIN eduall_institutes_licences AS lic ON lic.ed_institute_licence_instituteCode = inst.ed_institute_code
        WHERE usac.ed_user_std_account_studentCode = ?  
          AND usac.ed_user_std_account_deleted = 0
          AND (
            lic.ed_institute_licence_endDate IS NOT NULL 
            AND lic.ed_institute_licence_endDate > NOW()
            AND lic.ed_institute_licence_type IN (0, 3, 4, 5)
          )
      `;
  
      const PARAMS = [ID];
      const rows = await ExecuteQuery(res, query, PARAMS, true, {
        db: "eduall_users_student_accounts",
        type: "select",
        data: req
      });
  
      res.status(200).json(rows);
    } catch (err) {
      res.status(400).json({ status: 300, success: false, msg: err.message });
    }
  };

const GetSingleUserStudentAccountsByStudent = async (req, res) => {
    try {
      const { ID } = req.params;
  
      const query = `
        SELECT usac.*, us.ed_user_account_picture, us.ed_user_account_id, us.ed_user_account_name
        FROM eduall_users_student_accounts AS usac
        LEFT JOIN eduall_user_accounts AS us ON usac.ed_user_std_account_userCode = us.ed_user_account_id 
        LEFT JOIN eduall_institutes AS inst ON usac.ed_user_std_account_instituteCode = inst.ed_institute_code 
        LEFT JOIN eduall_institutes_licences AS lic ON lic.ed_institute_licence_instituteCode = inst.ed_institute_code
        WHERE usac.ed_user_std_account_studentCode = ? 
          AND usac.ed_user_std_account_userCode = ? 
          AND usac.ed_user_std_account_deleted = 0
          AND (
            lic.ed_institute_licence_endDate IS NOT NULL 
            AND lic.ed_institute_licence_endDate > NOW()
            AND lic.ed_institute_licence_type IN (0, 3, 4, 5)
          )
      `;
  
      const PARAMS = [ID, req.session.user.eduall_user_session_ID];
      const rows = await ExecuteQuery(res, query, PARAMS, true, {
        db: "eduall_users_student_accounts",
        type: "select",
        data: req
      });
  
      res.status(200).json(rows);
    } catch (err) {
      res.status(400).json({ status: 300, success: false, msg: err.message });
    }
  };
  
 

const GetUsersStudentsAccountsByInstitute = async (req, res) => {
    try {
        const query = `SELECT * FROM eduall_users_student_accounts 
        LEFT JOIN eduall_students ON eduall_users_student_accounts.ed_user_std_account_studentCode = eduall_students.ed_student_id
        LEFT JOIN eduall_class ON eduall_students.ed_student_class = eduall_class.ed_class_id  
        LEFT JOIN eduall_institutes ON eduall_students.ed_student_institute_code = eduall_institutes.ed_institute_code
        LEFT JOIN eduall_user_accounts ON eduall_users_student_accounts.ed_user_std_account_userCode = eduall_user_accounts.ed_user_account_id
        WHERE eduall_institutes.ed_institute_deleted = 0 
        AND eduall_students.ed_student_deleted = 0 
        AND eduall_user_accounts.ed_user_account_deleted = 0
        AND eduall_class.ed_class_deleted = 0
        AND eduall_users_student_accounts.ed_user_std_account_deleted = 0 
        AND eduall_institutes.ed_institute_code = ?`;
        const PARAMS = [req.session.user.eduall_user_session_curentinstitute];
        const rows = await ExecuteQuery(res, query, PARAMS, true, { db: "eduall_users_student_accounts", type: "select", data: req });
        res.status(200).json(rows);
    } catch (err) {
        res.status(400).json({ status: 300, success: false, msg: err.message });
    }
};




const ResetStudentPasswordController = async (req, res) => {
  try {
    const { userId, email } = req.body;
    const instituteCode = req.session.user.eduall_user_session_curentinstitute;

    if (!userId || !email) {
      return res.status(400).json({ msg: "userId e email são obrigatórios!" });
    }

    // 1️⃣ Verifica se o email termina com @eduall.ao
    if (!email.toLowerCase().endsWith("@eduall.ao")) {
      return res.status(400).json({ msg: "Email não é do tipo @eduall.ao" });
    }

    // 2️⃣ Verifica se a conta existe
    const userQuery = `
      SELECT ed_user_account_id, ed_user_account_email
      FROM eduall_user_accounts
      WHERE ed_user_account_id = ? AND ed_user_account_email = ? AND ed_user_account_deleted = 0
    `;
    const [user] = await ExecuteQuery(
      res,
      userQuery,
      [userId, email],
      true,
      { db: "eduall_user_accounts", type: "select", data: req }
    );

    if (!user) {
      return res.status(404).json({ msg: "Conta de usuário não encontrada!" });
    }

    // 3️⃣ Verifica se a conta está associada à escola
    const assocQuery = `
      SELECT ed_user_std_account_id
      FROM eduall_users_student_accounts
      WHERE ed_user_std_account_userCode = ? AND ed_user_std_account_instituteCode = ? AND ed_user_std_account_deleted = 0
    `;
    const [assoc] = await ExecuteQuery(
      res,
      assocQuery,
      [userId, instituteCode],
      true,
      { db: "eduall_users_student_accounts", type: "select", data: req }
    );

    if (!assoc) {
      return res.status(403).json({ msg: "Conta não está associada à sua escola!" });
    }

    // 4️⃣ Resetar senha padrão
    const DEFAULT_PASSWORD = "765*eduall#";
    const salt = await bcrypt.genSalt(12);
    const hashPassword = await bcrypt.hash(DEFAULT_PASSWORD, salt);

    const updateQuery = `
      UPDATE eduall_user_accounts
      SET ed_user_account_password = ?
      WHERE ed_user_account_id = ?
    `;

    await ExecuteQuery(
      res,
      updateQuery,
      [hashPassword, userId],
      false,
      { db: "eduall_user_accounts", type: "update", data: req }
    );
 
    await RegisterAuditAction({
      session: req.session,
      action: 2, // ação de atualização
      form: "Reset de senha de estudante",
      description: `Senha da conta ${email} resetada para padrão pela escola #${instituteCode}`
    });

   
    res.status(200).json({
      msg: `Senha da conta ${email} resetada com sucesso para o padrão.`,
      default_password: DEFAULT_PASSWORD
    });

  } catch (err) {
    console.error("[ResetStudentPasswordController] Erro:", err);
    res.status(500).json({ msg: "Erro ao resetar a senha!" });
  }
};



module.exports = { RegisterStudentUserAccount, RegisterBulkStudentUserAccounts, UserStudentAccountDelete, GetSingleUserStudentAccountsByStudent,
    ResetStudentPasswordController,
GetUsersStudentsAccountsByInstitute, GetSingleUserStudentAccounts, GetStudentsUserAccounts , GetSingleUserStudentAccountsByStudentWorkspaces};


 