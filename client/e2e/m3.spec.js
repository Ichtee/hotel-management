import { test, expect } from "@playwright/test";

const password = "HotelDemo123!";
// Waits for the post-login landing page so later navigation is not overridden by the redirect.
async function signIn(page, email, route, landing) {
  await page.goto(route);
  await page.getByRole("textbox", { name: "Email" }).fill(email);
  await page.getByRole("textbox", { name: /^Password/ }).fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("heading", { name: landing })).toBeVisible();
}

test("customer sees own bookings, details, payment and refund status", async ({ page }) => {
  await signIn(page, "customer@demo.hotel", "/#/login", "My bookings");
  await expect(page.getByRole("button", { name: /^upcoming \(\d+\)$/i })).toBeVisible();

  const first = page.locator("article").first().getByRole("button", { name: /details$/ });
  await first.click();
  await expect(first).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByText("Balance due")).toBeVisible();
  await expect(page.getByText(/Payment: (pending|partial|paid|unpaid)/i).first()).toBeVisible();

  await page.getByRole("button", { name: /^past \(\d+\)$/i }).click();
  const cancelled = page.locator("article", { hasText: "BK2610C3" });
  await cancelled.getByRole("button", { name: "View details" }).click();
  await expect(page.getByRole("heading", { name: "Refund" })).toBeVisible();
  await expect(page.getByText("Cancelled by customer")).toBeVisible();
});

test("manager validates and saves the deposit policy", async ({ page }) => {
  await signIn(page, "manager@demo.hotel", "/#/admin/login", /^Hello, /);
  await page.goto("/#/admin/policy");
  await expect(page.getByRole("heading", { name: "Deposit policy" })).toBeVisible();

  const input = page.getByLabel("Deposit percentage");
  const save = page.getByRole("button", { name: "Save policy" });
  await input.fill("150");
  await expect(page.getByRole("alert").filter({ hasText: "between 1 and 100" })).toBeVisible();
  await expect(save).toBeDisabled();

  await input.fill("35");
  await expect(page.getByText(/the deposit would be/)).toBeVisible();
  await save.click();
  await expect(page.getByText("Saved. New online reservations now require a 35% deposit.")).toBeVisible();
  await expect(page.locator(".pct")).toHaveText("35%");
});
