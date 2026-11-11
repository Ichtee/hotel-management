const HotelPolicy = require("../models/HotelPolicy");
const current = (kind) => (now = new Date()) =>
  HotelPolicy.findOne({
    kind,
    isActive: true,
    effectiveFrom: { $lte: now },
    $or: [{ effectiveTo: null }, { effectiveTo: { $gt: now } }],
  }).sort({ effectiveFrom: -1 });
// Lấy chính sách đang hiệu lực để chụp vào booking khi tạo.
const currentDepositPolicy = current("deposit");
const currentCancellationPolicy = current("cancellation");
const DEFAULT_CHECK_IN = "14:00";

// Mốc hoàn tiền phải liên tục từ 0 giờ, chỉ hoàn 0% hoặc 100%, không tăng khi gần giờ nhận phòng.
function tiersProblem(tiers) {
  const byHours = [...tiers].sort((a, b) => b.minHoursBeforeCheckIn - a.minHoursBeforeCheckIn);
  return (
    new Set(tiers.map((t) => t.minHoursBeforeCheckIn)).size !== tiers.length ||
    byHours.at(-1).minHoursBeforeCheckIn !== 0 ||
    tiers.some((t) => ![0, 100].includes(t.refundPercent)) ||
    byHours.some((t, i) => i > 0 && t.refundPercent > byHours[i - 1].refundPercent)
  );
}
// Tính tỷ lệ hoàn theo số giờ trước nhận phòng; sau giờ nhận dùng mốc gần nhất.
function refundPercent(tiers, hoursBefore) {
  // Nếu chưa cấu hình chính sách, mặc định hoàn toàn bộ cọc.
  if (!tiers?.length) return 100;
  const byHours = [...tiers].sort((a, b) => b.minHoursBeforeCheckIn - a.minHoursBeforeCheckIn);
  return (byHours.find((t) => hoursBefore >= t.minHoursBeforeCheckIn) || byHours.at(-1)).refundPercent;
}
// Ghép ngày nhận phòng với giờ nhận chuẩn theo múi giờ Việt Nam.
const checkInAt = (checkInDate, time = DEFAULT_CHECK_IN) =>
  new Date(`${new Date(checkInDate).toISOString().slice(0, 10)}T${time}:00+07:00`);
module.exports = { currentDepositPolicy, currentCancellationPolicy, tiersProblem, refundPercent, checkInAt, DEFAULT_CHECK_IN };
