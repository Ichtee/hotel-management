const Booking = require("../models/Booking");
const Room = require("../models/Room");
const v = require("../utils/validation");

const dayMs = 86400000;
const atStart = (day) => new Date(`${day}T00:00:00+07:00`);
const dayKey = (date) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Ho_Chi_Minh" }).format(date);

// T09 / UC28: actual occupied room-nights divided by saleable room-nights.
async function occupancy(req, res) {
  v.keys(req.query, ["from", "to"]);
  const today = dayKey(new Date());
  const from = v.date(req.query.from || `${today.slice(0, 7)}-01`, "from");
  const to = v.date(req.query.to || today, "to");
  const start = atStart(from);
  const end = new Date(atStart(to).getTime() + dayMs);
  if (end <= start || end - start > dayMs * 366 * 5) v.fail("Choose an ordered date range of at most five years.");

  const [rooms, bookings] = await Promise.all([
    Room.find({ isActive: true, status: { $ne: "maintenance" } }).select("_id").lean(),
    Booking.find({ status: { $in: ["checked_in", "checked_out"] }, checkInDate: { $lt: end }, checkOutDate: { $gt: start } }).select("checkInDate checkOutDate rooms").lean(),
  ]);
  const saleable = new Set(rooms.map((room) => String(room._id)));
  const series = [];
  for (let cursor = new Date(start); cursor < end; cursor = new Date(cursor.getTime() + dayMs)) {
    const next = new Date(cursor.getTime() + dayMs);
    const occupied = new Set();
    for (const booking of bookings) {
      if (!(new Date(booking.checkInDate) < next && new Date(booking.checkOutDate) > cursor)) continue;
      for (const line of booking.rooms || []) if (line.roomId && saleable.has(String(line.roomId))) occupied.add(String(line.roomId));
    }
    const availableRoomNights = saleable.size;
    const occupiedRoomNights = occupied.size;
    series.push({ date: dayKey(cursor), occupiedRoomNights, availableRoomNights, rate: availableRoomNights ? Math.round(occupiedRoomNights / availableRoomNights * 10000) / 100 : 0 });
  }
  const totals = series.reduce((sum, row) => ({ occupiedRoomNights: sum.occupiedRoomNights + row.occupiedRoomNights, availableRoomNights: sum.availableRoomNights + row.availableRoomNights }), { occupiedRoomNights: 0, availableRoomNights: 0 });
  totals.rate = totals.availableRoomNights ? Math.round(totals.occupiedRoomNights / totals.availableRoomNights * 10000) / 100 : 0;
  res.json({ data: { from, to, timezone: "Asia/Ho_Chi_Minh", totals, series } });
}

module.exports = { occupancy };
