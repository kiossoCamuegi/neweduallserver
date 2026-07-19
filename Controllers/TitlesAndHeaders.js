const ExecuteQuery = require("../Functions/ExecuteQuery");

const GetTitleAndHeaders = async (req, res) => {
   try {
      const query = 'SELECT * FROM eduall_titles WHERE ed_title_deleted = 0 AND ed_title_institute_code = ?';
      const PARAMS = [req.session.user.eduall_user_session_curentinstitute];
      const rows = await ExecuteQuery(res, query, PARAMS, true, { db: "eduall_titles", type: "select", data: req });
      res.status(200).json(rows);
   } catch (err) {
      res.status(400).json({ status: 300, success: false, msg: err.message });
   }
};

const GetSingleTitleAndHeader = async (req, res) => {
   try {
      const { ID } = req.params;
      const query = 'SELECT * FROM eduall_titles WHERE ed_title_deleted = 0 AND ed_title_id = ? AND ed_title_institute_code = ?';
      const PARAMS = [ID, req.session.user.eduall_user_session_curentinstitute];
      const rows = await ExecuteQuery(res, query, PARAMS, true, { db: "eduall_titles", type: "select", data: req });
      res.status(200).json(rows);
   } catch (err) {
      res.status(400).json({ status: 300, success: false, msg: err.message });
   } 
};

const RegisterTitleAndHeader = async (req, res) => {
   try {
      const query = `INSERT INTO eduall_titles(ed_title_name, ed_title_for, ed_title_description,
      ed_title_institute_code) VALUES(?,?,?,?)`;
      const PARAMS = [req.body.title_name, req.body.title_for, req.body.title_description, req.session.user.eduall_user_session_curentinstitute];
      await ExecuteQuery(res, query, PARAMS, false, { db: "eduall_titles", type: "insert", data: req });
      res.status(200).json({ success: true, msg: "Title registered successfully!" });
   } catch (err) {
      res.status(400).json({ status: 300, success: false, msg: err.message });
   }
};

const TitleAndHeaderDelete = async (req, res) => {
   try {
      const { ID } = req.params;
      const query = `UPDATE eduall_titles SET ed_title_deleted = 1
      WHERE ed_title_deleted = 0 AND ed_title_id = ? AND ed_title_institute_code = ?`;
      const PARAMS = [ID, req.session.user.eduall_user_session_curentinstitute];
      await ExecuteQuery(res, query, PARAMS, false, { db: "eduall_titles", type: "update", data: req });
      res.status(200).json({ success: true, msg: "Title deleted successfully." });
   } catch (err) {
      res.status(400).json({ status: 300, success: false, msg: err.message });
   }
};

const TitleAndHeaderUpdate = async (req, res) => {
   try {
      const { ID } = req.params;
      const { title_name, title_for, title_description } = req.body;
      const query = `UPDATE eduall_titles SET ed_title_name = ?, ed_title_for = ?, ed_title_description = ?
      WHERE ed_title_deleted = 0 AND ed_title_id = ? AND ed_title_institute_code = ?`;
      const PARAMS = [title_name, title_for, title_description, ID, req.session.user.eduall_user_session_curentinstitute];
      await ExecuteQuery(res, query, PARAMS, false, { db: "eduall_titles", type: "update", data: req });
      res.status(200).json({ success: true, msg: "Title updated successfully." });
   } catch (err) {
      res.status(400).json({ status: 300, success: false, msg: err.message });
   }
};

module.exports = { GetTitleAndHeaders, GetSingleTitleAndHeader, RegisterTitleAndHeader, TitleAndHeaderDelete, TitleAndHeaderUpdate };
