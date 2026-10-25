import { test, expect } from "@playwright/test";
test("profile belongs to top-right avatar, subscriptions stay first, and saved preferences persist", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/");
  await page.getByLabel("Your name").fill("Profile Tester");
  await page
    .getByLabel("Email address")
    .fill(`profile-${Date.now()}@example.com`);
  await page
    .getByLabel("Password", { exact: true })
    .fill("safe-profile-test-password");
  await page
    .getByRole("button", { name: "Create your account", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Make space for clarity" }),
  ).toBeVisible();
  await expect(
    page.locator("header").getByRole("button", { name: /Switch to/ }),
  ).toHaveCount(0);
  await expect(
    page.locator("nav").getByRole("button", { name: "Profile", exact: true }),
  ).toHaveCount(0);
  const order = await page.evaluate(
    () =>
      document.querySelector(".subscriptions").getBoundingClientRect().top <
      document.querySelector(".stats").getBoundingClientRect().top,
  );
  expect(order).toBe(true);
  await page.getByRole("button", { name: "Open profile", exact: true }).click();
  const panel = page.getByRole("dialog", { name: "Your profile" });
  await expect(
    panel.getByRole("heading", { name: "Your profile", exact: true }),
  ).toBeVisible();
  await panel.getByLabel("Full name").fill("Updated Profile");
  await panel.getByLabel("Email me a monthly subscription summary").check();
  await panel.getByLabel("Send each month on").selectOption("12");
  await panel
    .getByRole("button", { name: "Save profile & preferences" })
    .click();
  await expect(page.getByRole("status")).toContainText("preferences saved");
  await page.getByRole("button", { name: "Close dialog" }).click();
  await page.reload();
  await page.getByRole("button", { name: "Open profile", exact: true }).click();
  await expect(panel.getByLabel("Full name")).toHaveValue("Updated Profile");
  await expect(
    panel.getByLabel("Email me a monthly subscription summary"),
  ).toBeChecked();
  await expect(panel.getByLabel("Send each month on")).toHaveValue("12");
  await expect(
    panel.getByRole("button", { name: "Send verification code" }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "Close dialog" }).click();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Appearance", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: /Switch to/ })).toBeVisible();
});
