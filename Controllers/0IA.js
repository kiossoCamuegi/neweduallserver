 
const axios = require("axios"); 
const ExecuteQuery = require("../Functions/ExecuteQuery");
const GEMINI_API_KEY = "AIzaSyCW-uNqo1cxd1twpu_cUfSAnen1DrDYcDw";
const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent';
 

const GeminiIA = async (req, res) => {
  try {
    const userMessage = req.body.message;
    const userId = req.session.user.eduall_user_session_ID; 
    const instituteCode = req.session.user.eduall_user_session_curentinstitute;

    // Buscar o histórico da conversa do usuário
    const historyQuery = `
      SELECT ed_ai_chat_message AS message, ed_ai_chat_reply AS reply
      FROM eduall_ai_chat_conversations
      WHERE ed_ai_chat_user_id = ?  
      ORDER BY ed_ai_chat_id DESC
      LIMIT 10
    `;
    const historyParams = [userId];

    const historyResult = await ExecuteQuery(res, historyQuery, historyParams, true, {
      db: "eduall_ai_chat_conversations",
      type: "select",
      data: req,
    });
 
    const messages = [];
 
    messages.push({
      role: "system",
      text: "Você é um assistente especializado em educação. Responda apenas com conteúdo relacionado a educação, sem sair desse tema."
    });

    if (Array.isArray(historyResult)) {
      historyResult.reverse().forEach(item => {
        messages.push({ role: "user", text: item.message });
        messages.push({ role: "model", text: item.reply });
      });
    }
 
    messages.push({ role: "user", text: userMessage });
 
    const response = await axios.post(
      `${GEMINI_API_URL}?key=${GEMINI_API_KEY}`,
      {
        contents: [
          {
            parts: messages.map(m => ({ text: m.text })),
            role: "user"
          }
        ]
      }
    );

    const reply = response.data.candidates?.[0]?.content?.parts?.[0]?.text || 'Sem resposta no momento.';

    // Registrar a nova mensagem e resposta
    const insertQuery = `
      INSERT INTO eduall_ai_chat_conversations 
        (ed_ai_chat_user_id, ed_ai_chat_message, ed_ai_chat_reply) 
      VALUES (?, ?, ?)
    `;
    const insertParams = [userId, userMessage, reply];

    await ExecuteQuery(res, insertQuery, insertParams, false, {
      db: "eduall_ai_chat_conversations",
      type: "insert",
      data: req,
    });

    res.status(200).json({ success: true, reply });
  } catch (error) {
    console.error(error.response?.data || error.message);
    res.status(500).json({ success: false, error: 'Erro ao processar a resposta da IA' });
  }
};



const GetIAConversations = async (req, res) => {
  try {
    const userId = req.session.user.eduall_user_session_ID; 

    const query = `SELECT * FROM eduall_ai_chat_conversations 
      WHERE ed_ai_chat_user_id = ?     ORDER BY ed_ai_chat_created_at ASC`;

    const params = [userId];

    const rows = await ExecuteQuery(res, query, params, true, {
      db: "eduall_ai_chat_conversations",
      type: "select",
      data: req,
    });

    res.status(200).json(rows);
  } catch (error) {
    res.status(500).json({ success: false, message: "Erro ao buscar conversas", error: error.message });
  }
};

module.exports = {
  GeminiIA,
  GetIAConversations
};
