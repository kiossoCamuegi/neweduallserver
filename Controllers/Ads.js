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
               return res.status(200).json("success");
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



const RegisteraDS = async(req, res)=>{  
    const {ID} = req.params;
    const  query = `INSERT INTO ads (ads_code) VALUES(?)`; 
    DATABASE.query(query, [ID], (err)=>{ 
      if(err) { 
          console.log(err);
         return res.status(500).json(err);
      };
      return res.status(200).json("Success !");
   });  
} 

      



const addAlbum  = async(req, res)=>{ 
   const  query = `INSERT INTO albums (album_name, album_artist) VALUES(?,?)`;
     DATABASE.query(query, [req.body.name, req.body.artist], (err)=>{ 
      if(err)  return res.status(500).json(err);
      return res.status(200).json("Success !");
   });
}


module.exports = {RegisteraDS, addAlbum};