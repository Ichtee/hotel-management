const { createHmac, timingSafeEqual, randomBytes } = require("node:crypto");
// Cổng thanh toán giả lập; có thể thay bộ tạo đơn, URL và xác minh mà giữ luồng thông báo chung.
const secret = () => {
  if (process.env.GATEWAY_SECRET) return process.env.GATEWAY_SECRET;
  if (process.env.NODE_ENV === "production") throw new Error("GATEWAY_SECRET is required in production.");
  return "dev-gateway-secret";
};
const sign = (p) =>
  createHmac("sha256", secret()).update(`${p.orderId}|${p.transactionRef}|${p.status}|${p.amount}`).digest("hex");
function verify(p, signature) {
  const a = Buffer.from(sign(p), "hex");
  // Dữ liệu không đúng dạng hex có thể tạo buffer ngắn hơn.
  const b = Buffer.from(String(signature), "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}
const newOrderId = () => `ORD${Date.now().toString(36).toUpperCase()}${randomBytes(4).toString("hex").toUpperCase()}`;
// Trang thanh toán giả lập nằm trong chính frontend.
const payUrl = (orderId) => `#/pay/sandbox/${orderId}`;
module.exports = { sign, verify, newOrderId, payUrl };
