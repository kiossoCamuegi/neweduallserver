const ExecuteQuery = require("../Functions/ExecuteQuery");
const { RegisterAuditAction } = require("./Auditory");

const GetTypeofbooks = async (req, res) => {
   try {
      const query = `SELECT * FROM eduall_library_typeofbooks WHERE ed_library_typeofbook_deleted = 0
      AND ed_library_typeofbook_institute_code = ? ORDER BY ed_library_typeofbook_title ASC`;
      const PARAMS = [req.session.user.eduall_user_session_curentinstitute];
      const rows = await ExecuteQuery(res, query, PARAMS, true, { db: "eduall_library_typeofbooks", type: "select", data: req });
      res.status(200).json(rows);
   } catch (err) {
      res.status(400).json({ status: 300, success: false, msg: err.message });
   }
};

const GetSingleTypeofbook = async (req, res) => {
   try {
      const { ID } = req.params;
      const query = `SELECT * FROM eduall_library_typeofbooks 
      WHERE ed_library_typeofbook_deleted = 0 AND ed_library_typeofbook_id = ? 
      AND ed_library_typeofbook_institute_code = ?`;
      const PARAMS = [ID, req.session.user.eduall_user_session_curentinstitute];
      const rows = await ExecuteQuery(res, query, PARAMS, true, { db: "eduall_library_typeofbooks", type: "select", data: req });
      res.status(200).json(rows);
   } catch (err) {
      res.status(400).json({ status: 300, success: false, msg: err.message });
   }
};

const RegisterTypeofbook = async (req, res) => {
   try {
      const query = `INSERT INTO eduall_library_typeofbooks(ed_library_typeofbook_title, ed_library_typeofbook_code, 
      ed_library_typeofbook_institute_code) VALUES(?,?,?)`;
      const PARAMS = [req.body.typeofbook_title, req.body.typeofbook_code, req.session.user.eduall_user_session_curentinstitute];
      const rows = await ExecuteQuery(res, query, PARAMS, false, { db: "eduall_library_typeofbooks", type: "insert", data: req });

      // Registrar ação de auditoria
      await RegisterAuditAction({
         session: req.session,
         action: 1,  // Ação de registro
         form: "Tipos de Livros",
         description: `Registrou um novo tipo de livro (${req.body.typeofbook_title}) com o código ${req.body.typeofbook_code}`,
      });

      res.status(200).json({ success: true, msg: "Tipo de livro registrado com sucesso!" });
   } catch (err) {
      res.status(400).json({ status: 300, success: false, msg: err.message });
   }
};

const TypeofbookDelete = async (req, res) => {
   try {
      const { ID } = req.params;
      const query = `UPDATE eduall_library_typeofbooks SET ed_library_typeofbook_deleted = 1 
      WHERE ed_library_typeofbook_deleted = 0 AND ed_library_typeofbook_id = ? 
      AND ed_library_typeofbook_institute_code = ?`;
      const PARAMS = [ID, req.session.user.eduall_user_session_curentinstitute];
      const rows = await ExecuteQuery(res, query, PARAMS, false, { db: "eduall_library_typeofbooks", type: "update", data: req });

      // Registrar ação de auditoria
      await RegisterAuditAction({
         session: req.session,
         action: 3,  // Ação de eliminação
         form: "Tipos de Livros",
         description: `Eliminou o tipo de livro com ID ${ID}`,
      });

      res.status(200).json({ success: true, msg: "Tipo de livro deletado com sucesso!" });
   } catch (err) {
      res.status(400).json({ status: 300, success: false, msg: err.message });
   }
};

const TypeofbookUpdate = async (req, res) => {
   try {
      const { ID } = req.params;
      const { typeofbook_title, typeofbook_code } = req.body;
      const query = `UPDATE eduall_library_typeofbooks SET ed_library_typeofbook_title = ?, ed_library_typeofbook_code = ? 
      WHERE ed_library_typeofbook_deleted = 0 AND ed_library_typeofbook_id = ? 
      AND ed_library_typeofbook_institute_code = ?`;
      const PARAMS = [typeofbook_title, typeofbook_code, ID, req.session.user.eduall_user_session_curentinstitute];
      const rows = await ExecuteQuery(res, query, PARAMS, false, { db: "eduall_library_typeofbooks", type: "update", data: req });

      // Registrar ação de auditoria
      await RegisterAuditAction({
         session: req.session,
         action: 2,  // Ação de atualização
         form: "Tipos de Livros",
         description: `Atualizou o tipo de livro (${typeofbook_title}) com o código ${typeofbook_code} e ID ${ID}`,
      });

      res.status(200).json({ success: true, msg: "Tipo de livro atualizado com sucesso!" });
   } catch (err) {
      res.status(400).json({ status: 300, success: false, msg: err.message });
   }
};

module.exports = { GetTypeofbooks, GetSingleTypeofbook, RegisterTypeofbook, TypeofbookDelete, TypeofbookUpdate }; 
