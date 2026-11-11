"use strict";

const fs = require("fs");
const path = require("path");
const { normalizeStorageKey } = require("./keys");

class LocalStorage {
  constructor(options = {}) {
    this.root = path.resolve(
      options.root || process.env.STORAGE_LOCAL_DIR || path.join(__dirname, "..", "uploads", "media")
    );
    fs.mkdirSync(this.root, { recursive: true });
  }

  safeKey(key) {
    const clean = normalizeStorageKey(key);
    if (!clean) return null;
    const target = path.resolve(this.root, clean);
    return target.startsWith(`${this.root}${path.sep}`) ? target : null;
  }

  async save(buffer, key) {
    const target = this.safeKey(key);
    if (!target) throw new Error("Chave de armazenamento inválida.");
    await fs.promises.mkdir(path.dirname(target), { recursive: true });
    await fs.promises.writeFile(target, buffer, { flag: "wx" }).catch((error) => {
      if (error.code !== "EEXIST") throw error;
    });
    return { key, path: target };
  }

  async get(key, options = {}) {
    const target = this.safeKey(key);
    if (!target) return null;
    const stat = await fs.promises.stat(target).catch(() => null);
    if (!stat?.isFile()) return null;
    const range = options.range;
    if (!range) {
      return {
        kind: "local",
        path: target,
        size: stat.size,
        local: true,
      };
    }
    const match = /^bytes=(\d*)-(\d*)$/.exec(String(range));
    if (!match) return null;
    const start = match[1] ? Number(match[1]) : 0;
    const end = match[2] ? Number(match[2]) : stat.size - 1;
    if (start > end || start >= stat.size) return null;
    return {
      kind: "stream",
      local: true,
      path: target,
      size: stat.size,
      start,
      end: Math.min(end, stat.size - 1),
      stream: fs.createReadStream(target, { start, end: Math.min(end, stat.size - 1) }),
    };
  }

  async delete(key) {
    const target = this.safeKey(key);
    if (!target) return false;
    await fs.promises.unlink(target).catch((error) => {
      if (error.code !== "ENOENT") throw error;
    });
    return true;
  }

  async getUrl(key) {
    return `/api/hr/feed/media/${key}`;
  }
}

module.exports = LocalStorage;
