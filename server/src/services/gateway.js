const { createHmac, timingSafeEqual, randomBytes } = require("node:crypto");
// Sandbox payment gateway (SRS 4.1.3: the provider is not named). A real provider replaces
// newOrderId / payUrl / verify here; the callback flow in controllers/payments.js stays the same.
const secret = () => {
  if (process.env.GATEWAY_SECRET) return process.env.GATEWAY_SECRET;
  if (process.env.NODE_ENV === "production") throw new Error("GATEWAY_SECRET is required in production.");
  return "dev-gateway-secret";
};
const sign = (p) =>
  createHmac("sha256", secret()).update(`${p.orderId}|${p.transactionRef}|${p.status}|${p.amount}`).digest("hex");
function verify(p, signature) {
  const a = Buffer.from(sign(p), "hex");
  const b = Buffer.from(String(signature), "hex"); // non-hex input yields a shorter buffer
  return a.length === b.length && timingSafeEqual(a, b);
}
const newOrderId = () => `ORD${Date.now().toString(36).toUpperCase()}${randomBytes(4).toString("hex").toUpperCase()}`;
// The sandbox "hosted checkout" is a page of our own client.
const payUrl = (orderId) => `#/pay/sandbox/${orderId}`;
module.exports = { sign, verify, newOrderId, payUrl };
