"use strict";

const LocalStorage = require("./localStorage");
const S3Storage = require("./s3Storage");

const driver = String(process.env.STORAGE_DRIVER || "local").toLowerCase();
const storage = driver === "s3" ? new S3Storage() : new LocalStorage();

module.exports = {
  driver,
  storage,
};
