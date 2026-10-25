import { test, expect } from "@playwright/test";
import { DatabaseSync } from "node:sqlite";
import { randomUUID, createHmac } from "node:crypto";
async function signedEvent(page, event) {
  const data = JSON.stringify(event),
    timestamp = String(Math.floor(Date.now() / 1000)),
    signature = createHmac("sha256", "browser-test-signature")
      .update(timestamp + "." + data)
      .digest("hex");
  const r = await page.request.post("/api/webhooks/cancellations", {
    data,
    headers: {
      "Content-Type": "application/json",
      "x-subwise-timestamp": timestamp,
      "x-subwise-signature": signature,
    },
  });
  expect(r.status()).toBe(200);
}
test("mobile cancellation authorizes once, tracks progress and shows signed provider confirmation", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  const email = "cancel-" + randomUUID() + "@example.com";
  const r = await page.request.post("/api/auth/register", {
    data: {
      email,
      name: "Cancellation tester",
      password: "long-browser-test-password",
    },
  });
  const user = (await r.json()).user,
    id = randomUUID(),
    ref = "fixture-" + id;
  // This is an isolated test record in the browser-test database, never real customer data.
  const db = new DatabaseSync("data/browser-tests.sqlite");
  db.prepare(
    "UPDATE cancellation_jobs SET next_attempt=? WHERE status IN ('queued','submitted','unknown')",
  ).run(Date.now() + 30 * 86400000);
  db.prepare(
    "INSERT INTO subscriptions(id,user_id,name,amount,cadence,next_date,category,payment,source,created) VALUES(?,?,'Test provider subscription',12900,'monthly','2026-11-05','Other','Card','card',?)",
  ).run(id, user.id, new Date().toISOString());
  db.prepare("INSERT OR IGNORE INTO complimentary_plus VALUES(?,?,?)").run(
    user.id,
    "browser_fixture",
    new Date().toISOString(),
  );
  db.close();
  await signedEvent(page, {
    id: randomUUID(),
    type: "capability",
    subscriptionId: id,
    providerRef: ref,
    scope: "subscription",
    enabled: true,
    version: 1,
    expiresAt: new Date(Date.now() + 86400000).toISOString(),
  });
  await page.reload();
  await page
    .getByRole("button", {
      name: "Manage Test provider subscription",
      exact: true,
    })
    .click();
  const dialog = page.getByRole("dialog");
  await expect(
    dialog.getByRole("link", { name: "Open provider to cancel" }),
  ).toHaveCount(0);
  await expect(
    dialog.getByRole("button", { name: "I have cancelled with the provider" }),
  ).toHaveCount(0);
  await dialog
    .getByRole("button", { name: "Cancel automatically", exact: true })
    .click();
  await expect(
    dialog.getByText("No refund is requested.", { exact: false }),
  ).toBeVisible();
  await dialog
    .getByRole("button", {
      name: "Confirm automatic cancellation",
      exact: true,
    })
    .click();
  await expect(
    dialog.getByRole("button", {
      name: "Confirm automatic cancellation",
      exact: true,
    }),
  ).toHaveCount(0);
  const dash = await (await page.request.get("/api/dashboard")).json(),
    sub = dash.subscriptions.find((s) => s.id === id),
    job = sub.cancellation.job;
  expect(sub.status).toBe("cancellation_requested");
  expect(job.status).not.toBe("cancelled");
  await signedEvent(page, {
    id: randomUUID(),
    type: "result",
    result: {
      jobId: job.id,
      providerRef: ref,
      sequence: 1,
      status: "cancelled",
      renewalStopped: true,
      effectiveAt: new Date(Date.now() - 1000).toISOString(),
      reference: "test-provider-confirmation",
    },
  });
  await page.getByRole("button", { name: "Close dialog", exact: true }).click();
  await page.reload();
  await page
    .getByRole("button", {
      name: "Manage Test provider subscription",
      exact: true,
    })
    .click();
  await expect(
    dialog.getByText("Cancellation confirmed", { exact: true }),
  ).toBeVisible();
  await expect(
    dialog.getByText("test-provider-confirmation", { exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});
test("unsupported services have no pretend cancellation button or manual completion shortcut", async ({
  page,
}) => {
  await page.goto("/");
  await page
    .getByRole("button", { name: "Explore the sample workspace" })
    .click();
  await page
    .getByRole("button", { name: "Manage Netflix", exact: true })
    .click();
  const dialog = page.getByRole("dialog");
  await expect(
    dialog.getByText("Automatic cancellation unavailable", { exact: true }),
  ).toBeVisible();
  await expect(
    dialog.getByRole("button", { name: "Cancel automatically", exact: true }),
  ).toHaveCount(0);
  await expect(
    dialog.getByRole("button", { name: "I have cancelled with the provider" }),
  ).toHaveCount(0);
});
