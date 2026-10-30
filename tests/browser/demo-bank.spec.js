import { test, expect } from "@playwright/test";
import { DatabaseSync } from "node:sqlite";

test("fixed demo identity processes a mixed statement and keeps ordinary spending out of subscriptions", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  // This file is the dedicated local browser-test database, never the hosted database.
  const fixtureDb = new DatabaseSync("data/browser-tests.sqlite");
  fixtureDb.exec("PRAGMA foreign_keys=ON");
  fixtureDb
    .prepare("DELETE FROM users WHERE email=?")
    .run("demo-browser@example.com");
  fixtureDb.close();
  await page.goto("/");
  await page.getByLabel("Your name").fill("Demo Tester");
  await page.getByLabel("Email address").fill("demo-browser@example.com");
  await page
    .getByLabel("Password", { exact: true })
    .fill("demo-browser-password");
  await page
    .getByRole("button", { name: "Create your account", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Unlock your subscription workspace." }),
  ).toBeVisible();
  const user = await (await page.request.get("/api/me")).json();
  const db = new DatabaseSync("data/browser-tests.sqlite");
  db.prepare("INSERT OR IGNORE INTO complimentary_plus VALUES(?,?,?)").run(
    user.id,
    "browser_fixture",
    new Date().toISOString(),
  );
  db.close();
  await page.reload();
  await page.getByRole("button", { name: "Accounts", exact: true }).click();
  const demo = page.getByRole("region", { name: "Subwise demo bank" });
  await expect(
    demo.getByRole("heading", { name: "Test without your phone" }),
  ).toBeVisible();
  await demo.getByLabel("Test code", { exact: true }).fill("123456");
  await demo
    .getByRole("button", { name: "Connect demo bank", exact: true })
    .click();
  await expect(
    demo.getByText("5 subscriptions found", { exact: true }),
  ).toBeVisible();
  await expect(
    demo
      .getByRole("table", { name: "Synthetic bank statement" })
      .locator("tbody tr"),
  ).toHaveCount(33);
  await expect(
    demo.getByText("Duplicate · ignored", { exact: true }),
  ).toHaveCount(1);
  await demo
    .getByText("View simulated autopay records", { exact: true })
    .click();
  await expect(
    demo.getByText("Cancelled · excluded from active subscriptions"),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Subscriptions 5", exact: true })
    .click();
  await expect(page.locator(".subscriptions tbody tr")).toHaveCount(5);
  await expect(
    page
      .locator(".subscriptions")
      .getByText("Demo bank · synthetic", { exact: true }),
  ).toHaveCount(5);
  await page.getByRole("button", { name: "Accounts", exact: true }).click();
  await demo
    .getByLabel("Test number", { exact: true })
    .selectOption("9000000001");
  await demo.getByLabel("Test code", { exact: true }).fill("123456");
  await demo
    .getByRole("button", { name: "Connect demo bank", exact: true })
    .click();
  await expect(
    demo.getByText("0 subscriptions found", { exact: true }),
  ).toBeVisible();
  await expect(
    demo
      .getByRole("table", { name: "Synthetic bank statement" })
      .locator("tbody tr"),
  ).toHaveCount(19);
  await page.reload();
  await expect(
    page.getByText("Demo bank · Statements", { exact: false }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});
