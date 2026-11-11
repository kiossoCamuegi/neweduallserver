"use strict";

require("../config/env");
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const { Worker, Queue } = require("bullmq");
const { closeDatabase } = require("../config/Database");
const { QUEUE_NAME, redisConnectionOptions } = require("./queue");
const { processModerationJob } = require("./processor");
const { runWithTimeout } = require("./jobTimeout");

const jobTimeoutMs = Math.max(
  5_000,
  Number(process.env.MODERATION_JOB_TIMEOUT_MS) || 30_000
);

function assertRuntimeDependencies() {
  const binaries = [
    process.env.MODERATION_FFMPEG_PATH || "ffmpeg",
    process.env.MODERATION_FFPROBE_PATH || "ffprobe",
    process.env.MODERATION_PDFTOPPM_PATH || "pdftoppm",
    process.env.MODERATION_PDFTOTEXT_PATH || "pdftotext",
  ];
  for (const binary of binaries) {
    const result = spawnSync(binary, ["-version"], {
      encoding: "utf8",
      timeout: 5000,
    });
    if (result.error || (result.status !== 0 && result.status !== 1)) {
      throw new Error(`Dependência de moderação indisponível: ${binary}`);
    }
  }
  if (String(process.env.MODERATION_CLIP_ENABLED || "true") !== "false") {
    const modelDir = path.resolve(
      process.env.MODERATION_CLIP_MODEL_DIR || "./models/clip-vit-base-patch32"
    );
    if (!fs.existsSync(path.join(modelDir, "config.json"))) {
      throw new Error(`Modelo CLIP local em falta: ${modelDir}`);
    }
  }
}

try {
  assertRuntimeDependencies();
} catch (error) {
  console.error(`[moderation:worker] arranque recusado: ${error.message}`);
  process.exit(1);
}

const deadLetter = new Queue("moderation-dead-letter", {
  connection: redisConnectionOptions({ worker: true }),
});

const worker = new Worker(
  QUEUE_NAME,
  async (job) => {
    return runWithTimeout(
      () => processModerationJob(job),
      jobTimeoutMs,
      () => {
        // Dá ao BullMQ tempo para registar a falha; depois o PM2 reinicia o
        // processo isolado caso o analisador nativo tenha ficado bloqueado.
        setTimeout(() => process.exit(124), 5_000);
      }
    );
  },
  {
    connection: redisConnectionOptions({ worker: true }),
    concurrency: Math.max(1, Number(process.env.MODERATION_WORKER_CONCURRENCY) || 2),
    lockDuration: jobTimeoutMs + 60_000,
    stalledInterval: Math.max(30_000, jobTimeoutMs),
  }
);

worker.on("completed", (job) => {
  console.log(`[moderation:worker] concluído ${job.id}`);
});

worker.on("failed", async (job, error) => {
  console.error(`[moderation:worker] falhou ${job?.id}: ${error.message}`);
  const attempts = Math.max(1, Number(process.env.MODERATION_RETRY_ATTEMPTS) || 5);
  if (job && job.attemptsMade >= attempts) {
    await deadLetter.add("failed-moderation", {
      data: job.data,
      error: error.message,
      failedAt: new Date().toISOString(),
    }).catch(() => {});
  }
});
worker.on("error", (error) => {
  console.error(`[moderation:worker] erro global: ${error.message}`);
});

async function shutdown(signal) {
  console.log(`[moderation:worker] ${signal}: a encerrar`);
  await worker.close();
  await deadLetter.close();
  await closeDatabase();
  process.exit(0);
}

process.once("SIGINT", () => shutdown("SIGINT"));
process.once("SIGTERM", () => shutdown("SIGTERM"));
console.log("[moderation:worker] iniciado");
