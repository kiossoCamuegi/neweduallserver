"use strict";

function resolveRedisConnection() {
  if (process.env.REDIS_URL) {
    return { url: process.env.REDIS_URL };
  }

  const appPort = process.env.APP_REDIS_PORT;
  const appPassword = process.env.APP_REDIS_PASSWORD;
  if (appPort || appPassword) {
    const port = Number(appPort) || 6381;
    const password = appPassword || "app_redis_change_me";
    return {
      url: `redis://:${encodeURIComponent(password)}@127.0.0.1:${port}/0`,
    };
  }

  return {
    host: process.env.REDIS_HOST || "127.0.0.1",
    port: Number(process.env.REDIS_PORT) || 6379,
    password: process.env.REDIS_PASSWORD || undefined,
    db: Number(process.env.REDIS_DB) || 0,
  };
}

module.exports = { resolveRedisConnection };
