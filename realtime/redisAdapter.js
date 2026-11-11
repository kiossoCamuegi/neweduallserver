"use strict";

const path = require("path");
const { createRequire } = require("module");
const { resolveRedisConnection } = require("./redisConfiguration");

const moderationRequire = createRequire(
  path.resolve(__dirname, "../moderation/package.json")
);

function redisOptions() {
  const target = resolveRedisConnection();
  const socket = {
    connectTimeout: Math.max(500, Number(process.env.REDIS_CONNECT_TIMEOUT_MS) || 2_000),
    reconnectStrategy: (retries) => (retries > 2 ? false : 100 * retries),
  };
  if (target.url) {
    return { url: target.url, socket };
  }
  return {
    socket: {
      host: target.host,
      port: target.port,
      ...socket,
    },
    password: target.password,
    database: target.db,
  };
}

async function configureSocketRedisAdapter(io) {
  if (String(process.env.SOCKET_REDIS_ADAPTER_ENABLED || "true") === "false") {
    return { enabled: false, reason: "disabled" };
  }
  try {
    const { createAdapter } = moderationRequire("@socket.io/redis-adapter");
    const { createClient } = moderationRequire("redis");
    const pubClient = createClient(redisOptions());
    const subClient = pubClient.duplicate();
    pubClient.on("error", (error) => console.warn(`[socket:redis] pub ${error.message}`));
    subClient.on("error", (error) => console.warn(`[socket:redis] sub ${error.message}`));
    await Promise.all([pubClient.connect(), subClient.connect()]);
    io.adapter(createAdapter(pubClient, subClient));
    return { enabled: true, pubClient, subClient };
  } catch (error) {
    console.warn(`[socket:redis] Adapter indisponível; Socket.IO continua local: ${error.message}`);
    return { enabled: false, reason: error.message };
  }
}

module.exports = { configureSocketRedisAdapter };
