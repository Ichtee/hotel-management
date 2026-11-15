const Booking = require("../models/Booking");
const Request = require("../models/CheckInOutRequest");
const { dropPhotos } = require("./idPhoto");
const { hotelDay } = require("./roomInventory");

// Sau 06:00 ngày kế tiếp, booking chưa nhận phòng chuyển thành khách không đến và giữ cọc.
// Dịch mốc tính lùi sáu giờ để lượt chạy bù trước 06:00 không xử lý nhầm khách đêm trước.
async function processNoShows(now = new Date()) {
  const cutoffDay = new Date(`${hotelDay(new Date(now.getTime() - 6 * 3600000))}T00:00:00Z`);
  const due = await Booking.find({ status: "confirmed", checkInDate: { $lt: cutoffDay } }).distinct("_id");
  const result = await Booking.updateMany({ _id: { $in: due }, status: "confirmed" }, { $set: { status: "no_show", noShowAt: now } });
  await dropPhotos({ bookingId: { $in: due }, status: { $in: ["pending", "approved"] } });
  await Request.updateMany({ bookingId: { $in: due }, status: { $in: ["pending", "approved"] } }, { $set: { status: "cancelled" } });
  return { markedNoShow: result.modifiedCount };
}
module.exports = { processNoShows };
