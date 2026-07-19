const CheckInternet = require("../config/CheckInternet");
const { DB_SQLITE, DATABASE } = require("../config/Database"); 
const { GetCurrentUserData } = require("./GetCurrentUserData");
 


const DATABASERUN = async (res, query, params, type) => {
   try {
      if (type === 0) {
         DATABASE.query(query, params, (err, rows) => {
            if (err) {
               console.error("Database error:", err); 
               return res.status(500).json({ status: 500, success: false, error: "Internal Server Error" });
            }
            return res.json(rows);
         });
      } else {
         DATABASE.query(query, params, (err) => {
            if (err) {
               console.error("Database error:", err);  
               return res.status(500).json({ status: 500, success: false, error: "Internal Server Error" });
            }
            return res.json({ success: true, message: "Operation successful" });
         });
      }
   } catch (error) {
      console.error("Unexpected error:", error);
      return res.status(500).json({ status: 500, success: false, error: "Internal Server Error" });
   }
}


const GetChatMessagesByContact = async(req, res)=>{ 
    const {CODE} = req.params;
    const  query = `SELECT * FROM eduall_chat_messages LEFT JOIN eduall_user_accounts ON 
     ed_chat_message_from = eduall_user_accounts.ed_user_account_id  
     WHERE ed_chat_message_from = ? AND ed_chat_message_to = ? OR ed_chat_message_from = ? AND ed_chat_message_to = ?`;
    const PARAMS = [CODE, req.session.user.eduall_user_session_ID, req.session.user.eduall_user_session_ID, CODE];
    DATABASE.query(query, PARAMS, (err, rows)=>{ 
      
        if(err) return res.status(300).json({status:300, success:false, error:err});;
        return res.json({currentusercode:req.session.user.eduall_user_session_ID, messages:rows});
     });
} 

 

const CreateChatMessage = async(req, res)=>{ 
    const  query = `INSERT INTO eduall_chat_messages (ed_chat_message_code, ed_chat_message_from, ed_chat_message_to,
    ed_chat_message_group_code, ed_chat_message_content, ed_chat_message_gif) VALUES(?,?,?,?,?,?)`;
    const PARAMS = [req.body.chat_msg_code , req.session.user.eduall_user_session_ID, req.body.chat_msg_to, req.body.chat_msg_group_code, req.body.chat_msg_content, req.body.chat_msg_gif];
    DATABASERUN(res, query , PARAMS, 1);
} 


const MessageDelete = async(req, res)=>{
    const {ID} = req.params;
    const  query = `UPDATE eduall_chat_messages SET ed_cicle_deleted = 1
    WHERE ed_cicle_deleted = 0 AND ed_cicle_id = ?`;
    const PARAMS = [ID];
    DATABASERUN(res, query , PARAMS, 1);
} 


 

             

module.exports = {CreateChatMessage, GetChatMessagesByContact};