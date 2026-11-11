// CACHE-OPT v6 (aplicado por apply_cache_optimizations_v6.py)
 
const textflow = require("textflow.js");
textflow.useKey("fbd48140f6mshddb243ba3f84633p11ae37jsnb7dba73e009b"); 
const { DATABASE } = require("../config/Database");  
const nodeMailer = require("nodemailer"); 
const ExecuteQuery = require("../Functions/ExecuteQuery");

// CACHE-OPT v6: cache por escola (chaves "<entidade>:<escola>:..."); uma falha de cache nunca parte o pedido
const Cache = require("../Functions/CacheRoutes");
const _cacheGet = async (key) => { try { const v = await Cache.eduallGet(key); return v === undefined ? null : v; } catch (e) { return null; } };
const _cacheSet = async (key, value, ttl) => { try { if (value !== undefined && value !== null) await Cache.eduallSet(key, value, ttl); } catch (e) { /* cache indisponível: ignorado */ } };
const _cacheClear = async (...patterns) => { for (const p of patterns) { try { await Cache.eduallClear(p); } catch (e) { /* ignorado */ } } };
const { MailOptions } = require("../Functions/MailOptions");

const GetAllSentEmailsByUser = async (req, res) => {
   try {
      const query = `SELECT * FROM eduall_sent_emails WHERE ed_sent_email_institutecode = ? AND ed_sent_email_to = ? ORDER BY ed_sent_email_date ASC`;
      const PARAMS = [req.session.user.eduall_user_session_curentinstitute, req.params.EMAIL];
      const rows = await ExecuteQuery(res, query, PARAMS, true, { db: "eduall_requests", type: "select", data: req });
      res.status(200).json(rows);
   } catch (error) {
      return res.status(400).json({ status: 300, success: false, msg: error.message });
   }
};


const GetAllSentEmails = async (req, res) => {
   try {
       const _ck = `sentEmails:${req.session.user.eduall_user_session_curentinstitute}:list`;
       const _hit = await _cacheGet(_ck);
       if (_hit !== null) return res.status(200).json(_hit);
       const emailQuery = `
           SELECT 
               se.ed_sent_email_title AS sent_subject, 
               se.ed_sent_email_message AS sent_message, 
               se.ed_sent_email_code AS sent_code, 
               se.ed_sent_email_sentdate AS sent_date,
               GROUP_CONCAT(
                   JSON_OBJECT(
                       'contact_name', c.ed_contact_name,
                       'contact_sent_email', sec.ed_sent_email_ct_email,
                       'contact_picture', c.ed_contact_picture,
                       'contact_type', c.ed_contact_type,
                       'contact_id', c.ed_contact_id
                   )
               ) AS sent_to
           FROM eduall_sent_emails se
           LEFT JOIN eduall_sent_emails_contacts sec 
               ON se.ed_sent_email_code = sec.ed_sent_email_ct_code
           LEFT JOIN eduall_contacts c 
               ON sec.ed_sent_email_ct_contactid = c.ed_contact_id
           WHERE se.ed_sent_email_institutecode = ?
           GROUP BY se.ed_sent_email_code
           ORDER BY se.ed_sent_email_sentdate DESC;
       `;

       const emailParams = [req.session.user.eduall_user_session_curentinstitute];
       const sentEmails = await ExecuteQuery(res, emailQuery, emailParams, true, { db: "eduall_sent_emails", type: "select", data: req });
 
       sentEmails.forEach(email => {
           email.sent_to = email.sent_to ? JSON.parse(`[${email.sent_to}]`) : [];
       });
 
       await _cacheSet(_ck, sentEmails, 120);
       return res.status(200).json(sentEmails);

   } catch (error) {
       return res.status(500).json({ status: 500, success: false, error: true, msg: error.message });
   }
};



function generateRandomString(length = 10) {
   const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
   let result = '';
   for (let i = 0; i < length; i++) {
       result += chars.charAt(Math.floor(Math.random() * chars.length));
   }
   return result;
}

 
const SendEmailToContacts = async (req, res) => { 
   const { Message,  Title } = req.body; 
   const Code = generateRandomString(700);


   console.log(req.body);
   try {   
      const emailList = JSON.parse(req.body.Emails) 
        if (!emailList || emailList.length === 0) {
            return res.status(400).json({ status: 300, success: false, msg: "Nenhum e-mail foi fornecido!" });
        } 

      const Attachments = req.files || []; // Arquivos anexados

      const query = `SELECT * FROM eduall_institutes 
         LEFT JOIN eduall_institutes_licences ON eduall_institutes_licences.ed_institute_licence_instituteCode = eduall_institutes.ed_institute_code 
         WHERE ed_institute_deleted = 0 AND ed_institute_code = ?`;
      const PARAMS = [req.session.user.eduall_user_session_curentinstitute];

       
      const EmailsValues = emailList.map(item => item.email); 
      const rows = await ExecuteQuery(res, query, PARAMS, true, { db: "eduall_institutes", type: "select", data: req });

      if (rows.length > 0) { 
         async function send() {
            const transporter = nodeMailer.createTransport(MailOptions());

            // Preparar anexos para o email
            const formattedAttachments = Attachments.map(file => ({
               filename: file.originalname,
               content: file.buffer
            }));

            console.log("💛🧡emails para enviar = ", emailList)
            console.log("💛🧡message = ", Message)
            console.log("💛🧡title = ", Title)

            const info = await transporter.sendMail({
               from:"noreply@eduall.site",
               to: EmailsValues,
               subject: Title,
               html: `
                  <!DOCTYPE html>
                  <html lang="pt">
                  <head>
                  <style>
                  .asignature {
                     width: 100%;
                     border-top: 1px solid rgb(177, 177, 177);
                     padding: 10px 0px;
                     margin: 10px 0px;
                     max-width: 650px;
                     font-family: "poppins", sans-serif;
                     padding-top: 20px;
                  }
            
                  .asignature .flex-box {
                     width: 100%;
                     display: flex;
                     justify-content: space-between;
                  }
            
                  .asignature .logo {
                     display: flex;
                     align-items: center;
                     justify-content: center;
                     width: 70px;
                     height: 70px;
                  }
            
                  .asignature .logo img {
                     width: 70px;
                     margin: 0px;
                  }
            
                  .asignature .block-flex {
                     display: flex;
                     margin-top: 6px;
                  }
            
                  .asignature .block-flex h4 {
                     font-size: 13px;
                     margin: 0px;
                  }
            
                  .asignature .block-flex a {
                     font-size: 12px;
                  }
            
                  .asignature .block-flex .text {
                     padding-left: 10px;
                  }
            
                  .asignature .social-icons {
                     display: flex;
                     align-items: center;
                  }
            
                  .asignature .social-icons .icon {
                     width: 25px;
                     height: 25px;
                     border-radius: 100%;
                     margin-right: 10px;
                     margin-top: 10px;
                     background: #6051ff;
                  }
            
                  .asignature .social-icons .icon img {
                     width: 14px;
                     height: 14px;
                     margin: 0px;
                     margin-left: 6px;
                     margin-top: 6px;
                  }
            
                  .asignature .text-block {
                     font-size: 11px;
                     width: 100%;
                     font-weight: 500;
                     max-width: 340px;
                     text-align: right;
                     margin-left: 20px;
                  }
            
                  .asignature .text-block .bar {
                     width: 100%;
                     height: 2px;
                     width: 100%;
                     margin: 4px 0px;
                     background: #6051ff;
                  }
            
                  .asignature .text-block p {
                     margin: 6px 0px !important;
                     font-size: 11px !important;
                  }
            
                  a {
                     color: #6051ff !important;
                  }
            
                  </style>
                  </head>
                  <body>
                  <div style="display:flex;
                     align-items:center;
                     justify-content:space-between;
                     width:100%;
                     max-width:650px;
                     padding:10px 20px; 
                     background:#6051ff;
                     color:#ffff;
                     font-size:12px;
                     margin-bottom:20px;
                     max-height:70px;
                     height:70px;
                     overflow:hidden;
                     font-family:'Poppins', sans-serif;">
                     <div>  
                        <a href="https://eduall.ao" target="_blank" style="max-width:300px;">
                           <img src="https://i.ibb.co/gMnyFhst/eduallbig-white-2.png" style="margin-top:5px;max-height:45px;max-width:300px;"  />
                        </a> 
                     </div>
                     <div style="margin-top:30px;margin-left:45px;" >Software de gestão  para  instituições de ensino !</div>
                  </div>
            
                  <div style="width:100%;max-width:650px; font-family:'Poppins', sans-serif !important;line-height:20px;">
                     <div style="font-size:15px !important;">
                        <b>${rows[0].ed_institute_name}</b>
                     </div> 
                     <span>${rows[0].ed_institute_slogan}</span><br/><br/>
                     <div>${Message}</div>  
                  </div>
            
                  <div class="asignature">
                     <div class="flex-box">
                        <div class="block-flex"> 
                           <div class="text">
                              <h4>Eduall institucional </h4>
                              <a href="mailto:${rows[0].ed_institute_email}">${rows[0].ed_institute_email}</a> 
                           </div>
                        </div>
                        <div class="text-block">
                           <p>${rows[0].ed_institute_state}, ${rows[0].ed_institute_address}</p>
                           <div class="bar"></div>
                           <p>${rows[0].ed_institute_phone1}  |  ${rows[0].ed_institute_phone2}</p>
                        </div>
                     </div>
                  </div>
            
                  </body>
                  </html> 
               `,
               attachments: formattedAttachments // Anexar arquivos
            });
            
         

            if (info) {   
               const query = `INSERT INTO eduall_sent_emails(ed_sent_email_title , ed_sent_email_message, ed_sent_email_code, ed_sent_email_institutecode) VALUES(?,?,?,?)`;
               const PARAMS = [Title, Message, Code, req.session.user.eduall_user_session_curentinstitute];
               await ExecuteQuery(res, query, PARAMS, false, { db: "eduall_sent_emails", type: "insert", data: req });
               await _cacheClear(`sentEmails:${req.session.user.eduall_user_session_curentinstitute}:*`);  // CACHE-OPT v6: novo email enviado -> lista em cache inválida

               for (let i = 0; i < emailList.length; i++) {
                  const email = emailList[i];
                  const query = `INSERT INTO eduall_sent_emails_contacts(ed_sent_email_ct_code, ed_sent_email_ct_email, ed_sent_email_ct_contactid, ed_sent_email_ct_institutecode) VALUES(?,?,?,?)`;
                  const PARAMS = [Code, email.email, email.id, req.session.user.eduall_user_session_curentinstitute];
                  await ExecuteQuery(res, query, PARAMS, false, { db: "eduall_sent_emails_contacts", type: "insert", data: req });

                  if (i === (emailList.length - 1)) {
                     return res.status(200).json({ status: 200, success: true, msg: "Email enviado com sucesso !" });
                  }
               }  
            } else {
               return res.status(400).json({ status: 300, success: false, msg: "Ocorreu um erro ao enviar os emails !" });
            }
         }
         await send();  // CACHE-OPT v6: erros dentro de send() passam a cair no catch (antes: promise sem tratamento)
      } else {
         return res.status(400).json({ status: 300, success: false, msg: "Instituição não encontrada !" });
      }
   } catch (error) {
      console.clear() 
      console.log(req.body, error)
      return res.status(400).json({ status: 300, success: false, error: true, msg: error.message });
   } 
};


 


module.exports = { SendEmailToContacts, GetAllSentEmailsByUser, GetAllSentEmails };


 