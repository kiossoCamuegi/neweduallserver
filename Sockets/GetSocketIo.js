/**
 * Referência partilhada ao servidor Socket.IO.
 *
 * IMPORTANTE: o app.js já cria o servidor Socket.IO. Este módulo NÃO deve
 * criar um segundo servidor no mesmo HTTP server (isso fazia o processo
 * rebentar com "handleUpgrade() was called more than once").
 *
 * init(server):
 *  - se receber um Socket.IO Server (caso do app.js) → reutiliza-o;
 *  - se receber um HTTP server → cria um novo Socket.IO Server.
 */
let io = null;
let roomHandlerRegisteredOn = null;

function registerRoomJoinHandler(server) {
  if (!server || roomHandlerRegisteredOn === server) return;

  server.on("connection", (socket) => {
    const { userId, instituteCode } = socket.handshake.auth || {};
    if (instituteCode) socket.join(`inst:${instituteCode}`);
    if (userId) socket.join(`user:${userId}`);

    socket.on("join", (payload = {}) => {
      const inst = payload.instituteCode;
      const uid = payload.userId;
      if (inst) socket.join(`inst:${inst}`);
      if (uid) socket.join(`user:${uid}`);
    });

    socket.on("leave", (payload = {}) => {
      try {
        const inst = payload.instituteCode;
        const uid = payload.userId;
        if (inst) socket.leave(`inst:${inst}`);
        if (uid) socket.leave(`user:${uid}`);
      } catch (err) {
        console.error("Erro ao sair das salas:", err.message);
      }
    });
  });

  roomHandlerRegisteredOn = server;
}

function init(server) {
  if (!server) return null;

  // Já é um Socket.IO Server (app.js passa o `io` criado lá).
  const isSocketServer =
    typeof server.to === "function" &&
    typeof server.of === "function" &&
    !!server.sockets;

  if (isSocketServer) {
    io = server;
  } else {
    const { Server } = require("socket.io");
    io = new Server(server, {
      cors: { origin: true, credentials: true },
    });
  }

  registerRoomJoinHandler(io);
  return io;
}

function get() {
  return io;
}

// Nunca lança: se ainda não houver init, devolve um emissor vazio.
function to(room) {
  return io ? io.to(room) : { emit: () => {} };
}

function emitTo(room, event, payload) {
  if (io) io.to(room).emit(event, payload);
}

module.exports = { init, get, to, emitTo };
