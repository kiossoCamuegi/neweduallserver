"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const { execFile } = require("child_process");
const { createRequire } = require("module");
const { pathToFileURL } = require("url");
const { DATABASE } = require("../config/Database");
const { storage } = require("../storage");
const { safeMediaPath } = require("../hr/feedMedia");
const { safeChatMediaPath } = require("../hr/chatMedia");
const { safeStoryMediaPath } = require("../hr/storyMedia");
const { safeDecryptContent } = require("../shared/contentCrypto");
const { analyzeTextRules } = require("./textRules");
const { decideModerationByInputType } = require("./decision");
const { termsForInstitute } = require("./terms");
const { recordDomainEvent } = require("./domainEvents");
const notifications = require("../notifications/service");
const recommendationSync = require("../services/recommendation/sync");

let nsfwModelPromise = null;
let clipModelPromise = null;
const moderationRequire = createRequire(
  path.resolve(__dirname, "package.json")
);

function configuredWeights() {
  const categories = [
    "porn",
    "hentai",
    "nudity_explicit",
    "sexual_explicit",
    "sexual_content",
    "violence_gore",
    "hate_symbols",
    "sexy",
    "toxic",
    "toxicity",
    "threat",
    "identity_attack",
    "severe_toxicity",
    "rule_severity",
  ];
  return Object.fromEntries(categories
    .map((category) => {
      const value = Number(
        process.env[`MODERATION_WEIGHT_${category.toUpperCase()}`]
      );
      return Number.isFinite(value) && value >= 0 && value <= 1
        ? [category, value]
        : null;
    })
    .filter(Boolean));
}

function parseJson(value, fallback) {
  try {
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
}

async function fetchWithTimeout(url, options, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    if (!response.ok) throw new Error(`Analisador respondeu HTTP ${response.status}.`);
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

async function analyzeToxicity(text) {
  const serviceUrl = String(process.env.MODERATION_TOXICITY_URL || "").replace(/\/+$/, "");
  if (!serviceUrl) {
    return {
      analyzer: "toxicity",
      unavailable: true,
      reason: "Serviço local de toxicidade não configurado.",
    };
  }
  try {
    const payload = await fetchWithTimeout(
      `${serviceUrl}/analyze`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      },
      Math.max(1000, Number(process.env.MODERATION_TOXICITY_TIMEOUT_MS) || 12_000)
    );
    const scores = payload?.scores && typeof payload.scores === "object" ? payload.scores : {};
    const toxicity = Number(scores.toxicity ?? payload?.toxicity ?? 0);
    return {
      analyzer: "toxicity",
      model: payload?.model || "detoxify-multilingual",
      version: payload?.version || "0.5.4",
      scores: { ...scores, toxicity },
      maxScore: toxicity,
      reasons: toxicity >= 0.5 ? [`Toxicidade elevada (${(toxicity * 100).toFixed(0)}%).`] : [],
    };
  } catch (error) {
    return {
      analyzer: "toxicity",
      unavailable: true,
      reason: `Analisador de toxicidade indisponível: ${error.message}`,
    };
  }
}

async function storageBuffer(storageKey) {
  const key = safeMediaPath(storageKey);
  if (!key) throw new Error("Chave de armazenamento inválida.");
  const object = await storage.get(key);
  if (!object) {
    const chatPath = safeChatMediaPath(key);
    if (chatPath) return fs.promises.readFile(chatPath);
    const storyPath = safeStoryMediaPath(path.basename(key));
    if (storyPath) return fs.promises.readFile(storyPath);
    throw new Error("Ficheiro de moderação não encontrado.");
  }
  if (object.local && object.path) return fs.promises.readFile(object.path);
  if (object.kind === "stream") {
    const chunks = [];
    for await (const chunk of object.stream) chunks.push(Buffer.from(chunk));
    return Buffer.concat(chunks);
  }
  if (object.response?.arrayBuffer) return Buffer.from(await object.response.arrayBuffer());
  if (object.stream) {
    const chunks = [];
    for await (const chunk of object.stream) chunks.push(Buffer.from(chunk));
    return Buffer.concat(chunks);
  }
  throw new Error("Não foi possível ler o ficheiro para moderação.");
}

async function loadNsfwModel() {
  if (!nsfwModelPromise) {
    nsfwModelPromise = (async () => {
      let tf;
      let backend = "tensorflow-node";
      try {
        tf = require("@tensorflow/tfjs-node");
      } catch (error) {
        console.warn(`[moderation:nsfw] addon nativo indisponível; fallback CPU: ${error.message}`);
        tf = require("@tensorflow/tfjs");
        backend = "tensorflow-cpu";
        await tf.ready();
      }
      const nsfw = require("nsfwjs");
      const modelDir = String(process.env.MODERATION_NSFW_MODEL_DIR || "").trim();
      const source = modelDir
        ? (modelDir.startsWith("file://") ? modelDir : `file://${path.resolve(modelDir)}/`)
        : undefined;
      const model = source ? await nsfw.load(source) : await nsfw.load();
      return { tf, model, backend };
    })().catch((error) => {
      nsfwModelPromise = null;
      throw error;
    });
  }
  return nsfwModelPromise;
}

async function loadClipModel() {
  if (!clipModelPromise) {
    clipModelPromise = (async () => {
      const transformersUrl = pathToFileURL(
        moderationRequire.resolve("@huggingface/transformers")
      ).href;
      const transformers = await import(transformersUrl);
      const { env, pipeline, RawImage } = transformers;
      const modelDir = path.resolve(
        process.env.MODERATION_CLIP_MODEL_DIR || "./models/clip-vit-base-patch32"
      );
      env.allowRemoteModels = false;
      env.allowLocalModels = true;
      env.localModelPath = path.dirname(modelDir);
      env.cacheDir = path.dirname(modelDir);
      const classifier = await pipeline(
        "zero-shot-image-classification",
        path.basename(modelDir),
        {
          dtype: process.env.MODERATION_CLIP_DTYPE || "q8",
          local_files_only: true,
        }
      );
      return { classifier, RawImage };
    })().catch((error) => {
      clipModelPromise = null;
      throw error;
    });
  }
  return clipModelPromise;
}

async function normalizeImage(buffer) {
  const sharp = moderationRequire("sharp");
  const maxPixels = Math.max(
    1_000_000,
    Number(process.env.MODERATION_IMAGE_MAX_PIXELS) || 40_000_000
  );
  return sharp(buffer, {
    failOn: "error",
    limitInputPixels: maxPixels,
    animated: false,
  })
    .rotate()
    .resize({
      width: Math.max(256, Number(process.env.MODERATION_IMAGE_ANALYSIS_MAX_EDGE) || 1280),
      height: Math.max(256, Number(process.env.MODERATION_IMAGE_ANALYSIS_MAX_EDGE) || 1280),
      fit: "inside",
      withoutEnlargement: true,
    })
    .jpeg({
      quality: Math.max(60, Math.min(95, Number(process.env.MODERATION_IMAGE_JPEG_QUALITY) || 85)),
      mozjpeg: true,
    })
    .toBuffer();
}

async function detectBufferType(buffer) {
  const { fileTypeFromBuffer } = await import(
    pathToFileURL(moderationRequire.resolve("file-type")).href
  );
  return fileTypeFromBuffer(buffer);
}

async function classifyNsfwBuffer(buffer) {
  const { tf, model, backend } = await loadNsfwModel();
  const sharp = moderationRequire("sharp");
  const decoded = await sharp(buffer)
    .resize(224, 224, { fit: "fill" })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const image = tf.tensor3d(
    new Uint8Array(decoded.data),
    [decoded.info.height, decoded.info.width, decoded.info.channels],
    "int32"
  );
  try {
    const predictions = await model.classify(image);
    const scores = Object.fromEntries(
      predictions.map((item) => [String(item.className).toLowerCase(), Number(item.probability) || 0])
    );
    const maxScore = Math.max(
      Number(scores.porn || 0),
      Number(scores.hentai || 0),
      Number(scores.sexy || 0)
    );
    const category = Object.entries(scores)
      .filter(([name]) => ["porn", "hentai", "sexy"].includes(name))
      .sort((left, right) => Number(right[1]) - Number(left[1]))[0]?.[0] || null;
    return {
      analyzer: "nsfw_image",
      model: "nsfwjs",
      version: `4.4.0:${backend}`,
      scores,
      maxScore,
      category,
      reasons: maxScore >= 0.5 ? [`Imagem suspeita (${(maxScore * 100).toFixed(0)}%).`] : [],
      thresholdType: "image",
    };
  } finally {
    image.dispose();
  }
}

const CLIP_LABEL_CATEGORIES = Object.freeze({
  "safe for work image": "safe",
  "person wearing swimwear in a non-sexual context": "contextual",
  "medical or breastfeeding image in a clinical context": "contextual",
  "artistic or classical nudity": "nudity_explicit",
  "nudity with exposed genitals": "nudity_explicit",
  "explicit sexual activity": "sexual_explicit",
  "sexually suggestive image": "sexual_content",
  "graphic violence, blood or gore": "violence_gore",
  "hate symbol, extremist flag or propaganda": "hate_symbols",
});

async function classifyClipBuffer(buffer) {
  if (String(process.env.MODERATION_CLIP_ENABLED || "true") === "false") return null;
  const { classifier, RawImage } = await loadClipModel();
  const image = await RawImage.fromBlob(new Blob([buffer], { type: "image/jpeg" }));
  const labels = Object.keys(CLIP_LABEL_CATEGORIES);
  const predictions = await classifier(image, labels);
  const scores = {};
  predictions.forEach((prediction) => {
    const category = CLIP_LABEL_CATEGORIES[prediction.label];
    if (!category || category === "safe" || category === "contextual") return;
    scores[category] = Math.max(scores[category] || 0, Number(prediction.score) || 0);
  });
  const highest = Object.entries(scores)
    .sort((left, right) => right[1] - left[1])[0];
  return {
    analyzer: "clip_zero_shot",
    model: "Xenova/clip-vit-base-patch32",
    version: process.env.MODERATION_CLIP_REVISION || "6b7c523703ae26e39be4b03774966f8571c7f523",
    scores,
    maxScore: highest?.[1] || 0,
    category: highest?.[0] || null,
    reasons: highest && highest[1] >= 0.5
      ? [`Classificação visual suspeita: ${highest[0]} (${(highest[1] * 100).toFixed(0)}%).`]
      : [],
    thresholdType: "image",
  };
}

async function analyzeImageBuffer(buffer, { analyzerPrefix = "image" } = {}) {
  const detected = await detectBufferType(buffer);
  if (!detected?.mime?.startsWith("image/")) {
    throw new Error("O ficheiro não é uma imagem válida segundo os magic bytes.");
  }
  const normalized = await normalizeImage(buffer);
  const results = [];
  try {
    results.push(await classifyNsfwBuffer(normalized));
  } catch (error) {
    results.push({
      analyzer: `${analyzerPrefix}_nsfw`,
      unavailable: true,
      thresholdType: "image",
      reason: `NSFWJS indisponível: ${error.message}`,
    });
  }
  if (String(process.env.MODERATION_CLIP_ENABLED || "true") !== "false") {
    try {
      const clip = await classifyClipBuffer(normalized);
      if (clip) results.push(clip);
    } catch (error) {
      results.push({
        analyzer: `${analyzerPrefix}_clip`,
        unavailable: true,
        thresholdType: "image",
        reason: `CLIP indisponível: ${error.message}`,
      });
    }
  }
  return { results, normalized };
}

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    execFile(
      command,
      args,
      {
        timeout: options.timeout || 30_000,
        maxBuffer: 20 * 1024 * 1024,
        windowsHide: true,
      },
      (error, stdout, stderr) => {
        if (error) {
          error.message = `${error.message}${stderr ? `: ${String(stderr).trim()}` : ""}`;
          reject(error);
          return;
        }
        resolve({ stdout, stderr });
      }
    );
  });
}

function mergeScoredFrames(analyzer, frames) {
  const available = frames.filter((frame) => !frame.unavailable);
  if (!available.length) {
    return {
      analyzer,
      unavailable: true,
      reason: frames[0]?.reason || "Nenhum frame pôde ser analisado.",
    };
  }
  const scores = {};
  available.forEach((frame) => {
    Object.entries(frame.scores || {}).forEach(([category, score]) => {
      scores[category] = Math.max(scores[category] || 0, Number(score) || 0);
    });
  });
  const worst = available
    .slice()
    .sort((left, right) => Number(right.maxScore) - Number(left.maxScore))[0];
  return {
    analyzer,
    model: worst.model,
    version: worst.version,
    scores,
    maxScore: Number(worst.maxScore) || 0,
    category: worst.category || null,
    thresholdType: "image",
    frameTimestamp: Number(worst.frameTimestamp) || 0,
    metadata: {
      frameCount: available.length,
      analyzedTimestamps: available.map((frame) => frame.frameTimestamp),
    },
    reasons: worst.reasons || [],
    previewBuffer: worst.previewBuffer || null,
  };
}

async function analyzeVideo(videoAttachment) {
  const ffmpeg = process.env.MODERATION_FFMPEG_PATH || "ffmpeg";
  const interval = Math.max(1, Number(process.env.MODERATION_VIDEO_FRAME_INTERVAL_SECONDS) || 2);
  const maxFrames = Math.max(1, Math.min(300, Number(process.env.MODERATION_VIDEO_MAX_FRAMES) || 90));
  const sceneThreshold = Math.max(
    0.05,
    Math.min(1, Number(process.env.MODERATION_VIDEO_SCENE_THRESHOLD) || 0.3)
  );
  const directory = await fs.promises.mkdtemp(path.join(os.tmpdir(), "eduall-moderation-"));
  try {
    const source = path.join(directory, `source-${crypto.randomBytes(4).toString("hex")}.mp4`);
    await fs.promises.writeFile(source, await storageBuffer(videoAttachment.storageKey));
    const intervalDir = path.join(directory, "interval-frames");
    const sceneDir = path.join(directory, "scene-frames");
    await Promise.all([
      fs.promises.mkdir(intervalDir),
      fs.promises.mkdir(sceneDir),
    ]);
    await run(ffmpeg, [
      "-hide_banner",
      "-loglevel",
      "error",
      "-i",
      source,
      "-vf",
      `fps=1/${interval},scale='min(1280,iw)':-2`,
      "-frames:v",
      String(maxFrames),
      "-q:v",
      "3",
      path.join(intervalDir, "frame-%04d.jpg"),
    ]);
    const scene = await run(ffmpeg, [
      "-hide_banner",
      "-loglevel",
      "info",
      "-i",
      source,
      "-vf",
      `select='gt(scene,${sceneThreshold})',showinfo,scale='min(1280,iw)':-2`,
      "-fps_mode",
      "vfr",
      "-frames:v",
      String(maxFrames),
      "-q:v",
      "3",
      path.join(sceneDir, "scene-%04d.jpg"),
    ]).catch(() => ({ stderr: "" }));
    const intervalFrames = (await fs.promises.readdir(intervalDir))
      .filter((name) => name.endsWith(".jpg"))
      .sort()
      .map((name, index) => ({
        name,
        path: path.join(intervalDir, name),
        timestamp: index * interval,
      }));
    const sceneTimestamps = [...String(scene.stderr || "").matchAll(/pts_time:([0-9.]+)/g)]
      .map((match) => Number(match[1]))
      .filter(Number.isFinite);
    const sceneFrames = (await fs.promises.readdir(sceneDir))
      .filter((name) => name.endsWith(".jpg"))
      .sort()
      .map((name, index) => ({
        name,
        path: path.join(sceneDir, name),
        timestamp: sceneTimestamps[index] ?? index * interval,
      }));
    const seen = new Set();
    const frames = [...intervalFrames, ...sceneFrames]
      .sort((left, right) => left.timestamp - right.timestamp)
      .filter((frame) => {
        const key = frame.timestamp.toFixed(2);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .slice(0, maxFrames);
    if (!frames.length) {
      return [{
        analyzer: "nsfw_video",
        unavailable: true,
        thresholdType: "image",
        reason: "O FFmpeg não extraiu frames do vídeo.",
      }];
    }
    const nsfwFrames = [];
    const clipFrames = [];
    for (const frame of frames) {
      const analysis = await analyzeImageBuffer(
        await fs.promises.readFile(frame.path),
        { analyzerPrefix: "video" }
      );
      const frameResults = analysis.results.map((result) => ({
        ...result,
        frameTimestamp: frame.timestamp,
        previewBuffer: analysis.normalized,
      }));
      frameResults.forEach((result) => {
        if (result.analyzer.includes("clip")) clipFrames.push(result);
        else nsfwFrames.push(result);
      });
    }
    return [
      mergeScoredFrames("nsfw_video", nsfwFrames),
      ...(clipFrames.length ? [mergeScoredFrames("clip_video", clipFrames)] : []),
    ];
  } finally {
    await fs.promises.rm(directory, { recursive: true, force: true }).catch(() => {});
  }
}

async function analyzePdf(pdfAttachment, terms) {
  const directory = await fs.promises.mkdtemp(path.join(os.tmpdir(), "eduall-pdf-moderation-"));
  const pdftoppm = process.env.MODERATION_PDFTOPPM_PATH || "pdftoppm";
  const pdftotext = process.env.MODERATION_PDFTOTEXT_PATH || "pdftotext";
  const maxPages = Math.max(
    1,
    Math.min(100, Number(process.env.MODERATION_PDF_MAX_PAGES) || 20)
  );
  try {
    const source = path.join(directory, "source.pdf");
    const buffer = await storageBuffer(pdfAttachment.storageKey);
    const detected = await detectBufferType(buffer);
    if (detected?.mime !== "application/pdf") {
      throw new Error("O documento não é um PDF válido segundo os magic bytes.");
    }
    await fs.promises.writeFile(source, buffer);
    const prefix = path.join(directory, "page");
    try {
      await run(pdftoppm, [
        "-jpeg",
        "-r",
        String(Math.max(72, Number(process.env.MODERATION_PDF_DPI) || 110)),
        "-f",
        "1",
        "-l",
        String(maxPages),
        source,
        prefix,
      ], { timeout: 60_000 });
    } catch (error) {
      return [{
        analyzer: "pdf_render",
        unavailable: true,
        thresholdType: "image",
        reason: `Não foi possível renderizar o PDF para análise visual: ${error.message}`,
      }];
    }
    const pages = (await fs.promises.readdir(directory))
      .filter((name) => /^page-\d+\.jpg$/i.test(name))
      .sort();
    const results = [];
    for (const [index, page] of pages.entries()) {
      const analysis = await analyzeImageBuffer(
        await fs.promises.readFile(path.join(directory, page)),
        { analyzerPrefix: "pdf" }
      );
      results.push(...analysis.results.map((result) => ({
        ...result,
        previewBuffer: analysis.normalized,
        mediaIndex: pdfAttachment.mediaIndex,
        frameTimestamp: index + 1,
        metadata: { pdfPage: index + 1 },
      })));
    }
    const textFile = path.join(directory, "content.txt");
    try {
      await run(pdftotext, ["-f", "1", "-l", String(maxPages), source, textFile], {
        timeout: 30_000,
      });
      const text = await fs.promises.readFile(textFile, "utf8");
      if (text.trim()) {
        results.push({
          ...analyzeTextRules(text, terms),
          analyzer: "pdf_text_rules",
          thresholdType: "text",
          mediaIndex: pdfAttachment.mediaIndex,
          metadata: { pdfTextCharacters: text.length },
        });
        results.push({
          ...(await analyzeToxicity(text)),
          analyzer: "pdf_text_toxicity",
          thresholdType: "text",
          mediaIndex: pdfAttachment.mediaIndex,
          metadata: { pdfTextCharacters: text.length },
        });
      }
    } catch (error) {
      results.push({
        analyzer: "pdf_text",
        unavailable: true,
        mediaIndex: pdfAttachment.mediaIndex,
        thresholdType: "text",
        reason: `Não foi possível extrair o texto do PDF: ${error.message}`,
      });
    }
    return results;
  } finally {
    await fs.promises.rm(directory, { recursive: true, force: true }).catch(() => {});
  }
}

async function analyzeMedia(attachments, terms = []) {
  const results = [];
  for (const [mediaIndex, attachment] of attachments.entries()) {
    try {
      if (attachment.type === "image") {
        const analysis = await analyzeImageBuffer(await storageBuffer(attachment.storageKey));
        results.push(...analysis.results.map((result) => ({
          ...result,
          previewBuffer: analysis.normalized,
          mediaIndex,
        })));
      } else if (attachment.type === "video") {
        const analysis = await analyzeVideo(attachment);
        results.push(...analysis.map((result) => ({ ...result, mediaIndex })));
      } else if (attachment.type === "file" && attachment.mime === "application/pdf") {
        results.push(...await analyzePdf({ ...attachment, mediaIndex }, terms));
      }
      if (attachment.poster?.storageKey) {
        const poster = await analyzeImageBuffer(
          await storageBuffer(attachment.poster.storageKey),
          { analyzerPrefix: "poster" }
        );
        results.push(...poster.results.map((result) => ({
          ...result,
          previewBuffer: poster.normalized,
          mediaIndex,
        })));
      }
    } catch (error) {
      results.push({
        analyzer: attachment.type === "video" ? "nsfw_video" : "media",
        unavailable: true,
        mediaIndex,
        thresholdType: "image",
        reason: `Não foi possível analisar ${attachment.name || attachment.type}: ${error.message}`,
      });
    }
  }
  return results;
}

async function loadContent(instituteCode, contentType, contentId) {
  if (contentType === "post") {
    const [rows] = await DATABASE.query(
      `SELECT p.ed_hr_post_uid AS id, p.ed_post_user AS userId,
              p.ed_post_author_employee AS employeeId,
              p.ed_post_description AS text, p.ed_post_attachments AS attachments,
              p.ed_post_kind AS kind, p.ed_post_publish_at AS publishAt,
              p.ed_post_moderation_status AS status,
              COALESCE(ua.ed_user_account_name, e.ed_employee_name, 'Utilizador') AS authorName,
              COALESCE(ua.ed_user_account_picture, e.ed_employee_picture, '') AS authorAvatar
         FROM eduall_posts p
         LEFT JOIN eduall_user_accounts ua
           ON ua.ed_user_account_id = p.ed_post_user
         LEFT JOIN eduall_employees e
           ON e.ed_employee_id = p.ed_post_author_employee
          AND BINARY e.ed_employee_institute_code = BINARY p.ed_post_institute_code
        WHERE p.ed_hr_post_uid = ?
          AND BINARY p.ed_post_institute_code = BINARY ?
          AND p.ed_post_deleted = 0
        LIMIT 1`,
      [Number(contentId), instituteCode]
    );
    return rows[0] ? {
      ...rows[0],
      text: safeDecryptContent(rows[0].text || ""),
      attachments: parseJson(rows[0].attachments, []),
    } : null;
  }
  if (contentType === "story") {
    const [rows] = await DATABASE.query(
      `SELECT s.ed_hr_story_id AS id, s.ed_hr_story_user_id AS userId,
              s.ed_hr_story_slides AS slides,
              s.ed_hr_story_moderation_status AS status,
              COALESCE(ua.ed_user_account_name, e.ed_employee_name, 'Utilizador') AS authorName,
              COALESCE(ua.ed_user_account_picture, e.ed_employee_picture, '') AS authorAvatar
         FROM eduall_hr_stories s
         LEFT JOIN eduall_user_accounts ua
           ON ua.ed_user_account_id = s.ed_hr_story_user_id
         LEFT JOIN eduall_user_institutes ui
           ON ui.ed_user_institute_userCode = s.ed_hr_story_user_id
          AND BINARY ui.ed_user_institute_code = BINARY s.ed_hr_story_institute_code
          AND ui.ed_user_institute_deleted = 0
         LEFT JOIN eduall_employees e
           ON e.ed_employee_id = ui.ed_user_institute_employeeCode
          AND BINARY e.ed_employee_institute_code = BINARY s.ed_hr_story_institute_code
        WHERE s.ed_hr_story_id = ?
          AND BINARY s.ed_hr_story_institute_code = BINARY ?
          AND s.ed_hr_story_deleted = 0
        LIMIT 1`,
      [Number(contentId), instituteCode]
    );
    if (!rows[0]) return null;
    const slides = parseJson(rows[0].slides, []);
    const [mediaRows] = await DATABASE.query(
      `SELECT ed_hr_story_media_storage_key AS storageKey,
              ed_hr_story_media_mime AS mime,
              ed_hr_story_media_kind AS type
         FROM eduall_hr_story_media
        WHERE BINARY ed_hr_story_media_institute_code = BINARY ?
          AND ed_hr_story_media_story_id = ?`,
      [instituteCode, Number(contentId)]
    );
    const mediaByKey = new Map(mediaRows.map((row) => [row.storageKey, row]));
    const attachments = slides.map((slide, index) => {
      const main = mediaByKey.get(path.basename(slide.storageKey || "")) || {};
      const poster = mediaByKey.get(path.basename(slide.posterKey || ""));
      return {
        id: `${index}`,
        type: slide.type === "video" ? "video" : "image",
        name: `story-${index + 1}`,
        mime: main.mime || (slide.type === "video" ? "video/mp4" : "image/jpeg"),
        storageKey: path.basename(slide.storageKey || ""),
        poster: poster ? {
          storageKey: poster.storageKey,
          mime: poster.mime,
        } : null,
      };
    }).filter((attachment) => attachment.storageKey);
    return {
      ...rows[0],
      text: slides.map((slide) => slide.caption || "").join("\n"),
      attachments,
    };
  }
  if (contentType === "avatar") {
    const [rows] = await DATABASE.query(
      `SELECT c.ed_hr_chat_conversation_id AS id,
              c.ed_hr_chat_conversation_created_by AS userId,
              c.ed_hr_chat_conversation_pending_picture AS picture,
              c.ed_hr_chat_conversation_picture_moderation_status AS status,
              COALESCE(ua.ed_user_account_name, 'Utilizador') AS authorName,
              COALESCE(ua.ed_user_account_picture, '') AS authorAvatar
         FROM eduall_hr_chat_conversations c
         LEFT JOIN eduall_user_accounts ua
           ON ua.ed_user_account_id = c.ed_hr_chat_conversation_created_by
        WHERE c.ed_hr_chat_conversation_id = ?
          AND BINARY c.ed_hr_chat_conversation_institute_code = BINARY ?
          AND c.ed_hr_chat_conversation_deleted = 0
        LIMIT 1`,
      [Number(contentId), instituteCode]
    );
    if (!rows[0]?.picture) return null;
    const encodedKey = String(rows[0].picture).split("/").pop();
    let storageKey = encodedKey;
    try { storageKey = decodeURIComponent(encodedKey); } catch { /* já descodificada */ }
    return {
      ...rows[0],
      text: "Nova imagem de grupo em análise.",
      attachments: [{
        id: storageKey,
        type: "image",
        name: "avatar-do-grupo",
        mime: "image/jpeg",
        storageKey,
      }],
    };
  }
  const [rows] = await DATABASE.query(
    `SELECT c.ed_post_comment_uid AS id, c.ed_post_comment_user AS userId,
            c.ed_post_comment_post_uid AS postId,
            c.ed_post_comment_parent_uid AS parentId,
            c.ed_post_comment_text AS text,
            c.ed_post_comment_moderation_status AS status,
            p.ed_post_user AS postAuthorId,
            parent.ed_post_comment_user AS parentAuthorId,
            COALESCE(ua.ed_user_account_name, e.ed_employee_name, 'Utilizador') AS authorName,
            COALESCE(ua.ed_user_account_picture, e.ed_employee_picture, '') AS authorAvatar
       FROM eduall_post_comments c
       JOIN eduall_posts p
         ON p.ed_hr_post_uid = c.ed_post_comment_post_uid
        AND BINARY p.ed_post_institute_code = BINARY c.ed_post_comment_institute_code
       LEFT JOIN eduall_post_comments parent
         ON parent.ed_post_comment_uid = c.ed_post_comment_parent_uid
       LEFT JOIN eduall_user_accounts ua
         ON ua.ed_user_account_id = c.ed_post_comment_user
       LEFT JOIN eduall_user_institutes ui
         ON ui.ed_user_institute_userCode = c.ed_post_comment_user
        AND BINARY ui.ed_user_institute_code = BINARY c.ed_post_comment_institute_code
        AND ui.ed_user_institute_deleted = 0
       LEFT JOIN eduall_employees e
         ON e.ed_employee_id = ui.ed_user_institute_employeeCode
        AND BINARY e.ed_employee_institute_code = BINARY c.ed_post_comment_institute_code
      WHERE c.ed_post_comment_uid = ?
        AND BINARY c.ed_post_comment_institute_code = BINARY ?
        AND c.ed_post_comment_deleted = 0
      LIMIT 1`,
    [Number(contentId), instituteCode]
  );
  return rows[0] ? { ...rows[0], text: safeDecryptContent(rows[0].text || "") } : null;
}

function storageToken(value, length = 32) {
  return crypto.createHash("sha256").update(String(value)).digest("hex").slice(0, length);
}

function quarantineKey(context, storageKey) {
  const name = path.basename(String(storageKey || "media")).replace(/[^a-zA-Z0-9._-]/g, "_");
  return [
    "moderation-quarantine",
    storageToken(context.instituteCode, 16),
    context.contentType,
    String(context.contentId),
    `${storageToken(storageKey, 20)}-${name}`,
  ].join("/");
}

function previewKey(context, mediaIndex) {
  return [
    "moderation-previews",
    storageToken(context.instituteCode, 16),
    context.contentType,
    String(context.contentId),
    `${Number(mediaIndex)}-${storageToken(`${context.contentId}:${mediaIndex}`, 20)}.jpg`,
  ].join("/");
}

async function copyToQuarantine(context, storageKey, mime = "application/octet-stream") {
  if (!storageKey || String(storageKey).startsWith("moderation-quarantine/")) return null;
  const key = quarantineKey(context, storageKey);
  const buffer = await storageBuffer(storageKey);
  await storage.save(buffer, key, mime);
  return key;
}

async function persistMediaState(context, attachments, results, decision) {
  if (!attachments.length) return;
  const quarantineDays = Math.max(
    1,
    Number(process.env.MODERATION_QUARANTINE_DAYS) || 30
  );
  for (const [mediaIndex, attachment] of attachments.entries()) {
    const mediaResults = results.filter((result) => Number(result.mediaIndex) === mediaIndex);
    const worst = mediaResults
      .filter((result) => !result.unavailable && result.previewBuffer)
      .sort((left, right) => Number(right.maxScore) - Number(left.maxScore))[0];
    const unavailable = mediaResults.find((result) => result.unavailable);
    let savedPreview = null;
    if (worst?.previewBuffer && ["needs_review", "rejected"].includes(decision)) {
      savedPreview = previewKey(context, mediaIndex);
      await storage.save(worst.previewBuffer, savedPreview, "image/jpeg");
    }
    let savedQuarantine = null;
    if (decision === "rejected") {
      savedQuarantine = await copyToQuarantine(
        context,
        attachment.storageKey,
        attachment.mime || "application/octet-stream"
      ).catch((error) => {
        console.error(`[moderation:quarantine] ${error.message}`);
        return null;
      });
    }
    await DATABASE.query(
      `INSERT INTO moderation_media (
         ed_moderation_media_institute_code,
         ed_moderation_media_content_type,
         ed_moderation_media_content_id,
         ed_moderation_media_attachment_index,
         ed_moderation_media_storage_key,
         ed_moderation_media_original_key,
         ed_moderation_media_mime,
         ed_moderation_media_status,
         ed_moderation_media_reason,
         ed_moderation_media_worst_timestamp,
         ed_moderation_media_preview_key,
         ed_moderation_media_quarantine_key,
         ed_moderation_media_quarantine_until
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         ed_moderation_media_storage_key = VALUES(ed_moderation_media_storage_key),
         ed_moderation_media_mime = VALUES(ed_moderation_media_mime),
         ed_moderation_media_status = VALUES(ed_moderation_media_status),
         ed_moderation_media_reason = VALUES(ed_moderation_media_reason),
         ed_moderation_media_worst_timestamp = VALUES(ed_moderation_media_worst_timestamp),
         ed_moderation_media_preview_key = COALESCE(
           VALUES(ed_moderation_media_preview_key),
           ed_moderation_media_preview_key
         ),
         ed_moderation_media_quarantine_key = COALESCE(
           VALUES(ed_moderation_media_quarantine_key),
           ed_moderation_media_quarantine_key
         ),
         ed_moderation_media_quarantine_until = COALESCE(
           VALUES(ed_moderation_media_quarantine_until),
           ed_moderation_media_quarantine_until
         )`,
      [
        context.instituteCode,
        context.contentType,
        context.contentId,
        mediaIndex,
        attachment.storageKey,
        attachment.storageKey,
        attachment.mime || null,
        decision,
        unavailable?.reason || (worst?.category
          ? `Categoria com maior risco: ${worst.category}.`
          : null),
        worst?.frameTimestamp ?? null,
        savedPreview,
        savedQuarantine,
        savedQuarantine
          ? new Date(Date.now() + quarantineDays * 86400000)
          : null,
      ]
    );
  }
}

async function quarantineContentMedia(instituteCode, contentType, contentId) {
  if (!["post", "story", "avatar"].includes(contentType)) return [];
  const content = await loadContent(instituteCode, contentType, contentId);
  if (!content?.attachments?.length) return [];
  const context = { instituteCode, contentType, contentId: Number(contentId) };
  const days = Math.max(1, Number(process.env.MODERATION_QUARANTINE_DAYS) || 30);
  const moved = [];
  for (const [mediaIndex, attachment] of content.attachments.entries()) {
    const key = await copyToQuarantine(
      context,
      attachment.storageKey,
      attachment.mime || "application/octet-stream"
    ).catch((error) => {
      console.error(`[moderation:quarantine] ${error.message}`);
      return null;
    });
    if (!key) continue;
    await DATABASE.query(
      `INSERT INTO moderation_media (
         ed_moderation_media_institute_code,
         ed_moderation_media_content_type,
         ed_moderation_media_content_id,
         ed_moderation_media_attachment_index,
         ed_moderation_media_storage_key,
         ed_moderation_media_original_key,
         ed_moderation_media_mime,
         ed_moderation_media_status,
         ed_moderation_media_quarantine_key,
         ed_moderation_media_quarantine_until
       ) VALUES (?, ?, ?, ?, ?, ?, ?, 'rejected', ?, ?)
       ON DUPLICATE KEY UPDATE
         ed_moderation_media_status = 'rejected',
         ed_moderation_media_quarantine_key = VALUES(ed_moderation_media_quarantine_key),
         ed_moderation_media_quarantine_until = VALUES(ed_moderation_media_quarantine_until)`,
      [
        instituteCode,
        contentType,
        Number(contentId),
        mediaIndex,
        attachment.storageKey,
        attachment.storageKey,
        attachment.mime || null,
        key,
        new Date(Date.now() + days * 86400000),
      ]
    );
    moved.push(key);
  }
  return moved;
}

async function updateContentStatus(contentType, content, decision, reason) {
  if (contentType === "post") {
    await DATABASE.query(
      `UPDATE eduall_posts
          SET ed_post_moderation_status = ?, ed_post_moderation_reason = ?
        WHERE ed_hr_post_uid = ? AND BINARY ed_post_institute_code = BINARY ?`,
      [decision, reason || null, content.id, content.instituteCode]
    );
    return;
  }
  if (contentType === "story") {
    await DATABASE.query(
      `UPDATE eduall_hr_stories
          SET ed_hr_story_moderation_status = ?,
              ed_hr_story_moderation_reason = ?
        WHERE ed_hr_story_id = ?
          AND BINARY ed_hr_story_institute_code = BINARY ?`,
      [decision, reason || null, content.id, content.instituteCode]
    );
    await DATABASE.query(
      `UPDATE eduall_hr_story_media
          SET ed_hr_story_media_moderation_status = ?
        WHERE BINARY ed_hr_story_media_institute_code = BINARY ?
          AND ed_hr_story_media_story_id = ?`,
      [decision, content.instituteCode, content.id]
    );
    return;
  }
  if (contentType === "avatar") {
    await DATABASE.query(
      `UPDATE eduall_hr_chat_conversations
          SET ed_hr_chat_conversation_picture_moderation_status = ?,
              ed_hr_chat_conversation_picture_moderation_reason = ?,
              ed_hr_chat_conversation_picture = CASE
                WHEN ? = 'approved' THEN ed_hr_chat_conversation_pending_picture
                ELSE ed_hr_chat_conversation_picture
              END,
              ed_hr_chat_conversation_pending_picture = CASE
                WHEN ? = 'approved' THEN NULL
                ELSE ed_hr_chat_conversation_pending_picture
              END,
              ed_hr_chat_conversation_updated_at = NOW()
        WHERE ed_hr_chat_conversation_id = ?
          AND BINARY ed_hr_chat_conversation_institute_code = BINARY ?`,
      [decision, reason || null, decision, decision, content.id, content.instituteCode]
    );
    return;
  }
  await DATABASE.query(
    `UPDATE eduall_post_comments
        SET ed_post_comment_moderation_status = ?,
            ed_post_comment_moderation_reason = ?
      WHERE ed_post_comment_uid = ? AND BINARY ed_post_comment_institute_code = BINARY ?`,
    [decision, reason || null, content.id, content.instituteCode]
  );
}

async function saveResults(context, results, decision, reason) {
  if (!results.length) return;
  await DATABASE.query(
    `INSERT INTO moderation_results (
       ed_moderation_result_institute_code,
       ed_moderation_result_content_type,
       ed_moderation_result_content_id,
       ed_moderation_result_media_index,
       ed_moderation_result_frame_timestamp,
       ed_moderation_result_analyzer,
       ed_moderation_result_model,
       ed_moderation_result_scores,
       ed_moderation_result_metadata,
       ed_moderation_result_decision,
       ed_moderation_result_reason,
       ed_moderation_result_attempt
     ) VALUES ?`,
    [results.map((result) => [
      context.instituteCode,
      context.contentType,
      context.contentId,
      Number.isInteger(Number(result.mediaIndex)) ? Number(result.mediaIndex) : null,
      Number.isFinite(Number(result.frameTimestamp)) ? Number(result.frameTimestamp) : null,
      result.analyzer || "unknown",
      [result.model, result.version].filter(Boolean).join(":") || null,
      JSON.stringify(result.scores || { error: result.reason || "unavailable" }),
      JSON.stringify(result.metadata || {}),
      decision,
      reason || null,
      Number(context.attempt || 1),
    ])]
  );
}

async function processModerationJob(job) {
  const data = job?.data || job || {};
  const instituteCode = String(data.instituteCode || "");
  const contentType = ["post", "comment", "story", "avatar"].includes(data.contentType)
    ? data.contentType
    : "";
  const contentId = Number(data.contentId);
  if (!instituteCode || !contentId) throw new Error("Job de moderação inválido.");
  const content = await loadContent(instituteCode, contentType, contentId);
  if (!content) return { skipped: "not_found" };
  content.instituteCode = instituteCode;
  const results = [];
  const terms = await termsForInstitute(instituteCode);
  results.push(analyzeTextRules(content.text, terms));
  results.push(await analyzeToxicity(content.text));
  if (contentType !== "comment" && content.attachments.length) {
    results.push(...(await analyzeMedia(content.attachments, terms)));
  }
  const decision = decideModerationByInputType(results, {
    text: {
      lowThreshold: Number(process.env.MODERATION_TEXT_LOW_THRESHOLD)
        || Number(process.env.MODERATION_LOW_THRESHOLD) || 0.25,
      highThreshold: Number(process.env.MODERATION_TEXT_HIGH_THRESHOLD)
        || Number(process.env.MODERATION_HIGH_THRESHOLD) || 0.70,
      weights: configuredWeights(),
    },
    image: {
      lowThreshold: Number(process.env.MODERATION_IMAGE_LOW_THRESHOLD)
        || Number(process.env.MODERATION_LOW_THRESHOLD) || 0.35,
      highThreshold: Number(process.env.MODERATION_IMAGE_HIGH_THRESHOLD)
        || Number(process.env.MODERATION_HIGH_THRESHOLD) || 0.75,
      weights: configuredWeights(),
    },
  });
  const reason = decision.reasons.join(" ");
  if (contentType !== "comment" && content.attachments.length) {
    await persistMediaState(
      { instituteCode, contentType, contentId },
      content.attachments,
      results,
      decision.decision
    );
  }
  await saveResults(
    { instituteCode, contentType, contentId, attempt: job?.attemptsMade + 1 },
    results,
    decision.decision,
    reason
  );
  await updateContentStatus(contentType, content, decision.decision, reason);

  const connection = await DATABASE.getConnection();
  try {
    await connection.beginTransaction();
    if (contentType === "comment" && decision.decision === "approved") {
      await notifications.watchPost({
        instituteCode,
        postId: content.postId,
        userId: content.userId,
        source: "comment",
      });
      await recordDomainEvent(connection, instituteCode, "comment.approved", {
        actorId: content.userId,
        actorName: content.authorName,
        actorAvatar: content.authorAvatar,
        postId: Number(content.postId),
        postAuthorId: Number(content.postAuthorId),
        parentAuthorId: content.parentAuthorId ? Number(content.parentAuthorId) : null,
        commentId: content.id,
        excerpt: String(content.text || "").slice(0, 180),
      });
    } else if (contentType === "comment" && decision.decision === "rejected") {
      await recordDomainEvent(connection, instituteCode, "comment.rejected", {
        actorId: null,
        actorName: "Moderação automática",
        actorAvatar: "",
        authorId: content.userId,
        postId: Number(content.postId),
        commentId: content.id,
        reason: reason || "O comentário não cumpre as regras da comunidade.",
      });
    }
    const scheduledForFuture = contentType === "post"
      && decision.decision === "approved"
      && content.publishAt
      && new Date(content.publishAt).getTime() > Date.now();
    if (
      ["post", "story", "avatar"].includes(contentType)
      && decision.decision === "approved"
      && !scheduledForFuture
    ) {
      if (contentType !== "post") {
        // Stories and avatar approvals become visible through their own
        // status fields; only posts feed the recommendation outbox.
      } else {
      await recordDomainEvent(connection, instituteCode, "post.approved", {
        actorId: null,
        actorName: "Moderação automática",
        actorAvatar: "",
        authorId: content.userId,
        postId: content.id,
      });
      }
    }
    if (contentType === "post" && decision.decision === "rejected") {
      await recordDomainEvent(connection, instituteCode, "post.rejected", {
        actorId: null,
        actorName: "Moderação automática",
        actorAvatar: "",
        authorId: content.userId,
        postId: content.id,
        reason: reason || "Conteúdo não permitido.",
      });
    }
    if (decision.decision === "needs_review") {
      await recordDomainEvent(connection, instituteCode, "content.under_review", {
        actorId: null,
        actorName: "Moderação automática",
        actorAvatar: "",
        authorId: content.userId,
        postId: contentType === "post" ? content.id : content.postId,
        commentId: contentType === "comment" ? content.id : null,
        contentType,
        contentId: content.id,
        reason: reason || "O conteúdo necessita de revisão humana.",
        failedAnalyzer: decision.failedAnalyzer || null,
      });
    }
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }

  if (decision.failedAnalyzer) {
    throw new Error(`Moderação incompleta: ${decision.failedAnalyzer}. O conteúdo ficou em revisão.`);
  }

  if (contentType === "post" && decision.decision === "approved") {
    const publishAt = content.publishAt ? new Date(content.publishAt).getTime() : 0;
    if (!publishAt || publishAt <= Date.now()) {
      await recommendationSync.syncPostNow({ instituteCode }, content.id).catch(() => {});
    }
  } else if (contentType === "post") {
    recommendationSync.schedulePostHidden({ instituteCode }, content.id);
  }
  if (contentType === "comment" && decision.decision === "approved") {
    recommendationSync.scheduleFeedback(
      { instituteCode, userId: content.userId },
      "comment",
      content.postId,
      { value: 1, comment: content.text }
    );
  }
  return { ...decision, results };
}

module.exports = {
  analyzeMedia,
  analyzeImageBuffer,
  analyzeToxicity,
  classifyClipBuffer,
  loadContent,
  loadNsfwModel,
  processModerationJob,
  quarantineContentMedia,
  updateContentStatus,
};
