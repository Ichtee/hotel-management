const { createHmac, createHash, timingSafeEqual } = require("node:crypto");
// SePay Payment Gateway adapter: https://developer.sepay.vn/vi/cong-thanh-toan/bat-dau
// Env: SEPAY_ENV (sandbox|production), SEPAY_MERCHANT_ID, SEPAY_SECRET_KEY, PUBLIC_URL.
// Optional overrides because the docs disagree on the sandbox host: SEPAY_CHECKOUT_URL, SEPAY_API_URL.
const HOSTS = {
  sandbox: { checkout: "https://pay-sandbox.sepay.vn/v1/checkout/init", api: "https://pgapi-sandbox.sepay.vn" },
  production: { checkout: "https://pay.sepay.vn/v1/checkout/init", api: "https://pgapi.sepay.vn" },
};
// Our method names -> SePay payment_method values.
const METHOD = { bank_transfer: "BANK_TRANSFER", e_wallet: "NAPAS_BANK_TRANSFER", credit_card: "CARD" };
// Field order matters: SePay rejects the form when the signature is built in another order.
const SIGN_ORDER = ["order_amount", "merchant", "currency", "operation", "order_description", "order_invoice_number", "customer_id", "payment_method", "success_url", "error_url", "cancel_url"];

function config() {
  const { SEPAY_MERCHANT_ID: merchantId, SEPAY_SECRET_KEY: secret } = process.env;
  if (!merchantId || !secret) throw new Error("SEPAY_MERCHANT_ID and SEPAY_SECRET_KEY are required when PAYMENT_PROVIDER=sepay.");
  const hosts = HOSTS[process.env.SEPAY_ENV === "production" ? "production" : "sandbox"];
  return { merchantId, secret, checkoutUrl: process.env.SEPAY_CHECKOUT_URL || hosts.checkout, apiUrl: process.env.SEPAY_API_URL || hosts.api };
}
// Payment methods this deployment offers, e.g. SEPAY_METHODS=bank_transfer,credit_card (default: bank transfer only).
const methods = () => (process.env.SEPAY_METHODS || "bank_transfer").split(",").map((m) => m.trim()).filter((m) => METHOD[m]);

function signature(fields, secret) {
  const data = SIGN_ORDER.filter((k) => fields[k] !== undefined && fields[k] !== "").map((k) => `${k}=${fields[k]}`).join(",");
  return createHmac("sha256", secret).update(data).digest("base64");
}
// Everything the browser must POST to SePay's checkout. The secret key never leaves the server.
// Redirects are cosmetic: they only open the result screen, the IPN or a lookup decides the outcome.
function checkout(payment, booking) {
  const cfg = config();
  const base = (process.env.PUBLIC_URL || "").replace(/\/$/, "");
  if (!base) throw new Error("PUBLIC_URL is required when PAYMENT_PROVIDER=sepay (SePay redirects the browser back to it).");
  const returnUrl = (r) => `${base}/api/payments/return?payment=${payment.id}&r=${r}`;
  const fields = {
    order_amount: String(payment.amount),
    merchant: cfg.merchantId,
    currency: "VND",
    operation: "PURCHASE",
    order_description: `Booking ${booking.bookingReference || String(booking._id).slice(-8).toUpperCase()} ${payment.kind}`,
    order_invoice_number: payment.gatewayOrderId,
    customer_id: String(booking.customerId),
    payment_method: METHOD[payment.method],
    success_url: returnUrl("success"),
    error_url: returnUrl("error"),
    cancel_url: returnUrl("cancel"),
  };
  return { action: cfg.checkoutUrl, fields: { ...fields, signature: signature(fields, cfg.secret) } };
}
// The IPN carries only a static key, so callers confirm it with retrieveOrder before trusting it.
function isIpnKey(header) {
  const digest = (s) => createHash("sha256").update(String(s ?? "")).digest();
  return timingSafeEqual(digest(header), digest(config().secret));
}
async function retrieveOrder(invoice) {
  const cfg = config();
  const res = await fetch(`${cfg.apiUrl}/v1/order/detail/${encodeURIComponent(invoice)}`, {
    headers: { Authorization: `Basic ${Buffer.from(`${cfg.merchantId}:${cfg.secret}`).toString("base64")}`, "Content-Type": "application/json" },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`SePay order lookup failed with ${res.status}.`);
  return (await res.json()).data;
}
module.exports = { METHOD, signature, checkout, isIpnKey, retrieveOrder, methods };
