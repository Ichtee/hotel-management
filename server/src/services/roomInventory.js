const Room = require("../models/Room");
const Booking = require("../models/Booking");
const v = require("../utils/validation");

// Lấy ngày hiện tại theo giờ khách sạn để kiểm tra các đêm còn lại.
function hotelDay(now = new Date()) {
  return new Date(now.getTime() + 7 * 3600000).toISOString().slice(0, 10);
}

// Chỉ tính booking còn giữ phòng, loại hold có thời hạn đã hết.
function holdingFilter(now = new Date()) {
  return { $or: [
    { status: { $in: ["confirmed", "cancellation_requested", "checked_in"] } },
    { status: "pending", $or: [{ holdExpiresAt: { $gt: now } }, { holdExpiresAt: null }] },
  ] };
}
// BR-29 for selling a room: an unpaid hold stops counting 15 minutes after it ended, without waiting for the expiry job.
// ponytail: the 15 extra minutes cover a deposit still at the gateway for every hold; check the pending payment per booking if that is too long.
const sellingFilter = (now = new Date()) => holdingFilter(new Date(now.getTime() - 15 * 60000));

// Quét các mốc đổi số lượng để phát hiện thiếu phòng mà không duyệt từng ngày.
async function capacityImpact(typeId, excludedRoomId, session, now = new Date()) {
  const today = hotelDay(now);
  const capacity = await Room.countDocuments({ roomTypeId: typeId, isActive: true, status: { $ne: "maintenance" },
    ...(excludedRoomId ? { _id: { $ne: excludedRoomId } } : {}) }).session(session);
  const bookings = await Booking.find({ ...holdingFilter(now), "rooms.roomTypeId": typeId,
    checkOutDate: { $gt: new Date(`${today}T00:00:00Z`) } })
    .select("bookingReference checkInDate checkOutDate status rooms.roomTypeId").session(session).lean();
  const events = new Map();
  const intervals = bookings.map((booking) => {
    const from = [today, booking.checkInDate.toISOString().slice(0, 10)].sort()[1];
    const to = booking.checkOutDate.toISOString().slice(0, 10);
    const count = booking.rooms.filter((r) => String(r.roomTypeId) === String(typeId)).length;
    if (from < to) {
      events.set(from, (events.get(from) || 0) + count);
      events.set(to, (events.get(to) || 0) - count);
    }
    return { booking, from, to };
  });
  const dates = [...events.keys()].sort();
  let held = 0;
  const shortages = [];
  for (let i = 0; i < dates.length - 1; i++) {
    held += events.get(dates[i]);
    if (held > capacity) shortages.push({ from: dates[i], to: dates[i + 1], required: held, capacity });
  }
  const affected = intervals.filter((r) => shortages.some((s) => r.from < s.to && s.from < r.to))
    .map(({ booking }) => ({ _id: booking._id, bookingReference: booking.bookingReference,
      checkInDate: booking.checkInDate, checkOutDate: booking.checkOutDate, status: booking.status }));
  return { capacity, shortages, affectedBookings: affected };
}

// Chặn giảm tồn phòng nếu bất kỳ đêm sắp tới nào không đủ sức chứa.
async function assertCapacity(typeId, excludedRoomId, session, now = new Date()) {
  const impact = await capacityImpact(typeId, excludedRoomId, session, now);
  if (impact.shortages.length) {
    const error = new v.HttpError(409, "Remaining rooms cannot cover upcoming bookings.");
    error.code = "MSG-61";
    error.details = impact;
    throw error;
  }
  return impact;
}
module.exports = { hotelDay, holdingFilter, sellingFilter, capacityImpact, assertCapacity };
