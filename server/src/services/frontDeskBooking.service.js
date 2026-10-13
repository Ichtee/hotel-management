const mongoose = require('mongoose');
const Booking = require('../models/Booking');
const Room = require('../models/Room');
const RoomType = require('../models/RoomType');
const Service = require('../models/Service');
const Invoice = require('../models/Invoice');
const { appError } = require('../utils/http');

const ACTIVE_BOOKING_STATUSES = ['pending', 'confirmed', 'checked_in'];
const editableStatuses = ['pending', 'confirmed'];
const isId = value => mongoose.isObjectIdOrHexString(value);
const asDate = value => {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) throw appError('Invalid date');
  return date;
};
const validDates = (checkInDate, checkOutDate) => {
  const checkIn = asDate(checkInDate);
  const checkOut = asDate(checkOutDate);
  if (checkOut <= checkIn) throw appError('checkOutDate must be after checkInDate');
  return { checkIn, checkOut };
};
const totals = booking => {
  booking.serviceAmount = booking.services.reduce((sum, item) => sum + item.amount, 0);
  booking.totalAmount = booking.roomAmount + booking.serviceAmount - booking.discountAmount;
};

async function assertRoomsAvailable({ hotelId, roomIds, checkIn, checkOut, ignoredBookingId }) {
  if (!Array.isArray(roomIds) || roomIds.length === 0 || roomIds.some(id => !isId(id))) throw appError('At least one valid roomId is required');
  if (new Set(roomIds.map(String)).size !== roomIds.length) throw appError('A room can only be selected once');
  const rooms = await Room.find({ _id: { $in: roomIds }, hotelId, isActive: true });
  if (rooms.length !== roomIds.length) throw appError('One or more rooms do not belong to this active hotel');
  const conflictFilter = {
    status: { $in: ACTIVE_BOOKING_STATUSES },
    'rooms.roomId': { $in: roomIds },
    checkInDate: { $lt: checkOut },
    checkOutDate: { $gt: checkIn }
  };
  if (ignoredBookingId) conflictFilter._id = { $ne: ignoredBookingId };
  if (await Booking.exists(conflictFilter)) throw appError('One or more rooms are already booked for these dates', 409);
  return rooms;
}

async function pricingForRooms(hotelId, requestedRooms, checkIn, checkOut, ignoredBookingId) {
  const roomIds = requestedRooms.map(room => room.roomId);
  const rooms = await assertRoomsAvailable({ hotelId, roomIds, checkIn, checkOut, ignoredBookingId });
  const types = await RoomType.find({ _id: { $in: rooms.map(room => room.roomTypeId) }, hotelId, isActive: true });
  const typeById = new Map(types.map(type => [String(type._id), type]));
  const nights = Math.ceil((checkOut - checkIn) / 86400000);
  return requestedRooms.map(item => {
    const room = rooms.find(candidate => String(candidate._id) === String(item.roomId));
    const type = typeById.get(String(room.roomTypeId));
    if (!type) throw appError(`Room ${room.roomNumber} has no active room type`);
    const guestCount = Number(item.guestCount || 1);
    if (!Number.isInteger(guestCount) || guestCount < 1 || (type.maxOccupancy && guestCount > type.maxOccupancy)) throw appError(`Invalid guestCount for room ${room.roomNumber}`);
    return { roomId: room._id, roomTypeId: type._id, priceAtBooking: type.basePrice, guestCount, amount: type.basePrice * nights };
  });
}

function newReference() { return `BK-${Date.now().toString().slice(-8)}-${Math.random().toString(36).slice(2, 5).toUpperCase()}`; }

async function createBooking(payload, actorId) {
  const { hotelId, customerId, checkInDate, checkOutDate, rooms, guestName, guestPhone, currency = 'VND' } = payload;
  if (![hotelId, customerId, actorId].every(isId)) throw appError('hotelId, customerId and staff identity must be valid IDs');
  const { checkIn, checkOut } = validDates(checkInDate, checkOutDate);
  const bookedRooms = await pricingForRooms(hotelId, rooms || [], checkIn, checkOut);
  const roomAmount = bookedRooms.reduce((sum, room) => sum + room.amount, 0);
  const booking = await Booking.create({
    bookingReference: newReference(), hotelId, customerId, createdBy: actorId, checkInDate: checkIn, checkOutDate: checkOut, status: 'confirmed',
    rooms: bookedRooms.map(({ amount, ...room }) => room), roomAmount, totalAmount: roomAmount, guestName, guestPhone, currency,
    bookingSource: 'front_desk', events: [{ actorId, type: 'created', note: 'Booking created by front desk' }]
  });
  return booking;
}

async function modifyBooking(bookingId, payload, actorId) {
  const booking = await Booking.findById(bookingId);
  if (!booking) throw appError('Booking not found', 404);
  if (!editableStatuses.includes(booking.status)) throw appError('Only pending or confirmed bookings can be modified', 409);
  const { checkIn, checkOut } = validDates(payload.checkInDate || booking.checkInDate, payload.checkOutDate || booking.checkOutDate);
  let roomAmount = booking.roomAmount;
  if (payload.rooms) {
    const roomIds = payload.rooms.map(room => room.roomId);
    await assertRoomsAvailable({ hotelId: booking.hotelId, roomIds, checkIn, checkOut, ignoredBookingId: booking._id });
    const rooms = await pricingForRooms(booking.hotelId, payload.rooms, checkIn, checkOut, booking._id);
    booking.rooms = rooms.map(({ amount, ...room }) => room);
    roomAmount = rooms.reduce((sum, room) => sum + room.amount, 0);
  } else if (+checkIn !== +booking.checkInDate || +checkOut !== +booking.checkOutDate) {
    await assertRoomsAvailable({ hotelId: booking.hotelId, roomIds: booking.rooms.map(room => room.roomId), checkIn, checkOut, ignoredBookingId: booking._id });
    const nights = Math.ceil((checkOut - checkIn) / 86400000);
    roomAmount = booking.rooms.reduce((sum, room) => sum + room.priceAtBooking * nights, 0);
  }
  const oldValue = { checkInDate: booking.checkInDate, checkOutDate: booking.checkOutDate, rooms: booking.rooms.map(room => room.roomId) };
  booking.checkInDate = checkIn; booking.checkOutDate = checkOut; booking.roomAmount = roomAmount;
  if (payload.guestName !== undefined) booking.guestName = payload.guestName;
  if (payload.guestPhone !== undefined) booking.guestPhone = payload.guestPhone;
  totals(booking);
  booking.events.push({ actorId, type: 'modified', note: payload.note || 'Booking updated by front desk', oldValue, newValue: { checkInDate: checkIn, checkOutDate: checkOut, rooms: booking.rooms.map(room => room.roomId) } });
  await booking.save(); return booking;
}

async function cancelBooking(bookingId, { reason }, actorId) {
  const booking = await Booking.findById(bookingId);
  if (!booking) throw appError('Booking not found', 404);
  if (!editableStatuses.includes(booking.status)) throw appError('Only pending or confirmed bookings can be cancelled', 409);
  booking.status = 'cancelled'; booking.cancelledAt = new Date(); booking.cancellationReason = reason || 'Cancelled by front desk';
  booking.events.push({ actorId, type: 'cancelled', note: booking.cancellationReason }); await booking.save(); return booking;
}

async function checkIn(bookingId, actorId) {
  const booking = await Booking.findById(bookingId);
  if (!booking) throw appError('Booking not found', 404);
  if (booking.status !== 'confirmed') throw appError('Only confirmed bookings can be checked in', 409);
  const ids = booking.rooms.map(room => room.roomId);
  const result = await Room.updateMany({ _id: { $in: ids }, hotelId: booking.hotelId, status: 'available', isActive: true }, { $set: { status: 'occupied' } });
  if (result.modifiedCount !== ids.length) throw appError('Every assigned room must be available before check-in', 409);
  booking.status = 'checked_in'; booking.actualCheckInAt = new Date(); booking.checkedInBy = actorId;
  booking.events.push({ actorId, type: 'checked_in', note: 'Guest checked in' }); await booking.save(); return booking;
}

async function changeRoom(bookingId, { oldRoomId, newRoomId, note }, actorId) {
  const booking = await Booking.findById(bookingId);
  if (!booking) throw appError('Booking not found', 404);
  if (booking.status !== 'checked_in') throw appError('Rooms can only be changed for checked-in bookings', 409);
  const index = booking.rooms.findIndex(room => String(room.roomId) === String(oldRoomId));
  if (index < 0 || !isId(newRoomId)) throw appError('Invalid oldRoomId or newRoomId');
  const [oldRoom, newRoom] = await Promise.all([Room.findById(oldRoomId), Room.findOne({ _id: newRoomId, hotelId: booking.hotelId, isActive: true, status: 'available' })]);
  if (!oldRoom || !newRoom) throw appError('The old room is invalid or the new room is unavailable', 409);
  const newType = await RoomType.findOne({ _id: newRoom.roomTypeId, hotelId: booking.hotelId, isActive: true });
  if (!newType) throw appError('New room type is not active', 409);
  const oldItem = booking.rooms[index];
  const nights = Math.ceil((booking.checkOutDate - booking.checkInDate) / 86400000);
  booking.rooms[index] = { roomId: newRoom._id, roomTypeId: newType._id, priceAtBooking: newType.basePrice, guestCount: oldItem.guestCount };
  booking.roomAmount = booking.rooms.reduce((sum, room) => sum + room.priceAtBooking * nights, 0); totals(booking);
  const occupied = await Room.updateOne({ _id: newRoom._id, status: 'available' }, { $set: { status: 'occupied' } });
  if (!occupied.modifiedCount) throw appError('New room is no longer available', 409);
  await Room.updateOne({ _id: oldRoom._id }, { $set: { status: 'cleaning' } });
  booking.events.push({ actorId, type: 'room_changed', note: note || 'Room changed during stay', oldValue: { roomId: oldRoom._id }, newValue: { roomId: newRoom._id } });
  await booking.save(); return booking;
}

async function recordService(bookingId, { serviceId, quantity = 1, note }, actorId) {
  const booking = await Booking.findById(bookingId);
  if (!booking) throw appError('Booking not found', 404);
  if (booking.status !== 'checked_in') throw appError('Services can only be recorded for checked-in bookings', 409);
  if (!isId(serviceId) || !Number.isInteger(Number(quantity)) || Number(quantity) < 1) throw appError('serviceId and a positive integer quantity are required');
  const service = await Service.findOne({ _id: serviceId, hotelId: booking.hotelId, isActive: true });
  if (!service) throw appError('Service is unavailable', 404);
  const item = { serviceId: service._id, name: service.name, quantity: Number(quantity), unitPrice: service.unitPrice, amount: service.unitPrice * Number(quantity), recordedBy: actorId };
  booking.services.push(item); totals(booking);
  booking.events.push({ actorId, type: 'service_added', note: note || `Added ${item.name}`, newValue: { serviceId: service._id, quantity: item.quantity, amount: item.amount } });
  await booking.save(); return booking;
}

async function checkOut(bookingId, actorId) {
  const booking = await Booking.findById(bookingId);
  if (!booking) throw appError('Booking not found', 404);
  if (booking.status !== 'checked_in') throw appError('Only checked-in bookings can be checked out', 409);
  const ids = booking.rooms.map(room => room.roomId);
  await Room.updateMany({ _id: { $in: ids }, hotelId: booking.hotelId }, { $set: { status: 'cleaning' } });
  booking.status = 'checked_out'; booking.actualCheckOutAt = new Date(); booking.checkedOutBy = actorId;
  booking.events.push({ actorId, type: 'checked_out', note: 'Guest checked out' }); await booking.save();
  const invoice = await Invoice.findOneAndUpdate({ bookingId: booking._id }, { $setOnInsert: { bookingId: booking._id, invoiceNumber: `INV-${Date.now()}`, issuedBy: actorId, issuedAt: new Date() }, $set: { subtotal: booking.roomAmount + booking.serviceAmount, totalAmount: booking.totalAmount, status: 'unpaid' } }, { new: true, upsert: true });
  return { booking, invoice };
}

module.exports = { createBooking, modifyBooking, cancelBooking, checkIn, changeRoom, recordService, checkOut };
