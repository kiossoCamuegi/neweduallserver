const express = require("express"); 
const router = express.Router();
const passport = require("passport");
const { DATABASE } = require("../config/Database");
const jwt   = require("jsonwebtoken");
require("../Controllers/UsersSocialAuth");
const URL = process.env.APP_CLIENT_URL; 

function isLoggedIn(req, res, next){
     req.user ? next() : res.sendStatus(401);
}


/* Google */

router.get("/eduallgoogleuserauthentication/signin", 
passport.authenticate("google_signin",{
     scope: ["email","profile"]
}));



router.get("/eduallgoogleuserauthentication/signup", 
passport.authenticate("google_signup",{
     scope: ["email","profile"]
}));

router.get("/login/success", (req, res)=>{
   if(req.user){
        res.status(200).json({
             sucess:true,
             message:"successfull",
             user:req.user,
        });
   }
});

router.get("/auth/googlesignin/callback",
 passport.authenticate("google_signin", {
      successRedirect:"/eduallgoogleauthentication/signin",
      failureRedirect:"/auth/failure"
}));


router.get("/auth/googlesignup/callback",
 passport.authenticate("google_signup", {
      successRedirect:"/eduallgoogleauthentication/signup",
      failureRedirect:"/auth/failure"
}));


router.get("/auth/failure", (req, res)=>{ 
     return res.redirect(URL+"autherror");
});

const UPDATETOKEN  = async(refreshToken , cr_usercode)=>{
     const  query = `UPDATE eduall_user_accounts SET ed_usertoken = ?  WHERE ed_user_account_deleted = 0 AND ed_user_account_id = ?`;
     const PARAMS =  [refreshToken  , cr_usercode]; 
     DATABASE.query(query, PARAMS, (err)=>{ 
        if(err)  return false;
        return true;
     }); 
 }
  

router.get("/eduallgoogleauthentication/signin", isLoggedIn,  (req, res)=>{ 
     console.log(req.user.emails[0].value);
     const  query = `SELECT * FROM eduall_user_accounts WHERE ed_user_account_deleted = 0 AND  ed_user_account_email = ?  `;
     DATABASE.query(query, [req.user.emails[0].value], (err, user)=>{ 
         if(err) return res.redirect(URL+"autherror"); ///return res.json(err); 
         if(!user[0]) return res.redirect(URL+"autherror"); //return res.status(400).json({msg:"Credenciais invalidas 0"});   
             const cr_usercode = user[0].ed_user_account_id;
             const cr_code = user[0].ed_user_account_code;
             const cr_username = user[0].ed_user_account_name;
             const cr_useremail = user[0].ed_user_account_email; 
             
             const accessToken = jwt.sign({cr_usercode, cr_username, cr_useremail},
             process.env.ACCESS_TOKEN_SECRET,{
                 expiresIn:'20s'
             }); 
     
             const refreshToken = jwt.sign({cr_usercode, cr_code, cr_username, cr_useremail},
             process.env.REFRESH_TOKEN_SECRET,{
                 expiresIn:'1d'
             }); 

             if(UPDATETOKEN(refreshToken , cr_usercode)){
                 res.cookie('refreshToken', refreshToken,{
                     httpOnly:true,
                     maxAge:24 * 60 * 60 * 1000
                 }); 
    
                 const  query5 = `INSERT INTO eduall_login_registers(ed_log_user, ed_log_zone, ed_log_type) VALUES(?,?,?)`;
                 const PARAMS5 = [cr_usercode, 2, "google"];
                 DATABASE.query(query5, PARAMS5 , (err, user)=>{ 
                     if(err) return res.redirect(URL+"autherror"); /// return res.json(err);  
                     req.session.user.eduall_user_session_refreshToken = refreshToken;   
                     req.session.user.eduall_user_session_ID = cr_usercode;

                      res.redirect(URL+"newsfeed");
                 });
             }else{
               return res.redirect(URL+"autherror"); ///res.status(400).json({msg:"Credenciais invalidas 1"});   
             } 
     });  
    
});


router.get("/eduallgoogleauthentication/signup", async(req, res)=>{
       if(req.user){
          const ed_user_email =  req.user.emails[0].value
          const  query = `INSERT INTO eduall_user_accounts(ed_user_account_name ,  ed_user_account_email, ed_user_account_status,ed_user_account_code, ed_user_account_auth) VALUES(?,?,?,?,?)`; 
          const PARAMS = [req.user.displayName , ed_user_email, 1, req.user.id, "google"];   
     
           const RandomAvatarColor = ()=>{
               let colors =  ["#A2D2FF", "#CDB4DB", "#FB5607", "#FF006E", "#8D99AE", "#57CC99",
               "#22577A", "#80ED99", "#E29578", "#E56B6F", "#A663CC", "#FF9E00", "#F9C74F"];
               let x = (Math.floor(Math.random() * colors.length) + 0);
               return colors[x];
            }  

               const emailRegexp = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;
               if(emailRegexp.test(ed_user_email)){  
                    const  query2 = `SELECT * FROM eduall_user_accounts WHERE ed_user_account_deleted = 0 AND ed_user_account_email = ?  `;
                    DATABASE.query(query2, [ed_user_email], (err, rows)=>{ 
                         if(err) return res.redirect(URL+"autherror"); ///return res.status(300).json({msg:"Não foi possível concluir a operação neste momento !"});
                         if(rows.length >= 1) return res.redirect(URL+"autherror"); /// return res.status(300).json({msg:"Este email já esta a ser utilizado !"});
                         RegisterData();
                    });
               }else{
                    return res.redirect(URL+"autherror");/// return res.status(300).json({msg:"O email inserido não foi validado !"});
               }
          const RegisterData = ()=>{
               DATABASE.query(query, PARAMS, (err)=>{ 
               if(err) return res.redirect(URL+"autherror"); ///return res.status(500).json({msg:"Não foi possível concluir a operação neste momento !"});  
               try {
                    const  query2 = `SELECT * FROM eduall_user_accounts WHERE ed_user_account_deleted = 0 AND ed_user_account_email = ?  `;
                    DATABASE.query(query2, [ed_user_email], (err, rows)=>{ 
                         if(err) return res.redirect(URL+"autherror"); ///return res.status(300).json({msg:"Não foi possível concluir a operação neste momento !"});
                         if(rows.length >= 1){ 
                              const  query3 = `INSERT INTO eduall_user_account_details(ed_user_account_detUSERID, ed_user_account_detAvatarColor) VALUES(?,?)`; 
                              DATABASE.query(query3, [rows[0].ed_user_account_id, RandomAvatarColor()] , (err)=>{ 
                              if(err) {
                                   const  query3 = `DELETE FROM eduall_user_accounts WHERE ed_user_account_id = ?`; 
                                   DATABASE.query(query3, [rows[0].ed_user_account_id] , (err)=>{ 
                                        if(err) return res.redirect(URL+"autherror"); ///return res.status(500).json({msg:"Não foi possível concluir a operação neste momento !"});  
                                        return res.redirect(URL+"autherror"); ///return res.status(500).json({msg:"Não foi possível concluir a operação neste momento !"});  
                                   });
                              }  
                              return res.redirect(URL+"");
                         });
                         }else{ 
                              return res.redirect(URL+"autherror"); ///return res.status(500).json({msg:"Não foi possível concluir a operação neste momento !"});   
                    }
                    });  
               } catch (error) {
                    return res.redirect(URL+"autherror"); /// return res.status(500).json({msg:"Não foi possível concluir a operação neste momento !"});  
               }
          });
          } 
        
       }else{
          return res.redirect(URL+"autherror"); ///return res.status(500).json({msg:"Não foi possível concluir a operação neste momento !"});  
       }
});





/***Facebook */


router.get("/eduallfacebookuserauthentication/signin", 
passport.authenticate("facebook",{
     scope: ["email","profile"]
}));



router.get("/auth/facebook/callback",
 passport.authenticate("facebook", {
      successRedirect:"/eduallfacebookauthentication/signin",
      failureRedirect:"/auth/failure"
}));


router.get("/eduallfacebookauthentication/signin", isLoggedIn,  (req, res)=>{ 
     console.log(req.user.emails[0].value);
     const  query = `SELECT * FROM eduall_user_accounts WHERE ed_user_account_deleted = 0 AND  ed_user_account_email = ?  `;
     DATABASE.query(query, [req.user.emails[0].value], (err, user)=>{ 
         if(err) return res.redirect(URL+"autherror"); ///return res.json(err); 
         if(!user[0]) return res.redirect(URL+"autherror");///return res.status(400).json({msg:"Credenciais invalidas 0"});   
             const cr_usercode = user[0].ed_user_account_id;
             const cr_code = user[0].ed_user_account_code;
             const cr_username = user[0].ed_user_account_name;
             const cr_useremail = user[0].ed_user_account_email; 
             
             const accessToken = jwt.sign({cr_usercode, cr_username, cr_useremail},
             process.env.ACCESS_TOKEN_SECRET,{
                 expiresIn:'20s'
             }); 
     
             const refreshToken = jwt.sign({cr_usercode, cr_code, cr_username, cr_useremail},
             process.env.REFRESH_TOKEN_SECRET,{
                 expiresIn:'1d'
             }); 

             if(UPDATETOKEN(refreshToken , cr_usercode)){
                 res.cookie('refreshToken', refreshToken,{
                     httpOnly:true,
                     maxAge:24 * 60 * 60 * 1000
                 }); 

                 
                         
                 const  query5 = `INSERT INTO eduall_login_registers(ed_log_user, ed_log_zone, ed_log_type) VALUES(?,?,?)`;
                 const PARAMS5 = [cr_usercode, 2, "facebook"];
                 DATABASE.query(query5, PARAMS5 , (err, user)=>{ 
                     if(err) return res.redirect(URL+"autherror"); 
                     req.session.user.eduall_user_session_refreshToken = refreshToken;   
                      req.session.user.eduall_user_session_ID = cr_usercode;
                     return res.redirect(URL+"newsfeed");
                 });

                  
             }else{
               return res.redirect(URL+"autherror");
               ///res.status(400).json({msg:"Credenciais invalidas 1"});   
             } 
     });  
    
});


router.get("/eduallfacebookauthentication/signup", isLoggedIn,  (req, res)=>{ 
     console.log(req.user);
     if(req.user){
          const ed_user_email =  req.user.emails[0].value
          const  query = `INSERT INTO eduall_user_accounts(ed_user_account_name ,  ed_user_account_email, ed_user_account_status,ed_user_account_code, ed_user_account_auth) VALUES(?,?,?,?,?)`; 
          const PARAMS = [req.user.displayName , ed_user_email, 1, req.user.id, "facebook"]; 
          const registerUserAcccount = async()=>{
               const ed_user_email =  req.user.emails[0].value
               const  query = `INSERT INTO eduall_user_accounts(ed_user_account_name ,  ed_user_account_email, ed_user_account_status) VALUES(?,?,?)`; 
               const PARAMS = [req.user.displayName , ed_user_email, 1];   
          
               const RandomAvatarColor = ()=>{
                    let colors =  ["#A2D2FF", "#CDB4DB", "#FB5607", "#FF006E", "#8D99AE", "#57CC99",
                    "#22577A", "#80ED99", "#E29578", "#E56B6F", "#A663CC", "#FF9E00", "#F9C74F"];
                    let x = (Math.floor(Math.random() * colors.length) + 0);
                    return colors[x];
               }  
     
                    const emailRegexp = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;
                    if(emailRegexp.test(ed_user_email)){  
                         const  query2 = `SELECT * FROM eduall_user_accounts WHERE ed_user_account_deleted = 0 AND ed_user_account_email = ?  `;
                         DATABASE.query(query2, [ed_user_email], (err, rows)=>{ 
                              if(err) return res.status(300).json({msg:"Não foi possível concluir a operação neste momento !"});
                              if(rows.length >= 1) return res.status(300).json({msg:"Este email já esta a ser utilizado !"});
                              RegisterData();
                         });
                    }else{
                         return res.status(300).json({msg:"O email inserido não foi validado !"});
                    }
               const RegisterData = ()=>{
                    DATABASE.query(query, PARAMS, (err)=>{ 
                    if(err) return res.status(500).json({msg:"Não foi possível concluir a operação neste momento !"});  
                    try {
                         const  query2 = `SELECT * FROM eduall_user_accounts WHERE ed_user_account_deleted = 0 AND ed_user_account_email = ?  `;
                         DATABASE.query(query2, [ed_user_email], (err, rows)=>{ 
                              if(err) return res.status(300).json({msg:"Não foi possível concluir a operação neste momento !"});
                              if(rows.length >= 1){ 
                                   const  query3 = `INSERT INTO eduall_user_account_details(ed_user_account_detUSERID, ed_user_account_detAvatarColor) VALUES(?,?)`; 
                                   DATABASE.query(query3, [rows[0].ed_user_account_id, RandomAvatarColor()] , (err)=>{ 
                                   if(err) {
                                        const  query3 = `DELETE FROM eduall_user_accounts WHERE ed_user_account_id = ?`; 
                                        DATABASE.query(query3, [rows[0].ed_user_account_id] , (err)=>{ 
                                             if(err) return res.status(500).json({msg:"Não foi possível concluir a operação neste momento !"});  
                                             return res.status(500).json({msg:"Não foi possível concluir a operação neste momento !"});  
                                        });
                                   }  
                                   return res.status(200).json({msg:"Conta criada com sucesso !"});  
                              });
                              }else{ 
                              return res.status(500).json({msg:"Não foi possível concluir a operação neste momento !"});   
                         }
                         });  
                    } catch (error) {
                         return res.status(500).json({msg:"Não foi possível concluir a operação neste momento !"});  
                    }
               });
               } 
          
          } 
          registerUserAcccount();
     }else{
       return res.status(500).json({msg:"Não foi possível concluir a operação neste momento !"});  
     }
      
});







module.exports =  router;
