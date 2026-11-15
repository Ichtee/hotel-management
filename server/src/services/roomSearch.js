const Room = require('../models/Room');
const v = require('../utils/validation');
const { busyRooms, hotelDay } = require('./roomInventory');

// Dùng cùng kiểm tra giữ phòng với đặt và nhận phòng, không lặp công thức giao lịch.
async function searchAvailableRooms(query) {
  v.keys(query, ['hotelId', 'checkIn', 'checkOut', 'guests', 'minPrice', 'maxPrice']);
  if (query.hotelId) v.id(query.hotelId, 'hotelId');
  let from, to;
  if (query.checkIn || query.checkOut) {
    from = v.date(query.checkIn, 'checkIn'); to = v.date(query.checkOut, 'checkOut');
    if (from < hotelDay() || to <= from) v.fail('Choose a future stay with check-out after check-in.');
  }
  const guests = query.guests === undefined ? 1 : v.number(Number(query.guests), 'guests', 1, 100);
  const min = query.minPrice === undefined ? 0 : v.number(Number(query.minPrice), 'minPrice', 0);
  const max = query.maxPrice === undefined ? Number.MAX_SAFE_INTEGER : v.number(Number(query.maxPrice), 'maxPrice', min);
  const rooms = await Room.find({ isActive: true, status: { $ne: 'maintenance' }, ...(query.hotelId ? { hotelId: query.hotelId } : {}) }).select('roomNumber floor status roomTypeId').populate('roomTypeId', 'name basePrice maxOccupancy isActive').sort({ floor: 1, roomNumber: 1 }).lean();
  const busy = from ? await busyRooms(rooms.map(r => r._id), from, to) : new Set();
  return rooms.filter(r => !busy.has(String(r._id)) && r.roomTypeId?.isActive && r.roomTypeId.maxOccupancy >= guests && r.roomTypeId.basePrice >= min && r.roomTypeId.basePrice <= max);
}
module.exports = { searchAvailableRooms };
