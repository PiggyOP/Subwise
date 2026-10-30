import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
const dir = mkdtempSync(join(tmpdir(), "subwise-api-")),
  path = join(dir, "db.sqlite"),
  base = "http://127.0.0.1:3099";
let child, db;
async function request(route, body, token, method) {
  const r = await fetch(base + route, {
    method: method || (body ? "POST" : "GET"),
    headers: {
      "Content-Type": "application/json",
      "x-client": "mobile",
      ...(token ? { Authorization: "Bearer " + token } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: r.status, data: await r.json().catch(() => null) };
}
test.before(async () => {
  child = spawn(process.execPath, ["server/index.js"], {
    env: {
      ...process.env,
      PORT: "3099",
      DATABASE_PATH: path,
      ENABLE_TEST_PLUS: "true",
      REQUIRE_PAID_PLAN: "false",
      FINANCIAL_CONNECTOR_URL: "",
      FINANCIAL_CONNECTOR_SECRET: "",
      FINANCIAL_WEBHOOK_SECRET: "",
      OPENAI_API_KEY: "",
    },
    stdio: "pipe",
  });
  await new Promise((resolve, reject) => {
    child.stdout.once("data", resolve);
    child.once("error", reject);
    child.once("exit", () => reject(Error("API exited")));
  });
  db = new DatabaseSync(path);
});
test.after(() => {
  db?.close();
  child?.kill();
  rmSync(dir, { recursive: true, force: true });
});
test("authenticated connected-only API, account isolation, test Plus and session revocation", async () => {
  assert.equal((await request("/api/dashboard")).status, 401);
  const a = await request("/api/auth/register", {
      email: "alice@example.com",
      password: "long-safe-password",
      name: "Alice",
    }),
    b = await request("/api/auth/register", {
      email: "bob@example.com",
      password: "long-safe-password",
      name: "Bob",
    });
  assert.equal(a.status, 201);
  const token = a.data.token;
  const legacyDemo = randomUUID();
  db.prepare("INSERT INTO connections VALUES(?,?,?,?,?,?)").run(
    legacyDemo,
    a.data.user.id,
    "demo_bank",
    "connected",
    null,
    new Date().toISOString(),
  );
  db.prepare("INSERT INTO provider_transactions VALUES(?,?,?,?,?,?)").run(
    legacyDemo,
    "legacy-demo-row",
    "Legacy synthetic purchase",
    64900,
    "2026-10-05",
    "INR",
  );
  const id = randomUUID();
  db.prepare(
    "INSERT INTO subscriptions(id,user_id,name,amount,cadence,next_date,category,payment,status,source,created) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
  ).run(
    id,
    a.data.user.id,
    "Netflix",
    64900,
    "monthly",
    "2026-11-05",
    "Entertainment",
    "Card",
    "active",
    "card",
    new Date().toISOString(),
  );
  assert.equal((await request("/api/subscriptions", {}, token)).status, 410);
  assert.equal(
    (await request("/api/import", { csv: "date,merchant,amount" }, token))
      .status,
    410,
  );
  assert.equal(
    (await request("/api/subscriptions/" + id, { amount: 1 }, token, "PATCH"))
      .status,
    400,
  );
  assert.equal(
    (
      await request(
        "/api/subscriptions/" + id,
        { status: "cancelled" },
        b.data.token,
        "PATCH",
      )
    ).status,
    404,
  );
  assert.equal(
    (await request("/api/dashboard", null, b.data.token)).data.subscriptions
      .length,
    0,
  );
  assert.equal(
    (
      await request(
        "/api/subscriptions/" + id,
        { status: "cancelled" },
        token,
        "PATCH",
      )
    ).status,
    409,
  );
  assert.equal(
    (
      await request(
        "/api/subscriptions/" + id + "/cancel",
        { confirm: true, capabilityVersion: 1 },
        token,
      )
    ).status,
    409,
  );
  const dash = await request("/api/dashboard", null, token);
  assert.deepEqual(dash.data.connections, []);
  assert.deepEqual(dash.data.transactions, []);
  assert.deepEqual((await request("/api/connections", null, token)).data, []);
  assert.equal((await request("/api/demo-bank", null, token)).status, 404);
  assert.equal(dash.data.subscriptions.length, 1);
  assert.equal(dash.data.billing.status, "active");
  assert.equal(dash.data.integrations.testPlus, true);
  assert.equal((await request("/api/billing/checkout", {}, token)).status, 409);
  assert.equal(
    (await request("/api/connections", { channel: "card" }, token)).status,
    410,
  );
  assert.equal(
    (
      await request(
        "/api/connections",
        { channel: "upi", cardNumber: "unsafe" },
        token,
      )
    ).status,
    400,
  );
  assert.equal(
    (
      await request(
        "/api/subscriptions/" + id,
        { status: "cancellation_requested" },
        token,
        "PATCH",
      )
    ).status,
    409,
  );
  assert.equal(
    (await request("/api/export", null, token)).data.subscriptions.length,
    1,
  );
  await request("/api/auth/logout", {}, token);
  assert.equal((await request("/api/dashboard", null, token)).status, 401);
  const login = await request("/api/auth/login", {
    email: "alice@example.com",
    password: "long-safe-password",
  });
  assert.equal(login.status, 200);
  assert.equal(
    (await request("/api/account", {}, login.data.token, "DELETE")).status,
    200,
  );
  assert.equal(
    (await request("/api/dashboard", null, login.data.token)).status,
    401,
  );
});
test("catalog has 120 unique named services and local logo assets", async () => {
  const r = await request("/api/catalog");
  assert.equal(r.data.length, 120);
  assert.equal(new Set(r.data.map((s) => s.id)).size, 120);
  assert.ok(
    r.data.every((s) => s.logo.startsWith("/logos/") && s.aliases.length),
  );
  const names = r.data.map((x) => x.name);
  for (const name of [
    "JioHotstar",
    "Netflix",
    "Spotify Premium",
    "Google One",
    "ChatGPT",
  ])
    assert.ok(names.includes(name));
});
test("production refuses the temporary Plus override", async () => {
  const run = spawn(process.execPath, ["server/index.js"], {
    env: {
      ...process.env,
      PORT: "3198",
      DATABASE_PATH: join(dir, "production-guard.sqlite"),
      NODE_ENV: "production",
      APP_ORIGIN: "https://subwise.example",
      ENABLE_TEST_PLUS: "true",
      REQUIRE_PAID_PLAN: "false",
    },
    stdio: "pipe",
  });
  const code = await new Promise((resolve) => run.once("exit", resolve));
  assert.notEqual(code, 0);
});
