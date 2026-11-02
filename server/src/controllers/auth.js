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
  const role = await Role.findOne({ key: "customer", isActive: true });
  if (!role)
    throw new v.HttpError(409, "Registration is currently unavailable.");
  const user = await User.create({
    ...data,
    passwordHash: await hashPassword(body.password),
    roleId: role._id,
  });
  res.status(201).json({ data: publicUser(user, role) });
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
module.exports = {
  register,
  login,
  logout,
  profile,
  updateProfile,
  changePassword,
  forgotPassword,
  resetPassword,
};
