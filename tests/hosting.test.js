import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createHmac } from "node:crypto";
import express from "express";
import { createHostedHandler } from "../server/hosted-handler.js";
import { forwardMaintenance } from "../server/forward-maintenance.js";

test("hosted adapter preserves raw signed webhook bytes and authenticates workers", async () => {
  const previous = process.env.SUBWISE_WORKER_SECRET;
  process.env.SUBWISE_WORKER_SECRET = "worker-test-secret-".repeat(4);
  const app = express();
  const raw = '{ "event": "verified", "amount": 15000 }\n';
  const signingKey = "fixture-webhook-signature";
  app.post(
    "/api/webhooks/fixture",
    express.raw({ type: "application/json" }),
    (req, res) => {
      assert.equal(req.body.toString(), raw);
      const expected = createHmac("sha256", signingKey)
        .update(req.body)
        .digest("hex");
      res
        .status(req.headers["x-signature"] === expected ? 200 : 401)
        .json({ ok: true });
    },
  );
  app.use(express.json());
  app.post("/api/echo", (req, res) => res.json(req.body));
  app.use((req, res) => res.status(404).json({ error: "Endpoint not found" }));
  const runs = [];
  const handler = createHostedHandler({
    loadApp: async () => app,
    runMaintenance: async (job) => runs.push(job),
  });
  const server = createServer((req, res) =>
    handler(req, res).catch(() => {
      res.statusCode = 500;
      res.end();
    }),
  );
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = "http://127.0.0.1:" + server.address().port;
  try {
    const signed = await fetch(base + "/api/webhooks/fixture", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-signature": createHmac("sha256", signingKey)
          .update(raw)
          .digest("hex"),
      },
      body: raw,
    });
    assert.equal(signed.status, 200);
    const json = await fetch(base + "/api/echo", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: '{"email":"fixture@example.com"}',
    });
    assert.deepEqual(await json.json(), { email: "fixture@example.com" });
    assert.equal((await fetch(base + "/api/unknown")).status, 404);
    const path = base + "/api/internal/maintenance/";
    assert.equal((await fetch(path + "setu", { method: "POST" })).status, 401);
    assert.equal(
      (
        await fetch(path + "setu", {
          method: "POST",
          headers: { Authorization: "Bearer wrong" },
        })
      ).status,
      401,
    );
    const headers = {
      Authorization: "Bearer " + process.env.SUBWISE_WORKER_SECRET,
    };
    assert.equal((await fetch(path + "setu", { headers })).status, 404);
    assert.equal(
      (await fetch(path + "unknown", { method: "POST", headers })).status,
      404,
    );
    for (const job of ["setu", "cancellations", "monthly-emails"])
      assert.equal(
        (await fetch(path + job, { method: "POST", headers })).status,
        204,
      );
    assert.deepEqual(runs, ["setu", "cancellations", "monthly-emails"]);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    if (previous === undefined) delete process.env.SUBWISE_WORKER_SECRET;
    else process.env.SUBWISE_WORKER_SECRET = previous;
  }
});

test("scheduler forwarding fails closed and does not retry a failed job locally", async () => {
  const old = {
    origin: process.env.SUBWISE_WORKER_ORIGIN,
    secret: process.env.SUBWISE_WORKER_SECRET,
    fetch: global.fetch,
  };
  try {
    delete process.env.SUBWISE_WORKER_ORIGIN;
    assert.equal(await forwardMaintenance("setu"), false);
    process.env.SUBWISE_WORKER_ORIGIN = "https://piggyop-subwise.vercel.app";
    process.env.SUBWISE_WORKER_SECRET = "short";
    await assert.rejects(forwardMaintenance("setu"), /Invalid worker/);
    process.env.SUBWISE_WORKER_SECRET = "worker-test-secret-".repeat(4);
    global.fetch = async (url, options) => {
      assert.equal(
        url.href,
        "https://piggyop-subwise.vercel.app/api/internal/maintenance/setu",
      );
      assert.equal(options.method, "POST");
      assert.equal(options.redirect, "error");
      assert.equal(
        options.headers.Authorization,
        "Bearer " + process.env.SUBWISE_WORKER_SECRET,
      );
      return new Response(null, { status: 204 });
    };
    assert.equal(await forwardMaintenance("setu"), true);
    global.fetch = async () => new Response(null, { status: 503 });
    await assert.rejects(forwardMaintenance("setu"), /HTTP 503/);
    process.env.SUBWISE_WORKER_ORIGIN =
      "https://piggyop-subwise.vercel.app.evil.example";
    await assert.rejects(forwardMaintenance("setu"), /Invalid worker/);
  } finally {
    global.fetch = old.fetch;
    for (const [key, value] of [
      ["SUBWISE_WORKER_ORIGIN", old.origin],
      ["SUBWISE_WORKER_SECRET", old.secret],
    ]) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
