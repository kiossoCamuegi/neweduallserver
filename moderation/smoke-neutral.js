"use strict";

const path = require("path");

async function run() {
  process.env.MODERATION_CLIP_MODEL_DIR = path.resolve(
    process.env.MODERATION_CLIP_MODEL_DIR || "./models/clip-vit-base-patch32"
  );
  const sharp = require("sharp");
  const { analyzeImageBuffer } = require("./processor");
  const { decideModerationByInputType } = require("./decision");
  const image = await sharp({
    create: {
      width: 480,
      height: 480,
      channels: 3,
      background: { r: 226, g: 232, b: 238 },
    },
  }).jpeg({ quality: 85 }).toBuffer();
  const analysis = await analyzeImageBuffer(image);
  const unavailable = analysis.results.find((result) => result.unavailable);
  if (unavailable) throw new Error(unavailable.reason);
  const decision = decideModerationByInputType(analysis.results, {
    image: {
      lowThreshold: Number(process.env.MODERATION_IMAGE_LOW_THRESHOLD) || 0.35,
      highThreshold: Number(process.env.MODERATION_IMAGE_HIGH_THRESHOLD) || 0.75,
    },
  });
  if (decision.decision === "rejected") {
    throw new Error(`Imagem neutra classificada como rejeitada: ${decision.category}`);
  }
  console.log(JSON.stringify({
    ok: true,
    decision: decision.decision,
    score: decision.score,
    analyzers: analysis.results.map((result) => ({
      analyzer: result.analyzer,
      model: result.model,
      version: result.version,
      maxScore: result.maxScore,
    })),
  }, null, 2));
}

run().catch((error) => {
  console.error(`[moderation:smoke] ${error.message}`);
  process.exitCode = 1;
});

