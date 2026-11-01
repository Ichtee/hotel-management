const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const request = require("supertest");
const { MongoMemoryReplSet } = require("mongodb-memory-server");
const { createApp } = require("../src/app");
const { seedRoles } = require("../src/services/roles");
const { staffPermissionCatalog } = require("../src/services/staffPermissions");
const { hashPassword, verifyPassword } = require("../src/utils/password");
const User = require("../src/models/User");
const Role = require("../src/models/Role");
const AuditLog = require("../src/models/AuditLog");
const CleaningTask = require("../src/models/CleaningTask");
const Assignment = require("../src/models/HousekeepingAssignment");
const Notification = require("../src/models/Notification");
const origin = "http://localhost:5173";
const password = "TemporaryPass123!";
const newPassword = "PersonalPass456!";
let db, app, store, manager, admin, customer, sequence = 0;
const roles = {};

// Gửi yêu cầu có Origin hợp lệ như trình duyệt.
const send = (agent, method, url, body = {}) => agent[method](url).set("Origin", origin).send(body);

// Đăng nhập bằng phiên riêng để kiểm tra thu hồi phiên.
async function login(email, secret = password) {
  const agent = request.agent(app);
  await send(agent, "post", "/api/auth/login", { email, password: secret }).expect(200);
  return agent;
}

// Tạo dữ liệu nhân viên khác nhau cho từng trường hợp kiểm thử.
function payload(role = "receptionist") {
  const n = ++sequence;
  return { email: `employee${n}@example.com`, fullName: `Employee ${n}`, phone: "0912345678", role, password };
}

// Tạo nhân viên qua API thật và hoàn tất đổi mật khẩu khi cần.
async function employee(role = "receptionist", activatePassword = true) {
  const input = payload(role);
  const result = await send(manager, "post", "/api/staff", input).expect(201);
  const agent = await login(input.email);
  if (activatePassword) await send(agent, "put", "/api/profile/password", { currentPassword: password, newPassword }).expect(200);
  return { id: result.body.data._id, input, agent };
}

// Khởi tạo replica set tạm, không đọc cấu hình database thật.
async function setup() {
  db = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: "wiredTiger" } });
  await mongoose.connect(db.getUri("staff_api_tests"));
  await seedRoles();
  await Promise.all(Object.values(mongoose.models).map((model) => model.init()));
  for (const role of await Role.find()) roles[role.key] = role;
  const passwordHash = await hashPassword(password);
  for (const key of ["manager", "admin", "customer"])
    await User.create({ username: key, email: `${key}@example.com`, roleId: roles[key]._id, passwordHash,
      phone: "0912345678", customerProfile: { fullName: key } });
  ({ app, store } = createApp({ mongoUri: db.getUri("staff_api_tests"), sessionSecret: "temporary-tests-secret-at-least-32-characters" }));
  manager = await login("manager@example.com");
  admin = await login("admin@example.com");
  customer = await login("customer@example.com");
}

// Đóng các tài nguyên chỉ thuộc bộ kiểm thử này.
async function cleanup() {
  await store?.close();
  await mongoose.disconnect();
  await db?.stop();
}
before(setup);
after(cleanup);

test("UC22/UC33 deny non-manager access including custom roles with staff.manage", async () => {
  const staff = await employee();
  const role = await Role.create({ key: "fake_manager", name: "Custom", scope: "hotel", permissions: ["staff.manage", "roles.manage"] });
  await User.create({ username: "fake", email: "fake@example.com", roleId: role._id,
    passwordHash: await hashPassword(password), customerProfile: { fullName: "Fake" } });
  const fake = await login("fake@example.com");
  for (const agent of [admin, customer, staff.agent, fake]) {
    await agent.get("/api/staff").expect(403);
    await agent.get(`/api/staff/${staff.id}`).expect(403);
    await send(agent, "post", "/api/staff", payload()).expect(403);
    await send(agent, "patch", `/api/staff/${staff.id}`, { fullName: "Override" }).expect(403);
    await send(agent, "delete", `/api/staff/${staff.id}`, { reason: "Override" }).expect(403);
    await agent.get("/api/staff/roles").expect(403);
    await send(agent, "patch", `/api/staff/roles/${roles.receptionist.id}/permissions`, { permissions: [] }).expect(403);
  }
  await request(app).get("/api/staff").expect(401);
  await send(admin, "post", "/api/users", { ...payload(), username: "backdoor" }).expect(403);
  await send(admin, "patch", `/api/users/${staff.id}`, { status: "suspended" }).expect(403);
  await send(admin, "patch", `/api/roles/${roles.receptionist.id}`, { permissions: [] }).expect(403);
  await admin.get("/api/users?role=receptionist").expect(403);
  const list = await admin.get("/api/users").expect(200);
  assert.ok(!list.body.data.some((u) => u._id === staff.id));
});

test("UC22 creates staff without username, requires temporary password change and hides credentials", async () => {
  const staff = await employee("housekeeping", false);
  const profile = await staff.agent.get("/api/auth/me").expect(200);
  assert.equal(profile.body.data.mustChangePassword, true);
  const blocked = await staff.agent.get("/api/options").expect(403);
  assert.equal(blocked.body.error.code, "PASSWORD_CHANGE_REQUIRED");
  await send(staff.agent, "patch", "/api/profile", { fullName: "Skip password" }).expect(403);
  await send(staff.agent, "put", "/api/profile/password", { currentPassword: password, newPassword: password }).expect(400);
  const otherSession = await login(staff.input.email);
  await send(staff.agent, "put", "/api/profile/password", { currentPassword: password, newPassword }).expect(200);
  await otherSession.get("/api/auth/me").expect(401);
  await staff.agent.get("/api/options").expect(200);
  assert.equal((await staff.agent.get("/api/auth/me")).body.data.mustChangePassword, false);
  const saved = await User.findById(staff.id).select("+passwordHash");
  assert.ok(await verifyPassword(newPassword, saved.passwordHash));
  const detail = await manager.get(`/api/staff/${staff.id}`).expect(200);
  assert.equal(detail.body.data.role, "housekeeping");
  assert.equal(detail.body.data.passwordHash, undefined);
  assert.equal(detail.body.data.authVersion, undefined);
  assert.equal(detail.body.data.passwordReset, undefined);
  const audit = await AuditLog.findOne({ targetId: staff.id, action: "staff.created" }).lean();
  assert.ok(audit);
  assert.ok(!JSON.stringify(audit).includes(password));
  assert.ok(!JSON.stringify(audit).includes("passwordHash"));
});

test("UC22 validates fields, targets, search and required status reasons without partial writes", async () => {
  const staff = await employee();
  for (const body of [{ status: "suspended" }, { status: "suspended", reason: " " }, { status: "deleted", reason: "Delete" },
    { role: "admin" }, { password: newPassword }, { mustChangePassword: false }, { email: { $ne: null } }, {}])
    await send(manager, "patch", `/api/staff/${staff.id}`, body).expect(400);
  await send(manager, "delete", `/api/staff/${staff.id}`).expect(400);
  const nonstaff = await User.findOne({ email: "customer@example.com" });
  await manager.get(`/api/staff/${nonstaff.id}`).expect(404);
  await send(manager, "patch", `/api/staff/${nonstaff.id}`, { fullName: "Invalid target" }).expect(404);
  await manager.get("/api/staff/not-an-id").expect(400);
  await manager.get("/api/staff?role=admin").expect(400);
  await manager.get("/api/staff?page=0").expect(400);
  const list = await manager.get(`/api/staff?q=${staff.input.email}&role=receptionist&status=active&page=1&limit=1`).expect(200);
  assert.equal(list.body.meta.total, 1);
  assert.equal(list.body.data[0]._id, staff.id);
  assert.equal((await manager.get("/api/staff?q=%24ne")).body.data.length, 0);
  await send(manager, "patch", `/api/staff/${staff.id}`, { status: "suspended", reason: "Contract paused" }).expect(200);
  await staff.agent.get("/api/auth/me").expect(401);
  await send(manager, "patch", `/api/staff/${staff.id}`, { status: "active" }).expect(400);
  await send(manager, "patch", `/api/staff/${staff.id}`, { status: "active", reason: "Return to work" }).expect(200);
  await staff.agent.get("/api/auth/me").expect(401);
  await login(staff.input.email, newPassword);
  const audit = await AuditLog.findOne({ targetId: staff.id, "detail.reason": "Contract paused" });
  assert.equal(audit.detail.before.status, "active");
  assert.equal(audit.detail.after.status, "suspended");
});

// Tạo nhiệm vụ và kế hoạch để kiểm tra tác động của UC22 lên housekeeping.
async function responsibilities(staffId) {
  const managerUser = await User.findOne({ email: "manager@example.com" });
  const roomId = new mongoose.Types.ObjectId();
  const tasks = await CleaningTask.create(["assigned", "pending", "in_progress", "completed"].map((status) => ({
    roomId, assignedTo: staffId, assignedBy: managerUser._id, status,
  })));
  const plan = await Assignment.create({ staffId, shift: "morning", roomIds: [roomId], assignedBy: managerUser._id,
    effectiveFrom: new Date(Date.now() - 86400000), effectiveTo: new Date(Date.now() + 86400000) });
  const past = await Assignment.create({ staffId, shift: "night", floors: [1], assignedBy: managerUser._id,
    effectiveFrom: new Date(Date.now() - 3 * 86400000), effectiveTo: new Date(Date.now() - 2 * 86400000) });
  return { tasks, plan, past };
}

test("UC22 deactivation or role change releases Assigned tasks, preserves In Progress and assignment history", async () => {
  for (const patch of [{ status: "suspended", reason: "On leave" }, { role: "receptionist" }]) {
    const staff = await employee("housekeeping");
    const { tasks, plan, past } = await responsibilities(staff.id);
    const result = await send(manager, "patch", `/api/staff/${staff.id}`, patch).expect(200);
    assert.deepEqual(result.body.meta.responsibility, { pendingTasks: 2, revokedAssignments: 1, inProgressTasks: 1 });
    assert.equal(result.body.meta.notificationStored, true);
    for (const task of tasks.slice(0, 2)) {
      const saved = await CleaningTask.findById(task._id);
      assert.equal(saved.status, "pending");
      assert.equal(saved.assignedTo, undefined);
    }
    for (const task of tasks.slice(2)) {
      const saved = await CleaningTask.findById(task._id);
      assert.equal(saved.status, task.status);
      assert.equal(String(saved.assignedTo), staff.id);
    }
    const savedPlan = await Assignment.findById(plan._id);
    assert.equal(savedPlan.isActive, false);
    assert.ok(savedPlan.revokedAt && savedPlan.revokedBy);
    assert.equal((await Assignment.findById(past._id)).isActive, true);
    assert.ok(await Notification.exists({ type: "staff_responsibility_released", message: { $regex: staff.input.fullName } }));
    await staff.agent.get("/api/auth/me").expect(401);
  }
});

test("UC22 rolls back account, task and assignment changes when audit persistence fails", async (t) => {
  const staff = await employee("housekeeping");
  const { tasks, plan } = await responsibilities(staff.id);
  t.mock.method(AuditLog, "create", async () => { throw new Error("audit failure fixture"); });
  await send(manager, "patch", `/api/staff/${staff.id}`, { status: "suspended", reason: "Rollback fixture" }).expect(500);
  assert.equal((await User.findById(staff.id)).status, "active");
  assert.equal((await CleaningTask.findById(tasks[0]._id)).status, "assigned");
  assert.equal((await Assignment.findById(plan._id)).isActive, true);
  await staff.agent.get("/api/auth/me").expect(200);
});

test("UC22 notification failure does not roll back completed account transaction", async (t) => {
  const staff = await employee("housekeeping");
  t.mock.method(Notification, "insertMany", async () => { throw new Error("notification failure fixture"); });
  const result = await send(manager, "patch", `/api/staff/${staff.id}`, { role: "receptionist" }).expect(200);
  assert.equal(result.body.meta.notificationStored, false);
  assert.equal(String((await User.findById(staff.id)).roleId), roles.receptionist.id);
  assert.ok(await AuditLog.exists({ action: "staff.updated", targetId: staff.id }));
});

test("UC22 concurrent duplicate creation yields one account and one audit entry", async () => {
  const input = payload();
  const results = await Promise.all([send(manager, "post", "/api/staff", input), send(manager, "post", "/api/staff", input)]);
  assert.deepEqual(results.map((r) => r.status).sort(), [201, 409]);
  const user = await User.findOne({ email: input.email });
  assert.equal(await User.countDocuments({ email: input.email }), 1);
  assert.equal(await AuditLog.countDocuments({ targetId: user._id, action: "staff.created" }), 1);
});

test("UC33 exposes only staff roles and rejects privileged, account and malformed permissions", async () => {
  const result = await manager.get("/api/staff/roles").expect(200);
  assert.deepEqual(result.body.data.map((r) => r.key).sort(), ["housekeeping", "receptionist"]);
  assert.equal(result.body.meta.personalAccountAccess, "always_enabled");
  assert.equal(result.body.meta.permissions.length, staffPermissionCatalog.length);
  for (const permissions of [["staff.manage"], ["users.manage"], ["roles.manage"], ["revenue.read"], ["profile.update"], ["auth.login"], ["unknown"], [{ $ne: "" }], "rooms.search", null])
    await send(manager, "patch", `/api/staff/roles/${roles.receptionist.id}/permissions`, { permissions }).expect(403);
  for (const key of ["manager", "admin", "customer"])
    await send(manager, "patch", `/api/staff/roles/${roles[key].id}/permissions`, { permissions: [] }).expect(403);
  await send(manager, "patch", `/api/staff/roles/${roles.receptionist.id}/permissions`, { permissions: [], isActive: false }).expect(400);
  await send(manager, "patch", "/api/staff/roles/not-an-id/permissions", { permissions: [] }).expect(400);
});

test("UC33 revokes all existing staff sessions, preserves personal access and keeps manager session", async () => {
  const staff = await employee();
  const other = await login(staff.input.email, newPassword);
  const secondStaff = await employee();
  const housekeeping = await employee("housekeeping");
  await send(manager, "patch", `/api/staff/roles/${roles.receptionist.id}/permissions`, { permissions: [] }).expect(200);
  for (const agent of [staff.agent, other, secondStaff.agent]) await agent.get("/api/auth/me").expect(401);
  await housekeeping.agent.get("/api/auth/me").expect(200);
  await manager.get("/api/staff").expect(200);
  const fresh = await login(staff.input.email, newPassword);
  assert.deepEqual((await fresh.get("/api/auth/me")).body.data.permissions, []);
  await fresh.get("/api/profile").expect(200);
  await send(fresh, "patch", "/api/profile", { fullName: "Personal access kept" }).expect(200);
  await send(fresh, "put", "/api/profile/password", { currentPassword: newPassword, newPassword: "AnotherPersonal789!" }).expect(200);
  await send(fresh, "post", "/api/auth/logout").expect(200);
  await fresh.get("/api/auth/me").expect(401);
  assert.ok(await AuditLog.exists({ action: "staff_role.permissions_changed", targetId: roles.receptionist._id }));
});

test("UC33 handles concurrent changes without losing revocation versions or audit history", async () => {
  const id = roles.housekeeping.id;
  const before = await Role.findById(id);
  const results = await Promise.all([
    send(manager, "patch", `/api/staff/roles/${id}/permissions`, { permissions: ["rooms.search"] }),
    send(manager, "patch", `/api/staff/roles/${id}/permissions`, { permissions: ["cleaning_tasks.own.read"] }),
  ]);
  assert.deepEqual(results.map((r) => r.status), [200, 200]);
  const saved = await Role.findById(id);
  assert.equal(saved.authVersion, before.authVersion + 2);
  const logs = await AuditLog.find({ targetId: id, action: "staff_role.permissions_changed" }).sort({ createdAt: 1, _id: 1 });
  assert.equal(logs.length, 2);
  assert.deepEqual(logs[1].detail.before, logs[0].detail.after);
  assert.deepEqual(saved.permissions.toObject(), logs[1].detail.after);
  await seedRoles();
  assert.deepEqual((await Role.findById(id)).permissions.toObject(), logs[1].detail.after);
});

test("UC33 audit failure rolls back permission changes and session revocation", async (t) => {
  const staff = await employee("housekeeping");
  const before = await Role.findById(roles.housekeeping.id);
  t.mock.method(AuditLog, "create", async () => { throw new Error("audit failure fixture"); });
  await send(manager, "patch", `/api/staff/roles/${roles.housekeeping.id}/permissions`, { permissions: [] }).expect(500);
  const afterRole = await Role.findById(roles.housekeeping.id);
  assert.deepEqual(afterRole.permissions.toObject(), before.permissions.toObject());
  assert.equal(afterRole.authVersion, before.authVersion);
  await staff.agent.get("/api/auth/me").expect(200);
});

test("UC22 password change racing with deactivation never revives an inactive account", async () => {
  const staff = await employee("housekeeping", false);
  const results = await Promise.all([
    send(staff.agent, "put", "/api/profile/password", { currentPassword: password, newPassword }),
    send(manager, "patch", `/api/staff/${staff.id}`, { status: "suspended", reason: "Contract ended" }),
  ]);
  assert.ok([200, 401, 409].includes(results[0].status));
  assert.equal(results[1].status, 200);
  assert.equal((await User.findById(staff.id)).status, "suspended");
  await staff.agent.get("/api/auth/me").expect(401);
  for (const secret of [password, newPassword])
    await send(request(app), "post", "/api/auth/login", { email: staff.input.email, password: secret }).expect(401);
});
