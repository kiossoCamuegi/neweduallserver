 

const GetEnrollOperations = async(req, res)=>{ 
   const  query = 'SELECT * FROM eduall_academic_level WHERE ed_academic_level_deleted = 0 AND  ed_academic_level_institute_code = ?'; 
   const PARAMS = [req.session.user.eduall_user_session_curentinstitute];
   DATABASERUN(res, query , PARAMS, 0);
}



const GetSingleEnrollOperation = async(req,res)=>{
   const {ID} = req.params; 
   const  query = 'SELECT * FROM eduall_academic_level WHERE ed_academic_level_deleted = 0 AND  ed_academic_level_institute_code = ?'; 
   const PARAMS = [req.session.user.eduall_user_session_curentinstitute];
   DATABASERUN(res, query , PARAMS, 0);
}
 

const RegisterEnrollOperation = async(req, res)=>{ 
          const Data = { 
               ed_enroll_operation_user:req.body.enroll_operation_user, 
               ed_enroll_operation_action:req.body.enroll_operation_action,  
               ed_enroll_operation_student:req.body.enroll_operation_student , 
               ed_enroll_operation_type:req.body.enroll_operation_type 
          } 
   const  query = `INSERT INTO eduall_academic_level(ed_academic_level_title, ed_academic_level_institute_code) VALUES(?,?)`; 
     const PARAMS = [req.session.user.eduall_user_session_curentinstitute];
   DATABASERUN(res, query , PARAMS, 0);
}
 

const EnrollOperationDelete = async(req, res)=>{
     const {ID} = req.params; 
      const  query = `UPDATE eduall_academic_level SET ed_academic_level_deleted = 1
      WHERE ed_academic_level_deleted = 0 AND ed_academic_level_id = ?`; 
       const PARAMS = [req.session.user.eduall_user_session_curentinstitute];
   DATABASERUN(res, query , PARAMS, 0);
} 
 

const EnrollOperationUpdate = async(req, res)=>{
     const {ID} = req.params;
     const  {enroll_operation_user ,  enroll_operation_student , enroll_operation_type} =  req.body; 
   const  query = `UPDATE eduall_academic_level SET ed_enroll_operation_user = ,
   WHERE ed_academic_level_deleted = 0 AND ed_academic_level_id = ?`;
   const PARAMS =  [enroll_operation_user, enroll_operation_student,enroll_operation_type ,ID];
   DATABASERUN(res, query , PARAMS, 0);
} 


module.exports = {GetEnrollOperations, GetSingleEnrollOperation, RegisterEnrollOperation, EnrollOperationDelete, EnrollOperationUpdate};