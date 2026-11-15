const test = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");
const mongoose = require("mongoose");
const { MongoMemoryReplSet } = require("mongodb-memory-server");
const { createApp } = require("../src/app");
const User = require("../src/models/User");
const Role = require("../src/models/Role");
const { hashPassword } = require("../src/utils/password");
const { seedRoles } = require("../src/services/roles");

const origin = "http://localhost:5173";
const send = (agent, method, url, body = {}) =>
  agent[method](url).set("Origin", origin).send(body);

let db, app, store;
const password = "ValidPassword123!";

test.before(async () => {
  db = await MongoMemoryReplSet.create({
    replSet: { count: 1, storageEngine: "wiredTiger" },
  });
  await mongoose.connect(db.getUri("login_security_tests"));
  await seedRoles();
  ({ app, store } = createApp({
    mongoUri: db.getUri("login_security_tests"),
    jwtSecret: "temporary-security-secret-at-least-32-chars",
  }));
});

test.after(async () => {
  await store?.close();
  await mongoose.disconnect();
  await db?.stop();
});

test("CAPTCHA verification: invalid or expired captcha is rejected with HTTP 400 and does NOT increment failedLoginAttempts", async () => {
  const role = await Role.findOne({ key: "customer" });
  const user = await User.create({
    username: "captchatest",
    email: "captcha@example.com",
    passwordHash: await hashPassword(password),
    roleId: role._id,
    isVerified: true,
  });

  // Từ chối token CAPTCHA sai.
  const resInvalid = await send(request(app), "post", "/api/auth/login", {
    email: "captcha@example.com",
    password,
    captchaToken: "invalid_test_token",
  }).expect(400);

  assert.equal(resInvalid.body.success, false);
  assert.equal(resInvalid.body.code, "CAPTCHA_FAILED");

  // Từ chối token CAPTCHA hết hạn.
  const resExpired = await send(request(app), "post", "/api/auth/login", {
    email: "captcha@example.com",
    password,
    captchaToken: "expired_test_token",
  }).expect(400);

  assert.equal(resExpired.body.success, false);
  assert.equal(resExpired.body.code, "CAPTCHA_FAILED");

  // Lỗi CAPTCHA không được tăng bộ đếm sai mật khẩu.
  const checkUser = await User.findById(user._id).select("+failedLogins +lockedUntil");
  assert.equal(checkUser.failedLogins, 0);
  assert.equal(checkUser.failedLoginAttempts, 0);
  assert.equal(checkUser.lockedUntil, null);
  assert.equal(checkUser.lockUntil, null);
});

test("Account Lockout: 5 failed attempts locks account for 15 minutes, remainingAttempts counted down, correct password rejected while locked, unlocked after expiry", async () => {
  const role = await Role.findOne({ key: "customer" });
  const user = await User.create({
    username: "lockoutuser",
    email: "lockout@example.com",
    passwordHash: await hashPassword(password),
    roleId: role._id,
    isVerified: true,
  });

  const loginWithToken = (pw, token = "valid_test_token") =>
    send(request(app), "post", "/api/auth/login", {
      email: "lockout@example.com",
      password: pw,
      captchaToken: token,
    });

  // Lần sai đầu tiên còn bốn lượt thử.
  const att1 = await loginWithToken("wrong1").expect(401);
  assert.equal(att1.body.success, false);
  assert.equal(att1.body.remainingAttempts, 4);

  const att2 = await loginWithToken("wrong2").expect(401);
  assert.equal(att2.body.remainingAttempts, 3);

  const att3 = await loginWithToken("wrong3").expect(401);
  assert.equal(att3.body.remainingAttempts, 2);

  const att4 = await loginWithToken("wrong4").expect(401);
  assert.equal(att4.body.remainingAttempts, 1);

  // Lần sai thứ năm khóa tài khoản 15 phút.
  const att5 = await loginWithToken("wrong5").expect(423);
  assert.equal(att5.body.success, false);
  assert.equal(att5.body.locked, true);
  assert.ok(att5.body.remainingTime > 0 && att5.body.remainingTime <= 900);
  assert.match(att5.body.message, /temporarily locked/);

  // Khi đang khóa, mật khẩu đúng vẫn bị từ chối.
  const attCorrectWhileLocked = await loginWithToken(password).expect(423);
  assert.equal(attCorrectWhileLocked.body.locked, true);

  // Giả lập đã qua 15 phút để khóa hết hạn.
  await User.updateOne(
    { _id: user._id },
    { $set: { lockedUntil: new Date(Date.now() - 1000) } }
  );

  // Cho đăng nhập bằng mật khẩu đúng khi hết khóa.
  const loginUnlocked = await loginWithToken(password).expect(200);
  assert.equal(loginUnlocked.body.data?.email, "lockout@example.com");

  // Bộ đếm sai được đặt lại bằng không.
  const checkUser = await User.findById(user._id).select("+failedLogins +lockedUntil");
  assert.equal(checkUser.failedLogins, 0);
  assert.equal(checkUser.failedLoginAttempts, 0);
  assert.equal(checkUser.lockedUntil, null);
  assert.equal(checkUser.lockUntil, null);
});

test("Unverified user with valid password and valid captcha is rejected with HTTP 403 EMAIL_NOT_VERIFIED", async () => {
  const role = await Role.findOne({ key: "customer" });
  await User.create({
    username: "unverifieduser",
    email: "unverified_login@example.com",
    passwordHash: await hashPassword(password),
    roleId: role._id,
    isVerified: false,
  });

  const res = await send(request(app), "post", "/api/auth/login", {
    email: "unverified_login@example.com",
    password,
    captchaToken: "valid_test_token",
  }).expect(403);

  assert.equal(res.body.error?.code, "EMAIL_NOT_VERIFIED");
  // Không cấp phiên đăng nhập.
  assert.equal(res.headers["set-cookie"], undefined);
});
