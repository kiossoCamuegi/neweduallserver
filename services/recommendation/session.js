"use strict";

const Redis = require("ioredis");

const POSITIVE_TYPES = new Set([
  "like",
  "comment",
  "share",
  "save",
  "replay",
  "open_comments",
  "author_profile",
  "video_completion",
  "dwell_time",
]);
const memorySessions = new Map();
let redisClient;
let redisDisabled = false;

function redisOptions() {
  if (process.env.REDIS_URL) {
    return {
      url: process.env.REDIS_URL,
      options: {
        lazyConnect: true,
        enableOfflineQueue: false,
        maxRetriesPerRequest: 1,
        retryStrategy: () => null,
      },
    };
  }
  if (!process.env.REDIS_HOST) return null;
  return {
    url: null,
    options: {
      host: process.env.REDIS_HOST,
      port: Number(process.env.REDIS_PORT) || 6379,
      password: process.env.REDIS_PASSWORD || undefined,
      db: Number(process.env.REDIS_DB) || 0,
      lazyConnect: true,
      enableOfflineQueue: false,
      maxRetriesPerRequest: 1,
      retryStrategy: () => null,
    },
  };
}

function getRedis() {
  if (redisDisabled) return null;
  if (redisClient) return redisClient;
  const config = redisOptions();
  if (!config) {
    redisDisabled = true;
    return null;
  }
  redisClient = config.url
    ? new Redis(config.url, config.options)
    : new Redis(config.options);
  redisClient.on("error", () => {});
  return redisClient;
}

async function withRedis(task) {
  const client = getRedis();
  if (!client) return null;
  try {
    if (client.status === "wait") await client.connect();
    return await task(client);
  } catch {
    return null;
  }
}

function sessionKey(ctx) {
  return `${process.env.REDIS_PREFIX || "eduall"}:recs:recent:${ctx.instituteCode}:${ctx.userId}`;
}

function memoryKey(ctx) {
  return `${ctx.instituteCode}:${ctx.userId}`;
}

async function rememberPositive(ctx, type, postId) {
  if (!POSITIVE_TYPES.has(String(type))) return;
  const id = Number(postId);
  if (!id) return;
  const key = sessionKey(ctx);
  const stored = await withRedis(async (client) => {
    await client
      .multi()
      .lrem(key, 0, String(id))
      .lpush(key, String(id))
      .ltrim(key, 0, 19)
      .expire(key, 86_400)
      .exec();
    return client.lrange(key, 0, 19);
  });
  if (stored) return stored.map(Number);
  const keyMem = memoryKey(ctx);
  const recent = (memorySessions.get(keyMem) || []).filter((value) => value !== id);
  memorySessions.set(keyMem, [id, ...recent].slice(0, 20));
  return memorySessions.get(keyMem);
}

async function recentPositivePostIds(ctx, limit = 5) {
  const stored = await withRedis((client) => client.lrange(sessionKey(ctx), 0, Math.max(0, limit - 1)));
  if (stored) return stored.map(Number).filter(Boolean);
  return (memorySessions.get(memoryKey(ctx)) || []).slice(0, limit);
}

module.exports = {
  POSITIVE_TYPES,
  recentPositivePostIds,
  rememberPositive,
};
