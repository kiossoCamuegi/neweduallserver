"use strict";

class RecommendationQueue {
  constructor(options = {}) {
    this.maxAttempts = Math.max(
      1,
      Number(options.maxAttempts || process.env.GORSE_RETRY_MAX_ATTEMPTS || 4)
    );
    this.baseDelayMs = Math.max(
      50,
      Number(options.baseDelayMs || process.env.GORSE_RETRY_BASE_MS || 500)
    );
    this.pending = new Set();
    this.onError = options.onError || ((error, label) => {
      console.warn(`[recommendations:${label}] ${error.message}`);
    });
  }

  enqueue(label, task) {
    const key = String(label || "task");
    if (this.pending.has(key)) return false;
    this.pending.add(key);
    this.run(key, task, 1);
    return true;
  }

  async run(key, task, attempt) {
    try {
      await task();
      this.pending.delete(key);
    } catch (error) {
      if (attempt >= this.maxAttempts) {
        this.pending.delete(key);
        this.onError(error, key);
        return;
      }
      const delay = this.baseDelayMs * 2 ** (attempt - 1);
      setTimeout(() => this.run(key, task, attempt + 1), delay);
    }
  }
}

const recommendationQueue = new RecommendationQueue();

module.exports = {
  RecommendationQueue,
  recommendationQueue,
};
