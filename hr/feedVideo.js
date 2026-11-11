"use strict";

function findBoxes(buffer, start = 0, end = buffer.length) {
  const boxes = [];
  let offset = start;
  while (offset + 8 <= end) {
    let size = buffer.readUInt32BE(offset);
    const type = buffer.toString("ascii", offset + 4, offset + 8);
    let headerSize = 8;
    if (size === 1 && offset + 16 <= end) {
      size = Number(buffer.readBigUInt64BE(offset + 8));
      headerSize = 16;
    } else if (size === 0) {
      size = end - offset;
    }
    if (size < headerSize || offset + size > end) break;
    boxes.push({ type, start: offset, content: offset + headerSize, end: offset + size });
    offset += size;
  }
  return boxes;
}

function inspectMp4Buffer(buffer) {
  const top = findBoxes(buffer);
  const ftyp = top.find((box) => box.type === "ftyp");
  if (!ftyp) return null;
  const moov = top.find((box) => box.type === "moov");
  if (!moov) return { duration: 0, width: 0, height: 0 };
  let duration = 0;
  let width = 0;
  let height = 0;
  for (const box of findBoxes(buffer, moov.content, moov.end)) {
    if (box.type === "mvhd" && box.content + 20 <= box.end) {
      const version = buffer[box.content];
      const timescaleOffset = box.content + (version === 1 ? 20 : 12);
      const durationOffset = box.content + (version === 1 ? 24 : 16);
      const timescale = version === 1
        ? Number(buffer.readBigUInt64BE(timescaleOffset))
        : buffer.readUInt32BE(timescaleOffset);
      const units = version === 1
        ? Number(buffer.readBigUInt64BE(durationOffset))
        : buffer.readUInt32BE(durationOffset);
      if (timescale) duration = units / timescale;
    }
    if (box.type === "trak") {
      for (const child of findBoxes(buffer, box.content, box.end)) {
        if (child.type !== "tkhd" || child.end - 8 < child.content) continue;
        const boxWidth = Math.round(buffer.readUInt32BE(child.end - 8) / 65536);
        const boxHeight = Math.round(buffer.readUInt32BE(child.end - 4) / 65536);
        width = Math.max(width, boxWidth);
        height = Math.max(height, boxHeight);
      }
    }
  }
  return { duration, width, height };
}

function videoLimitMb() {
  return Math.min(30, Math.max(1, Number(process.env.VIDEO_UPLOAD_MAX_MB) || 30));
}

function maxDurationSeconds() {
  return Math.max(1, Number(process.env.VIDEO_MAX_DURATION_SECONDS) || 180);
}

function attachmentLimitMb() {
  return Math.min(4, Math.max(1, Number(process.env.VIDEO_IMAGE_UPLOAD_MAX_MB) || 4));
}

module.exports = {
  attachmentLimitMb,
  inspectMp4Buffer,
  maxDurationSeconds,
  videoLimitMb,
};
