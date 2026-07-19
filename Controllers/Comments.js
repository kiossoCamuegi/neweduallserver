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
 

const GeCommentsByContentIdAndType = async(req, res)=>{
    const {ID, TYPE} = req.params; 
    const  query = `SELECT * FROM eduall_comments LEFT JOIN eduall_user_accounts ON eduall_comments.ed_comment_user = eduall_user_accounts.ed_user_account_id
    WHERE  eduall_comments.ed_comment_contentID = ? AND eduall_comments.ed_comment_contentType = ?`;
    const PARAMS = [ID, TYPE];
    DATABASERUN(res, query , PARAMS, 0);
}

const GeCommentsRepliesByCommentId = async(req, res)=>{
   const {ID} = req.params; 
   const  query = `SELECT * FROM eduall_comments_replies LEFT JOIN eduall_user_accounts ON 
   eduall_comments_replies.ed_comment_replie_user = eduall_user_accounts.ed_user_account_id
   WHERE  eduall_comments_replies.ed_comment_replie_commentID = ?`;
   const PARAMS = [ID];
   DATABASERUN(res, query , PARAMS, 0);
}


const GeCommentsSubRepliesByReplietId = async(req, res)=>{
   const {ID} = req.params; 
   const  query = `SELECT * FROM eduall_comments_subreplies LEFT JOIN eduall_user_accounts ON 
   eduall_comments_subreplies.ed_comment_subreplie_user = eduall_user_accounts.ed_user_account_id
   WHERE  eduall_comments_subreplies.ed_comment_subreplie_replieID = ?`;
   const PARAMS = [ID];
   DATABASERUN(res, query , PARAMS, 0);
}



const GeCommentReactionsByReplietIdAndType = async(req, res)=>{
   const {ID, TYPE} = req.params; 
   const  query = `SELECT * FROM eduall_comment_reactions LEFT JOIN eduall_user_accounts ON 
   eduall_comment_reactions.ed_comment_reaction_user = eduall_user_accounts.ed_user_account_id
   WHERE  eduall_comment_reactions.ed_comment_reaction_contentID = ?  
   AND eduall_comment_reactions.ed_comment_reaction_contentType = ?`;
   const PARAMS = [ID, TYPE];
   DATABASERUN(res, query , PARAMS, 0);
}


module.exports = {GeCommentsByContentIdAndType, GeCommentsRepliesByCommentId,
GeCommentReactionsByReplietIdAndType,  GeCommentsSubRepliesByReplietId};