const Booking = require("../models/Booking");
const Payment = require("../models/Payment");
const Refund = require("../models/Refund");
const { notify, notifyRole } = require("./notifications");
const sepay = require("./sepay");
const reference = (b) => b.bookingReference || String(b._id).slice(-8).toUpperCase();
const HOLD_GRACE = 15 * 60000;
// Chỉ cộng các khoản thanh toán đã xác minh thành công.
const paidAmount = async (bookingId) =>
  (await Payment.aggregate([{ $match: { bookingId, status: "success" } }, { $group: { _id: null, sum: { $sum: "$amount" } } }]))[0]?.sum || 0;
// Lỗi gửi thông báo không làm thất bại khoản thanh toán đã xử lý.
const tell = (event, accountId, data, refs) =>
  notify(event, accountId, data, refs).catch((e) => console.error("Notification failed:", e.message));
async function announce(payment, success) {
  const booking = await Booking.findById(payment.bookingId).select("customerId bookingReference");
  if (booking)
    await tell("payment_result", booking.customerId, { reference: reference(booking), amount: payment.amount, success }, { bookingId: booking._id });
}
// Chuyển trạng thái nguyên tử để thông báo thanh toán gửi lại không ghi tiền lần nữa.
async function settle(order, result) {
  const success = result.status === "success";
  const ref = result.transactionRef ? { transactionRef: result.transactionRef } : {};
  const payment = await Payment.findOneAndUpdate(
    // Vẫn nhận tiền của đơn đã bị thay thế nếu khách thanh toán mã QR cũ.
    { _id: order._id, status: success ? { $in: ["pending", "cancelled"] } : "pending" },
    { $set: { ...ref, ...(success ? { status: "success", paidAt: new Date() } : { status: "failed", failureReason: result.failureReason || "Declined by the payment gateway" }) } },
    { new: true },
  );
  if (!payment) return { duplicate: true };
  if (success && payment.kind === "deposit") {
    // Xác nhận cọc trong thời gian giữ phòng hoặc 15 phút gia hạn cho đơn đã chờ tại cổng.
    // Cần đồng bộ thời gian gia hạn này với kiểm tra phòng trống.
    const now = Date.now();
    const confirmed = await Booking.updateOne(
      {
        _id: payment.bookingId,
        status: "pending",
        $or: [{ holdExpiresAt: { $gt: new Date(now) } }, { holdExpiresAt: { $gt: new Date(Math.max(now - HOLD_GRACE, payment.createdAt)) } }],
      },
      { $set: { status: "confirmed" }, $unset: { holdExpiresAt: 1 } },
    );
    if (confirmed.modifiedCount) {
      const booking = await Booking.findById(payment.bookingId).select("customerId bookingReference");
      await tell("booking_confirmed", booking.customerId, { reference: reference(booking) }, { bookingId: booking._id });
    } else {
      // Tạo hồ sơ hoàn tiền cho cọc đến sau khi booking hết hạn, bị hủy hoặc đã trả đủ.
      await Payment.updateOne({ _id: payment._id }, { isLateDeposit: true });
      await Refund.create({ paymentId: payment._id, bookingId: payment.bookingId, amount: payment.amount, status: "requested", reason: "Deposit confirmed after the room hold expired" });
    }
  }
  await announce(payment, success);
  return { payment };
}
// Tra cứu trạng thái thật từ SePay để xử lý thông báo hoặc bù thông báo bị mất.
async function reconcile(payment, transactionRef) {
  const remote = await sepay.retrieveOrder(payment.gatewayOrderId);
  const first = remote?.transactions?.[0];
  if (remote?.order_status === "CAPTURED" && Number(remote.order_amount) === payment.amount)
    return settle(payment, { status: "success", transactionRef: transactionRef || String(first?.transaction_id ?? first?.id ?? remote.order_id ?? payment.gatewayOrderId) });
  if (remote?.order_status === "CANCELLED") return settle(payment, { status: "failed", failureReason: "Cancelled at the payment gateway" });
  return { pending: true };
}
// Đối soát đơn mở trong bảy ngày lúc 04:15 và báo quản lý; không tìm được đơn chưa từng lưu trong database.
async function reconcileDaily(now = new Date()) {
  if (!require("./sepay").enabled()) return { checked: 0, settled: 0 };
  const open = await Payment.find({ gateway: "sepay", status: { $in: ["pending", "cancelled"] }, createdAt: { $gte: new Date(now - 7 * 864e5) } });
  let settled = 0;
  for (const p of open) {
    const result = await reconcile(p).catch((e) => (console.error("Reconciliation lookup failed:", e.message), {}));
    if (result.payment?.status === "success") settled++;
  }
  if (settled) await notifyRole("reconciliation", "manager", { settled }).catch((e) => console.error("Notification failed:", e.message));
  return { checked: open.length, settled };
}
module.exports = { paidAmount, settle, announce, reconcile, reconcileDaily };
