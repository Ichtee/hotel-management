const { randomBytes } = require("node:crypto");
const mongoose = require("mongoose");
const Booking = require("../models/Booking");
const Payment = require("../models/Payment");
const Invoice = require("../models/Invoice");
const v = require("../utils/validation");
const gateway = require("../services/gateway");
const sepay = require("../services/sepay");
const { paidAmount, settle, announce, reconcile } = require("../services/payments");
const { audit } = require("../services/audit");
const { settlePaid } = require("../services/penalties");
const Penalty = require("../models/Penalty");
const { notify } = require("../services/notifications");

const ONLINE = ["bank_transfer", "credit_card"];
// Chọn cổng SePay hoặc cổng giả lập theo cấu hình.
const useSepay = () => sepay.enabled();
const onlineMethods = () => (useSepay() ? sepay.methods() : ONLINE);
const isStaff = (req) => req.role.permissions.includes("payments.settle");
// Khách chỉ trả tiền booking của mình; nhân viên có quyền được thu thay khách.
const scope = (req, bookingId) => ({ _id: bookingId, ...(isStaff(req) ? {} : { customerId: req.user._id }) });
async function findBooking(req, staffAllowed) {
  const filter = { _id: v.id(req.params.id) };
  if (!(staffAllowed && isStaff(req))) filter.customerId = req.user._id;
  const booking = await Booking.findOne(filter);
  if (!booking) throw new v.HttpError(404, "Booking not found.");
  return booking;
}
async function openOrder(booking, kind, amount, method) {
  const fresh = { bookingId: booking._id, kind, amount, method, status: "pending", gatewayOrderId: gateway.newOrderId() };
  if (useSepay()) {
    // Mỗi lần thử SePay dùng mã hóa đơn mới và đóng các đơn cũ còn mở.
    await Payment.updateMany({ bookingId: booking._id, kind, status: "pending", gateway: "sepay" }, { status: "cancelled", failureReason: "Replaced by a newer payment attempt" });
    return Payment.create({ ...fresh, gateway: "sepay" });
  }
  // Dùng lại đơn giả lập đang mở khi thử lại; yêu cầu đồng thời vẫn có thể tạo trùng vì chưa có chỉ mục chặn.
  const open = await Payment.findOne({ bookingId: booking._id, kind, status: "pending", gateway: "sandbox", gatewayOrderId: { $exists: true } });
  if (open) {
    Object.assign(open, { amount, method });
    return open.save();
  }
  return Payment.create({ ...fresh, gateway: "sandbox" });
}
// SePay nhận biểu mẫu đã ký; cổng giả lập trả đường dẫn thanh toán.
function order(p, booking, extra) {
  const base = { paymentId: p.id, orderId: p.gatewayOrderId, amount: p.amount, ...extra };
  return p.gateway === "sepay" ? { ...base, checkout: sepay.checkout(p, booking) } : { ...base, payUrl: `${gateway.payUrl(p.gatewayOrderId)}?payment=${p.id}` };
}

// Trả các phương thức mà cổng hiện tại hỗ trợ.
const methods = (req, res) => res.json({ data: { provider: useSepay() ? "sepay" : "sandbox", methods: onlineMethods() } });

// Thu cọc trực tuyến để xác nhận booking đang chờ.
async function deposit(req, res) {
  v.keys(req.body, ["method"]);
  const method = v.choice(req.body.method, "method", onlineMethods());
  const booking = await findBooking(req, false);
  if (booking.status !== "pending")
    throw new v.HttpError(409, booking.status === "expired" ? "The reservation hold has expired." : "This booking is not waiting for a deposit.");
  if (!booking.holdExpiresAt || booking.holdExpiresAt <= new Date()) throw new v.HttpError(409, "The 15-minute room hold has expired.");
  if (!(booking.depositRequired >= 1)) throw new v.HttpError(409, "No deposit is required for this booking.");
  if (await Payment.exists({ bookingId: booking._id, kind: "deposit", status: "success" })) throw new v.HttpError(409, "The deposit is already paid.");
  const payment = await openOrder(booking, "deposit", booking.depositRequired, method);
  res.status(201).json({ data: order(payment, booking, { holdExpiresAt: booking.holdExpiresAt }) });
}

// Chụp dòng thanh toán vào hóa đơn để thay đổi sau này không ảnh hưởng lịch sử.
async function supplementaryInvoice(booking, issuedBy) {
  const lines = (await Penalty.find({ bookingId: booking._id, status: "confirmed" }).lean()).map((p) => ({ name: p.itemName, amount: p.amount }));
  const total = lines.reduce((sum, l) => sum + l.amount, 0);
  if (!total) return null;
  const invoice = await Invoice.create({
    bookingId: booking._id, kind: "supplementary", invoiceNumber: `INV-S-${randomBytes(4).toString("hex").toUpperCase()}`,
    issuedBy, issuedAt: new Date(), lines, subtotal: total, tax: 0, totalAmount: total, status: "paid",
  });
  if (booking.customerId) await notify("supplementary_invoice", booking.customerId, { number: invoice.invoiceNumber, amount: total, reference: booking.bookingReference }, { bookingId: booking._id })
    .catch((e) => console.error("Notification failed:", e.message));
  return invoice;
}

// Ghi nhận ngay khoản lễ tân đã thu tại quầy.
const DESK = ["cash", "pos", "bank_transfer"];
// Thu phần còn lại tại quầy, có thể chia nhiều lần đến khi đủ; không thu qua cổng trực tuyến.
async function finalPayment(req, res) {
  v.keys(req.body, ["method", "amount", "transactionRef"]);
  const method = v.choice(req.body.method, "method", DESK);
  const booking = await findBooking(req, true);
  if (!["confirmed", "checked_in", "checked_out"].includes(booking.status)) throw new v.HttpError(409, "This booking cannot be paid yet.");
  const due = booking.totalAmount - (await paidAmount(booking._id));
  if (due < 1) throw new v.HttpError(409, "Nothing is left to pay.");
  const amount = req.body.amount === undefined ? due : v.number(req.body.amount, "amount", 1, due);
  const transactionRef = method === "cash" ? undefined : v.text(req.body.transactionRef, "transactionRef", 1, 100);
  const payment = await Payment.create({ bookingId: booking._id, kind: "final", amount, method, transactionRef, status: "success", paidAt: new Date(), recordedBy: req.user._id });
  await announce(payment, true);
  if (amount === due) {
    // Khoản bồi thường trả sau khi rời khách sạn có hóa đơn bổ sung riêng.
    if (booking.status === "checked_out") await supplementaryInvoice(booking, req.user._id);
    await settlePaid(booking._id);
  }
  await audit(req.user._id, "payment.recorded", "payment", payment._id, { bookingId: booking._id, amount, method });
  res.status(201).json({ data: { paymentId: payment.id, status: "success", amount, remaining: due - amount } });
}

// Chỉ nhận kết quả giả lập khi chữ ký, đơn hàng và số tiền đều khớp.
async function callback(req, res) {
  v.keys(req.body, ["orderId", "transactionRef", "status", "amount", "signature"]);
  const p = {
    orderId: v.text(req.body.orderId, "orderId", 1, 64),
    transactionRef: v.text(req.body.transactionRef, "transactionRef", 1, 100),
    status: v.choice(req.body.status, "status", ["success", "failed"]),
    amount: v.number(req.body.amount, "amount", 1),
  };
  if (!gateway.verify(p, req.body.signature)) throw new v.HttpError(401, "Invalid gateway signature.");
  const payment = await Payment.findOne({ gateway: "sandbox", gatewayOrderId: p.orderId });
  if (!payment) throw new v.HttpError(404, "Unknown transaction.");
  if (payment.amount !== p.amount) throw new v.HttpError(400, "Amount does not match the transaction.");
  const result = await settle(payment, p);
  res.json({ data: { status: result.duplicate ? payment.status : result.payment.status, duplicate: Boolean(result.duplicate) } });
}

// Nhận thông báo SePay; phản hồi HTTP 200 với success: true để cổng không gửi lại.
async function sepayIpn(req, res) {
  if (!useSepay()) throw new v.HttpError(404, "Endpoint not found.");
  if (!sepay.isIpnKey(req.get("X-Secret-Key"))) throw new v.HttpError(401, "Invalid IPN key.");
  const body = req.body;
  if (!body || typeof body !== "object" || Array.isArray(body)) v.fail("A JSON object is required.");
  // Xác nhận đã nhận sự kiện hủy giao dịch nhưng không ghi nhận thanh toán.
  if (body.notification_type !== "ORDER_PAID") return res.json({ success: true });
  const invoice = v.text(body.order?.order_invoice_number, "order_invoice_number", 1, 64);
  const payment = await Payment.findOne({ gateway: "sepay", gatewayOrderId: invoice });
  if (!payment) throw new v.HttpError(404, "Unknown transaction.");
  if (Number(body.order.order_amount) !== payment.amount) throw new v.HttpError(400, "Amount does not match the transaction.");
  const ref = body.transaction?.transaction_id ? String(body.transaction.transaction_id) : invoice;
  let outcome;
  try {
    // Tra cứu thêm từ SePay vì thông báo chỉ dùng khóa xác thực cố định.
    outcome = await reconcile(payment, ref);
  } catch (error) {
    // Nếu tra cứu thất bại, xử lý theo thông báo đã xác thực bằng khóa.
    console.error("SePay lookup failed, trusting the IPN:", error.message);
    outcome = await settle(payment, { status: "success", transactionRef: ref });
  }
  if (outcome.pending || outcome.payment?.status === "failed") throw new v.HttpError(400, "The gateway does not report this order as paid.");
  res.json({ success: true });
}

// Cổng giả lập gửi kết quả có chữ ký qua cùng luồng xử lý thông báo.
async function sandbox(req, res) {
  v.keys(req.body, ["result"]);
  const result = v.choice(req.body.result, "result", ["success", "failed"]);
  const payment = await Payment.findOne({ gateway: "sandbox", gatewayOrderId: v.text(req.params.orderId, "orderId", 1, 64) });
  const booking = payment && (await Booking.findOne(scope(req, payment.bookingId)));
  if (!booking) throw new v.HttpError(404, "Order not found.");
  const p = { orderId: payment.gatewayOrderId, transactionRef: `SBX-${randomBytes(6).toString("hex").toUpperCase()}`, status: result, amount: payment.amount };
  req.body = { ...p, signature: gateway.sign(p) };
  return callback(req, res);
}

// Chuyển hướng chỉ mở màn hình kết quả; trạng thái lấy từ thông báo cổng hoặc tra cứu.
function back(req, res) {
  const id = String(req.query.payment || "");
  const result = ["success", "error", "cancel"].includes(req.query.r) ? `&r=${req.query.r}` : "";
  const base = (process.env.PUBLIC_URL || "").replace(/\/$/, "");
  res.redirect(mongoose.isObjectIdOrHexString(id) ? `${base}/#/pay/result?payment=${id}${result}` : `${base}/#/my-bookings`);
}

// Cho giao diện thăm dò trạng thái khi đang chờ thông báo thanh toán.
async function show(req, res) {
  let payment = await Payment.findById(v.id(req.params.id));
  if (!payment || !(await Booking.exists(scope(req, payment.bookingId)))) throw new v.HttpError(404, "Payment not found.");
  if (payment.gateway === "sepay" && payment.status === "pending" && Date.now() - payment.createdAt > 10000) {
    // Tra cứu SePay nếu thông báo có thể bị mất khi máy chủ tạm ngừng.
    await reconcile(payment).catch((e) => console.error("SePay lookup failed:", e.message));
    payment = await Payment.findById(payment._id);
  }
  const booking = await Booking.findById(payment.bookingId).select("bookingReference status").lean();
  const { kind, amount, currency, method, status, paidAt, failureReason } = payment;
  res.json({ data: { _id: payment.id, bookingId: payment.bookingId, kind, amount, currency, method, status, paidAt, failureReason, booking } });
}
// Lấy danh sách thanh toán và hóa đơn ở chế độ chỉ đọc, mới nhất trước.
const BOOKING = { path: "bookingId", select: "bookingReference guestName status" };
async function listing(req, res) {
  v.keys(req.query, ["status", "kind", "limit"]);
  const filter = {};
  if (req.query.status) filter.status = v.choice(req.query.status, "status", Payment.schema.path("status").enumValues);
  if (req.query.kind) filter.kind = v.choice(req.query.kind, "kind", Payment.schema.path("kind").enumValues);
  const limit = req.query.limit ? v.number(Number(req.query.limit), "limit", 1, 200) : 100;
  res.json({ data: await Payment.find(filter).populate(BOOKING).sort({ createdAt: -1 }).limit(limit).lean() });
}
async function invoices(req, res) {
  v.keys(req.query, []);
  res.json({ data: await Invoice.find().populate(BOOKING).populate("issuedBy", "username customerProfile.fullName").sort({ createdAt: -1 }).limit(200).lean() });
}
module.exports = { listing, invoices, deposit, finalPayment, callback, sepayIpn, sandbox, back, methods, show };
