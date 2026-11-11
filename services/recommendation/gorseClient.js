"use strict";

class GorseUnavailableError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = "GorseUnavailableError";
    this.code = options.code || "GORSE_UNAVAILABLE";
    this.status = options.status || 503;
    this.cause = options.cause;
  }
}

function normalizeBaseUrl(value) {
  return String(value || "http://localhost:8087").replace(/\/+$/, "");
}

class GorseClient {
  constructor(options = {}) {
    this.baseUrl = normalizeBaseUrl(options.baseUrl || process.env.GORSE_SERVER_URL);
    this.apiKey = options.apiKey ?? process.env.GORSE_API_KEY ?? "";
    this.timeoutMs = Math.max(
      250,
      Number(options.timeoutMs || process.env.GORSE_TIMEOUT_MS || 2500)
    );
    this.enabled = options.enabled ?? String(process.env.GORSE_ENABLED || "true") !== "false";
    this.fetchImpl = options.fetchImpl || global.fetch;
  }

  async request(path, options = {}) {
    if (!this.enabled) {
      throw new GorseUnavailableError("Gorse está desativado.", {
        code: "GORSE_DISABLED",
      });
    }
    if (typeof this.fetchImpl !== "function") {
      throw new GorseUnavailableError("fetch não está disponível neste processo.", {
        code: "GORSE_FETCH_UNAVAILABLE",
      });
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        ...options,
        signal: controller.signal,
        headers: {
          Accept: "application/json",
          ...(options.body ? { "Content-Type": "application/json" } : {}),
          ...(this.apiKey ? { "X-API-Key": this.apiKey } : {}),
          ...(options.headers || {}),
        },
      });
      const text = await response.text();
      let payload = null;
      try {
        payload = text ? JSON.parse(text) : null;
      } catch {
        payload = text;
      }
      if (!response.ok) {
        throw new GorseUnavailableError(
          `Gorse respondeu HTTP ${response.status}.`,
          {
            code: "GORSE_HTTP_ERROR",
            status: response.status,
          }
        );
      }
      return payload;
    } catch (error) {
      if (error instanceof GorseUnavailableError) throw error;
      const aborted = error?.name === "AbortError";
      throw new GorseUnavailableError(
        aborted ? "O Gorse excedeu o tempo de resposta." : "Não foi possível contactar o Gorse.",
        {
          code: aborted ? "GORSE_TIMEOUT" : "GORSE_NETWORK_ERROR",
          cause: error,
        }
      );
    } finally {
      clearTimeout(timer);
    }
  }

  async insertUsers(users) {
    return this.request("/api/users", {
      method: "POST",
      body: JSON.stringify(users),
    });
  }

  async insertItems(items) {
    return this.request("/api/items", {
      method: "POST",
      body: JSON.stringify(items),
    });
  }

  async patchItem(itemId, patch) {
    return this.request(`/api/item/${encodeURIComponent(itemId)}`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    });
  }

  async insertFeedback(feedback, { overwrite = false } = {}) {
    return this.request("/api/feedback", {
      method: overwrite ? "PUT" : "POST",
      body: JSON.stringify(feedback),
    });
  }

  async deleteFeedback(userId, itemId, type = "") {
    const base = type
      ? `/api/feedback/${encodeURIComponent(type)}/${encodeURIComponent(userId)}/${encodeURIComponent(itemId)}`
      : `/api/feedback/${encodeURIComponent(userId)}/${encodeURIComponent(itemId)}`;
    return this.request(base, { method: "DELETE" });
  }

  async recommend(userId, { limit = 20, offset = 0 } = {}) {
    const query = new URLSearchParams({
      n: String(limit),
      offset: String(offset),
    });
    const payload = await this.request(
      `/api/recommend/${encodeURIComponent(userId)}?${query}`,
      { headers: { "X-API-Version": "2" } }
    );
    return (Array.isArray(payload) ? payload : [])
      .map((entry) => (
        typeof entry === "string"
          ? { id: entry, score: 0 }
          : {
              id: String(entry?.Id ?? entry?.id ?? ""),
              score: Number(entry?.Score ?? entry?.score ?? 0),
            }
      ))
      .filter((entry) => entry.id);
  }

  async userNeighbors(userId, { limit = 20, offset = 0 } = {}) {
    const query = new URLSearchParams({
      n: String(limit),
      offset: String(offset),
    });
    const payload = await this.request(
      `/api/user-to-user/neighbors/${encodeURIComponent(userId)}?${query}`
    );
    return (Array.isArray(payload) ? payload : [])
      .map((entry) => (
        typeof entry === "string"
          ? { id: entry, score: 0 }
          : {
              id: String(entry?.Id ?? entry?.id ?? ""),
              score: Number(entry?.Score ?? entry?.score ?? 0),
            }
      ))
      .filter((entry) => entry.id);
  }

  async itemNeighbors(itemId, { limit = 20, offset = 0 } = {}) {
    const query = new URLSearchParams({
      n: String(limit),
      offset: String(offset),
    });
    const payload = await this.request(
      `/api/item-to-item/neighbors/${encodeURIComponent(itemId)}?${query}`
    );
    return (Array.isArray(payload) ? payload : [])
      .map((entry) => (
        typeof entry === "string"
          ? { id: entry, score: 0 }
          : {
              id: String(entry?.Id ?? entry?.id ?? ""),
              score: Number(entry?.Score ?? entry?.score ?? 0),
            }
      ))
      .filter((entry) => entry.id);
  }

  async health() {
    return this.request("/api/health/ready");
  }
}

const gorseClient = new GorseClient();

module.exports = {
  GorseClient,
  GorseUnavailableError,
  gorseClient,
};
