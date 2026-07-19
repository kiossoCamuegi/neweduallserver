const {LocalStorage} =  require('node-localstorage');
var localStorage = new LocalStorage('./scratch'); 
const { DATABASE } = require("../config/Database");


const UpdateCurrentUserInstitute = async (req, res) => {
  try {
    const { CODE } = req.params;

    if (!CODE) {
      return res.status(400).json({ error: "CODE is required" });
    }
 
    if (!req.session.user) {
      req.session.user = {};
    }
 
    req.session.user.eduall_user_session_curentinstitute = CODE; 
    req.session.save((err) => {
      if (err) {
        console.error(" Error saving session:", err);
        return res.status(500).json({ error: "Failed to save session" });
      }



      console.log("NOVA ESCOLA = ", req.session.user.eduall_user_session_curentinstitute)
      res.status(200).json({ message: "ok", CODE });
    });
  } catch (error) {
    console.error(" Server error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};
  


function GetCurrentUserData(e) {
    const data =  [
        localStorage.getItem("eduall_user_curent"),
        localStorage.getItem("eduall_user_curentinstitute"),
    ];
    return data[e*1];
}


 
const UpdateNetworkMode = async (req, res) => {
  try {
    const { MODE } = req.params;

    if (!MODE) {
      return res.status(400).json({ error: "MODE is required" });
    }

    const normalizedMode = String(MODE).toLowerCase();

    if (normalizedMode !== "online" && normalizedMode !== "offline") {
      return res.status(400).json({
        error: "MODE must be 'online' or 'offline'",
      });
    }

    // Garantir objeto user na sessão
    if (!req.session.user) {
      req.session.user = {};
    }

    // Guarda na sessão (é isto que o ExecuteQuery usa)
    req.session.user.eduall_user_session_network_mode = normalizedMode;

    // Opcional: guardar também em localStorage (para usares fora do req/res)
    localStorage.setItem(
      "eduall_user_session_network_mode",
      normalizedMode
    );

    req.session.save((err) => {
      if (err) {
        console.error(" Error saving session:", err);
        return res.status(500).json({ error: "Failed to save session" });
      }

      console.log(
        "NOVO MODE = ",
        req.session.user.eduall_user_session_network_mode
      );

      res.status(200).json({
        message: "ok",
        mode:req.session.user.eduall_user_session_network_mode,
      });
    });
  } catch (error) {
    console.error(" Server error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};

/**
 * Helper para ler o modo atual fora do contexto do Express (sem req/res),
 * usando o mesmo localStorage que já usas para o utilizador/instituto.
 */
const GetCurrentNetworkMode = async(req,res) =>{
 try {
    res.status(200).json({
        message: "ok",
        mode:req.session.user.eduall_user_session_network_mode,
      });
 } catch (error) {
     console.error(" Server error:", error);
    res.status(500).json({ error: "Internal server error" });
 }
}
 
module.exports =  {GetCurrentUserData, UpdateCurrentUserInstitute, UpdateNetworkMode, GetCurrentNetworkMode };