"use strict";

const crypto = require("crypto");

function hmac(key, value, encoding) {
  return crypto.createHmac("sha256", key).update(value).digest(encoding);
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

class S3Storage {
  constructor(options = {}) {
    this.endpoint = String(options.endpoint || process.env.STORAGE_S3_ENDPOINT || "").replace(/\/+$/, "");
    this.bucket = options.bucket || process.env.STORAGE_S3_BUCKET || "";
    this.region = options.region || process.env.STORAGE_S3_REGION || "us-east-1";
    this.accessKey = options.accessKey || process.env.STORAGE_S3_ACCESS_KEY || "";
    this.secretKey = options.secretKey || process.env.STORAGE_S3_SECRET_KEY || "";
    this.forcePathStyle = String(process.env.STORAGE_S3_FORCE_PATH_STYLE || "true") !== "false";
    this.publicBaseUrl = options.publicBaseUrl || process.env.STORAGE_S3_PUBLIC_BASE_URL || "";
    if (!this.endpoint || !this.bucket || !this.accessKey || !this.secretKey) {
      throw new Error("Configuração S3 incompleta.");
    }
  }

  objectUrl(key) {
    return this.forcePathStyle
      ? `${this.endpoint}/${encodeURIComponent(this.bucket)}/${key}`
      : `${this.endpoint.replace("://", `://${this.bucket}.`)}/${key}`;
  }

  sign(method, key, body = Buffer.alloc(0), extraHeaders = {}) {
    const target = new URL(this.objectUrl(key));
    const now = new Date();
    const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
    const date = amzDate.slice(0, 8);
    const contentHash = sha256(body);
    const headers = {
      host: target.host,
      "x-amz-content-sha256": contentHash,
      "x-amz-date": amzDate,
      ...Object.fromEntries(Object.entries(extraHeaders).map(([name, value]) => [name.toLowerCase(), value])),
    };
    const signedHeaders = Object.keys(headers).sort().join(";");
    const canonicalHeaders = Object.keys(headers).sort()
      .map((name) => `${name}:${String(headers[name]).trim()}\n`)
      .join("");
    const canonicalRequest = [
      method,
      target.pathname,
      "",
      canonicalHeaders,
      signedHeaders,
      contentHash,
    ].join("\n");
    const scope = `${date}/${this.region}/s3/aws4_request`;
    const stringToSign = [
      "AWS4-HMAC-SHA256",
      amzDate,
      scope,
      sha256(canonicalRequest),
    ].join("\n");
    const dateKey = hmac(`AWS4${this.secretKey}`, date);
    const regionKey = hmac(dateKey, this.region);
    const serviceKey = hmac(regionKey, "s3");
    const signingKey = hmac(serviceKey, "aws4_request");
    const signature = hmac(signingKey, stringToSign, "hex");
    return {
      url: target.toString(),
      headers: {
        ...headers,
        Authorization: `AWS4-HMAC-SHA256 Credential=${this.accessKey}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
      },
    };
  }

  async save(buffer, key, contentType = "application/octet-stream") {
    const signed = this.sign("PUT", key, buffer, { "content-type": contentType });
    const response = await fetch(signed.url, {
      method: "PUT",
      headers: signed.headers,
      body: buffer,
    });
    if (!response.ok) throw new Error(`S3 PUT falhou (${response.status}).`);
    return { key };
  }

  async get(key, options = {}) {
    const extra = options.range ? { range: options.range } : {};
    const signed = this.sign("GET", key, Buffer.alloc(0), extra);
    const response = await fetch(signed.url, { headers: signed.headers });
    if (!response.ok || !response.body) return null;
    return {
      kind: "remote",
      local: false,
      response,
      size: Number(response.headers.get("content-length")) || 0,
      start: response.headers.get("content-range"),
      stream: response.body,
    };
  }

  async delete(key) {
    const signed = this.sign("DELETE", key);
    const response = await fetch(signed.url, { method: "DELETE", headers: signed.headers });
    return response.ok || response.status === 404;
  }

  async getUrl(key) {
    return this.publicBaseUrl
      ? `${this.publicBaseUrl.replace(/\/+$/, "")}/${key}`
      : `/api/hr/feed/media/${key}`;
  }
}

module.exports = S3Storage;
