const Booking = require('../models/Booking');
const Room = require('../models/Room');
const v = require('../utils/validation');
const { hotelDay } = require('../services/roomInventory');
const { buildOccupancy, DAY, atStart } = require('../services/occupancy');

// Báo cáo chỉ dùng thời gian nhận/trả thực tế; dữ liệu cũ thiếu lịch sử được ghi chú.
async function occupancy(req, res) {
  v.keys(req.query, ['from', 'to', 'format']);
  const now = new Date();
  const today = hotelDay(now);
  const from = v.date(req.query.from || today.slice(0, 7) + '-01', 'from');
  const to = v.date(req.query.to || today, 'to');
  if (to < from || +atStart(to) - +atStart(from) >= DAY * 366 * 5 || to > today)
    v.fail('Choose an ordered range of at most five years, ending no later than today.');
  if (req.query.format !== undefined) v.choice(req.query.format, 'format', ['csv']);
  const [rooms, bookings] = await Promise.all([
    Room.find().select('isActive status createdAt availabilityHistory').lean(),
    Booking.find({ status: { $in: ['checked_in', 'checked_out'] }, $or: [
      { actualCheckInAt: { $lt: new Date(+atStart(to) + DAY) }, $or: [{ actualCheckOutAt: { $gte: atStart(from) } }, { actualCheckOutAt: null }] },
      { actualCheckInAt: null, checkInDate: { $lt: new Date(+atStart(to) + DAY) }, checkOutDate: { $gte: atStart(from) } },
    ] }).select('status actualCheckInAt actualCheckOutAt rooms roomStays').lean(),
  ]);
  const data = buildOccupancy(rooms, bookings, from, to, now);
  if (req.query.format === 'csv') {
    const rows = ['Date,Available room-nights,Occupied room-nights,Occupancy rate (%)', ...data.series.map((r) => [r.date, r.availableRoomNights, r.occupiedRoomNights, r.rate].join(','))];
    for (const warning of data.warnings) rows.push('"Note: ' + warning.replaceAll('"', '""') + '"');
    res.attachment('occupancy-' + from + '-' + to + '.csv').type('text/csv').send('\uFEFF' + rows.join('\r\n'));
    return;
  }
  res.json({ data });
}

module.exports = { occupancy };
