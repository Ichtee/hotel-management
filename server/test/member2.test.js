const { test } = require('node:test');
const assert = require('node:assert/strict');
const { priceAt, priceNights, sumNights } = require('../src/services/pricing');
const { buildOccupancy } = require('../src/services/occupancy');

test('seasonal prices include both endpoints and preserve previously booked nights', () => {
  const type = { _id: 'type', basePrice: 100, seasonalPricing: [{ startDate: new Date('2030-12-24'), endDate: new Date('2030-12-26'), price: 200 }] };
  assert.equal(priceAt(type, '2030-12-26'), 200);
  assert.equal(priceAt(type, '2030-12-27'), 100);
  const nights = priceNights(type, '2030-12-24', '2030-12-28', [{ date: new Date('2030-12-24'), roomTypeId: 'type', price: 50 }]);
  assert.equal(sumNights(nights), 550);
});

test('occupancy uses actual local dates, final room, same-day stays and historical availability', () => {
  const rooms = ['A', 'B'].map(_id => ({ _id, isActive: true, status: 'maintenance', createdAt: new Date('2030-01-01'), availabilityHistory: [{ at: new Date('2030-01-01'), available: true }, { at: new Date('2030-02-03T00:00:00+07:00'), available: false }] }));
  const booking = { status: 'checked_out', actualCheckInAt: new Date('2030-02-01T14:00:00+07:00'), actualCheckOutAt: new Date('2030-02-03T12:00:00+07:00'), roomStays: [{roomId:'A',from:new Date('2030-02-01T14:00:00+07:00')},{roomId:'B',from:new Date('2030-02-01T20:00:00+07:00')}] };
  const result=buildOccupancy(rooms,[booking],'2030-02-01','2030-02-03');
  assert.deepEqual(result.series.map(r=>r.occupiedRoomNights),[1,1,0]);
  assert.deepEqual(result.series.map(r=>r.availableRoomNights),[2,2,0]);
  assert.equal(result.totals.rate,50);
  const sameDay={...booking,actualCheckOutAt:new Date('2030-02-01T22:00:00+07:00')};
  assert.equal(buildOccupancy(rooms,[sameDay],'2030-02-01','2030-02-01').totals.occupiedRoomNights,1);
  // Hai lượt lưu trú cùng phòng cuối không được đếm sang phòng cũ khi đổi trong ngày.
  const alsoB = {...sameDay, roomStays: [{roomId:'B',from:new Date('2030-02-01T21:00:00+07:00')}]};
  assert.equal(buildOccupancy(rooms,[sameDay,alsoB],'2030-02-01','2030-02-01').totals.occupiedRoomNights,1);
});

test('occupancy discloses missing history and never substitutes planned stay dates', () => {
  const result = buildOccupancy([{_id:'A',isActive:true,status:'available'}],[{status:'checked_out',checkInDate:new Date('2030-02-01'),checkOutDate:new Date('2030-02-03'),rooms:[{roomId:'A'}]}],'2030-02-01','2030-02-03');
  assert.equal(result.totals.occupiedRoomNights,0);
  assert.equal(result.warnings.length,2);
});
