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
    sessionSecret: "email-verification-tests-secret-over-32-chars-long",
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
    username: "verifyuser",
    email: "verifyuser@example.com",
    fullName: "Verify User",
    password: "Password123!",
    confirmPassword: "Password123!",
    phone: "0912345678",
  };

  // 1. Register user
  const regRes = await send(request(app), "post", "/api/auth/register", userData).expect(201);
  assert.equal(regRes.body.data.email, "verifyuser@example.com");
  assert.equal(regRes.body.data.isVerified, false);

  // 2. Check email sent with token
  assert.equal(sentEmails.length, 1);
  assert.equal(sentEmails[0].to, "verifyuser@example.com");
  assert.match(sentEmails[0].subject, /Verify your email/i);
  assert.match(sentEmails[0].html, /Verify Email/i);

  // Extract raw token from email verification URL
  const match = sentEmails[0].html.match(/token=([a-f0-9]+)/);
  assert.ok(match, "Raw token should be in email HTML");
  const rawToken = match[1];

  // 3. Database should NOT store raw token - only sha256 hash
  const savedUser = await User.findOne({ email: "verifyuser@example.com" }).select(
    "+emailVerification.tokenHash +emailVerification.expiresAt"
  );
  assert.equal(savedUser.isVerified, false);
  assert.notEqual(savedUser.emailVerification.tokenHash, rawToken);
  assert.ok(savedUser.emailVerification.expiresAt > new Date());

  // 4. Login attempt before verification MUST be rejected with 403
  const loginBeforeRes = await send(request(app), "post", "/api/auth/login", {
    email: userData.email,
    password: userData.password,
  }).expect(403);
  assert.equal(loginBeforeRes.body.error.code, "EMAIL_NOT_VERIFIED");
  assert.match(loginBeforeRes.body.error.message, /not been verified/i);

  // 5. Verification with invalid token fails with 400
  await send(request(app), "post", "/api/auth/verify-email", {
    email: userData.email,
    token: "wrongtoken1234567890",
  }).expect(400);

  // 6. Verification with valid token succeeds
  const verifyRes = await send(request(app), "post", "/api/auth/verify-email", {
    email: userData.email,
    token: rawToken,
  }).expect(200);
  assert.match(verifyRes.body.data.message, /Email verified successfully/i);

  // 7. User in DB is now verified and token is cleared
  const updatedUser = await User.findOne({ email: userData.email }).select(
    "+emailVerification.tokenHash +emailVerification.expiresAt"
  );
  assert.equal(updatedUser.isVerified, true);
  assert.equal(updatedUser.emailVerification?.tokenHash, undefined);

  // 8. Re-using the same token fails
  await send(request(app), "post", "/api/auth/verify-email", {
    email: userData.email,
    token: rawToken,
  }).expect(200); // returns already verified message

  // 9. Login now succeeds with 200 and session is established
  const agent = request.agent(app);
  const loginAfterRes = await send(agent, "post", "/api/auth/login", {
    email: userData.email,
    password: userData.password,
  }).expect(200);
  assert.equal(loginAfterRes.body.data.email, "verifyuser@example.com");

  // Verify session works
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
    username: "expireuser",
    email: "expireuser@example.com",
    fullName: "Expire User",
    password: "Password123!",
    confirmPassword: "Password123!",
    phone: "0912345679",
  };

  await send(request(app), "post", "/api/auth/register", userData).expect(201);
  const firstToken = sentEmails[0].html.match(/token=([a-f0-9]+)/)[1];

  // Manually expire the token in database
  await User.updateOne(
    { email: "expireuser@example.com" },
    { $set: { "emailVerification.expiresAt": new Date(Date.now() - 1000) } }
  );

  // Verification with expired token fails with 400 and TOKEN_EXPIRED
  const expiredRes = await send(request(app), "post", "/api/auth/verify-email", {
    email: "expireuser@example.com",
    token: firstToken,
  }).expect(400);
  assert.equal(expiredRes.body.error.code, "TOKEN_EXPIRED");

  // Resend verification email within 60s cooldown fails with 429
  const cooldownRes = await send(request(app), "post", "/api/auth/resend-verification", {
    email: "expireuser@example.com",
  }).expect(429);
  assert.match(cooldownRes.body.error.message, /Please wait/i);

  // Fast forward cooldown (set lastSentAt to 2 minutes ago)
  await User.updateOne(
    { email: "expireuser@example.com" },
    { $set: { "emailVerification.lastSentAt": new Date(Date.now() - 2 * 60 * 1000) } }
  );

  // Resend now succeeds
  const resendRes = await send(request(app), "post", "/api/auth/resend-verification", {
    email: "expireuser@example.com",
  }).expect(200);
  assert.match(resendRes.body.data.message, /verification email sent/i);

  // New email was sent with a fresh token
  assert.equal(sentEmails.length, 2);
  const secondToken = sentEmails[1].html.match(/token=([a-f0-9]+)/)[1];
  assert.notEqual(firstToken, secondToken);

  // Old expired token cannot be used
  await send(request(app), "post", "/api/auth/verify-email", {
    email: "expireuser@example.com",
    token: firstToken,
  }).expect(400);

  // New token verifies successfully
  await send(request(app), "post", "/api/auth/verify-email", {
    email: "expireuser@example.com",
    token: secondToken,
  }).expect(200);

  // Now user is verified
  const user = await User.findOne({ email: "expireuser@example.com" });
  assert.equal(user.isVerified, true);
});
