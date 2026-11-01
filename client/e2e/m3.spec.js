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
  await expect(page.getByText("Waiting for refund")).toBeVisible();
});

test("manager validates and saves the deposit policy", async ({ page }) => {
  await signIn(page, "manager@demo.hotel", "/#/admin/login", /^Hello, /);
  await page.goto("/#/admin/policy");
  await expect(page.getByRole("heading", { name: "Deposit & cancellation policy" })).toBeVisible();

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

  // UC27: a tier closer to check-in may not refund more than an earlier one (MSG-63).
  const refund = page.getByRole("combobox", { name: "Refund" });
  const saveTiers = page.getByRole("button", { name: "Save cancellation policy" });
  await refund.nth(0).selectOption("0");
  await refund.nth(1).selectOption("100");
  await saveTiers.click();
  await expect(page.getByRole("alert").filter({ hasText: "must not overlap or leave gaps" })).toBeVisible();
  await refund.nth(0).selectOption("100");
  await refund.nth(1).selectOption("0");
  await saveTiers.click();
  await expect(page.getByText("Saved. New bookings use these tiers")).toBeVisible();
});

// UC12 / UC13 change the demo data (they pay the seeded bookings), so run them against a fresh `npm run demo`.
test("customer pays the deposit: declined once, retried and approved, then the booking is confirmed", async ({ page }) => {
  await signIn(page, "customer@demo.hotel", "/#/login", "My bookings");
  const pending = page.locator("article", { hasText: "BK2610B2" });
  await pending.getByRole("link", { name: "Pay deposit" }).click();
  await expect(page.getByRole("heading", { name: "Pay your deposit" })).toBeVisible();
  await expect(page.getByRole("timer")).toContainText("Your room is held for");
  await page.getByRole("button", { name: /^Pay ₫/ }).click();

  await expect(page.getByRole("heading", { name: "Confirm payment" })).toBeVisible();
  await page.getByRole("button", { name: "Decline payment" }).click();
  await expect(page.getByRole("heading", { name: "Payment failed" })).toBeVisible();

  await page.getByRole("link", { name: "Try again" }).click();
  await page.getByRole("button", { name: /^Pay ₫/ }).click();
  await page.getByRole("button", { name: "Approve payment" }).click();
  await expect(page.getByRole("heading", { name: "Payment received" })).toBeVisible();
  await expect(page.getByText("Your reservation is confirmed.")).toBeVisible();

  await page.getByRole("link", { name: "View my bookings" }).click();
  const paid = page.locator("article", { hasText: "BK2610B2" });
  await expect(paid.getByText("Confirmed")).toBeVisible();
  await expect(paid.getByRole("link", { name: "Pay deposit" })).toHaveCount(0);
});

test("customer pays the remaining balance and the booking shows as paid", async ({ page }) => {
  await signIn(page, "customer@demo.hotel", "/#/login", "My bookings");
  const booking = page.locator("article", { hasText: "BK2610A1" });
  await booking.getByRole("button", { name: "View details" }).click();
  await page.getByRole("link", { name: /^Pay balance/ }).click();
  await expect(page.getByRole("heading", { name: "Pay the remaining balance" })).toBeVisible();
  await page.getByRole("button", { name: /^Pay ₫/ }).click();
  await page.getByRole("button", { name: "Approve payment" }).click();
  await expect(page.getByRole("heading", { name: "Payment received" })).toBeVisible();

  await page.getByRole("link", { name: "View my bookings" }).click();
  await expect(page.locator("article", { hasText: "BK2610A1" }).getByText("Payment: Paid")).toBeVisible();
});

// UC08 -> UC35 -> UC21 on BK2610A1 (check-in in 14 days: full deposit refund under the 48 h tier).
test("cancellation and refund: the customer requests, the receptionist approves and records the bank transfer", async ({ page, browser }) => {
  await signIn(page, "customer@demo.hotel", "/#/login", "My bookings");
  const booking = page.locator("article", { hasText: "BK2610A1" });
  await booking.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Cancel this booking" })).toBeVisible();
  await expect(page.getByText("Estimated refund: ₫1,440,000")).toBeVisible();
  await page.getByLabel("Reason (optional)").fill("Change of plans");
  await page.getByRole("button", { name: "Confirm cancellation" }).click();
  await expect(page.getByText("Your cancellation request has been sent to the front desk")).toBeVisible();

  const desk = await browser.newPage();
  desk.on("dialog", (d) => d.accept());
  await signIn(desk, "reception@demo.hotel", "/#/admin/login", /^Hello, /);
  await desk.goto("/#/admin/cancellations");
  await desk.getByRole("row", { name: /BK2610A1/ }).getByRole("button", { name: "Approve" }).click();
  await expect(desk.getByText("Cancellation approved. The booking is waiting for refund.")).toBeVisible();

  await desk.goto("/#/admin/refunds");
  await desk.getByRole("row", { name: /BK2610A1/ }).getByRole("button", { name: "Process" }).click();
  const modal = desk.getByRole("dialog");
  await modal.getByLabel("Bank", { exact: true }).fill("Vietcombank");
  await modal.getByLabel("Account number").fill("0011223344");
  await modal.getByLabel(/Account holder/).fill("Someone Else");
  await modal.getByRole("button", { name: "Save account" }).click();
  await expect(modal.getByText("must be the same as the name of the person who made the booking")).toBeVisible();
  await modal.getByLabel(/Account holder/).fill("Jamie Nguyen");
  await modal.getByRole("button", { name: "Save account" }).click();
  await expect(modal.getByRole("button", { name: "Replace account" })).toBeVisible();
  await modal.getByLabel("Bank transaction code").fill("FT2611010001");
  await modal.getByRole("button", { name: "Record refund" }).click();
  await expect(desk.getByText("Refund recorded.")).toBeVisible();

  await page.reload();
  await page.getByRole("button", { name: /^past \(\d+\)$/i }).click();
  await page.locator("article", { hasText: "BK2610A1" }).getByRole("button", { name: "View details" }).click();
  await expect(page.getByText("Bank transfer FT2611010001")).toBeVisible();
  await expect(page.getByText("Refunded", { exact: true })).toBeVisible();
});
