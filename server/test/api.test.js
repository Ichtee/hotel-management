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
const roleId = async (key) => (await Role.findOne({ key }))._id;
const Coupon = require("../src/models/Coupon");
const CouponUsage = require("../src/models/CouponUsage");
const Booking = require("../src/models/Booking");
const Payment = require("../src/models/Payment");
const Refund = require("../src/models/Refund");
const { validateCoupon } = require("../src/services/promotions");
// scripts/setup loads server/.env; never let a local PAYMENT_PROVIDER=sepay switch the gateway under the tests.
process.env.PAYMENT_PROVIDER = "sandbox";
const origin = "http://localhost:5173";
const password = "StrongPass123!";
let db,
  app,
  store,
  admin,
  manager,
  customer,
  staff;
const send = (agent, method, url, body = {}) =>
  agent[method](url).set("Origin", origin).send(body);
async function login(email) {
  const agent = request.agent(app);
  await send(agent, "post", "/api/auth/login", { email, password }).expect(200);
  return agent;
}
before(async () => {
  db = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: "wiredTiger" } });
  await mongoose.connect(db.getUri());
  const { bootstrap } = require("../scripts/setup");
  await bootstrap({ ADMIN_USERNAME: "admin", ADMIN_EMAIL: "admin@example.com", ADMIN_NAME: "Administrator", ADMIN_PASSWORD: password });
  await seedRoles();
  await Promise.all([User.init(), Coupon.init(), CouponUsage.init()]);
  await Promise.all(Object.values(mongoose.models).map((model) => model.init()));
  const passwordHash = await hashPassword(password);
  for (const [username, role] of [
    ["manager", "manager"],
    ["customer", "customer"],
    ["staff", "receptionist"],
  ]) {
    await User.create({
      username,
      email: `${username}@example.com`,
      passwordHash,
      roleId: await roleId(role),
      phone: "0912345678",
      customerProfile: { fullName: username },
      isVerified: true,
    });
  }
  ({ app, store } = createApp({
    mongoUri: db.getUri(),
    jwtSecret: "integration-test-secret-more-than-32-characters",
    clientOrigin: origin,
  }));
  admin = await login("admin@example.com");
  manager = await login("manager@example.com");
  customer = await login("customer@example.com");
  staff = await login("staff@example.com");
});
after(async () => {
  await store?.close();
  await mongoose.disconnect();
  await db?.stop();
});

test("inactive roles do not prevent account and staff deactivation", async () => {
  const guest = await User.findOne({ username: "customer" });
  const employee = await User.findOne({ username: "staff" });
  await Role.updateMany(
    { key: { $in: ["customer", "receptionist"] } },
    { isActive: false },
  );
  try {
    await send(admin, "patch", `/api/users/${guest.id}`, {
      status: "suspended",
      role: "customer",
    }).expect(200);
    await send(manager, "delete", `/api/staff/${employee.id}`, { reason: "Staff is on leave." }).expect(200);
    assert.equal((await User.findById(guest.id)).status, "suspended");
    assert.equal((await User.findById(employee.id)).status, "suspended");
    await send(admin, "post", "/api/users", {
      username: "disabledrole",
      email: "disabled@example.com",
      fullName: "New Guest",
      password,
      role: "customer",
    }).expect(400);
  } finally {
    await Role.updateMany(
      { key: { $in: ["customer", "receptionist"] } },
      { isActive: true },
    );
    await User.updateMany(
      { _id: { $in: [guest._id, employee._id] } },
      { status: "active", authVersion: 0 },
    );
  }
});
test("nonhotel accounts reject employment fields without server errors", async () => {
  const guest = await User.findOne({ username: "customer" });
  await send(admin, "patch", `/api/users/${guest.id}`, {
    position: "Desk",
  }).expect(400);
  await send(admin, "post", "/api/users", {
    username: "badjob",
    email: "badjob@example.com",
    fullName: "New Guest",
    password,
    role: "customer",
    position: "Desk",
  }).expect(400);
});
test("bootstrap refuses to overwrite an existing administrator", async () => {
  const { bootstrap } = require("../scripts/setup");
  await assert.rejects(
    () =>
      bootstrap({
        ADMIN_USERNAME: "secondadmin",
        ADMIN_EMAIL: "second@example.com",
        ADMIN_NAME: "Second Admin",
        ADMIN_PASSWORD: password,
      }),
    /already exists/,
  );
  assert.equal(await User.countDocuments({ roleId: await roleId("admin") }), 1);
});
test("registration validates fields, hashes credentials, ignores no privileged input, rejects duplicates", async () => {
  await send(request(app), "post", "/api/auth/register", {
    consent: true,
    username: "newguest",
    email: "new@example.com",
    fullName: "New Guest",
    password,
    phone: "0912345678",
    role: "admin",
  }).expect(400);
  // Missing phone is rejected
  await send(request(app), "post", "/api/auth/register", {
    consent: true,
    username: "newguest",
    email: "new@example.com",
    fullName: "New Guest",
    password,
  }).expect(400);
  // Password and confirmPassword mismatch is rejected
  await send(request(app), "post", "/api/auth/register", {
    consent: true,
    username: "newguest",
    email: "new@example.com",
    fullName: "New Guest",
    password,
    confirmPassword: "WrongPassword123!",
    phone: "0912345678",
  }).expect(400);
  const result = await send(request(app), "post", "/api/auth/register", {
    consent: true,
    username: "newguest",
    email: "NEW@example.com",
    fullName: "New Guest",
    password,
    confirmPassword: password,
    phone: "0912345678",
  }).expect(201);
  assert.equal(result.body.data.role, "customer");
  assert.equal(result.body.data.passwordHash, undefined);
  const saved = await User.findOne({ username: "newguest" }).select(
    "+passwordHash",
  );
  assert.notEqual(saved.passwordHash, password);
  await send(request(app), "post", "/api/auth/register", {
    consent: true,
    username: "different",
    email: "new@example.com",
    fullName: "New Guest",
    password,
    phone: "0912345678",
  }).expect(409);
  await send(request(app), "post", "/api/auth/register", {
    consent: true,
    username: "bad",
    email: "bad",
    fullName: "X",
    password: "x",
  }).expect(400);
});
test("authentication rejects bad passwords, missing sessions and foreign origins; cookie is HttpOnly", async () => {
  await request(app).get("/api/profile").expect(401);
  await send(request(app), "post", "/api/auth/login", {
    email: "customer@example.com",
    password: "bad",
  }).expect(401);
  await request(app)
    .post("/api/auth/login")
    .set("Origin", "https://evil.example")
    .send({ email: "customer@example.com", password })
    .expect(403);
  const res = await send(request(app), "post", "/api/auth/login", {
    email: "customer@example.com",
    password,
  }).expect(200);
  assert.match(res.headers["set-cookie"][0], /HttpOnly/);
  assert.match(res.headers["set-cookie"][0], /SameSite=Lax/);
  const agent = await login("customer@example.com");
  await send(agent, "post", "/api/auth/logout").expect(200);
  await agent.get("/api/auth/me").expect(401);
  // SDS b.1: logout increases the tokenVersion, so every other session of the account ends too.
  await customer.get("/api/auth/me").expect(401);
  customer = await login("customer@example.com");
  // A forged, re-signed or "none" token is refused.
  const jwt = require("../src/utils/jwt");
  const token = /hotel\.token=([^;]+)/.exec(res.headers["set-cookie"][0])[1];
  const [h, , sig] = token.split(".");
  const forged = `${h}.${Buffer.from(JSON.stringify({ sub: "x", ver: 0, exp: 9999999999 })).toString("base64url")}.${sig}`;
  const none = `${Buffer.from('{"alg":"none","typ":"JWT"}').toString("base64url")}.${token.split(".")[1]}.`;
  for (const bad of [forged, none, jwt.sign({ sub: "x" }, "another-secret-of-more-than-32-characters", 60000), jwt.sign({ sub: "x" }, "s", -1000)])
    await request(app).get("/api/auth/me").set("Cookie", `hotel.token=${bad}`).expect(401);
  assert.equal(jwt.verify(jwt.sign({ sub: "u" }, "k", 60000), "k").sub, "u");
});
test("BR-42: 5 consecutive failed logins lock the account for 15 minutes and are audited", async () => {
  const AuditLog = require("../src/models/AuditLog");
  const user = await User.create({ username: "lockme", email: "lockme@example.com", passwordHash: await hashPassword(password), roleId: await roleId("customer"), isVerified: true });
  const attempt = (pw) => send(request(app), "post", "/api/auth/login", { email: "lockme@example.com", password: pw });
  for (let i = 0; i < 4; i++) await attempt("wrong").expect(401);
  const locked = await attempt("wrong").expect(423);
  assert.match(locked.body.error.message, /locked for 15 minutes/);
  await attempt(password).expect(423); // the right password is refused while locked
  assert.equal(await AuditLog.countDocuments({ targetId: user._id, action: "login_failed" }), 4);
  assert.equal(await AuditLog.countDocuments({ targetId: user._id, action: "account_locked" }), 1);
  await User.updateOne({ _id: user._id }, { $set: { lockedUntil: new Date(Date.now() - 1000) } });
  await attempt(password).expect(200);
  // a successful login resets the counter
  for (let i = 0; i < 4; i++) await attempt("wrong").expect(401);
  await attempt(password).expect(200);
});
test("SRS 4.2.4: sessions expire after 15 min idle for staff and 30 min for customers, renewed on activity", async () => {
  // The token cookie carries Expires: round the remaining lifetime to minutes.
  const maxAge = (res) => Math.round((Date.parse(/Expires=([^;]+)/.exec(res.headers["set-cookie"][0])[1]) - Date.now()) / 60000) * 60;
  const staffLogin = await send(request(app), "post", "/api/auth/login", { email: "staff@example.com", password }).expect(200);
  assert.equal(maxAge(staffLogin), 15 * 60);
  const customerLogin = await send(request(app), "post", "/api/auth/login", { email: "customer@example.com", password }).expect(200);
  assert.equal(maxAge(customerLogin), 30 * 60);
  const renewed = await staff.get("/api/auth/me").expect(200);
  assert.equal(maxAge(renewed), 15 * 60);
});
test("front-desk routes follow role permissions: customers cannot read guest data or run front-desk actions", async () => {
  await customer.get("/api/front-desk/customers").expect(403);
  await send(customer, "patch", `/api/front-desk/customers/${new mongoose.Types.ObjectId()}`, { phone: "0900000000" }).expect(403);
  await send(customer, "post", `/api/front-desk/bookings/${new mongoose.Types.ObjectId()}/check-in`).expect(403);
  await staff.get("/api/front-desk/customers").expect(200);
  // UC33: removing a permission from the Receptionist role takes it away from the role's users
  const role = await Role.findOne({ key: "receptionist" });
  await Role.updateOne({ _id: role._id }, { $pull: { permissions: "stays.check_in" } });
  try {
    await send(staff, "post", `/api/front-desk/bookings/${new mongoose.Types.ObjectId()}/check-in`).expect(403);
  } finally {
    await Role.updateOne({ _id: role._id }, { $set: { permissions: role.permissions } });
  }
});
test("profile updates only self and password change revokes other sessions", async () => {
  await User.updateOne({ email: "new@example.com" }, { isVerified: true }); // verify new@example.com
  const a = await login("new@example.com");
  const b = await login("new@example.com");
  await send(a, "patch", "/api/profile", {
    role: "admin",
  }).expect(400);
  await send(a, "patch", "/api/profile", {
    fullName: "Updated Guest",
    phone: "0987654321",
    address: "Hanoi",
    dateOfBirth: "2000-01-01",
  }).expect(200);
  assert.equal(
    (await a.get("/api/profile")).body.data.customerProfile.fullName,
    "Updated Guest",
  );
  await send(a, "put", "/api/profile/password", {
    currentPassword: "bad",
    newPassword: "ChangedPass123!",
  }).expect(400);
  await send(a, "put", "/api/profile/password", {
    currentPassword: password,
    newPassword: "ChangedPass123!",
  }).expect(200);
  await b.get("/api/auth/me").expect(401);
  await a.get("/api/auth/me").expect(200);
});
test("password whitespace is preserved at login and password change", async () => {
  const agent = request.agent(app);
  const spaced = "  SpacesMatter123!  ";
  await send(agent, "post", "/api/auth/register", {
    consent: true,
    username: "spaced",
    email: "spaced@example.com",
    fullName: "Spaced Password",
    password: spaced,
    phone: "0912345678",
  }).expect(201);
  await User.updateOne({ email: "spaced@example.com" }, { isVerified: true });
  await send(agent, "post", "/api/auth/login", {
    email: "spaced@example.com",
    password: spaced,
  }).expect(200);
  await send(agent, "put", "/api/profile/password", {
    currentPassword: spaced,
    newPassword: "AnotherPass123!",
  }).expect(200);
});
test("admin manages accounts, cannot demote admin; deactivation takes effect on existing sessions", async () => {
  await customer.get("/api/users").expect(403);
  await manager.get("/api/users").expect(403);
  const res = await send(admin, "post", "/api/users", {
    username: "managed",
    fullName: "Managed User",
    email: "managed@example.com",
    password,
    role: "customer",
    status: "active",
  }).expect(201);
  const agent = await login("managed@example.com");
  await send(admin, "patch", `/api/users/${res.body.data._id}`, {
    status: "suspended",
  }).expect(200);
  await agent.get("/api/auth/me").expect(401);
  const self = await User.findOne({ roleId: await roleId("admin") });
  await send(admin, "patch", `/api/users/${self.id}`, {
    role: "customer",
  }).expect(409);
  const listing = await admin.get("/api/users?q=managed&page=1").expect(200);
  assert.equal(listing.body.data.length, 1);
  assert.equal(listing.body.data[0].passwordHash, undefined);
  await admin.get("/api/users?page=-1").expect(400);
});
test("roles are fixed (SRS 2.4.3): there is no role editor; only UC33 changes staff permissions", async () => {
  await admin.get("/api/roles").expect(404);
  await send(admin, "post", "/api/roles", { key: "auditor", name: "Revenue auditor", scope: "hotel", permissions: ["revenue.read"] }).expect(404);
  const managerRole = await Role.findOne({ key: "manager" });
  await send(admin, "patch", `/api/roles/${managerRole.id}`, { permissions: [] }).expect(404);
  await send(admin, "delete", `/api/roles/${managerRole.id}`).expect(404);
  await manager.get("/api/reports/revenue?from=2026-01-01&to=2026-01-31").expect(200);
});
test("staff CRUD validates SRS contact data and blocks manager privilege escalation", async () => {
  await staff.get("/api/staff").expect(403);
  const payload = {
    username: "newstaff",
    fullName: "Hotel Staff",
    email: "newstaff@example.com",
    phone: "0912345678",
    password,
    role: "housekeeping",
    position: "Room attendant",
    shift: "Morning",
    hireDate: "2026-01-01",
  };
  await send(manager, "post", "/api/staff", {
    ...payload,
    role: "admin",
  }).expect(400);
  await send(manager, "post", "/api/staff", {
    ...payload,
    phone: "bad",
  }).expect(400);
  const created = await send(manager, "post", "/api/staff", payload).expect(
    201,
  );
  const id = created.body.data._id;
  await send(manager, "patch", `/api/staff/${new mongoose.Types.ObjectId()}`, {
    fullName: "Missing",
  }).expect(404);
  await send(manager, "patch", `/api/staff/${id}`, { role: "manager" }).expect(
    400,
  );
  await send(manager, "patch", `/api/staff/${id}`, {
    fullName: "Edited Staff",
    role: "receptionist",
  }).expect(200);
  await send(manager, "delete", `/api/staff/${id}`, { reason: "Contract ended." }).expect(200);
  assert.equal((await User.findById(id)).status, "suspended");
});
test("promotions validate bounds, minimum spend, expiry and usage; used coupons cannot be deleted", async () => {
  const payload = {
    code: "WELCOME10",
    discountType: "percentage",
    discountValue: 10,
    usageLimit: 20,
    minimumSpend: 500000,
    startDate: "2026-01-01",
    endDate: "2027-01-01",
    isActive: true,
  };
  await send(manager, "post", "/api/promotions", {
    ...payload,
    discountValue: 101,
  }).expect(400);
  await send(manager, "post", "/api/promotions", {
    ...payload,
    usageCount: 0,
  }).expect(400);
  const res = await send(manager, "post", "/api/promotions", payload).expect(
    201,
  );
  const id = res.body.data._id;
  await send(manager, "post", "/api/promotions", payload).expect(409);
  const uid = (await User.findOne({ roleId: await roleId("customer") })).id;
  assert.equal(
    (
      await validateCoupon({
        code: "WELCOME10",
        customerId: uid,
        subtotal: 600000,
        now: new Date("2026-05-01"),
      })
    ).discountAmount,
    60000,
  );
  await assert.rejects(
    validateCoupon({
      code: "WELCOME10",
      customerId: uid,
      subtotal: 100,
      now: new Date("2026-05-01"),
    }),
    /minimum/i,
  );
  await assert.rejects(
    validateCoupon({
      code: "WELCOME10",
      customerId: uid,
      subtotal: 600000,
      now: new Date("2028-05-01"),
    }),
    /expired/i,
  );
  await CouponUsage.create({
    couponId: id,
    bookingId: new mongoose.Types.ObjectId(),
    customerId: uid,
  });
  await send(manager, "delete", `/api/promotions/${id}`).expect(409);
  await assert.rejects(
    validateCoupon({
      code: "WELCOME10",
      customerId: uid,
      subtotal: 600000,
      now: new Date("2026-05-01"),
    }),
    /already/i,
  );
  await send(manager, "patch", `/api/promotions/${id}`, {
    isActive: false,
  }).expect(200);
});
test("revenue uses successful receipts minus completed refunds by transaction date and VN timezone; CSV matches", async () => {
  const uid = (await User.findOne({ roleId: await roleId("customer") }))._id;
  const book = await Booking.create({
    customerId: uid,
    createdBy: uid,
    checkInDate: "2026-01-01",
    checkOutDate: "2026-01-02",
    rooms: [
      { roomTypeId: new mongoose.Types.ObjectId(), priceAtBooking: 1000 },
    ],
    roomAmount: 1000,
    totalAmount: 1000,
  });
  const p = await Payment.create({
    bookingId: book.id,
    kind: "deposit",
    amount: 1000,
    method: "cash",
    status: "success",
    paidAt: "2026-01-01T17:00:00Z",
  });
  await Payment.create({
    bookingId: book.id,
    kind: "final",
    amount: 500,
    method: "cash",
    status: "failed",
    paidAt: "2026-01-02T00:00:00Z",
  });
  await Refund.create({
    bookingId: book.id,
    paymentId: p.id,
    amount: 200,
    status: "completed",
    processedAt: "2026-01-03T00:00:00Z",
  });
  await Refund.create({
    bookingId: book.id,
    paymentId: p.id,
    amount: 100,
    status: "failed",
    processedAt: "2026-01-03T00:00:00Z",
  });
  const res = await manager
    .get("/api/reports/revenue?from=2026-01-02&to=2026-01-03&groupBy=day")
    .expect(200);
  assert.deepEqual(res.body.data.totals, {
    received: 1000,
    refunded: 200,
    net: 800,
    paymentCount: 1,
    refundCount: 1,
  });
  assert.equal(res.body.data.series[0].date, "2026-01-02");
  const refundsOnly = await manager
    .get("/api/reports/revenue?from=2026-01-03&to=2026-01-03")
    .expect(200);
  assert.equal(refundsOnly.body.data.totals.net, -200);
  const csv = await manager
    .get("/api/reports/revenue?from=2026-01-02&to=2026-01-03&format=csv")
    .expect(200);
  assert.match(csv.text, /2026-01-02,1000,0,1000/);
  await manager
    .get("/api/reports/revenue?hotelId=x&from=2026-01-01&to=2026-01-31")
    .expect(400);
  await manager
    .get("/api/reports/revenue?from=2026-02-30&to=2026-03-01")
    .expect(400);
  await manager
    .get("/api/reports/revenue?from=2026-03-01&to=2026-01-01")
    .expect(400);
  await customer.get("/api/reports/revenue").expect(403);
});

test("notification service stores in-app notifications, emails on events and survives mail failure", async () => {
  const { notify, notifyRole, setTransport } = require("../src/services/notifications");
  const Notification = require("../src/models/Notification");
  const guest = await User.findOne({ email: "customer@example.com" });
  const sent = [];
  setTransport({ sendMail: async (m) => sent.push(m) });
  await notify("booking_confirmed", guest._id, { reference: "BK-1" });
  assert.equal(sent.length, 1);
  assert.equal(sent[0].to, "customer@example.com");
  assert.match(sent[0].text, /BK-1/);
  setTransport({ sendMail: async () => { throw new Error("smtp down"); } });
  const kept = await notify("payment_result", guest._id, { reference: "BK-1", amount: 500000, success: false });
  assert.equal(kept.title, "Payment failed");
  await assert.rejects(() => notify("nope", guest._id), /Unknown notification event/);
  setTransport(null);
  assert.equal((await notifyRole("room_issue", "manager", { roomNumber: "101", description: "Leak" })).length, 1);

  assert.equal(await Notification.countDocuments({ accountId: guest._id }), 2);
  const alert = await Notification.findOne({ type: "room_issue" });
  assert.equal(alert.isRead, false);
  assert.equal(String(alert.accountId), String((await User.findOne({ email: "manager@example.com" }))._id));
});
test("booking history and details expose only the customer's own bookings with payment and refund status", async () => {
  const RoomType = require("../src/models/RoomType");
  const guest = await User.findOne({ email: "customer@example.com" });
  const other = await User.findOne({ email: "manager@example.com" });
  const type = await RoomType.create({ name: "History Suite", basePrice: 1000, maxOccupancy: 2 });
  const base = (customerId, extra = {}) => ({
    customerId, createdBy: customerId, checkInDate: "2027-03-01", checkOutDate: "2027-03-03",
    rooms: [{ roomTypeId: type._id, priceAtBooking: 1000 }], roomAmount: 2000, totalAmount: 2000,
    events: [{ actorId: customerId, type: "created" }], ...extra,
  });
  const mineBooking = await Booking.create(base(guest._id, { status: "confirmed" }));
  const cancelled = await Booking.create(base(guest._id, { status: "cancelled" }));
  const foreign = await Booking.create(base(other._id));
  const deposit = await Payment.create({ bookingId: mineBooking.id, kind: "deposit", amount: 600, method: "bank_transfer", status: "success" });
  await Payment.create({ bookingId: mineBooking.id, kind: "final", amount: 1400, method: "cash", status: "failed" });
  await Refund.create({ bookingId: cancelled.id, paymentId: deposit.id, amount: 300, status: "completed" });

  const list = await customer.get("/api/bookings").expect(200);
  const ids = list.body.data.map((b) => b._id);
  assert.ok(ids.includes(mineBooking.id) && ids.includes(cancelled.id));
  assert.ok(!ids.includes(foreign.id));
  const row = list.body.data.find((b) => b._id === mineBooking.id);
  assert.equal(row.paymentStatus, "deposit_paid"); // SRS 2.6
  assert.equal(row.paidAmount, 600);
  assert.equal(row.rooms[0].roomTypeId.name, "History Suite");
  assert.equal(row.events, undefined);
  assert.equal((await customer.get("/api/bookings?status=cancelled").expect(200)).body.data.length, 1);
  await customer.get("/api/bookings?status=bogus").expect(400);

  const detail = await customer.get(`/api/bookings/${mineBooking.id}`).expect(200);
  assert.equal(detail.body.data.payments.length, 2);
  assert.equal(detail.body.data.events, undefined);
  assert.equal(detail.body.data.createdBy, undefined);
  const withRefund = await customer.get(`/api/bookings/${cancelled.id}`).expect(200);
  assert.equal(withRefund.body.data.refunds[0].status, "completed");
  await customer.get(`/api/bookings/${foreign.id}`).expect(404);
  await customer.get("/api/bookings/not-an-id").expect(400);
  await request(app).get("/api/bookings").expect(401);
});
test("deposit policy: manager versions a percentage rule, old versions are retired, others are refused", async () => {
  const { currentDepositPolicy } = require("../src/services/policies");
  await manager.get("/api/policies/deposit").expect(200).then((r) => assert.equal(r.body.meta.current, null));
  await customer.get("/api/policies/deposit").expect(403);
  await staff.get("/api/policies/deposit").expect(403);
  for (const percentage of [0, 101, 12.5, "30"])
    await send(manager, "post", "/api/policies/deposit", { percentage }).expect(400);
  await send(manager, "post", "/api/policies/deposit", { percentage: 30, kind: "cancellation" }).expect(400);
  const first = await send(manager, "post", "/api/policies/deposit", { percentage: 30 }).expect(201);
  assert.equal(first.body.data.deposit.value, 30);
  assert.equal(first.body.data.name, "Deposit 30%");
  const second = await send(manager, "post", "/api/policies/deposit", { percentage: 50, name: "Peak season" }).expect(201);
  const list = await manager.get("/api/policies/deposit").expect(200);
  assert.equal(list.body.data.length, 2);
  assert.equal(list.body.meta.current._id, second.body.data._id);
  assert.equal((await currentDepositPolicy(new Date(Date.now() - 86400000))), null);
  assert.equal(list.body.data.filter((p) => p.isActive).length, 1);
});
test("online booking: held 15 minutes for the deposit (BR-29), no pay-at-hotel option, deposit can then be paid", async () => {
  const RoomType = require("../src/models/RoomType");
  const Room = require("../src/models/Room");
  const type = await RoomType.create({ name: "Checkout Suite", basePrice: 1000, maxOccupancy: 2 });
  await Room.create({ roomNumber: "CO-1", roomTypeId: type._id, floor: 1 });
  const body = { roomTypeId: type.id, checkInDate: "2027-08-10", checkOutDate: "2027-08-12", guestCount: 2, consent: true };
  await send(customer, "post", "/api/bookings", { ...body, consent: undefined }).expect(400); // CR-21
  for (const paymentOption of ["hotel", "full"])
    await send(customer, "post", "/api/bookings", { ...body, paymentOption }).expect(400);
  const booking = (await send(customer, "post", "/api/bookings", body).expect(201)).body.data;
  assert.equal(booking.status, "pending");
  assert.equal(booking.depositRequired, 1000); // 50% policy from the previous test
  const holdMinutes = (Date.parse(booking.holdExpiresAt) - Date.now()) / 60000;
  assert.ok(holdMinutes > 14 && holdMinutes <= 15);
  assert.equal(await Payment.countDocuments({ bookingId: booking._id }), 0); // no placeholder payment
  const order = (await send(customer, "post", `/api/bookings/${booking._id}/payments/deposit`, { method: "bank_transfer" }).expect(201)).body.data;
  assert.equal(order.amount, 1000);
});

// ---- M3 payments: UC12 deposit, UC13 final payment, UC38 gateway callback ----
const gw = require("../src/services/gateway");
const callbackBody = (orderId, status, amount, transactionRef = `T-${orderId}`) => {
  const p = { orderId, transactionRef, status, amount };
  return { ...p, signature: gw.sign(p) };
};
// The gateway is not a browser: no Origin header, no session.
const hook = (body) => request(app).post("/api/payments/gateway/callback").send(body);
async function payBooking(extra = {}) {
  const RoomType = require("../src/models/RoomType");
  const guest = await User.findOne({ email: "customer@example.com" });
  const type = (await RoomType.findOne({ name: "Pay Suite" })) || (await RoomType.create({ name: "Pay Suite", basePrice: 1000, maxOccupancy: 2 }));
  return Booking.create({
    customerId: guest._id, createdBy: guest._id, checkInDate: "2027-05-01", checkOutDate: "2027-05-03",
    rooms: [{ roomTypeId: type._id, priceAtBooking: 1000 }], roomAmount: 2000, totalAmount: 2000,
    depositRequired: 600, status: "pending", holdExpiresAt: new Date(Date.now() + 15 * 60000), ...extra,
  });
}
test("deposit payment: verified callback confirms the booking; forged, mismatched and repeated callbacks change nothing", async () => {
  const Notification = require("../src/models/Notification");
  const booking = await payBooking();
  const url = `/api/bookings/${booking.id}/payments/deposit`;
  await send(customer, "post", url, { method: "cash" }).expect(400);
  await send(customer, "post", url, { method: "bank_transfer", amount: 1 }).expect(400);
  await send(manager, "post", url, { method: "bank_transfer" }).expect(404);
  const first = (await send(customer, "post", url, { method: "bank_transfer" }).expect(201)).body.data;
  assert.equal(first.amount, 600);
  assert.match(first.payUrl, /^#\/pay\/sandbox\/ORD/);
  assert.equal((await send(customer, "post", url, { method: "bank_transfer" }).expect(201)).body.data.orderId, first.orderId);

  await hook({ ...callbackBody(first.orderId, "success", 600), signature: "00" }).expect(401);
  await hook(callbackBody("ORDNOPE", "success", 600)).expect(404);
  await hook(callbackBody(first.orderId, "success", 1)).expect(400);
  assert.equal((await Booking.findById(booking.id)).status, "pending");
  assert.equal((await Payment.findById(first.paymentId)).status, "pending");

  assert.equal((await hook(callbackBody(first.orderId, "success", 600)).expect(200)).body.data.status, "success");
  const confirmed = await Booking.findById(booking.id);
  assert.equal(confirmed.status, "confirmed");
  assert.equal(confirmed.holdExpiresAt, undefined);
  assert.equal((await hook(callbackBody(first.orderId, "success", 600)).expect(200)).body.data.duplicate, true);
  assert.equal(await Notification.countDocuments({ bookingId: booking._id, type: "booking_confirmed" }), 1);
  assert.equal(await Notification.countDocuments({ bookingId: booking._id, type: "payment_result" }), 1);
  await send(customer, "post", url, { method: "bank_transfer" }).expect(409);
  assert.equal((await customer.get(`/api/payments/${first.paymentId}`).expect(200)).body.data.status, "success");
  await manager.get(`/api/payments/${first.paymentId}`).expect(404);
});
test("deposit payment: a declined payment can be retried; a deposit confirmed after the hold expired becomes a refund case", async () => {
  const booking = await payBooking();
  const start = () => send(customer, "post", `/api/bookings/${booking.id}/payments/deposit`, { method: "credit_card" });
  const a = (await start().expect(201)).body.data;
  assert.equal((await hook(callbackBody(a.orderId, "failed", 600)).expect(200)).body.data.status, "failed");
  assert.equal((await Booking.findById(booking.id)).status, "pending");
  const b = (await start().expect(201)).body.data;
  assert.notEqual(b.orderId, a.orderId);

  // Beyond the 15-minute grace a pending result gets after the hold ends (BR-29).
  await Booking.updateOne({ _id: booking._id }, { holdExpiresAt: new Date(Date.now() - 16 * 60000) });
  await start().expect(409);
  await hook(callbackBody(b.orderId, "success", 600)).expect(200);
  assert.equal((await Payment.findById(b.paymentId)).status, "success");
  assert.notEqual((await Booking.findById(booking.id)).status, "confirmed");
  const refund = await Refund.findOne({ bookingId: booking._id });
  assert.equal(refund.status, "requested");
  assert.equal(refund.amount, 600);
});
test("BR-14: the balance is paid only at the front desk, never online; the receptionist records it", async () => {
  const booking = await payBooking({ status: "confirmed", holdExpiresAt: undefined });
  await Payment.create({ bookingId: booking._id, kind: "deposit", amount: 600, method: "bank_transfer", status: "success", paidAt: new Date() });
  // there is no online final payment for the customer, and the desk route rejects them and online methods
  await send(customer, "post", `/api/bookings/${booking.id}/payments/final`, { method: "bank_transfer" }).expect(404);
  const desk = `/api/frontdesk/bookings/${booking.id}/payments`;
  await send(customer, "post", desk, { method: "cash" }).expect(403);
  await send(staff, "post", desk, { method: "bank_transfer" }).expect(400);
  assert.equal(await Payment.countDocuments({ bookingId: booking._id, kind: "final" }), 0);

  const cash = (await send(staff, "post", desk, { method: "cash" }).expect(201)).body.data;
  assert.equal(cash.status, "success");
  assert.equal(cash.amount, 1400);
  assert.equal(cash.remaining, 0);
  assert.equal(String((await Payment.findById(cash.paymentId)).recordedBy), String((await User.findOne({ email: "staff@example.com" }))._id));
  const detail = (await customer.get(`/api/bookings/${booking.id}`).expect(200)).body.data;
  assert.equal(detail.paymentStatus, "fully_paid"); // SRS 2.6
  assert.equal(detail.paidAmount, 2000);
  await send(staff, "post", desk, { method: "cash" }).expect(409); // nothing is left to pay
});

// ---- SePay gateway adapter (PAYMENT_PROVIDER=sepay); SePay itself is mocked ----
const { createHmac } = require("node:crypto");
const sepay = require("../src/services/sepay");
async function withSepay(fn) {
  const keys = ["PAYMENT_PROVIDER", "SEPAY_MERCHANT_ID", "SEPAY_SECRET_KEY", "PUBLIC_URL", "SEPAY_METHODS"];
  const saved = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  const realFetch = global.fetch;
  const realError = console.error;
  console.error = () => {}; // the lookup-failure tests log on purpose
  Object.assign(process.env, { PAYMENT_PROVIDER: "sepay", SEPAY_MERCHANT_ID: "MERCH1", SEPAY_SECRET_KEY: "sekret", PUBLIC_URL: "https://shop.example" });
  delete process.env.SEPAY_METHODS;
  try {
    await fn();
  } finally {
    for (const k of keys) saved[k] === undefined ? delete process.env[k] : (process.env[k] = saved[k]);
    global.fetch = realFetch;
    console.error = realError;
  }
}
// Fakes the SePay order lookup; returns the recorded calls.
function mockOrder(status, amount) {
  const calls = [];
  global.fetch = async (url, opts) => {
    calls.push({ url, auth: opts.headers.Authorization });
    return { ok: true, status: 200, json: async () => ({ data: { order_status: status, order_amount: `${amount}.00`, transactions: [{ transaction_id: "TXR" }] } }) };
  };
  return calls;
}
const ipnBody = (invoice, amount, extra = {}) => ({
  timestamp: 1757058220, notification_type: "ORDER_PAID",
  order: { order_invoice_number: invoice, order_amount: `${amount}.00`, order_status: "CAPTURED" },
  transaction: { transaction_id: `TX-${invoice}`, transaction_status: "APPROVED" }, ...extra,
});
const ipn = (body, key = "sekret") => request(app).post("/api/payments/sepay/ipn").set("X-Secret-Key", key).send(body);
async function sepayDeposit(booking, method = "bank_transfer") {
  return (await send(customer, "post", `/api/bookings/${booking.id}/payments/deposit`, { method }).expect(201)).body.data;
}

test("sepay: the signature follows the SePay field order and skips empty fields", () => {
  const fields = { merchant: "M", order_amount: "1000", currency: "VND", operation: "PURCHASE", order_description: "d", order_invoice_number: "ORD1", customer_id: "", payment_method: "BANK_TRANSFER", success_url: "s" };
  const signed = "order_amount=1000,merchant=M,currency=VND,operation=PURCHASE,order_description=d,order_invoice_number=ORD1,payment_method=BANK_TRANSFER,success_url=s";
  assert.equal(sepay.signature(fields, "k"), createHmac("sha256", "k").update(signed).digest("base64"));
});
test("sepay: every attempt gets a fresh signed checkout and retires the previous order", async () => {
  await withSepay(async () => {
    const booking = await payBooking();
    const url = `/api/bookings/${booking.id}/payments/deposit`;
    assert.deepEqual((await customer.get("/api/payments/methods").expect(200)).body.data, { provider: "sepay", methods: ["bank_transfer"] });
    await send(customer, "post", url, { method: "credit_card" }).expect(400);
    const first = await sepayDeposit(booking);
    assert.equal(first.payUrl, undefined);
    const { action, fields } = first.checkout;
    assert.equal(action, "https://pay-sandbox.sepay.vn/v1/checkout/init");
    assert.equal(fields.order_invoice_number, first.orderId);
    assert.equal(fields.order_amount, "600");
    assert.equal(fields.payment_method, "BANK_TRANSFER");
    assert.equal(fields.merchant, "MERCH1");
    const { signature, ...rest } = fields;
    assert.equal(signature, sepay.signature(rest, "sekret"));
    assert.match(fields.cancel_url, /^https:\/\/shop\.example\/api\/payments\/return\?payment=[0-9a-f]{24}&r=cancel$/);
    assert.equal(JSON.stringify(first).includes("sekret"), false);
    const second = await sepayDeposit(booking);
    assert.notEqual(second.orderId, first.orderId);
    assert.equal((await Payment.findById(first.paymentId)).status, "cancelled");
  });
});
test("sepay: the IPN is authenticated, checked against SePay and applied once", async () => {
  const Notification = require("../src/models/Notification");
  await ipn({}).expect(404); // sandbox provider: the endpoint is off
  await withSepay(async () => {
    const booking = await payBooking();
    const o = await sepayDeposit(booking);
    await ipn(ipnBody(o.orderId, 600), "wrong").expect(401);
    await request(app).post("/api/payments/sepay/ipn").send(ipnBody(o.orderId, 600)).expect(401);
    await ipn(ipnBody("ORDNOPE", 600)).expect(404);
    await ipn(ipnBody(o.orderId, 1)).expect(400);
    assert.deepEqual((await ipn({ notification_type: "TRANSACTION_VOID" }).expect(200)).body, { success: true });
    mockOrder("AUTHENTICATION_NOT_NEEDED", 600); // SePay says: not paid yet
    await ipn(ipnBody(o.orderId, 600)).expect(400);
    assert.equal((await Payment.findById(o.paymentId)).status, "pending");
    assert.equal((await Booking.findById(booking.id)).status, "pending");

    const calls = mockOrder("CAPTURED", 600);
    assert.deepEqual((await ipn(ipnBody(o.orderId, 600)).expect(200)).body, { success: true });
    assert.equal(calls[0].url, `https://pgapi-sandbox.sepay.vn/v1/order/detail/${o.orderId}`);
    assert.equal(calls[0].auth, `Basic ${Buffer.from("MERCH1:sekret").toString("base64")}`);
    const paid = await Payment.findById(o.paymentId);
    assert.equal(paid.status, "success");
    assert.equal(paid.transactionRef, `TX-${o.orderId}`);
    assert.equal((await Booking.findById(booking.id)).status, "confirmed");
    await ipn(ipnBody(o.orderId, 600)).expect(200); // a retried IPN changes nothing
    assert.equal(await Notification.countDocuments({ bookingId: booking._id, type: "booking_confirmed" }), 1);

    // SePay unreachable: the key-authenticated IPN is still accepted.
    const other = await payBooking();
    const o2 = await sepayDeposit(other);
    global.fetch = async () => { throw new Error("network down"); };
    await ipn(ipnBody(o2.orderId, 600)).expect(200);
    assert.equal((await Booking.findById(other.id)).status, "confirmed");

    // A customer who kept an old QR open can still pay a retired order: the money is recorded.
    const third = await payBooking();
    const old = await sepayDeposit(third);
    await sepayDeposit(third);
    assert.equal((await Payment.findById(old.paymentId)).status, "cancelled");
    mockOrder("CAPTURED", 600);
    await ipn(ipnBody(old.orderId, 600)).expect(200);
    assert.equal((await Payment.findById(old.paymentId)).status, "success");
    assert.equal((await Booking.findById(third.id)).status, "confirmed");
  });
});
test("sepay: the result screen asks SePay when no IPN arrived and stays pending if SePay is unreachable", async () => {
  await withSepay(async () => {
    const stale = (id) => Payment.collection.updateOne({ _id: new mongoose.Types.ObjectId(id) }, { $set: { createdAt: new Date(Date.now() - 60000) } });
    const booking = await payBooking();
    const o = await sepayDeposit(booking);
    const calls = mockOrder("CAPTURED", 600);
    assert.equal((await customer.get(`/api/payments/${o.paymentId}`).expect(200)).body.data.status, "pending");
    assert.equal(calls.length, 0); // too fresh: give the IPN a chance first
    await stale(o.paymentId);
    global.fetch = async () => { throw new Error("network down"); };
    assert.equal((await customer.get(`/api/payments/${o.paymentId}`).expect(200)).body.data.status, "pending");
    mockOrder("CAPTURED", 600);
    assert.equal((await customer.get(`/api/payments/${o.paymentId}`).expect(200)).body.data.status, "success");
    assert.equal((await Booking.findById(booking.id)).status, "confirmed");

    const abandoned = await payBooking();
    const o2 = await sepayDeposit(abandoned);
    await stale(o2.paymentId);
    mockOrder("CANCELLED", 600);
    const shown = (await customer.get(`/api/payments/${o2.paymentId}`).expect(200)).body.data;
    assert.equal(shown.status, "failed");
    assert.match(shown.failureReason, /Cancelled at the payment gateway/);
    assert.equal(shown.gatewayOrderId, undefined);
  });
});
test("sepay: the return route only opens the result screen", async () => {
  await withSepay(async () => {
    const id = new mongoose.Types.ObjectId().toString();
    assert.equal((await request(app).get(`/api/payments/return?payment=${id}&r=cancel`).expect(302)).headers.location, `https://shop.example/#/pay/result?payment=${id}&r=cancel`);
    assert.equal((await request(app).get(`/api/payments/return?payment=${id}&r=evil`).expect(302)).headers.location, `https://shop.example/#/pay/result?payment=${id}`);
    assert.equal((await request(app).get("/api/payments/return?payment=not-an-id").expect(302)).headers.location, "https://shop.example/#/my-bookings");
  });
});

// ---- M3 cancellation & refund: UC08, UC16, UC35, UC21, UC27, T19, T20; UC10 / UC11 / T17 additions ----
const AuditLog = require("../src/models/AuditLog");
const Notification = require("../src/models/Notification");
async function paidBooking(extra = {}) {
  const booking = await payBooking({ status: "confirmed", holdExpiresAt: undefined, ...extra });
  await Payment.create({ bookingId: booking._id, kind: "deposit", amount: 600, method: "bank_transfer", status: "success", paidAt: new Date(), transactionRef: `DEP-${booking.id}` });
  return booking;
}
const tiers = (...pairs) => pairs.map(([minHoursBeforeCheckIn, refundPercent]) => ({ minHoursBeforeCheckIn, refundPercent }));

test("UC27: the manager saves cancellation tiers and stay rules; bad tiers are refused (MSG-63); hotel info is public", async () => {
  const url = "/api/policies/cancellation";
  await send(staff, "post", url, { tiers: tiers([0, 0]) }).expect(403);
  for (const bad of [
    [],
    tiers([48, 100]), // gap below 48 h
    tiers([48, 100], [48, 0], [0, 0]), // overlap
    tiers([48, 50], [0, 0]), // partial refund
    tiers([48, 0], [0, 100]), // more refund closer to check-in
  ])
    await send(manager, "post", url, { tiers: bad }).expect(400);
  await send(manager, "post", url, { tiers: tiers([0, 0]), checkInTime: "25:00" }).expect(400);
  const saved = (await send(manager, "post", url, { tiers: tiers([0, 0], [48, 100]), checkInTime: "14:00", checkOutTime: "12:00", earlyCheckInFee: 200000, lateCheckOutFee: 300000 }).expect(201)).body.data;
  assert.deepEqual(saved.cancellationTiers.map((t) => t.minHoursBeforeCheckIn), [48, 0]);
  assert.equal(saved.lateCheckOutFee, 300000);
  assert.equal((await manager.get(url).expect(200)).body.meta.current._id, saved._id);

  await send(manager, "put", "/api/hotel-info", { name: "Hotel Sunrise", phone: "abc" }).expect(400);
  await send(staff, "put", "/api/hotel-info", { name: "Hotel Sunrise" }).expect(403);
  await send(manager, "put", "/api/hotel-info", { name: "Hotel Sunrise", address: "1 Le Loi", email: "hi@sunrise.vn" }).expect(200);
  assert.equal((await request(app).get("/api/hotel-info").expect(200)).body.data.name, "Hotel Sunrise");
});

test("UC08: the customer requests a cancellation with a locked refund, withdraws it, and abandons a pending payment", async () => {
  const booking = await paidBooking();
  const est = (await customer.get(`/api/bookings/${booking.id}/refund-estimate`).expect(200)).body.data;
  assert.deepEqual([est.depositPaid, est.refundPercent, est.refundableAmount], [600, 100, 600]);
  await manager.get(`/api/bookings/${booking.id}/refund-estimate`).expect(404);
  await send(customer, "post", `/api/bookings/${booking.id}/cancel`, { reason: 123 }).expect(400);
  const r = (await send(customer, "post", `/api/bookings/${booking.id}/cancel`, { reason: "Plans changed" }).expect(200)).body;
  assert.equal(r.data.status, "cancellation_requested");
  assert.equal(r.data.refundableAmount, 600);
  assert.match(r.message, /sent to the front desk/);
  await send(customer, "post", `/api/bookings/${booking.id}/cancel`).expect(409);
  assert.ok(await Notification.exists({ type: "cancellation_requested", bookingId: booking._id }));
  assert.equal((await send(customer, "delete", `/api/bookings/${booking.id}/cancel`).expect(200)).body.data.status, "confirmed");
  assert.equal((await Booking.findById(booking.id)).cancellation?.requestedAt, undefined);
  await send(customer, "delete", `/api/bookings/${booking.id}/cancel`).expect(409);

  // A 0% tier is still reviewed, with nothing to refund (UC08 3a).
  const late = await paidBooking({ policySnapshot: { cancellationTiers: tiers([999999, 100], [0, 0]) } });
  assert.equal((await send(customer, "post", `/api/bookings/${late.id}/cancel`).expect(200)).body.data.refundableAmount, 0);

  // No paid deposit: cancelled at once and the coupon use is given back (BR-16, BR-09).
  const free = await payBooking({ status: "confirmed", holdExpiresAt: undefined, depositRequired: 0 });
  const coupon = await Coupon.create({ code: "BACK10", discountValue: 10, usageLimit: 5, usageCount: 1 });
  await CouponUsage.create({ couponId: coupon._id, bookingId: free._id, customerId: free.customerId });
  const f = (await send(customer, "post", `/api/bookings/${free.id}/cancel`).expect(200)).body;
  assert.equal(f.data.status, "cancelled");
  assert.match(f.message, /cancelled successfully/);
  assert.equal((await Coupon.findById(coupon._id)).usageCount, 0);
  assert.equal(await CouponUsage.exists({ bookingId: free._id }), null);
  await send(customer, "post", `/api/bookings/${free.id}/cancel`).expect(409);

  // Pending Payment: only "Cancel payment"; a result that still arrives becomes a late-deposit refund case.
  const pending = await payBooking();
  await send(customer, "post", `/api/bookings/${pending.id}/cancel`).expect(409);
  const o = (await send(customer, "post", `/api/bookings/${pending.id}/payments/deposit`, { method: "bank_transfer" }).expect(201)).body.data;
  assert.equal((await send(customer, "post", `/api/bookings/${pending.id}/cancel-payment`).expect(200)).body.data.status, "expired");
  assert.equal((await Payment.findById(o.paymentId)).status, "cancelled");
  await hook(callbackBody(o.orderId, "success", 600)).expect(200);
  assert.equal((await Booking.findById(pending.id)).status, "expired");
  assert.equal((await Payment.findById(o.paymentId)).isLateDeposit, true);
  assert.ok(await Refund.exists({ paymentId: o.paymentId, status: "requested" }));
  await send(customer, "post", `/api/bookings/${pending.id}/cancel-payment`).expect(409);
});

test("UC35 / T20: the receptionist approves a request and a refund case opens; undecided requests are approved automatically", async () => {
  const booking = await paidBooking();
  await send(customer, "post", `/api/bookings/${booking.id}/cancel`, { reason: "Sick" }).expect(200);
  await customer.get("/api/frontdesk/cancellations").expect(403);
  const row = (await staff.get("/api/frontdesk/cancellations").expect(200)).body.data.find((b) => b._id === booking.id);
  assert.equal(row.depositPaid, 600);
  assert.equal(row.cancellation.refundableAmount, 600);
  assert.equal(row.cancellation.reason, "Sick");
  assert.equal(row.booker.email, "customer@example.com");
  await send(customer, "post", `/api/frontdesk/cancellations/${booking.id}/approve`).expect(403);
  const a = (await send(staff, "post", `/api/frontdesk/cancellations/${booking.id}/approve`).expect(200)).body;
  assert.equal(a.data.status, "cancelled");
  assert.match(a.message, /waiting for refund/);
  await send(staff, "post", `/api/frontdesk/cancellations/${booking.id}/approve`).expect(409);
  const refund = await Refund.findOne({ bookingId: booking._id });
  assert.deepEqual([refund.amount, refund.status], [600, "requested"]);
  assert.match((await Notification.findOne({ type: "cancellation_approved", bookingId: booking._id })).message, /contact you/);
  const detail = (await customer.get(`/api/bookings/${booking.id}`).expect(200)).body.data;
  assert.equal(detail.refunds[0].status, "requested");
  assert.equal(detail.cancellationOtp, undefined);

  const old = await paidBooking();
  const fresh = await paidBooking();
  const arriving = await paidBooking({ checkInDate: new Date(Date.now() - 864e5), checkOutDate: new Date(Date.now() + 864e5) });
  for (const b of [old, fresh, arriving]) await send(customer, "post", `/api/bookings/${b.id}/cancel`).expect(200);
  await Booking.updateOne({ _id: old._id }, { "cancellation.requestedAt": new Date(Date.now() - 25 * 3600000) });
  const { autoApprove } = require("../src/services/cancellations");
  assert.equal((await autoApprove(new Date())).approved, 2);
  assert.equal((await Booking.findById(old.id)).status, "cancelled");
  assert.equal((await Booking.findById(old.id)).cancellation.autoApproved, true);
  assert.equal((await Booking.findById(arriving.id)).status, "cancelled"); // check-in time passed
  assert.equal((await Booking.findById(fresh.id)).status, "cancellation_requested");
  assert.ok(await AuditLog.exists({ action: "cancellation.approved_automatically", targetId: old._id }));
  assert.equal((await autoApprove(new Date())).approved, 0);
});

test("UC38: penalties join the bill, are confirmed, reduced or waived once, and unpaid post-check-out ones are waived after 7 days (System Function 21)", async () => {
  const Penalty = require("../src/models/Penalty");
  const stay = await payBooking({ status: "checked_in", holdExpiresAt: undefined });
  const url = `/api/frontdesk/bookings/${stay.id}/penalties`;
  await send(customer, "post", url, { itemName: "Towel", amount: 100 }).expect(403);
  const catalog = (await staff.get("/api/frontdesk/compensation-items").expect(200)).body.data;
  assert.ok(catalog.length >= 5 && catalog.every((i) => i.price > 0)); // dropdown source
  await customer.get("/api/frontdesk/compensation-items").expect(403);
  await send(staff, "post", url, { itemName: "Towel", amount: 0 }).expect(400);
  await send(staff, "post", url, { itemName: "Towel", amount: 100 }).expect(201);
  // a Housekeeping proposal: reduced on confirm, decided only once
  const vase = await Penalty.create({ bookingId: stay._id, itemName: "Vase", proposedAmount: 500 });
  await send(staff, "patch", `/api/frontdesk/penalties/${vase.id}`, { action: "confirm", amount: 600 }).expect(400);
  await send(staff, "patch", `/api/frontdesk/penalties/${vase.id}`, { action: "confirm", amount: 300 }).expect(200);
  await send(staff, "patch", `/api/frontdesk/penalties/${vase.id}`, { action: "confirm", amount: 100 }).expect(409);
  const lamp = await Penalty.create({ bookingId: stay._id, itemName: "Lamp", proposedAmount: 200 });
  await send(staff, "patch", `/api/frontdesk/penalties/${lamp.id}`, { action: "waive" }).expect(400); // reason required
  await send(staff, "patch", `/api/frontdesk/penalties/${lamp.id}`, { action: "waive", reason: "Already broken" }).expect(200);
  let b = await Booking.findById(stay._id);
  assert.deepEqual([b.penaltyAmount, b.totalAmount], [400, 2400]);
  assert.equal((await staff.get(url).expect(200)).body.data.length, 3);
  // paying the whole balance settles the confirmed penalties
  const paid = (await send(staff, "post", `/api/frontdesk/bookings/${stay.id}/payments`, { method: "cash" }).expect(201)).body.data;
  assert.equal(paid.amount, 2400);
  assert.equal(await Penalty.countDocuments({ bookingId: stay._id, status: "paid" }), 2);

  // BR-43: found after check-out; one is paid, the other stays unpaid for 7 days
  const left = await payBooking({ status: "checked_out", holdExpiresAt: undefined });
  await Payment.create({ bookingId: left._id, kind: "final", amount: 2000, method: "cash", status: "success", paidAt: new Date() });
  await send(staff, "post", `/api/frontdesk/bookings/${left.id}/penalties`, { itemName: "Minibar key", amount: 150 }).expect(201);
  const late = await Penalty.findOne({ bookingId: left._id });
  assert.equal(late.afterCheckout, true);
  const { waiveUnpaid } = require("../src/services/penalties");
  await Penalty.updateOne({ _id: late._id }, { confirmedAt: new Date(Date.now() - 6 * 864e5) });
  await waiveUnpaid();
  assert.equal((await Penalty.findById(late._id)).status, "confirmed"); // not 7 days yet
  await Penalty.updateOne({ _id: late._id }, { confirmedAt: new Date(Date.now() - 8 * 864e5) });
  await Penalty.updateMany({ bookingId: stay._id, status: "paid" }, { afterCheckout: true, confirmedAt: new Date(0) }); // a paid line is never waived
  assert.deepEqual(await waiveUnpaid(), { waived: 1 });
  assert.deepEqual(await waiveUnpaid(), { waived: 0 }); // idempotent
  const waivedLine = await Penalty.findById(late._id);
  assert.deepEqual([waivedLine.status, waivedLine.waivedReason], ["waived", "Not paid within 7 days"]);
  assert.ok(await require("../src/models/AuditLog").exists({ action: "penalty.waived_automatically", targetId: late._id }));
  b = await Booking.findById(left._id);
  assert.deepEqual([b.penaltyAmount, b.totalAmount], [0, 2000]);
  await send(staff, "post", `/api/frontdesk/bookings/${(await payBooking()).id}/penalties`, { itemName: "x", amount: 10 }).expect(409); // not checked in
});

test("Member 2 booking routes need a session and never act for another customer", async () => {
  const booking = await payBooking();
  const anon = request(app);
  await anon.post(`/api/bookings/${booking.id}/modify`).set("Origin", origin).send({ guestCount: 2 }).expect(401);
  await anon.post(`/api/bookings/${booking.id}/withdraw-cancellation`).set("Origin", origin).send({}).expect(401);
  await anon.get("/api/bookings/search").expect(401);
  assert.ok("depositPercent" in (await anon.get("/api/public/policies").expect(200)).body.data);
  await anon.get(`/api/bookings/ref/${booking.bookingReference}`).expect(401);
  await customer.get("/api/bookings/search").expect(403); // all guests' bookings are staff-only
  await staff.get("/api/bookings/search").expect(200);
  await customer.get("/api/frontdesk/payments").expect(403);
  const pays = (await staff.get("/api/frontdesk/payments?status=pending").expect(200)).body.data;
  assert.ok(pays.every((p) => p.status === "pending"));
  await manager.get("/api/frontdesk/invoices").expect(200);
  // a body customerId or x-user-id header cannot impersonate the owner
  const owner = String(booking.customerId);
  await send(admin, "post", `/api/bookings/${booking.id}/modify`, { customerId: owner, guestCount: 2 }).set("x-user-id", owner).expect((r) => assert.ok(r.status >= 400));
});

test("BR-29 hold expiry frees the room, keeps a gateway-pending deposit 15 more minutes, and tells the customer (UC13)", async () => {
  const Notification = require("../src/models/Notification");
  const { expireHolds } = require("../src/services/cancellations");
  const ago = (min) => new Date(Date.now() - min * 60000);
  const lapsed = await payBooking({ holdExpiresAt: ago(1) });
  const atGateway = await payBooking({ holdExpiresAt: ago(5) });
  await Payment.create({ bookingId: atGateway._id, kind: "deposit", amount: 600, method: "bank_transfer", status: "pending", createdAt: ago(7) });
  const live = await payBooking();
  await expireHolds();
  assert.equal((await Booking.findById(lapsed._id)).status, "expired");
  assert.equal((await Booking.findById(atGateway._id)).status, "pending"); // grace: the gateway may still confirm it
  assert.equal((await Booking.findById(live._id)).status, "pending");
  await expireHolds(new Date(Date.now() + 11 * 60000)); // the grace ended too
  assert.equal((await Booking.findById(atGateway._id)).status, "expired");
  assert.equal(await Payment.countDocuments({ bookingId: atGateway._id, status: "cancelled" }), 1);
  // UC13: the customer reads only their own notifications and marks them read
  const mine = (await customer.get("/api/notifications").expect(200)).body;
  assert.ok(mine.data.some((n) => n.type === "hold_expired" && String(n.bookingId) === lapsed.id));
  assert.ok(mine.meta.unread >= 2);
  assert.equal((await staff.get("/api/notifications").expect(200)).body.data.filter((n) => n.type === "hold_expired").length, 0);
  const one = mine.data.find((n) => n.type === "hold_expired");
  const other = await Notification.findOne({ accountId: { $ne: one.accountId } });
  if (other) await send(customer, "post", "/api/notifications/read", { id: other.id }).expect(200).expect((r) => assert.equal(r.body.data.updated, 0));
  await send(customer, "post", "/api/notifications/read", { id: one._id }).expect(200);
  assert.equal((await Notification.findById(one._id)).isRead, true);
  await send(customer, "post", "/api/notifications/read", {}).expect(200);
  assert.equal((await customer.get("/api/notifications").expect(200)).body.meta.unread, 0);
});

test("UC34 catalogs, UC31 -> UC38 proposed penalty, supplementary invoice after check-out, room writes need the manager", async () => {
  const Penalty = require("../src/models/Penalty");
  const Invoice = require("../src/models/Invoice");
  const Room = require("../src/models/Room");
  const RoomType = require("../src/models/RoomType");
  // UC34: manager only, validated, no duplicate names, deactivate instead of delete
  await staff.get("/api/catalog/services").expect(403);
  await manager.get("/api/catalog/nothing").expect(404);
  await send(manager, "post", "/api/catalog/compensation-items", { name: "", price: 10 }).expect(400);
  await send(manager, "post", "/api/catalog/compensation-items", { name: "Lamp shade", price: 0 }).expect(400);
  const shade = (await send(manager, "post", "/api/catalog/compensation-items", { name: "Lamp shade", price: 250 }).expect(201)).body.data;
  await send(manager, "post", "/api/catalog/compensation-items", { name: "Lamp shade", price: 300 }).expect(409);
  const spa = (await send(manager, "post", "/api/catalog/services", { name: "Spa", price: 500 }).expect(201)).body.data;
  assert.ok((await staff.get("/api/front-desk/services").expect(200)).body.data.some((s) => s._id === spa._id));
  await send(manager, "patch", `/api/catalog/services/${spa._id}`, { isActive: false }).expect(200);
  assert.ok(!(await staff.get("/api/front-desk/services").expect(200)).body.data.some((s) => s._id === spa._id));

  // UC31 -> UC38: a damaged item found at turnover becomes a Proposed penalty on the last checked-out stay
  await payBooking(); // creates the room type
  const type = await RoomType.findOne({ name: "Pay Suite" });
  const room = await Room.create({ roomNumber: "PEN-1", roomTypeId: type._id, floor: 1 });
  const left = await payBooking({ status: "checked_out", holdExpiresAt: undefined, actualCheckOutAt: new Date(), rooms: [{ roomTypeId: type._id, roomId: room._id, priceAtBooking: 1000 }] });
  await Payment.create({ bookingId: left._id, kind: "final", amount: 2000, method: "cash", status: "success", paidAt: new Date() });
  assert.ok((await staff.get("/api/room-issues/options").expect(200)).body.meta.compensationItems.some((i) => i.name === "Lamp shade"));
  const reported = (await send(staff, "post", "/api/room-issues", { roomId: room.id, title: "Lamp shade torn", description: "Found at turnover", severity: "low", chargeItemId: shade._id }).expect(201)).body.data;
  assert.equal(reported.penalty.status, "proposed");
  const RoomIssue = require("../src/models/RoomIssue");
  assert.deepEqual([reported.issue, await RoomIssue.countDocuments({ roomId: room._id })], [null, 0]); // UC31 (a): the room stays sellable
  assert.equal(reported.penalty.bookingId, left.id);
  assert.equal(reported.penalty.afterCheckout, true);
  await send(staff, "patch", `/api/frontdesk/penalties/${reported.penalty._id}`, { action: "confirm" }).expect(200);
  // the guest pays it later: a supplementary invoice is issued, the check-out invoice stays as it was
  await send(staff, "post", `/api/frontdesk/bookings/${left.id}/payments`, { method: "bank_transfer", transactionRef: "FT-77" }).expect(201);
  const supp = await Invoice.findOne({ bookingId: left._id, kind: "supplementary" });
  assert.equal(supp.totalAmount, 250);
  assert.deepEqual(supp.lines.map((l) => [l.name, l.amount]), [["Lamp shade", 250]]);
  assert.equal((await Penalty.findById(reported.penalty._id)).status, "paid");
  assert.equal(await Invoice.countDocuments({ bookingId: left._id, kind: "checkout" }), 0);
  // UC09: the customer sees the paid penalty and the supplementary invoice on the booking
  const mine = (await customer.get(`/api/bookings/${left.id}`).expect(200)).body.data;
  assert.deepEqual(mine.penalties.map((p) => [p.itemName, p.status]), [["Lamp shade", "paid"]]);
  assert.deepEqual(mine.invoices.map((i) => [i.kind, i.totalAmount]), [["supplementary", 250]]);
  // a quantity multiplies the compensation price; a Proposed line stays hidden from the customer
  const two = (await send(staff, "post", "/api/room-issues", { roomId: room.id, title: "Shades", description: "Two torn", severity: "low", chargeItemId: shade._id, quantity: 2 }).expect(201)).body.data;
  assert.equal(two.penalty.proposedAmount, 500);
  assert.equal(two.penalty.itemName, "Lamp shade x2");
  assert.equal((await customer.get(`/api/bookings/${left.id}`).expect(200)).body.data.penalties.length, 1);
  await send(staff, "post", "/api/room-issues", { roomId: room.id, title: "Shades", severity: "low", chargeItemId: shade._id, quantity: 0 }).expect(400);
  // UC31 (b): a room that cannot be used still opens the issue and goes to Maintenance, with the item proposed in the same report
  const unusable = (await send(staff, "post", "/api/room-issues", { roomId: room.id, title: "Room cannot be used (Lamp shade)", description: "Glass everywhere", severity: "high", chargeItemId: shade._id }).expect(201)).body.data;
  assert.deepEqual([Boolean(unusable.issue), unusable.maintenanceApplied, unusable.penalty.status], [true, true, "proposed"]);
  await Room.updateOne({ _id: room._id }, { status: "available" });

  // M2 room writes are no longer public
  const anon = request(app);
  await anon.patch(`/api/rooms/${room.id}/status`).set("Origin", origin).send({ status: "maintenance" }).expect(401);
  await anon.put(`/api/room-types/${type.id}/pricing`).set("Origin", origin).send({ seasonalPricing: [] }).expect(401);
  await send(staff, "put", `/api/room-types/${type.id}/pricing`, { seasonalPricing: [] }).expect(403);
  // UC25: rates are inclusive date ranges; an overlap is refused (MSG-60), a bad price or reversed dates too
  const rate = (description, startDate, endDate, price = 1500) => ({ description, startDate, endDate, price });
  await send(manager, "put", `/api/room-types/${type.id}/pricing`, { seasonalPricing: [rate("Tet", "2027-02-01", "2027-02-10"), rate("Late Tet", "2027-02-10", "2027-02-15")] }).expect(409);
  await send(manager, "put", `/api/room-types/${type.id}/pricing`, { seasonalPricing: [rate("Bad", "2027-02-10", "2027-02-01")] }).expect(400);
  await send(manager, "put", `/api/room-types/${type.id}/pricing`, { seasonalPricing: [rate("Free", "2027-02-01", "2027-02-02", 0)] }).expect(400);
  const priced = (await send(manager, "put", `/api/room-types/${type.id}/pricing`, { seasonalPricing: [rate("Tet", "2027-02-01", "2027-02-09"), rate("Late Tet", "2027-02-10", "2027-02-15")] }).expect(200)).body.data;
  assert.deepEqual(priced.seasonalPricing.map((r) => r.description), ["Tet", "Late Tet"]);
  await send(manager, "put", `/api/room-types/${type.id}/pricing`, { seasonalPricing: [] }).expect(200);
  await anon.get("/api/rooms/search").expect(401); // physical rooms are staff-only; guests use /api/public/availability
});

test("UC32: only the Admin reads the audit log, filtered by action and date", async () => {
  await manager.get("/api/audit-logs").expect(403);
  await staff.get("/api/audit-logs").expect(403);
  const all = (await admin.get("/api/audit-logs").expect(200)).body;
  assert.ok(all.meta.total > 0);
  const some = (await admin.get("/api/audit-logs?action=room_issue").expect(200)).body.data;
  assert.ok(some.length > 0 && some.every((a) => a.action.includes("room_issue")));
  assert.equal((await admin.get("/api/audit-logs?to=2000-01-01").expect(200)).body.data.length, 0);
  await admin.get("/api/audit-logs?from=nope").expect(400);
});

test("T18: an approved check-out request schedules the inspection 30 minutes before its own time", async () => {
  const Room = require("../src/models/Room");
  const RoomType = require("../src/models/RoomType");
  const Task = require("../src/models/CleaningTask");
  const CheckInOutRequest = require("../src/models/CheckInOutRequest");
  const { runHousekeepingTick } = require("../src/services/housekeepingTasks");
  await payBooking();
  const type = await RoomType.findOne({ name: "Pay Suite" });
  const room = await Room.create({ roomNumber: "INS-1", roomTypeId: type._id, floor: 1, status: "occupied" });
  const stay = await payBooking({ status: "checked_in", holdExpiresAt: undefined, checkInDate: "2027-09-01", checkOutDate: "2027-09-03", rooms: [{ roomTypeId: type._id, roomId: room._id, priceAtBooking: 1000 }] });
  const at = new Date("2027-09-03T08:00:00Z"); // 15:00 in Vietnam, after the 12:00 check-out time
  await CheckInOutRequest.create({ bookingId: stay._id, customerId: stay.customerId, type: "check_out", requestedTime: at, status: "approved" });
  await runHousekeepingTick(new Date(at.getTime() - 60 * 60000));
  assert.equal(await Task.countDocuments({ bookingId: stay._id, type: "inspection" }), 0); // not yet
  await runHousekeepingTick(new Date(at.getTime() - 20 * 60000));
  assert.equal(await Task.countDocuments({ bookingId: stay._id, type: "inspection" }), 1);
});

test("arrival reminder: confirmed stays checking in tomorrow (Vietnam time) are reminded once", async () => {
  const Notification = require("../src/models/Notification");
  const { arrivalReminders } = require("../src/services/reminders");
  const now = new Date("2027-10-09T20:00:00Z"); // 03:00 on 10 Oct in Vietnam, so "tomorrow" is 11 Oct
  const due = await payBooking({ status: "confirmed", holdExpiresAt: undefined, checkInDate: "2027-10-11", checkOutDate: "2027-10-12" });
  const later = await payBooking({ status: "confirmed", holdExpiresAt: undefined, checkInDate: "2027-10-12", checkOutDate: "2027-10-13" });
  await arrivalReminders(now);
  await arrivalReminders(now); // a second run sends nothing new
  assert.equal(await Notification.countDocuments({ type: "arrival_reminder", bookingId: due._id }), 1);
  assert.equal(await Notification.countDocuments({ type: "arrival_reminder", bookingId: later._id }), 0);
});

test("jobs endpoint: off without JOB_SECRET, then needs the secret", async () => {
  const saved = process.env.JOB_SECRET;
  delete process.env.JOB_SECRET;
  try {
    await request(app).post("/api/jobs/cancellation-auto-approval").expect(404);
    process.env.JOB_SECRET = "job-secret-value";
    await request(app).post("/api/jobs/cancellation-auto-approval").set("X-Job-Secret", "wrong").expect(401);
    await request(app).post("/api/jobs/toString").set("X-Job-Secret", "job-secret-value").expect(404);
    const ok = await request(app).post("/api/jobs/cancellation-auto-approval").set("X-Job-Secret", "job-secret-value").expect(200);
    assert.equal(typeof ok.body.data.approved, "number");
    for (const name of ["penalty-waiver", "housekeeping-tick", "routine-tasks"]) await request(app).post(`/api/jobs/${name}`).set("X-Job-Secret", "job-secret-value").expect(200);
  } finally {
    saved === undefined ? delete process.env.JOB_SECRET : (process.env.JOB_SECRET = saved);
  }
});

test("UC16 / T19: the front desk records a cancellation after the ID check or a phone OTP; a hotel-caused one is refunded in full at once", async () => {
  const { setTransport } = require("../src/services/notifications");
  const mails = [];
  setTransport({ sendMail: async (m) => mails.push(m) });
  const codeOf = () => mails.at(-1).text.match(/is (\d{6})\./)[1];
  try {
    const booking = await paidBooking({ bookingReference: "FD1001" });
    const found = (await staff.get("/api/frontdesk/cancellations/lookup?q=fd1001").expect(200)).body.data;
    assert.equal(found.length, 1);
    assert.equal(found[0].estimate.refundableAmount, 600);
    assert.equal(found[0].booker.name, "customer");
    await customer.get("/api/frontdesk/cancellations/lookup?q=fd1001").expect(403);
    const url = "/api/frontdesk/cancellations";
    const body = (extra) => ({ bookingId: booking.id, reason: "Guest called", ...extra });
    await send(staff, "post", url, body({ reason: " ", verifyMethod: "id_document" })).expect(400); // MSG-04
    await send(staff, "post", url, body({})).expect(400); // no verification
    await send(staff, "post", url, body({ verifyMethod: "otp", otp: "123456" })).expect(400); // no code sent yet
    await send(staff, "post", `/api/frontdesk/bookings/${booking.id}/cancel-otp`).expect(200);
    assert.equal(mails.at(-1).to, "customer@example.com");
    const first = codeOf();
    const wrong = first === "000000" ? "111111" : "000000";
    for (let i = 0; i < 5; i++) await send(staff, "post", url, body({ verifyMethod: "otp", otp: wrong })).expect(400);
    await send(staff, "post", url, body({ verifyMethod: "otp", otp: first })).expect(400); // locked after 5 wrong entries
    await send(staff, "post", `/api/frontdesk/bookings/${booking.id}/cancel-otp`).expect(200);
    assert.equal((await send(staff, "post", url, body({ verifyMethod: "otp", otp: codeOf() })).expect(201)).body.data.status, "cancellation_requested");
    const saved = await Booking.findById(booking.id);
    assert.deepEqual([saved.cancellation.verifyMethod, saved.cancellation.channel], ["otp", "front_desk"]);
    assert.ok(await AuditLog.exists({ action: "cancellation.requested", targetId: booking._id }));
    await send(staff, "post", url, body({ verifyMethod: "id_document" })).expect(409); // already waiting for review

    const walkIn = await payBooking({ status: "confirmed", holdExpiresAt: undefined, depositRequired: 0, bookingSource: "front_desk" });
    await send(staff, "post", `/api/frontdesk/bookings/${walkIn.id}/cancel-otp`).expect(400);
    assert.equal((await send(staff, "post", url, { bookingId: walkIn.id, reason: "Left", verifyMethod: "id_document" }).expect(201)).body.data.status, "cancelled");

    const hotel = await paidBooking({ policySnapshot: { cancellationTiers: tiers([0, 0]) } });
    const h = (await send(staff, "post", url, { bookingId: hotel.id, hotelCaused: true }).expect(201)).body.data;
    assert.deepEqual([h.status, h.refundableAmount], ["cancelled", 600]);
    const hb = await Booking.findById(hotel.id);
    assert.equal(hb.cancellationReason, "Hotel cannot provide the room");
    assert.equal(String(hb.cancellation.approvedBy), String((await User.findOne({ username: "staff" }))._id));
    assert.equal((await Refund.findOne({ bookingId: hotel._id })).amount, 600);
  } finally {
    setTransport(null);
  }
});

test("UC21: the receptionist enters the customer's bank account, notes contact attempts and records the transfer once", async () => {
  const booking = await paidBooking();
  await send(customer, "post", `/api/bookings/${booking.id}/cancel`).expect(200);
  await send(staff, "post", `/api/frontdesk/cancellations/${booking.id}/approve`).expect(200);
  const r = (await staff.get("/api/frontdesk/refunds").expect(200)).body.data.find((x) => x.booking._id === booking.id);
  assert.deepEqual([r.amount, r.booker.phone, r.account], [600, "0912345678", null]);
  await customer.get("/api/frontdesk/refunds").expect(403);
  const url = `/api/frontdesk/refunds/${r._id}`;
  await send(staff, "post", url, { bankTransactionCode: "FT123" }).expect(409); // account first
  await send(staff, "post", `${url}/contacts`, { note: "No answer" }).expect(201);
  await send(staff, "put", `${url}/account`, { bank: "VCB", accountNumber: "0123456789", holderName: "Someone Else" }).expect(400); // MSG-84
  await send(staff, "put", `${url}/account`, { bank: "VCB", accountNumber: "12ab34", holderName: "customer" }).expect(400);
  const acc = (await send(staff, "put", `${url}/account`, { bank: "Vietcombank", accountNumber: "0123456789", holderName: "Customer" }).expect(200)).body.data;
  assert.deepEqual([acc.account.accountNumber, acc.account.holderName, acc.contacts[0].note], ["0123456789", "CUSTOMER", "No answer"]);
  const stored = await Refund.findById(r._id);
  assert.equal(stored.bankAccount.accountNumber.includes("0123456789"), false); // encrypted at rest
  const done = (await send(staff, "post", url, { bankTransactionCode: "FT26110100001", note: "Sent" }).expect(200)).body;
  assert.equal(done.data.status, "completed");
  assert.match(done.message, /Refund recorded/);
  assert.equal((await Payment.findById(stored.paymentId)).status, "refunded"); // BR-17: whole deposit, once
  await send(staff, "post", url, { bankTransactionCode: "FT2" }).expect(409);
  assert.match((await Notification.findOne({ type: "refund_completed", bookingId: booking._id })).message, /FT26110100001/);
  assert.ok((await staff.get("/api/frontdesk/refunds?status=completed").expect(200)).body.data.some((x) => x._id === r._id));
  assert.equal((await customer.get(`/api/bookings/${booking.id}`).expect(200)).body.data.refunds[0].bankTransactionCode, "FT26110100001");

  // A deposit is refunded only once (MSG-42).
  const dup = await Refund.create({ paymentId: stored.paymentId, bookingId: booking._id, amount: 600, status: "requested", bankAccount: stored.bankAccount });
  await send(staff, "post", `/api/frontdesk/refunds/${dup.id}`, { bankTransactionCode: "FT3" }).expect(409);
  assert.equal((await Refund.findById(dup.id)).status, "requested");
});

test("UC11: the receptionist splits the balance over cash, POS and transfer until it is 0", async () => {
  const booking = await paidBooking({ status: "checked_in" });
  const url = `/api/frontdesk/bookings/${booking.id}/payments`;
  await send(customer, "post", url, { method: "cash" }).expect(403);
  await send(customer, "post", `/api/bookings/${booking.id}/payments/final`, { method: "bank_transfer", amount: 100 }).expect(404);
  await send(staff, "post", url, { method: "cash", amount: 1401 }).expect(400);
  await send(staff, "post", url, { method: "pos", amount: 400 }).expect(400); // slip reference required
  assert.equal((await send(staff, "post", url, { method: "cash", amount: 400 }).expect(201)).body.data.remaining, 1000);
  assert.equal((await send(staff, "post", url, { method: "pos", amount: 600, transactionRef: "POS-778" }).expect(201)).body.data.remaining, 400);
  const last = (await send(staff, "post", url, { method: "bank_transfer", transactionRef: "FT-99" }).expect(201)).body.data;
  assert.deepEqual([last.amount, last.remaining], [400, 0]);
  await send(staff, "post", url, { method: "cash" }).expect(409);
  assert.equal(await AuditLog.countDocuments({ action: "payment.recorded", "detail.bookingId": booking._id }), 3);
});

test("UC10: a deposit already pending at the gateway when the hold ends still confirms within 15 more minutes", async () => {
  const booking = await payBooking();
  const o = (await send(customer, "post", `/api/bookings/${booking.id}/payments/deposit`, { method: "bank_transfer" }).expect(201)).body.data;
  await Payment.collection.updateOne({ _id: new mongoose.Types.ObjectId(o.paymentId) }, { $set: { createdAt: new Date(Date.now() - 10 * 60000) } });
  await Booking.updateOne({ _id: booking._id }, { holdExpiresAt: new Date(Date.now() - 5 * 60000) });
  await hook(callbackBody(o.orderId, "success", 600)).expect(200);
  assert.equal((await Booking.findById(booking.id)).status, "confirmed");
  assert.equal(await Refund.exists({ bookingId: booking._id }), null);
});

test("T17: the daily reconciliation settles SePay orders whose IPN never arrived", async () => {
  const { reconcileDaily } = require("../src/services/payments");
  assert.deepEqual(await reconcileDaily(new Date()), { checked: 0, settled: 0 }); // sandbox: nothing to ask
  await withSepay(async () => {
    const booking = await payBooking();
    const o = await sepayDeposit(booking);
    // Every order is captured, each with its own transaction id.
    global.fetch = async (url) => ({ ok: true, status: 200, json: async () => ({ data: { order_status: "CAPTURED", order_amount: "600.00", transactions: [{ transaction_id: `TX-${url.split("/").pop()}` }] } }) });
    const first = await reconcileDaily(new Date());
    assert.ok(first.checked >= 1 && first.settled >= 1, JSON.stringify(first));
    assert.equal((await Payment.findById(o.paymentId)).status, "success");
    assert.equal((await Booking.findById(booking.id)).status, "confirmed");
    assert.equal((await reconcileDaily(new Date())).settled, 0);
  });
});

// Runs last: it changes the customer password, which ends the shared customer session.
// ---- SRS v2.5 / SDS v5 (08/11/2026) business rules ----
const vnDay = (offset = 0) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Ho_Chi_Minh" }).format(new Date(Date.now() + offset * 864e5));
const vnAt = (day, time) => new Date(`${day}T${time}:00+07:00`);
async function srsUser(username, role) {
  await User.create({ username, email: `${username}@example.com`, passwordHash: await hashPassword(password), roleId: await roleId(role), phone: "0912345678", customerProfile: { fullName: username }, isVerified: true });
  return login(`${username}@example.com`);
}
async function srsRooms(prefix, prices) {
  const RoomType = require("../src/models/RoomType");
  const Room = require("../src/models/Room");
  const types = {};
  for (const [name, price] of Object.entries(prices)) {
    types[name] = await RoomType.create({ name: `${prefix} ${name}`, basePrice: price, maxOccupancy: 2 });
    types[name].rooms = await Room.create([1, 2].map((i) => ({ roomNumber: `${prefix}-${name}-${i}`, roomTypeId: types[name]._id, floor: 9 })));
  }
  return types;
}
const srsBooking = (customerId, type, extra) => Booking.create({
  customerId, createdBy: customerId, rooms: [{ roomTypeId: type._id, roomId: type.rooms[0]._id, priceAtBooking: type.basePrice, guestCount: 1 }],
  policySnapshot: { depositValue: 30, cancellationTiers: tiers([48, 100], [0, 0]) }, bookingReference: `SRS-${new mongoose.Types.ObjectId()}`, ...extra,
});

test("SRS v2.5 UC06 / UC07: consent and 3 unpaid bookings (MSG-79); a modification keeps the Confirmed deposit (BR-40) and the full-refund rule (BR-46, MSG-78)", async () => {
  const guest = await srsUser("srs25guest", "customer");
  const me = await User.findOne({ username: "srs25guest" });
  const { Std } = await srsRooms("M25", { Std: 1000 });
  for (let i = 0; i < 3; i++) await srsBooking(me._id, Std, { checkInDate: "2027-09-01", checkOutDate: "2027-09-02", roomAmount: 1000, totalAmount: 1000, status: "pending", holdExpiresAt: new Date(Date.now() + 600000) });
  const create = { roomTypeId: Std.id, checkInDate: "2027-09-20", checkOutDate: "2027-09-22", guestCount: 1, consent: true };
  assert.match((await send(guest, "post", "/api/bookings", create).expect(409)).body.error.message, /3 unpaid bookings/);
  await Booking.updateMany({ customerId: me._id, status: "pending" }, { status: "expired" });

  // A Confirmed booking with a paid deposit: longer stay at once, the deposit is unchanged, the customer is notified.
  const b = await srsBooking(me._id, Std, { checkInDate: "2027-09-10", checkOutDate: "2027-09-12", roomAmount: 2000, totalAmount: 2000, depositRequired: 1500, status: "confirmed",
    nightlyRates: [{ date: "2027-09-10", roomTypeId: Std._id, price: 1500 }, { date: "2027-09-11", roomTypeId: Std._id, price: 500 }] });
  await Payment.create({ bookingId: b._id, kind: "deposit", amount: 1500, method: "bank_transfer", status: "success", paidAt: new Date() });
  const longer = (await send(guest, "post", `/api/bookings/${b.id}/modify`, { checkOutDate: "2027-09-13" }).expect(200)).body.data;
  assert.deepEqual([longer.totalAmount, longer.depositRequired], [3000, 1500]);
  assert.deepEqual(longer.nightlyRates.map((n) => n.price), [1500, 500, 1000]); // SDS b.10: kept nights keep their own price (BR-35)
  assert.ok(await require("../src/models/Notification").exists({ type: "booking_modified", bookingId: b._id }));
  // The total may not fall below the deposit already paid: cancel instead.
  await send(guest, "post", `/api/bookings/${b.id}/modify`, { checkInDate: "2027-09-12", checkOutDate: "2027-09-13" }).expect(409);
  await send(guest, "post", `/api/bookings/${b.id}/modify`, { idDocumentNo: "123" }).expect(400); // no ID in UC07

  // Within 48 h the cancellation would not be refunded in full, so the dates are locked (MSG-78).
  const soon = await srsBooking(me._id, Std, { checkInDate: vnDay(1), checkOutDate: vnDay(2), roomAmount: 1000, totalAmount: 1000, depositRequired: 300, status: "confirmed" });
  await Payment.create({ bookingId: soon._id, kind: "deposit", amount: 300, method: "bank_transfer", status: "success", paidAt: new Date() });
  assert.match((await send(guest, "post", `/api/bookings/${soon.id}/modify`, { checkOutDate: vnDay(3) }).expect(409)).body.error.message, /can no longer be changed/);

  // A Pending Payment booking cannot change while its payment is at the gateway (BR-40).
  const pending = await srsBooking(me._id, Std, { checkInDate: "2027-09-15", checkOutDate: "2027-09-16", roomAmount: 1000, totalAmount: 1000, depositRequired: 300, status: "pending", holdExpiresAt: new Date(Date.now() + 600000) });
  await Payment.create({ bookingId: pending._id, kind: "deposit", amount: 300, method: "bank_transfer", status: "pending" });
  await send(guest, "post", `/api/bookings/${pending.id}/modify`, { checkOutDate: "2027-09-17" }).expect(409);
});

test("SRS v2.5 UC16 / UC35 1a: the front desk records a request without a bank account and withdraws it at the customer's request", async () => {
  const me = await User.findOne({ username: "srs25guest" });
  const { Std } = await srsRooms("C25", { Std: 1000 });
  const b = await srsBooking(me._id, Std, { checkInDate: "2027-11-10", checkOutDate: "2027-11-12", roomAmount: 2000, totalAmount: 2000, depositRequired: 600, status: "confirmed" });
  await Payment.create({ bookingId: b._id, kind: "deposit", amount: 600, method: "bank_transfer", status: "success", paidAt: new Date() });
  const asked = (await send(staff, "post", `/api/front-desk/bookings/${b.id}/cancel`, { reason: "Change of plans" }).expect(200)).body.data;
  assert.deepEqual([asked.status, asked.refundableAmount], ["cancellation_requested", 600]);
  assert.equal((await Booking.findById(b.id)).cancellation.verifyMethod, "id_document");
  await send(customer, "post", `/api/frontdesk/cancellations/${b.id}/withdraw`).expect(403);
  assert.equal((await send(staff, "post", `/api/frontdesk/cancellations/${b.id}/withdraw`).expect(200)).body.data.status, "confirmed");
  assert.ok(await require("../src/models/AuditLog").exists({ action: "cancellation.withdrawn", targetId: b._id }));
});

test("SRS v2.5 UC20 / BR-47 / BR-22: check-out needs the balance paid and the inspection done or skipped; after 18:00 an extra night is posted", async () => {
  const me = await User.findOne({ username: "srs25guest" });
  const Room = require("../src/models/Room");
  const Task = require("../src/models/CleaningTask");
  const { Std } = await srsRooms("O25", { Std: 1000 });
  await Room.updateOne({ _id: Std.rooms[0]._id }, { status: "occupied" });
  const stay = await srsBooking(me._id, Std, { checkInDate: vnDay(-1), checkOutDate: vnDay(3), roomAmount: 4000, totalAmount: 4000, depositRequired: 1200, status: "checked_in" });
  await Payment.create({ bookingId: stay._id, kind: "deposit", amount: 1200, method: "bank_transfer", status: "success", paidAt: new Date() });
  const bill = (await send(staff, "post", `/api/front-desk/bookings/${stay.id}/check-out/start`).expect(200)).body.data;
  assert.equal(bill.balance, 2800);
  assert.ok(bill.inspection, "an inspection task is requested");
  const url = `/api/front-desk/bookings/${stay.id}/check-out`;
  assert.match((await send(staff, "post", url).expect(409)).body.error.message, /unpaid/); // BR-20
  await send(staff, "post", `/api/frontdesk/bookings/${stay.id}/payments`, { method: "cash" }).expect(201);
  assert.match((await send(staff, "post", url).expect(409)).body.error.message, /inspection/);
  const done = (await send(staff, "post", url, { skipInspection: true }).expect(200)).body;
  assert.equal(done.data.booking.status, "checked_out");
  assert.match(done.data.invoice.invoiceNumber, /^INV-\d{8}-\d{4}$/);
  const nights = done.data.invoice.lines.filter((l) => l.name.startsWith("Night of"));
  assert.deepEqual([nights.length, nights.reduce((sum, l) => sum + l.amount, 0)], [4, 4000]); // room charge of every night (UC11)
  const inspection = await Task.findOne({ bookingId: stay._id, type: "inspection" });
  assert.deepEqual([inspection.status, inspection.notes], ["completed", "Skipped at check-out"]);
  assert.equal((await Room.findById(Std.rooms[0]._id)).status, "cleaning");

  // The guest is still in the room after 18:00 on the check-out date: one extra night instead of the late fee, once.
  await Room.updateOne({ _id: Std.rooms[1]._id }, { status: "occupied" });
  const late = await srsBooking(me._id, Std, { checkInDate: vnDay(-3), checkOutDate: vnDay(-1), roomAmount: 2000, totalAmount: 2000, status: "checked_in" });
  await Booking.updateOne({ _id: late._id }, { "rooms.0.roomId": Std.rooms[1]._id });
  // two parallel calls (a double click, React strict mode) post the charge and the inspection once
  const [lateBill] = (await Promise.all([1, 2].map(() => send(staff, "post", `/api/front-desk/bookings/${late.id}/check-out/start`).expect(200)))).map((r) => r.body.data);
  assert.equal(await require("../src/models/CleaningTask").countDocuments({ bookingId: late._id, type: "inspection" }), 1);
  assert.deepEqual(lateBill.feeLines.map((f) => [f.type, f.amount]), [["extra_night", 1000]]);
  await send(staff, "post", `/api/front-desk/bookings/${late.id}/check-out/start`).expect(200);
  assert.equal((await Booking.findById(late.id)).totalAmount, 3000);
  // Between the standard check-out time and 18:00 the late check-out fee of the policy applies.
  const { lateCharge } = require("../src/controllers/bookingCreation");
  const { currentCancellationPolicy } = require("../src/services/policies");
  const policy = await currentCancellationPolicy();
  const day = vnDay(5);
  const fresh = new Booking({ checkOutDate: day, feeLines: [], feeAmount: 0, totalAmount: 0, rooms: [{ roomTypeId: Std._id, priceAtBooking: 1000 }] });
  const afterStandard = vnAt(day, policy?.checkOutTime || "12:00"); afterStandard.setMinutes(afterStandard.getMinutes() + 30);
  assert.equal((await lateCharge(fresh, afterStandard))?.amount ?? 0, policy?.lateCheckOutFee || 0);
});

test("SRS v2.5 UC18 / BR-38: an upgrade is always charged; a lower-priced room needs nothing better free (MSG-68); before check-in the room type changes", async () => {
  const me = await User.findOne({ username: "srs25guest" });
  const Room = require("../src/models/Room");
  const AuditLog = require("../src/models/AuditLog");
  const t = await srsRooms("R25", { Low: 500, Mid: 1000, High: 2000 });
  await Room.updateOne({ _id: t.Mid.rooms[0]._id }, { status: "occupied" });
  const stay = await srsBooking(me._id, t.Mid, { checkInDate: vnDay(-1), checkOutDate: vnDay(2), roomAmount: 3000, totalAmount: 3000, status: "checked_in" });
  const url = `/api/front-desk/bookings/${stay.id}/change-room`;
  assert.match((await send(staff, "post", url, { newRoomId: t.Low.rooms[0].id }).expect(409)).body.error.message, /lower-priced/);
  const up = (await send(staff, "post", url, { newRoomId: t.High.rooms[0].id }).expect(200)).body;
  assert.equal(up.data.roomAmount, 3000 + 2 * 2000 - 2 * 1000); // the 2 remaining nights at the new rate
  assert.equal((await Room.findById(t.Mid.rooms[0]._id)).status, "cleaning");
  assert.ok(await AuditLog.exists({ action: "booking.room_changed", targetId: stay._id }));

  const ahead = await srsBooking(me._id, t.Mid, { checkInDate: "2027-10-01", checkOutDate: "2027-10-03", roomAmount: 2000, totalAmount: 2000, depositRequired: 600, status: "confirmed" });
  const types = (await staff.get(`/api/front-desk/bookings/${ahead.id}/change-room-options`).expect(200)).body;
  assert.equal(types.meta.mode, "room_type");
  const moved = (await send(staff, "post", `/api/front-desk/bookings/${ahead.id}/change-room`, { newRoomTypeId: t.High.id }).expect(200)).body.data;
  assert.deepEqual([moved.roomAmount, moved.depositRequired, String(moved.rooms[0].roomTypeId)], [4000, 600, t.High.id]);
});

test("SRS v2.5 UC30 / UC39 / BR-33: skip rules, auto-approved requests, withdrawal, and the 06:00 no-show cut-off", async () => {
  const guest = await login("srs25guest@example.com");
  const me = await User.findOne({ username: "srs25guest" });
  const Task = require("../src/models/CleaningTask");
  const Notification = require("../src/models/Notification");
  const hk = await srsUser("srs25hk", "housekeeping");
  const hkUser = await User.findOne({ username: "srs25hk" });
  const { Std } = await srsRooms("H25", { Std: 1000 });
  const turnover = await Task.create({ roomId: Std.rooms[0]._id, type: "turnover", status: "assigned", assignedTo: hkUser._id });
  await send(hk, "patch", `/api/housekeeping/tasks/${turnover.id}/status`, { status: "skipped", reason: "Guest asleep" }).expect(409);
  const routine = await Task.create({ roomId: Std.rooms[0]._id, type: "routine", status: "assigned", assignedTo: hkUser._id });
  await send(hk, "patch", `/api/housekeeping/tasks/${routine.id}/status`, { status: "skipped" }).expect(400); // reason required
  await send(hk, "patch", `/api/housekeeping/tasks/${routine.id}/status`, { status: "completed" }).expect(409); // MSG-49
  assert.equal((await send(hk, "patch", `/api/housekeeping/tasks/${routine.id}/status`, { status: "skipped", reason: "Do not disturb" }).expect(200)).body.data.skipReason, "Do not disturb");

  const day = "2027-12-01";
  const b = await srsBooking(me._id, Std, { checkInDate: day, checkOutDate: "2027-12-02", roomAmount: 1000, totalAmount: 1000, status: "confirmed" });
  const reqUrl = `/api/bookings/${b.id}/requests`;
  const guestData = { type: "check_in", numberOfGuests: 1, mainGuestName: "Srs Guest", mainGuestIdNumber: "079123456789" };
  const normal = (await send(guest, "post", reqUrl, { ...guestData, requestedTime: vnAt(day, "20:00").toISOString() }).expect(201)).body.data;
  assert.equal(normal.status, "approved"); // BR-44: no early check-in, approved at once
  await send(guest, "post", reqUrl, { ...guestData, requestedTime: vnAt(day, "08:00").toISOString() }).expect(409); // one open request
  await send(guest, "delete", `${reqUrl}/${normal._id}`).expect(200);
  const early = (await send(guest, "post", reqUrl, { ...guestData, requestedTime: vnAt(day, "08:00").toISOString() }).expect(201)).body.data;
  assert.equal(early.status, "pending");
  await send(staff, "patch", `/api/frontdesk/requests/${early._id}`, { action: "reject" }).expect(400); // a reason is required
  await send(staff, "patch", `/api/frontdesk/requests/${early._id}`, { action: "reject", responseNote: "No room ready that early" }).expect(200);
  assert.ok(await Notification.exists({ type: "stay_request_decided", bookingId: b._id }));

  // BR-33: last night's arrival keeps the room until 06:00.
  const { processNoShows } = require("../src/services/noShows");
  const arrival = await srsBooking(me._id, Std, { checkInDate: vnDay(-1), checkOutDate: vnDay(1), roomAmount: 2000, totalAmount: 2000, status: "confirmed" });
  await processNoShows(vnAt(vnDay(0), "05:00"));
  assert.equal((await Booking.findById(arrival.id)).status, "confirmed");
  await processNoShows(vnAt(vnDay(0), "06:30"));
  assert.equal((await Booking.findById(arrival.id)).status, "no_show");
});

test("forgot password generates token, rejects invalid/expired token, resets password and updates authVersion", async () => {
  await send(request(app), "post", "/api/auth/forgot-password", {
    email: "nonexistent@example.com",
  }).expect(200);

  const { setTransport } = require("../src/services/notifications");
  const mails = [];
  setTransport({ sendMail: async (m) => mails.push(m) });
  const res = await send(request(app), "post", "/api/auth/forgot-password", {
    email: "customer@example.com",
  }).expect(200);
  setTransport(null);
  // The token must travel only inside the e-mailed link, never in the response.
  assert.equal(res.body.data.resetToken, undefined);
  assert.equal(mails.length, 1);
  const token = mails[0].text.match(/#\/reset-password\?token=([0-9a-f]{64})&email=/)?.[1];
  assert.ok(token);

  await send(request(app), "post", "/api/auth/reset-password", {
    email: "customer@example.com",
    token: "WRONGTOKEN",
    newPassword: "BrandNewPass123!",
  }).expect(400);

  await send(request(app), "post", "/api/auth/reset-password", {
    email: "customer@example.com",
    token,
    newPassword: "BrandNewPass123!",
    confirmPassword: "DifferentPass123!",
  }).expect(400);

  await send(request(app), "post", "/api/auth/reset-password", {
    email: "customer@example.com",
    token,
    newPassword: "BrandNewPass123!",
    confirmPassword: "BrandNewPass123!",
  }).expect(200);

  await send(request(app), "post", "/api/auth/reset-password", {
    email: "customer@example.com",
    token,
    newPassword: "AnotherPass123!",
  }).expect(400);

  await send(request(app), "post", "/api/auth/login", {
    email: "customer@example.com",
    password,
  }).expect(401);

  await send(request(app), "post", "/api/auth/login", {
    email: "customer@example.com",
    password: "BrandNewPass123!",
  }).expect(200);
});

test("EmailJS adapter posts the generic template and reports a rejected send", async () => {
  const emailjs = require("../src/services/emailjs");
  const keys = ["EMAILJS_SERVICE_ID", "EMAILJS_TEMPLATE_ID", "EMAILJS_PUBLIC_KEY", "EMAILJS_PRIVATE_KEY"];
  const saved = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  const realFetch = global.fetch;
  try {
    assert.equal(emailjs.enabled(), false);
    Object.assign(process.env, { EMAILJS_SERVICE_ID: "svc", EMAILJS_TEMPLATE_ID: "tpl", EMAILJS_PUBLIC_KEY: "pub", EMAILJS_PRIVATE_KEY: "priv" });
    assert.equal(emailjs.enabled(), true);
    let body;
    global.fetch = async (url, opts) => { body = JSON.parse(opts.body); return { ok: true }; };
    await emailjs.sendMail({ to: "a@b.c", subject: "Hi", text: "x <y>\nz" });
    assert.deepEqual([body.service_id, body.template_id, body.user_id, body.accessToken], ["svc", "tpl", "pub", "priv"]);
    assert.deepEqual(body.template_params, { to_email: "a@b.c", subject: "Hi", message: "x <y>\nz", html: "x &lt;y&gt;<br>z" });
    global.fetch = async () => ({ ok: false, status: 403, text: async () => "forbidden" });
    await assert.rejects(emailjs.sendMail({ to: "a@b.c", subject: "Hi" }), /EmailJS 403: forbidden/);
  } finally {
    global.fetch = realFetch;
    for (const k of keys) saved[k] === undefined ? delete process.env[k] : (process.env[k] = saved[k]);
  }
});

test("room holding: a pending cancellation keeps its room (BR-36), an expired hold frees it without the job (BR-29), two guests cannot take the last room (CR-16)", async () => {
  const RoomType = require("../src/models/RoomType");
  const Room = require("../src/models/Room");
  const a = await srsUser("holdguest1", "customer"), b = await srsUser("holdguest2", "customer");
  const me = await User.findOne({ username: "holdguest1" });
  const type = await RoomType.create({ name: "Hold Single", basePrice: 1000, maxOccupancy: 2 });
  type.rooms = [await Room.create({ roomNumber: "HOLD-1", roomTypeId: type._id, floor: 9 })];
  const stay = { roomTypeId: type.id, checkInDate: "2028-01-10", checkOutDate: "2028-01-12", guestCount: 1, consent: true };
  const offered = async () => (await request(app).get("/api/public/availability?checkIn=2028-01-10&checkOut=2028-01-12&guests=1").expect(200)).body.data.find((t) => t._id === type.id);
  const held = await srsBooking(me._id, type, { checkInDate: "2028-01-10", checkOutDate: "2028-01-12", roomAmount: 2000, totalAmount: 2000, status: "cancellation_requested" });
  await send(b, "post", "/api/bookings", stay).expect(409); // MSG-30: the request may still be withdrawn
  assert.equal(await offered(), undefined);
  // An unpaid hold that ended 5 minutes ago may still be at the gateway; after 15 more minutes it no longer counts, job or not.
  await Booking.updateOne({ _id: held._id }, { status: "pending", holdExpiresAt: new Date(Date.now() - 5 * 60000) });
  await send(b, "post", "/api/bookings", stay).expect(409);
  await Booking.updateOne({ _id: held._id }, { holdExpiresAt: new Date(Date.now() - 16 * 60000) });
  const free = await offered();
  assert.deepEqual([free.roomsLeft, free.nights, free.stayAmount, free.seasonalPricing], [1, 2, 2000, undefined]);
  const both = await Promise.all([send(a, "post", "/api/bookings", stay), send(b, "post", "/api/bookings", stay)]);
  assert.deepEqual(both.map((r) => r.status).sort(), [201, 409]);
  // UC04 input checks; physical rooms are for staff only
  await request(app).get("/api/public/availability?checkIn=2028-01-12&checkOut=2028-01-10").expect(400);
  await request(app).get("/api/rooms/search").expect(401);
  await a.get("/api/rooms/search").expect(403);
  await staff.get("/api/rooms/search").expect(200);
});

test("UC06 quote and UC14 walk-in coupon: the server prices every night, a bad coupon only drops the discount", async () => {
  const RoomType = require("../src/models/RoomType");
  const guest = await srsUser("quoteguest", "customer");
  const { Q } = await srsRooms("QT", { Q: 1000 });
  const today = vnDay(), tomorrow = vnDay(1), after = vnDay(2);
  await RoomType.updateOne({ _id: Q._id }, { seasonalPricing: [{ startDate: tomorrow, endDate: tomorrow, price: 3000 }] });
  await Coupon.create({ code: "QUOTE10", discountType: "percentage", discountValue: 10, usageLimit: 5, minimumSpend: 0, startDate: new Date(Date.now() - 864e5), endDate: new Date(Date.now() + 30 * 864e5), isActive: true });
  const ask = (agent, couponCode) => send(agent, "post", "/api/bookings/quote", { roomTypeId: Q.id, checkInDate: today, checkOutDate: after, couponCode });
  const q = (await ask(guest, "QUOTE10").expect(200)).body.data;
  assert.deepEqual([q.roomAmount, q.discountAmount, q.totalAmount, q.depositPercent, q.depositRequired, q.available], [4000, 400, 3600, 50, 1800, true]);
  assert.deepEqual(q.nights.map((n) => n.price), [1000, 3000]);
  const bad = (await ask(guest, "NOPE").expect(200)).body.data;
  assert.match(bad.couponError, /invalid/);
  assert.deepEqual([bad.discountAmount, bad.totalAmount], [0, 4000]);
  assert.equal((await ask(staff, "QUOTE10").expect(200)).body.data.depositRequired, 0); // walk-in: no deposit
  await request(app).post("/api/bookings/quote").set("Origin", origin).send({}).expect(401);
  // UC14 step 3: the walk-in booking takes the coupon and counts one use; cancelling gives the use back
  const walkIn = { roomTypeId: Q.id, checkInDate: today, checkOutDate: after, guestCount: 1, fullName: "Walk In", phone: "0912345678", idDocumentNo: "012345678" };
  await send(staff, "post", "/api/front-desk/bookings", { ...walkIn, couponCode: "NOPE" }).expect(400);
  const made = (await send(staff, "post", "/api/front-desk/bookings", { ...walkIn, couponCode: "quote10" }).expect(201)).body.data;
  assert.deepEqual([made.couponCode, made.discountAmount, made.totalAmount], ["QUOTE10", 400, 3600]);
  assert.equal((await Coupon.findOne({ code: "QUOTE10" })).usageCount, 1);
  await send(staff, "post", `/api/front-desk/bookings/${made._id}/cancel`, { reason: "Guest left" }).expect(200);
  assert.equal((await Coupon.findOne({ code: "QUOTE10" })).usageCount, 0);
});

test("front-desk booking list: overdue check-in and check-out views, keyword on code, name or phone, pages", async () => {
  const me = await User.findOne({ username: "quoteguest" });
  const { V } = await srsRooms("VW", { V: 1000 });
  const mk = (guestName, extra) => srsBooking(me._id, V, { guestName, guestPhone: "0977000111", roomAmount: 1000, totalAmount: 1000, ...extra });
  const late = await mk("Late Arrival", { status: "confirmed", checkInDate: vnDay(-2), checkOutDate: vnDay(1) });
  const due = await mk("Due Today", { status: "confirmed", checkInDate: vnDay(0), checkOutDate: vnDay(1) });
  const over = await mk("Over Stay", { status: "checked_in", checkInDate: vnDay(-3), checkOutDate: vnDay(-1) });
  const inHouse = await mk("In House", { status: "checked_in", checkInDate: vnDay(-1), checkOutDate: vnDay(2) });
  const ids = async (query) => (await staff.get(`/api/bookings/search?limit=100&${query}`).expect(200)).body.data.map((b) => b._id);
  const mine = [late, due, over, inHouse].map((b) => b.id);
  const only = async (query) => (await ids(query)).filter((id) => mine.includes(id));
  assert.deepEqual(await only("view=overdue_check_in"), [late.id]);
  assert.deepEqual(await only("view=overdue_check_out"), [over.id]);
  assert.deepEqual(await only("view=arrivals"), [late.id, due.id]); // oldest check-in first
  assert.deepEqual(await only("view=departures"), [over.id]);
  assert.deepEqual(await only("q=late+arr"), [late.id]);
  assert.equal((await only("q=0977000111")).length, 4);
  assert.deepEqual(await only(`q=${late.bookingReference}`), [late.id]);
  await staff.get("/api/bookings/search?view=bogus").expect(400);
  await staff.get("/api/bookings/search?q=(").expect(200); // a keyword is never a regular expression
  const page = (await staff.get("/api/bookings/search?q=0977000111&limit=3&page=2").expect(200)).body;
  assert.deepEqual([page.data.length, page.meta.total, page.meta.pages], [1, 4, 2]);
});
