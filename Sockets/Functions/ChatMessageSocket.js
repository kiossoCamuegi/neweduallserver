const { GetCurrentUserData } = require('../../Controllers/GetCurrentUserData');
const { HTTPApp, SharedSocketSession, SocketCors } = require('../../app');
const { DATABASE } = require('../../config/Database');
const socketIO = require('socket.io')(HTTPApp, SocketCors);
 

socketIO.use(SharedSocketSession);

//Add this before the app.get() block
socketIO.on('connection', (socket) => {
  console.log(`⚡: ${socket.id} user just connected !!! `); 
  socket.request.session.reload(function () {})




  const GetMessage = (e)=>{
    socketIO.emit("eduall_reponse_chat_messageIo", e);
  }

  //send chat message
   socket.on("eduall_send_chat_messageIo", (data)=>{
        socket.request.session.reload(function(err) {});  
         const user  = socket.request.session.user;

         console.log("----------------------------***");
         console.log(user);
         console.log("----------------------------***");

          if(user && user !== undefined &&  user !== null){ 
            try {
                const  query = `INSERT INTO eduall_chat_messages (ed_chat_message_code, ed_chat_message_from, ed_chat_message_to,
                ed_chat_message_group_code, ed_chat_message_content, ed_chat_message_gif) VALUES(?,?,?,?,?,?)`;
                const params = [data.chat_msg_code , user.eduall_user_session_ID , data.chat_msg_to, data.chat_msg_group_code, data.chat_msg_content, data.chat_msg_gif];            
                 DATABASE.query(query, params, (err, res, fields)=>{
                      if(!err){ 
                        DATABASE.query(`SELECT * FROM eduall_chat_messages LEFT JOIN eduall_user_accounts ON 
                        ed_chat_message_from = eduall_user_accounts.ed_user_account_id  WHERE ed_chat_message_from = ? AND ed_chat_message_id  =  ?`,
                        [user.eduall_user_session_ID, res.insertId], (err, rows)=>{  
                            if(err) GetMessage({error:true, message:null, user:0});
                            console.log(rows[0]);
                            GetMessage({message:rows[0], user:user.eduall_user_session_ID});   
                         }); 
                     }else{
                        GetMessage({error:true, message:null, user:0});
                     }
                });  
             } catch (error) {
                  console.log(error)
                  GetMessage({error:true, message:null, user:0});
             }
          }else{
               console.log("User is empty ");
               console.log(user);
               GetMessage({error:true, message:null, user:0});
          } 
   });


  socket.on('disconnect', () => {
    console.log('🔥: A user disconnected');
  });
});

 