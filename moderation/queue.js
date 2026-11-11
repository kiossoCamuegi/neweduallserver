"use strict";

const path = require("path");
const crypto = require("crypto");
const { createRequire } = require("module");
const { processModerationJob } = require("./processor");
const { resolveRedisConnection } = require("../realtime/redisConfiguration");

const moderationRequire = createRequire(
  path.resolve(__dirname, "package.json")
);
const QUEUE_NAME = "moderation";
const INLINE_FALLBACK = String(process.env.MODERATION_INLINE_FALLBACK || "false") === "true";
const pendingFallback = new Set();
let queuePromise = null;
let queueUnavailableUntil = 0;

function redisConnectionOptions({ worker = false } = {}) {
  const target = resolveRedisConnection();
  if (target.url) {
    return {
      url: target.url,
      maxRetriesPerRequest: worker ? null : 1,
      connectTimeout: 2_000,
    };
  }
  return {
    host: target.host,
    port: target.port,
    password: target.password,
    db: target.db,
    maxRetriesPerRequest: worker ? null : 1,
    connectTimeout: 2_000,
    retryStrategy: worker ? undefined : ((times) => (times <= 2 ? 200 : null)),
  };
}

async function getModerationQueue() {
  if (process.env.MODERATION_QUEUE_ENABLED === "false") return null;
  if (!queuePromise && Date.now() < queueUnavailableUntil) return null;
  if (!queuePromise) {
    queuePromise = (async () => {
      try {
        const { Queue } = moderationRequire("bullmq");
        const queue = new Queue(QUEUE_NAME, {
          connection: redisConnectionOptions(),
          defaultJobOptions: {
            attempts: Math.max(1, Number(process.env.MODERATION_RETRY_ATTEMPTS) || 5),
            backoff: { type: "exponential", delay: 1000 },
            removeOnComplete: 2000,
            removeOnFail: 5000,
          },
        });
        await queue.waitUntilReady();
        return queue;
      } catch (error) {
        queueUnavailableUntil = Date.now() + 30_000;
        console.warn(
          `[moderation:queue] BullMQ indisponível; o conteúdo permanece pendente até o Redis voltar: ${error.message}`
        );
        return null;
      }
    })();
  }
  const queue = await queuePromise;
  if (!queue) queuePromise = null;
  return queue;
}

async function enqueueModeration({ instituteCode, contentType, contentId, reason = "created" }) {
  const data = {
    instituteCode,
    contentType,
    contentId: Number(contentId),
    reason,
  };
  const queue = await getModerationQueue();
  if (queue) {
    try {
      const version = ["edited", "request-review"].includes(reason)
        ? Date.now()
        : 1;
      const digest = crypto
        .createHash("sha256")
        .update(`${instituteCode}:${contentType}:${contentId}:${reason}:${version}`)
        .digest("hex")
        .slice(0, 32);
      return await queue.add("analyze-content", data, {
        jobId: `moderation-${digest}`,
      });
    } catch (error) {
      console.warn(`[moderation:queue] Redis recusou o job: ${error.message}`);
    }
  }
  if (!INLINE_FALLBACK) return null;
  const key = `${instituteCode}:${contentType}:${contentId}`;
  if (pendingFallback.has(key)) return null;
  pendingFallback.add(key);
  setImmediate(() => {
    processModerationJob({ data, attemptsMade: 0 })
      .catch((error) => console.error(`[moderation:fallback] ${error.message}`))
      .finally(() => pendingFallback.delete(key));
  });
  return null;
}

async function moderationQueueHealth() {
  const queue = await getModerationQueue();
  let counts = null;
  if (queue) {
    counts = await queue.getJobCounts(
      "waiting",
      "active",
      "completed",
      "failed",
      "delayed"
    ).catch(() => null);
  }
  return {
    enabled: Boolean(queue),
    driver: queue ? "bullmq" : INLINE_FALLBACK ? "inline-fallback" : "deferred",
    name: QUEUE_NAME,
    counts,
    jobTimeoutMs: Number(process.env.MODERATION_JOB_TIMEOUT_MS) || 30_000,
    workerConcurrency: Number(process.env.MODERATION_WORKER_CONCURRENCY) || 2,
  };
}

module.exports = {
  QUEUE_NAME,
  enqueueModeration,
  getModerationQueue,
  moderationQueueHealth,
  redisConnectionOptions,
};
