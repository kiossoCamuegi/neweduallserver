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
 
  
 
 
const CheckUserContactRequest = async(req,res)=>{
    const {CODE} = req.params;
    const  query = `SELECT * FROM  eduall_user_contacts WHERE ed_user_contact_userCode = ? AND ed_user_contact_contactCode  = ? `; 
    const PARAMS = [req.session.user.eduall_user_session_ID, CODE];
    DATABASERUN(res, query , PARAMS, 0);
}

  

const MakeUserContactRequest = async(req, res)=>{  
    const {CODE} = req.body;
  
  try {
      const  query = `SELECT * FROM eduall_user_accounts WHERE  ed_user_account_deleted = 0 AND ed_user_account_id = ? `;
     DATABASE.query(query, [CODE], (err, rows)=>{ 
      
      if(err) return res.status(300).json({msg:"Não foi possível concluir a operação neste momento !"});
      if(rows.length >= 1){ 

        const  query1 = `SELECT * FROM  eduall_user_contacts WHERE ed_user_contact_userCode = ? AND ed_user_contact_contactCode  = ? `;
        DATABASE.query(query1, [req.session.user.eduall_user_session_ID, CODE], (err, rows)=>{ 
         
         if(err) return res.status(400).json({msg:"Não foi possível concluir a operação neste momento !"});
         if(rows.length <= 0){ 
    
            const  query2 = `INSERT INTO eduall_user_contacts(ed_user_contact_userCode,  ed_user_contact_contactCode) VALUES(?,?)`;
            const PARAMS =  [req.session.user.eduall_user_session_ID, CODE]
            DATABASERUN(res, query2 , PARAMS, 1);
   
         }else{
             res.status(500).json({msg:0});
         } 
        }) 
      }else{
          res.status(301).json({msg:"usuário não encontrado !"});
      }     
  })
  } catch (error) { 
      res.status(302).json({msg:"usuário não encontrado !"});
  } 
 
}
 
 


 

module.exports = {MakeUserContactRequest, CheckUserContactRequest};