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
 

const GetMembersByProject = async(req, res)=>{
   const {CODE} = req.params; 
   const  query = 'SELECT * FROM eduall_tasks_and_projects_members WHERE ed_task_and_project_member_deleted = 0 AND ed_task_and_project_member_projectCode = ? ';
   const PARAMS = [CODE];
   DATABASERUN(res, query , PARAMS, 0);  
} 

const RegisterTaskAndProjectMember = async(req, res)=>{ 
   const  query = `INSERT INTO eduall_tasks_and_projects_members(ed_task_and_project_member_code , ed_task_and_project_member_projectCode, 
   ed_task_and_project_member_type , ed_task_and_project_member_institute_code) VALUES(?,?,?,?)`;
   const PARAMS =  [req.body.task_pr_member_code, req.body.task_pr_member_project,req.body.task_pr_member_type , req.session.user.eduall_user_session_curentinstitute];
   DATABASERUN(res, query , PARAMS, 1);  
}


const TaskAndProjectMemberDelete = async(req, res)=>{
   const {ID} = req.params; 
   const  query = `UPDATE eduall_tasks_and_projects_members SET ed_task_and_project_member_deleted = 1
   WHERE ed_task_and_project_member_deleted = 0 AND ed_task_and_project_id = ?`;
   const PARAMS = [ID];
   DATABASERUN(res, query , PARAMS, 1);  
} 
 
module.exports = {GetMembersByProject, RegisterTaskAndProjectMember, TaskAndProjectMemberDelete};