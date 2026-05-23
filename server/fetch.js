let fetchImpl = typeof globalThis.fetch === "function" ? globalThis.fetch.bind(globalThis) : null;

if (!fetchImpl) {
  fetchImpl = require("node-fetch");
}

module.exports = fetchImpl;
