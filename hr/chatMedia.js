"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const multer = require("multer");

const CHAT_MEDIA_DIR = path.resolve(__dirname, "..", "uploads", "hr-chat");
fs.mkdirSync(CHAT_MEDIA_DIR, { recursive: true });

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
  ["audio/webm", ".webm"],
  ["audio/ogg", ".ogg"],
  ["audio/wav", ".wav"],
  ["application/pdf", ".pdf"],
  ["application/msword", ".doc"],
  ["application/vnd.openxmlformats-officedocument.wordprocessingml.document", ".docx"],
  ["application/vnd.ms-excel", ".xls"],
  ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", ".xlsx"],
  ["application/vnd.ms-powerpoint", ".ppt"],
  ["application/vnd.openxmlformats-officedocument.presentationml.presentation", ".pptx"],
  ["text/plain", ".txt"],
  ["text/csv", ".csv"],
  ["application/zip", ".zip"],
  ["application/x-zip-compressed", ".zip"],
]);
const ALLOWED_EXTENSIONS = new Set(MIME_EXTENSIONS.values());
const MEDIA_EXTENSION_TYPES = new Map([
  [".jpg", "image"], [".jpeg", "image"], [".png", "image"],
  [".webp", "image"], [".gif", "image"],
  [".mp4", "video"], [".webm", "video"], [".mov", "video"],
  [".mp3", "audio"], [".m4a", "audio"], [".ogg", "audio"], [".wav", "audio"],
]);
const EXTENSION_MIMES = new Map(
  [...MIME_EXTENSIONS.entries()].map(([mime, extension]) => [extension, mime])
);

function mediaType(mimetype) {
  const mime = normalizedMimeType(mimetype);
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("audio/")) return "audio";
  return "file";
}

function detectedMediaType(file) {
  const fromMime = mediaType(file.mimetype);
  if (fromMime !== "file") return fromMime;
  return MEDIA_EXTENSION_TYPES.get(
    path.extname(file.originalname || "").toLowerCase()
  ) || "file";
}

function normalizedMimeType(mimetype) {
  return String(mimetype || "").split(";")[0].trim().toLowerCase();
}

const storage = multer.diskStorage({
  destination: (_req, _file, callback) => callback(null, CHAT_MEDIA_DIR),
  filename: (_req, file, callback) => {
    const extension = MIME_EXTENSIONS.get(normalizedMimeType(file.mimetype))
      || path.extname(file.originalname).toLowerCase().replace(/[^a-z0-9.]/g, "");
    callback(null, `${Date.now()}-${crypto.randomBytes(10).toString("hex")}${extension}`);
  },
});

const uploadChatMedia = multer({
  storage,
  limits: {
    fileSize: 20 * 1024 * 1024,
    files: 25,
    fields: 8,
  },
  fileFilter: (_req, file, callback) => {
    const extension = path.extname(file.originalname || "").toLowerCase();
    if (
      !MIME_EXTENSIONS.has(normalizedMimeType(file.mimetype)) &&
      !ALLOWED_EXTENSIONS.has(extension)
    ) {
      const error = new Error(
        "Tipo de ficheiro não permitido. Use imagens, vídeos, áudio ou documentos suportados."
      );
      error.status = 415;
      error.code = "HR_CHAT_MEDIA_TYPE_INVALID";
      return callback(error);
    }
    return callback(null, true);
  },
}).array("media", 25);

function cleanOriginalName(value) {
  return path.basename(String(value || "anexo"))
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .slice(0, 180) || "anexo";
}

function attachmentsFromFiles(files = []) {
  return files.map((file) => {
    const storageKey = path.basename(file.filename);
    const type = detectedMediaType(file);
    return {
      id: crypto.randomBytes(8).toString("hex"),
      type,
      kind: type,
      name: cleanOriginalName(file.originalname),
      mime: normalizedMimeType(file.mimetype),
      size: Number(file.size) || 0,
      storageKey,
      url: `/api/hr/chat/media/${encodeURIComponent(storageKey)}`,
    };
  });
}

function attachmentFromStorageKey(storageKey) {
  const key = path.basename(String(storageKey || ""));
  if (!key || key !== storageKey) return null;
  const extension = path.extname(key).toLowerCase();
  const mime = EXTENSION_MIMES.get(extension) || "application/octet-stream";
  const type = MEDIA_EXTENSION_TYPES.get(extension) || "file";
  return {
    id: key,
    type,
    kind: type,
    name: key,
    mime,
    storageKey: key,
    url: `/api/hr/chat/media/${encodeURIComponent(key)}`,
  };
}

function safeChatMediaPath(storageKey) {
  const key = path.basename(String(storageKey || ""));
  if (!key || key !== storageKey || !/^[a-zA-Z0-9._-]+$/.test(key)) return null;
  const target = path.resolve(CHAT_MEDIA_DIR, key);
  if (!target.startsWith(`${CHAT_MEDIA_DIR}${path.sep}`)) return null;
  return target;
}

function removeChatUploadedFiles(files = []) {
  for (const file of files) {
    if (file?.path) fs.unlink(file.path, () => {});
  }
}

module.exports = {
  CHAT_MEDIA_DIR,
  attachmentFromStorageKey,
  attachmentsFromFiles,
  removeChatUploadedFiles,
  safeChatMediaPath,
  uploadChatMedia,
};
