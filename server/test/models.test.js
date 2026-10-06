const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const mongoose = require('mongoose');
const modelsDir = path.join(__dirname, '../src/models');
const models = Object.fromEntries(fs.readdirSync(modelsDir)
  .filter(file => file.endsWith('.js'))
  .map(file => {
    const model = require(path.join(modelsDir, file));
    return [model.modelName, model];
  }));

async function validateModels() {
  assert.equal(Object.keys(models).length, 17);
  for (const [name, model] of Object.entries(models)) {
    assert.equal(model.modelName, name);
  }

  const id = () => new mongoose.Types.ObjectId();
  const baseBooking = {
    customerId: id(), hotelId: id(), createdBy: id(),
    checkInDate: new Date('2027-01-10'), checkOutDate: new Date('2027-01-12'),
    rooms: [{ roomTypeId: id(), priceAtBooking: 100000, guestCount: 2 }],
    roomAmount: 200000, totalAmount: 200000
  };
  assert.equal(new models.Booking(baseBooking).validateSync(), undefined);
  assert.match(new models.Booking({ ...baseBooking, checkOutDate: new Date('2027-01-09') }).validateSync().message, /checkOutDate/);
  assert.match(new models.Booking({ ...baseBooking, rooms: [] }).validateSync().message, /rooms/);

  const payment = new models.Payment({ bookingId: id(), kind: 'deposit', amount: 50000, method: 'e_wallet' });
  assert.equal(payment.validateSync(), undefined);
  assert.match(new models.Payment({ bookingId: id(), kind: 'other', amount: 0, method: 'cash' }).validateSync().message, /kind/);

  const policy = new models.HotelPolicy({ hotelId: id(), kind: 'deposit', name: 'Standard', effectiveFrom: new Date('2027-01-01'), deposit: { type: 'percentage', value: 30 } });
  await policy.validate();
  await assert.rejects(new models.HotelPolicy({ hotelId: id(), kind: 'deposit', name: 'Bad', effectiveFrom: new Date('2027-01-01'), deposit: { type: 'percentage', value: 120 } }).validate(), /Percentage/);

  assert.equal(new models.RoomIssue({ roomId: id(), reportedBy: id(), title: 'Air conditioner' }).validateSync(), undefined);
  const eventBooking = new models.Booking({ ...baseBooking, events: [{ actorId: id(), type: 'room_changed', oldValue: { room: '101' }, newValue: { room: '102' } }] });
  assert.equal(eventBooking.validateSync(), undefined);
  console.log('Validated 17 Mongoose models and key booking/payment/policy rules');
}

validateModels().catch(error => { console.error(error); process.exitCode = 1; });
