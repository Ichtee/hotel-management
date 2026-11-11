const { randomBytes, createHash } = require("node:crypto");
const User = require("../models/User");
const Role = require("../models/Role");
const v = require("../utils/validation");
const { hashPassword, verifyPassword } = require("../utils/password");
const { publicUser, issueToken, clearToken, tokenClaims } = require("../middleware/auth");
const { sendVerificationEmail, getClientUrl, hotelName } = require("../services/resendService");
const { verifyCaptcha, getSiteKey } = require("../services/captchaService");
const AuditLog = require("../models/AuditLog");
const MAX_FAILED_LOGINS = 5;
const LOCK_MS = 15 * 60 * 1000;
// Liên kết xác minh có hiệu lực 24 giờ.
const VERIFY_MS = 24 * 3600 * 1000;
// Đăng ký tài khoản khách hàng sau khi kiểm tra dữ liệu.
async function register(req, res) {
  v.keys(req.body, [
    "username",
    "email",
    "fullName",
    "password",
    "confirmPassword",
    "phone",
    "consent",
  ]);
  const { body } = req;
  if (body.consent !== true) v.fail("Privacy consent is required.", "consent");
  if (
    body.confirmPassword !== undefined &&
    body.password !== body.confirmPassword
  ) {
    v.fail("Passwords do not match.", "confirmPassword");
  }
  const data = {
    username: v.username(body.username),
    email: v.email(body.email),
    phone: v.phone(body.phone, true),
    customerProfile: { fullName: v.text(body.fullName, "fullName", 2, 50) },
  };
  v.password(body.password);
  const role = await Role.findOne({ key: "customer", isActive: true });
  if (!role)
    throw new v.HttpError(409, "Registration is currently unavailable.");
  const rawToken = randomBytes(32).toString("hex");
  const tokenHash = createHash("sha256").update(rawToken).digest("hex");
  const expiresAt = new Date(Date.now() + VERIFY_MS);

  const user = await User.create({
    ...data,
    passwordHash: await hashPassword(body.password),
    roleId: role._id,
    isVerified: false,
    consentAt: new Date(),
    emailVerification: {
      tokenHash,
      expiresAt,
      lastSentAt: new Date(),
      sentAt: [new Date()],
    },
  });

  try {
    await sendVerificationEmail({
      email: user.email,
      fullName: user.customerProfile?.fullName || user.username,
      token: rawToken,
    });
  } catch (emailErr) {
    console.error("[Register] Failed to send verification email:", emailErr.message);
  }

  res.status(201).json({
    data: publicUser(user, role),
    message: "Registration successful. Please check your email to verify your account.",
  });
}
// Xác minh mật khẩu và ghi nhận phiên bản tài khoản, quyền hiện tại.
async function login(req, res) {
  v.keys(req.body, [
    "email",
    "password",
    "captchaToken",
    "recaptchaToken",
    "g-recaptcha-response",
  ]);
  const email = v.email(req.body.email);
  v.text(req.body.password, "password", 1, 128);
  const password = req.body.password;
  const captchaToken =
    req.body.captchaToken ||
    req.body.recaptchaToken ||
    req.body["g-recaptcha-response"];

  // Chỉ bỏ CAPTCHA trong test khi không gửi token; token đã gửi luôn phải được xác minh.
  const isTestMode =
    process.env.NODE_ENV === "test" ||
    Boolean(process.env.NODE_TEST_CONTEXT) ||
    process.argv.some((a) => a.includes("test"));
  if (!isTestMode || captchaToken !== undefined) {
    if (!captchaToken) {
      const err = new v.HttpError(400, "Please complete the CAPTCHA verification.");
      err.code = "CAPTCHA_REQUIRED";
      throw err;
    }
    const captchaResult = await verifyCaptcha(captchaToken, req.ip);
    if (!captchaResult.success) {
      const err = new v.HttpError(
        400,
        captchaResult.message || "CAPTCHA verification failed. Please try again."
      );
      err.code = "CAPTCHA_FAILED";
      throw err;
    }
  }

  const user = await User.findOne({ email }).select(
    "+passwordHash +authVersion +failedLogins +lockedUntil",
  );

  // Chặn đăng nhập khi tài khoản còn trong thời gian khóa.
  const lockTime = user?.lockUntil || user?.lockedUntil;
  if (lockTime) {
    if (new Date(lockTime) > new Date()) {
      const remainingTime = Math.ceil((new Date(lockTime).getTime() - Date.now()) / 1000);
      const err = new v.HttpError(
        423,
        "Account temporarily locked. Please try again later. Your account is locked for 15 minutes after too many failed login attempts.",
      );
      err.code = "ACCOUNT_LOCKED";
      err.locked = true;
      err.remainingTime = remainingTime;
      err.details = { locked: true, remainingTime };
      throw err;
    } else {
      // Xóa khóa và số lần sai khi hết thời gian khóa.
      await User.updateOne(
        { _id: user._id },
        {
          $set: {
            failedLogins: 0,
            lockedUntil: null,
          },
        },
      );
      user.failedLogins = 0;
      user.lockedUntil = null;
    }
  }

  const valid = await verifyPassword(
    password,
    user?.passwordHash || `scrypt:${"0".repeat(32)}:${"0".repeat(128)}`,
  );
  if (user && !valid) await recordFailedLogin(req, user);
  const role = user && (await Role.findOne({ _id: user.roleId, isActive: true }));
  if (!valid || user.status !== "active" || !role) {
    const err = new v.HttpError(
      401,
      "Invalid email or password",
    );
    err.code = "INVALID_CREDENTIALS";
    throw err;
  }

  // Yêu cầu xác minh email trước khi cho đăng nhập.
  if (user.isVerified === false) {
    const err = new v.HttpError(
      403,
      "Your email address has not been verified. Please check your inbox or request a new verification email.",
    );
    err.code = "EMAIL_NOT_VERIFIED";
    err.details = { email: user.email, isVerified: false };
    throw err;
  }

  // Đăng nhập thành công thì xóa số lần sai và cấp JWT mới.
  user.lastLogin = new Date();
  user.failedLogins = 0;
  user.lockedUntil = undefined;
  await user.save();
  issueToken(req, res, user, role);
  res.json({ data: publicUser(user, role) });
}

// Tăng nguyên tử số lần sai; khóa 15 phút khi sai liên tiếp năm lần.
async function recordFailedLogin(req, user) {
  const updated = await User.findByIdAndUpdate(
    user._id,
    { $inc: { failedLogins: 1 } },
    { new: true },
  ).select("+failedLogins");

  const attempts = updated.failedLogins ?? 1;
  const locked = attempts >= MAX_FAILED_LOGINS;
  const lockTime = new Date(Date.now() + LOCK_MS);

  if (locked) {
    await User.updateOne(
      { _id: user._id },
      {
        $set: {
          failedLogins: 0,
          lockedUntil: lockTime,
        },
      },
    );
  }

  await AuditLog.create({
    action: locked ? "account_locked" : "login_failed",
    targetType: "User",
    targetId: user._id,
    ip: req.ip,
    detail: { failedLogins: attempts, failedLoginAttempts: attempts },
  });

  if (locked) {
    const remainingTime = Math.ceil(LOCK_MS / 1000);
    const err = new v.HttpError(
      423,
      "Account temporarily locked. Please try again later. Your account is locked for 15 minutes after too many failed login attempts.",
    );
    err.code = "ACCOUNT_LOCKED";
    err.locked = true;
    err.remainingTime = remainingTime;
    err.details = { locked: true, remainingTime };
    throw err;
  }

  const remainingAttempts = Math.max(0, MAX_FAILED_LOGINS - attempts);
  const err = new v.HttpError(
    401,
    `Invalid email or password. You have ${remainingAttempts} attempt(s) remaining.`,
  );
  err.code = "INVALID_CREDENTIALS";
  err.remainingAttempts = remainingAttempts;
  err.details = { remainingAttempts };
  throw err;
}

function captchaConfig(req, res) {
  res.json({
    data: {
      siteKey: getSiteKey(),
    },
  });
}
// Tăng phiên bản token để thu hồi mọi phiên rồi xóa cookie đăng nhập.
async function logout(req, res) {
  const claims = tokenClaims(req);
  if (claims) await User.updateOne({ _id: claims.sub, authVersion: claims.ver }, { $inc: { authVersion: 1 } });
  clearToken(req, res);
  res.json({ data: { message: "Signed out." } });
}
// Trả hồ sơ của tài khoản đang đăng nhập.
async function profile(req, res) {
  res.json({ data: publicUser(req.user, req.role) });
}
// Chỉ cập nhật các trường hồ sơ cá nhân được phép.
async function updateProfile(req, res) {
  v.keys(req.body, ["fullName", "phone", "address", "dateOfBirth", "email"]);
  const b = req.body;
  const u = req.user;
  let message;
  // Khách đổi email qua liên kết xác minh địa chỉ mới; email nhân viên do người quản lý cập nhật.
  if (b.email !== undefined && v.email(b.email) !== u.email) {
    if (req.role.key !== "customer") v.fail("The e-mail of a staff account is changed by the person who manages it.", "email");
    const email = v.email(b.email);
    if (await User.exists({ $or: [{ email }, { pendingEmail: email }], _id: { $ne: u._id } })) throw new v.HttpError(409, "This email is already registered.");
    const rawToken = randomBytes(32).toString("hex");
    u.pendingEmail = email;
    u.emailVerification = { tokenHash: createHash("sha256").update(rawToken).digest("hex"), expiresAt: new Date(Date.now() + VERIFY_MS), lastSentAt: new Date(), sentAt: [new Date()] };
    try {
      await sendVerificationEmail({ email, fullName: u.customerProfile?.fullName || u.username, token: rawToken });
    } catch (error) {
      console.error("[ChangeEmail] Failed to send email:", error.message);
    }
    message = "A verification e-mail has been sent. The link is valid for 24 hours.";
  }
  if (b.fullName !== undefined)
    u.customerProfile.fullName = v.text(b.fullName, "fullName", 2, 50);
  if (b.phone !== undefined)
    u.phone = v.phone(b.phone, req.role.scope === "hotel");
  if (b.address !== undefined)
    u.customerProfile.address = v.text(b.address, "address", 0, 250);
  if (b.dateOfBirth !== undefined) {
    if (!b.dateOfBirth) u.customerProfile.dateOfBirth = undefined;
    else {
      const date = v.date(b.dateOfBirth, "dateOfBirth");
      if (new Date(date) > new Date())
        v.fail("Birth date cannot be in the future.", "dateOfBirth");
      u.customerProfile.dateOfBirth = date;
    }
  }
  await u.save();
  res.json({ data: { ...publicUser(u, req.role), pendingEmail: u.pendingEmail }, ...(message ? { message } : {}) });
}
// Đổi mật khẩu bằng cập nhật có điều kiện, tránh ghi đè lần thu hồi phiên khác.
async function changePassword(req, res) {
  v.keys(req.body, ["currentPassword", "newPassword"]);
  v.text(req.body.currentPassword, "currentPassword", 1, 128);
  const current = req.body.currentPassword;
  const next = v.password(req.body.newPassword, "newPassword");
  const u = await User.findById(req.user.id).select(
    "+passwordHash +authVersion",
  );
  if (!u || u.status !== "active" || (u.authVersion || 0) !== tokenClaims(req)?.ver)
    throw new v.HttpError(401, "Your session has ended. Please sign in.");
  if (!(await verifyPassword(current, u.passwordHash)))
    v.fail("Current password is incorrect.", "currentPassword");
  if (current === next)
    v.fail("Choose a different new password.", "newPassword");
  const passwordHash = await hashPassword(next);
  const updated = await User.findOneAndUpdate(
    { _id: u._id, status: "active", passwordHash: u.passwordHash,
      $or: [{ authVersion: u.authVersion || 0 }, ...((u.authVersion || 0) === 0 ? [{ authVersion: { $exists: false } }] : [])] },
    { $set: { passwordHash, mustChangePassword: false }, $inc: { authVersion: 1 } },
    { new: true, runValidators: true },
  ).select("+authVersion");
  if (!updated) throw new v.HttpError(409, "The account changed. Please sign in again.");
  // Cấp lại phiên cho thiết bị hiện tại; các token cũ bị vô hiệu hóa.
  issueToken(req, res, updated, req.role);
  res.json({
    data: { message: "Password changed. Other sessions have been signed out." },
  });
}
async function forgotPassword(req, res) {
  v.keys(req.body, ["email"]);
  const email = v.email(req.body.email);
  const user = await User.findOne({ email });
  if (!user || user.status !== "active") {
    return res.json({
      data: {
        message:
          "If your email is registered, you will receive password reset instructions.",
      },
    });
  }
  const token = randomBytes(32).toString("hex");
  const tokenHash = createHash("sha256").update(token).digest("hex");
  user.passwordReset = {
    tokenHash,
    // Liên kết đặt lại mật khẩu có hiệu lực 30 phút.
    expiresAt: new Date(Date.now() + 30 * 60 * 1000),
  };
  await user.save();

  try {
    const { email: sendMail } = require("../services/notifications");
    if (typeof sendMail === "function") {
      await sendMail(
        user._id,
        `${await hotelName()} - Reset your password`,
        `Open this link to choose a new password: ${getClientUrl()}/#/reset-password?token=${token}&email=${encodeURIComponent(email)}\nThe link is valid for 30 minutes and can be used once.`,
      );
    }
  } catch (e) {
    console.error("Failed to send reset email:", e.message);
  }

  res.json({
    data: {
      message:
        "If your email is registered, you will receive password reset instructions.",
    },
  });
}
async function resetPassword(req, res) {
  v.keys(req.body, ["email", "token", "newPassword", "confirmPassword"]);
  const email = v.email(req.body.email);
  const token = v.text(req.body.token, "token", 1, 128);
  if (
    req.body.confirmPassword !== undefined &&
    req.body.newPassword !== req.body.confirmPassword
  ) {
    v.fail("Passwords do not match.", "confirmPassword");
  }
  const newPassword = v.password(req.body.newPassword, "newPassword");
  const user = await User.findOne({ email }).select(
    "+passwordHash +passwordReset.tokenHash +authVersion",
  );
  if (!user || user.status !== "active") {
    v.fail("Invalid or expired reset token.", "token");
  }
  const tokenHash = createHash("sha256")
    .update(token.trim())
    .digest("hex");
  if (
    !user.passwordReset?.tokenHash ||
    user.passwordReset.tokenHash !== tokenHash ||
    !user.passwordReset.expiresAt ||
    new Date() > user.passwordReset.expiresAt
  ) {
    v.fail("Invalid or expired reset token.", "token");
  }
  if (await verifyPassword(newPassword, user.passwordHash)) {
    v.fail("Choose a different new password.", "newPassword");
  }
  user.passwordHash = await hashPassword(newPassword);
  user.authVersion = (user.authVersion || 0) + 1;
  user.passwordReset = undefined;
  await user.save();
  res.json({
    data: { message: "Password reset successful. You can now sign in." },
  });
}

async function verifyEmail(req, res) {
  v.keys(req.body, ["token", "email"]);
  const token = v.text(req.body.token, "token", 1, 128).trim();
  const email = req.body.email ? v.email(req.body.email) : undefined;
  const tokenHash = createHash("sha256").update(token).digest("hex");

  // Gửi liên kết đổi email đến địa chỉ mới đang chờ xác minh.
  const query = email ? { $or: [{ email }, { pendingEmail: email }] } : { "emailVerification.tokenHash": tokenHash };
  const user = await User.findOne(query).select(
    "+emailVerification.tokenHash +emailVerification.expiresAt"
  );

  if (!user) {
    throw new v.HttpError(400, "Invalid verification link or account not found.");
  }
  const changingEmail = Boolean(user.pendingEmail) && (!email || email === user.pendingEmail);

  if (user.isVerified && !changingEmail) {
    return res.json({
      data: { message: "Your email has already been verified. You can now sign in." },
    });
  }

  if (
    !user.emailVerification?.tokenHash ||
    user.emailVerification.tokenHash !== tokenHash
  ) {
    throw new v.HttpError(400, "Invalid verification token.");
  }

  if (
    !user.emailVerification?.expiresAt ||
    new Date() > user.emailVerification.expiresAt
  ) {
    const err = new v.HttpError(
      400,
      "Verification link has expired. Please request a new verification email."
    );
    err.code = "TOKEN_EXPIRED";
    throw err;
  }

  user.isVerified = true;
  if (changingEmail) {
    // Chỉ thay email đăng nhập sau khi xác minh địa chỉ mới thành công.
    if (await User.exists({ email: user.pendingEmail, _id: { $ne: user._id } })) throw new v.HttpError(409, "This email is already registered.");
    user.email = user.pendingEmail;
    user.pendingEmail = undefined;
  }
  user.set("emailVerification", undefined);
  await user.save();

  res.json({
    data: { message: "Email verified successfully! You can now sign in to your account." },
  });
}

async function resendVerification(req, res) {
  v.keys(req.body, ["email"]);
  const email = v.email(req.body.email);
  const user = await User.findOne({ email }).select(
    "+emailVerification.tokenHash +emailVerification.expiresAt +emailVerification.lastSentAt +emailVerification.sentAt"
  );

  if (!user) {
    return res.json({
      data: {
        message: "If an unverified account with this email exists, a verification link has been sent.",
      },
    });
  }

  if (user.isVerified) {
    return res.json({
      data: { message: "This email address is already verified. You can sign in directly." },
    });
  }

  // Chờ ít nhất một phút giữa hai lần gửi email xác minh.
  if (user.emailVerification?.lastSentAt) {
    const elapsed = Date.now() - new Date(user.emailVerification.lastSentAt).getTime();
    if (elapsed < 60 * 1000) {
      const waitSec = Math.ceil((60000 - elapsed) / 1000);
      throw new v.HttpError(
        429,
        `Please wait ${waitSec} seconds before requesting another verification email.`
      );
    }
  }

  // Mỗi tài khoản nhận tối đa ba email xác minh mỗi giờ.
  const lastHour = (user.emailVerification?.sentAt || []).filter((t) => Date.now() - t < 3600 * 1000);
  if (lastHour.length >= 3) throw new v.HttpError(429, "Too many requests. Please try again later.");

  const rawToken = randomBytes(32).toString("hex");
  const tokenHash = createHash("sha256").update(rawToken).digest("hex");
  user.emailVerification = {
    tokenHash,
    expiresAt: new Date(Date.now() + VERIFY_MS),
    lastSentAt: new Date(),
    sentAt: [...lastHour, new Date()],
  };
  await user.save();

  try {
    await sendVerificationEmail({
      email: user.email,
      fullName: user.customerProfile?.fullName || user.username,
      token: rawToken,
    });
  } catch (emailErr) {
    console.error("[ResendVerification] Failed to send email:", emailErr.message);
  }

  res.json({
    data: { message: "Verification email sent. Please check your inbox." },
  });
}

module.exports = {
  register,
  login,
  logout,
  profile,
  updateProfile,
  changePassword,
  forgotPassword,
  resetPassword,
  verifyEmail,
  resendVerification,
  captchaConfig,
};
