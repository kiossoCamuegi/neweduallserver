const CheckInternet = require("../config/CheckInternet");
const { DB_SQLITE, DATABASE } = require("../config/Database"); 
const { GetCurrentUserData } = require("./GetCurrentUserData");
 

const DATABASERUN = (res, query, params, type)=>{
   try { 
      if(CheckInternet() === true){  
         if(type === 0){
            DATABASE.query(query, params, (err, rows)=>{ 
                
               if(err) return res.status(300).json({status:300, success:false, error:err});;
               return res.json(rows);
            });
         }else{
            DATABASE.query(query, params , (err)=>{ 
                
               if(err) return res.status(300).json({status:300, success:false, error:err});;
               return res.json("success");
             }); 
         } 
      }else{  
         if(type === 0){
            DB_SQLITE.all(query, params, (err, rows)=>{ 
               if(err) return res.status(300).json({status:300, success:false, error:err});;
               return res.json(rows);
            }); 
         }else{
            DB_SQLITE.run(query, params , (err)=>{ 
               if(err) return res.status(300).json({status:300, success:false, error:err});;
               return res.json("success");
           }); 
         } 
      } 
   } catch (error) {
      res.status(400).json(error); 
   }  
}
 

const GetStudentEnrollmentConfirmations = async(req, res)=>{
    if(CheckInternet() === true){
        try {
            const Data = await StudentEnrollmentConfirmationModel.findAll({where:{ed_enroll_confirmation_deleted:0}})
            res.json(Data);
        } catch (error) {
            res.status(400).json(error); 
        }
    }else{
    //########################
      const  query = 'SELECT * FROM eduall_academic_level WHERE ed_academic_level_deleted = 0 AND  ed_academic_level_institute_code = ?';
      try {
         DB_SQLITE.all(query, [req.session.user.eduall_user_session_curentinstitute], (err, rows)=>{ 
             if(err) return res.status(300).json({status:300, success:false, error:err});;
             return res.json(rows);
         }); 
      } catch (error) {
         res.status(400).json(error); 
      } 
    //########################
  }
}

const GetSingleStudentEnrollmentConfirmation = async(req, res)=>{
    const  {ID} = req.params;

    if(CheckInternet() === true){
        try {
            const Data = await StudentEnrollmentConfirmationModel.findAll({where:{ed_enroll_confirmation_deleted:0, ed_enroll_confirmation_id:ID}});
            res.json(Data);
        } catch (error) {
            res.json(error);
        }
    }else{
      //########################
      const  query = 'SELECT * FROM eduall_academic_level WHERE ed_academic_level_deleted = 0 AND ed_academic_level_id = ? ';
      try {
         DB_SQLITE.run(query, [ID], (err, rows)=>{ 
               if(err) return res.status(300).json({status:300, success:false, error:err});;
               return res.json(rows);
         }); 
      } catch (error) {
         res.status(400).json(error); 
      } 
      //########################
    }
}

const CheckExistentStudentEnrollmentConfirmation = async(req, res)=>{
    const  {CLASS, STUDENT} = req.params;
    if(CheckInternet() === true){
        try {
            const Data = await StudentEnrollmentConfirmationModel.findAll({where:{ed_enroll_confirmation_deleted:0, ed_enroll_confirmation_student_code:STUDENT, ed_enroll_confirmation_class:CLASS}});
            res.json(Data);
        } catch (error) {
            res.json(error);
        }
    }else{
         
    }
}


const RegisterStudentEnrollmentConfirmation = async(req, res)=>{
    if(CheckInternet() === true){
        const Data = { 
            ed_enroll_confirmation_student_code:req.body.enrollment_student_code,  
            ed_enroll_confirmation_payment_service:req.body.enrollment_service_code,
            ed_enroll_confirmation_class:req.body.enrollment_class, 
       }
       try {
            await StudentEnrollmentConfirmationModel.create(Data);
            res.json('success');
       } catch (error) {
            res.json(error);
       }   
    }else{   
//########################
   const  query = `INSERT INTO eduall_academic_level(ed_academic_level_title, ed_academic_level_institute_code) VALUES(?,?)`;
   try {
      DB_SQLITE.run(query, [req.body.academic_level_title , req.session.user.eduall_user_session_curentinstitute], (err)=>{ 
            if(err) return res.status(300).json({status:300, success:false, error:err});;
            return res.json("success");
      }); 
   } catch (error) {
      res.status(400).json(error); 
   } 
   //########################
    }
}


const StudentEnrollmentConfirmationDelete = async(req, res)=>{
    const {ID} = req.params;
      if(CheckInternet() === true){
        try {
            const CurrentEnrollmentConfirmation = await StudentEnrollmentConfirmationModel.findOne({where:{ed_enroll_confirmation_id:ID}})
            if(!CurrentEnrollmentConfirmation){
              return res.status(400).json("Confirmação da matrícula não encontrada");
            }     
            CurrentEnrollmentConfirmation.ed_enroll_confirmation_deleted = 1;
            await CurrentEnrollmentConfirmation.save();
            res.status(201).json("Confirmação da matrícula deletada");
        } catch (error) {
            res.json(error);
        }
      }else{
              
      //########################
      const  query = `UPDATE eduall_academic_level SET ed_academic_level_deleted = 1
      WHERE ed_academic_level_deleted = 0 AND ed_academic_level_id = ?`;

      try { 
          DB_SQLITE.run(query, [ID], (err)=>{ 
            if(err) return res.status(300).json({status:300, success:false, error:err});;
            return res.json("success");
         }); 
      } catch (error) {
         res.status(400).json(error); 
      }   
      //########################
      }
} 



const StudentEnrollmentConfirmationUpdate = async(req, res)=>{
    const {ID} = req.params;
    const {enrollment_service_code, enrollment_class, enrollment_student_code} = req.body;

      if(CheckInternet() === true){
        try {
            const CurrentEnrollmentConfirmation = await StudentEnrollmentConfirmationModel.findOne({where:{ ed_enroll_confirmation_id:ID,ed_enroll_confirmation_student_code:enrollment_student_code}})
            if(!CurrentEnrollmentConfirmation){
              return res.status(400).json("Confirmação da matrícula não encontrada");
            }  
  
            CurrentEnrollmentConfirmation.ed_enroll_confirmation_payment_service = enrollment_service_code;   
            CurrentEnrollmentConfirmation.ed_enroll_confirmation_class = enrollment_class; 
  
            await CurrentEnrollmentConfirmation.save();
            res.status(201).json("Confirmação da matrícula atualizado com sucesso");
        } catch (error) {
            res.json(error);
        }  
      }else{
              
      //########################
      const  query = `UPDATE eduall_academic_level SET ed_academic_level_deleted = 1
      WHERE ed_academic_level_deleted = 0 AND ed_academic_level_id = ?`;

      try { 
          DB_SQLITE.run(query, [ID], (err)=>{ 
            if(err) return res.status(300).json({status:300, success:false, error:err});;
            return res.json("success");
         }); 
      } catch (error) {
         res.status(400).json(error); 
      }   
      //########################
      }
} 

module.exports = {GetStudentEnrollmentConfirmations, GetSingleStudentEnrollmentConfirmation, CheckExistentStudentEnrollmentConfirmation,
RegisterStudentEnrollmentConfirmation, StudentEnrollmentConfirmationUpdate, StudentEnrollmentConfirmationDelete};