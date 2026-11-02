import { test, expect } from "@playwright/test";
import { createHmac } from "node:crypto";

// Opt-in: needs a demo server in SePay mode (SePay itself is mocked in the browser, the lookup API is unreachable on purpose):
//   PAYMENT_PROVIDER=sepay SEPAY_MERCHANT_ID=MERCH1 SEPAY_SECRET_KEY=sekret PUBLIC_URL=http://localhost:5173 SEPAY_API_URL=http://127.0.0.1:9 npm run demo
//   E2E_SEPAY=1 npx playwright test e2e/sepay.spec.js
test.skip(!process.env.E2E_SEPAY, "SePay mode is opt-in");

const SIGN_ORDER = ["order_amount", "merchant", "currency", "operation", "order_description", "order_invoice_number", "customer_id", "payment_method", "success_url", "error_url", "cancel_url"];

test("customer is sent to SePay with a signed form, comes back, and the IPN confirms the booking", async ({ page }) => {
  let posted;
  await page.route("https://pay-sandbox.sepay.vn/**", async (route) => {
    posted = { method: route.request().method(), fields: Object.fromEntries(new URLSearchParams(route.request().postData())) };
    await route.fulfill({ status: 200, contentType: "text/html", body: "<h1>SePay checkout (mock)</h1>" });
  });
  await page.goto("/#/login");
  await page.getByRole("textbox", { name: "Email" }).fill("customer@demo.hotel");
  await page.getByRole("textbox", { name: /^Password/ }).fill("HotelDemo123!");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("heading", { name: "My bookings" })).toBeVisible();

  await page.locator("article", { hasText: "BK2610B2" }).getByRole("link", { name: "Pay deposit" }).click();
  await expect(page.getByRole("radio")).toHaveCount(1); // only the methods this deployment offers
  await page.getByRole("button", { name: /^Pay ₫/ }).click();
  await expect(page.getByRole("heading", { name: "SePay checkout (mock)" })).toBeVisible();

  expect(posted.method).toBe("POST");
  const { signature, ...rest } = posted.fields;
  const signed = SIGN_ORDER.filter((k) => rest[k]).map((k) => `${k}=${rest[k]}`).join(",");
  expect(signature).toBe(createHmac("sha256", "sekret").update(signed).digest("base64"));
  expect(rest.merchant).toBe("MERCH1");
  expect(rest.order_amount).toBe("2160000");

  // The customer cancels at the gateway and is sent back.
  const paymentId = new URL(rest.cancel_url).searchParams.get("payment");
  await page.goto(`/api/payments/return?payment=${paymentId}&r=cancel`);
  await expect(page.getByRole("heading", { name: "Payment not completed" })).toBeVisible();

  // The gateway reports the order as paid (the same order, e.g. the customer paid after all).
  const ipn = await page.request.post("/api/payments/sepay/ipn", {
    headers: { "X-Secret-Key": "sekret" },
    data: { notification_type: "ORDER_PAID", order: { order_invoice_number: rest.order_invoice_number, order_amount: "2160000.00" }, transaction: { transaction_id: "TX-E2E-1" } },
  });
  expect(await ipn.json()).toEqual({ success: true });
  await page.goto(`/#/pay/result?payment=${paymentId}`);
  await expect(page.getByRole("heading", { name: "Payment received" })).toBeVisible();
  await expect(page.getByText("Your reservation is confirmed.")).toBeVisible();
});
