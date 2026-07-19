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
 

const GetTransportTuitionpayments = async(req, res)=>{ 
     if(CheckInternet() === true){
      try {
         const Data = await TransportTuitionsModel.findAll({where:{ed_transport_tuition_deleted:0,ed_academic_level_institute_code:req.session.user.eduall_user_session_curentinstitute}});
         res.json(Data);
      } catch (error) {
         res.status(400).json(error); 
      } 
     }else{ 
    //########################
      const  query = 'SELECT * FROM eduall_academic_level WHERE ed_transport_tuition_deleted = 0 AND  ed_academic_level_institute_code = ?';
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

const GetSingleTransportTuitionpayment = async(req,res)=>{
   const {ID} = req.params; 

    if(CheckInternet() === true){
      try {
         const Data = await TransportTuitionsModel.findAll({where:{ed_transport_tuition_deleted:0, ed_transport_tuition_id:ID}});
         res.json(Data);
       } catch (error) {
          res.status(400).json(error); 
       }
    }else{
         
      //########################
      const  query = 'SELECT * FROM eduall_academic_level WHERE ed_transport_tuition_deleted = 0 AND ed_transport_tuition_id = ? ';
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
 

const GetSinglePaidTransportTuitionMonth = async(req,res)=>{
    const {MONTH, STUDENTCODE, YEAR, SERVICE} = req.params; 

     if(CheckInternet() === true){
      try {
         const Data = await TransportTuitionsModel.findAll({where:{
            ed_transport_tuition_deleted:0,
            ed_transport_tuition_month:MONTH,
            ed_transport_tuition_student_code:STUDENTCODE,
            ed_transport_tuition_service:SERVICE,
            ed_transport_tuition_academic_year:YEAR
         }});
         res.json(Data);
       } catch (error) {
          res.status(400).json(error); 
       }
     }else{
          
     }
 }


 
const GetSingleStudentTransportTuition = async(req,res)=>{
   const {ACADEMICYEAR, STUDENTCODE, INSTITUTECODE} = req.params; 

    if(CheckInternet() === true){
      try {
         const Data = await TransportTuitionsModel.findAll({where:{ed_transport_tuition_deleted:0, 
            ed_transport_tuition_student_code:STUDENTCODE, 
            ed_transport_tuition_academic_year:ACADEMICYEAR,
            ed_transport_tuition_institute_code:INSTITUTECODE
         }});
         res.json(Data);
       } catch (error) {
          res.status(400).json(error); 
       }
    }else{
         
    }
}


const RegisterTransportTuitionPayment = async(req, res)=>{ 
     if(CheckInternet() === true){
      const Data = {  
         ed_transport_tuition_student_code:req.body.transporttuition_student_code,
         ed_transport_tuition_service:req.body.transporttuition_servicecode,
         ed_transport_tuition_price:req.body.transporttuition_price,
         ed_transport_tuition_month:req.body.transporttuition_months, 
         ed_transport_tuition_payment_type:req.body.transporttuition_type,
         ed_transport_tuition_bank:req.body.transporttuition_bank, 
         ed_transport_tuition_academic_year:req.body.transporttuition_academic_year,
         ed_transport_tuition_place:req.body.transporttuition_place,
         ed_transport_tuition_balance:req.body.transporttuition_balance,
         ed_transport_tuition_bordereux:req.body.transporttuition_bordereux_number, 
      }
      try {
           await TransportTuitionsModel.create(Data);
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

const TransportTuitionPaymentDelete = async(req, res)=>{
     const {ID} = req.params; 
       if(CheckInternet() === true){
         try {
            const Transporttuitionpayment = await TransportTuitionsModel.findOne({where:{ed_transport_tuition_id:ID}})
            if(!Transporttuitionpayment){
              return res.status(400).json("Pagamento de transporte escolar  não encontrado");
            }     
            Transporttuitionpayment.ed_transport_tuition_deleted = 1;
            await Transporttuitionpayment.save();
            res.status(201).json("Pagamento deletado");
        } catch (error) {
            res.json(error);
        }
       }else{
               
      //########################
      const  query = `UPDATE eduall_academic_level SET ed_transport_tuition_deleted = 1
      WHERE ed_transport_tuition_deleted = 0 AND ed_transport_tuition_id = ?`;

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


const TransportTuitionPaymentUpadate = async(req, res)=>{
   const {ID} = req.params;
   const {transporttuition_student_code, transporttuition_servicecode, transporttuition_price, transporttuition_months, transporttuition_discount, 
   transporttuition_type, transporttuition_bank , transporttuition_academic_year, transporttuition_place, transporttuition_balance, transporttuition_bordereux_number } = req.body;
 
     if(CheckInternet() === true){
      try {
         const Transporttuitionpayment = await TransportTuitionsModel.findOne({where:{ed_transport_tuition_id:ID}})
         if(!Transporttuitionpayment){
           return res.status(400).json("Pagamento de transporte escolar  não encontrado");
         }     

         Transporttuitionpayment.ed_transport_tuition_student_code = transporttuition_student_code;
         Transporttuitionpayment.ed_transport_tuition_service = transporttuition_servicecode;
         Transporttuitionpayment.ed_transport_tuition_price = transporttuition_price; 
         Transporttuitionpayment.ed_transport_tuition_discount = transporttuition_discount;
         Transporttuitionpayment.ed_transport_tuition_payment_type = transporttuition_type;
         Transporttuitionpayment.ed_transport_tuition_bank = transporttuition_bank; 
         Transporttuitionpayment.ed_transport_tuition_academic_year = transporttuition_academic_year;
         Transporttuitionpayment.ed_transport_tuition_place = transporttuition_place;
         Transporttuitionpayment.ed_transport_tuition_balance = transporttuition_balance;
         Transporttuitionpayment.ed_transport_tuition_bordereux = transporttuition_bordereux_number;

         await Transporttuitionpayment.save();
         res.status(201).json("Pagamento de transporte escolar  atualizado com sucesso");
     } catch (error) {
         res.json(error);
     }
     }else{
             
      //########################
      const  query = `UPDATE eduall_academic_level SET ed_transport_tuition_deleted = 1
      WHERE ed_transport_tuition_deleted = 0 AND ed_transport_tuition_id = ?`;

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


module.exports = {GetTransportTuitionpayments, GetSinglePaidTransportTuitionMonth, RegisterTransportTuitionPayment, GetSingleTransportTuitionpayment,
GetSingleStudentTransportTuition, TransportTuitionPaymentUpadate, TransportTuitionPaymentDelete};