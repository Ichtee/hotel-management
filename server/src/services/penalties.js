const Booking = require("../models/Booking");
const Penalty = require("../models/Penalty");
const { paidAmount } = require("./payments");
const { audit } = require("./audit");
// Cộng bồi thường đã xác nhận vào tổng tiền để mọi lần tính số dư đều bao gồm khoản này.
const charge = (bookingId, delta) => Booking.updateOne({ _id: bookingId }, { $inc: { penaltyAmount: delta, totalAmount: delta } });
// Đánh dấu bồi thường đã trả khi khoản còn thiếu của booking bằng không.
async function settlePaid(bookingId) {
  const booking = await Booking.findById(bookingId).select("totalAmount");
  if (booking && booking.totalAmount - (await paidAmount(booking._id)) < 1)
    await Penalty.updateMany({ bookingId, status: "confirmed" }, { status: "paid" });
}
// Lúc 04:30, miễn bồi thường sau trả phòng chưa thanh toán quá bảy ngày; bỏ qua khoản đã trả hoặc miễn.
async function waiveUnpaid(now = new Date()) {
  const due = await Penalty.find({ status: "confirmed", afterCheckout: true, confirmedAt: { $lte: new Date(now.getTime() - 7 * 864e5) } }).select("_id");
  let waived = 0;
  for (const { _id } of due) {
    const penalty = await Penalty.findOneAndUpdate({ _id, status: "confirmed" }, { status: "waived", waivedReason: "Not paid within 7 days", waivedAt: now });
    if (!penalty) continue;
    await charge(penalty.bookingId, -penalty.amount);
    await audit(null, "penalty.waived_automatically", "penalty", penalty._id, { bookingId: penalty.bookingId, amount: penalty.amount });
    waived++;
  }
  return { waived };
}
module.exports = { charge, settlePaid, waiveUnpaid };
