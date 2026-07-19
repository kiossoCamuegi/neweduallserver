const { GetCurrentUserData } = require('../../Controllers/GetCurrentUserData');
const { HTTPApp, SharedSocketSession, SocketCors } = require('../../app');
const { DATABASE } = require('../../config/Database');
const socketIO = require('socket.io')(HTTPApp, SocketCors);
 

socketIO.use(SharedSocketSession);

//Add this before the app.get() block
socketIO.on('connection', (socket) => {
  console.log(`⚡: ${socket.id} user just connected !!! `); 
  socket.request.session.reload(function () {});
  
  const GetData = (e)=>{socketIO.emit("eduall_response_content_comments", e);}
  const GetData_replie = (e)=>{socketIO.emit("eduall_response_content_commentsreplies", e);}
  const GetData_subreplie = (e)=>{socketIO.emit("eduall_response_content_commentssubreplies", e);}
  const GetData_reaction =  (e)=>{socketIO.emit("eduall_response_content_reactions", e);}

  //send comment
   socket.on("eduall_send_content_commentIo", (data)=>{
        socket.request.session.reload(function(err) {});  
         const user  = socket.request.session.user; 

          if(user && user !== undefined &&  user !== null){ 
            try {
                const  query = `INSERT INTO eduall_comments 
                (ed_comment_gif, ed_comment_image, ed_comment_text, ed_comment_contentID, ed_comment_contentType, ed_comment_user) VALUES(?,?,?,?,?,?)`;
                const params = [data.comment_gif , data.comment_image, data.comment_text, data.comment_contentid, data.comment_type,  user.eduall_user_session_ID];            
                 DATABASE.query(query, params, (err, res, fields)=>{
                      if(!err){ 
                        DATABASE.query(`SELECT * FROM eduall_comments LEFT JOIN eduall_user_accounts ON 
                        eduall_comments.ed_comment_user = eduall_user_accounts.ed_user_account_id  WHERE  eduall_comments.ed_comment_id = ?`,
                        [res.insertId], (err, rows)=>{ 
                            if(err) GetData({error:true, data:null, user:0}); 
                             console.log("printing data ....")
                             console.log(rows); 
                            GetData({data:rows[0], user:user.eduall_user_session_ID});   
                         }); 
                     }else{
                         console.log(err);
                        GetData({error:true, data:null, user:0});
                     } 
                });  
             } catch (error) {
                  console.log(error)
                  GetData({error:true, data:null, user:0});
             }
          }else{
               console.log("comment is empty !!!");
               console.log(user);
               GetData({error:true, data:null, user:0});
          } 
   });



  //send comment replie
  socket.on("eduall_send_content_commentrepliesIo", (data)=>{
     socket.request.session.reload(function(err) {});  
      const user  = socket.request.session.user; 

       if(user && user !== undefined &&  user !== null){ 
         try {
             const  query = `INSERT INTO eduall_comments_replies 
             (ed_comment_replie_gif, ed_comment_replie_image, ed_comment_replie_text, ed_comment_replie_commentID,  ed_comment_replie_user) VALUES(?,?,?,?,?)`;
             const params = [data.comment_gif , data.comment_image, data.comment_text, data.comment_contentid,   user.eduall_user_session_ID];            
              DATABASE.query(query, params, (err, res, fields)=>{
                   if(!err){ 
                     DATABASE.query(`SELECT * FROM eduall_comments_replies LEFT JOIN eduall_user_accounts ON 
                     ed_comment_replie_user = eduall_user_accounts.ed_user_account_id  WHERE  ed_comment_replie_id = ?`,
                     [res.insertId], (err, rows)=>{ 
                         if(err) GetData_replie({error:true, data:null, user:0});  
                         GetData_replie({data:rows[0], user:user.eduall_user_session_ID});   
                      }); 
                  }else{
                     GetData_replie({error:true, data:null, user:0});
                  } 
             });  
          } catch (error) {
               console.log(error)
               GetData_replie({error:true, data:null, user:0});
          }
       }else{
            console.log("replie is empty !!!");
            console.log(user);
            GetData_replie({error:true, data:null, user:0});
       } 
});


  //send comment sub-replie
  socket.on("eduall_send_content_commentsubrepliesIo", (data)=>{
     socket.request.session.reload(function(err) {});  
      const user  = socket.request.session.user; 

       if(user && user !== undefined &&  user !== null){ 
         try {
             const  query = `INSERT INTO eduall_comments_subreplies 
             (ed_comment_subreplie_gif, ed_comment_subreplie_image, ed_comment_subreplie_text, ed_comment_subreplie_replieID, ed_comment_subreplie_user) VALUES(?,?,?,?,?)`;
             const params = [data.comment_gif , data.comment_image, data.comment_text, data.comment_contentid,   user.eduall_user_session_ID];            
              DATABASE.query(query, params, (err, res, fields)=>{
                   if(!err){ 
                     DATABASE.query(`SELECT * FROM eduall_comments_subreplies LEFT JOIN eduall_user_accounts ON 
                     ed_comment_subreplie_user = eduall_user_accounts.ed_user_account_id  WHERE  ed_comment_subreplie_id = ?`,
                     [res.insertId], (err, rows)=>{ 
                         if(err) GetData_subreplie({error:true, data:null, user:0}); 
                         console.log(err)
                         console.log(rows);
                         GetData_subreplie({data:rows[0], user:user.eduall_user_session_ID});   
                      }); 
                  }else{
                    console.log(err)
                    GetData_subreplie({error:true, data:null, user:0});
                  } 
             });  
          } catch (error) {
               console.log(error)
               GetData_subreplie({error:true, data:null, user:0});
          }
       }else{
            console.log("subreplie is empty !!!");
            console.log(user);
            GetData_subreplie({error:true, data:null, user:0});
       } 
});



  //send comment reaction
  socket.on("eduall_send_content_commentreactionIo", (data)=>{
     socket.request.session.reload(function(err) {});  
      const user  = socket.request.session.user;  
       if(user && user !== undefined &&  user !== null){ 
         try { 
          console.log("searching for reaction ....");
          DATABASE.query(`SELECT * FROM eduall_comment_reactions LEFT JOIN eduall_user_accounts ON 
          ed_comment_reaction_user = eduall_user_accounts.ed_user_account_id  WHERE  ed_comment_reaction_contentID  = ?
           AND ed_comment_reaction_contentType = ?  AND ed_comment_reaction_user = ?`,
          [data.reaction_contentid, data.reaction_contenttype,  user.eduall_user_session_ID], (err, rows)=>{ 
              if(err) GetData_subreplie({error:true, data:null, user:0}); 
              if(rows.length >= 1){
               console.log("Reaction already exist let update for you bro 👩‍🦰👩‍🦱👨‍🦱"); 
               const  query = `UPDATE eduall_comment_reactions SET ed_comment_reaction_type = ?  WHERE ed_comment_reaction_id = ?`;
               DATABASE.query(query, [data.reaction_type, rows[0].ed_comment_reaction_id],  (err, res, fields)=>{
                   if(err) GetData_reaction({error:true, data:null, user:0}); 
                   console.log(err)
                   console.log(rows[0]);
                   GetData_reaction({data:rows[0], user:user.eduall_user_session_ID});   
                });  
              }else{ 
               const  query = `INSERT INTO eduall_comment_reactions 
               (ed_comment_reaction_type, ed_comment_reaction_contentType, ed_comment_reaction_contentID, ed_comment_reaction_user) VALUES(?,?,?,?)`;
               const params = [data.reaction_type , data.reaction_contenttype,  data.reaction_contentid,   user.eduall_user_session_ID];            
                DATABASE.query(query, params, (err, res, fields)=>{
                     if(!err){ 
                       DATABASE.query(`SELECT * FROM eduall_comment_reactions LEFT JOIN eduall_user_accounts ON 
                       ed_comment_reaction_user = eduall_user_accounts.ed_user_account_id  WHERE  ed_comment_reaction_id  = ?`,
                       [res.insertId], (err, rows)=>{ 
                           if(err) GetData_reaction({error:true, data:null, user:0}); 
                           console.log(err)
                           console.log(rows);
                           GetData_reaction({data:rows[0], user:user.eduall_user_session_ID});   
                        }); 
                    }else{
                      console.log(err)
                      GetData_reaction({error:true, data:null, user:0});
                    } 
               });  
              }  
           }); 
          } catch (error) {
               console.log(error)
               GetData_reaction({error:true, data:null, user:0});
          }
       }else{
            console.log("subreplie is empty !!!");
            console.log(user);
            GetData_reaction({error:true, data:null, user:0});
       } 
});





 
});

 