const ExecuteQuery = require("../Functions/ExecuteQuery");
const { RegisterAuditAction } = require("./Auditory");

const RegisterUserChilds = async (req, res) => {
    try {
        const query = `SELECT * FROM eduall_parent_childrens WHERE ed_parent_children_UserCode = ? AND ed_parent_children_code = ? AND ed_parent_children_deleted = 0`;
        const PARAMS = [req.body.user_child_usercode, req.body.user_child_studentcode];
        const rows = await ExecuteQuery(res, query, PARAMS, true, { db: "eduall_parent_childrens", type: "select", data: req });
        
        if (rows.length >= 1) {
            return res.status(300).json({ msg: "Este usuário já tem acesso aos dados do estudante selecionado !", success: false });
        }

        const query2 = `INSERT INTO eduall_parent_childrens(ed_parent_children_UserCode, ed_parent_children_code) VALUES(?, ?)`;
        const PARAMS2 = [req.body.user_child_usercode, req.body.user_child_studentcode];
        const result = await ExecuteQuery(res, query2, PARAMS2, false, { db: "eduall_parent_childrens", type: "insert", data: req });

        // Registrar ação de auditoria
        await RegisterAuditAction({
            session: req.session,
            action: 1,  // Ação de registro
            form: "Atribuição de Estudante ao Encarregado",
            description: `Atribuiu o estudante com o código ${req.body.user_child_studentcode} ao encarregado com o código ${req.body.user_child_usercode}`,
        });

        res.status(200).json(result);
    } catch (error) {
        res.status(500).json({ msg: "Lamentamos ocorreu um erro ao registrar está informação!", success: false, error: error.message });
    }
}

const UserChildDelete = async (req, res) => {
    try {
        const { ID } = req.params;
        const query = `UPDATE eduall_parent_childrens SET ed_parent_children_deleted = 1 WHERE ed_parent_children_deleted = 0 AND ed_parent_children_id = ?`;
        const PARAMS = [ID];
        const result = await ExecuteQuery(res, query, PARAMS, false, { db: "eduall_parent_childrens", type: "update", data: req });

        // Registrar ação de auditoria
        await RegisterAuditAction({
            session: req.session,
            action: 3,  // Ação de eliminação
            form: "Atribuição de Estudante ao Encarregado",
            description: `Removeu o estudante com ID ${ID} do encarregado`,
        });

        res.status(200).json(result);
    } catch (error) {
        res.status(500).json({ msg: "Falha ao deletar o filho!", success: false, error: error.message });
    }
}

const ChewckSingleUserChilds = async (req, res) => {
    try {
        const { USERCODE } = req.params;
        const query = `SELECT * FROM eduall_parent_childrens WHERE ed_parent_children_UserCode = ?  AND ed_parent_children_deleted = 0`;
        const PARAMS = [USERCODE];
        const result = await ExecuteQuery(res, query, PARAMS, true, { db: "eduall_parent_childrens", type: "select", data: req });
        res.status(200).json(result);
    } catch (error) {
        res.status(500).json({ msg: "Falha ao verificar o filho!", success: false, error: error.message });
    } 
}


const GetSingleUserChilds = async (req, res) => {
    try {
      const ID = req.session.user.eduall_user_session_ID;
        const query = `
            SELECT * 
            FROM eduall_parent_childrens 
            INNER JOIN eduall_students 
                ON eduall_parent_childrens.ed_parent_children_code = eduall_students.ed_student_id
            INNER JOIN eduall_institutes 
                ON eduall_students.ed_student_institute_code = eduall_institutes.ed_institute_code
            LEFT JOIN eduall_institutes_licences AS lic 
                ON lic.ed_institute_licence_instituteCode = eduall_institutes.ed_institute_code
            WHERE 
                eduall_institutes.ed_institute_deleted = 0 
                AND LENGTH(eduall_institutes.ed_institute_code) >= 5
                AND eduall_students.ed_student_deleted = 0 
                AND eduall_parent_childrens.ed_parent_children_deleted = 0 
                AND eduall_parent_childrens.ed_parent_children_UserCode = ?
                AND (
                lic.ed_institute_licence_endDate IS NOT NULL 
                AND lic.ed_institute_licence_endDate > NOW()
                AND lic.ed_institute_licence_type IN (0, 3, 4, 5)
           )
        `;


      const PARAMS = [ID];
      const result = await ExecuteQuery(res, query, PARAMS, true, {
        db: "eduall_parent_childrens",
        type: "select",
        data: req
      });
  
      res.status(200).json(result);
    } catch (error) {
      res.status(500).json({
        msg: "Falha ao buscar os filhos do usuário!",
        success: false,
        error: error.message
      });
    }
  };
  



const GetUserChilds = async (req, res) => {
    try {
        const { ID } = req.params;
        const query = `SELECT * FROM eduall_parent_childrens LEFT JOIN eduall_students ON eduall_parent_childrens.ed_parent_children_code = eduall_students.ed_student_id
        LEFT JOIN eduall_institutes ON eduall_students.ed_student_institute_code = eduall_institutes.ed_institute_code
        WHERE eduall_institutes.ed_institute_deleted = 0 AND eduall_students.ed_student_deleted = 0 AND eduall_parent_childrens.ed_parent_children_deleted = 0 
        AND eduall_parent_childrens.ed_parent_children_UserCode = ?`;
        const PARAMS = [ID];
        const result = await ExecuteQuery(res, query, PARAMS, true, { db: "eduall_parent_childrens", type: "select", data: req });
        res.status(200).json(result);
    } catch (error) {
        res.status(500).json({ msg: "Falha ao buscar os filhos do usuário!", success: false, error: error.message });
    }
}

const GetParentsUserChildsByInstitute = async (req, res) => {
    try {
        const query = `SELECT * FROM eduall_parent_childrens LEFT JOIN eduall_students ON eduall_parent_childrens.ed_parent_children_code = eduall_students.ed_student_id
        LEFT JOIN eduall_institutes ON eduall_students.ed_student_institute_code = eduall_institutes.ed_institute_code
        LEFT JOIN eduall_user_accounts ON eduall_parent_childrens.ed_parent_children_UserCode = eduall_user_accounts.ed_user_account_id
        WHERE eduall_institutes.ed_institute_deleted = 0 AND eduall_students.ed_student_deleted = 0 AND eduall_user_accounts.ed_user_account_deleted = 0
        AND eduall_parent_childrens.ed_parent_children_deleted = 0 AND eduall_institutes.ed_institute_code = ?`;
        const PARAMS = [req.session.user.eduall_user_session_curentinstitute];
        const result = await ExecuteQuery(res, query, PARAMS, true, { db: "eduall_parent_childrens", type: "select", data: req });
        res.status(200).json(result);
    } catch (error) {
        res.status(500).json({ msg: "Falha ao buscar filhos por instituto!", success: false, error: error.message });
    }
}

 

module.exports = { GetSingleUserChilds, UserChildDelete, RegisterUserChilds, ChewckSingleUserChilds, GetUserChilds, GetParentsUserChildsByInstitute };
 
