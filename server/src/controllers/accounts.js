const User = require("../models/User");
const Role = require("../models/Role");
const v = require("../utils/validation");
const { hashPassword } = require("../utils/password");
// Lọc dữ liệu xác thực và giữ tên vai trò trong phản hồi.
const safe = (user, role) => {
  const data = { ...user.toObject(), role: role.key };
  delete data.passwordHash;
  delete data.authVersion;
  delete data.passwordReset;
  if (data.customerProfile) delete data.customerProfile.idDocumentNo;
  return data;
};
const staffRoles = ["receptionist", "housekeeping"];
// Lấy mã vai trò theo danh sách tên đã kiểm tra.
const roleIds = (keys) => Role.find({ key: { $in: keys } }).distinct("_id");
// Tìm vai trò hợp lệ trước khi gán tài khoản.
async function roleFor(key, requireActive = true) {
  const role = await Role.findOne({
    key,
    ...(requireActive ? { isActive: true } : {}),
  });
  if (!role) v.fail("Select an active role.", "role");
  return role;
}
// Kiểm tra các trường cập nhật của API tài khoản cũ.
function editable(body, isStaff, creating) {
  const allowed = [
    "fullName",
    "email",
    "phone",
    "role",
    "status",
    "position",
    "shift",
    "hireDate",
  ];
  if (creating) allowed.push("username", "password");
  v.keys(body, allowed);
  const out = {};
  if (creating) {
    out.username = v.username(body.username);
    v.password(body.password);
  }
  if (creating || body.fullName !== undefined)
    out.fullName = v.text(body.fullName, "fullName", 2, 50);
  if (creating || body.email !== undefined) out.email = v.email(body.email);
  if (creating || body.phone !== undefined)
    out.phone = v.phone(body.phone, isStaff);
  if (body.status !== undefined)
    out.status = v.choice(body.status, "status", [
      "active",
      "suspended",
      "deleted",
    ]);
  if (body.role !== undefined) out.role = v.text(body.role, "role", 2, 40);
  for (const field of ["position", "shift"])
    if (body[field] !== undefined)
      out[field] = v.text(body[field], field, 0, 100);
  if (body.hireDate !== undefined)
    out.hireDate = body.hireDate ? v.date(body.hireDate, "hireDate") : null;
  return out;
}
// Gán các trường đã được kiểm tra vào tài khoản.
function apply(user, data) {
  for (const key of ["username", "email", "phone", "status"])
    if (data[key] !== undefined) user[key] = data[key];
  if (data.fullName !== undefined)
    user.customerProfile.fullName = data.fullName;
  for (const key of ["position", "shift", "hireDate"])
    if (data[key] !== undefined) user.employeeProfile[key] = data[key];
}
// Chặn thông tin nhân sự trên vai trò ngoài khách sạn.
function checkEmployment(body, role) {
  if (role.scope !== "hotel") {
    for (const field of ["position", "shift", "hireDate"])
      if (body[field] !== undefined)
        v.fail("Employment details require a hotel role.", field);
  }
}
// Liệt kê tài khoản theo phạm vi và bộ lọc cho phép.
const listing = (isStaff) => async (req, res) => {
  const regex = v.search(req.query);
  const filter = {
    $or: [
      { username: regex },
      { email: regex },
      { "customerProfile.fullName": regex },
    ],
  };
  if (isStaff) filter.roleId = { $in: await roleIds(staffRoles) };
  else filter.roleId = { $nin: await roleIds(staffRoles) };
  if (req.query.status)
    filter.status = v.choice(req.query.status, "status", [
      "active",
      "suspended",
      "deleted",
    ]);
  if (!isStaff && staffRoles.includes(req.query.role))
    throw new v.HttpError(403, "Staff accounts use the Hotel Manager API.");
  if (req.query.role)
    filter.roleId = {
      $in: await roleIds([
        isStaff
          ? v.choice(req.query.role, "role", staffRoles)
          : v.text(req.query.role, "role", 2, 40),
      ]),
    };
  const result = await v.list(User, filter, req.query);
  const keys = new Map(
    (await Role.find().select("key").lean()).map((r) => [String(r._id), r.key]),
  );
  for (const u of result.data) u.role = keys.get(String(u.roleId));
  res.json(result);
};
// Tạo tài khoản và chặn đường vòng quản lý nhân viên qua API cũ.
const create = (isStaff) => async (req, res) => {
  const data = editable(req.body, isStaff, true);
  const role = await roleFor(data.role || "customer");
  if (!isStaff && staffRoles.includes(role.key))
    throw new v.HttpError(403, "Staff accounts must be managed by the Hotel Manager through /api/staff.");
  checkEmployment(req.body, role);
  if (isStaff) v.choice(role.key, "role", staffRoles);
  if (role.scope === "hotel") data.phone = v.phone(req.body.phone, true);
  const user = new User({
    roleId: role._id,
    isVerified: true,
    passwordHash: await hashPassword(req.body.password),
  });
  apply(user, data);
  await user.save();
  res.status(201).json({ data: safe(user, role) });
};
// Cập nhật tài khoản và thu hồi phiên khi quyền truy cập thay đổi.
const update = (isStaff) => async (req, res) => {
  const data = editable(req.body, isStaff, false);
  const filter = { _id: v.id(req.params.id) };
  if (isStaff) filter.roleId = { $in: await roleIds(staffRoles) };
  const user = await User.findOne(filter).select("+authVersion");
  if (!user) throw new v.HttpError(404, "Account not found.");
  const currentKey = (await Role.findById(user.roleId).select("key"))?.key;
  if (!isStaff && (staffRoles.includes(currentKey) || staffRoles.includes(data.role)))
    throw new v.HttpError(403, "Staff accounts must be managed by the Hotel Manager through /api/staff.");
  if (
    currentKey === "admin" &&
    ((data.role && data.role !== "admin") ||
      (data.status && data.status !== "active"))
  )
    throw new v.HttpError(
      409,
      "Administrator accounts cannot be demoted or deactivated here.",
    );
  if (isStaff && data.role) v.choice(data.role, "role", staffRoles);
  const role = await roleFor(
    data.role || currentKey,
    Boolean(data.role && data.role !== currentKey),
  );
  checkEmployment(req.body, role);
  if (role.scope !== "hotel") user.employeeProfile = undefined;
  if (role.scope === "hotel") v.phone(data.phone ?? user.phone, true);
  if (
    (data.role && data.role !== currentKey) ||
    (data.status && data.status !== user.status)
  )
    user.authVersion = (user.authVersion || 0) + 1;
  user.roleId = role._id;
  apply(user, data);
  await user.save();
  res.json({ data: safe(user, role) });
};
// Trả các vai trò phù hợp với tài khoản hiện tại.
async function options(req, res) {
  const roles = await Role.find({
    isActive: true,
    ...(req.role.scope === "system" ? {} : { key: { $in: staffRoles } }),
  })
    .select("key name scope")
    .lean();
  res.json({ data: { roles } });
}
module.exports = { listing, create, update, options };
