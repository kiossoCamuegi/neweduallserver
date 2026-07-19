const { GetCurrentUserData } = require('../../Controllers/GetCurrentUserData');
const { HTTPApp, SharedSocketSession, SocketCors } = require('../../app');
const { DATABASE } = require('../../config/Database');
const socketIO = require('socket.io')(HTTPApp, SocketCors);
 

socketIO.use(SharedSocketSession);

//Add this before the app.get() block
socketIO.on('connection', (socket) => {
  console.log(`⚡: ${socket.id} user just connected !!! `); 
  socket.request.session.reload(function () {})


  const GetData = (e)=>{
    console.log(e);
    socketIO.emit("eduall_response_lesson_reviews", e);
  }

  //send review
   socket.on("eduall_send_lesson_reviewIo", (data)=>{
        socket.request.session.reload(function(err) {});  
         const user  = socket.request.session.user;
 

          if(user && user !== undefined &&  user !== null){ 
            try {
                const  query = `INSERT INTO eduall_lesson_reviews (ed_lesson_review_lessonId, ed_lesson_review_text, ed_lesson_review_stars, ed_lesson_review_user) VALUES(?,?,?,?)`;
                const params = [data.fd_lesson_id , data.fd_lesson_text, data.fd_lesson_stars, user.eduall_user_session_ID];            
                 DATABASE.query(query, params, (err, res, fields)=>{
                      if(!err){ 
                        DATABASE.query(`SELECT * FROM eduall_lesson_reviews LEFT JOIN eduall_user_accounts ON 
                        ed_lesson_review_user = eduall_user_accounts.ed_user_account_id  WHERE  ed_lesson_review_id = ?`,
                        [res.insertId], (err, rows)=>{ 
                            if(err) GetData({error:true, data:null, user:0}); 
                            GetData({data:rows[0], user:user.eduall_user_session_ID});   
                         }); 
                     }else{
                        GetData({error:true, data:null, user:0});
                     } 
                });  
             } catch (error) {
                  console.log(error)
                  GetData({error:true, data:null, user:0});
             }
          }else{
               console.log("lesson is empty ");
               console.log(user);
               GetData({error:true, data:null, user:0});
          } 
   });


  socket.on('disconnect', () => {
    console.log('🔥: A user disconnected');
  });
});

 