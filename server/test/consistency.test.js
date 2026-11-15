const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const request = require('supertest');
const { MongoMemoryReplSet } = require('mongodb-memory-server');
const { createApp } = require('../src/app');
const { seedRoles } = require('../src/services/roles');
const { hashPassword } = require('../src/utils/password');
const { hotelDay } = require('../src/services/roomInventory');
const { paidAmount, settle } = require('../src/services/payments');
const { hotelTransaction, afterCommit } = require('../src/services/hotelOperations');
const { initializeRoomHistory, setRoomStatus } = require('../src/services/roomHistory');
const { setResendClient } = require('../src/services/resendService');
const User = require('../src/models/User');
const Role = require('../src/models/Role');
const Room = require('../src/models/Room');
const RoomType = require('../src/models/RoomType');
const Booking = require('../src/models/Booking');
const Payment = require('../src/models/Payment');
const Refund = require('../src/models/Refund');
const Coupon = require('../src/models/Coupon');
const CouponUsage = require('../src/models/CouponUsage');
const Policy = require('../src/models/HotelPolicy');
const StayRequest = require('../src/models/CheckInOutRequest');
const AuditLog = require('../src/models/AuditLog');
for (const key of ['EMAILJS_SERVICE_ID', 'EMAILJS_TEMPLATE_ID', 'EMAILJS_PUBLIC_KEY', 'EMAILJS_PRIVATE_KEY', 'SMTP_URL', 'RESEND_API_KEY']) process.env[key] = '';
process.env.PAYMENT_PROVIDER = 'sandbox';
const origin = 'http://localhost:5173';
const password = 'StrongPass123!';
const day = (offset = 0) => hotelDay(new Date(Date.now() + offset * 864e5));
const send = (agent, method, url, body = {}) => agent[method](url).set('Origin', origin).send(body);
let db, app, store, guest, other, staff, manager, customer, employee, type;
async function login(email) {
  const agent = request.agent(app);
  await send(agent, 'post', '/api/auth/login', { email, password }).expect(200);
  return agent;
}
async function booking(extra = {}) {
  return Booking.create({ createdBy: customer._id, customerId: customer._id, checkInDate: day(), checkOutDate: day(1),
    status: 'confirmed', rooms: [{ roomTypeId: type._id, guestCount: 1, priceAtBooking: 100 }], roomAmount: 100, totalAmount: 100, ...extra });
}
before(async () => {
  db = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } });
  await mongoose.connect(db.getUri());
  await seedRoles();
  await Promise.all(Object.values(mongoose.models).map(model => model.init()));
  const passwordHash = await hashPassword(password);
  for (const [username, key] of [['guest', 'customer'], ['other', 'customer'], ['staff', 'receptionist'], ['manager', 'manager']]) {
    const role = await Role.findOne({ key });
    await User.create({ username, email: `${username}@example.com`, roleId: role._id, passwordHash, isVerified: true, phone: '0912345678', customerProfile: { fullName: 'Test Guest' } });
  }
  customer = await User.findOne({ username: 'guest' }); employee = await User.findOne({ username: 'staff' });
  ({ app, store } = createApp({ mongoUri: db.getUri(), jwtSecret: 'consistency-tests-secret-at-least-32-characters', clientOrigin: origin }));
  guest = await login('guest@example.com'); other = await login('other@example.com'); staff = await login('staff@example.com'); manager = await login('manager@example.com');
  type = await RoomType.create({ name: 'Consistency', basePrice: 100, maxOccupancy: 12 });
  await Policy.create({ kind: 'deposit', name: 'Deposit', deposit: { type: 'percentage', value: 20 }, isActive: true, effectiveFrom: new Date(0) });
  await Policy.create({ kind: 'cancellation', name: 'Stay', cancellationTiers: [{ minHoursBeforeCheckIn: 48, refundPercent: 100 }, { minHoursBeforeCheckIn: 0, refundPercent: 0 }], checkInTime: '15:00', checkOutTime: '11:00', lateCheckOutFee: 25, isActive: true, effectiveFrom: new Date(0) });
});
after(async () => { setResendClient(null); await store?.close(); await mongoose.disconnect(); await db?.stop(); });

test('both review APIs reject walk-in and other owners, and share duplicate protection', async () => {
  const walkIn = await booking({ customerId: undefined, status: 'checked_out' });
  for (const [url, body] of [[`/api/bookings/${walkIn.id}/reviews`, { rating: 5 }], ['/api/reviews', { bookingId: walkIn.id, rating: 5 }]])
    await send(guest, 'post', url, body).expect(404);
  const own = await booking({ status: 'checked_out' });
  await send(other, 'post', '/api/reviews', { bookingId: own.id, rating: 5 }).expect(404);
  await send(guest, 'post', '/api/reviews', { bookingId: own.id, rating: 5 }).expect(201);
  await send(guest, 'post', `/api/bookings/${own.id}/reviews`, { rating: 5 }).expect(409);
});

test('check-in revalidates assigned room conflicts and rolls back when booking save fails', async () => {
  const room = await Room.create({ roomNumber: 'TX-1', roomTypeId: type._id });
  const current = await booking();
  const conflict = await booking({ rooms: [{ roomId: room._id, roomTypeId: type._id, guestCount: 1, priceAtBooking: 100 }] });
  const url = `/api/front-desk/bookings/${current.id}/check-in`;
  const body = { roomId: room.id, guestCount: 1, idDocumentNo: 'TEST12345' };
  await send(staff, 'post', url, body).expect(409);
  await Booking.deleteOne({ _id: conflict._id });
  const update = Booking.collection.updateOne;
  Booking.collection.updateOne = function (filter, ...args) {
    if (String(filter._id) === current.id) throw new Error('Injected booking persistence failure');
    return update.call(this, filter, ...args);
  };
  try { await send(staff, 'post', url, body).expect(500); } finally { Booking.collection.updateOne = update; }
  assert.equal((await Room.findById(room._id)).status, 'available');
  assert.equal((await Booking.findById(current._id)).status, 'confirmed');
  await send(staff, 'post', url, body).expect(200);
  const saved = await Booking.findById(current._id);
  assert.equal(saved.roomStays.length, 1);
  assert.ok(saved.actualCheckInAt);
});

test('concurrent payments cannot overcollect; retries with one key create one payment', async () => {
  const b = await booking(); const url = `/api/frontdesk/bookings/${b.id}/payments`;
  const results = await Promise.all([send(staff, 'post', url, { method: 'cash', amount: 80 }), send(staff, 'post', url, { method: 'cash', amount: 80 })]);
  assert.deepEqual(results.map(r => r.status).sort(), [201, 400]);
  assert.equal(await paidAmount(b._id), 80);
  const body = { method: 'cash', amount: 20, idempotencyKey: 'payment-retry-key-1234' };
  const retries = await Promise.all([send(staff, 'post', url, body), send(staff, 'post', url, body)]);
  assert.deepEqual(retries.map(r => r.status), [201, 201]);
  assert.equal(await Payment.countDocuments({ bookingId: b._id }), 2);
  await send(staff, 'post', url, { ...body, amount: 10 }).expect(409);
  assert.equal(await paidAmount(b._id), 100);
});

test('a late duplicate deposit goes to refund and never credits the booking balance', async () => {
  const b = await booking({ status: 'pending', holdExpiresAt: new Date(Date.now() + 600000), totalAmount: 500 });
  const one = await Payment.create({ bookingId: b._id, kind: 'deposit', method: 'bank_transfer', amount: 100, status: 'pending' });
  const two = await Payment.create({ bookingId: b._id, kind: 'deposit', method: 'bank_transfer', amount: 100, status: 'cancelled' });
  await Promise.all([settle(one, { status: 'success' }), settle(two, { status: 'success' })]);
  assert.equal(await paidAmount(b._id), 100);
  assert.equal(await Refund.countDocuments({ bookingId: b._id, status: 'requested' }), 1);
  const detail = await guest.get(`/api/bookings/${b.id}`).expect(200);
  assert.equal(detail.body.data.paidAmount, 100);
  const duplicate = await settle(one, { status: 'success' });
  assert.equal(duplicate.payment.status, 'success');
  await Booking.updateOne({ _id: b._id }, { status: 'checked_in' });
  const bill = (await send(staff, 'post', `/api/front-desk/bookings/${b.id}/check-out/start`).expect(200)).body.data;
  assert.equal(bill.paidAmount, 100);
  assert.equal(bill.payments.reduce((sum, p) => sum + p.amount, 0), 100);
});

test('payment read permission does not allow sandbox settlement; payment references reject spaces', async () => {
  const b = await booking({ status: 'pending', holdExpiresAt: new Date(Date.now() + 600000), depositRequired: 20 });
  const made = await send(guest, 'post', `/api/bookings/${b.id}/payments/deposit`, { method: 'bank_transfer' }).expect(201);
  const payment = made.body.data;
  await manager.get(`/api/payments/${payment.paymentId}`).expect(200);
  await send(manager, 'post', `/api/sandbox-gateway/orders/${payment.orderId}`, { result: 'success' }).expect(404);
  assert.equal((await Payment.findById(payment.paymentId)).status, 'pending');
  const desk = await booking();
  const url = `/api/frontdesk/bookings/${desk.id}/payments`;
  const body = { method: 'bank_transfer', amount: 20, transactionRef: 'REF123', idempotencyKey: 'reference-retry-key-1234' };
  await send(staff, 'post', url, { ...body, transactionRef: ' REF123' }).expect(400);
  await send(staff, 'post', url, body).expect(201);
  await send(staff, 'post', url, { ...body, transactionRef: 'REF123 ' }).expect(400);
  await send(staff, 'post', url, body).expect(201);
  assert.equal(await paidAmount(desk._id), 20);
});

test('coupon quota and booking creation are atomic across concurrent users and injected failure', async () => {
  for (let i = 0; i < 3; i++) await Room.create({ roomTypeId: type._id, roomNumber: `CP-${i}` });
  const coupon = await Coupon.create({ code: 'LASTONE', discountType: 'fixed', discountValue: 10, minimumSpend: 0, usageLimit: 1 });
  const body = { roomTypeId: type.id, checkInDate: day(10), checkOutDate: day(11), guestCount: 1, consent: true, couponCode: coupon.code };
  await send(guest, 'post', '/api/bookings', { ...body, couponCode: ' LASTONE' }).expect(400);
  const results = await Promise.all([send(guest, 'post', '/api/bookings', body), send(other, 'post', '/api/bookings', body)]);
  assert.deepEqual(results.map(r => r.status).sort(), [201, 400]);
  assert.equal(await Booking.countDocuments({ couponCode: coupon.code }), 1);
  assert.equal((await Coupon.findById(coupon._id)).usageCount, 1);
  const fail = await Coupon.create({ code: 'ROLLBACK', discountType: 'fixed', discountValue: 10, minimumSpend: 0, usageLimit: 3 });
  const insert = CouponUsage.collection.insertOne;
  CouponUsage.collection.insertOne = () => { throw new Error('Injected coupon usage failure'); };
  try { await send(guest, 'post', '/api/bookings', { ...body, couponCode: fail.code }).expect(500); } finally { CouponUsage.collection.insertOne = insert; }
  assert.equal(await Booking.countDocuments({ couponCode: fail.code }), 0);
  assert.equal((await Coupon.findById(fail._id)).usageCount, 0);
});

test('extra-night charge replaces an existing late fee once', async () => {
  const room = await Room.create({ roomNumber: 'LATE-1', roomTypeId: type._id, status: 'occupied' });
  const b = await booking({ status: 'checked_in', checkInDate: day(-2), checkOutDate: day(-1), totalAmount: 125, feeAmount: 25,
    feeLines: [{ type: 'late_check_out', amount: 25, postedAt: new Date() }], rooms: [{ roomTypeId: type._id, roomId: room._id, guestCount: 1, priceAtBooking: 100 }] });
  const url = `/api/front-desk/bookings/${b.id}/check-out/start`;
  await send(staff, 'post', url).expect(200);
  await send(staff, 'post', url).expect(200);
  const saved = await Booking.findById(b._id);
  assert.equal(saved.totalAmount, 200);
  assert.equal(saved.feeLines.length, 1);
  assert.equal(saved.feeLines[0].type, 'extra_night');
});

test('room history begins now for old rooms and changes only when saleability changes', async () => {
  const id = new mongoose.Types.ObjectId();
  await Room.collection.insertOne({ _id: id, roomNumber: 'OLD-1', roomTypeId: type._id, isActive: true, status: 'available', createdAt: new Date('2020-01-01') });
  const before = Date.now();
  await initializeRoomHistory(); await initializeRoomHistory();
  let room = await Room.findById(id);
  assert.equal(room.availabilityHistory.length, 1);
  assert.ok(+room.availabilityHistory[0].at >= before);
  await hotelTransaction(() => setRoomStatus(id, 'maintenance'));
  await hotelTransaction(() => setRoomStatus(id, 'maintenance'));
  room = await Room.findById(id);
  assert.deepEqual(room.availabilityHistory.map(h => h.available), [true, false]);
  await manager.get(`/api/reports/occupancy?from=${day(-1)}&to=${day()}&format=csv`).expect(200).expect('Content-Type', /text\/csv/);
});

test('capacity reduction cannot invalidate open bookings; stay requests reject past and wrong dates', async () => {
  const filtered = await staff.get(`/api/rooms/search?hotelId=${new mongoose.Types.ObjectId()}`).expect(200);
  assert.equal(filtered.body.data.length, 0);
  const b = await booking({ checkInDate: day(20), checkOutDate: day(21), rooms: [{ roomTypeId: type._id, guestCount: 11, priceAtBooking: 100 }] });
  await send(manager, 'patch', `/api/room-types/${type.id}`, { maxOccupancy: 10 }).expect(409);
  const url = `/api/bookings/${b.id}/requests`;
  const body = { type: 'check_in', numberOfGuests: 11, mainGuestName: 'Test Guest' };
  await send(guest, 'post', url, { ...body, requestedTime: `${day(-1)}T10:00:00+07:00` }).expect(400);
  await send(guest, 'post', url, { ...body, requestedTime: `${day(19)}T10:00:00+07:00` }).expect(400);
  await send(guest, 'post', url, { ...body, requestedTime: `${day(20)}T15:00:00+07:00` }).expect(201);
  assert.equal(await StayRequest.countDocuments({ bookingId: b._id }), 1);
});

test('pending email can be resent with cooldown while keeping the verified address', async () => {
  const sent = []; setResendClient({ emails: { send: async mail => { sent.push(mail); return { data: { id: 'test' } }; } } });
  await User.updateOne({ _id: customer._id }, { pendingEmail: 'new-address@example.com', emailVerification: { lastSentAt: new Date(Date.now() - 120000), sentAt: [] } });
  await send(request(app), 'post', '/api/auth/resend-verification', { email: 'new-address@example.com' }).expect(200);
  assert.equal(sent.length, 1);
  assert.ok(JSON.stringify(sent[0].to).includes('new-address@example.com'));
  assert.equal((await User.findById(customer._id)).email, 'guest@example.com');
  await send(request(app), 'post', '/api/auth/resend-verification', { email: 'new-address@example.com' }).expect(429);
  setResendClient(null);
});

test('removed independent permissions deny direct APIs without removing unrelated actions', async () => {
  const role = await Role.findById(employee.roleId); const saved = [...role.permissions];
  const b = await booking();
  await Role.updateOne({ _id: role._id }, { $pull: { permissions: { $in: ['rooms.assign', 'invoices.print', 'coupons.apply', 'payments.status.read', 'rooms.filter'] } } });
  try {
    await staff.get(`/api/front-desk/bookings/${b.id}/available-rooms`).expect(403);
    await staff.get('/api/frontdesk/invoices').expect(403);
    await staff.get('/api/frontdesk/payments').expect(403);
    await staff.get(`/api/rooms/search?checkIn=${day()}&checkOut=${day(1)}&guests=1`).expect(403);
    await send(staff, 'post', '/api/bookings/quote', { roomTypeId: type.id, checkInDate: day(1), checkOutDate: day(2), couponCode: 'LASTONE' }).expect(403);
    await send(staff, 'post', `/api/frontdesk/bookings/${b.id}/payments`, { method: 'cash', amount: 10 }).expect(201);
    const stay = await booking({ status: 'checked_in' });
    const bill = await send(staff, 'post', `/api/front-desk/bookings/${stay.id}/check-out/start`).expect(200);
    assert.equal(bill.body.data.paidAmount, undefined);
    assert.equal(bill.body.data.balance, undefined);
    assert.equal(bill.body.data.payments, undefined);
    await send(staff, 'post', `/api/frontdesk/bookings/${stay.id}/payments`, { method: 'cash' }).expect(201);
    const checkout = await send(staff, 'post', `/api/front-desk/bookings/${stay.id}/check-out`, { skipInspection: true }).expect(200);
    assert.equal(checkout.body.data.invoice, undefined);
  } finally { await Role.updateOne({ _id: role._id }, { permissions: saved }); }
});

test('unusable rooms and Other reports require issue permission independently of damage permission', async () => {
  const role = await Role.findById(employee.roleId); const saved = [...role.permissions];
  const room = await Room.create({ roomNumber: 'RIGHTS-ISSUE', roomTypeId: type._id });
  const item = await require('../src/models/CompensationItem').create({ name: 'Permission towel', price: 25 });
  const body = { roomId: room.id, title: 'Towel damaged', description: 'Found at inspection', chargeItemId: item.id };
  await send(staff, 'post', '/api/room-issues', body).expect(403);
  await Role.updateOne({ _id: role._id }, { permissions: [...saved.filter(p => p !== 'room_issues.report'), 'damages.report'] });
  try {
    await send(staff, 'post', '/api/room-issues', { ...body, unusable: false }).expect(201);
    await send(staff, 'post', '/api/room-issues', { ...body, unusable: true }).expect(403);
    await send(staff, 'post', '/api/room-issues', { roomId: room.id, title: 'Other issue', description: 'Shower leaking' }).expect(403);
    assert.equal((await Room.findById(room._id)).status, 'available');
  } finally { await Role.updateOne({ _id: role._id }, { permissions: saved }); }
});

test('nested transaction failure rolls back all writes and skips external effects', async () => {
  let sent = 0;
  await assert.rejects(hotelTransaction(async () => {
    await AuditLog.create({ action: 'rollback.test', targetType: 'test' });
    await hotelTransaction(async () => { await afterCommit(() => { sent++; }); throw new Error('Rollback test'); });
  }), /Rollback test/);
  assert.equal(await AuditLog.countDocuments({ action: 'rollback.test' }), 0);
  assert.equal(sent, 0);
});
