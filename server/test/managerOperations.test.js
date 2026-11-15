const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const request = require("supertest");
const { MongoMemoryReplSet } = require("mongodb-memory-server");
const { createApp } = require("../src/app");
const { seedRoles } = require("../src/services/roles");
const { hashPassword } = require("../src/utils/password");
const User = require("../src/models/User");
const Role = require("../src/models/Role");
const Room = require("../src/models/Room");
const RoomType = require("../src/models/RoomType");
const RoomIssue = require("../src/models/RoomIssue");
const Booking = require("../src/models/Booking");
const Review = require("../src/models/Review");
const Task = require("../src/models/CleaningTask");
const AuditLog = require("../src/models/AuditLog");
const Assignment = require("../src/models/HousekeepingAssignment");
const { currentShift, shiftWindow } = require("../src/utils/hotelTime");
const { hotelDay } = require("../src/services/roomInventory");
const { runHousekeepingTick, createCleaningTask } = require("../src/services/housekeepingTasks");
const Notification = require("../src/models/Notification");
const origin = "http://localhost:5173";
let db, app, store, manager, admin, customer, actor, housekeeping, n = 0;

// Gửi yêu cầu ghi như trình duyệt có Origin hợp lệ.
const send = (agent, method, path, body = {}) => agent[method](path).set("Origin", origin).send(body);

// Chuẩn bị database replica set riêng và các tài khoản kiểm thử.
async function setup() {
  db = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: "wiredTiger" } });
  await mongoose.connect(db.getUri("manager_operations_tests"));
  await seedRoles();
  await Promise.all(Object.values(mongoose.models).map((m) => m.init()));
  const passwordHash = await hashPassword("ManagerTest123!");
  ({ app, store } = createApp({ mongoUri: db.getUri("manager_operations_tests"), jwtSecret: "temporary-manager-tests-secret-over-32-characters" }));
  const agents = {};
  for (const key of ["manager", "admin", "customer", "housekeeping"]) {
    const role = await Role.findOne({ key });
    const user = await User.create({ username: key, email: `${key}@example.com`, roleId: role._id,
      passwordHash, phone: "0912345678", customerProfile: { fullName: key }, isVerified: true });
    if (key === "manager") actor = user;
    if (key === "housekeeping") housekeeping = user;
    const agent = request.agent(app);
    await send(agent, "post", "/api/auth/login", { email: user.email, password: "ManagerTest123!" }).expect(200);
    agents[key] = agent;
  }
  ({ manager, admin, customer } = agents);
}

// Đóng database tạm sau khi kiểm thử xong.
async function cleanup() {
  await store?.close();
  await mongoose.disconnect();
  await db?.stop();
}
before(setup);
after(cleanup);

// Tạo loại phòng qua API để dùng trong từng ca kiểm thử.
async function makeType() {
  return (await send(manager, "post", "/api/room-types", { name: `Type ${++n}`, basePrice: 500000, maxOccupancy: 2 }).expect(201)).body.data;
}

// Tạo phòng qua API quản lý, số phòng không trùng nhau.
async function makeRoom(typeId, extra = {}) {
  return (await send(manager, "post", "/api/rooms", { roomNumber: `R${++n}`, roomTypeId: typeId, floor: 1, ...extra }).expect(201)).body.data;
}

// Tạo booking giả lập để kiểm tra tồn phòng, không chạy luồng thanh toán.
async function makeBooking(typeId, extra = {}) {
  return Booking.create({ customerId: actor._id, createdBy: actor._id, bookingReference: `BK${++n}`,
    checkInDate: "2090-01-01", checkOutDate: "2090-01-03", status: "confirmed",
    rooms: [{ roomTypeId: typeId, priceAtBooking: 500000 }], roomAmount: 1000000, totalAmount: 1000000, ...extra });
}

test("UC23/UC24 protect manager routes and reject invalid room type input", async () => {
  for (const agent of [admin, customer]) {
    await agent.get("/api/rooms").expect(403);
    await agent.get("/api/room-types").expect(403);
    await send(agent, "post", "/api/room-types", { name: "No access", basePrice: 1, maxOccupancy: 1 }).expect(403);
  }
  await request(app).get("/api/rooms").expect(401);
  for (const extra of [{ basePrice: 0 }, { maxOccupancy: 1.5 }, { images: ["javascript:alert(1)"] }, { name: { $ne: null } }, { seasonalPricing: [] }])
    await send(manager, "post", "/api/room-types", { name: "Invalid", basePrice: 1000, maxOccupancy: 2, ...extra }).expect(400);
  const type = await makeType();
  await send(manager, "post", "/api/room-types", { name: type.name, basePrice: 1, maxOccupancy: 1 }).expect(409);
  await send(manager, "post", "/api/rooms", { roomNumber: "Invalid", roomTypeId: type._id, status: "occupied" }).expect(400);
  const room = await makeRoom(type._id);
  const duplicate = await send(manager, "post", "/api/rooms", { roomNumber: room.roomNumber, roomTypeId: type._id }).expect(409);
  assert.equal(duplicate.body.error.code, "MSG-20");
});

test("UC24 preserves linked rooms and booking snapshots while changing price or deactivating type", async () => {
  const type = await makeType();
  const room = await makeRoom(type._id);
  const booking = await makeBooking(type._id);
  await send(manager, "patch", `/api/room-types/${type._id}`, { basePrice: 900000, isActive: false }).expect(200);
  assert.equal((await Room.findById(room._id)).isActive, true);
  assert.equal((await Booking.findById(booking.id)).rooms[0].priceAtBooking, 500000);
  await send(manager, "delete", `/api/room-types/${type._id}`).expect(409);
  await send(manager, "post", "/api/rooms", { roomNumber: "InactiveType", roomTypeId: type._id }).expect(400);
  const unused = await makeType();
  await send(manager, "delete", `/api/room-types/${unused._id}`).expect(200);
  assert.equal(await RoomType.exists({ _id: unused._id }), null);
});

test("UC24 blocks deletion for each independent kind of linked data", async () => {
  for (const kind of ["booking", "review", "rate"]) {
    const type = await makeType();
    if (kind === "booking") await makeBooking(type._id);
    if (kind === "review") await Review.create({ roomTypeId: type._id, customerId: actor._id, bookingId: new mongoose.Types.ObjectId(), rating: 5 });
    if (kind === "rate") await RoomType.updateOne({ _id: type._id }, { $push: { seasonalPricing: { startDate: "2090-01-01", endDate: "2090-01-02", price: 1 } } });
    const result = await send(manager, "delete", `/api/room-types/${type._id}`).expect(409);
    assert.equal(result.body.error.code, "MSG-19");
  }
});

test("UC24 hides reviews from public output and averages, restores visibility and records reason", async () => {
  const type = await makeType();
  const reviews = await Review.create([1, 5].map((rating) => ({ roomTypeId: type._id, customerId: actor._id,
    bookingId: new mongoose.Types.ObjectId(), rating, comment: "Fixture review" })));
  let result = await request(app).get(`/api/public/room-types/${type._id}/reviews`).expect(200);
  assert.equal(result.body.meta.summary.averageRating, 3);
  assert.equal(result.body.data[0].customerId, undefined);
  await send(manager, "patch", `/api/reviews/${reviews[0].id}/visibility`, { hidden: true }).expect(400);
  await send(manager, "patch", `/api/reviews/${reviews[0].id}/visibility`, { hidden: true, reason: "Spam" }).expect(200);
  result = await request(app).get(`/api/public/room-types/${type._id}/reviews`).expect(200);
  assert.equal(result.body.data.length, 1);
  assert.equal(result.body.meta.summary.averageRating, 5);
  assert.equal((await manager.get(`/api/room-types/${type._id}/reviews?status=hidden`)).body.data.length, 1);
  assert.ok(await AuditLog.exists({ action: "review.visibility_changed", targetId: reviews[0]._id, "detail.after.hiddenReason": "Spam" }));
  await send(manager, "patch", `/api/reviews/${reviews[0].id}/visibility`, { hidden: false }).expect(200);
  assert.equal((await request(app).get(`/api/public/room-types/${type._id}/reviews`)).body.meta.summary.averageRating, 3);
});

test("UC23 capacity check counts overlapping holds and returns only affected booking details", async () => {
  const type = await makeType();
  const room = await makeRoom(type._id);
  await makeRoom(type._id);
  const first = await makeBooking(type._id);
  await makeBooking(type._id, { status: "cancellation_requested" });
  const result = await send(manager, "patch", `/api/rooms/${room._id}/maintenance`, { enabled: true }).expect(409);
  assert.equal(result.body.error.code, "MSG-61");
  assert.equal(result.body.error.details.affectedBookings.length, 2);
  assert.equal(result.body.error.details.affectedBookings[0].customerId, undefined);
  assert.equal((await Room.findById(room._id)).status, "available");
  await Booking.updateOne({ _id: first._id }, { status: "cancelled" });
  await send(manager, "patch", `/api/rooms/${room._id}/maintenance`, { enabled: true }).expect(200);
});

test("UC23 concurrent maintenance cannot consume the same remaining capacity twice", async () => {
  const type = await makeType();
  const rooms = [await makeRoom(type._id), await makeRoom(type._id)];
  await makeBooking(type._id);
  const results = await Promise.all(rooms.map((r) => send(manager, "patch", `/api/rooms/${r._id}/maintenance`, { enabled: true })));
  assert.deepEqual(results.map((r) => r.status).sort(), [200, 409]);
});

test("UC23 permits adjacent stays and ignores expired pending holds", async () => {
  const type = await makeType();
  const room = await makeRoom(type._id);
  await makeRoom(type._id);
  await makeBooking(type._id, { checkOutDate: "2090-01-02" });
  await makeBooking(type._id, { checkInDate: "2090-01-02" });
  await makeBooking(type._id, { status: "pending", holdExpiresAt: new Date(0) });
  await send(manager, "patch", `/api/rooms/${room._id}/maintenance`, { enabled: true }).expect(200);
});

test("UC23 requires resolving all issues and returns to Cleaning while an open task remains", async () => {
  const type = await makeType();
  const room = await makeRoom(type._id);
  await send(manager, "patch", `/api/rooms/${room._id}/maintenance`, { enabled: true }).expect(200);
  const issues = await RoomIssue.create(["Leak", "Broken lock"].map((title) => ({ roomId: room._id, reportedBy: actor._id, title })));
  await Task.create({ roomId: room._id, status: "pending", type: "turnover" });
  await send(manager, "patch", `/api/rooms/${room._id}/maintenance`, { enabled: false }).expect(409);
  await send(manager, "patch", `/api/room-issues/${issues[0].id}/resolve`).expect(200);
  await send(manager, "patch", `/api/rooms/${room._id}/maintenance`, { enabled: false }).expect(409);
  await send(manager, "patch", `/api/room-issues/${issues[1].id}/resolve`).expect(200);
  assert.equal((await Room.findById(room._id)).status, "maintenance");
  const result = await send(manager, "patch", `/api/rooms/${room._id}/maintenance`, { enabled: false }).expect(200);
  assert.equal(result.body.data.status, "cleaning");
  await Room.updateOne({ _id: room._id }, { status: "occupied" });
  await send(manager, "patch", `/api/rooms/${room._id}/maintenance`, { enabled: true }).expect(409);
});

test("UC24 audit failure rolls back moderation and type changes", async (t) => {
  const type = await makeType();
  const review = await Review.create({ roomTypeId: type._id, customerId: actor._id, bookingId: new mongoose.Types.ObjectId(), rating: 4 });
  t.mock.method(AuditLog, "create", async () => { throw new Error("audit failure fixture"); });
  await send(manager, "patch", `/api/room-types/${type._id}`, { isActive: false }).expect(500);
  await send(manager, "patch", `/api/reviews/${review.id}/visibility`, { hidden: true, reason: "Fixture" }).expect(500);
  assert.equal((await RoomType.findById(type._id)).isActive, true);
  assert.equal((await Review.findById(review.id)).status, "visible");
});

test("UC36 shift boundaries use hotel timezone and night belongs to its start date", () => {
  assert.deepEqual(currentShift(new Date("2090-01-02T05:59:59+07:00")), { date: "2090-01-01", shift: "night" });
  assert.equal(currentShift(new Date("2090-01-02T06:00:00+07:00")).shift, "morning");
  assert.equal(currentShift(new Date("2090-01-02T14:00:00+07:00")).shift, "afternoon");
  assert.equal(currentShift(new Date("2090-01-02T22:00:00+07:00")).shift, "night");
  assert.equal(shiftWindow("2090-01-02", "night").end.toISOString(), new Date("2090-01-03T06:00:00+07:00").toISOString());
});

// Tạo thêm nhân viên housekeeping để kiểm tra chuyển người phụ trách.
async function anotherHousekeeper() {
  const role = await Role.findOne({ key: "housekeeping" });
  return User.create({ username: `hk${++n}`, email: `hk${n}@example.com`, roleId: role._id,
    passwordHash: await hashPassword("FixturePass123!"), phone: "0912345678", customerProfile: { fullName: `HK ${n}` } });
}

// Tạo kế hoạch theo ca hiện tại hoặc khoảng ngày chỉ định.
async function makePlan(room, extra = {}) {
  const slot = currentShift();
  return (await send(manager, "post", "/api/housekeeping-assignments", {
    staffId: housekeeping.id, shift: slot.shift, effectiveFrom: slot.date, effectiveTo: slot.date,
    roomIds: [room._id], ...extra,
  }).expect(201)).body.data;
}

test("UC36 protects endpoints, validates staff and room targets, and rejects reversed dates", async () => {
  await admin.get("/api/housekeeping-assignments").expect(403);
  await customer.get("/api/housekeeping-assignments/options").expect(403);
  const type = await makeType();
  const room = await makeRoom(type._id, { floor: 20 });
  const base = { staffId: housekeeping.id, shift: "morning", effectiveFrom: "2091-01-01", effectiveTo: "2091-01-03", roomIds: [room._id] };
  for (const extra of [{ staffId: actor.id }, { effectiveTo: "2090-01-01" }, { roomIds: [] }, { shift: "all_day" },
    { roomIds: [new mongoose.Types.ObjectId().toString()] }, { floors: [999] }])
    await send(manager, "post", "/api/housekeeping-assignments", { ...base, ...extra }).expect(400);
  const result = await manager.get("/api/housekeeping-assignments/options").expect(200);
  assert.ok(result.body.data.staff.some((s) => s._id === housekeeping.id));
  assert.equal(result.body.data.staff[0].passwordHash, undefined);
});

test("UC36 detects floor/room overlap including inclusive end dates under concurrent requests", async () => {
  const type = await makeType();
  const room = await makeRoom(type._id, { floor: 21 });
  const other = await anotherHousekeeper();
  const base = { staffId: housekeeping.id, shift: "night", effectiveFrom: "2091-02-01", effectiveTo: "2091-02-03", floors: [21] };
  const results = await Promise.all([
    send(manager, "post", "/api/housekeeping-assignments", base),
    send(manager, "post", "/api/housekeeping-assignments", { ...base, staffId: other.id, floors: [], roomIds: [room._id], effectiveFrom: "2091-02-03" }),
  ]);
  assert.deepEqual(results.map((r) => r.status).sort(), [201, 409]);
  assert.equal(results.find((r) => r.status === 409).body.error.code, "MSG-72");
  await send(manager, "post", "/api/housekeeping-assignments", { ...base, effectiveFrom: "2091-02-04", effectiveTo: "2091-02-04" }).expect(201);
  await send(manager, "post", "/api/housekeeping-assignments", { ...base, shift: "morning" }).expect(201);
});

test("UC36 assigns Pending tasks, moves Assigned and In Progress tasks on manager changes (BR-41), keeps history", async () => {
  const type = await makeType();
  const room = await makeRoom(type._id, { floor: 22 });
  const pending = await Task.create({ roomId: room._id });
  const inProgress = await Task.create({ roomId: room._id, status: "in_progress", assignedTo: housekeeping._id });
  const plan = await makePlan(room);
  assert.equal(String((await Task.findById(pending.id)).assignedTo), housekeeping.id);
  const other = await anotherHousekeeper();
  await send(manager, "patch", `/api/housekeeping-assignments/${plan._id}`, { staffId: other.id }).expect(200);
  assert.equal(String((await Task.findById(pending.id)).assignedTo), other.id);
  // Đưa nhiệm vụ về chờ rồi giao cho người phụ trách mới.
  const moved = await Task.findById(inProgress.id);
  assert.deepEqual([String(moved.assignedTo), moved.status], [other.id, "assigned"]);
  await send(manager, "delete", `/api/housekeeping-assignments/${plan._id}`).expect(200);
  assert.equal((await Assignment.findById(plan._id)).isActive, false);
  assert.equal((await Task.findById(pending.id)).status, "pending");
  assert.ok(await AuditLog.exists({ action: "housekeeping_assignment.updated", targetId: plan._id, "detail.before.staffId": housekeeping._id }));
  assert.ok(await Notification.exists({ type: "task_without_responsible_staff", roomId: room._id }));
});

test("UC36 floor plans include future rooms and task creation uses current night date", async () => {
  const type = await makeType();
  const room = await makeRoom(type._id, { floor: 23 });
  await makePlan(room, { roomIds: [], floors: [23], shift: "night", effectiveFrom: "2092-01-01", effectiveTo: "2092-01-01" });
  const newRoom = await makeRoom(type._id, { floor: 23 });
  const created = await createCleaningTask({ roomId: newRoom._id, type: "turnover" }, { now: new Date("2092-01-02T02:00:00+07:00") });
  assert.equal(String(created.data.assignedTo), housekeeping.id);
  assert.equal(created.data.assignmentDate, "2092-01-01");
  const nextDay = await createCleaningTask({ roomId: newRoom._id, type: "ad_hoc" }, { now: new Date("2092-01-03T02:00:00+07:00") });
  assert.equal(nextDay.data.status, "pending");
});

test("UC36 shift changes preserve Assigned tasks until the manager changes responsibility", async () => {
  const type = await makeType();
  const room = await makeRoom(type._id, { floor: 24 });
  const other = await anotherHousekeeper();
  await makePlan(room, { shift: "morning", effectiveFrom: "2093-01-01", effectiveTo: "2093-01-01" });
  await makePlan(room, { staffId: other.id, shift: "afternoon", effectiveFrom: "2093-01-01", effectiveTo: "2093-01-01" });
  const created = await createCleaningTask({ roomId: room._id, type: "turnover" }, { now: new Date("2093-01-01T10:00:00+07:00") });
  await runHousekeepingTick(new Date("2093-01-01T14:00:00+07:00"));
  assert.equal(String((await Task.findById(created.data.id)).assignedTo), housekeeping.id);
});

test("UC36 07:00 routine generation is idempotent, excludes checkout today and uses morning assignment", async () => {
  const type = await makeType();
  const room = await makeRoom(type._id, { floor: 25 });
  const checkoutRoom = await makeRoom(type._id, { floor: 25 });
  await Room.updateMany({ _id: { $in: [room._id, checkoutRoom._id] } }, { status: "occupied" });
  await makeBooking(type._id, { status: "checked_in", checkInDate: "2094-01-01", checkOutDate: "2094-01-03",
    rooms: [{ roomTypeId: type._id, roomId: room._id, priceAtBooking: 1 }] });
  await makeBooking(type._id, { status: "checked_in", checkInDate: "2094-01-01", checkOutDate: "2094-01-02",
    rooms: [{ roomTypeId: type._id, roomId: checkoutRoom._id, priceAtBooking: 1 }] });
  await makePlan(room, { roomIds: [], floors: [25], shift: "morning", effectiveFrom: "2094-01-02", effectiveTo: "2094-01-02" });
  const now = new Date("2094-01-02T07:00:00+07:00");
  await Promise.all([runHousekeepingTick(now), runHousekeepingTick(now)]);
  const tasks = await Task.find({ roomId: room._id, type: "routine", routineKey: `2094-01-02:${room._id}` });
  assert.equal(tasks.length, 1);
  assert.equal(tasks[0].checklist.length, 6);
  assert.equal(String(tasks[0].assignedTo), housekeeping.id);
  assert.equal(await Task.countDocuments({ roomId: checkoutRoom._id, type: "routine", routineKey: `2094-01-02:${checkoutRoom._id}` }), 0);
});

test("UC36 concurrent deactivation cannot leave an active plan for an inactive employee", async () => {
  const type = await makeType();
  const room = await makeRoom(type._id, { floor: 26 });
  const other = await anotherHousekeeper();
  const slot = currentShift();
  const results = await Promise.all([
    send(manager, "post", "/api/housekeeping-assignments", { staffId: other.id, roomIds: [room._id], shift: slot.shift, effectiveFrom: slot.date, effectiveTo: slot.date }),
    send(manager, "patch", `/api/staff/${other.id}`, { status: "suspended", reason: "Absent" }),
  ]);
  assert.equal(results[1].status, 200);
  assert.ok([201, 400].includes(results[0].status));
  assert.equal(await Assignment.countDocuments({ staffId: other._id, isActive: true }), 0);
});

test("UC36 audit failure rolls back the plan and task reassignment", async (t) => {
  const type = await makeType();
  const room = await makeRoom(type._id, { floor: 27 });
  const task = await Task.create({ roomId: room._id });
  const slot = currentShift();
  t.mock.method(AuditLog, "create", async () => { throw new Error("audit failure fixture"); });
  await send(manager, "post", "/api/housekeeping-assignments", { staffId: housekeeping.id, roomIds: [room._id],
    shift: slot.shift, effectiveFrom: slot.date, effectiveTo: slot.date }).expect(500);
  assert.equal(await Assignment.countDocuments({ roomIds: room._id }), 0);
  assert.equal((await Task.findById(task.id)).status, "pending");
});

test("UC36 notification failure preserves the saved plan and assigned tasks", async (t) => {
  const type = await makeType();
  const room = await makeRoom(type._id, { floor: 28 });
  const task = await Task.create({ roomId: room._id });
  t.mock.method(Notification, "insertMany", async () => { throw new Error("notification fixture"); });
  const slot = currentShift();
  const result = await send(manager, "post", "/api/housekeeping-assignments", {
    staffId: housekeeping.id, roomIds: [room._id], shift: slot.shift, effectiveFrom: slot.date, effectiveTo: slot.date,
  }).expect(201);
  assert.equal(result.body.meta.notificationStored, false);
  assert.equal((await Task.findById(task.id)).status, "assigned");
  assert.ok(await Assignment.exists({ _id: result.body.data._id, isActive: true }));
});

test("UC23 deactivation and reactivation preserve room history and enforce capacity/state", async () => {
  const type = await makeType();
  const room = await makeRoom(type._id, { floor: 29 });
  const booking = await makeBooking(type._id);
  await send(manager, "patch", `/api/rooms/${room._id}`, { isActive: false }).expect(409);
  await Booking.updateOne({ _id: booking._id }, { status: "checked_out" });
  await send(manager, "patch", `/api/rooms/${room._id}`, { isActive: false }).expect(200);
  assert.ok(await Room.exists({ _id: room._id, isActive: false }));
  await send(manager, "patch", `/api/rooms/${room._id}`, { isActive: true }).expect(200);
  await Room.updateOne({ _id: room._id }, { status: "cleaning" });
  await send(manager, "patch", `/api/rooms/${room._id}`, { isActive: false }).expect(409);
  await send(manager, "patch", `/api/rooms/${room._id}`, { status: "available" }).expect(400);
});

test("UC23 type change validates source capacity, active target, physical holds and room state", async () => {
  const oldType = await makeType(), newType = await makeType();
  const room = await makeRoom(oldType._id, { floor: 30 });
  const booking = await makeBooking(oldType._id);
  await send(manager, "patch", `/api/rooms/${room._id}`, { roomTypeId: newType._id }).expect(409);
  await makeRoom(oldType._id, { floor: 30 });
  await Booking.updateOne({ _id: booking._id }, { "rooms.0.roomId": room._id });
  await send(manager, "patch", `/api/rooms/${room._id}`, { roomTypeId: newType._id }).expect(409);
  await Booking.updateOne({ _id: booking._id }, { status: "checked_out" });
  await Room.updateOne({ _id: room._id }, { status: "occupied" });
  await send(manager, "patch", `/api/rooms/${room._id}`, { roomTypeId: newType._id }).expect(409);
  await Room.updateOne({ _id: room._id }, { status: "available" });
  await RoomType.updateOne({ _id: newType._id }, { isActive: false });
  await send(manager, "patch", `/api/rooms/${room._id}`, { roomTypeId: newType._id }).expect(400);
  await RoomType.updateOne({ _id: newType._id }, { isActive: true });
  await send(manager, "patch", `/api/rooms/${room._id}`, { roomTypeId: newType._id }).expect(200);
  assert.equal(String((await Booking.findById(booking.id)).rooms[0].roomTypeId), oldType._id);
});

test("UC23/UC36 floor moves reject overlapping responsibility and safely transfer open tasks", async () => {
  const type = await makeType();
  const room = await makeRoom(type._id, { floor: 31 });
  const floorRoom = await makeRoom(type._id, { floor: 32 });
  const plan = await makePlan(room);
  const other = await anotherHousekeeper();
  await makePlan(floorRoom, { staffId: other.id, roomIds: [], floors: [32] });
  await send(manager, "patch", `/api/rooms/${room._id}`, { floor: 32 }).expect(409);
  assert.equal((await Room.findById(room._id)).floor, 31);
  await send(manager, "delete", `/api/housekeeping-assignments/${plan._id}`).expect(200);
  const task = await Task.create({ roomId: room._id, status: "assigned", assignedTo: housekeeping._id });
  const started = await Task.create({ roomId: room._id, status: "in_progress", assignedTo: housekeeping._id });
  await send(manager, "patch", `/api/rooms/${room._id}`, { floor: 32 }).expect(200);
  assert.equal(String((await Task.findById(task.id)).assignedTo), other.id);
  // Nhiệm vụ đang làm cũng phải chuyển người phụ trách.
  assert.equal(String((await Task.findById(started.id)).assignedTo), other.id);
});

test("UC23 room creation racing with type deletion cannot produce an orphan room", async () => {
  const type = await makeType();
  const number = `Race${++n}`;
  const results = await Promise.all([
    send(manager, "post", "/api/rooms", { roomTypeId: type._id, roomNumber: number, floor: 33 }),
    send(manager, "delete", `/api/room-types/${type._id}`),
  ]);
  assert.ok((results[0].status === 201 && results[1].status === 409) || (results[0].status === 400 && results[1].status === 200));
  const room = await Room.findOne({ roomNumber: number });
  if (room) assert.ok(await RoomType.exists({ _id: room.roomTypeId }));
});
