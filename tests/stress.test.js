const assert = require("assert");
const fs = require("fs");
const http = require("http");
const path = require("path");
const fetch = require("node-fetch");

const { handle, readDb, writeDb } = require("../server/server");

const root = path.resolve(__dirname, "..");
const dbFile = path.join(root, "server", "data", "db.json");
const readTotal = Number(process.env.STRESS_READ_TOTAL || 500);
const writeTotal = Number(process.env.STRESS_WRITE_TOTAL || 300);
const parallel = Number(process.env.STRESS_PARALLEL || 100);
const runTag = `stress_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

function percentile(values, p) {
  if (!values.length) return 0;
  const index = Math.min(values.length - 1, Math.ceil((p / 100) * values.length) - 1);
  return values[index];
}

function summarize(name, results, expectedStatus) {
  const elapsedMs = results.reduce((max, item) => Math.max(max, item.endedAt), 0)
    - results.reduce((min, item) => Math.min(min, item.startedAt), Infinity);
  const latencies = results.map(item => item.ms).sort((a, b) => a - b);
  const statusCounts = results.reduce((acc, item) => {
    acc[item.status] = (acc[item.status] || 0) + 1;
    return acc;
  }, {});
  const failures = results.filter(item => item.status !== expectedStatus);
  return {
    name,
    total: results.length,
    expectedStatus,
    failures: failures.length,
    statusCounts,
    elapsedMs,
    throughput: results.length / (elapsedMs / 1000),
    latency: {
      min: latencies[0] || 0,
      p50: percentile(latencies, 50),
      p95: percentile(latencies, 95),
      p99: percentile(latencies, 99),
      max: latencies[latencies.length - 1] || 0
    }
  };
}

function printSummary(summary) {
  console.log(`${summary.name}:`);
  console.log(`  total=${summary.total}, failures=${summary.failures}, statuses=${JSON.stringify(summary.statusCounts)}`);
  console.log(`  elapsed=${summary.elapsedMs}ms, throughput=${summary.throughput.toFixed(2)} req/s`);
  console.log(`  latency_ms min=${summary.latency.min}, p50=${summary.latency.p50}, p95=${summary.latency.p95}, p99=${summary.latency.p99}, max=${summary.latency.max}`);
}

function makePayload(index) {
  return {
    taskCode: "qf4M84e",
    projectId: "stress-test",
    projectName: "Stress Test",
    taskTitle: "Stress Test",
    gameId: `${runTag}_user_${index}`,
    orderNo: `${runTag}_order_${index}`,
    gameIdImageFileId: `https://example.test/${runTag}/game-id-${index}.jpg`,
    orderImageFileId: `https://example.test/${runTag}/order-${index}.jpg`,
    videoFileId: `https://example.test/${runTag}/video-${index}.mp4`,
    downloadVideoFileId: `https://example.test/${runTag}/download-video-${index}.mp4`,
    clientBuildTag: runTag
  };
}

async function timedRequest(fn) {
  const startedAt = Date.now();
  try {
    const res = await fn();
    const text = await res.text();
    return {
      startedAt,
      endedAt: Date.now(),
      ms: Date.now() - startedAt,
      status: res.status,
      text
    };
  } catch (error) {
    return {
      startedAt,
      endedAt: Date.now(),
      ms: Date.now() - startedAt,
      status: "ERR",
      text: error.message || String(error)
    };
  }
}

async function runPool(total, workerCount, task) {
  const results = [];
  let next = 0;
  async function worker() {
    while (next < total) {
      const index = next;
      next += 1;
      results[index] = await task(index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(workerCount, total) }, worker));
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
    await runPool(20, 10, () => timedRequest(() => fetch(`${baseUrl}/api/task`)));

    const readResults = await runPool(readTotal, parallel, () =>
      timedRequest(() => fetch(`${baseUrl}/api/task`))
    );
    const readSummary = summarize("GET /api/task pressure", readResults, 200);
    printSummary(readSummary);
    assert.strictEqual(readSummary.failures, 0, "read pressure should not fail");

    const writeResults = await runPool(writeTotal, parallel, index =>
      timedRequest(() => fetch(`${baseUrl}/api/submissions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(makePayload(index))
      }))
    );
    const writeSummary = summarize("POST /api/submissions pressure", writeResults, 201);
    printSummary(writeSummary);
    assert.strictEqual(writeSummary.failures, 0, "write pressure should not fail");

    const finalDb = readDb();
    const created = finalDb.submissions.filter(item => item.clientBuildTag === runTag);
    const uniqueIds = new Set(created.map(item => item.id));
    assert.strictEqual(created.length, writeTotal, `expected ${writeTotal} stress records, got ${created.length}`);
    assert.strictEqual(uniqueIds.size, writeTotal, "stress submission ids should be unique");

    console.log("Stress test passed");
    console.log(`Parameters: STRESS_READ_TOTAL=${readTotal}, STRESS_WRITE_TOTAL=${writeTotal}, STRESS_PARALLEL=${parallel}`);
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
