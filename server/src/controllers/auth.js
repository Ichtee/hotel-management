const User = require("../models/User");
const Role = require("../models/Role");
const v = require("../utils/validation");
const { hashPassword, verifyPassword } = require("../utils/password");
const { publicUser } = require("../middleware/auth");
const regenerate = (req) =>
  new Promise((resolve, reject) =>
    req.session.regenerate((e) => (e ? reject(e) : resolve())),
  );
const save = (req) =>
  new Promise((resolve, reject) =>
    req.session.save((e) => (e ? reject(e) : resolve())),
  );
async function register(req, res) {
  v.keys(req.body, ["username", "email", "fullName", "password", "phone"]);
  const { body } = req;
  const data = {
    username: v.username(body.username),
    email: v.email(body.email),
    phone: v.phone(body.phone),
    customerProfile: { fullName: v.text(body.fullName, "fullName", 2, 50) },
  };
  v.password(body.password);
  const role = await Role.findOne({ key: "customer", isActive: true });
  if (!role)
    throw new v.HttpError(409, "Registration is currently unavailable.");
  const user = await User.create({
    ...data,
    passwordHash: await hashPassword(body.password),
    role: "customer",
  });
  res.status(201).json({ data: publicUser(user, role) });
}
async function login(req, res) {
  v.keys(req.body, ["email", "password"]);
  const email = v.email(req.body.email);
  v.text(req.body.password, "password", 1, 128);
  const password = req.body.password;
  const user = await User.findOne({ email }).select(
    "+passwordHash +authVersion",
  );
  // Perform a real derivation even when the account is absent.
  const valid = await verifyPassword(
    password,
    user?.passwordHash || `scrypt:${"0".repeat(32)}:${"0".repeat(128)}`,
  );
  const role = user && (await Role.findOne({ key: user.role, isActive: true }));
  if (!valid || user.status !== "active" || !role)
    throw new v.HttpError(
      401,
      "Email or password is incorrect, or your account is inactive.",
    );
  await regenerate(req);
  req.session.userId = user.id;
  req.session.authVersion = user.authVersion || 0;
  user.lastLogin = new Date();
  await user.save();
  await save(req);
  res.json({ data: publicUser(user, role) });
}
async function logout(req, res) {
  await new Promise((resolve, reject) =>
    req.session.destroy((e) => (e ? reject(e) : resolve())),
  );
  res.clearCookie("hotel.sid", { path: "/" });
  res.json({ data: { message: "Signed out." } });
}
async function profile(req, res) {
  res.json({ data: publicUser(req.user, req.role) });
}
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
async function changePassword(req, res) {
  v.keys(req.body, ["currentPassword", "newPassword"]);
  v.text(req.body.currentPassword, "currentPassword", 1, 128);
  const current = req.body.currentPassword;
  const next = v.password(req.body.newPassword, "newPassword");
  const u = await User.findById(req.user.id).select(
    "+passwordHash +authVersion",
  );
  if (!(await verifyPassword(current, u.passwordHash)))
    v.fail("Current password is incorrect.", "currentPassword");
  if (current === next)
    v.fail("Choose a different new password.", "newPassword");
  u.passwordHash = await hashPassword(next);
  u.authVersion = (u.authVersion || 0) + 1;
  await u.save();
  await regenerate(req);
  req.session.userId = u.id;
  req.session.authVersion = u.authVersion;
  await save(req);
  res.json({
    data: { message: "Password changed. Other sessions have been signed out." },
  });
}
module.exports = {
  register,
  login,
  logout,
  profile,
  updateProfile,
  changePassword,
};
