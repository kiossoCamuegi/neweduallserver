const ExecuteQuery = require("../Functions/ExecuteQuery"); 
 
const CreateQuarterlyNoteRestrictionsTable = async (instituteCode) => {
  try {
    if (!instituteCode) throw new Error("Código da escola não fornecido.");

    // Criação da tabela (só cria se não existir, não altera tabela já existente)
    const createTableQuery = `
      CREATE TABLE IF NOT EXISTS eduall_quarterly_note_restrictions (
        ed_quarterly_restriction_id INT PRIMARY KEY AUTO_INCREMENT,
        ed_quarterly_restriction_first_quarter BOOLEAN DEFAULT TRUE,
        ed_quarterly_restriction_second_quarter BOOLEAN DEFAULT TRUE,
        ed_quarterly_restriction_third_quarter BOOLEAN DEFAULT TRUE,
        ed_quarterly_restriction_presence BOOLEAN DEFAULT TRUE,
        ed_quarterly_restriction_specialexam BOOLEAN DEFAULT TRUE,
        ed_quarterly_restriction_exam BOOLEAN DEFAULT TRUE,
        ed_quarterly_restriction_institute_code VARCHAR(255) UNIQUE,
        ed_quarterly_restriction_created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `;
    await ExecuteQuery(null, createTableQuery, [], false, { db: "eduall_quarterly_note_restrictions", type: "create" });

    // Verifica se registro para essa escola já existe
    const checkQuery = `
      SELECT 1 FROM eduall_quarterly_note_restrictions WHERE ed_quarterly_restriction_institute_code = ? LIMIT 1
    `;
    const exists = await ExecuteQuery(null, checkQuery, [instituteCode], true, { db: "eduall_quarterly_note_restrictions", type: "select" });

    if (exists.length === 0) {
      // Se não existir, insere o registro padrão
      const insertQuery = `
        INSERT INTO eduall_quarterly_note_restrictions (
          ed_quarterly_restriction_first_quarter, 
          ed_quarterly_restriction_second_quarter,
          ed_quarterly_restriction_third_quarter,
          ed_quarterly_restriction_presence,
          ed_quarterly_restriction_specialexam,
          ed_quarterly_restriction_exam,
          ed_quarterly_restriction_institute_code
        ) VALUES (TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, ?)
      `;
      await ExecuteQuery(null, insertQuery, [instituteCode], false, { db: "eduall_quarterly_note_restrictions", type: "insert" });
    }

    // Se existir, não faz nada (nem altera valores)
  } catch (error) {
    console.error("Erro ao criar tabela ou inserir registro:", error.message);
    throw error;
  }
};


 
const UpdateQuarterlyNoteRestriction = async (req, res) => {
  try {
    

    const { firstQuarter, secondQuarter, thirdQuarter, presence , SpecialExam, Exam } = req.body;
    const instituteCode = req?.session?.user?.eduall_user_session_curentinstitute;
    const currentSystemAccountId = req?.session?.user?.eduall_user_session_ID;
    await CreateQuarterlyNoteRestrictionsTable(instituteCode);

    if (!instituteCode || !currentSystemAccountId) {
      return res.status(400).json({ success: false, msg: "Sessão inválida. Dados do utilizador ou instituição não encontrados." });
    }

    console.log("DATA = ", req.body);

    // Buscar o funcionário ligado à conta de sistema atual
    const getEmployeeIdQuery = `
      SELECT ed_system_account_employee 
      FROM eduall_system_accounts 
      WHERE ed_system_account_userid = ? AND ed_system_account_institute_code = ? AND ed_system_account_deleted = 0
    `;
    const employeeResult = await ExecuteQuery(res, getEmployeeIdQuery, [currentSystemAccountId, instituteCode], true, {
      db: "eduall_system_accounts",
      type: "select",
      data: req,
    });

    if (!employeeResult.length) {
      return res.status(403).json({ success: false, msg: "Conta de sistema não encontrada ou não associada a esta instituição." });
    }

    const currentEmployeeId = employeeResult[0].ed_system_account_employee;

    // Verificar se este funcionário é o diretor pedagógico
    const checkDirectorQuery = `
      SELECT ed_institute_pedagogical_director 
      FROM eduall_institutes 
      WHERE ed_institute_code = ? AND ed_institute_deleted = 0
    `;
    const instituteResult = await ExecuteQuery(res, checkDirectorQuery, [instituteCode], true, {
      db: "eduall_institutes",
      type: "select",
      data: req,
    });

    if (!instituteResult.length || instituteResult[0].ed_institute_pedagogical_director != currentEmployeeId) {
      return res.status(403).json({ success: false, msg: "Apenas o diretor pedagógico pode alterar as restrições de lançamento de notas !" });
    }

    // Atualizar as restrições
    const updateQuery = `
      UPDATE eduall_quarterly_note_restrictions
      SET ed_quarterly_restriction_first_quarter = ?, 
          ed_quarterly_restriction_second_quarter = ?, 
          ed_quarterly_restriction_third_quarter = ? ,
           ed_quarterly_restriction_presence = ?,
             ed_quarterly_restriction_specialexam = ?,
             ed_quarterly_restriction_exam = ?
      WHERE ed_quarterly_restriction_institute_code = ?
    `;

    const params = [firstQuarter, secondQuarter, thirdQuarter, presence, SpecialExam, Exam ,  instituteCode];
    const result = await ExecuteQuery(res, updateQuery, params, false, {
      db: "eduall_quarterly_note_restrictions",
      type: "update",
      data: req,
    });




    const query1 = `SELECT * FROM eduall_quarterly_note_restrictions WHERE ed_quarterly_restriction_institute_code = ? LIMIT 1`;
    const result1 = await ExecuteQuery(res, query1, [instituteCode], true, { db: "eduall_quarterly_note_restrictions", type: "select", data: req });
    const restriction = result1[0]; 
    console.log("RT DATA = ",restriction);



    res.status(200).json({ success: true, data: result });
  } catch (error) {
    console.clear();
    console.log(error);
    res.status(500).json({
      success: false,
      msg: "Falha ao atualizar as restrições de lançamento de notas.",
      error: error.message,
    });
  }
}; 

const CheckQuarterlyNotePermission = async (req, res, quarter) => {
  try {
    if (!req?.session?.user?.eduall_user_session_curentinstitute) {
      return { allowed: false }; 
    }
  
    const instituteCode = req.session.user.eduall_user_session_curentinstitute;
    await CreateQuarterlyNoteRestrictionsTable(instituteCode);

    const query = `
      SELECT ed_quarterly_restriction_first_quarter,
             ed_quarterly_restriction_second_quarter,
             ed_quarterly_restriction_third_quarter
      FROM eduall_quarterly_note_restrictions
      WHERE ed_quarterly_restriction_institute_code = ?
      LIMIT 1
    `;
    const result = await ExecuteQuery(res, query, [instituteCode], true, { db: "eduall_quarterly_note_restrictions", type: "select", data: req });

    if (result.length === 0) {
      return { allowed: false };
    }

    const restriction = result[0];

    if (quarter === 1 && restriction.ed_quarterly_restriction_first_quarter === 0) 
      return { allowed: true };
    if (quarter === 2 && restriction.ed_quarterly_restriction_second_quarter === 0) 
      return { allowed: true };
    if (quarter === 3 && restriction.ed_quarterly_restriction_third_quarter === 0) 
      return { allowed: true };

    return { allowed: false };
  } catch (error) {
    console.log("Erro ao verificar permissão de lançamento de notas: ", error.message);
    return { allowed: false };
  }
};



const CheckExamPermission = async (req, res) => {
  try {
    if (!req?.session?.user?.eduall_user_session_curentinstitute) {
      return { allowed: false };
    }

    const instituteCode = req.session.user.eduall_user_session_curentinstitute;
    await CreateQuarterlyNoteRestrictionsTable(instituteCode);

    const query = `
      SELECT ed_quarterly_restriction_exam
      FROM eduall_quarterly_note_restrictions
      WHERE ed_quarterly_restriction_institute_code = ?
      LIMIT 1
    `;
    const result = await ExecuteQuery(res, query, [instituteCode], true, { db: "eduall_quarterly_note_restrictions", type: "select", data: req });

    if (result.length === 0) return { allowed: false };
    return { allowed: result[0].ed_quarterly_restriction_exam === 0 };
  } catch (error) {
    console.log("Erro ao verificar permissão para exame: ", error.message);
    return { allowed: false };
  }
};


const CheckSpecialExamPermission = async (req, res) => {
  try {
    if (!req?.session?.user?.eduall_user_session_curentinstitute) {
      return { allowed: false };
    }

    const instituteCode = req.session.user.eduall_user_session_curentinstitute;
    await CreateQuarterlyNoteRestrictionsTable(instituteCode);

    const query = `
      SELECT ed_quarterly_restriction_specialexam
      FROM eduall_quarterly_note_restrictions
      WHERE ed_quarterly_restriction_institute_code = ?
      LIMIT 1
    `;
    const result = await ExecuteQuery(res, query, [instituteCode], true, { db: "eduall_quarterly_note_restrictions", type: "select", data: req });

    if (result.length === 0) return { allowed: false };
    return { allowed: result[0].ed_quarterly_restriction_specialexam === 0 };
  } catch (error) {
    console.log("Erro ao verificar permissão para exame especial: ", error.message);
    return { allowed: false };
  }
};


const CheckPresencePermission = async (req, res) => {
  try {
    if (!req?.session?.user?.eduall_user_session_curentinstitute) {
      return { allowed: false };
    }

    const instituteCode = req.session.user.eduall_user_session_curentinstitute;
    await CreateQuarterlyNoteRestrictionsTable(instituteCode);

    const query = `
      SELECT ed_quarterly_restriction_presence
      FROM eduall_quarterly_note_restrictions
      WHERE ed_quarterly_restriction_institute_code = ?
      LIMIT 1
    `;
    const result = await ExecuteQuery(res, query, [instituteCode], true, { db: "eduall_quarterly_note_restrictions", type: "select", data: req });

    if (result.length === 0) return { allowed: false };
    return { allowed: result[0].ed_quarterly_restriction_presence === 0 };
  } catch (error) {
    console.log("Erro ao verificar permissão para presença: ", error.message);
    return { allowed: false };
  }
};




const GetQuarterlyNotesPermissions = async (req, res)=>{
  try { 
    const instituteCode = req.session.user.eduall_user_session_curentinstitute;
    await CreateQuarterlyNoteRestrictionsTable(instituteCode);

    const query = `
      SELECT * FROM eduall_quarterly_note_restrictions
      WHERE ed_quarterly_restriction_institute_code = ?
      LIMIT 1
    `;
    const result = await ExecuteQuery(res, query, [instituteCode], true, { db: "eduall_quarterly_note_restrictions", type: "select", data: req });
    const restriction = result[0]; 
    console.log("RT DATA = ",restriction);

   return res.json(result);
  } catch (error) {
     return res.status(500).json(error);
  }
}

module.exports = {
  UpdateQuarterlyNoteRestriction,
  CheckQuarterlyNotePermission,
  GetQuarterlyNotesPermissions,
  CheckPresencePermission,
  CheckSpecialExamPermission,
  CheckExamPermission
};
