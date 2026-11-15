const { hotelDay } = require('./roomInventory');
const DAY = 86400000;
const atStart = (day) => new Date(`${day}T00:00:00+07:00`);
const rate = (used, total) => total ? Math.round(used / total * 10000) / 100 : 0;

// Nhận/trả cùng ngày tính một đêm; ngày đổi phòng lấy phòng cuối cùng.
function buildOccupancy(rooms, bookings, from, to, now = new Date()) {
  const warnings = new Set();
  const series = [];
  const days = new Map();
  for (let time = +atStart(from); time <= +atStart(to); time += DAY) days.set(hotelDay(new Date(time)), new Set());
  for (const booking of bookings) {
    if (!booking.actualCheckInAt || (booking.status === 'checked_out' && !booking.actualCheckOutAt)) {
      warnings.add('Some old stays have no actual check-in/out time and are excluded.');
      continue;
    }
    const arrival = hotelDay(new Date(booking.actualCheckInAt));
    const departure = hotelDay(new Date(booking.actualCheckOutAt || now));
    const stays = [...(booking.roomStays || [])].sort((a, b) => new Date(a.from) - new Date(b.from));
    const reliableFrom = stays[0]?.from;
    for (const [day, occupied] of days) {
      if (day < arrival || day > departure || (booking.actualCheckOutAt && day === departure && arrival !== departure)) continue;
      const next = +atStart(day) + DAY;
      const stay = stays.filter((s) => +new Date(s.from) < next).at(-1);
      if (stay) occupied.add(String(stay.roomId));
      else for (const line of booking.rooms || []) if (line.roomId) occupied.add(String(line.roomId));
      if (!reliableFrom || hotelDay(new Date(reliableFrom)) > day)
        warnings.add('Old stays lack room-change history; their last assigned room is used as an estimate.');
    }
  }
  const history = rooms.map((room) => ({ ...room, states: [...(room.availabilityHistory || [])].sort((a, b) => new Date(a.at) - new Date(b.at)) }));
  for (const [day, occupied] of days) {
    const next = +atStart(day) + DAY;
    const saleable = new Set(occupied);
    for (const room of history) {
      if (room.createdAt && +new Date(room.createdAt) >= next) continue;
      const state = room.states.filter((s) => +new Date(s.at) < next).at(-1);
      if (!state || (+new Date(room.states[0].at) > +atStart(day) && (!room.createdAt || +new Date(room.states[0].at) - +new Date(room.createdAt) > 1000)))
        warnings.add('Room availability before history tracking began is estimated from the earliest known state.');
      const available = state?.available ?? room.states[0]?.available ?? (room.isActive && room.status !== 'maintenance');
      // Phòng đã có khách vẫn thuộc mẫu số dù bị bảo trì sau lúc khách rời đi.
      if (available) saleable.add(String(room._id));
    }
    series.push({ date: day, occupiedRoomNights: occupied.size, availableRoomNights: saleable.size, rate: rate(occupied.size, saleable.size) });
  }
  const totals = series.reduce((sum, row) => ({ occupiedRoomNights: sum.occupiedRoomNights + row.occupiedRoomNights, availableRoomNights: sum.availableRoomNights + row.availableRoomNights }), { occupiedRoomNights: 0, availableRoomNights: 0 });
  totals.rate = rate(totals.occupiedRoomNights, totals.availableRoomNights);
  return { from, to, timezone: 'Asia/Ho_Chi_Minh', basis: 'actual_stay', totals, series, warnings: [...warnings] };
}

module.exports = { buildOccupancy, DAY, atStart };
