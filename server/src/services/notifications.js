const Notification = require("../models/Notification");
const User = require("../models/User");
const Role = require("../models/Role");
const money = (n) => `${Number(n || 0).toLocaleString("en-US")} VND`;
// Tạo tiêu đề và nội dung thông báo từ dữ liệu sự kiện.
const events = {
  booking_confirmed: (d) => ["Booking confirmed", `Booking ${d.reference} is confirmed.`],
  booking_modified: (d) => ["Booking updated", `Booking ${d.reference} was modified.`],
  booking_cancelled: (d) => ["Booking cancelled", `Booking ${d.reference} was cancelled.`],
  payment_result: (d) => [
    d.success ? "Payment received" : "Payment failed",
    d.success
      ? `We received ${money(d.amount)} for booking ${d.reference}.`
      : `The payment of ${money(d.amount)} for booking ${d.reference} was not completed.`,
  ],
  refund_status: (d) => ["Refund update", `Refund for booking ${d.reference} is now ${d.status}.`],
  room_issue: (d) => ["Room issue reported", `Room ${d.roomNumber}: ${d.description}`],
  cancellation_requested: (d) => ["Cancellation request", `Booking ${d.reference} asks to be cancelled. Refundable amount: ${money(d.amount)}.`],
  cancellation_withdrawn: (d) => ["Cancellation withdrawn", `The cancellation request of booking ${d.reference} was withdrawn.`],
  cancellation_approved: (d) => [
    "Cancellation approved",
    d.amount > 0
      ? `Your cancellation of booking ${d.reference} has been approved. The front desk will contact you by phone or e-mail to get the bank account for the refund of ${money(d.amount)}.`
      : `Booking ${d.reference} has been cancelled and is not eligible for a refund.`,
  ],
  cancellation_auto_approved: (d) => ["Cancellation approved automatically", `Booking ${d.reference} was cancelled automatically. Refund due: ${money(d.amount)}.`],
  refund_completed: (d) => ["Refund sent", `We refunded ${money(d.amount)} for booking ${d.reference} by bank transfer.`],
  hold_expired: (d) => ["Room hold expired", `The 15-minute hold of booking ${d.reference} ended without a deposit, so the room was released.`],
  arrival_reminder: (d) => ["See you tomorrow", `Booking ${d.reference}: check-in is tomorrow, ${d.date}, from ${d.time}.`],
  penalty_proposed: (d) => ["Damage / loss reported", `Booking ${d.reference}: ${d.item} (${money(d.amount)}) was reported by Housekeeping. Confirm or waive it with the guest.`],
  supplementary_invoice: (d) => ["Supplementary invoice", `Invoice ${d.number} of ${money(d.amount)} was issued for booking ${d.reference}.`],
  reconciliation: (d) => ["Payment reconciliation", `${d.settled} gateway payment(s) were settled by the daily reconciliation.`],
  stay_request_submitted: (d) => [
    `${d.type === "check_in" ? "Check-in" : "Check-out"} request`,
    `Booking ${d.reference} sent a ${d.type === "check_in" ? "check-in" : "check-out"} request${d.auto ? " (approved automatically)" : " waiting for your decision"}.`,
  ],
  stay_request_decided: (d) => [
    `${d.type === "check_in" ? "Check-in" : "Check-out"} request ${d.approved ? "approved" : "rejected"}`,
    d.approved
      ? `Your ${d.type === "check_in" ? "early check-in" : "late check-out"} request for booking ${d.reference} was approved.${d.fee ? ` A fee of ${money(d.fee)} is charged only if it really takes place.` : ""}`
      : `Your ${d.type === "check_in" ? "check-in" : "check-out"} request for booking ${d.reference} was rejected.${d.note ? ` ${d.note}` : ""}`,
  ],
};
const emailjs = require("./emailjs");
let transport;
// Chọn bộ gửi email theo cấu hình hiện tại.
const resendTransport = () => {
  const client = require("./resendService").getResendClient();
  return client && { sendMail: async ({ to, subject, text }) => {
    const { error } = await client.emails.send({ from: process.env.RESEND_FROM_EMAIL || "GrandStay <onboarding@resend.dev>", to, subject, text });
    if (error) throw new Error(error.message);
  } };
};
const getTransport = () =>
  (transport ??= emailjs.enabled()
    ? { sendMail: emailjs.sendMail }
    : process.env.SMTP_URL
    ? require("nodemailer").createTransport(process.env.SMTP_URL)
    : resendTransport() || null);
// Cho phép thay bộ gửi email khi kiểm thử hoặc đổi nhà cung cấp.
const setTransport = (t) => (transport = t);
async function email(accountId, title, message) {
  const t = getTransport();
  if (!t) return;
  try {
    const user = await User.findById(accountId).select("email");
    if (user)
      await t.sendMail({
        from: process.env.MAIL_FROM || "no-reply@hotel.local",
        to: user.email,
        subject: title,
        text: message,
      });
  } catch (error) {
    // Lỗi gửi email không làm thất bại nghiệp vụ đặt phòng hoặc thanh toán.
    console.error("Notification email failed:", error.message);
  }
}
// Gắn liên kết booking, phòng hoặc sự cố vào thông báo trong ứng dụng nếu có.
async function notify(event, accountId, data = {}, refs = {}) {
  if (!events[event]) throw new Error(`Unknown notification event: ${event}`);
  const [title, message] = events[event](data);
  const doc = await Notification.create({ accountId, type: event, title, message, ...refs });
  await email(accountId, title, message);
  return doc;
}
// Gửi thông báo đến các nhân viên đang hoạt động thuộc vai trò cần nhận.
async function notifyRole(event, roleKey, data, refs) {
  const role = await Role.findOne({ key: roleKey });
  if (!role) return [];
  const users = await User.find({ roleId: role._id, status: "active" }).select("_id");
  return Promise.all(users.map((u) => notify(event, u._id, data, refs)));
}
module.exports = { notify, notifyRole, email, setTransport, getTransport, events };
