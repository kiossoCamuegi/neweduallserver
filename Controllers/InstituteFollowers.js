const multer  = require('multer');
const path  = require('path');
const CheckInternet = require("../config/CheckInternet");
const { DB_SQLITE, DATABASE } = require("../config/Database"); 
const { GetCurrentUserData } = require("./GetCurrentUserData");
const DeviceDetector = require('node-device-detector');


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
 
  
 
 
const CheckIfFollowingInstitute = async(req,res)=>{
    const {CODE} = req.params;
    const  query = `SELECT * FROM  eduall_institute_followers WHERE ed_institute_follower_user = ? AND ed_institute_follower_code  = ? `; 
    const PARAMS = [req.session.user.eduall_user_session_ID, CODE];
    DATABASERUN(res, query , PARAMS, 0);
}

 
const GetSingleInstituteFollowers = async(req,res)=>{
   const {CODE} = req.params;
   const  query = `SELECT * FROM  eduall_institute_followers 
   LEFT JOIN  eduall_user_accounts ON eduall_user_accounts.ed_user_account_id = eduall_institute_followers.ed_institute_follower_user
   WHERE  ed_institute_follower_code  = ? `; 
   const PARAMS = [CODE];
   DATABASERUN(res, query , PARAMS, 0);
}

 
  

const FollowInstitute = async(req, res)=>{  
    const {CODE} = req.body;
  
  try {
      const  query = `SELECT * FROM   eduall_institutes WHERE ed_institute_code = ?`;
     DATABASE.query(query, [CODE], (err, rows)=>{ 
      
      if(err) return res.status(300).json({msg:"Não foi possível concluir a operação neste momento !"});
      if(rows.length >= 1){ 

        const  query1 = `SELECT * FROM  eduall_institute_followers WHERE ed_institute_follower_user = ? AND ed_institute_follower_code  = ? `;
        DATABASE.query(query1, [req.session.user.eduall_user_session_ID, CODE], (err, rows)=>{ 
         
         if(err) return res.status(400).json({msg:"Não foi possível concluir a operação neste momento !"});
         if(rows.length <= 0){ 
    
            const  query2 = `INSERT INTO eduall_institute_followers(ed_institute_follower_user,  ed_institute_follower_code) VALUES(?,?)`;
            const PARAMS =  [req.session.user.eduall_user_session_ID, CODE]
            DATABASERUN(res, query2 , PARAMS, 1);
   
         }else{
             res.status(500).json({msg:0});
         } 
        }) 
      }else{
          res.status(301).json({msg:"Instituição não encontrada !"});
      }     
  })
  } catch (error) { 
      res.status(302).json({msg:"Instituição não encontrada  !"});
  } 
 
}
 
 


 

module.exports = {FollowInstitute, GetSingleInstituteFollowers, CheckIfFollowingInstitute};