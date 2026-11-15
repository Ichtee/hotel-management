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
const { setResendClient } = require("../src/services/resendService");

const origin = "http://localhost:5173";
let db, app, store;

const send = (agent, method, url, body = {}) =>
  agent[method](url).set("Origin", origin).send(body);

before(async () => {
  db = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: "wiredTiger" } });
  await mongoose.connect(db.getUri("verification_tests"));
  await seedRoles();
  ({ app, store } = createApp({
    mongoUri: db.getUri("verification_tests"),
    jwtSecret: "email-verification-tests-secret-over-32-chars-long",
    clientOrigin: origin,
  }));
});

after(async () => {
  setResendClient(null);
  await store?.close();
  await mongoose.disconnect();
  await db?.stop();
});

test("Email Verification: Registration, token hashing, rejection before verify, and successful login after verify", async () => {
  const sentEmails = [];
  setResendClient({
    emails: {
      send: async (options) => {
        sentEmails.push(options);
        return { data: { id: "msg_test_123" }, error: null };
      },
    },
  });

  const userData = {
    consent: true,
    username: "verifyuser",
    email: "verifyuser@example.com",
    fullName: "Verify User",
    password: "Password123!",
    confirmPassword: "Password123!",
    phone: "0912345678",
  };

  const regRes = await send(request(app), "post", "/api/auth/register", userData).expect(201);
  assert.equal(regRes.body.data.email, "verifyuser@example.com");
  assert.equal(regRes.body.data.isVerified, false);

  // Kiểm tra email xác minh đã gửi kèm token.
  assert.equal(sentEmails.length, 1);
  assert.equal(sentEmails[0].to, "verifyuser@example.com");
  assert.match(sentEmails[0].subject, /Verify your email/i);
  assert.match(sentEmails[0].html, /Verify Email/i);

  // Lấy token gốc từ liên kết xác minh trong email.
  const match = sentEmails[0].html.match(/token=([a-f0-9]+)/);
  assert.ok(match, "Raw token should be in email HTML");
  const rawToken = match[1];

  // Database chỉ lưu mã băm SHA-256, không lưu token gốc.
  const savedUser = await User.findOne({ email: "verifyuser@example.com" }).select(
    "+emailVerification.tokenHash +emailVerification.expiresAt"
  );
  assert.equal(savedUser.isVerified, false);
  assert.notEqual(savedUser.emailVerification.tokenHash, rawToken);
  assert.ok(savedUser.emailVerification.expiresAt > new Date());

  // Từ chối đăng nhập trước khi xác minh email.
  const loginBeforeRes = await send(request(app), "post", "/api/auth/login", {
    email: userData.email,
    password: userData.password,
  }).expect(403);
  assert.equal(loginBeforeRes.body.error.code, "EMAIL_NOT_VERIFIED");
  assert.match(loginBeforeRes.body.error.message, /not been verified/i);

  // Từ chối token xác minh không hợp lệ.
  await send(request(app), "post", "/api/auth/verify-email", {
    email: userData.email,
    token: "wrongtoken1234567890",
  }).expect(400);

  // Xác minh thành công bằng token hợp lệ.
  const verifyRes = await send(request(app), "post", "/api/auth/verify-email", {
    email: userData.email,
    token: rawToken,
  }).expect(200);
  assert.match(verifyRes.body.data.message, /Email verified successfully/i);

  // Đánh dấu đã xác minh và xóa token đã dùng.
  const updatedUser = await User.findOne({ email: userData.email }).select(
    "+emailVerification.tokenHash +emailVerification.expiresAt"
  );
  assert.equal(updatedUser.isVerified, true);
  assert.equal(updatedUser.emailVerification?.tokenHash, undefined);

  // Gửi lại token đã dùng không thực hiện xác minh lần nữa.
  await send(request(app), "post", "/api/auth/verify-email", {
    email: userData.email,
    token: rawToken,
  // Trả thông báo tài khoản đã được xác minh.
  }).expect(200);

  // Cho đăng nhập và tạo phiên sau khi xác minh.
  const agent = request.agent(app);
  const loginAfterRes = await send(agent, "post", "/api/auth/login", {
    email: userData.email,
    password: userData.password,
  }).expect(200);
  assert.equal(loginAfterRes.body.data.email, "verifyuser@example.com");

  // Kiểm tra phiên đăng nhập vừa cấp.
  const meRes = await agent.get("/api/auth/me").expect(200);
  assert.equal(meRes.body.data.email, "verifyuser@example.com");
});

test("Email Verification: Token expiration and resend cooldown", async () => {
  const sentEmails = [];
  setResendClient({
    emails: {
      send: async (options) => {
        sentEmails.push(options);
        return { data: { id: `msg_${Date.now()}` }, error: null };
      },
    },
  });

  const userData = {
    consent: true,
    username: "expireuser",
    email: "expireuser@example.com",
    fullName: "Expire User",
    password: "Password123!",
    confirmPassword: "Password123!",
    phone: "0912345679",
  };

  await send(request(app), "post", "/api/auth/register", userData).expect(201);
  const firstToken = sentEmails[0].html.match(/token=([a-f0-9]+)/)[1];

  // Giả lập token đã hết hạn trong database.
  await User.updateOne(
    { email: "expireuser@example.com" },
    { $set: { "emailVerification.expiresAt": new Date(Date.now() - 1000) } }
  );

  // Token hết hạn trả lỗi TOKEN_EXPIRED.
  const expiredRes = await send(request(app), "post", "/api/auth/verify-email", {
    email: "expireuser@example.com",
    token: firstToken,
  }).expect(400);
  assert.equal(expiredRes.body.error.code, "TOKEN_EXPIRED");

  // Chặn gửi lại trong thời gian chờ 60 giây.
  const cooldownRes = await send(request(app), "post", "/api/auth/resend-verification", {
    email: "expireuser@example.com",
  }).expect(429);
  assert.match(cooldownRes.body.error.message, /Please wait/i);

  // Lùi thời điểm gửi trước hai phút để bỏ thời gian chờ trong test.
  await User.updateOne(
    { email: "expireuser@example.com" },
    { $set: { "emailVerification.lastSentAt": new Date(Date.now() - 2 * 60 * 1000) } }
  );

  // Cho gửi lại khi đã hết thời gian chờ.
  const resendRes = await send(request(app), "post", "/api/auth/resend-verification", {
    email: "expireuser@example.com",
  }).expect(200);
  assert.match(resendRes.body.data.message, /verification email sent/i);

  // Email gửi lại phải chứa token mới.
  assert.equal(sentEmails.length, 2);
  const secondToken = sentEmails[1].html.match(/token=([a-f0-9]+)/)[1];
  assert.notEqual(firstToken, secondToken);

  // Không chấp nhận token cũ đã hết hạn.
  await send(request(app), "post", "/api/auth/verify-email", {
    email: "expireuser@example.com",
    token: firstToken,
  }).expect(400);

  // Token mới xác minh thành công.
  await send(request(app), "post", "/api/auth/verify-email", {
    email: "expireuser@example.com",
    token: secondToken,
  }).expect(200);

  // Kiểm tra tài khoản đã được xác minh.
  const user = await User.findOne({ email: "expireuser@example.com" });
  assert.equal(user.isVerified, true);
});
