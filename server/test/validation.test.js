// Kiểm tra từng trường đầu vào; mỗi dòng gồm dữ liệu gửi và mã HTTP mong đợi.
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
let db, app, store, manager, customer;
const send = (agent, method, url, body = {}) => agent[method](url).set("Origin", origin).send(body);
async function login(email) {
  const agent = request.agent(app);
  await send(agent, "post", "/api/auth/login", { email, password }).expect(200);
  return agent;
}
// Chạy mọi trường hợp rồi báo lỗi cùng lúc để thấy toàn bộ trường chưa đạt.
async function check(label, cases, call) {
  const wrong = [];
  for (const [name, input, want] of cases) {
    const res = await call(input);
    if (res.status !== want) wrong.push(`${name}: expected ${want}, got ${res.status} ${JSON.stringify(res.body.message || res.body.error?.message || "").slice(0, 80)}`);
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
  for (const [username, role] of [["manager", "manager"], ["customer", "customer"]]) {
    await User.create({ username, email: `${username}@example.com`, passwordHash, roleId: (await Role.findOne({ key: role }))._id, phone: "0912345678", customerProfile: { fullName: username }, isVerified: true });
  }
  ({ app, store } = createApp({ mongoUri: db.getUri(), jwtSecret: "integration-test-secret-more-than-32-characters", clientOrigin: origin }));
  manager = await login("manager@example.com");
  customer = await login("customer@example.com");
});
after(async () => {
  await store?.close();
  await mongoose.disconnect();
  await db?.stop();
});

const reg = (over = {}) => ({ fullName: "Nguyen Van A", username: "newuser", email: "new@example.com", phone: "0912345678", password: "Abcdefg1", confirmPassword: "Abcdefg1", consent: true, ...over });

test("register: CR-12 password, CR-04 email and phone, BR-24 name, CR-21 consent", async () => {
  let n = 0;
  const unique = (o) => reg({ username: `u${++n}x`, email: `u${n}@example.com`, ...o });
  await check("register", [
    // Mật khẩu ít nhất tám ký tự, có chữ hoa, chữ thường và chữ số.
    ["password 8 chars Abcdefg1 is valid", unique({ password: "Abcdefg1", confirmPassword: "Abcdefg1" }), 201],
    ["password 7 chars", unique({ password: "Abcdef1", confirmPassword: "Abcdef1" }), 400],
    ["no upper-case", unique({ password: "abcdefg1", confirmPassword: "abcdefg1" }), 400],
    ["no lower-case", unique({ password: "ABCDEFG1", confirmPassword: "ABCDEFG1" }), 400],
    ["no digit", unique({ password: "Abcdefgh", confirmPassword: "Abcdefgh" }), 400],
    ["only digits", unique({ password: "12345678", confirmPassword: "12345678" }), 400],
    ["password with spaces is allowed", unique({ password: "Abc defg 1", confirmPassword: "Abc defg 1" }), 201],
    ["password not a string", unique({ password: 12345678, confirmPassword: 12345678 }), 400],
    ["confirm does not match", unique({ confirmPassword: "Abcdefg2" }), 400],
    ["password over 128", unique({ password: "Aa1" + "x".repeat(130), confirmPassword: "Aa1" + "x".repeat(130) }), 400],
    // Họ tên từ hai đến 50 ký tự sau khi bỏ khoảng trắng thừa.
    ["name 1 char", unique({ fullName: "A" }), 400],
    ["name 2 chars", unique({ fullName: "An" }), 201],
    ["name 50 chars", unique({ fullName: "a".repeat(50) }), 201],
    ["name 51 chars", unique({ fullName: "a".repeat(51) }), 400],
    ["name only spaces", unique({ fullName: "     " }), 400],
    ["name missing", unique({ fullName: undefined }), 400],
    // Kiểm tra định dạng email.
    ["email without @", unique({ email: "plainaddress" }), 400],
    ["email without domain dot", unique({ email: "a@b" }), 400],
    ["email with space", unique({ email: "a b@example.com" }), 400],
    ["email empty", unique({ email: "" }), 400],
    // Số Việt Nam có 10–11 chữ số; số quốc tế có dấu cộng và 8–15 chữ số.
    ["phone 10 digits", unique({ phone: "0912345678" }), 201],
    ["phone 11 digits", unique({ phone: "09123456789" }), 201],
    ["phone 9 digits", unique({ phone: "091234567" }), 400],
    ["phone 12 digits", unique({ phone: "091234567890" }), 400],
    ["phone with letters", unique({ phone: "09123abc78" }), 400],
    ["phone with spaces", unique({ phone: "0912 345 678" }), 400],
    ["phone +84 with 9 digits", unique({ phone: "+84912345678" }), 201],
    ["phone + and 7 digits", unique({ phone: "+1234567" }), 400],
    ["phone + and 16 digits", unique({ phone: "+1234567890123456" }), 400],
    ["phone missing", unique({ phone: undefined }), 400],
    // Kiểm tra đồng ý chính sách riêng tư.
    ["consent false", unique({ consent: false }), 400],
    ["consent missing", unique({ consent: undefined }), 400],
    ["consent string 'true'", unique({ consent: "true" }), 400],
    // Từ chối trường thừa và dữ liệu trùng.
    ["unknown field is rejected", unique({ role: "admin" }), 400],
    ["duplicate e-mail", { ...reg(), username: "dupuser1", email: "customer@example.com" }, 409],
    ["duplicate username", { ...reg(), username: "customer", email: "dup2@example.com" }, 409],
  ], (b) => send(request(app), "post", "/api/auth/register", b));
});

test("change password: CR-12 and the current password is required", async () => {
  await check("change password", [
    ["missing current password", { newPassword: "Abcdefg1" }, 400],
    ["wrong current password", { currentPassword: "Nope12345", newPassword: "Abcdefg1" }, 400],
    ["new password 7 chars", { currentPassword: password, newPassword: "Abcdef1" }, 400],
    ["new password no upper-case", { currentPassword: password, newPassword: "abcdefg1" }, 400],
    ["new password no lower-case", { currentPassword: password, newPassword: "ABCDEFG1" }, 400],
    ["new password no digit", { currentPassword: password, newPassword: "Abcdefgh" }, 400],
    ["same as current", { currentPassword: password, newPassword: password }, 400],
    // Chạy sau cùng vì thao tác thực sự đổi mật khẩu.
    ["a valid 8-character new password", { currentPassword: password, newPassword: "Abcdefg1" }, 200],
  ], (b) => send(customer, "put", "/api/profile/password", b));
});

test("room type: BR-01 name required, capacity > 0, base price > 0", async () => {
  const ok = { name: "RT", description: "d", bedType: "King", roomSizeSqm: 30, maxOccupancy: 2, basePrice: 1000000, amenities: [] };
  let n = 0;
  const rt = (o) => ({ ...ok, name: `Type ${++n}`, ...o });
  await check("room type", [
    ["valid", rt({}), 201],
    ["name missing", rt({ name: undefined }), 400],
    ["name blank", rt({ name: "   " }), 400],
    ["capacity 0", rt({ maxOccupancy: 0 }), 400],
    ["capacity negative", rt({ maxOccupancy: -1 }), 400],
    ["capacity decimal", rt({ maxOccupancy: 1.5 }), 400],
    ["capacity string", rt({ maxOccupancy: "2" }), 400],
    ["price 0", rt({ basePrice: 0 }), 400],
    ["price negative", rt({ basePrice: -5 }), 400],
    ["price decimal (VND is whole)", rt({ basePrice: 1000.5 }), 400],
    ["price string", rt({ basePrice: "1000" }), 400],
    ["room size 0", rt({ roomSizeSqm: 0 }), 400],
    ["duplicate name", { ...ok, name: "Type 1" }, 409],
  ], (b) => send(manager, "post", "/api/room-types", b));
});

test("coupon: BR-08 code alphanumeric, percentage 1-100 or fixed amount, value > 0, usage limit > 0", async () => {
  let n = 0;
  const cp = (o) => ({ code: `CODE${++n}`, discountType: "percentage", discountValue: 10, usageLimit: 5, minimumSpend: 0, startDate: "2030-01-01", endDate: "2030-02-01", ...o });
  await check("coupon", [
    ["valid percentage", cp({}), 201],
    ["valid fixed amount in VND", cp({ discountType: "fixed", discountValue: 200000 }), 201],
    ["code with symbol", cp({ code: "AB-12" }), 400],
    ["code with space", cp({ code: "AB 12" }), 400],
    ["code empty", cp({ code: "" }), 400],
    ["code 1 char", cp({ code: "A" }), 400],
    ["percentage 0", cp({ discountValue: 0 }), 400],
    ["percentage 101", cp({ discountValue: 101 }), 400],
    ["percentage 100", cp({ discountValue: 100 }), 201],
    ["percentage negative", cp({ discountValue: -5 }), 400],
    ["fixed amount 0", cp({ discountType: "fixed", discountValue: 0 }), 400],
    ["unknown type", cp({ discountType: "bogus" }), 400],
    ["usage limit 0", cp({ usageLimit: 0 }), 400],
    ["usage limit negative", cp({ usageLimit: -1 }), 400],
    ["minimum spend negative", cp({ minimumSpend: -1 }), 400],
    ["end before start", cp({ startDate: "2030-02-01", endDate: "2030-01-01" }), 400],
    ["invalid date", cp({ startDate: "2030-13-40" }), 400],
    ["duplicate code (case-insensitive)", { ...cp({}), code: "code1" }, 409],
  ], (b) => send(manager, "post", "/api/promotions", b));
});

test("service catalog: BR-30 name required and unique, price >= 0", async () => {
  let n = 0;
  const sv = (o) => ({ name: `Service ${++n}`, category: "Food & drink", price: 50000, ...o });
  await check("service", [
    ["valid", sv({}), 201],
    ["price 0 is allowed", sv({ price: 0 }), 201],
    ["price negative", sv({ price: -1 }), 400],
    ["price decimal", sv({ price: 10.5 }), 400],
    ["name blank", sv({ name: " " }), 400],
    ["name missing", sv({ name: undefined }), 400],
    ["duplicate name", { name: "Service 1", category: "Food & drink", price: 5 }, 409],
  ], (b) => send(manager, "post", "/api/catalog/services", b));
});

test("deposit policy: BR-31 percentage greater than 0 and at most 100", async () => {
  await check("deposit", [
    ["30", { percentage: 30 }, 201],
    ["100", { percentage: 100 }, 201],
    ["1", { percentage: 1 }, 201],
    ["0", { percentage: 0 }, 400],
    ["101", { percentage: 101 }, 400],
    ["-5", { percentage: -5 }, 400],
    ["string", { percentage: "30" }, 400],
    ["missing", {}, 400],
  ], (b) => send(manager, "post", "/api/policies/deposit", b));
});

test("hotel info: CR-04 phone and e-mail format", async () => {
  const ok = { name: "GrandStay", address: "1 Beach Road", phone: "+842360000000", email: "hello@grandstay.example", description: "d" };
  await check("hotel info", [
    ["valid", ok, 200],
    ["name too short", { ...ok, name: "G" }, 400],
    ["phone with spaces", { ...ok, phone: "+84 236 000 0000" }, 400],
    ["bad e-mail", { ...ok, email: "nope" }, 400],
    ["unknown field", { ...ok, city: "Da Nang" }, 400],
  ], (b) => send(manager, "put", "/api/hotel-info", b));
});
