const { randomBytes, createHash } = require("node:crypto");
const User = require("../models/User");
const Role = require("../models/Role");
const v = require("../utils/validation");
const { hashPassword, verifyPassword } = require("../utils/password");
const { publicUser } = require("../middleware/auth");
const AuditLog = require("../models/AuditLog");
const MAX_FAILED_LOGINS = 5;
const LOCK_MS = 15 * 60 * 1000;
// Phiên hết hạn khi không hoạt động: 30 phút với Customer, 15 phút với nhân viên (SRS 4.2.4).
const idleMs = (role) => (role.key === "customer" ? 30 : 15) * 60 * 1000;
// Tạo mã phiên mới để tránh tái sử dụng phiên cũ.
const regenerate = (req) =>
  new Promise((resolve, reject) =>
    req.session.regenerate((e) => (e ? reject(e) : resolve())),
  );
// Lưu phiên trước khi trả phản hồi đăng nhập.
const save = (req) =>
  new Promise((resolve, reject) =>
    req.session.save((e) => (e ? reject(e) : resolve())),
  );
// Đăng ký tài khoản khách hàng với dữ liệu đã kiểm tra.
async function register(req, res) {
  v.keys(req.body, [
    "username",
    "email",
    "fullName",
    "password",
    "confirmPassword",
    "phone",
  ]);
  const { body } = req;
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

  // Kiểm tra trùng lặp email và username trước khi insert
  const existingEmail = await User.findOne({ email: data.email });
  if (existingEmail) {
    throw new v.HttpError(409, "This email is already registered.", { email: "This email is already registered." });
  }
  const existingUsername = await User.findOne({ username: data.username });
  if (existingUsername) {
    throw new v.HttpError(409, "This username is already taken.", { username: "This username is already taken." });
  }

  let role = await Role.findOne({ key: "customer" });
  if (!role) {
    role = await Role.create({
      key: "customer",
      name: "Customer",
      scope: "self",
      permissions: [],
      isSystem: true,
      isActive: true,
    });
  } else if (!role.isActive) {
    role.isActive = true;
    await role.save();
  }

  const otp = Math.floor(100000 + Math.random() * 900000).toString();
  const otpHash = createHash("sha256").update(otp).digest("hex");

  const user = await User.create({
    ...data,
    passwordHash: await hashPassword(body.password),
    roleId: role._id,
    status: "pending_verification",
    emailVerification: {
      otpHash,
      expiresAt: new Date(Date.now() + 15 * 60 * 1000),
    },
  });

  try {
    const { email: sendMail } = require("../services/notifications");
    if (typeof sendMail === "function") {
      const html = `
        <div style="font-family: Arial, sans-serif; max-width: 500px; margin: 0 auto; padding: 24px; border: 1px solid #e2e8f0; border-radius: 10px; background: #ffffff;">
          <h2 style="color: #0f2742; margin-top: 0; font-size: 22px;">Grand<span style="color: #c8923b;">Stay</span> Hotels</h2>
          <p style="font-size: 15px; color: #334155;">Hello <strong>${data.customerProfile?.fullName || 'Valued Guest'}</strong>,</p>
          <p style="color: #475569; font-size: 14px; line-height: 1.5;">Thank you for creating an account with us. Please enter the following 6-digit verification code to complete your registration:</p>
          <div style="background: #f8fafc; border: 1px dashed #cbd5e1; padding: 18px; text-align: center; border-radius: 8px; margin: 24px 0;">
            <span style="font-size: 34px; font-weight: bold; letter-spacing: 8px; color: #0284c7;">${otp}</span>
          </div>
          <p style="color: #64748b; font-size: 13px;">This verification code is valid for <strong>15 minutes</strong>. If you did not make this request, please disregard this email.</p>
          <hr style="border: none; border-top: 1px solid #f1f5f9; margin: 20px 0;" />
          <small style="color: #94a3b8; font-size: 12px;">© 2026 GrandStay Hotel & Resort. Da Nang, Vietnam.</small>
        </div>
      `;
      await sendMail(
        user.email,
        "GrandStay - Email Verification Code",
        `Welcome to GrandStay! Your email verification code is: ${otp}. This code expires in 15 minutes.`,
        html,
      );
    }
  } catch (e) {
    console.error("Failed to send verification email:", e.message);
  }

  res.status(201).json({
    data: {
      ...publicUser(user, role),
      message: "Registration successful. Please check your email for the 6-digit verification code.",
      email: user.email,
    },
  });
}
// Xác minh mật khẩu và ghi nhận phiên bản tài khoản, quyền hiện tại.
async function login(req, res) {
  v.keys(req.body, ["email", "password"]);
  const email = v.email(req.body.email);
  v.text(req.body.password, "password", 1, 128);
  const password = req.body.password;
  const user = await User.findOne({ email }).select(
    "+passwordHash +authVersion +failedLogins +lockedUntil",
  );
  // MSG-64 (BR-42): tài khoản đang bị khóa thì từ chối cả mật khẩu đúng.
  if (user?.lockedUntil > new Date())
    throw new v.HttpError(423, "Your account is locked for 15 minutes after too many failed login attempts.");
  const valid = await verifyPassword(
    password,
    user?.passwordHash || `scrypt:${"0".repeat(32)}:${"0".repeat(128)}`,
  );
  if (user && !valid) await recordFailedLogin(req, user);
  if (user && valid && user.status === "pending_verification") {
    throw new v.HttpError(
      403,
      "Your email has not been verified yet. Please enter the verification code sent to your email.",
      { email: "Email not verified." },
      "EMAIL_NOT_VERIFIED",
    );
  }
  const role = user && (await Role.findOne({ _id: user.roleId, isActive: true }));
  if (!valid || user.status !== "active" || !role)
    throw new v.HttpError(
      401,
      "Email or password is incorrect, or your account is inactive.",
    );
  await regenerate(req);
  req.session.userId = user.id;
  req.session.authVersion = user.authVersion || 0;
  req.session.roleAuthVersion = role.authVersion || 0;
  req.session.cookie.maxAge = idleMs(role);
  user.lastLogin = new Date();
  user.failedLogins = 0;
  user.lockedUntil = undefined;
  await user.save();
  await save(req);
  res.json({ data: publicUser(user, role) });
}
// Đếm lần sai liên tiếp (tăng nguyên tử để các yêu cầu song song không đếm thiếu); lần thứ 5 khóa 15 phút.
async function recordFailedLogin(req, user) {
  const { failedLogins } = await User.findByIdAndUpdate(user._id, { $inc: { failedLogins: 1 } }, { new: true }).select("+failedLogins");
  const locked = failedLogins >= MAX_FAILED_LOGINS;
  if (locked) await User.updateOne({ _id: user._id }, { $set: { failedLogins: 0, lockedUntil: new Date(Date.now() + LOCK_MS) } });
  await AuditLog.create({ action: locked ? "account_locked" : "login_failed", targetType: "User", targetId: user._id, ip: req.ip, detail: { failedLogins } });
  if (locked) throw new v.HttpError(423, "Your account is locked for 15 minutes after too many failed login attempts.");
}
// Hủy phiên và cookie đăng nhập.
async function logout(req, res) {
  await new Promise((resolve, reject) =>
    req.session.destroy((e) => (e ? reject(e) : resolve())),
  );
  res.clearCookie("hotel.sid", { path: "/" });
  res.json({ data: { message: "Signed out." } });
}
// Trả hồ sơ của tài khoản đang đăng nhập.
async function profile(req, res) {
  res.json({ data: publicUser(req.user, req.role) });
}
// Chỉ cập nhật các trường hồ sơ cá nhân được phép.
async function updateProfile(req, res) {
  v.keys(req.body, ["fullName", "phone", "address", "dateOfBirth"]);
  const b = req.body;
  const u = req.user;
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
  res.json({ data: publicUser(u, req.role) });
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
  if (!u || u.status !== "active" || (u.authVersion || 0) !== req.session.authVersion)
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
  const roleAuthVersion = req.session.roleAuthVersion || 0;
  await regenerate(req);
  req.session.userId = updated.id;
  req.session.authVersion = updated.authVersion;
  req.session.roleAuthVersion = roleAuthVersion;
  await save(req);
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
  const token = randomBytes(4).toString("hex").toUpperCase();
  const tokenHash = createHash("sha256").update(token).digest("hex");
  user.passwordReset = {
    tokenHash,
    expiresAt: new Date(Date.now() + 15 * 60 * 1000),
  };
  await user.save();

  try {
    const { email: sendMail } = require("../services/notifications");
    if (typeof sendMail === "function") {
      await sendMail(
        user._id,
        "GrandStay - Password Reset Code",
        `Your password reset code is: ${token}. This code expires in 15 minutes.`,
      );
    }
  } catch (e) {
    console.error("Failed to send reset email:", e.message);
  }

  res.json({
    data: {
      message:
        "If your email is registered, you will receive password reset instructions.",
      resetToken: token,
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
    .update(token.trim().toUpperCase())
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

// Xác minh mã OTP 6 số để kích hoạt tài khoản
async function verifyEmail(req, res) {
  v.keys(req.body, ["email", "otp"]);
  const email = v.email(req.body.email);
  const otp = v.text(req.body.otp, "otp", 4, 10).trim();

  const user = await User.findOne({ email }).select(
    "+emailVerification.otpHash +authVersion"
  );
  if (!user) {
    throw new v.HttpError(404, "User account not found.", { email: "Account not found." });
  }

  const role = await Role.findOne({ _id: user.roleId });

  if (user.status === "active") {
    await regenerate(req);
    req.session.userId = user.id;
    req.session.authVersion = user.authVersion || 0;
    req.session.roleAuthVersion = role?.authVersion || 0;
    req.session.cookie.maxAge = idleMs(role || { key: "customer" });
    await save(req);
    return res.json({ data: publicUser(user, role), message: "Account is already verified." });
  }

  if (user.status !== "pending_verification") {
    throw new v.HttpError(400, `This account cannot be verified (status: ${user.status}).`);
  }

  if (!user.emailVerification || !user.emailVerification.otpHash) {
    throw new v.HttpError(400, "No pending verification code found. Please request a new code.");
  }

  if (new Date() > user.emailVerification.expiresAt) {
    throw new v.HttpError(400, "Verification code has expired. Please request a new code.", { otp: "Code expired." });
  }

  const expectedHash = createHash("sha256").update(otp).digest("hex");
  if (expectedHash !== user.emailVerification.otpHash) {
    throw new v.HttpError(400, "Incorrect verification code.", { otp: "Incorrect code." });
  }

  user.status = "active";
  user.emailVerification = undefined;
  await user.save();

  await regenerate(req);
  req.session.userId = user.id;
  req.session.authVersion = user.authVersion || 0;
  req.session.roleAuthVersion = role?.authVersion || 0;
  req.session.cookie.maxAge = idleMs(role || { key: "customer" });
  await save(req);

  res.json({
    data: publicUser(user, role),
    message: "Email verified successfully! You are now signed in."
  });
}

// Gửi lại mã OTP xác minh
async function resendVerification(req, res) {
  v.keys(req.body, ["email"]);
  const email = v.email(req.body.email);

  const user = await User.findOne({ email });
  if (!user) {
    throw new v.HttpError(404, "User account not found.");
  }

  if (user.status === "active") {
    return res.json({ data: { message: "Account is already verified." } });
  }

  const otp = Math.floor(100000 + Math.random() * 900000).toString();
  const otpHash = createHash("sha256").update(otp).digest("hex");
  user.emailVerification = {
    otpHash,
    expiresAt: new Date(Date.now() + 15 * 60 * 1000),
  };
  await user.save();

  try {
    const { email: sendMail } = require("../services/notifications");
    if (typeof sendMail === "function") {
      const html = `
        <div style="font-family: Arial, sans-serif; max-width: 500px; margin: 0 auto; padding: 24px; border: 1px solid #e2e8f0; border-radius: 10px; background: #ffffff;">
          <h2 style="color: #0f2742; margin-top: 0; font-size: 22px;">Grand<span style="color: #c8923b;">Stay</span> Hotels</h2>
          <p style="font-size: 15px; color: #334155;">Hello <strong>${user.customerProfile?.fullName || user.username || 'Valued Guest'}</strong>,</p>
          <p style="color: #475569; font-size: 14px; line-height: 1.5;">Here is your new 6-digit verification code to activate your account:</p>
          <div style="background: #f8fafc; border: 1px dashed #cbd5e1; padding: 18px; text-align: center; border-radius: 8px; margin: 24px 0;">
            <span style="font-size: 34px; font-weight: bold; letter-spacing: 8px; color: #0284c7;">${otp}</span>
          </div>
          <p style="color: #64748b; font-size: 13px;">This verification code is valid for <strong>15 minutes</strong>.</p>
          <hr style="border: none; border-top: 1px solid #f1f5f9; margin: 20px 0;" />
          <small style="color: #94a3b8; font-size: 12px;">© 2026 GrandStay Hotel & Resort. Da Nang, Vietnam.</small>
        </div>
      `;
      await sendMail(
        user.email,
        "GrandStay - Email Verification Code",
        `Your new verification code is: ${otp}. This code expires in 15 minutes.`,
        html,
      );
    }
  } catch (e) {
    console.error("Failed to resend verification email:", e.message);
  }

  res.json({
    data: {
      message: "A new verification code has been sent to your email.",
      email: user.email,
    },
  });
}

module.exports = {
  register,
  verifyEmail,
  resendVerification,
  login,
  logout,
  profile,
  updateProfile,
  changePassword,
  forgotPassword,
  resetPassword,
};
