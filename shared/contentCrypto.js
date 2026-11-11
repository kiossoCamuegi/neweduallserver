"use strict";

const crypto = require("crypto");

const PREFIX = "enc:v1:";

function secretKey() {
  const raw = String(process.env.CRYPTO_SECRET_KEY || "");
  if (!/^[a-f0-9]{64}$/i.test(raw)) {
    throw new Error("CRYPTO_SECRET_KEY deve ter 64 caracteres hexadecimais.");
  }
  return Buffer.from(raw, "hex");
}

function isEncryptedContent(value) {
  return typeof value === "string" && value.startsWith(PREFIX);
}

function encryptContent(value) {
  const text = String(value ?? "");
  if (!text || isEncryptedContent(text)) return text;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", secretKey(), iv);
  const encrypted = Buffer.concat([cipher.update(text, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${PREFIX}${iv.toString("base64url")}:${tag.toString("base64url")}:${encrypted.toString("base64url")}`;
}

function decryptContent(value) {
  if (!isEncryptedContent(value)) return String(value ?? "");
  const [ivPart, tagPart, encryptedPart] = value.slice(PREFIX.length).split(":");
  if (!ivPart || !tagPart || encryptedPart === undefined) {
    throw new Error("Conteúdo cifrado inválido.");
  }
  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    secretKey(),
    Buffer.from(ivPart, "base64url")
  );
  decipher.setAuthTag(Buffer.from(tagPart, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(encryptedPart, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

function safeDecryptContent(value, fallback = "") {
  try {
    return decryptContent(value);
  } catch (error) {
    console.error("[content-crypto] Não foi possível desencriptar conteúdo:", error.message);
    return fallback;
  }
}

module.exports = {
  PREFIX,
  decryptContent,
  encryptContent,
  isEncryptedContent,
  safeDecryptContent,
};
