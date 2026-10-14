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
  assert.equal(Object.keys(models).length, 18);
  assert.equal(models.Hotel, undefined);
  for (const [name, model] of Object.entries(models)) {
    assert.equal(model.modelName, name);
  }

  const id = () => new mongoose.Types.ObjectId();
  const baseBooking = {
    customerId: id(), createdBy: id(),
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

  const policy = new models.HotelPolicy({ kind: 'deposit', name: 'Standard', effectiveFrom: new Date('2027-01-01'), deposit: { type: 'percentage', value: 30 } });
  await policy.validate();
  await assert.rejects(new models.HotelPolicy({ kind: 'deposit', name: 'Bad', effectiveFrom: new Date('2027-01-01'), deposit: { type: 'percentage', value: 120 } }).validate(), /Percentage/);

  assert.equal(new models.RoomIssue({ roomId: id(), reportedBy: id(), title: 'Air conditioner' }).validateSync(), undefined);
  const eventBooking = new models.Booking({ ...baseBooking, events: [{ actorId: id(), type: 'room_changed', oldValue: { room: '101' }, newValue: { room: '102' } }] });
  assert.equal(eventBooking.validateSync(), undefined);
  assert.equal(new models.Booking({ ...baseBooking, status: 'expired', holdExpiresAt: new Date() }).validateSync(), undefined);
  await assert.rejects(new models.HotelPolicy({ kind: 'deposit', name: 'Fixed', effectiveFrom: new Date('2027-01-01'), deposit: { type: 'fixed_amount', value: 5 } }).validate());
  await assert.rejects(new models.HotelPolicy({ kind: 'deposit', name: 'Zero', effectiveFrom: new Date('2027-01-01'), deposit: { type: 'percentage', value: 0 } }).validate(), /greater than 0/);
  const rate = (a, b) => ({ startDate: new Date(a), endDate: new Date(b), price: 100 });
  const roomType = pricing => new models.RoomType({ name: 'Std', basePrice: 1, maxOccupancy: 2, seasonalPricing: pricing });
  assert.equal(roomType([rate('2027-01-01', '2027-01-01'), rate('2027-01-02', '2027-01-05')]).validateSync(), undefined);
  assert.match(roomType([rate('2027-01-01', '2027-01-05'), rate('2027-01-05', '2027-01-09')]).validateSync().message, /overlap/);
  assert.match(new models.RoomType({ name: 'Std', basePrice: 1 }).validateSync().message, /maxOccupancy/);
  assert.equal(new models.HotelInfo({ name: 'The Linden' }).key, 'main');
  assert.match(new models.HotelInfo({}).validateSync().message, /name/);
  assert.match(new models.Coupon({ discountValue: 10, usageLimit: 1 }).validateSync().message, /code/);

  const fields = { RoomType: 'bedType roomSizeSqm seasonalPricing', Room: 'viewType description images isActive', Service: 'category description', Booking: 'bookingReference holdExpiresAt', Coupon: 'code description minimumSpend', Refund: 'requestedBy', Invoice: 'invoiceNumber subtotal status billingAddress', Review: 'title hotelResponse', Notification: 'title' };
  for (const [name, list] of Object.entries(fields)) for (const f of list.split(' ')) assert.ok(models[name].schema.path(f), `${name}.${f} missing`);
  console.log('Validated 18 Mongoose models and key booking/payment/policy rules');
}

validateModels().catch(error => { console.error(error); process.exitCode = 1; });
