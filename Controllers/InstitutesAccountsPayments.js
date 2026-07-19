const { DATABASE } = require("../config/Database");  

const DATABASERUN = async (res, query, params, type) => {
   try {
      if (type === 0) {
         DATABASE.query(query, params, (err, rows) => {
            if (err) {
               console.error("Database error:", err); 
               return res.status(500).json({ status: 500, success: false, error: "Internal Server Error" });
            }
            return res.json(rows);
         });
      } else {
         DATABASE.query(query, params, (err) => {
            if (err) {
               console.error("Database error:", err);  
               return res.status(500).json({ status: 500, success: false, error: "Internal Server Error" });
            }
            return res.json({ success: true, message: "Operation successful" });
         });
      }
   } catch (error) {
      console.error("Unexpected error:", error);
      return res.status(500).json({ status: 500, success: false, error: "Internal Server Error" });
   }
}



const GetAcademicLevel = async(req,res)=>{ 
   const  query = `SELECT * FROM eduall_academic_level WHERE ed_academic_level_deleted = 0 AND ed_academic_level_institute_code = ?`;
   const PARAMS = [req.session.user.eduall_user_session_curentinstitute];
   DATABASERUN(res, query , PARAMS, 0);
 }
 
 const RegisterAcademicLevel = async(req, res)=>{
   const  query = `INSERT INTO eduall_academic_level(ed_academic_level_title,  ed_academic_level_forExam, 
   ed_academic_level_forFt, ed_academic_level_institute_code) VALUES(?,?,?,?)`; 
   const PARAMS = [req.body.academic_level_title , req.body.academic_level_forExam, 
   req.body.academic_level_forFt, req.session.user.eduall_user_session_curentinstitute];
   DATABASERUN(res, query , PARAMS, 1);
 }
 
 
 const GetSingleAcademicLevel = async(req, res)=>{
   const  query = `SELECT * FROM eduall_academic_level WHERE ed_academic_level_deleted = 0 AND ed_academic_level_id = ?`;
   const {ID} = req.params;
   const PARAMS = [ID] 
   DATABASERUN(res, query , PARAMS, 0);
 }

 
 const AcademicLevelDelete = async(req, res)=>{ 
   const  query = `UPDATE eduall_academic_level SET ed_academic_level_deleted = 1
   WHERE ed_academic_level_deleted = 0 AND ed_academic_level_id = ?`;
   const {ID} = req.params;
   const PARAMS = [ID];
   DATABASERUN(res, query , PARAMS, 1);
}  

const AcademicLevelUpdate = async(req, res)=>{ 
   const {ID} = req.params;
   const  {academic_level_title, academic_level_forExam, academic_level_forFt } = req.body
   const  query = `UPDATE eduall_academic_level SET ed_academic_level_title = ? AND ed_academic_level_forExam = ? AND 
   ed_academic_level_forFt = ? WHERE ed_academic_level_deleted = 0 AND ed_academic_level_id = ?`; 
   const PARAMS = [academic_level_title, academic_level_forExam,academic_level_forFt, ID];
   DATABASERUN(res, query , PARAMS, 1);
} 

