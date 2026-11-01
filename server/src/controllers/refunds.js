const { createCipheriv, createDecipheriv, createHash, randomBytes } = require("node:crypto");
const Booking = require("../models/Booking");
const Payment = require("../models/Payment");
const Refund = require("../models/Refund");
const v = require("../utils/validation");
const { notify } = require("../services/notifications");
const { audit } = require("../services/audit");
const { reference } = require("../services/cancellations");

// The refund account number is stored encrypted (AES-256-GCM). DATA_KEY must stay stable, or saved numbers cannot be read.
function key() {
  const secret = process.env.DATA_KEY || process.env.SESSION_SECRET;
  if (!secret && process.env.NODE_ENV === "production") throw new Error("DATA_KEY is required in production.");
  return createHash("sha256").update(secret || "development-only-data-key").digest();
}
function seal(text) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const data = Buffer.concat([cipher.update(text, "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), data].map((b) => b.toString("base64")).join(".");
}
function open(sealed) {
  try {
    const [iv, tag, data] = sealed.split(".").map((s) => Buffer.from(s, "base64"));
    const decipher = createDecipheriv("aes-256-gcm", key(), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
  } catch {
    return null; // key changed: the Receptionist enters the account again
  }
}
// MSG-84 compares names the way banks print them: no accents, upper case, single spaces.
const plain = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/gi, "D").toUpperCase().replace(/\s+/g, " ").trim();
const bookerName = (b) => b.customerId?.customerProfile?.fullName || b.guestName || b.customerId?.username;

const view = (r) => {
  const b = r.bookingId;
  const account = r.bankAccount?.accountNumber ? { bank: r.bankAccount.bank, holderName: r.bankAccount.holderName, accountNumber: open(r.bankAccount.accountNumber), enteredAt: r.bankAccount.enteredAt } : null;
  return {
    _id: r._id, amount: r.amount, currency: r.currency, status: r.status, reason: r.reason, createdAt: r.createdAt,
    processedAt: r.processedAt, bankTransactionCode: r.bankTransactionCode, note: r.note, failureReason: r.failureReason,
    contacts: r.contacts, account,
    booking: b && { _id: b._id, bookingReference: reference(b), status: b.status, checkInDate: b.checkInDate, checkOutDate: b.checkOutDate },
    booker: b && { name: bookerName(b), phone: b.guestPhone || b.customerId?.phone, email: b.customerId?.email },
    payment: r.paymentId && { method: r.paymentId.method, amount: r.paymentId.amount, reference: r.paymentId.transactionRef || r.paymentId.gatewayOrderId, paidAt: r.paymentId.paidAt },
  };
};
const load = (filter) =>
  Refund.find(filter)
    .populate({ path: "bookingId", select: "bookingReference status checkInDate checkOutDate guestName guestPhone customerId", populate: { path: "customerId", select: "username email phone customerProfile.fullName" } })
    .populate("paymentId", "method amount transactionRef gatewayOrderId paidAt status");
async function waiting(req, id) {
  const [refund] = await load({ _id: v.id(id) });
  if (!refund) throw new v.HttpError(404, "Refund not found.");
  if (refund.status !== "requested") throw new v.HttpError(409, "The booking has been cancelled and is not eligible for a refund."); // MSG-42
  return refund;
}

// UC21 step 1: waiting for refund (oldest first, at the top) or completed.
async function listing(req, res) {
  const status = v.choice(req.query.status || "requested", "status", ["requested", "completed"]);
  const rows = await load({ status }).sort(status === "requested" ? { createdAt: 1 } : { processedAt: -1 }).limit(200);
  res.json({ data: rows.map(view) });
}
// Step 2: bank account obtained from the customer; the holder must be the person who made the booking (MSG-84).
async function setAccount(req, res) {
  v.keys(req.body, ["bank", "accountNumber", "holderName"]);
  const bank = v.text(req.body.bank, "bank", 2, 100);
  const accountNumber = v.text(req.body.accountNumber, "accountNumber", 6, 20);
  if (!/^\d+$/.test(accountNumber)) v.fail("The account number contains digits only.", "accountNumber");
  const holderName = plain(v.text(req.body.holderName, "holderName", 2, 100));
  const refund = await waiting(req, req.params.id);
  if (holderName !== plain(bookerName(refund.bookingId)))
    v.fail("The account holder name must be the same as the name of the person who made the booking.", "holderName");
  const replaced = Boolean(refund.bankAccount?.accountNumber);
  refund.bankAccount = { bank, accountNumber: seal(accountNumber), holderName, enteredBy: req.user._id, enteredAt: new Date() };
  await refund.save();
  await audit(req.user._id, replaced ? "refund.account_replaced" : "refund.account_entered", "refund", refund._id, { bank, last4: accountNumber.slice(-4) });
  res.json({ data: view(refund) });
}
// Step 2b: every attempt to reach the customer is noted; there is no reminder and no expiry.
async function addContact(req, res) {
  v.keys(req.body, ["note"]);
  const note = v.text(req.body.note, "note", 1, 500);
  const refund = await waiting(req, req.params.id);
  refund.contacts.push({ note, by: req.user._id });
  await refund.save();
  res.status(201).json({ data: view(refund) });
}
// Steps 3-5: the transfer is made outside the system; record its code. The amount is locked (BR-17).
async function record(req, res) {
  v.keys(req.body, ["bankTransactionCode", "note"]);
  const code = v.text(req.body.bankTransactionCode, "bankTransactionCode", 1, 60);
  const note = req.body.note === undefined ? undefined : v.text(req.body.note, "note", 0, 500);
  const refund = await waiting(req, req.params.id);
  if (!refund.bankAccount?.accountNumber) throw new v.HttpError(409, "Enter the bank account obtained from the customer first.");
  const payment = await Payment.findById(refund.paymentId?._id);
  if (!payment || payment.status !== "success") {
    await Refund.updateOne({ _id: refund._id }, { failureReason: "The related payment could not be identified." });
    throw new v.HttpError(409, "The related payment could not be identified. The refund cannot be processed."); // MSG-43
  }
  // A payment is never refunded beyond its amount, even by two receptionists at once.
  const counted = await Payment.updateOne(
    { _id: payment._id, status: "success", $expr: { $lte: [{ $add: [{ $ifNull: ["$refundedAmount", 0] }, refund.amount] }, "$amount"] } },
    { $inc: { refundedAmount: refund.amount } },
  );
  if (!counted.modifiedCount) throw new v.HttpError(409, "The booking has been cancelled and is not eligible for a refund."); // MSG-42
  const done = await Refund.findOneAndUpdate(
    { _id: refund._id, status: "requested" },
    { $set: { status: "completed", bankTransactionCode: code, note, processedBy: req.user._id, processedAt: new Date(), gateway: "bank_transfer" }, $unset: { failureReason: 1 } },
    { new: true },
  );
  if (!done) {
    await Payment.updateOne({ _id: payment._id }, { $inc: { refundedAmount: -refund.amount } });
    throw new v.HttpError(409, "This refund was already recorded.");
  }
  const booking = await Booking.findById(refund.bookingId._id).select("bookingReference customerId");
  await notify("refund_completed", booking.customerId, { reference: reference(booking), amount: done.amount, code }, { bookingId: booking._id });
  await audit(req.user._id, "refund.completed", "refund", done._id, { amount: done.amount, bankTransactionCode: code });
  res.json({ data: { ...view(refund), status: done.status, bankTransactionCode: code, processedAt: done.processedAt }, message: "Refund recorded. The customer has been notified of the amount and the bank transaction code." });
}
module.exports = { listing, setAccount, addContact, record };
