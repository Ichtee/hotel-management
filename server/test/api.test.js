const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const { MongoMemoryServer } = require("mongodb-memory-server");
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
  db = await MongoMemoryServer.create();
  await mongoose.connect(db.getUri());
  const { bootstrap } = require("../scripts/setup");
  await bootstrap({ ADMIN_USERNAME: "admin", ADMIN_EMAIL: "admin@example.com", ADMIN_NAME: "Administrator", ADMIN_PASSWORD: password });
  await seedRoles();
  await Promise.all([User.init(), Coupon.init(), CouponUsage.init()]);
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
    });
  }
  ({ app, store } = createApp({
    mongoUri: db.getUri(),
    sessionSecret: "integration-test-secret-more-than-32-characters",
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
    await send(manager, "delete", `/api/staff/${employee.id}`).expect(200);
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
    username: "newguest",
    email: "new@example.com",
    fullName: "New Guest",
    password,
    role: "admin",
  }).expect(400);
  const result = await send(request(app), "post", "/api/auth/register", {
    username: "newguest",
    email: "NEW@example.com",
    fullName: "New Guest",
    password,
  }).expect(201);
  assert.equal(result.body.data.role, "customer");
  assert.equal(result.body.data.passwordHash, undefined);
  const saved = await User.findOne({ username: "newguest" }).select(
    "+passwordHash",
  );
  assert.notEqual(saved.passwordHash, password);
  await send(request(app), "post", "/api/auth/register", {
    username: "different",
    email: "new@example.com",
    fullName: "New Guest",
    password,
  }).expect(409);
  await send(request(app), "post", "/api/auth/register", {
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
});
test("profile updates only self and password change revokes other sessions", async () => {
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
    username: "spaced",
    email: "spaced@example.com",
    fullName: "Spaced Password",
    password: spaced,
  }).expect(201);
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
test("role administration validates privilege scope, protects admin and applies changed permissions immediately", async () => {
  await manager.get("/api/roles").expect(403);
  await send(admin, "post", "/api/roles", {
    key: "auditor",
    name: "Revenue auditor",
    scope: "hotel",
    permissions: ["revenue.read"],
  }).expect(201);
  await send(admin, "post", "/api/roles", {
    key: "badrole",
    name: "Bad role",
    scope: "hotel",
    permissions: ["users.manage"],
  }).expect(400);
  const r = await Role.findOne({ key: "admin" });
  await send(admin, "patch", `/api/roles/${r.id}`, { permissions: [] }).expect(
    409,
  );
  const managerRole = await Role.findOne({ key: "manager" });
  await send(admin, "patch", `/api/roles/${managerRole.id}`, {
    permissions: ["staff.manage", "promotions.manage"],
  }).expect(200);
  await manager
    .get("/api/reports/revenue?from=2026-01-01&to=2026-01-31")
    .expect(403);
  await send(admin, "patch", `/api/roles/${managerRole.id}`, {
    permissions: ["staff.manage", "promotions.manage", "revenue.read", "policies.manage"],
  }).expect(200);
  await send(admin, "delete", `/api/roles/${managerRole.id}`).expect(409);
  const custom = await Role.findOne({ key: "auditor" });
  await send(admin, "delete", `/api/roles/${custom.id}`).expect(200);
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
  await send(manager, "delete", `/api/staff/${id}`).expect(200);
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
  const deposit = await Payment.create({ bookingId: mineBooking.id, kind: "deposit", amount: 600, method: "e_wallet", status: "success" });
  await Payment.create({ bookingId: mineBooking.id, kind: "final", amount: 1400, method: "cash", status: "failed" });
  await Refund.create({ bookingId: cancelled.id, paymentId: deposit.id, amount: 300, status: "completed" });

  const list = await customer.get("/api/bookings").expect(200);
  const ids = list.body.data.map((b) => b._id);
  assert.ok(ids.includes(mineBooking.id) && ids.includes(cancelled.id));
  assert.ok(!ids.includes(foreign.id));
  const row = list.body.data.find((b) => b._id === mineBooking.id);
  assert.equal(row.paymentStatus, "partial");
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
