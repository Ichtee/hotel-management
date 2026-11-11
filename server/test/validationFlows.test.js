// Kiểm tra đầu vào của booking, giá, phòng, nhân viên, hồ sơ, mật khẩu và đánh giá.
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const { MongoMemoryReplSet } = require("mongodb-memory-server");
const request = require("supertest");
const { createApp } = require("../src/app");
const { seedRoles } = require("../src/services/roles");
const { hashPassword } = require("../src/utils/password");
const User = require("../src/models/User");
const Role = require("../src/models/Role");

process.env.PAYMENT_PROVIDER = "sandbox";
const origin = "http://localhost:5173";
const password = "StrongPass123!";
let db, app, store, manager, customer, reception;
const send = (agent, method, url, body = {}) => agent[method](url).set("Origin", origin).send(body);
async function login(email) {
  const agent = request.agent(app);
  await send(agent, "post", "/api/auth/login", { email, password }).expect(200);
  return agent;
}
async function check(label, cases, call) {
  const wrong = [];
  for (const [name, input, want] of cases) {
    const res = await call(input);
    if (res.status !== want) wrong.push(`${name}: expected ${want}, got ${res.status} ${JSON.stringify(res.body.message || res.body.error?.message || "").slice(0, 90)}`);
  }
  assert.deepEqual(wrong, [], `${label}\n${wrong.join("\n")}`);
}

before(async () => {
  db = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: "wiredTiger" } });
  await mongoose.connect(db.getUri());
  const { bootstrap } = require("../scripts/setup");
  await bootstrap({ ADMIN_USERNAME: "admin", ADMIN_EMAIL: "admin@example.com", ADMIN_NAME: "Administrator", ADMIN_PASSWORD: password });
  await seedRoles();
  await Promise.all(Object.values(mongoose.models).map((model) => model.init()));
  const passwordHash = await hashPassword(password);
  for (const [username, role] of [["manager", "manager"], ["customer", "customer"], ["reception", "receptionist"]]) {
    await User.create({ username, email: `${username}@example.com`, passwordHash, roleId: (await Role.findOne({ key: role }))._id, phone: "0912345678", customerProfile: { fullName: username }, isVerified: true });
  }
  ({ app, store } = createApp({ mongoUri: db.getUri(), jwtSecret: "integration-test-secret-more-than-32-characters", clientOrigin: origin }));
  manager = await login("manager@example.com");
  customer = await login("customer@example.com");
  reception = await login("reception@example.com");
});
after(async () => {
  await store?.close();
  await mongoose.disconnect();
  await db?.stop();
});

const day = (n) => new Date(Date.now() + n * 864e5 + 7 * 36e5).toISOString().slice(0, 10);
let bookable;
async function bookableType() {
  if (bookable) return bookable;
  await send(manager, "post", "/api/policies/deposit", { percentage: 30 }).expect(201);
  const rt = (await send(manager, "post", "/api/room-types", { name: "Bookable", description: "d", bedType: "King", roomSizeSqm: 30, maxOccupancy: 2, basePrice: 1000000, amenities: [] }).expect(201)).body.data;
  for (const roomNumber of ["901", "902", "903", "904", "905", "906", "907", "908"]) await send(manager, "post", "/api/rooms", { roomNumber, roomTypeId: rt._id, floor: 9 }).expect(201);
  return (bookable = rt);
}

test("room: BR-03 number required and unique, needs an active room type", async () => {
  const rt = await bookableType();
  const inactive = (await send(manager, "post", "/api/room-types", { name: "Closed", description: "d", bedType: "King", roomSizeSqm: 30, maxOccupancy: 2, basePrice: 500000, amenities: [], isActive: false }).expect(201)).body.data;
  let n = 0;
  const room = (o) => ({ roomNumber: `R${++n}`, roomTypeId: rt._id, floor: 1, ...o });
  await check("room", [
    ["valid", room({}), 201],
    ["number missing", room({ roomNumber: undefined }), 400],
    ["number blank", room({ roomNumber: "  " }), 400],
    ["duplicate number", { ...room({}), roomNumber: "901" }, 409],
    ["room type missing", room({ roomTypeId: undefined }), 400],
    ["room type id malformed", room({ roomTypeId: "abc" }), 400],
    ["room type inactive", room({ roomTypeId: inactive._id }), 400],
    ["floor not a number", room({ floor: "two" }), 400],
    ["floor decimal", room({ floor: 1.5 }), 400],
  ], (b) => send(manager, "post", "/api/rooms", b));
});

test("pricing rates: BR-06 dates and price, BR-07 no overlap, CR-20 whole VND", async () => {
  const rt = await bookableType();
  const rate = (o) => ({ description: "Peak", startDate: "2031-01-01", endDate: "2031-01-10", price: 1500000, ...o });
  await check("pricing", [
    ["valid", { seasonalPricing: [rate({})] }, 200],
    ["end before start", { seasonalPricing: [rate({ endDate: "2030-12-31" })] }, 400],
    ["same day is allowed", { seasonalPricing: [rate({ endDate: "2031-01-01" })] }, 200],
    ["price 0", { seasonalPricing: [rate({ price: 0 })] }, 400],
    ["price negative", { seasonalPricing: [rate({ price: -1 })] }, 400],
    ["price string", { seasonalPricing: [rate({ price: "1500000" })] }, 400],
    ["price with decimals", { seasonalPricing: [rate({ price: 1500000.5 })] }, 400],
    ["invalid date 2031-02-30", { seasonalPricing: [rate({ startDate: "2031-02-30" })] }, 400],
    ["date not a date", { seasonalPricing: [rate({ startDate: "tomorrow" })] }, 400],
    ["overlapping rates", { seasonalPricing: [rate({}), rate({ startDate: "2031-01-05", endDate: "2031-01-15" })] }, 409],
    ["rates sharing a day overlap", { seasonalPricing: [rate({}), rate({ startDate: "2031-01-10", endDate: "2031-01-15" })] }, 409],
    ["adjacent rates are fine", { seasonalPricing: [rate({}), rate({ startDate: "2031-01-11", endDate: "2031-01-15" })] }, 200],
    ["not a list", { seasonalPricing: "x" }, 400],
    ["base price 0", { basePrice: 0 }, 400],
    ["base price negative", { basePrice: -5 }, 400],
  ], (b) => send(manager, "put", `/api/room-types/${rt._id}/pricing`, b));
});

test("online booking: BR-12 dates and guests, CR-21 consent, CR-04 contact data", async () => {
  const rt = await bookableType();
  const bk = (o) => ({ roomTypeId: rt._id, checkInDate: day(20), checkOutDate: day(22), guestCount: 2, consent: true, captchaToken: "valid_test_token", ...o });
  await check("booking", [
    ["check-out equals check-in", bk({ checkOutDate: day(20) }), 400],
    ["check-out before check-in", bk({ checkOutDate: day(19) }), 400],
    ["check-in in the past", bk({ checkInDate: day(-3), checkOutDate: day(-1) }), 400],
    ["check-in yesterday", bk({ checkInDate: day(-1), checkOutDate: day(1) }), 400],
    ["invalid date 2030-02-30", bk({ checkInDate: "2030-02-30" }), 400],
    ["date in dd/MM/yyyy", bk({ checkInDate: "20/12/2030" }), 400],
    ["dates missing", bk({ checkInDate: undefined, checkOutDate: undefined }), 400],
    ["guests 0", bk({ guestCount: 0 }), 400],
    ["guests negative", bk({ guestCount: -1 }), 400],
    ["guests decimal", bk({ guestCount: 1.5 }), 400],
    ["guests string", bk({ guestCount: "2" }), 400],
    ["guests above room capacity (2)", bk({ guestCount: 3 }), 400],
    ["consent missing (MSG-04)", bk({ consent: undefined }), 400],
    ["captcha empty (MSG-80)", bk({ captchaToken: "" }), 400],
    ["guest name 1 char", bk({ fullName: "A" }), 400],
    ["guest phone invalid", bk({ phone: "123" }), 400],
    ["guest email invalid", bk({ email: "nope" }), 400],
    ["room type malformed id", bk({ roomTypeId: "abc" }), 400],
    ["unknown room type", bk({ roomTypeId: "64b000000000000000000000" }), 404],
    ["payment option pay-at-hotel", bk({ paymentOption: "pay_at_hotel" }), 400],
    ["unknown coupon", bk({ couponCode: "NOPE123" }), 400],
    ["unknown field", bk({ hack: 1 }), 400],
    ["valid booking", bk({}), 201],
  ], (b) => send(customer, "post", "/api/bookings", b));
});

test("coupons on a booking: fixed amount, percentage, minimum spend, usage limit and period (BR-09)", async () => {
  const rt = await bookableType();
  const mk = (o) => send(manager, "post", "/api/promotions", { code: "X", discountType: "percentage", discountValue: 10, usageLimit: 5, minimumSpend: 0, startDate: day(-1), endDate: day(400), ...o }).expect(201);
  await mk({ code: "FIXED300", discountType: "fixed", discountValue: 300000 });
  await mk({ code: "FIXEDHUGE", discountType: "fixed", discountValue: 99999999 });
  await mk({ code: "PCT10", discountValue: 10 });
  await mk({ code: "MINSPEND", minimumSpend: 5000000 });
  await mk({ code: "FUTURE", startDate: day(100), endDate: day(200) });
  await mk({ code: "EXPIRED", startDate: day(-30), endDate: day(-2) });
  await mk({ code: "OFF", isActive: false });
  const out = {};
  let from = 40;
  for (const code of ["FIXED300", "FIXEDHUGE", "PCT10", "MINSPEND", "FUTURE", "EXPIRED", "OFF"]) {
    // Mỗi khách được có tối đa ba booking chưa thanh toán.
    await require("../src/models/Booking").updateMany({ status: "pending" }, { status: "expired" });
    const r = await send(customer, "post", "/api/bookings", { roomTypeId: rt._id, checkInDate: day(from), checkOutDate: day(from + 2), guestCount: 2, couponCode: code, consent: true, captchaToken: "valid_test_token" });
    out[code] = [r.status, r.body.data?.discountAmount ?? r.body.message];
    from += 5;
  }
  assert.deepEqual(out.FIXED300, [201, 300000], "a fixed coupon takes exactly its amount off");
  assert.deepEqual(out.FIXEDHUGE, [201, 2000000], "a fixed coupon never exceeds the room charge (2 nights x 1,000,000)");
  assert.deepEqual(out.PCT10, [201, 200000]);
  for (const code of ["MINSPEND", "FUTURE", "EXPIRED", "OFF"]) assert.equal(out[code][0], 400, `${code} must be rejected, got ${JSON.stringify(out[code])}`);
});

test("staff account: BR-24 name, phone and e-mail, CR-12 temporary password, BR-25 roles", async () => {
  let n = 0;
  const st = (o) => ({ fullName: "Le Thi B", email: `staff${++n}@example.com`, phone: "0912345678", role: "receptionist", password: "Temp1234", ...o });
  await check("staff", [
    ["valid receptionist", st({}), 201],
    ["valid housekeeping", st({ role: "housekeeping" }), 201],
    ["role admin is not allowed", st({ role: "admin" }), 400],
    ["role manager is not allowed", st({ role: "manager" }), 400],
    ["role customer is not allowed", st({ role: "customer" }), 400],
    ["name 1 char", st({ fullName: "L" }), 400],
    ["name 51 chars", st({ fullName: "a".repeat(51) }), 400],
    ["email invalid", st({ email: "x" }), 400],
    ["phone invalid", st({ phone: "12345" }), 400],
    ["phone missing", st({ phone: undefined }), 400],
    ["temporary password too weak", st({ password: "temp1234" }), 400],
    ["temporary password 7 chars", st({ password: "Temp123" }), 400],
    ["duplicate e-mail", st({ email: "staff1@example.com" }), 409],
  ], (b) => send(manager, "post", "/api/staff", b));
});

test("profile: BR-24 name and phone, CR-04", async () => {
  await check("profile", [
    ["valid name", { fullName: "Jamie Nguyen" }, 200],
    ["name 1 char", { fullName: "J" }, 400],
    ["name 51 chars", { fullName: "a".repeat(51) }, 400],
    ["name blank", { fullName: "   " }, 400],
    ["phone invalid", { phone: "12" }, 400],
    ["phone with letters", { phone: "09123abc78" }, 400],
    ["phone valid international", { phone: "+84912345678" }, 200],
    ["unknown field", { role: "admin" }, 400],
  ], (b) => send(customer, "patch", "/api/profile", b));
});

test("password reset and e-mail verification: wrong token, no account disclosure (BR-42)", async () => {
  await check("forgot", [
    ["unknown e-mail gets the same answer", { email: "ghost@example.com" }, 200],
    ["e-mail missing", {}, 400],
    ["e-mail malformed", { email: "nope" }, 400],
  ], (b) => send(request(app), "post", "/api/auth/forgot-password", b));
  await check("reset", [
    ["wrong token", { email: "customer@example.com", token: "f".repeat(64), newPassword: "Abcdefg1" }, 400],
    ["token missing", { email: "customer@example.com", newPassword: "Abcdefg1" }, 400],
    ["unknown e-mail", { email: "ghost@example.com", token: "f".repeat(64), newPassword: "Abcdefg1" }, 400],
  ], (b) => send(request(app), "post", "/api/auth/reset-password", b));
  await check("verify", [
    ["wrong token", { token: "f".repeat(64), email: "ghost@example.com" }, 400],
    ["token missing", {}, 400],
  ], (b) => send(request(app), "post", "/api/auth/verify-email", b));
});

test("review: BR-23 rating is an integer from 1 to 5, one review per completed stay", async () => {
  const Booking = require("../src/models/Booking");
  const done = await Booking.findOneAndUpdate({ status: { $in: ["pending", "confirmed"] } }, { status: "checked_out" }, { new: true });
  assert.ok(done, "a booking to review");
  const url = `/api/bookings/${done._id}/reviews`;
  await check("review", [
    ["rating 0", { rating: 0, title: "t", comment: "c" }, 400],
    ["rating 6", { rating: 6, title: "t", comment: "c" }, 400],
    ["rating 3.5", { rating: 3.5, title: "t", comment: "c" }, 400],
    ["rating string", { rating: "5", title: "t", comment: "c" }, 400],
    ["rating missing", { title: "t", comment: "c" }, 400],
    ["rating 1 is valid", { rating: 1, title: "t", comment: "c" }, 201],
    ["a second review of the same stay", { rating: 5, title: "t", comment: "c" }, 409],
  ], (b) => send(customer, "post", url, b));
  await send(customer, "post", "/api/bookings/64b000000000000000000000/reviews", { rating: 5, title: "t", comment: "c" }).expect(404);
});

test("walk-in booking: UC14 / BR-12 today only, name, phone, ID document, guests", async () => {
  const rt = await bookableType();
  const wi = (o) => ({ roomTypeId: rt._id, checkInDate: day(0), checkOutDate: day(1), guestCount: 2, fullName: "Tran Van C", phone: "0912345678", idDocumentNo: "079123456789", ...o });
  await check("walk-in", [
    ["check-in is not today (MSG-62)", wi({ checkInDate: day(3), checkOutDate: day(4) }), 409],
    ["check-in in the past", wi({ checkInDate: day(-1), checkOutDate: day(1) }), 400],
    ["check-out equals check-in", wi({ checkOutDate: day(0) }), 400],
    ["guests above capacity", wi({ guestCount: 3 }), 400],
    ["guests 0", wi({ guestCount: 0 }), 400],
    ["name 1 char", wi({ fullName: "T" }), 400],
    ["phone invalid", wi({ phone: "12345" }), 400],
    ["ID document missing", wi({ idDocumentNo: undefined }), 400],
    ["ID document 2 chars", wi({ idDocumentNo: "12" }), 400],
    ["e-mail invalid", wi({ email: "nope" }), 400],
    ["e-mail optional", wi({}), 201],
    ["unknown room type", wi({ roomTypeId: "64b000000000000000000000" }), 404],
  ], (b) => send(reception, "post", "/api/front-desk/bookings", b));
  await send(customer, "post", "/api/front-desk/bookings", wi({})).expect(403);
});

test("verification e-mail can be requested at most 3 times per hour (BR-42, MSG-81)", async () => {
  const user = await User.create({ username: "pending1", email: "pending1@example.com", passwordHash: await hashPassword(password), roleId: (await Role.findOne({ key: "customer" }))._id, phone: "0912345678", customerProfile: { fullName: "Pending One" }, isVerified: false });
  const statuses = [];
  for (let i = 0; i < 5; i++) {
    // Bỏ thời gian chờ ngắn trong test.
    await User.updateOne({ _id: user._id }, { $set: { "emailVerification.lastSentAt": new Date(Date.now() - 120000) } });
    statuses.push((await send(request(app), "post", "/api/auth/resend-verification", { email: "pending1@example.com" })).status);
  }
  assert.ok(statuses.slice(0, 3).every((c) => c === 200), `first three allowed: ${statuses}`);
  assert.ok(statuses.slice(3).every((c) => c === 429), `the fourth and fifth refused: ${statuses}`);
});
