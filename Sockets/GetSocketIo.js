const { HTTPApp, SharedSocketSession, SocketCors } = require('../app');
const SOCKET_IO = require('socket.io')(HTTPApp, SocketCors);

 
let io;
module.exports = {
  init(server) {
    const { Server } = require("socket.io");
    io = new Server(server, {
      cors: { origin: true, credentials: true }
    });
    io.on("connection", (socket) => {
      const { userId, instituteCode } = socket.handshake.auth || {};
      if (instituteCode) socket.join(`inst:${instituteCode}`);
      if (userId) socket.join(`user:${userId}`);
      socket.on("join", ({ userId, instituteCode }) => {
        if (instituteCode) socket.join(`inst:${instituteCode}`);
        if (userId) socket.join(`user:${userId}`);
      });
      socket.on("leave", ({ userId, instituteCode }) => {
        if (instituteCode) socket.leave(`inst:${instituteCode}`);
        if (userId) socket.leave(`user:${userId}`);
      });
    });
    return io;
  },
  get() { return io; },
  to(room) { return io.to(room); },
  emitTo(room, event, data) { return io.to(room).emit(event, data); },
  SOCKET_IO
};
