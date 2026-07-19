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
 
 

const InstituteDelete = async(req, res)=>{
   
} 

const InstituteUpdateLicence = async(req, res)=>{
     
} 



const GetCurentLicence = async(req, res)=>{ 
   const query = 'SELECT * FROM eduall_institutes_licences WHERE ed_institute_licence_instituteCode = ?';
   const PARAMS = [req.session.user.eduall_user_session_curentinstitute];
   DATABASERUN(res, query , PARAMS, 0);  
} 


const GetInstitutes = async(req, res)=>{
    const query = 'SELECT * FROM eduall_institutes WHERE ed_institute_deleted = 0';
    const PARAMS = [];
    DATABASERUN(res, query , PARAMS, 0);
}



const EduallSearchInstitutes = async(req, res)=>{
   const query = `SELECT * FROM eduall_institutes WHERE
   ed_institute_deleted = 0 AND 
   ed_institute_name LIKE '${req.params.TEXT.toLowerCase()}%'  
   OR  ed_institute_website LIKE '${req.params.TEXT.toLowerCase()}%'
   OR ed_institute_email LIKE '${req.params.TEXT.toLowerCase()}%'`;
   const PARAMS = [];
   DATABASERUN(res, query , PARAMS, 0);
}




 
const GetSingleInstitute = async(req,res)=>{
 const {ID} = req.params;
 const  query = 'SELECT * FROM eduall_institutes WHERE ed_institute_deleted = 0 AND ed_institute_id = ?';
 const PARAMS = [ID];
 DATABASERUN(res, query , PARAMS, 0);
}

 
const GetAllInstituteServicePaymentsByInstituteCode = async(req,res)=>{ 
   const  query = 'SELECT * FROM eduall_institutes_licences WHERE ed_institute_deleted = 0 AND ed_institute_code = ?';
   const PARAMS = [CODE];
   DATABASERUN(res, query , PARAMS, 0);
  }

   
const GetCurrentInstituteByCode = async(req,res)=>{
   console.log(req.session.user.eduall_user_session_curentinstitute);
   const  query = 'SELECT * FROM eduall_institutes WHERE ed_institute_deleted = 0 AND ed_institute_code = ?';
   const PARAMS = [req.session.user.eduall_user_session_curentinstitute];
   DATABASERUN(res, query , PARAMS, 0);
}

  

const RegisterInstitute = async(req, res)=>{   
 const  query = `INSERT INTO eduall_institutes(ed_institute_name  = ?  ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`;
    const PARAMS =  [institute_name,   req.file.path]
    DATABASERUN(res, query , PARAMS, 1);
}
 

const InstituteUpdate = async(req, res)=>{
    const {institute_name, institute_principal, institute_linkedin, institute_facebook,  institute_instagram, 
    institute_youtube, institute_country, institute_address, institute_nif, institute_phone1, institute_bank2_account_number,
    institute_phone2,  institute_email, institute_bank1_account_number,   institute_bank2_name, institute_bank1_recipient, institute_iva, 
    institute_language,  institute_bank2_recipient, institute_type, institute_website, institute_bank1_name} = req.body; 

    const  query = `UPDATE eduall_institutes SET ed_institute_name =  ?, ed_institute_principal  =  ?, ed_institute_linkedin =  ?, ed_institute_facebook =  ?,
    ed_institute_instagram  =  ?,ed_institute_youtube =  ?, ed_institute_country =  ?, ed_institute_address =  ?, 
    ed_institute_nif =  ?, ed_institute_phone1 =  ?,ed_institute_phone2 =  ?, ed_institute_email =  ?,  
    ed_institute_bank1 =  ?, ed_institute_bank1_account_number =  ?, ed_institute_bank1_recipient =  ?, 
    ed_institute_bank2 =  ?,ed_institute_bank2_account_number =  ?,ed_institute_bank2_recipient =  ?,
    ed_institute_iva_value  =  ?, ed_institute_language =  ?,ed_institute_type =  ?,ed_institute_website =  ?,
    ed_institute_logo = ?  WHERE ed_institute_deleted = 0 AND ed_institute_code = ?`;

    const PARAMS = [institute_name, institute_principal  ,institute_linkedin   ,institute_facebook , institute_instagram  ,institute_youtube ,
    institute_country,institute_address ,institute_nif,institute_phone1  , institute_phone2 ,institute_email  
    , institute_bank1_name  , institute_bank1_account_number ,institute_bank1_recipient, institute_bank2_name  
    ,institute_bank2_account_number,institute_bank2_recipient,institute_iva,institute_language 
    ,institute_type ,institute_website , (req.file ?  req.file.path : ""), req.session.user.eduall_user_session_curentinstitute];
    DATABASERUN(res, query , PARAMS, 1);
} 
 


const storage = multer.diskStorage({
    destination:'images/logos',
    filename:(req, file,  cb)=>{
       return cb(null, `eduall_file_${file.fieldname}_${Date.now()}_${Math.random(1,389398393993100012002)}_${path.extname(file.originalname)}`)
    }
});

const uploadFiles = multer({
    storage:storage
}).single('institute_payment_file');


module.exports = {GetInstitutes, GetSingleInstituteByCode, GetCurentLicence, 
GetCurrentInstituteByCode, GetSingleInstitute, RegisterInstitute, InstituteDelete, 
InstituteUpdate, InstituteUpdateLicence, uploadFiles, EduallSearchInstitutes};





