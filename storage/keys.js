"use strict";

function normalizeStorageKey(value) {
  const raw = String(value || "").replace(/\\/g, "/");
  if (!raw || raw.startsWith("/") || raw.length > 400) return null;
  const segments = raw.split("/");
  if (segments.some((segment) => (
    !segment
    || segment === "."
    || segment === ".."
    || !/^[a-zA-Z0-9._-]+$/.test(segment)
  ))) {
    return null;
  }
  return segments.join("/");
}

function storageBasename(value) {
  const key = normalizeStorageKey(value);
  return key ? key.split("/").pop() : "";
}

module.exports = {
  normalizeStorageKey,
  storageBasename,
};
