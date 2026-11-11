"use strict";

function runWithTimeout(work, timeoutMs, onTimeout = () => {}) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      const error = new Error(`O trabalho excedeu ${timeoutMs} ms.`);
      error.code = "MODERATION_JOB_TIMEOUT";
      onTimeout(error);
      reject(error);
    }, Math.max(1, Number(timeoutMs) || 1));
  });
  return Promise.race([Promise.resolve().then(work), timeout])
    .finally(() => clearTimeout(timer));
}

module.exports = { runWithTimeout };

