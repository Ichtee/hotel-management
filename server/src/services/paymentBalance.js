// Cọc trùng hoặc đến muộn được giữ để hoàn, không dùng thanh toán tiền phòng.
const allocatedFilter = { status: "success", isLateDeposit: { $ne: true } };
const isAllocated = (payment) => payment.status === "success" && payment.isLateDeposit !== true;
function paymentStatus(booking, payments) {
  const paidAmount = payments.filter(isAllocated).reduce((sum, payment) => sum + payment.amount, 0);
  const status = paidAmount >= booking.totalAmount ? "fully_paid" : paidAmount > 0 ? "deposit_paid" : "unpaid";
  return { paidAmount, paymentStatus: status };
}
module.exports = { allocatedFilter, isAllocated, paymentStatus };
