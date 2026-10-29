import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import express from "express";
import {
  consentRequest,
  consentURL,
  makeSetuClient,
  normalizeSetuTransactions,
  setuAllowed,
} from "../server/setu-client.js";

const dir = mkdtempSync(join(tmpdir(), "subwise-setu-"));
process.env.DATABASE_PATH = join(dir, "test.sqlite");
delete process.env.DATABASE_URL;
delete process.env.SUBWISE_SERVERLESS;
delete process.env.NETLIFY;
Object.assign(process.env, {
  SETU_SANDBOX_ENABLED: "true",
  SETU_CLIENT_ID: "test-client",
  SETU_CLIENT_SECRET: "test-secret",
  SETU_PRODUCT_ID: "test-product",
  SETU_SANDBOX_EMAILS: "tester@example.com",
  SETU_WEBHOOK_TOKEN: "a".repeat(48),
});
const { db, subscriptions } = await import("../server/db.js");
const { syncSetuConnection, registerSetuWebhook } =
  await import("../server/setu.js");
const userId = randomUUID();
await db
  .prepare("INSERT INTO users VALUES(?,?,?,?,?)")
  .run(
    userId,
    "tester@example.com",
    "Tester",
    "unused",
    new Date().toISOString(),
  );
test.after(async () => {
  await db.close();
  rmSync(dir, { recursive: true, force: true });
});
function session(id, consentId) {
  return {
    id,
    consentId,
    status: "COMPLETED",
    fips: [
      {
        fipID: "setu-fip-2",
        accounts: [
          {
            linkRefNumber: "account-1",
            status: "DELIVERED",
            data: {
              account: {
                type: "deposit",
                transactions: {
                  transaction: [1, 2, 3].map((n) => ({
                    txnId: "t" + n,
                    type: "DEBIT",
                    amount: "649.00",
                    narration: "UPI/NETFLIX/1234",
                    transactionTimestamp: `2026-0${n}-05T00:00:00Z`,
                  })),
                },
              },
            },
          },
        ],
      },
    ],
  };
}
async function connection(overrides = {}) {
  const id = randomUUID(),
    consent = randomUUID(),
    sid = randomUUID();
  await db
    .prepare("INSERT INTO connections VALUES(?,?,?,?,?,?)")
    .run(id, userId, "bank", "pending", null, new Date().toISOString());
  const row = {
    connection_id: id,
    user_id: userId,
    consent_id: consent,
    session_id: sid,
    session_attempted: 0,
    range_from: "2026-01-01T00:00:00Z",
    range_to: "2026-03-31T23:59:59Z",
    consent_expires: new Date(Date.now() + 86400000).toISOString(),
    purge_after: new Date(Date.now() + 86400000).toISOString(),
    ...overrides,
  };
  await db
    .prepare(
      "INSERT INTO setu_connections(connection_id,consent_id,authorization_url,session_id,range_from,range_to,consent_expires,purge_after,session_attempted) VALUES(?,?,?,?,?,?,?,?,?)",
    )
    .run(
      id,
      consent,
      "https://fiu-uat.setu.co/v2/consents/ui/" + consent,
      row.session_id,
      row.range_from,
      row.range_to,
      row.consent_expires,
      row.purge_after,
      row.session_attempted,
    );
  return row;
}
test("sandbox access is explicit, account-scoped, and consent requests use approved spending fields", () => {
  assert.equal(setuAllowed({ email: "tester@example.com" }), true);
  assert.equal(setuAllowed({ email: "someone@example.com" }), false);
  assert.equal(
    setuAllowed(
      { email: "tester@example.com" },
      { ...process.env, SETU_SANDBOX_ENABLED: "false" },
    ),
    false,
  );
  const request = consentRequest(
    "https://subwise.example",
    new Date("2026-10-28T12:00:00Z"),
  );
  assert.equal(request.purpose.code, "102");
  assert.equal(request.vua, "9999999999");
  assert.deepEqual(request.fiTypes, ["DEPOSIT"]);
  assert.deepEqual(request.consentTypes, ["TRANSACTIONS"]);
  assert.equal(request.frequency.unit, "DAY");
  assert.throws(() => consentURL("https://evil.example/consent"));
  assert.throws(() => consentURL("https://fiu.setu.co/consent"));
  assert.equal(
    new URL(consentURL("https://fiu-uat.setu.co/v2/consents/ui/123")).hostname,
    "fiu-uat.setu.co",
  );
});
test("authenticated sandbox transport refreshes a rejected token and never follows redirects or replays an ambiguous POST", async () => {
  let logins = 0,
    calls = 0;
  const client = makeSetuClient({
    env: process.env,
    fetchImpl: async (url, options) => {
      assert.equal(options.redirect, "error");
      if (url.startsWith("https://orgservice-prod.setu.co/v1/users/login")) {
        logins++;
        assert.equal(JSON.parse(options.body).secret, "test-secret");
        return new Response(JSON.stringify({ access_token: "test-token" }));
      }
      calls++;
      assert.equal(url, "https://fiu-sandbox.setu.co/v2/consents");
      assert.equal(options.headers["x-product-instance-id"], "test-product");
      if (calls === 1)
        return new Response('{"errorCode":"Unauthorized"}', { status: 401 });
      return new Response('{"id":"test"}', { status: 201 });
    },
  });
  assert.equal((await client.request("/v2/consents", {})).id, "test");
  assert.equal(logins, 2);
  let posts = 0;
  const failed = makeSetuClient({
    fetchImpl: async (url) => {
      if (url.startsWith("https://orgservice-prod.setu.co/v1/users/login"))
        return new Response('{"access_token":"token"}');
      posts++;
      throw new Error("timeout");
    },
  });
  await assert.rejects(failed.request("/v2/consents", {}));
  assert.equal(posts, 1);
});
test("bank normalization preserves exact paise, namespaces account IDs, ignores credits, other FI types and malformed amounts", () => {
  const data = session("s", "c");
  const tx = data.fips[0].accounts[0].data.account.transactions.transaction;
  tx.push(
    { ...tx[0], txnId: "credit", type: "CREDIT" },
    { ...tx[0], txnId: "bad", amount: "1e6" },
    { ...tx[0], txnId: "date", transactionTimestamp: "2026-02-30" },
  );
  const rows = normalizeSetuTransactions(data);
  assert.equal(rows.length, 3);
  assert.equal(rows[0].amount, 64900);
  assert.deepEqual(rows, normalizeSetuTransactions(data));
  const second = structuredClone(data.fips[0].accounts[0]);
  second.linkRefNumber = "account-2";
  data.fips[0].accounts.push(second);
  assert.equal(normalizeSetuTransactions(data).length, 6);
  second.data.account.type = "mutualfunds";
  assert.equal(normalizeSetuTransactions(data).length, 3);
});
test("verified consent and session data become isolated sandbox subscriptions with replay protection", async () => {
  const row = await connection();
  const api = {
    request: async (path) =>
      path.includes("/consents/")
        ? { id: row.consent_id, status: "ACTIVE" }
        : session(row.session_id, row.consent_id),
  };
  await syncSetuConnection(row, { api });
  const records = (await subscriptions(userId)).filter((s) =>
    s.merchant_key.startsWith(row.connection_id),
  );
  assert.equal(records.length, 1);
  assert.equal(records[0].source, "setu_sandbox");
  assert.equal(records[0].name, "Netflix");
  assert.equal(records[0].payment, "Bank · sandbox");
  await db
    .prepare("UPDATE setu_connections SET next_sync=0 WHERE connection_id=?")
    .run(row.connection_id);
  await syncSetuConnection(row, { api });
  assert.equal(
    (
      await db
        .prepare(
          "SELECT COUNT(*) AS n FROM provider_transactions WHERE connection_id=?",
        )
        .get(row.connection_id)
    ).n,
    3,
  );
  assert.equal(
    (
      await db
        .prepare("SELECT COUNT(*) AS n FROM financial_events WHERE id LIKE ?")
        .get("setu:" + row.session_id + ":%")
    ).n,
    1,
  );
  assert.equal((await subscriptions(randomUUID())).length, 0);
});
test("revoked consent blocks financial fetch and mismatched sessions never ingest", async () => {
  const revoked = await connection();
  let fetched = false;
  await syncSetuConnection(revoked, {
    api: {
      request: async (path) => {
        if (path.includes("/sessions/")) fetched = true;
        return { id: revoked.consent_id, status: "REVOKED" };
      },
    },
  });
  assert.equal(fetched, false);
  assert.equal(
    (
      await db
        .prepare("SELECT status FROM connections WHERE id=?")
        .get(revoked.connection_id)
    ).status,
    "revoked",
  );
  const mismatch = await connection();
  await syncSetuConnection(mismatch, {
    api: {
      request: async (path) =>
        path.includes("/consents/")
          ? { id: mismatch.consent_id, status: "ACTIVE" }
          : session(mismatch.session_id, "other-consent"),
    },
  });
  assert.match(
    (
      await db
        .prepare(
          "SELECT last_error FROM setu_connections WHERE connection_id=?",
        )
        .get(mismatch.connection_id)
    ).last_error,
    /SessionMismatch/,
  );
  assert.equal(
    (
      await db
        .prepare(
          "SELECT COUNT(*) AS n FROM provider_transactions WHERE connection_id=?",
        )
        .get(mismatch.connection_id)
    ).n,
    0,
  );
});
test("ambiguous data-session POST is reconciled without being submitted twice", async () => {
  const row = await connection({ session_id: null });
  let posts = 0;
  const api = {
    request: async (path, body) => {
      if (path.endsWith("data-sessions"))
        return { consentId: row.consent_id, dataSessions: [] };
      if (body) {
        posts++;
        throw Error("lost connection after POST");
      }
      return { id: row.consent_id, status: "ACTIVE" };
    },
  };
  await syncSetuConnection(row, { api });
  const saved = await db
    .prepare("SELECT * FROM setu_connections WHERE connection_id=?")
    .get(row.connection_id);
  assert.equal(saved.session_attempted, 1);
  await db
    .prepare("UPDATE setu_connections SET next_sync=0 WHERE connection_id=?")
    .run(row.connection_id);
  await syncSetuConnection({ ...row, ...saved }, { api });
  assert.equal(posts, 1);
});
test("expired sandbox financial records are purged before further provider access", async () => {
  const row = await connection({ purge_after: "2000-01-01T00:00:00Z" });
  await db
    .prepare("INSERT INTO provider_transactions VALUES(?,?,?,?,?,?)")
    .run(row.connection_id, "tx", "Netflix", 64900, "2026-03-05", "INR");
  await syncSetuConnection(row, {
    api: {
      request: () => {
        throw Error("must not access provider");
      },
    },
  });
  assert.equal(
    await db
      .prepare("SELECT * FROM setu_connections WHERE connection_id=?")
      .get(row.connection_id),
    undefined,
  );
  assert.equal(
    (
      await db
        .prepare(
          "SELECT COUNT(*) AS n FROM provider_transactions WHERE connection_id=?",
        )
        .get(row.connection_id)
    ).n,
    0,
  );
});
test("callbacks are hints only; forged active payloads cannot mark connections active or insert transactions", async () => {
  const app = express();
  registerSetuWebhook(app);
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  try {
    const row = await connection();
    const url = `http://127.0.0.1:${server.address().port}/api/webhooks/setu/`;
    assert.equal(
      (
        await fetch(url + "wrong", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "{}",
        })
      ).status,
      404,
    );
    const response = await fetch(url + process.env.SETU_WEBHOOK_TOKEN, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "CONSENT_STATUS_UPDATE",
        consentId: row.consent_id,
        data: { status: "ACTIVE" },
        transactions: [{ amount: 999 }],
      }),
    });
    assert.equal(response.status, 202);
    assert.equal(
      (
        await db
          .prepare("SELECT status FROM connections WHERE id=?")
          .get(row.connection_id)
      ).status,
      "pending",
    );
    assert.equal(
      (
        await db
          .prepare(
            "SELECT COUNT(*) AS n FROM provider_transactions WHERE connection_id=?",
          )
          .get(row.connection_id)
      ).n,
      0,
    );
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
