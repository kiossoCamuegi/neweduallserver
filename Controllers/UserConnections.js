 
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
 
 



const GetCurrentUserConnections = async(req, res)=>{  
    const  query = 'SELECT * FROM eduall_user_accounts WHERE ed_user_account_deleted = 0 AND ed_user_account_id != ? ORDER BY ed_user_account_name ASC';
    const PARAMS = [req.session.user.eduall_user_session_ID];
    DATABASERUN(res, query , PARAMS, 0);
}


 

 
module.exports = {GetCurrentUserConnections };