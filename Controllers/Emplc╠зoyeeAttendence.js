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
 

const GetEmployeesAttendance = async(req, res)=>{
    try {
        const Data = await EmployeeAttendenceModel.findAll({where:{ed_employee_attd_deleted:0,ed_academic_level_institute_code:req.session.user.eduall_user_session_curentinstitute}});
        res.json(Data);
    } catch (error) {
         res.json(error);
    } 
}

const GetEmployeeAttendanceBycode = async(req,res)=>{
    const {CODE} = req.params;
    try {
        const Data = await EmployeeAttendenceModel.findAll({where:{ed_employee_attd_deleted:0, ed_employee_attd_code:CODE}})
        res.json(Data);
    } catch (error) {
         res.json(error);
    }
}  
 
const GetSingleEmployeeAttendance = async(req,res)=>{
    const {ID} = req.params;
    try {
        const Data = await EmployeeAttendenceModel.findAll({where:{ed_employee_attd_deleted:0, ed_employee_attd_id:ID}})
        res.json(Data);
    } catch (error) {
         res.json(error);
    }
}
 
const RegisterEmployeeAttendance = async(req, res)=>{
   const DATA = {   
        ed_employee_attd_code:req.body.employee_attendance_code,
        ed_employee_attd_date:req.body.employee_attendance_date,
        ed_employee_attd_hour:req.body.employee_attendance_hour,
        ed_employee_attd_status:req.body.employee_attendance_status,
        ed_employee_attd_class:req.body.employee_attendance_class,
        ed_employee_attd_subject:req.body.employee_attendance_subject,
        ed_employee_attd_description:req.body.employee_attendance_description,
     }
    try {
         await EmployeeAttendenceModel.create(DATA);
         res.json('success');  
    } catch (error) {
        res.json(error);
    }
}

const EmployeeAttendanceDelete = async(req, res)=>{
    const {ID} = req.params;
      try {
          const EmployeeAttendance = await EmployeeAttendenceModel.findOne({where:{ed_employee_attd_id:ID}})
          if(!EmployeeAttendance){
            return res.status(400).json("Informação não encontrada");
          }     
          EmployeeAttendance.ed_employee_attd_deleted = 1;
          await EmployeeAttendance.save();
          res.status(201).json("Informação deletada");
      } catch (error) {
          res.json(error);
      }
}  

const EmployeeAttendanceUpdate = async(req, res)=>{
    const {ID} = req.params;
    const {employee_attendance_code,employee_attendance_date,employee_attendance_hour,
    employee_attendance_status,employee_attendance_description  } = req.body;

      try {
          const EmployeeAttendance = await EmployeeAttendenceModel.findOne({where:{ed_employee_attd_id:ID,
         ed_employee_attd_deleted:0}})
          if(!EmployeeAttendance){
            return res.status(400).json("Informação não encontrada");
          }       
          EmployeeAttendance.ed_employee_attd_code =  employee_attendance_code;
          EmployeeAttendance.ed_employee_attd_date =  employee_attendance_date;
          EmployeeAttendance.ed_employee_attd_hour =  employee_attendance_hour;
          EmployeeAttendance.ed_employee_attd_status =  employee_attendance_status;
          EmployeeAttendance.ed_employee_attd_subject =  employee_attendance_subject;
          EmployeeAttendance.ed_employee_attd_class =  employee_attendance_class;
          EmployeeAttendance.ed_employee_attd_description =  employee_attendance_description;


          await EmployeeAttendance.save();
          res.status(201).json("Informação atualizada com sucesso");
      } catch (error) {
          res.json(error);
      }
} 

module.exports = {RegisterEmployeeAttendance, GetEmployeesAttendance,
 GetEmployeeAttendanceBycode, EmployeeAttendanceUpdate, EmployeeAttendanceDelete,
 GetSingleEmployeeAttendance };