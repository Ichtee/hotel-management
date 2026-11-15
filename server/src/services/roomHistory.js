const Room = require('../models/Room');
const { hotelTransaction } = require('./hotelOperations');

// Chụp trạng thái hiện tại một lần khi triển khai, không gán ngược về ngày tạo phòng.
async function initializeRoomHistory() {
  return hotelTransaction(() => Room.updateMany({ 'availabilityHistory.0': { $exists: false } }, [{
    $set: { availabilityHistory: [{ at: '$$NOW', available: { $and: ['$isActive', { $ne: ['$status', 'maintenance'] }] } }] },
  }]));
}

// Dùng save để mọi thay đổi khả năng bán đều được ghi vào lịch sử.
async function setRoomStatus(id, status) {
  const room = await Room.findById(id);
  if (!room) throw new Error('The assigned room no longer exists.');
  room.status = status;
  await room.save();
}

function beginRoomStay(booking, roomId, now = new Date()) {
  for (const stay of booking.roomStays) if (!stay.to) stay.to = now;
  booking.roomStays.push({ roomId, from: now });
}

module.exports = { initializeRoomHistory, setRoomStatus, beginRoomStay };
