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

// Tính cả lịch chờ cọc và loại phòng từng đêm trước khi giảm tồn phòng.
async function capacityImpact(typeId, excludedRoomId, session, now = new Date()) {
  const today = hotelDay(now);
  const capacity = await Room.countDocuments({ roomTypeId: typeId, isActive: true, status: { $ne: "maintenance" }, ...(excludedRoomId ? { _id: { $ne: excludedRoomId } } : {}) }).session(session);
  const bookings = await Booking.find({ status: { $in: ["pending", "confirmed", "cancellation_requested", "checked_in"] }, $or: [{ checkOutDate: { $gt: new Date(today) } }, { "pendingChange.checkOutDate": { $gt: new Date(today) } }] })
    .select("bookingReference checkInDate checkOutDate status rooms nightlyRates pendingChange holdExpiresAt").session(session).lean();
  const pending = await require("../models/Payment").find({ bookingId: { $in: bookings.filter((b) => b.status === "pending").map((b) => b._id) }, status: "pending", gatewayOrderId: { $exists: true } }).select("bookingId createdAt").session(session).lean();
  const events = new Map(), intervals = [];
  for (const booking of bookings) {
    const grace = pending.some((o) => String(o.bookingId) === String(booking._id) && o.createdAt <= booking.holdExpiresAt) ? 900000 : 0;
    if (booking.status === "pending" && booking.holdExpiresAt && +booking.holdExpiresAt + grace <= +now) continue;
    const perNight = new Map();
    const add = (start, end, rates) => {
      const from = new Date(Math.max(+new Date(today), +start)), to = new Date(end);
      for (let timestamp = +from; timestamp < +to; timestamp += 86400000) {
        const date = new Date(timestamp).toISOString().slice(0, 10);
        const count = rates?.length ? rates.filter((r) => r.date === date && String(r.roomTypeId) === String(typeId)).length : booking.rooms.filter((r) => String(r.roomTypeId) === String(typeId)).length;
        perNight.set(date, Math.max(perNight.get(date) || 0, count));
      }
    };
    add(booking.checkInDate, booking.checkOutDate, booking.nightlyRates);
    if (booking.pendingChange?.holdExpiresAt > now) add(booking.pendingChange.checkInDate, booking.pendingChange.checkOutDate, booking.pendingChange.nightlyRates);
    for (const [from, count] of perNight) {
      if (!count) continue;
      const to = new Date(Date.parse(from) + 86400000).toISOString().slice(0, 10);
      events.set(from, (events.get(from) || 0) + count); events.set(to, (events.get(to) || 0) - count);
      intervals.push({ booking, from, to });
    }
  }
  const dates = [...events.keys()].sort(), shortages = [];
  let held = 0;
  for (let i = 0; i < dates.length - 1; i++) {
    held += events.get(dates[i]);
    if (held > capacity) shortages.push({ from: dates[i], to: dates[i + 1], required: held, capacity });
  }
  const affected = new Map();
  for (const r of intervals) if (shortages.some((s) => r.from < s.to && s.from < r.to)) {
    const { booking } = r;
    affected.set(String(booking._id), { _id: booking._id, bookingReference: booking.bookingReference, checkInDate: booking.checkInDate, checkOutDate: booking.checkOutDate, status: booking.status });
  }
  return { capacity, shortages, affectedBookings: [...affected.values()] };
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
module.exports = { hotelDay, holdingFilter, capacityImpact, assertCapacity };
