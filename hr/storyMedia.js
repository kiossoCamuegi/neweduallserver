"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const multer = require("multer");
const { createRequire } = require("module");
const { pathToFileURL } = require("url");
const moderationRequire = createRequire(
  path.resolve(__dirname, "../moderation/package.json")
);

const STORY_MEDIA_DIR = path.resolve(__dirname, "..", "uploads", "hr-stories");
fs.mkdirSync(STORY_MEDIA_DIR, { recursive: true });

const MIME_EXTENSIONS = new Map([
  ["image/jpeg", ".jpg"],
  ["image/png", ".png"],
  ["image/webp", ".webp"],
  ["image/gif", ".gif"],
  ["video/mp4", ".mp4"],
  ["video/webm", ".webm"],
  ["video/quicktime", ".mov"],
  ["audio/mpeg", ".mp3"],
  ["audio/mp4", ".m4a"],
  ["audio/x-m4a", ".m4a"],
  ["audio/ogg", ".ogg"],
  ["audio/wav", ".wav"],
  ["audio/x-wav", ".wav"],
]);

function mediaKind(mimetype) {
  if (String(mimetype || "").startsWith("image/")) return "image";
  if (String(mimetype || "").startsWith("video/")) return "video";
  if (String(mimetype || "").startsWith("audio/")) return "audio";
  return "file";
}

const storage = multer.diskStorage({
  destination: (_req, _file, callback) => callback(null, STORY_MEDIA_DIR),
  filename: (_req, file, callback) => {
    const extension = MIME_EXTENSIONS.get(file.mimetype)
      || path.extname(file.originalname).toLowerCase().replace(/[^a-z0-9.]/g, "");
    callback(null, `${Date.now()}-${crypto.randomBytes(10).toString("hex")}${extension}`);
  },
});

const uploadStoryMedia = multer({
  storage,
  limits: {
    fileSize: 100 * 1024 * 1024,
    files: 17,
    fields: 12,
  },
  fileFilter: (_req, file, callback) => {
    if (!MIME_EXTENSIONS.has(file.mimetype)) {
      const error = new Error("Envie imagens, vídeos MP4/WebM/MOV ou áudio suportado.");
      error.status = 415;
      error.code = "HR_STORY_MEDIA_TYPE_INVALID";
      return callback(error);
    }
    return callback(null, true);
  },
}).fields([
  { name: "media", maxCount: 8 },
  { name: "poster", maxCount: 8 },
  { name: "music", maxCount: 1 },
]);

function cleanOriginalName(value) {
  return path.basename(String(value || "story"))
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .slice(0, 180) || "story";
}

function attachmentFromFile(file) {
  const storageKey = path.basename(file.filename);
  return {
    type: mediaKind(file.mimetype),
    name: cleanOriginalName(file.originalname),
    mime: file.mimetype,
    size: Number(file.size) || 0,
    storageKey,
  };
}

function storyAttachments(files = {}) {
  const slides = Array.isArray(files.media) ? files.media : [];
  const posters = Array.isArray(files.poster) ? files.poster : [];
  const music = Array.isArray(files.music) ? files.music : [];
  return {
    slides: slides.map(attachmentFromFile),
    posters: posters.map(attachmentFromFile),
    music: music[0] ? attachmentFromFile(music[0]) : null,
  };
}

function removeUploadedFiles(files = {}) {
  const all = [
    ...(Array.isArray(files.media) ? files.media : []),
    ...(Array.isArray(files.poster) ? files.poster : []),
    ...(Array.isArray(files.music) ? files.music : []),
  ];
  all.forEach((file) => {
    if (file?.path) fs.unlink(file.path, () => {});
  });
}

function safeStoryMediaPath(storageKey) {
  const key = path.basename(String(storageKey || ""));
  if (!key || key !== storageKey || !/^[a-zA-Z0-9._-]+$/.test(key)) return null;
  const target = path.resolve(STORY_MEDIA_DIR, key);
  if (!target.startsWith(`${STORY_MEDIA_DIR}${path.sep}`)) return null;
  return target;
}

async function validateStoryUploadedFiles(uploaded = {}) {
  const { fileTypeFromFile } = await import(
    pathToFileURL(moderationRequire.resolve("file-type")).href
  );
  const sharp = moderationRequire("sharp");
  const files = [
    ...(uploaded.slides || []),
    ...(uploaded.posters || []),
  ];
  for (const file of files) {
    const detected = await fileTypeFromFile(file.path);
    const clientMime = String(file.mimetype || "").toLowerCase();
    if (!detected?.mime || detected.mime !== clientMime) {
      const error = new Error(
        `O conteúdo de ${file.name || "story"} não corresponde ao formato indicado.`
      );
      error.status = 415;
      error.code = "HR_STORY_MEDIA_SIGNATURE_INVALID";
      throw error;
    }
    const extension = path.extname(file.name || "").toLowerCase();
    if (extension && MIME_EXTENSIONS.get(detected.mime) !== extension) {
      const error = new Error(
        `A extensão de ${file.name || "story"} não corresponde ao conteúdo real.`
      );
      error.status = 415;
      error.code = "HR_STORY_MEDIA_EXTENSION_MISMATCH";
      throw error;
    }
    if (detected.mime.startsWith("image/")) {
      const metadata = await sharp(file.path, {
        failOn: "error",
        limitInputPixels: Number(process.env.MODERATION_IMAGE_MAX_PIXELS) || 40_000_000,
      }).metadata().catch(() => null);
      if (!metadata) {
        const error = new Error(`Não foi possível descodificar ${file.name || "a imagem"}.`);
        error.status = 422;
        error.code = "HR_STORY_IMAGE_INVALID";
        throw error;
      }
    }
  }
}

module.exports = {
  STORY_MEDIA_DIR,
  removeUploadedFiles,
  safeStoryMediaPath,
  storyAttachments,
  uploadStoryMedia,
  validateStoryUploadedFiles,
};
