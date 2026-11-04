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

  // 7. UC07: Modify Reservation validation (BR-46)
  console.log('[Test Member 2] Testing UC07: Modify Reservation & BR-46 rules...');
  const fakeBookingId = id();
  const mockBooking = {
    _id: fakeBookingId,
    customerId: id(),
    hotelId,
    status: 'confirmed',
    checkInDate: new Date('2026-11-05T14:00:00Z'), // > 48h away
    checkOutDate: new Date('2026-11-09T12:00:00Z'),
    rooms: [
      { roomId: roomId1, roomTypeId: id(), priceAtBooking: 500000, guestCount: 1 }
    ],
    roomAmount: 2000000,
    totalAmount: 2000000,
    depositRequired: 400000,
    policySnapshot: {
      cancellationTiers: [
        { minHoursBeforeCheckIn: 48, refundPercent: 100 },
        { minHoursBeforeCheckIn: 0, refundPercent: 0 }
      ]
    },
    events: [],
    save: async function() { return this; }
  };

  const origBookingFindById = Booking.findById;
  Booking.findById = async (bId) => {
    if (String(bId) === String(fakeBookingId)) {
      return {
        ...mockBooking,
        populate: function() { return this; }
      };
    }
    return null;
  };

  // 7a. Non-existent booking throws 404
  await assert.rejects(
    async () => {
      await bookingService.modifyReservation(id(), { checkInDate: '2026-11-06' });
    },
    /Booking not found/
  );

  // 7b. Invalid checkOut <= checkIn rejected
  await assert.rejects(
    async () => {
      await bookingService.modifyReservation(fakeBookingId, {
        checkInDate: '2026-11-10',
        checkOutDate: '2026-11-08'
      });
    },
    /checkOutDate must be after checkInDate/
  );

  // 7c. Cancelled booking cannot be modified
  const cancelledBooking = { ...mockBooking, status: 'cancelled' };
  Booking.findById = async () => cancelledBooking;
  await assert.rejects(
    async () => {
      await bookingService.modifyReservation(fakeBookingId, { checkInDate: '2026-11-06' });
    },
    /Cannot modify booking with status "cancelled"/
  );

  // 7d. BR-46: Near check-in date (< 48h, 0% refund tier) blocks date modification
  const nearCheckinBooking = {
    ...mockBooking,
    status: 'confirmed',
    checkInDate: new Date(Date.now() + 24 * 3600000) // 24h away (< 48h)
  };
  Booking.findById = async () => nearCheckinBooking;
  await assert.rejects(
    async () => {
      await bookingService.modifyReservation(fakeBookingId, {
        checkInDate: new Date(Date.now() + 48 * 3600000)
      });
    },
    /Stay dates cannot be modified because cancellation is no longer eligible for a full refund/
  );

  // 8. UC08: Cancel Reservation validation (BR-16, BR-17, BR-29, BR-36)
  console.log('[Test Member 2] Testing UC08: Cancel Reservation & Cancellation Requested...');

  // 8a. Pending reservation: calls abandonPayment and sets status to 'expired' (BR-29)
  const pendingBooking = {
    ...mockBooking,
    status: 'pending',
    events: [],
    save: async function() { return this; }
  };
  Booking.findById = async () => pendingBooking;
  const abandonResult = await bookingService.abandonPayment(fakeBookingId);
  assert.equal(abandonResult.status, 'expired', 'Abandoned pending booking must become expired');

  // 8b. Confirmed reservation > 48h away with refundAccount transitions to 'cancellation_requested' (BR-16, BR-32)
  const confirmedBooking = {
    ...mockBooking,
    status: 'confirmed',
    checkInDate: new Date('2026-11-15T14:00:00Z'), // > 48h away
    events: [],
    save: async function() { return this; }
  };
  Booking.findById = async () => confirmedBooking;
  const cancelReqResult = await bookingService.cancelReservation(fakeBookingId, {
    reason: 'Schedule changed',
    refundAccount: {
      bank: 'Vietcombank',
      accountNumber: '123456789',
      holderName: 'Valued Guest'
    }
  });
  assert.equal(cancelReqResult.status, 'cancellation_requested', 'Eligible confirmed booking cancellation must become cancellation_requested');
  assert.equal(cancelReqResult.cancellation.refundableAmount, 400000, 'Refundable amount must equal 100% of deposit');
  assert.equal(cancelReqResult.refundAccount.bank, 'Vietcombank');

  // 8c. Withdraw cancellation request restores status to 'confirmed' (BR-36)
  const cancellationRequestedBooking = {
    ...cancelReqResult,
    status: 'cancellation_requested',
    events: [],
    save: async function() { return this; }
  };
  Booking.findById = async () => cancellationRequestedBooking;
  const withdrawResult = await bookingService.withdrawCancellation(fakeBookingId);
  assert.equal(withdrawResult.status, 'confirmed', 'Withdrawn cancellation request must return status to confirmed');

  // 9. UC37: Occupancy Report Calculation
  console.log('[Test Member 2] Testing UC37: Occupancy Report math & exclusions...');
  const origRoomFind2 = Room.find;
  const origBookingFind2 = Booking.find;

  // 10 total physical rooms: 8 available, 2 maintenance
  const mockPhysicalRooms = Array.from({ length: 10 }, (_, i) => ({
    _id: id(),
    roomNumber: `Room-${i + 1}`,
    status: i < 2 ? 'maintenance' : 'available',
    roomTypeId: { name: 'Deluxe' }
  }));

  Room.find = () => ({
    populate: async () => mockPhysicalRooms
  });

  // 4 overlapping bookings active during date range
  Booking.find = async () => [
    { checkInDate: new Date('2026-11-01'), checkOutDate: new Date('2026-11-04'), rooms: [{ roomId: mockPhysicalRooms[2]._id }] },
    { checkInDate: new Date('2026-11-01'), checkOutDate: new Date('2026-11-04'), rooms: [{ roomId: mockPhysicalRooms[3]._id }] },
    { checkInDate: new Date('2026-11-01'), checkOutDate: new Date('2026-11-04'), rooms: [{ roomId: mockPhysicalRooms[4]._id }] },
    { checkInDate: new Date('2026-11-01'), checkOutDate: new Date('2026-11-04'), rooms: [{ roomId: mockPhysicalRooms[5]._id }] }
  ];

  const occupancyRep = await bookingService.getOccupancyReport({
    hotelId,
    startDate: '2026-11-01',
    endDate: '2026-11-03'
  });

  assert.equal(occupancyRep.totals.totalPhysicalRooms, 10, 'Total physical rooms should be 10');
  // 3 days * 2 maintenance rooms = 6 maintenance nights
  assert.equal(occupancyRep.totals.totalMaintenanceNights, 6, '3 days * 2 maintenance = 6');
  // 3 days * 8 sellable rooms = 24 sellable nights
  assert.equal(occupancyRep.totals.totalSellableNights, 24, '3 days * 8 sellable = 24');
  // 3 days * 4 occupied rooms = 12 occupied nights
  assert.equal(occupancyRep.totals.totalOccupiedNights, 12, '3 days * 4 occupied = 12');
  // Average occupancy = (12 / 24) * 100 = 50%
  assert.equal(occupancyRep.totals.averageOccupancyRate, 50, 'Occupancy rate should equal 50%');

  // Restore all mocks
  Booking.findById = origBookingFindById;
  Room.find = origRoomFind2;
  Booking.find = origBookingFind2;

  console.log('✅ [Test Member 2] All Member 2 models, schema validations, pricing, T06 availability, UC07 core, UC12 modify, UC13 cancel, and UC37 occupancy report tests passed successfully!');
}

testMember2Logic().catch(err => {
  console.error('❌ [Test Member 2 Failed]:', err);
  process.exit(1);
});

