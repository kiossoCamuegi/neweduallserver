const CheckInternet = require("../config/CheckInternet");
const { DB_SQLITE, DATABASE } = require("../config/Database");   
const  multer = require(`multer`);
const  path = require(`path`); 

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
               
               if(err) return res.status(300).json({status:300, success:false, error:err});
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
 
const GetSingleCpPageByCode = async(req,res)=>{
   const {CODE} = req.params;
   const  query = 'SELECT * FROM eduall_pages WHERE ed_page_deleted = 0 AND ed_page_code = ?';
   const PARAMS = [CODE];
   console.log(CODE);
   DATABASERUN(res, query , PARAMS, 0);
}

 
const GetSingleCpPage = async(req,res)=>{
    const {ID} = req.params;
    const  query = 'SELECT * FROM eduall_pages WHERE ed_page_deleted = 0 AND ed_page_id = ?';
    const PARAMS = [ID];
    DATABASERUN(res, query , PARAMS, 0);
 }
  


module.exports = { GetSingleCpPage, GetSingleCpPageByCode };