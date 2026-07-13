const assert = require("assert");
const fs = require("fs");
const http = require("http");
const path = require("path");
const fetch = require("node-fetch");

const { handle, readDb, writeDb } = require("../server/server");

const root = path.resolve(__dirname, "..");
const dbFile = path.join(root, "server", "data", "db.json");
const total = Number(process.env.CONCURRENCY_TOTAL || 100);
const parallel = Number(process.env.CONCURRENCY_PARALLEL || total);
const runTag = `concurrency_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

function percentile(values, p) {
  if (!values.length) return 0;
  const index = Math.min(values.length - 1, Math.ceil((p / 100) * values.length) - 1);
  return values[index];
}

function makePayload(index) {
  return {
    taskCode: "qf4M84e",
    projectId: "concurrency-test",
    projectName: "Concurrency Test",
    taskTitle: "Concurrency Test",
    gameId: `${runTag}_user_${index}`,
    orderNo: `${runTag}_order_${index}`,
    gameIdImageFileId: `https://example.test/${runTag}/game-id-${index}.jpg`,
    orderImageFileId: `https://example.test/${runTag}/order-${index}.jpg`,
    videoFileId: `https://example.test/${runTag}/video-${index}.mp4`,
    downloadVideoFileId: `https://example.test/${runTag}/download-video-${index}.mp4`,
    clientBuildTag: runTag
  };
}

async function postSubmission(baseUrl, index) {
  const startedAt = Date.now();
  const res = await fetch(`${baseUrl}/api/submissions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(makePayload(index))
  });
  const text = await res.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch (error) {
    data = { raw: text };
  }
  return {
    status: res.status,
    ms: Date.now() - startedAt,
    data
  };
}

async function runPool(baseUrl) {
  const results = [];
  let next = 0;
  const workerCount = Math.min(parallel, total);
  async function worker() {
    while (next < total) {
      const index = next;
      next += 1;
      results[index] = await postSubmission(baseUrl, index);
    }
  }
  await Promise.all(Array.from({ length: workerCount }, worker));
  return results;
}

async function listen(server) {
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  return `http://127.0.0.1:${address.port}`;
}

async function close(server) {
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
}

(async () => {
  const originalDb = fs.existsSync(dbFile) ? fs.readFileSync(dbFile, "utf8") : "";
  const server = http.createServer((req, res) => {
    handle(req, res).catch(error => {
      res.writeHead(error.statusCode || 500, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ message: error.message || "Server error" }));
    });
  });

  try {
    const db = readDb();
    writeDb({
      ...db,
      submissions: db.submissions.filter(item => item.clientBuildTag !== runTag)
    });

    const baseUrl = await listen(server);
    const startedAt = Date.now();
    const results = await runPool(baseUrl);
    const elapsedMs = Date.now() - startedAt;
    const failures = results.filter(item => item.status !== 201);
    const latencies = results.map(item => item.ms).sort((a, b) => a - b);
    const finalDb = readDb();
    const created = finalDb.submissions.filter(item => item.clientBuildTag === runTag);
    const uniqueIds = new Set(created.map(item => item.id));

    assert.strictEqual(failures.length, 0, `${failures.length} submissions failed`);
    assert.strictEqual(created.length, total, `expected ${total} records, got ${created.length}`);
    assert.strictEqual(uniqueIds.size, total, "submission ids should be unique");

    console.log("Concurrency test passed");
    console.log(`Total requests: ${total}`);
    console.log(`Parallel workers: ${Math.min(parallel, total)}`);
    console.log(`Elapsed: ${elapsedMs}ms`);
    console.log(`Throughput: ${(total / (elapsedMs / 1000)).toFixed(2)} req/s`);
    console.log(`Latency ms: min=${latencies[0]}, p50=${percentile(latencies, 50)}, p95=${percentile(latencies, 95)}, p99=${percentile(latencies, 99)}, max=${latencies[latencies.length - 1]}`);
  } finally {
    await close(server).catch(() => {});
    if (originalDb) {
      fs.writeFileSync(dbFile, originalDb);
    }
  }
})().catch(error => {
  console.error(error);
  process.exit(1);
});
