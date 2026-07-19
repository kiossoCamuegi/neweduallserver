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
 

const GetProjectsByCreator = async(req, res)=>{
   const {CODE} = req.params; 
   const  query = 'SELECT * FROM eduall_task_and_projects WHERE ed_task_and_project_deleted = 0 AND ed_task_and_project_added_by = ?';
   const PARAMS = [CODE];
   DATABASERUN(res, query , PARAMS, 0);  
}


const GetSingleTaskAndProject = async(req, res)=>{
   const {ID} = req.params;
   const  query = 'SELECT * FROM eduall_task_and_projects WHERE ed_task_and_project_deleted = 0 AND ed_task_and_project_id = ? ';
   const PARAMS = [ID];
   DATABASERUN(res, query , PARAMS, 0);  
}


const GetAllTasksAndProjects = async(req, res)=>{ 
   const  query = 'SELECT * FROM eduall_task_and_projects WHERE ed_task_and_project_deleted = 0 AND ed_task_and_project_institute_code = ? ';
   const PARAMS = [req.session.user.eduall_user_session_curentinstitute];
   DATABASERUN(res, query , PARAMS, 0);  
}


const RegisterTaskAndProject = async(req, res)=>{
   const  query = `INSERT INTO eduall_task_and_projects(ed_task_and_project_title, ed_task_and_project_subtitle,ed_task_and_project_added_by,ed_task_and_project_code, 
   ed_task_and_project_description,   ed_task_and_project_type, ed_task_and_project_startDate, ed_task_and_project_endDate, ed_task_and_project_color,
   ed_task_and_project_institute_code) VALUES(?,?,?,?,?,?,?,?,?,?)`;
   const PARAMS = [req.body.tsk_pr_title, req.body.tsk_pr_subtitle,req.body.tsk_pr_creator,req.body.tsk_pr_code,req.body.tsk_pr_description, 
   req.body.tsk_pr_type,req.body.tsk_pr_startDate,req.body.tsk_pr_endDate,req.body.tsk_pr_color, req.session.user.eduall_user_session_curentinstitute];
   DATABASERUN(res, query , PARAMS, 1);  
}



const TaskAndProjectDelete = async(req, res)=>{
   const {ID} = req.params;
   const  query = `UPDATE eduall_task_and_projects SET ed_task_and_project_deleted = 1
   WHERE ed_task_and_project_deleted = 0 AND ed_task_and_project_id = ?`;
   const PARAMS = [ID];
   DATABASERUN(res, query , PARAMS, 1);  
} 


 
module.exports = {GetProjectsByCreator, GetSingleTaskAndProject,
 GetAllTasksAndProjects,RegisterTaskAndProject, TaskAndProjectDelete};