const ExecuteQuery = require("../Functions/ExecuteQuery");
const axios = require("axios");

const GetAllSentSmS = async (req, res) => {
    try {
        const query = `SELECT * FROM eduall_sms_records 
        LEFT JOIN  eduall_contacts ON eduall_contacts.ed_contact_id = eduall_sms_records.ed_sms_sent_contactid
        WHERE ed_sms_record_instituteCode = ? ORDER BY ed_sms_sent_date ASC`;
        const PARAMS = [req.session.user.eduall_user_session_curentinstitute];
        const rows = await ExecuteQuery(res, query, PARAMS, true, { db: "eduall_sms_records", type: "select", data: req });
        res.status(200).json(rows);
    } catch (error) {
        return res.status(400).json({ status: 300, success: false, msg: error.message });
    }
};

const GetCreditsmsInformations = async (req, res) => {
    try {
        const query = `SELECT * FROM eduall_sms_credits WHERE ed_sms_credit_institute_code = ?`;
        const PARAMS = [req.session.user.eduall_user_session_curentinstitute];
        const rows = await ExecuteQuery(res, query, PARAMS, true, {db:"eduall_sms_credits", type:"select", data:req});
        res.status(200).json(rows);
    } catch (error) {
        return res.status(400).json({status:300, success:false, msg:error.message});
    }
};

const SendSms = async (req, res) => { 
  const { phone, message, usertype, contact } = req.body;
  try {   
      const calculateSmsParts = (message) => {
      const maxChars = 160;
      const specialCharMaxChars = 70;
      const isSpecialChar = /[^\x00-\x7F]/.test(message);   
      const maxMessageLength = isSpecialChar ? specialCharMaxChars : maxChars; 
      return Math.ceil(message.length / maxMessageLength);   
  };
  
  try { 
      const query3 = `SELECT * FROM eduall_sms_credits WHERE ed_sms_credit_institute_code = ?`;
      const PARAMS3 = [req.session.user.eduall_user_session_curentinstitute]; 
      const rows = await ExecuteQuery(res, query3, PARAMS3, true, { db: "eduall_sms_credits", type: "select", data: req });
  
      if (!rows || rows.length === 0) {
          await RegisterSentMessage(1, message);
          return res.status(400).json({ status: 300, success: false, error: false, msg: "Créditos não encontrados!" });
      }
  
      const currentCredits = rows[0].ed_sms_credit_total * 1; 
      const smsParts = calculateSmsParts(message); 
      if (currentCredits < smsParts) {
          await RegisterSentMessage(1, message);
          return res.status(400).json({ status: 300, success: false, error: false, msg: "Os seus créditos não são suficientes para enviar a mensagem!" });
      }
  
      console.log("📤 Validando número...");
      const numeroFormatado = phone.replace(/\s+/g, ''); 
      const isValido = /^9\d{8}$/.test(numeroFormatado);  
   
      if (!isValido) {
          console.error("⚠️ Número inválido. O número deve começar com 9 e ter 9 dígitos.");
          await RegisterSentMessage(1, message);   
          return res.status(400).json({ status: 300, success: false, error: true, msg: "Número inválido!" });
      }
  
      console.log("📤 Enviando mensagem...");
  
      const message_body = `${message}`;
      const hasLink = /(https?:\/\/[^\s]+)/gi.test(message);
      if (hasLink) {
         return res.status(400).json({ status: 300, success: false, msg: "Não é permitido enviar mensagens com links!" });
      }
  
      const { status, data } = await axios.post("https://www.telcosms.co.ao/send_message", {
          message: { 
              api_key_app:"prdd0cf231ad82fcfa9c4c8654742",  
              phone_number: phone,  
              message_body
          }
      }, { headers: { "Content-Type": "application/json" } });
  
      console.log(" Resposta da API:", data);
   
      if (status === 200 || status === 201) {
          await RegisterAndUpdate(message_body);
          return res.status(200).json({ success: true, msg: "Mensagem enviada com sucesso!" });
      }
  
      console.error("⚠️ Falha ao enviar mensagem. Status:", status);
      await RegisterSentMessage(1, message_body);
      return res.status(400).json({ status: 300, success: false, error: true, msg: "Falha ao enviar a mensagem!" });
  
  } catch (error) {
      console.error("❌ Erro ao enviar mensagem:", error.message);
      await RegisterSentMessage(1, message);
      return res.status(500).json({ success: false, msg: "Erro interno ao enviar a mensagem!" });
  } 
  } catch (error) {
      return res.status(400).json({ status: 300, success: false, error: true, msg: error.message });
  }
 
  async function RegisterAndUpdate(message) {
    try {
        const message_body = `${message}`;
        
        const calculateSmsParts = (message) => {
            const maxChars = 160;
            const specialCharMaxChars = 70;
            const isSpecialChar = /[^\x00-\x7F]/.test(message);
            const maxMessageLength = isSpecialChar ? specialCharMaxChars : maxChars;
            return Math.ceil(message.length / maxMessageLength);
        };

        const smsParts = calculateSmsParts(message_body);
        await RegisterSentMessage(0, message_body);

        const query0 = `UPDATE eduall_sms_credits
                        SET ed_sms_credit_total = ed_sms_credit_total - ? 
                        WHERE ed_sms_credit_institute_code = ? AND ed_sms_credit_total >= ?`;

        const PARAMS0 = [smsParts, req.session.user.eduall_user_session_curentinstitute, smsParts];
        await ExecuteQuery(res, query0, PARAMS0, false, { db: "eduall_sms_credits", type: "update", data: req });
    } catch (error) {
        console.error("Erro ao atualizar créditos:", error.message);
    }
}


 
  async function RegisterSentMessage(status, message) {
      const query = `INSERT INTO eduall_sms_records(ed_sms_record_message, ed_sms_sent_to, ed_sms_record_sent_usertype, 
          ed_sms_sent_contactid, ed_sms_record_status, ed_sms_record_instituteCode) VALUES (?, ?, ?, ?, ?, ?)`;
      const PARAMS = [message, phone, usertype, contact, status, req.session.user.eduall_user_session_curentinstitute];
      await ExecuteQuery(res, query, PARAMS, false, { db: "eduall_sms_records", type: "insert", data: req });
  }
};




const ResendSms = async (req, res) => {
  const { ID } = req.params; 
  const { phone, message } = req.body;

  try { 
      const calculateSmsParts = (message) => {
          const maxChars = 160;
          const specialCharMaxChars = 70;
          const isSpecialChar = /[^\x00-\x7F]/.test(message);  
          const maxMessageLength = isSpecialChar ? specialCharMaxChars : maxChars;  
          return Math.ceil(message.length / maxMessageLength);  
      };

      const hasLink = /(https?:\/\/[^\s]+)/gi.test(message);
        if (hasLink) {
           return res.status(400).json({ status: 300, success: false, msg: "Não é permitido enviar mensagens com links!" });
        }
      const smsParts = calculateSmsParts(message);

      const queryCredits = `SELECT ed_sms_credit_total FROM eduall_sms_credits WHERE ed_sms_credit_institute_code = ?`;
      const paramsCredits = [req.session.user.eduall_user_session_curentinstitute]; 
      const creditRows = await ExecuteQuery(res, queryCredits, paramsCredits, true, { db: "eduall_sms_credits", type: "select", data: req });

      if (!creditRows || creditRows[0].ed_sms_credit_total < smsParts){
          return res.status(400).json({ status: 300, success: false, msg: "Créditos insuficientes para reenviar a mensagem!" });
      }

 
      console.log("📤 Enviando mensagem...");
      const message_body = `${message}`;

      const { status, data } = await axios.post("https://www.telcosms.co.ao/send_message", {
          message: { 
              api_key_app:"prdd0cf231ad82fcfa9c4c8654742",  
              phone_number: phone,  
              message_body
          }
      }, { headers: { "Content-Type": "application/json" } });

      console.log(" Resposta da API:", data);
 
      if (status === 200 || status === 201) {
          await UpdateSentMessage(0, ID);   
          await RegisterAndUpdate(smsParts);   
          return res.status(200).json({ success: true, msg: `Mensagem reenviada com sucesso para ${phone}` });
      }

      console.error("⚠️ Falha ao enviar mensagem. Status:", status);
      await RegisterSentMessage(1, message_body);   
      return res.status(400).json({ status: 300, success: false, error: true, msg: "Falha ao reenviar a mensagem!" });

  } catch (error) {
      console.error("❌ Erro ao reenviar mensagem:", error.message);
      await RegisterSentMessage(1, message); 
      return res.status(500).json({ status: 500, success: false, error: true, msg: "Erro interno ao reenviar a mensagem!" });
  }

  async function RegisterAndUpdate(smsParts) {
    try {
        const query = `UPDATE eduall_sms_credits SET ed_sms_credit_total = ed_sms_credit_total - ? 
                       WHERE ed_sms_credit_institute_code = ? AND ed_sms_credit_total >= ?`;
        const params = [smsParts, req.session.user.eduall_user_session_curentinstitute, smsParts];
        await ExecuteQuery(res, query, params, false, { db: "eduall_sms_credits", type: "update" });
    } catch (error) {
        console.error("Erro ao atualizar créditos:", error.message);
    }
  }

  async function UpdateSentMessage(status, ID) {
    try {
        const query = `UPDATE eduall_sms_records SET ed_sms_record_status = ? 
                       WHERE ed_sms_record_id = ? AND ed_sms_record_instituteCode = ?`;
        const params = [status, ID, req.session.user.eduall_user_session_curentinstitute];
        await ExecuteQuery(res, query, params, false, { db: "eduall_sms_records", type: "update" });
    } catch (error) {
        console.error("Erro ao atualizar status da mensagem:", error.message);
    }
  }

  async function RegisterSentMessage(status, message) {
      const query = `INSERT INTO eduall_sms_records(ed_sms_record_message, ed_sms_sent_to, ed_sms_record_sent_usertype, 
          ed_sms_sent_contactid, ed_sms_record_status, ed_sms_record_instituteCode) VALUES (?, ?, ?, ?, ?, ?)`;
      const PARAMS = [message, phone, usertype, contact, status, req.session.user.eduall_user_session_curentinstitute];
      await ExecuteQuery(res, query, PARAMS, false, { db: "eduall_sms_records", type: "insert", data: req });
  }
};

 
 
 
module.exports = { SendSms, GetAllSentSmS, GetCreditsmsInformations, ResendSms };


 