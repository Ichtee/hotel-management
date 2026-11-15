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
// PAYMENT_PROVIDER=sepay uses the SePay gateway; anything else uses the built-in sandbox (tests, offline demo).
const useSepay = () => sepay.enabled();
const onlineMethods = () => (useSepay() ? sepay.methods() : ONLINE);
const isStaff = (req) => req.role.permissions.includes("payments.settle");
// BR-26: customers reach only their own bookings; front-desk staff may pay on a customer's behalf (UC13).
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
    // SePay needs a unique invoice number per attempt, so every attempt is a new order and older open ones are retired.
    await Payment.updateMany({ bookingId: booking._id, kind, status: "pending", gateway: "sepay" }, { status: "cancelled", failureReason: "Replaced by a newer payment attempt" });
    return Payment.create({ ...fresh, gateway: "sepay" });
  }
  // Sandbox: one open order per booking and kind, so a double click or a retry returns the same order.
  // ponytail: two truly simultaneous requests can still open two orders; add a partial unique index if that matters.
  const open = await Payment.findOne({ bookingId: booking._id, kind, status: "pending", gateway: "sandbox", gatewayOrderId: { $exists: true } });
  if (open) {
    Object.assign(open, { amount, method });
    return open.save();
  }
  return Payment.create({ ...fresh, gateway: "sandbox" });
}
// SePay: the client auto-submits `checkout` as a form POST. Sandbox: the client opens `payUrl`.
function order(p, booking, extra) {
  const base = { paymentId: p.id, orderId: p.gatewayOrderId, amount: p.amount, ...extra };
  return p.gateway === "sepay" ? { ...base, checkout: sepay.checkout(p, booking) } : { ...base, payUrl: `${gateway.payUrl(p.gatewayOrderId)}?payment=${p.id}` };
}

// Which payment methods this deployment offers.
const methods = (req, res) => res.json({ data: { provider: useSepay() ? "sepay" : "sandbox", methods: onlineMethods() } });

// UC12: the customer pays the deposit online to confirm a pending reservation.
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

// Bill lines are copied when the invoice is issued, so later changes never alter it.
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

// Collected by the Receptionist and recorded at once (UC11).
const DESK = ["cash", "pos", "bank_transfer"];
// UC11: the Receptionist collects the remaining amount at check-out. BR-14: it is never paid online or through
// the gateway (the deposit is the only online payment); it may be split over several payments until it is 0 (BR-21).
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
    // UC38 4b: a penalty paid after check-out gets its own supplementary invoice; the check-out invoice is not changed.
    if (booking.status === "checked_out") await supplementaryInvoice(booking, req.user._id);
    await settlePaid(booking._id);
  }
  await audit(req.user._id, "payment.recorded", "payment", payment._id, { bookingId: booking._id, amount, method });
  res.status(201).json({ data: { paymentId: payment.id, status: "success", amount, remaining: due - amount } });
}

// UC38 (built-in sandbox gateway): a signed result. Nothing changes unless the signature, order and amount all match (BR-14, BR-15).
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

// UC38 (SePay): IPN for a paid order. SePay expects HTTP 200 with {"success": true}; any other answer is retried or logged as failed.
async function sepayIpn(req, res) {
  if (!useSepay()) throw new v.HttpError(404, "Endpoint not found.");
  if (!sepay.isIpnKey(req.get("X-Secret-Key"))) throw new v.HttpError(401, "Invalid IPN key.");
  const body = req.body;
  if (!body || typeof body !== "object" || Array.isArray(body)) v.fail("A JSON object is required.");
  if (body.notification_type !== "ORDER_PAID") return res.json({ success: true }); // e.g. TRANSACTION_VOID: acknowledged, not a payment
  const invoice = v.text(body.order?.order_invoice_number, "order_invoice_number", 1, 64);
  const payment = await Payment.findOne({ gateway: "sepay", gatewayOrderId: invoice });
  if (!payment) throw new v.HttpError(404, "Unknown transaction.");
  if (Number(body.order.order_amount) !== payment.amount) throw new v.HttpError(400, "Amount does not match the transaction.");
  const ref = body.transaction?.transaction_id ? String(body.transaction.transaction_id) : invoice;
  let outcome;
  try {
    outcome = await reconcile(payment, ref); // the IPN carries only a static key, so ask SePay too
  } catch (error) {
    // The lookup itself failed (network, wrong lookup path): the key-authenticated IPN is still trustworthy.
    console.error("SePay lookup failed, trusting the IPN:", error.message);
    outcome = await settle(payment, { status: "success", transactionRef: ref });
  }
  if (outcome.pending || outcome.payment?.status === "failed") throw new v.HttpError(400, "The gateway does not report this order as paid.");
  res.json({ success: true });
}

// Sandbox stand-in for the provider's checkout page: sends a signed result through the same callback logic.
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

// Where the gateway sends the browser back to (success / error / cancel). It only opens the result screen:
// the outcome comes from the IPN or a lookup, never from this redirect.
function back(req, res) {
  const id = String(req.query.payment || "");
  const result = ["success", "error", "cancel"].includes(req.query.r) ? `&r=${req.query.r}` : "";
  const base = (process.env.PUBLIC_URL || "").replace(/\/$/, "");
  res.redirect(mongoose.isObjectIdOrHexString(id) ? `${base}/#/pay/result?payment=${id}${result}` : `${base}/#/my-bookings`);
}

// Payment Result screen: polled by the client while the callback is pending.
async function show(req, res) {
  let payment = await Payment.findById(v.id(req.params.id));
  if (!payment || !(await Booking.exists(scope(req, payment.bookingId)))) throw new v.HttpError(404, "Payment not found.");
  if (payment.gateway === "sepay" && payment.status === "pending" && Date.now() - payment.createdAt > 10000) {
    // The IPN may have been lost (e.g. a sleeping free-tier server): ask SePay directly.
    await reconcile(payment).catch((e) => console.error("SePay lookup failed:", e.message));
    payment = await Payment.findById(payment._id);
  }
  const booking = await Booking.findById(payment.bookingId).select("bookingReference status").lean();
  const { kind, amount, currency, method, status, paidAt, failureReason } = payment;
  res.json({ data: { _id: payment.id, bookingId: payment.bookingId, kind, amount, currency, method, status, paidAt, failureReason, booking } });
}
// Billing screens (read-only): the latest payments and invoices with their booking, newest first.
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
