const CheckInternet = require("../config/CheckInternet");
const { DB_SQLITE, DATABASE } = require("../config/Database"); 
const { post } = require("../routes/Auth");
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
 
 
const RegisterPublication = async(req, res)=>{ 
   const  query = `INSERT INTO eduall_posts(ed_post_for,  ed_post_user , ed_post_code, ed_post_description, ed_post_total_files) VALUES(?,?,?,?,?)`;
   const PARAMS =  [req.body.post_for ,  ID , req.body.post_code , req.body.post_text, req.body.post_total_files];
   DATABASERUN(res, query , PARAMS, 1);
}
 

 

const GetPostsForCurrentUser = async(req, res)=>{ 
   const  query = `
   SELECT POSTS.*,
   
   GROUP_CONCAT(FILES.ed_file_name) post_files, 
   GROUP_CONCAT(USERS.ed_user_account_picture) ed_post_user_picture,
   GROUP_CONCAT(USERS.	ed_user_account_name) ed_post_user_name
   FROM eduall_posts AS POSTS LEFT JOIN eduall_files AS FILES 
   ON (POSTS.ed_post_code = FILES.ed_file_code) 
   LEFT JOIN eduall_user_accounts AS USERS ON (POSTS.ed_post_user = USERS.ed_user_account_id)
   GROUP BY POSTS.ed_post_registerdate DESC `; 
   const PARAMS = [];
   DATABASERUN(res, query , PARAMS, 0);
}


const GetUserPostsByContacts = async(req, res)=>{ 
   console.log("working on your case 🙂😍🙄😎")
   const ID = 25 //ID;
 //* start here **/
 let output =  [];
 const NewArray = []
 const GetData = ()=>{
   const query  = `SELECT * FROM eduall_user_contacts 
   LEFT JOIN eduall_user_accounts ON eduall_user_contacts.ed_user_contact_contactCode = eduall_user_accounts.ed_user_account_id  
   WHERE eduall_user_accounts.ed_user_account_deleted =  0 AND eduall_user_contacts.ed_user_contact_userCode =  ?`;

   const DataList = [];
   const DataListWithFiles = [];
   const DataListWithComments = [];
   const DataListWithReactions = [];
   const DataListWithShares = [];
   if(DataListWithShares.length >= 1) console.log("ok")
   const GetEachUserPosts = (code, index, total, user)=>{ 

      const setPostWithShares  = (e, index)=>{
         DataListWithShares.push(e);
         if(index === total-1){   
            console.log("Empty posts *4 😋");
            output = DataListWithShares; 
            NewArray.push(DataListWithShares); 
            ReturnData()
         }  
     }

      const setPostsWithReactions = (e, index)=>{
         console.log("Pushing post shares ...");
         DataListWithReactions.push(e);
        //  if(index === total-1){
            DataListWithReactions.map((Dt, ind)=>{
               const  query5 = `SELECT *  FROM  eduall_posts_shares
               LEFT JOIN eduall_user_accounts ON eduall_user_accounts.ed_user_account_id = eduall_posts_shares.ed_post_share_user
               WHERE eduall_posts_shares.ed_post_share_deleted = 0 AND eduall_user_accounts.ed_user_account_deleted = 0 
               AND eduall_posts_shares.ed_post_share_postCode =  ?`; 
               DATABASE.query(query5, [Dt.post_information.post_id] , (err, shares)=>{ 
                  
                  console.log("here  are the post shares  **********************");
                  console.log(shares.length);

                   if(!err){
                     let SharesBox  = [];

                     shares.map((share, rcIndex)=>{
                        SharesBox.push({
                           share_username:share.ed_user_account_name,
                           share_userpicture:share.ed_user_account_picture,
                           share_usercode:share.ed_user_account_id, 
                           share_code:share.ed_post_share_id , 
                           share_date:share.ed_post_share_registerDate,
                           share_byme:(ID*1 === share.ed_user_account_id*1)
                        });
                     });


                     setPostWithShares({
                        post_information:Dt.post_information,
                        post_files:Dt.post_files,
                        post_comments:Dt.post_comments,
                        post_reactions:Dt.post_reactions,
                        post_shares:SharesBox
                     },ind);


                   }else{
                     setPostWithShares({
                        post_information:Dt.post_information,
                        post_files:Dt.post_files,
                        post_comments:Dt.post_comments,
                        post_reactions:Dt.post_reactions,
                        post_shares:[]
                     }, ind);
                   }
               }); 
             });
        //} 
      }

      const setPostsWithComments = (e,index)=>{
         console.log("pushing reactions ....");
         DataListWithComments.push(e);
         if(index === total-1){
            DataListWithComments.map((Dt, ind)=>{
              const  query5 = `SELECT *  FROM eduall_posts_likes
              LEFT JOIN eduall_user_accounts ON eduall_user_accounts.ed_user_account_id = eduall_posts_likes.ed_post_like_user
              WHERE eduall_user_accounts.ed_user_account_deleted = 0  AND eduall_posts_likes.ed_post_like_postCode =  ? `; 
              DATABASE.query(query5, [Dt.post_information.post_id] , (err, reactions)=>{ 

                
               console.log("here  are the post reactions  **********************");
               console.log(reactions.length);
               
                  if(!err){
                    let ReactionsBox  = [];
                    reactions.map((reaction, rcIndex)=>{
                       ReactionsBox.push({
                          reaction_username:reaction.ed_user_account_name,
                          reaction_userpicture:reaction.ed_user_account_picture,
                          reaction_usercode:reaction.ed_user_account_id, 
                          reaction_code:reaction.ed_post_like_id , 
                          reaction_date:reaction.ed_post_like_registerdate,
                          reaction_byme:(ID*1 === reaction.ed_user_account_id*1)
                       });
                    });
                    setPostsWithReactions({
                       post_information:Dt.post_information,
                       post_files:Dt.post_files,
                       post_comments:Dt.post_comments,
                       post_reactions:ReactionsBox
                    },ind);
                  }else{
                     console.log(err)
                     console.log("Empty posts *9 😋");
                     output = [];
                     ReturnData();
                  }
              }); 
            });
         }
      }

      const setPostWithFiles = (e, indexX)=>{ 
         DataListWithFiles.push(e);
         console.log("Pushing comments !!!!")
        if(indexX === total-1){ 
         DataListWithFiles.map((Dt, ind)=>{
               const  query5 = `SELECT * FROM eduall_post_comments
               LEFT JOIN eduall_user_accounts ON eduall_user_accounts.ed_user_account_id = eduall_post_comments.ed_post_comment_user
               WHERE eduall_post_comments.ed_post_comment_deleted = 0 AND eduall_user_accounts.ed_user_account_deleted = 0 
               AND eduall_post_comments.ed_post_comment_postCode =  ?`; 
               DATABASE.query(query5, [Dt.post_information.post_id] , (err, comments)=>{ 
                  
                   
                  console.log("here  are the post comments  **********************");
                  console.log(comments.length);

                   if(!err){
                     let CommentsBox  = [];
                     comments.map((comment, cmIndex)=>{
                          CommentsBox.push({
                              comment_username:comment.ed_user_account_name,
                              comment_userpicture:comment.ed_user_account_picture,
                              comment_usercode:comment.ed_user_account_id,
                              comment_description:comment.ed_post_comment_text,
                              comment_code:comment.ed_post_comment_id,
                              comment_image:comment.ed_post_comment_image,
                              comment_date:comment.ed_post_comment_registerDate,
                              comment_byme:(ID*1 === comment.ed_user_account_id*1)
                          });
                     });
                     setPostsWithComments({
                        post_information:Dt.post_information,
                        post_files:Dt.post_files,
                        post_comments:CommentsBox
                     },ind);
                   }else{ 
                     console.log(err)
                     console.log("Empty posts *8 😋");
                     output = [];
                     ReturnData();
                   }
               }); 
             });
         }
      } 


   const setOutputPosts = (rows) => {   
        rows.map((PT, ind)=>{    
           const query3 =  `SELECT * FROM eduall_files WHERE  ed_file_code  =  ?`; 
           DATABASE.query(query3, [PT.post_code] , (err, postFiles)=>{  
            
             
            console.log("here  are the post files  **********************");
            console.log(postFiles.length);

            if(!err){ 
                  let files = [];
                  postFiles.map((file, fileIndex)=>{ 
                     files.push({ file_source:file.ed_file_name, file_code:file.ed_file_code});  
                  });

                  setPostWithFiles({
                     post_information:PT,
                     post_files:files,
                  }, ind);  
              
            }else{
               console.log(err)
               console.log("Empty posts *7 😋");
               output = [];
               ReturnData();
            }
         }); 
        });   
     }

      const PushData = (data, index, total)=>{ 
         DataList.push(data);
         if(index === total-1){  
             let newDataPost = [];
             DataList.map((item, index)=>{
                 item.map((it)=>{
                   newDataPost.push(it);
                 })
             });
             setOutputPosts(newDataPost);
         }
      }


      let query2 = `SELECT * FROM  eduall_posts WHERE ed_post_user = ? AND ed_post_deleted = 0`; 
      DATABASE.query(query2, [code] , (err, posts)=>{ 
         
          if(!err) {
            let UserPosts = [];
            posts.map((post, ind)=>{
               let SinglePost = {
                   post_description:post.ed_post_description,
                   post_date:post.ed_post_registerdate,
                   post_code:post.ed_post_code,
                   post_id:post.ed_post_id,
                   post_user:user
               } 
               UserPosts.push(SinglePost); 
            }); 
            PushData(UserPosts, index, total);
         }else{
            console.log(err)
            console.log("Empty posts *3 😋");
            output = []
            ReturnData()
         }
     });
   }


   DATABASE.query(query, [ID] , (err, data)=>{  
      
    if(!err){
       if(data.length >= 1){
         
         console.log("here  are the  user posts  **********************");
         console.log(data.length);

          data.map((item, index)=>{
             let  post_user_information ={
                 post_user_name:item.ed_user_account_name,
                 post_user_code:item.ed_user_account_id,
                 post_user_picture:item.ed_user_account_picture
              } 
            GetEachUserPosts(item.ed_user_account_id, index, data.length, post_user_information) 
        });
       }else{
         console.log("Empty posts *2 😋");
         output = []
         ReturnData()
       }
    }else{
      console.log("Empty posts *1 😋");
      output = [];
      ReturnData()
    }
  });
 }
    /** ends here */ 
   GetData();  




  const ReturnData = ()=>{  
      console.log("---------------------------------------------*****");
      console.log("Well done bro");
      console.log("---------------------------------------------*****");
      res.status(200).json(output) 
  }



}



const GetCurrentUserPosts = async(req, res)=>{ 
   const  query = `
   SELECT POSTS.*,
   
   GROUP_CONCAT(FILES.ed_file_name) post_files, 
   GROUP_CONCAT(USERS.ed_user_account_picture) ed_post_user_picture,
   GROUP_CONCAT(USERS.	ed_user_account_name) ed_post_user_name
   FROM eduall_posts AS POSTS LEFT JOIN eduall_files AS FILES 
   ON (POSTS.ed_post_code = FILES.ed_file_code) 
   LEFT JOIN eduall_user_accounts AS USERS ON (POSTS.ed_post_user = USERS.ed_user_account_id)
   WHERE POSTS.ed_post_user = ?
   GROUP BY POSTS.ed_post_registerdate DESC `; 
   const PARAMS = [req.params.ID];
   DATABASERUN(res, query , PARAMS, 0);
}


module.exports = {GetPostsForCurrentUser, RegisterPublication, GetUserPostsByContacts, GetCurrentUserPosts};