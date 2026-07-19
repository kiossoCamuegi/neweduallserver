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
 


const GetLessonsSectionByGroup = async(req, res)=>{
    const {CODE} = req.params;
      const  query = 'SELECT * FROM eduall_lessons_sections WHERE ed_lesson_section_deleted = 0 AND ed_lesson_content_groupCode = ?';
      const PARAMS = [CODE];
      DATABASERUN(res, query , PARAMS, 0);
}

const GetSingleLessonSection = async(req, res)=>{
    const  {ID} = req.params; 
   const  query = 'SELECT * FROM eduall_lessons_sections WHERE ed_lesson_section_deleted = 0 AND ed_lesson_section_id = ? '; 
   const PARAMS = [ID];
   DATABASERUN(res, query , PARAMS, 0);
}


const RegisterLessonSection = async(req, res)=>{ 
   try {
      const  query1 = `SELECT * FROM eduall_user_institutes  
      LEFT JOIN eduall_institutes ON  eduall_user_institutes.ed_user_institute_code = eduall_institutes.ed_institute_code 
      LEFT JOIN eduall_employees ON  eduall_user_institutes.ed_user_institute_employeeCode = eduall_employees.ed_employee_id 
     WHERE eduall_user_institutes.ed_user_institute_deleted = 0 AND  eduall_user_institutes.ed_user_institute_userCode = ? 
     AND eduall_user_institutes.ed_user_institute_code = ?  AND eduall_employees.ed_employee_institute_code  = ?`;
     DATABASE.query(query1, [req.session.user.eduall_user_session_ID,  req.session.user.eduall_user_session_curentinstitute,  req.session.user.eduall_user_session_curentinstitute], (err, rows)=>{ 
      
      if(err) return res.status(300).json({msg:"Não foi possível concluir a operação neste momento !"});
      if(rows.length >= 1){ 

         const  query = `INSERT INTO eduall_lessons_sections(ed_lesson_section_title,  ed_lesson_section_creator,  ed_lesson_section_groupCode, ed_lesson_section_instituteCode) VALUES(?,?,?,?)`; 
         const PARAMS =  [req.body.lesson_section_title, rows[0].ed_employee_id,  req.body.lesson_section_subClass, req.session.user.eduall_user_session_curentinstitute];
         DATABASERUN(res, query , PARAMS, 1);

      }else{
          res.status(300).json({msg:"Instituição não encontrada 1 !"});
      }     
  })
  } catch (error) { 
      res.status(300).json({msg:"Instituição não encontrada 2 !"});
  }  
}

const GetLessonsSectionBuyGroupCode = async(req, res)=>{
   const {GROUP} = req.params; 
   try {
      const  query1 = `SELECT * FROM eduall_user_institutes  
      LEFT JOIN eduall_institutes ON  eduall_user_institutes.ed_user_institute_code = eduall_institutes.ed_institute_code 
      LEFT JOIN eduall_employees ON  eduall_user_institutes.ed_user_institute_employeeCode = eduall_employees.ed_employee_id 
     WHERE eduall_user_institutes.ed_user_institute_deleted = 0 AND  eduall_user_institutes.ed_user_institute_userCode = ?`;
     DATABASE.query(query1, [req.session.user.eduall_user_session_ID], (err, rows)=>{ 
      
      if(err) return res.status(300).json({msg:"Não foi possível concluir a operação neste momento !"});
      if(rows.length >= 1){ 

         const  query = `SELECT * FROM eduall_lessons_sections WHERE ed_lesson_section_groupCode = ? AND ed_lesson_section_deleted = 0`; 
         const PARAMS =  [GROUP];
         DATABASERUN(res, query , PARAMS, 0);
         

      }else{
          res.status(300).json({msg:"Instituição não encontrada 111 !"});
      }     
  })
  } catch (error) { 
      res.status(300).json({msg:"Instituição não encontrada 222 !"});
  } 
}
 

const GetLessonsSectionByCreator = async(req, res)=>{ 
   try {
      const  query1 = `SELECT * FROM eduall_user_institutes  
      LEFT JOIN eduall_institutes ON  eduall_user_institutes.ed_user_institute_code = eduall_institutes.ed_institute_code 
      LEFT JOIN eduall_employees ON  eduall_user_institutes.ed_user_institute_employeeCode = eduall_employees.ed_employee_id 
     WHERE eduall_user_institutes.ed_user_institute_deleted = 0 AND  eduall_user_institutes.ed_user_institute_userCode = ? 
     AND eduall_user_institutes.ed_user_institute_code = ?  AND eduall_employees.ed_employee_institute_code  = ?`;
     DATABASE.query(query1, [req.session.user.eduall_user_session_ID,  req.session.user.eduall_user_session_curentinstitute,  req.session.user.eduall_user_session_curentinstitute], (err, rows)=>{ 
      
      if(err) return res.status(300).json({msg:"Não foi possível concluir a operação neste momento !"});

    
      if(rows.length >= 1){  
   
        
         const  query = `SELECT * FROM eduall_lessons_sections WHERE ed_lesson_section_creator = ? AND ed_lesson_section_instituteCode = ? AND ed_lesson_section_deleted = 0`; 
         const PARAMS =  [rows[0].ed_employee_id, req.session.user.eduall_user_session_curentinstitute];
         DATABASERUN(res, query , PARAMS, 0);  

         
      }else{
          res.status(300).json({msg:"Instituição não encontrada 1 !"});
      } 
  })
  } catch (error) { 
      res.status(300).json([error, req.session.user.eduall_user_session_ID,  req.session.user.eduall_user_session_curentinstitute]);
  } 
}

const LessonSectionDelete = async(req, res)=>{
   const {ID} = req.params; 
   const  query = `UPDATE eduall_lessons_sections SET ed_lesson_section_deleted = 1
   WHERE ed_lesson_section_deleted = 0 AND ed_lesson_section_id = ?`; 
   const PARAMS = [ID];
   DATABASERUN(res, query , PARAMS, 1);
}  

const LessonSectionUpdate = async(req, res)=>{
   const {ID} = req.params;
   const {lesson_section_title, lesson_section_creator, lesson_section_number} = req.body;
   const  query = `UPDATE eduall_lessons_sections SET ed_lesson_section_title = ?, ed_lesson_section_creator = ?,
   ed_lesson_section_position = ? WHERE ed_lesson_section_deleted = 0 AND ed_lesson_section_id = ?`;
   const PARAMS = [lesson_section_title, lesson_section_creator, lesson_section_number,ID];
   DATABASERUN(res, query , PARAMS, 1);
} 
 

const LessonSectionUpdatePosition = async(req, res)=>{ 
      const  query = `UPDATE eduall_lessons_sections SET ed_lesson_section_position = ?
      WHERE ed_lesson_section_deleted = 0 AND ed_lesson_section_id = ?`; 
      const PARAMS = [req.session.user.eduall_user_session_curentinstitute];
      DATABASERUN(res, query , PARAMS, 0);
} 



const GetSingerAlbums  = async(req, res)=>{
   const query = `
   
   SELECT S.*,
   
   GROUP_CONCAT(CONCAT('{album_name:"', A.album_name, '", album_artist:"', A.album_artist ,'"}')) list
   FROM singers AS S LEFT JOIN albums AS A 
   ON (S.singer_code = A.album_artist_id)  GROUP BY S.singer_id;
   
 
   `

   //WHERE S.singer_code = 1
   const PARAMS = [];
   DATABASERUN(res, query , PARAMS, 0);


}




module.exports = {GetLessonsSectionByGroup, GetSingleLessonSection, GetLessonsSectionBuyGroupCode, GetSingerAlbums,
RegisterLessonSection, LessonSectionDelete, LessonSectionUpdatePosition, LessonSectionUpdate, GetLessonsSectionByCreator  };