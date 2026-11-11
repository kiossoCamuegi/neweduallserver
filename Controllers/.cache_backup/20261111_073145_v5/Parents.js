const multer = require('multer');
const path = require('path');
const ExecuteQuery = require("../Functions/ExecuteQuery");
const { RegisterAuditAction } = require("./Auditory");  // Importando a função de auditoria

const Getparents = async (req, res) => {
    try {
        const query = 'SELECT * FROM eduall_parents WHERE ed_parent_deleted = 0 AND ed_parent_institute_code = ? ORDER BY ed_parent_name ASC';
        const PARAMS = [req.session.user.eduall_user_session_curentinstitute];
        const result = await ExecuteQuery(res, query, PARAMS, true, { db: "eduall_parents", type: "select", data: req });
        res.status(200).json(result);
    } catch (error) {
        res.status(500).json({ success: false, message: "Falha ao buscar os pais!", error: error.message });
    }
}

const RegisterParent = async (req, res) => {
    try {
        const query = `INSERT INTO eduall_parents(ed_parent_name, ed_parent_students_code, ed_parent_email, ed_parent_phone, ed_parent_phone2,
        ed_parent_job, ed_parent_address, ed_parent_nacionality, ed_parent_gender, ed_parent_picture, ed_parent_degree_of_kinship, ed_parent_institute_code)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`;
        const PARAMS = [req.body.parent_name, req.body.parent_code, req.body.parent_email, req.body.parent_phone,
        req.body.parent_phone2, req.body.parent_job, req.body.parent_address, req.body.parent_nacionality,
        req.body.parent_gender, (req.file ? "images/parents/" + req.file.filename : ""), req.body.parent_degree_of_kinship, req.session.user.eduall_user_session_curentinstitute];
        const result = await ExecuteQuery(res, query, PARAMS, false, { db: "eduall_parents", type: "insert", data: req });

        // Registrando a ação de auditoria
        await RegisterAuditAction({
            session: req.session,
            action: 1,  // Ação de registro
            form: "Encarregados",
            description: `Registrou um novo encarregado (${req.body.parent_name})`,
        });

        res.status(200).json(result);
    } catch (error) {
        res.status(500).json({ success: false, message: "Falha ao registrar o pai!", error: error.message });
    }
}




const RegisterParentKid = async (req, res) => {
    try {


      const checkQuery = `SELECT * FROM eduall_parents_kids WHERE  ed_parentkid_deleted = 0 AND ed_parentkid_parent = ?  AND ed_parentkid_student = ?  AND ed_parentkid_institute_code = ?`;
      const checkParams = [req.body.parentkid_parent, req.body.parentkid_student, req.session.user.eduall_user_session_curentinstitute];
      const existing = await ExecuteQuery(res, checkQuery, checkParams, true, {
        db: "eduall_parents_kids", type: "select", data: req,
      });
    
      if (existing.length > 0) {
        return res.status(400).json({
          status: 400,
          success: false,
          msg: "Este estudante já foi atribuido a este encarregado !",
        });
      }

        const query = `INSERT INTO eduall_parents_kids(ed_parentkid_parent, ed_parentkid_student, ed_parentkid_institute_code) VALUES(?,?,?)`;
        const PARAMS = [req.body.parentkid_parent, req.body.parentkid_student, req.session.user.eduall_user_session_curentinstitute];
        const result = await ExecuteQuery(res, query, PARAMS, false, { db: "eduall_parents", type: "insert", data: req });

        // Registrando a ação de auditoria
        await RegisterAuditAction({
            session: req.session,
            action: 1,  // Ação de registro
            form: "Encarregados",
            description: `Atribui um estudante ao encarregado com ID = (${req.body.parentkid_parent})`,
        });

        res.status(200).json(result);
    } catch (error) {
        res.status(500).json({ success: false, message: "Falha ao registrar dados!", error: error.message });
    }
}


const GetParentKids = async (req, res) => {
    try {
        const { ID } = req.params;
        const query = `SELECT * FROM eduall_parents_kids 
        LEFT JOIN eduall_students ON eduall_students.ed_student_id = ed_parentkid_student 
        LEFT JOIN  eduall_parents on eduall_parents.ed_parent_id =  ed_parentkid_parent
        WHERE ed_parentkid_deleted = 0 AND eduall_students.ed_student_deleted  = 0  AND eduall_parents.ed_parent_deleted = 0 AND  ed_parentkid_parent = ? AND ed_parentkid_institute_code = ?`;
        const PARAMS = [ID, req.session.user.eduall_user_session_curentinstitute];
        const result = await ExecuteQuery(res, query, PARAMS, true, { db: "eduall_parents", type: "select", data: req });
        res.status(200).json(result);
    } catch (error) {
        res.status(500).json({ success: false, message: "Falha ao buscar dados!", error: error.message });
    }
} 

const GetKidsParents = async (req, res) => {
    try {
        const { ID } = req.params;
        const query = `SELECT * FROM eduall_parents_kids 
        LEFT JOIN eduall_students ON eduall_students.ed_student_id = ed_parentkid_student 
        LEFT JOIN  eduall_parents on eduall_parents.ed_parent_id =  ed_parentkid_parent
        WHERE ed_parentkid_deleted = 0 AND eduall_students.ed_student_deleted  = 0  AND eduall_parents.ed_parent_deleted = 0 AND ed_parentkid_student = ? AND ed_parentkid_institute_code = ?`;
        const PARAMS = [ID, req.session.user.eduall_user_session_curentinstitute];
        const result = await ExecuteQuery(res, query, PARAMS, true, { db: "eduall_parents", type: "select", data: req });
        res.status(200).json(result);
    } catch (error) {
        res.status(500).json({ success: false, message: "Falha ao buscar o dados !", error: error.message });
    }
} 


const ParentkidDelete = async (req, res) => {
    try {
        const { ID } = req.params;
        const query = `UPDATE eduall_parents_kids SET ed_parentkid_deleted = 1 WHERE ed_parentkid_deleted = 0 AND ed_parentkid_id = ? AND ed_parentkid_institute_code = ?`;
        const PARAMS = [ID, req.session.user.eduall_user_session_curentinstitute];
        const result = await ExecuteQuery(res, query, PARAMS, false, { db: "eduall_parents", type: "update", data: req });

        // Registrando a ação de auditoria
        await RegisterAuditAction({
            session: req.session,
            action: 3,  // Ação de eliminação
            form: "Encarregados",
            description: `Eliminou uma atribuição de estudante ao encarregado ${ID}`,
        });

        res.status(200).json(result);
    } catch (error) {
        res.status(500).json({ success: false, message: "Falha ao deletar o pai!", error: error.message });
    }
}




const ParentUpdate = async (req, res) => {
    try {
        const { ID } = req.params;
        if (req.file && req.file.filename) {
            const { parent_name, parent_degree_of_kinship, parent_gender, parent_email, parent_address, parent_job, parent_phone, parent_phone2, parent_nacionality } = req.body;
            const query = `UPDATE eduall_parents SET ed_parent_name = ?, ed_parent_email = ?, ed_parent_phone = ? , ed_parent_phone2 = ?, ed_parent_job = ?,
            ed_parent_gender = ?, ed_parent_address = ?, ed_parent_nacionality = ?, ed_parent_degree_of_kinship = ?, ed_parent_picture = ?
            WHERE ed_parent_deleted = 0 AND ed_parent_id = ? AND ed_parent_institute_code = ?`;
            const PARAMS = [parent_name, parent_email, parent_phone, parent_phone2, parent_job, parent_gender, parent_address,
            parent_nacionality, parent_degree_of_kinship, (req.file ? "images/parents/" + req.file.filename : ""), ID, req.session.user.eduall_user_session_curentinstitute];
            const result = await ExecuteQuery(res, query, PARAMS, false, { db: "eduall_parents", type: "update", data: req });

            // Registrando a ação de auditoria
            await RegisterAuditAction({
                session: req.session,
                action: 2,  // Ação de atualização
                form: "Encarregados",
                description: `Atualizou o encarregado (${parent_name}) com o código ${ID}`,
            });

            res.status(200).json(result);
        } else {
            const { parent_name, parent_degree_of_kinship, parent_gender, parent_email, parent_address, parent_job, parent_phone, parent_phone2, parent_nacionality } = req.body;
            const query = `UPDATE eduall_parents SET ed_parent_name = ?, ed_parent_email = ?, ed_parent_phone = ? , ed_parent_phone2 = ?, ed_parent_job = ?,
            ed_parent_gender = ?, ed_parent_address = ?, ed_parent_nacionality = ?, ed_parent_degree_of_kinship = ? 
            WHERE ed_parent_deleted = 0 AND ed_parent_id = ? AND ed_parent_institute_code = ?`;
            const PARAMS = [parent_name, parent_email, parent_phone, parent_phone2, parent_job,
            parent_gender, parent_address, parent_nacionality, parent_degree_of_kinship, ID, req.session.user.eduall_user_session_curentinstitute];
            const result = await ExecuteQuery(res, query, PARAMS, false, { db: "eduall_parents", type: "update", data: req });

            // Registrando a ação de auditoria
            await RegisterAuditAction({
                session: req.session,
                action: 2,  // Ação de atualização
                form: "Encarregados",
                description: `Atualizou o encarregado (${parent_name}) com o código ${ID}`,
            });

            res.status(200).json(result);
        }
    } catch (error) {
        res.status(500).json({ success: false, message: "Falha ao atualizar o pai!", error: error.message });
    }
}

const GetSingleparent = async (req, res) => {
    try {
        const { ID } = req.params;
        const query = 'SELECT * FROM eduall_parents WHERE ed_parent_deleted = 0 AND ed_parent_id = ? AND ed_parent_institute_code = ?';
        const PARAMS = [ID, req.session.user.eduall_user_session_curentinstitute];
        const result = await ExecuteQuery(res, query, PARAMS, true, { db: "eduall_parents", type: "select", data: req });
        res.status(200).json(result);
    } catch (error) {
        res.status(500).json({ success: false, message: "Falha ao buscar o pai!", error: error.message });
    }
} 


const ParentDelete = async (req, res) => {
    try {
        const { ID } = req.params;
        const query = `UPDATE eduall_parents SET ed_parent_deleted = 1 WHERE ed_parent_deleted = 0 AND ed_parent_id = ? AND ed_parent_institute_code = ?`;
        const PARAMS = [ID, req.session.user.eduall_user_session_curentinstitute];
        const result = await ExecuteQuery(res, query, PARAMS, false, { db: "eduall_parents", type: "update", data: req });

        // Registrando a ação de auditoria
        await RegisterAuditAction({
            session: req.session,
            action: 3,  // Ação de eliminação
            form: "Encarregados",
            description: `Eliminou o encarregado com ID ${ID}`,
        });

        res.status(200).json(result);
    } catch (error) {
        res.status(500).json({ success: false, message: "Falha ao deletar o pai!", error: error.message });
    }
}

const storage = multer.diskStorage({
    destination: 'images/parents',
    filename: (req, file, cb) => {
        return cb(null, `eduall_file_${file.fieldname}_${Date.now()}_${Math.random().toString(36).substring(7)}_${path.extname(file.originalname)}`);
    }
});

const uploadParentPicture = multer({
    storage: storage
}).single('parent_picture');

module.exports = { 
    Getparents, GetSingleparent, RegisterParent, ParentUpdate, ParentDelete, uploadParentPicture ,
    RegisterParentKid, GetParentKids, GetKidsParents, ParentkidDelete
};


 