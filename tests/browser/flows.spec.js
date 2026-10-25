import { test, expect } from "@playwright/test";
test("sample dashboard uses real logos, supports monthly/yearly and exposes connection flow", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await page
    .getByRole("button", { name: "Explore the sample workspace" })
    .click();
  await expect(page.getByText("Sample workspace ·")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Add subscription", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("img", { name: "Netflix logo" }).first(),
  ).toHaveAttribute("src", "/logos/netflix.svg");
  await expect(
    page.getByText("/ year", { exact: false }).first(),
  ).toBeVisible();
  await page.getByRole("button", { name: "Accounts", exact: true }).click();
  await expect(
    page.getByRole("heading", {
      name: "Your card. Your UPI. One clear picture.",
    }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Connect your card", exact: true })
    .click();
  await expect(
    page
      .getByRole("dialog")
      .getByRole("button", { name: "Continue to secure provider" }),
  ).toBeDisabled();
  await expect(
    page
      .getByRole("dialog")
      .getByText("No approved provider is connected yet.", { exact: false }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Close dialog" }).click();
  expect(errors).toEqual([]);
});
test("120-service catalog has working local brand assets, search and category filters", async ({
  page,
}) => {
  await page.goto("/");
  await page
    .getByRole("button", { name: "Explore the sample workspace" })
    .click();
  await page.getByRole("button", { name: "Discover", exact: true }).click();
  await expect(page.locator(".catalogcard")).toHaveCount(120);
  await page.waitForFunction(() =>
    [...document.querySelectorAll(".catalogcard img")].every(
      (i) => i.complete && i.naturalWidth > 0,
    ),
  );
  await page
    .getByRole("combobox", { name: "Filter services by category" })
    .selectOption("AI & Development");
  await expect(
    page.getByRole("heading", { name: "Claude", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Netflix", exact: true }),
  ).toHaveCount(0);
  await page
    .getByRole("combobox", { name: "Filter services by category" })
    .selectOption("All");
  await page.getByRole("textbox", { name: "Search services" }).fill("hotstar");
  await expect(page.locator(".catalogcard")).toHaveCount(1);
  await expect(
    page.getByRole("heading", { name: "JioHotstar", exact: true }),
  ).toBeVisible();
});
test("phone registration unlocks test Plus and has no manual creation/import", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByLabel("Your name").fill("Browser Tester");
  await page
    .getByLabel("Email address")
    .fill(`browser-${Date.now()}@example.com`);
  await page
    .getByLabel("Password", { exact: true })
    .fill("safe-browser-test-password");
  await page
    .getByRole("button", { name: "Create your account", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Make space for clarity" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Add subscription", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Import statement", exact: true }),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "Connect card or UPI", exact: true })
    .first()
    .click();
  await expect(
    page.getByRole("heading", { name: "Connect UPI", exact: true }),
  ).toBeVisible();
  await page.reload();
  await page.locator(".mobile-menu").click();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(
    page.getByText("Plus unlocked for testing", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Plus is unlocked — no payment needed" }),
  ).toBeDisabled();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});
