import { test, expect } from "@playwright/test";
const password = "HotelDemo123!";
async function signIn(page, email) {
  await page.goto("/login");
  await page.getByLabel("Email address", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL("/");
}
test("manager navigates Home, manages staff/promotions and exports revenue", async ({
  page,
}) => {
  await signIn(page, "manager@demo.hotel");
  await expect(
    page.getByRole("heading", { name: /Good .*Alex/ }),
  ).toBeVisible();
  await page
    .getByRole("navigation")
    .getByRole("link", { name: "Staff", exact: true })
    .click();
  await page.getByRole("button", { name: "Add staff" }).click();
  const dialog = page.getByRole("dialog");
  const staffName = `Browser Staff ${Date.now()}`;
  await dialog.getByLabel("Full name").fill(staffName);
  await dialog.getByLabel("Username").fill(`browser${Date.now()}`);
  await dialog
    .getByLabel("Email address")
    .fill(`browser${Date.now()}@test.hotel`);
  await dialog.getByLabel("Phone number").fill("0912345678");
  await dialog.getByLabel("Temporary password").fill(password);
  await dialog.getByRole("button", { name: "Create staff account" }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.getByText(staffName, { exact: true })).toBeVisible();
  await page
    .getByRole("row")
    .filter({ hasText: staffName })
    .getByRole("button", { name: /Edit/ })
    .click();
  await dialog.getByLabel("Status").selectOption("suspended");
  await dialog.getByRole("button", { name: "Save changes" }).click();
  await expect(
    page.getByRole("row").filter({ hasText: staffName }).getByText("Suspended"),
  ).toBeVisible();
  await page
    .getByRole("navigation")
    .getByRole("link", { name: "Promotions" })
    .click();
  await page.getByRole("button", { name: "Create promotion" }).click();
  const code = `TEST${Date.now()}`;
  await dialog.getByLabel("Coupon code").fill(code);
  await dialog.getByLabel("Discount value").fill("15");
  await dialog.getByLabel("Usage limit").fill("25");
  await dialog.getByLabel("Starts on").fill("2026-10-01");
  await dialog.getByLabel("Ends on").fill("2027-01-01");
  await dialog.getByRole("button", { name: "Create promotion" }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.getByText(code, { exact: true })).toBeVisible();
  await page
    .getByRole("navigation")
    .getByRole("link", { name: "Revenue" })
    .click();
  await expect(
    page.getByRole("heading", { name: "Revenue report" }),
  ).toBeVisible();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export CSV" }).click();
  expect((await download).suggestedFilename()).toMatch(/revenue.*csv/);
});
test("admin creates an account, edits permissions and sees no hotel administration menu", async ({
  page,
}) => {
  await signIn(page, "admin@demo.hotel");
  await expect(
    page
      .getByRole("navigation")
      .getByRole("link", { name: "Staff", exact: true }),
  ).toHaveCount(0);
  await page
    .getByRole("navigation")
    .getByRole("link", { name: "Accounts" })
    .click();
  await page.getByRole("button", { name: "Add account" }).click();
  const dialog = page.getByRole("dialog");
  const suffix = Date.now();
  const accountName = `Browser Account ${suffix}`;
  await dialog.getByLabel("Full name").fill(accountName);
  await dialog.getByLabel("Username").fill(`account${suffix}`);
  await dialog.getByLabel("Email address").fill(`account${suffix}@test.hotel`);
  await dialog.getByLabel("Temporary password").fill(password);
  await dialog
    .getByRole("button", { name: "Create account", exact: true })
    .click();
  await expect(dialog).not.toBeVisible();
  await expect(page.getByText(accountName, { exact: true })).toBeVisible();
  await page
    .getByRole("navigation")
    .getByRole("link", { name: "Roles & permissions" })
    .click();
  await page.getByRole("button", { name: "Create role" }).click();
  const roleName = `Revenue reviewer ${suffix}`;
  await dialog.getByLabel("Role name").fill(roleName);
  await dialog.getByLabel("Role key").fill(`reviewer${suffix}`);
  await dialog.getByLabel("Scope").selectOption("hotel");
  await dialog.getByLabel("View revenue reports").check();
  await dialog.getByRole("button", { name: "Create role" }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.getByRole("heading", { name: roleName })).toBeVisible();
});
test("customer registers, signs in to Home, updates profile and changes password", async ({
  page,
}) => {
  const suffix = Date.now();
  await page.goto("/register");
  await page.getByLabel("Full name").fill("New Browser Guest");
  await page.getByLabel("Username").fill(`guest${suffix}`);
  await page.getByLabel("Email address").fill(`guest${suffix}@test.hotel`);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByLabel("Confirm password").fill(password);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/login/);
  await signIn(page, `guest${suffix}@test.hotel`);
  await page
    .getByRole("navigation")
    .getByRole("link", { name: "My profile" })
    .click();
  await page.getByLabel("Full name").fill("Updated Browser Guest");
  await page.getByRole("button", { name: "Save profile" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "Profile updated" }),
  ).toBeVisible();
  await page.getByLabel("Current password").fill(password);
  await page
    .getByLabel("New password", { exact: true })
    .fill("UpdatedPassword123!");
  await page.getByLabel("Confirm new password").fill("UpdatedPassword123!");
  await page.getByRole("button", { name: "Change password" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "Password changed" }),
  ).toBeVisible();
  await page.goto("/accounts");
  await expect(
    page.getByRole("heading", { name: "Access restricted" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL("/login");
});
test("mobile home and forms fit viewport with working navigation", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(page, "manager@demo.hotel");
  await expect(
    page.getByRole("heading", { name: /Good .*Alex/ }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.getByRole("button", { name: "Open navigation" }).click();
  await page
    .getByRole("navigation")
    .getByRole("link", { name: "Staff", exact: true })
    .click();
  await page.getByRole("button", { name: "Add staff" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).not.toBeVisible();
});
