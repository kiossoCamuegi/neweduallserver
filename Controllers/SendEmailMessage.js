const nodeMailer = require("nodemailer");
const { DB_SQLITE, DATABASE } = require("../config/Database"); 
const { GetCurrentUserData } = require("./GetCurrentUserData");
const CheckInternet = require("../config/CheckInternet");
const { MailOptions } = require("../Functions/MailOptions");
 

 const SendEmailMessage= async(req, res)=>{  
      try { 
        const Email  =  req.body.Email;
        const Message = req.body.Message;
        const Header = req.body.Header;
        const Name = req.body.Name;
        const Title = req.body.Title; 
 

        const transporter = nodeMailer.createTransport(MailOptions());
     
        const info = await transporter.sendMail({
               from:process.env.MAIL_APP_USER,
               to:Email,
               subject:Title, 
               html:`
               <!DOCTYPE html>
                <html lang="pt">
                <head>  
                <style> 


                .asignature {
                  width:100%;
                  border-top:1px solid rgb(177, 177, 177);
                  padding:10px 0px;
                  margin:10px 0px;
                  max-width:550px;
                  font-family:"poppins", sans-serif;
                  padding-top:20px;
            }
    
            .asignature .flex-box{
                 width:100%;
                 display: flex;
                 justify-content: space-between;
            }
    
    
            .asignature .logo{ 
                display: flex;
                align-items: center;
                justify-content: center;  
                width:70px;
                height:70px;
            }
    
            .asignature .logo img{
                width:70px;
                margin:0px;
            }
    
            .asignature .block-flex{
                 display: flex; 
                 margin-top:6px;
            }
    
            .asignature .block-flex h4{
                font-size:13px;
                margin:0px;
            }
    
            .asignature .block-flex a{
                font-size:12px;
            }
            .asignature .block-flex .text{
              padding-left:10px;
        }

        .asignature .social-icons{
            display: flex;
            align-items: center;  
        }

        .asignature .social-icons .icon{
            width:25px;
            height:25px;
            border-radius:100%;
             margin-right:10px;
             margin-top:10px;
            background: #6051ff; 
        } 

        .asignature .social-icons .icon img{
            width:14px;
            height:14px;
            margin:0px;
            margin-left:6px;
            margin-top:6px;
        }

        .asignature .text-block{ 
              font-size:11px;
              width:100%;
              font-weight:500;
              max-width: 340px;
              text-align: right;
              margin-left:20px;
        }

        .asignature .text-block .bar{
              width:100%;
              height:2px;
              width:100%;
              margin:4px 0px;
              background: #6051ff;
        }

        .asignature .text-block p{
            margin:6px 0px !important;
            font-size:11px !important;
        }  

                  a{color:#6051ff !important;}

                </style>
                  
                </head>
                <body>
                <div style="display:flex;
                      align-items:center;
                      justify-content:space-between;
                      width:100%;
                      max-width:550px;
                      padding:10px 20px; 
                      background:#6051ff;
                      color:#ffff;
                      font-size:12px;
                      margin-bottom:20px;
                      max-height:50px;
                      height:70px;
                      overflow:hidden;
                      font-family:'Poppins', sans-serif;">
                      <div>  
                         <a href="https://eduall.vercel.app" target="_blank" style="max-width:300px;">
                            <img src="https://eduall.vercel.app/static/media/logo.2a5d83c764fe68ab60ed.png" style="margin-top:5px;max-height:45px;max-width:300px;"  />
                         <a/> 
                      </div>
                      <div style="margin-top:30px;margin-left:45px;" >Software de Gestão Escolar  para Colégios</div>
                </div>
          
                  <div style="width:100%;max-width:550px; margin-bottom:30px;font-family:'Poppins', sans-serif !important;line-height:20px;">
                    <div style="font-size:15px !important;"><b>${Header}</b></div><br/>
                    <div>${Message}<div>  
                  </div> 

                  <div class="asignature">
                  <div class="flex-box">
                     <div class="block-flex">
                        <div class="logo"><img src="https://eduall.vercel.app/logo-small.png" alt=""></div>
                        <div class="text">
                             <h4>eduall Software.</h4>
                              <a href="mailto:eduall@gmail.com">eduall@gmail.com</a>
                              <div class="social-icons">
                              <a href="https://eduall.vercel.app" target="_blank"> <div class="icon"><img src="https://lh3.googleusercontent.com/drive-viewer/AITFw-w28etTi9iQ71PRzszhzT8o74Ew4qxQUPBDcljgecLz8XTa3zKVluTCV0f3vuSiBYjdYr-cvioLODa4E9EXMXE8CUZn=s2560" alt=""></div></a>
                              <a href="https://www.facebook.com/profile.php?id=61550765183432" target="_blank"><div class="icon"><img src="https://lh3.googleusercontent.com/drive-viewer/AITFw-xkiC17daYRi0FsKk2XWFx43rY5LNp_1XbVUt7LCt3EcXkuP34n3t4rRYV7tORuhalGBJ2daRC0D4lhB9pX5ZV4QYWUHQ=s2560" alt=""></div></a>
                              <a href="https://eduall.vercel.app" target="_blank"><div class="icon"><img src="https://lh3.googleusercontent.com/drive-viewer/AITFw-wcXae80XnlwZQrvttZZTevVV5nL5A9wPE9H6x8HQAVJKGgIqrMA2NSn40qJ2jhy0XUdpkIfCZ0EZFlZpDh3nQ7JQ4LGA=s2560" alt=""></div></a>
                              <a href="https://www.youtube.com/@eduallstartup" target="_blank"><div class="icon"> <img src="https://lh3.googleusercontent.com/drive-viewer/AITFw-yxCKBbVnDg16sgBRTyc3p0JNLfF-WlUbDr8BxjRU3xjkdB-ZZfIv98YP-haX4PDks0Mhrhx7OYbg7Z2t53uYkU3o3QKw=s2560" alt=""></div></a>
                          </div>
                        </div>
                     </div>
                     <div class="text-block">
                          <p>Angola-Luanda | Viana, Bairro Luanda Sul - 4 Campos</p>
                          <div class="bar"></div>
                          <p> +244 925 459 395   |   +244 953 472 705</p>
                     </div>
                  </div>
              </div>
          
                </body>
               </html> ` 
        });


        res.status(200).json("success");  

      } catch (error) {
           res.status(400).json(error); 
           console.log(error);
      }
}

 

module.exports = SendEmailMessage;
 