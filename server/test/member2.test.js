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

  // Kiểm tra giá loại phòng theo mùa.
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

  // Giả lập truy vấn loại phòng khi tính giá theo ngày.
  const originalGetById = roomTypeService.getRoomTypeById;
  roomTypeService.getRoomTypeById = async () => testSeasonal;

  const normalDatePrice = await roomTypeService.calculatePriceForDate(testSeasonal._id, new Date('2026-11-01'));
  assert.equal(normalDatePrice.price, 1000000, 'Normal date should return basePrice');
  assert.equal(normalDatePrice.isSeasonal, false);

  const seasonalDatePrice = await roomTypeService.calculatePriceForDate(testSeasonal._id, new Date('2026-12-25'));
  assert.equal(seasonalDatePrice.price, 1500000, 'Christmas date should return seasonal price');
  assert.equal(seasonalDatePrice.isSeasonal, true);
  assert.equal(seasonalDatePrice.seasonName, 'Christmas & New Year');

  // Khôi phục hàm gốc sau test.
  roomTypeService.getRoomTypeById = originalGetById;

  // Kiểm tra các trạng thái vận hành hợp lệ của phòng.
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

  // Kiểm tra các trạng thái hợp lệ của nhiệm vụ dọn phòng.
  const validTask = new CleaningTask({
    roomId: id(),
    status: 'pending'
  });
  assert.equal(validTask.validateSync(), undefined);

  // Kiểm tra mức độ và trạng thái sự cố phòng.
  const validIssue = new RoomIssue({
    roomId: id(),
    reportedBy: id(),
    title: 'Water pipe leak',
    severity: 'high'
  });
  assert.equal(validIssue.validateSync(), undefined);
  assert.equal(validIssue.severity, 'high');

  // Kiểm tra phòng trống, ngày giao nhau và phòng bị đặt trùng.
  console.log('[Test Member 2] Testing T06: Room Availability & Validation rules...');

  // Từ chối một phòng xuất hiện hai lần trong cùng booking.
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

  // Từ chối ngày trả không sau ngày nhận.
  await assert.rejects(
    async () => {
      await roomService.searchAvailableRooms({
        checkInDate: '2026-11-20',
        checkOutDate: '2026-11-19'
      });
    },
    /checkOutDate must be after checkInDate/
  );

  // Kiểm tra logic giao nhau của khoảng ngày.
  const roomId1 = id();
  const roomId2 = id();
  const sampleRooms = [
    { _id: roomId1, roomNumber: '101', status: 'available', isActive: true, roomTypeId: { _id: id(), isActive: true, basePrice: 100, maxOccupancy: 2 } },
    { _id: roomId2, roomNumber: '102', status: 'available', isActive: true, roomTypeId: { _id: id(), isActive: true, basePrice: 150, maxOccupancy: 2 } }
  ];

  // Giả lập truy vấn phòng và booking để kiểm tra độc lập.
  const originalRoomFind = Room.find;
  const originalBookingFind = Booking.find;

  Room.find = () => ({
    populate: async () => sampleRooms
  });

  // Tạo booking giữ phòng từ 10/11 đến 15/11/2026.
  Booking.find = () => ({
    select: async () => [
      { rooms: [{ roomId: roomId1 }] }
    ]
  });

  // Tìm từ 12/11 đến 16/11/2026 để tạo khoảng chồng lấn.
  const availableDuringOverlap = await roomService.searchAvailableRooms({
    checkInDate: '2026-11-12',
    checkOutDate: '2026-11-16'
  });

  assert.equal(availableDuringOverlap.length, 1, 'Overlapping booked room must be excluded');
  assert.equal(String(availableDuringOverlap[0]._id), String(roomId2), 'Only non-conflicting room 102 should be available');

  // Khôi phục truy vấn thật sau test.
  Room.find = originalRoomFind;
  Booking.find = originalBookingFind;

  // Kiểm tra dữ liệu đầu vào khi tạo booking.
  console.log('[Test Member 2] Testing UC07: Make Reservation core...');

  // Từ chối danh sách phòng rỗng.
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

  // Mã booking phải đúng định dạng BK-XXXX.
  const ref = await bookingService.generateBookingReference();
  assert.match(ref, /^BK-\d+$/, 'Booking reference should match BK-XXXX format');

  // Kiểm tra điều kiện sửa booking theo chính sách hoàn tiền.
  console.log('[Test Member 2] Testing UC07: Modify Reservation & BR-46 rules...');
  const fakeBookingId = id();
  const mockBooking = {
    _id: fakeBookingId,
    customerId: id(),
    hotelId,
    status: 'confirmed',
    // Còn hơn 48 giờ trước nhận phòng.
    checkInDate: new Date('2026-11-05T14:00:00Z'),
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

  // Booking không tồn tại trả lỗi 404.
  await assert.rejects(
    async () => {
      await bookingService.modifyReservation(id(), { checkInDate: '2026-11-06' });
    },
    /Booking not found/
  );

  // Từ chối khoảng ngày có ngày trả không sau ngày nhận.
  await assert.rejects(
    async () => {
      await bookingService.modifyReservation(fakeBookingId, {
        checkInDate: '2026-11-10',
        checkOutDate: '2026-11-08'
      });
    },
    /checkOutDate must be after checkInDate/
  );

  // Không cho sửa booking đã hủy.
  const cancelledBooking = { ...mockBooking, status: 'cancelled' };
  Booking.findById = async () => cancelledBooking;
  await assert.rejects(
    async () => {
      await bookingService.modifyReservation(fakeBookingId, { checkInDate: '2026-11-06' });
    },
    /Cannot modify booking with status "cancelled"/
  );

  // Chặn đổi ngày khi còn dưới 48 giờ và không được hoàn cọc.
  const nearCheckinBooking = {
    ...mockBooking,
    status: 'confirmed',
    // Giả lập còn 24 giờ trước nhận phòng.
    checkInDate: new Date(Date.now() + 24 * 3600000),
    // Dùng ngày tương đối để test không lỗi khi lịch thực tế thay đổi.
    checkOutDate: new Date(Date.now() + 5 * 86400000)
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

  // Kiểm tra hủy booking và giải phóng phòng.
  console.log('[Test Member 2] Testing UC08: Cancel Reservation & Cancellation Requested...');

  // Booking chờ cọc được bỏ thanh toán và chuyển sang hết hạn.
  const pendingBooking = {
    ...mockBooking,
    status: 'pending',
    events: [],
    save: async function() { return this; }
  };
  Booking.findById = async () => pendingBooking;
  const abandonResult = await bookingService.abandonPayment(fakeBookingId);
  assert.equal(abandonResult.status, 'expired', 'Abandoned pending booking must become expired');

  // Booking đã xác nhận, còn hơn 48 giờ chuyển sang chờ hủy khi có tài khoản nhận hoàn tiền.
  const confirmedBooking = {
    ...mockBooking,
    status: 'confirmed',
    // Còn hơn 48 giờ trước nhận phòng.
    checkInDate: new Date('2026-11-15T14:00:00Z'),
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

  // Rút yêu cầu hủy khôi phục trạng thái đã xác nhận.
  const cancellationRequestedBooking = {
    ...cancelReqResult,
    status: 'cancellation_requested',
    events: [],
    save: async function() { return this; }
  };
  Booking.findById = async () => cancellationRequestedBooking;
  const withdrawResult = await bookingService.withdrawCancellation(fakeBookingId);
  assert.equal(withdrawResult.status, 'confirmed', 'Withdrawn cancellation request must return status to confirmed');

  // Kiểm tra tính tỷ lệ lấp đầy.
  console.log('[Test Member 2] Testing UC37: Occupancy Report math & exclusions...');
  const origRoomFind2 = Room.find;
  const origBookingFind2 = Booking.find;

  // Mười phòng gồm tám phòng trống và hai phòng bảo trì.
  const mockPhysicalRooms = Array.from({ length: 10 }, (_, i) => ({
    _id: id(),
    roomNumber: `Room-${i + 1}`,
    status: i < 2 ? 'maintenance' : 'available',
    roomTypeId: { name: 'Deluxe' }
  }));

  Room.find = () => ({
    populate: async () => mockPhysicalRooms
  });

  // Bốn booking có lịch nằm trong kỳ báo cáo.
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
  // Ba ngày nhân hai phòng bảo trì bằng sáu đêm phòng bảo trì.
  assert.equal(occupancyRep.totals.totalMaintenanceNights, 6, '3 days * 2 maintenance = 6');
  // Ba ngày nhân tám phòng bán được bằng 24 đêm phòng.
  assert.equal(occupancyRep.totals.totalSellableNights, 24, '3 days * 8 sellable = 24');
  // Ba ngày nhân bốn phòng có khách bằng 12 đêm phòng.
  assert.equal(occupancyRep.totals.totalOccupiedNights, 12, '3 days * 4 occupied = 12');
  // Tỷ lệ lấp đầy là 12 trên 24, tương đương 50%.
  assert.equal(occupancyRep.totals.averageOccupancyRate, 50, 'Occupancy rate should equal 50%');

  // Khôi phục tất cả hàm đã giả lập.
  Booking.findById = origBookingFindById;
  Room.find = origRoomFind2;
  Booking.find = origBookingFind2;

  console.log('✅ [Test Member 2] All Member 2 models, schema validations, pricing, T06 availability, UC07 core, UC12 modify, UC13 cancel, and UC37 occupancy report tests passed successfully!');
}

testMember2Logic().catch(err => {
  console.error('❌ [Test Member 2 Failed]:', err);
  process.exit(1);
});

