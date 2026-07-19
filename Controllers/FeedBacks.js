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
 
 const institute_code = "29sVaJwcQMpLYNUDfVJfz128kygWOOmExbqKWL18EDWdyDJYCD2Tp4yVGup4qyHwReG0BaILnYio1rini2oB9hQD28xcsZKsOUZ";
 const user_code = 26;

const GetFeedBacks = async(req, res)=>{
     if(CheckInternet() === true){
      try {
        const Data = await FeedBacksModel.findAll({where:{ed_feedback_deleted:0 }});
        res.json(Data);
      } catch (error) {
          res.status(400).json(error); 
      }
     }else{
    //########################
      const  query = 'SELECT * FROM eduall_academic_level WHERE ed_academic_level_deleted = 0 AND  ed_academic_level_institute_code = ?';
      try {
         DB_SQLITE.all(query, [req.session.user.eduall_user_session_curentinstitute], (err, rows)=>{ 
             if(err) return res.status(300).json({status:300, success:false, error:err});;
             return res.json(rows);
         }); 
      } catch (error) {
         res.status(400).json(error); 
      } 
   //########################
     }
}


const GetSingleFeedback = async(req,res)=>{
   const {ID} = req.params;
    if(CheckInternet() === true){
      try {
        const Data = await FeedBacksModel.findAll({where:{ed_feedback_deleted:0, ed_feedback_id:ID}});
        res.json(Data);
      } catch (error) {
         res.status(400).json(error); 
      }
    }else{
        
      //########################
      const  query = 'SELECT * FROM eduall_academic_level WHERE ed_academic_level_deleted = 0 AND ed_academic_level_id = ? ';
      try {
         DB_SQLITE.run(query, [ID], (err, rows)=>{ 
               if(err) return res.status(300).json({status:300, success:false, error:err});;
               return res.json(rows);
         }); 
      } catch (error) {
         res.status(400).json(error); 
      } 
      //######################## 
    }
}
 

const GetSingleUserFeedback = async(req,res)=>{ 
    if(CheckInternet() === true){
      try {
        const Data = await FeedBacksModel.findAll(
              {where:{ed_feedback_deleted:0, 
                  ed_feedback_institute_code:req.session.user.eduall_user_session_curentinstitute, 
                  ed_feedback_userid:user_code
              }});
        res.json(Data);
      } catch (error) {
         res.status(400).json(error); 
      }
    }else{
     //########################
      const  query = 'SELECT * FROM eduall_academic_level WHERE ed_academic_level_deleted = 0 AND ed_academic_level_id = ? ';
      try {
         DB_SQLITE.run(query, [ID], (err, rows)=>{ 
               if(err) return res.status(300).json({status:300, success:false, error:err});;
               return res.json(rows);
         }); 
      } catch (error) {
         res.status(400).json(error); 
      } 
      //########################
    }
}
 

const RegisterFeedBack = async(req, res)=>{  
     if(CheckInternet() === true){
      try {
        await FeedBacksModel.create({ 
              ed_feedback_userid:user_code, 
              ed_feedback_visit_status:req.body.feedback_visit_status, 
              ed_feedback_type:req.body.feedback_type, 
              ed_feedback_area:req.body.feedback_error_area,  
              ed_feedback_description:req.body.feedback_description,
              ed_feedback_rating:req.body.feedback_system_classification,
              ed_feedback_email:req.body.feedback_email,
              ed_feedback_institute_code:institute_code
        });
        res.json('success');
      } catch (error) {
            res.json(error);
      }
     }else{
             
//########################
   const  query = `INSERT INTO eduall_academic_level(ed_academic_level_title, ed_academic_level_institute_code) VALUES(?,?)`;
   try {
      DB_SQLITE.run(query, [req.body.academic_level_title , req.session.user.eduall_user_session_curentinstitute], (err)=>{ 
            if(err) return res.status(300).json({status:300, success:false, error:err});;
            return res.json("success");
      }); 
   } catch (error) {
      res.status(400).json(error); 
   } 
   //########################   
     }
}
 

const FeedBackDelete = async(req, res)=>{
     const {ID} = req.params;
       if(CheckInternet() === true){
        try {
          const CurrentFeedback = await FeedBacksModel.findOne({where:{ed_feedback_id:ID}})
          if(!CurrentFeedback){
            return res.status(400).json("Feedback não encontrado");
          }     
          CurrentFeedback.ed_feedback_deleted = 1;
          await CurrentFeedback.save();
          res.status(201).json("Feedback  deletado");
      } catch (error) {
          res.json(error);
      }
       }else{
               
      //########################
      const  query = `UPDATE eduall_academic_level SET ed_academic_level_deleted = 1
      WHERE ed_academic_level_deleted = 0 AND ed_academic_level_id = ?`;

      try { 
          DB_SQLITE.run(query, [ID], (err)=>{ 
            if(err) return res.status(300).json({status:300, success:false, error:err});;
            return res.json("success");
         }); 
      } catch (error) {
         res.status(400).json(error); 
      }   
      //########################
       }
}  

const FeedbackUpdate = async(req, res)=>{
     const {ID} = req.params;
     const  {feedback_visit, feedback_type, feedback_area, feedback_page, feedback_description, feedback_rating, feedback_email} =  req.body;
       if(CheckInternet() === true){
        try {
          const CurrentFeedback = await FeedBacksModel.findOne({where:{ed_feedback_id:ID}})
          if(!CurrentFeedback){
            return res.status(400).json("Feedback não encontrado");
          }       
           CurrentFeedback.ed_feedback_visit_status = feedback_visit; 
           CurrentFeedback.ed_feedback_type = feedback_type;
           CurrentFeedback.ed_feedback_area = feedback_area; 
           CurrentFeedback.ed_feedback_page = feedback_page;
           CurrentFeedback.ed_feedback_description = feedback_description;
           CurrentFeedback.ed_feedback_rating = feedback_rating;
           CurrentFeedback.ed_feedback_email = feedback_email;
          await CurrentFeedback.save();
          res.status(201).json("Feedback atualizado com succeso");
      } catch (error) {
          res.json(error);
      }
       }else{
               
      //########################
      const  query = `UPDATE eduall_academic_level SET ed_academic_level_deleted = 1
      WHERE ed_academic_level_deleted = 0 AND ed_academic_level_id = ?`;

      try { 
          DB_SQLITE.run(query, [ID], (err)=>{ 
            if(err) return res.status(300).json({status:300, success:false, error:err});;
            return res.json("success");
         }); 
      } catch (error) {
         res.status(400).json(error); 
      }   
      //########################
       }
} 


module.exports = {GetFeedBacks, GetSingleFeedback, GetSingleUserFeedback, RegisterFeedBack, FeedBackDelete, FeedbackUpdate};
 