"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { execFile } = require("child_process");
const { createRequire } = require("module");
const { pathToFileURL } = require("url");
const multer = require("multer");
const { storage } = require("../storage");
const moderationRequire = createRequire(
  path.resolve(__dirname, "../moderation/package.json")
);
const { normalizeStorageKey } = require("../storage/keys");
const {
  attachmentLimitMb,
  inspectMp4Buffer,
  maxDurationSeconds,
  videoLimitMb,
} = require("./feedVideo");

const TEMP_DIR = path.resolve(__dirname, "..", "uploads", ".feed-temp");
fs.mkdirSync(TEMP_DIR, { recursive: true });

const MIME_EXTENSIONS = new Map([
  ["image/jpeg", ".jpg"],
  ["image/png", ".png"],
  ["image/webp", ".webp"],
  ["image/gif", ".gif"],
  ["video/mp4", ".mp4"],
  ["application/pdf", ".pdf"],
]);
const ALLOWED_EXTENSIONS = new Map([
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".png", "image/png"],
  [".webp", "image/webp"],
  [".gif", "image/gif"],
  [".mp4", "video/mp4"],
  [".pdf", "application/pdf"],
]);

const uploadStorage = multer.diskStorage({
  destination: (_req, _file, callback) => callback(null, TEMP_DIR),
  filename: (_req, file, callback) => {
    const extension = MIME_EXTENSIONS.get(file.mimetype) || "";
    callback(null, `${Date.now()}-${crypto.randomBytes(10).toString("hex")}${extension}`);
  },
});

const uploadFeedMedia = multer({
  storage: uploadStorage,
  limits: {
    fileSize: videoLimitMb() * 1024 * 1024,
    files: 6,
    fields: 12,
  },
  fileFilter: (_req, file, callback) => {
    if (!MIME_EXTENSIONS.has(file.mimetype)) {
      const error = new Error("Envie imagens, vídeo MP4 ou documento PDF.");
      error.status = 415;
      error.code = "HR_FEED_MEDIA_TYPE_INVALID";
      return callback(error);
    }
    return callback(null, true);
  },
}).fields([
  { name: "media", maxCount: 5 },
  { name: "poster", maxCount: 1 },
]);

function requestedMediaType(mimetype) {
  if (String(mimetype || "").startsWith("image/")) return "image";
  if (String(mimetype || "").startsWith("video/")) return "video";
  return "file";
}

function cleanOriginalName(value) {
  return path.basename(String(value || "anexo"))
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .slice(0, 180) || "anexo";
}

function detectActualMime(buffer) {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return "image/jpeg";
  }
  if (buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return "image/png";
  }
  if (buffer.subarray(0, 6).toString("ascii").match(/^GIF8[79]a$/)) return "image/gif";
  if (buffer.subarray(0, 4).toString("ascii") === "RIFF"
    && buffer.subarray(8, 12).toString("ascii") === "WEBP") {
    return "image/webp";
  }
  if (buffer.subarray(0, 5).toString("ascii") === "%PDF-") return "application/pdf";
  if (buffer.length >= 12 && buffer.subarray(4, 8).toString("ascii") === "ftyp") {
    return "video/mp4";
  }
  return "";
}

async function detectActualMimeFromFile(filePath, header) {
  try {
    const { fileTypeFromFile } = await import(
      pathToFileURL(moderationRequire.resolve("file-type")).href
    );
    const detected = await fileTypeFromFile(filePath);
    if (detected?.mime) return detected.mime;
  } catch {
    // Mantém o detector local enquanto a dependência ainda não estiver instalada.
  }
  return detectActualMime(header);
}

async function inspectImage(filePath) {
  try {
    const sharp = moderationRequire("sharp");
    const metadata = await sharp(filePath, { failOn: "error" }).metadata();
    return {
      width: Number(metadata.width) || 0,
      height: Number(metadata.height) || 0,
      format: metadata.format || "",
    };
  } catch {
    return null;
  }
}

function probeVideo(filePath) {
  return new Promise((resolve) => {
    execFile(
      process.env.MODERATION_FFPROBE_PATH || "ffprobe",
      [
        "-v", "error",
        "-show_entries", "format=duration",
        "-show_entries", "stream=width,height,duration",
        "-of", "json",
        filePath,
      ],
      { timeout: 15_000, maxBuffer: 2 * 1024 * 1024 },
      (error, stdout) => {
        if (error) return resolve(null);
        try {
          const payload = JSON.parse(stdout || "{}");
          const stream = payload.streams?.[0] || {};
          resolve({
            duration: Number(payload.format?.duration || stream.duration) || 0,
            width: Number(stream.width) || 0,
            height: Number(stream.height) || 0,
          });
        } catch {
          resolve(null);
        }
      }
    );
  });
}

async function validateUploadedFiles(files = {}) {
  const media = Array.isArray(files.media) ? files.media : [];
  const posters = Array.isArray(files.poster) ? files.poster : [];
  const all = [...media, ...posters];
  for (const file of all) {
    const handle = await fs.promises.open(file.path, "r");
    const header = Buffer.alloc(32);
    try {
      await handle.read(header, 0, header.length, 0);
    } finally {
      await handle.close();
    }
    const actualMime = await detectActualMimeFromFile(file.path, header);
    if (!actualMime || actualMime !== file.mimetype) {
      const error = new Error(`O conteúdo de ${file.originalname} não corresponde ao formato indicado.`);
      error.status = 415;
      error.code = "HR_FEED_MEDIA_SIGNATURE_INVALID";
      throw error;
    }
    const extension = path.extname(String(file.originalname || "")).toLowerCase();
    if (!extension || ALLOWED_EXTENSIONS.get(extension) !== actualMime) {
      const error = new Error(
        `A extensão de ${file.originalname} não corresponde ao conteúdo real do ficheiro.`
      );
      error.status = 415;
      error.code = "HR_FEED_MEDIA_EXTENSION_MISMATCH";
      throw error;
    }
    if (actualMime.startsWith("video/")) {
      if (file.size > videoLimitMb() * 1024 * 1024) {
        const error = new Error(`Cada vídeo pode ter no máximo ${videoLimitMb()} MB.`);
        error.status = 413;
        error.code = "HR_FEED_VIDEO_TOO_LARGE";
        throw error;
      }
      const buffer = await fs.promises.readFile(file.path);
      const metadata = inspectMp4Buffer(buffer) || await probeVideo(file.path);
      if (!metadata) {
        const error = new Error("O vídeo MP4 está corrompido ou não pôde ser validado.");
        error.status = 422;
        error.code = "HR_FEED_VIDEO_INVALID";
        throw error;
      }
      if (metadata.duration > maxDurationSeconds() + 2) {
        const error = new Error(`O vídeo excede a duração máxima de ${maxDurationSeconds()} segundos.`);
        error.status = 422;
        error.code = "HR_FEED_VIDEO_DURATION_LIMIT";
        throw error;
      }
      file.videoMetadata = metadata;
    } else if (file.size > attachmentLimitMb() * 1024 * 1024) {
      const error = new Error(`Imagens, posters e documentos podem ter no máximo ${attachmentLimitMb()} MB.`);
      error.status = 413;
      error.code = "HR_FEED_ATTACHMENT_TOO_LARGE";
      throw error;
    } else if (actualMime.startsWith("image/")) {
      const metadata = await inspectImage(file.path);
      if (!metadata) {
        const error = new Error(`Não foi possível descodificar a imagem ${file.originalname}.`);
        error.status = 422;
        error.code = "HR_FEED_IMAGE_INVALID";
        throw error;
      }
      const maxWidth = Math.max(1, Number(process.env.MODERATION_IMAGE_MAX_WIDTH) || 4096);
      const maxHeight = Math.max(1, Number(process.env.MODERATION_IMAGE_MAX_HEIGHT) || 4096);
      const maxPixels = Math.max(
        1_000_000,
        Number(process.env.MODERATION_IMAGE_MAX_PIXELS) || 40_000_000
      );
      if (
        metadata.width > maxWidth
        || metadata.height > maxHeight
        || metadata.width * metadata.height > maxPixels
      ) {
        const error = new Error(
          `A imagem ${file.originalname} excede as dimensões permitidas.`
        );
        error.status = 422;
        error.code = "HR_FEED_IMAGE_DIMENSIONS_LIMIT";
        throw error;
      }
      file.imageMetadata = metadata;
    }
  }
  if (posters.some((file) => !file.mimetype.startsWith("image/"))) {
    const error = new Error("O poster do vídeo tem de ser uma imagem.");
    error.status = 415;
    error.code = "HR_FEED_POSTER_INVALID";
    throw error;
  }
}

function uniqueStorageKey(file, ctx) {
  const hash = crypto.createHash("sha256");
  const stream = fs.createReadStream(file.path);
  return new Promise((resolve, reject) => {
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", () => {
      const extension = MIME_EXTENSIONS.get(file.mimetype) || "";
      const tenant = crypto
        .createHash("sha256")
        .update(String(ctx?.instituteCode || "tenant"))
        .digest("hex")
        .slice(0, 16);
      const userId = Math.max(0, Number(ctx?.userId) || 0);
      resolve(`tenants/${tenant}/users/${userId}/feed/${hash.digest("hex")}${extension}`);
    });
  });
}

async function persistFile(file, ctx) {
  const storageKey = await uniqueStorageKey(file, ctx);
  const buffer = await fs.promises.readFile(file.path);
  await storage.save(buffer, storageKey, file.mimetype);
  return {
    type: requestedMediaType(file.mimetype),
    name: cleanOriginalName(file.originalname),
    mime: file.mimetype,
    size: Number(file.size) || buffer.length,
    storageKey,
    url: await storage.getUrl(storageKey),
    ...(file.videoMetadata
      ? {
          duration: Number(file.videoMetadata.duration) || 0,
          width: Number(file.videoMetadata.width) || 0,
          height: Number(file.videoMetadata.height) || 0,
        }
      : {}),
    ...(file.imageMetadata
      ? {
          width: Number(file.imageMetadata.width) || 0,
          height: Number(file.imageMetadata.height) || 0,
        }
      : {}),
  };
}

async function persistUploadedFeed(files = {}, clientMetadata = null, ctx = null) {
  const mediaFiles = Array.isArray(files.media) ? files.media : [];
  const posterFiles = Array.isArray(files.poster) ? files.poster : [];
  const attachments = [];
  for (const file of mediaFiles) attachments.push(await persistFile(file, ctx));
  let poster = null;
  if (posterFiles[0]) poster = await persistFile(posterFiles[0], ctx);
  if (attachments[0]?.type === "video") {
    const metadata = attachments[0];
    const clientDuration = Number(clientMetadata?.duration) || 0;
    if (
      clientDuration > 0
      && metadata.duration > 0
      && Math.abs(clientDuration - metadata.duration) > 3
    ) {
      const error = new Error("A duração declarada pelo cliente não corresponde ao vídeo enviado.");
      error.status = 422;
      error.code = "HR_FEED_VIDEO_METADATA_INVALID";
      throw error;
    }
    attachments[0] = {
      ...metadata,
      poster: poster
        ? {
            storageKey: poster.storageKey,
            url: poster.url,
            mime: poster.mime,
            size: poster.size,
          }
        : null,
    };
  } else if (poster) {
    attachments.push(poster);
  }
  return attachments;
}

function removeUploadedFiles(files = {}) {
  const all = [
    ...(Array.isArray(files.media) ? files.media : []),
    ...(Array.isArray(files.poster) ? files.poster : []),
  ];
  all.forEach((file) => {
    if (file?.path) fs.unlink(file.path, () => {});
  });
}

async function removeStoredAttachments(attachments = []) {
  const keys = new Set();
  attachments.forEach((attachment) => {
    if (attachment?.storageKey) keys.add(attachment.storageKey);
    if (attachment?.poster?.storageKey) keys.add(attachment.poster.storageKey);
  });
  await Promise.allSettled([...keys].map((key) => storage.delete(key)));
}

function safeMediaPath(storageKey) {
  return normalizeStorageKey(storageKey);
}

module.exports = {
  MIME_EXTENSIONS,
  TEMP_DIR,
  persistUploadedFeed,
  removeUploadedFiles,
  removeStoredAttachments,
  safeMediaPath,
  uploadFeedMedia,
  validateUploadedFiles,
};
