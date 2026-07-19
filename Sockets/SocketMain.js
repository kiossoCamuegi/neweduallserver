require("./Functions/ChatMessageSocket");
require("./Functions/LessonFeedbacks");
require("./Functions/ContentCommentAndReply");
require("./Functions/ContactMessages");
 
const { joinSocketRooms } = require("../Controllers/Auditory");
const { get } = require("./GetSocketIo");

const io = get(); 

io.on("connection", (socket) => {
  // O cliente deve emitir algo como:
  // socket.emit("join", { user: req.session.user })
  // OU passar apenas os IDs

  socket.on("join", (payload) => {
    // 1) Se tens a sessão no socket (via middleware), ótimo;
    // 2) Caso contrário, usa o payload enviado pelo cliente:
    const sessionUser = payload?.user || {
      eduall_user_session_curentinstitute: payload?.instituteCode,
      eduall_user_session_ID: payload?.userId,
    };

    joinSocketRooms(io, socket, sessionUser);
  });

  socket.on("leave", (payload) => {
    try {
      const inst = payload?.instituteCode;
      const uid = payload?.userId;

      if (inst) socket.leave(`inst:${inst}`);
      if (uid) socket.leave(`user:${uid}`);
    } catch (err) {
      console.error("Erro ao sair das salas:", err);
    }
  });
});
