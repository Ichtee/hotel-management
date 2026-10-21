const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const RoomType = require('../src/models/RoomType');
const Room = require('../src/models/Room');
const Booking = require('../src/models/Booking');
const CleaningTask = require('../src/models/CleaningTask');
const RoomIssue = require('../src/models/RoomIssue');
const roomTypeService = require('../src/services/roomTypeService');
const roomService = require('../src/services/roomService');
const bookingService = require('../src/services/bookingService');

async function testMember2Logic() {
  console.log('[Test Member 2] Starting validation of Member 2 business logic and models...');

  const id = () => new mongoose.Types.ObjectId();
  const hotelId = id();

  // 1. Test RoomType seasonal price calculation
  const testSeasonal = {
    _id: id(),
    hotelId,
    name: 'Deluxe Suite Test',
    basePrice: 1000000,
    maxOccupancy: 2,
    seasonalPricing: [
      {
        startDate: new Date('2026-12-24T00:00:00Z'),
        endDate: new Date('2026-12-31T23:59:59Z'),
        price: 1500000,
        seasonName: 'Christmas & New Year'
      }
    ]
  };

  // Mock getRoomTypeById for calculatePriceForDate test
  const originalGetById = roomTypeService.getRoomTypeById;
  roomTypeService.getRoomTypeById = async () => testSeasonal;

  const normalDatePrice = await roomTypeService.calculatePriceForDate(testSeasonal._id, new Date('2026-11-01'));
  assert.equal(normalDatePrice.price, 1000000, 'Normal date should return basePrice');
  assert.equal(normalDatePrice.isSeasonal, false);

  const seasonalDatePrice = await roomTypeService.calculatePriceForDate(testSeasonal._id, new Date('2026-12-25'));
  assert.equal(seasonalDatePrice.price, 1500000, 'Christmas date should return seasonal price');
  assert.equal(seasonalDatePrice.isSeasonal, true);
  assert.equal(seasonalDatePrice.seasonName, 'Christmas & New Year');

  roomTypeService.getRoomTypeById = originalGetById; // restore

  // 2. Validate Room model operational status enums
  const validRoom = new Room({
    hotelId,
    roomTypeId: id(),
    roomNumber: '301',
    floor: 3,
    status: 'available'
  });
  assert.equal(validRoom.validateSync(), undefined, 'Valid room should pass schema validation');

  const invalidStatusRoom = new Room({
    hotelId,
    roomTypeId: id(),
    roomNumber: '302',
    status: 'invalid_status'
  });
  assert.match(invalidStatusRoom.validateSync().message, /status/, 'Invalid status should be rejected by enum validator');

  // 3. Validate CleaningTask model status enums
  const validTask = new CleaningTask({
    roomId: id(),
    status: 'pending'
  });
  assert.equal(validTask.validateSync(), undefined);

  // 4. Validate RoomIssue model severity and status enums
  const validIssue = new RoomIssue({
    roomId: id(),
    reportedBy: id(),
    title: 'Water pipe leak',
    severity: 'high'
  });
  assert.equal(validIssue.validateSync(), undefined);
  assert.equal(validIssue.severity, 'high');

  // 5. T06: Room Availability Validation (Date overlap & Double booking prevention)
  console.log('[Test Member 2] Testing T06: Room Availability & Validation rules...');

  // 5a. Validate duplicate room in same booking is rejected by model validator
  const duplicateRoomId = id();
  const doubleBooked = new Booking({
    customerId: id(),
    hotelId,
    createdBy: id(),
    checkInDate: new Date('2026-11-10'),
    checkOutDate: new Date('2026-11-15'),
    rooms: [
      { roomId: duplicateRoomId, roomTypeId: id(), priceAtBooking: 500000, guestCount: 1 },
      { roomId: duplicateRoomId, roomTypeId: id(), priceAtBooking: 500000, guestCount: 1 }
    ],
    roomAmount: 1000000,
    totalAmount: 1000000
  });
  const doubleBookingErr = doubleBooked.validateSync();
  assert.ok(doubleBookingErr, 'Double booking identical roomId should trigger error');
  assert.match(doubleBookingErr.message, /A room cannot be assigned twice in one booking/);

  // 5b. Validate date inversion (checkOut <= checkIn) throws error in searchAvailableRooms
  await assert.rejects(
    async () => {
      await roomService.searchAvailableRooms({
        checkInDate: '2026-11-20',
        checkOutDate: '2026-11-19'
      });
    },
    /checkOutDate must be after checkInDate/
  );

  // 5c. Validate date overlap calculation logic
  const roomId1 = id();
  const roomId2 = id();
  const sampleRooms = [
    { _id: roomId1, roomNumber: '101', status: 'available', isActive: true, roomTypeId: { _id: id(), isActive: true, basePrice: 100, maxOccupancy: 2 } },
    { _id: roomId2, roomNumber: '102', status: 'available', isActive: true, roomTypeId: { _id: id(), isActive: true, basePrice: 150, maxOccupancy: 2 } }
  ];

  // Mock Room.find and Booking.find for unit validation
  const originalRoomFind = Room.find;
  const originalBookingFind = Booking.find;

  Room.find = () => ({
    populate: async () => sampleRooms
  });

  // Conflicting booking on roomId1: [2026-11-10 to 2026-11-15]
  Booking.find = () => ({
    select: async () => [
      { rooms: [{ roomId: roomId1 }] }
    ]
  });

  // Search during overlapping window: [2026-11-12 to 2026-11-16]
  const availableDuringOverlap = await roomService.searchAvailableRooms({
    checkInDate: '2026-11-12',
    checkOutDate: '2026-11-16'
  });

  assert.equal(availableDuringOverlap.length, 1, 'Overlapping booked room must be excluded');
  assert.equal(String(availableDuringOverlap[0]._id), String(roomId2), 'Only non-conflicting room 102 should be available');

  // Restore mocks
  Room.find = originalRoomFind;
  Booking.find = originalBookingFind;

  // 6. UC07: Make Reservation Core validation
  console.log('[Test Member 2] Testing UC07: Make Reservation core...');

  // 6a. Empty rooms validation
  await assert.rejects(
    async () => {
      await bookingService.createOnlineReservation({
        checkInDate: '2026-12-01',
        checkOutDate: '2026-12-05',
        rooms: []
      });
    },
    /At least one room is required for reservation/
  );

  // 6b. Booking reference generator produces valid BK-XXXX format
  const ref = await bookingService.generateBookingReference();
  assert.match(ref, /^BK-\d+$/, 'Booking reference should match BK-XXXX format');

  console.log('✅ [Test Member 2] All Member 2 models, schema validations, pricing, T06 availability, and UC07 core tests passed successfully!');
}

testMember2Logic().catch(err => {
  console.error('❌ [Test Member 2 Failed]:', err);
  process.exit(1);
});
