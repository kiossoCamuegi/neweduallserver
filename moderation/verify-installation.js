"use strict";

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const root = path.resolve(__dirname, "..");
const modelDir = path.resolve(
  root,
  process.env.MODERATION_CLIP_MODEL_DIR || "models/clip-vit-base-patch32"
);

function commandPath(name) {
  const finder = process.platform === "win32" ? "where" : "which";
  const result = spawnSync(finder, [name], { encoding: "utf8" });
  return result.status === 0 ? result.stdout.trim().split(/\r?\n/)[0] : "";
}

const checks = [];
function check(name, ok, detail) {
  checks.push({ name, ok: Boolean(ok), detail });
}

check("Node.js 22+", Number(process.versions.node.split(".")[0]) >= 22, process.version);
for (const name of ["ffmpeg", "ffprobe", "pdftoppm", "pdftotext"]) {
  const located = commandPath(name);
  check(name, located, located || "não encontrado no PATH");
}
for (const moduleName of [
  "bullmq",
  "nsfwjs",
  "@tensorflow/tfjs-node",
  "@huggingface/transformers",
  "file-type",
  "sharp",
]) {
  try {
    require.resolve(moduleName, { paths: [__dirname] });
    check(moduleName, true, "instalado");
  } catch {
    check(moduleName, false, "em falta");
  }
}
try {
  require("@tensorflow/tfjs-node");
  check("TensorFlow backend", true, "addon nativo");
} catch {
  try {
    require("@tensorflow/tfjs");
    check("TensorFlow backend", true, "CPU puro (fallback)");
  } catch (error) {
    check("TensorFlow backend", false, error.message);
  }
}
check(
  "Modelo CLIP local",
  fs.existsSync(path.join(modelDir, "config.json"))
    && fs.existsSync(path.join(modelDir, "onnx", "model_quantized.onnx")),
  modelDir
);
const venv = process.platform === "win32"
  ? path.join(__dirname, ".venv", "Scripts", "python.exe")
  : path.join(__dirname, ".venv", "bin", "python");
check("toxicity-api venv", fs.existsSync(venv), venv);

for (const item of checks) {
  console.log(`${item.ok ? "OK" : "ERRO"} ${item.name}: ${item.detail}`);
}
if (checks.some((item) => !item.ok)) process.exitCode = 1;

