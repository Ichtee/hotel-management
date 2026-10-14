const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const RoomType = require('../src/models/RoomType');
const Room = require('../src/models/Room');
const CleaningTask = require('../src/models/CleaningTask');
const RoomIssue = require('../src/models/RoomIssue');
const roomTypeService = require('../src/services/roomTypeService');

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

  console.log('✅ [Test Member 2] All Member 2 models, schema validations, and pricing calculations passed successfully!');
}

testMember2Logic().catch(err => {
  console.error('❌ [Test Member 2 Failed]:', err);
  process.exit(1);
});
