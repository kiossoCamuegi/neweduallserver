const CheckInternet = require("../config/CheckInternet");
const { DB_SQLITE, DATABASE } = require("../config/Database"); 
const { GetCurrentUserData } = require("./GetCurrentUserData");
const multer = require(`multer`);
const path = require(`path`);

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
 

const GetLessonsReviewsByLesson = async(req, res)=>{
    const {CODE} = req.params; 
      const  query = `SELECT * FROM eduall_lesson_reviews LEFT JOIN eduall_user_accounts ON 
      ed_lesson_review_user = eduall_user_accounts.ed_user_account_id  WHERE  ed_lesson_review_lessonId = ?`;
      const PARAMS = [CODE];
      DATABASERUN(res, query , PARAMS, 0);
}

 
 
 
module.exports = {GetLessonsReviewsByLesson  };