const { randomUUID } = require("node:crypto");
const User = require("../models/User");
const Role = require("../models/Role");
const v = require("../utils/validation");
const { hashPassword } = require("../utils/password");
const { editableRoles } = require("../services/staffPermissions");
const { staffView, createStaff, updateStaff } = require("../services/staff");

// Chỉ nhận các trường quản lý được phép sửa trên tài khoản nhân viên.
function validate(body, creating = false) {
  v.keys(body, ["fullName", "email", "phone", "role", "status", "reason", "position", "shift", "hireDate",
    ...(creating ? ["username", "password"] : [])]);
  const data = {};
  if (!Object.keys(body).length) v.fail("Provide at least one field.");
  if (creating || body.fullName !== undefined) data.fullName = v.text(body.fullName, "fullName", 2, 50);
  if (creating || body.email !== undefined) data.email = v.email(body.email);
  if (creating || body.phone !== undefined) data.phone = v.phone(body.phone, true);
  if (creating || body.role !== undefined) data.role = v.choice(body.role, "role", editableRoles);
  if (body.status !== undefined) data.status = v.choice(body.status, "status", ["active", "suspended"]);
  if (body.reason !== undefined) data.reason = v.text(body.reason, "reason", 1, 500);
  if (body.reason !== undefined && body.status === undefined) v.fail("A status is required with the reason.", "status");
  for (const field of ["position", "shift"])
    if (body[field] !== undefined) data[field] = v.text(body[field], field, 0, 100);
  if (body.hireDate !== undefined) data.hireDate = body.hireDate === null || body.hireDate === "" ? null : v.date(body.hireDate, "hireDate");
  if (creating) {
    data.username = body.username === undefined ? `staff_${randomUUID().replaceAll("-", "")}` : v.username(body.username);
    v.password(body.password);
    if (data.status === "suspended" && !data.reason) v.fail("A reason is required for an inactive account.", "reason");
  }
  return data;
}

// Tìm nhân viên bằng dữ liệu đã kiểm tra, kèm phân trang.
async function listing(req, res) {
  v.keys(req.query, ["q", "page", "limit", "status", "role"]);
  const roles = await Role.find({ key: { $in: editableRoles } }).lean();
  const regex = v.search(req.query);
  const filter = { roleId: { $in: roles.map((r) => r._id) }, $or: [
    { username: regex }, { email: regex }, { "customerProfile.fullName": regex },
  ] };
  if (req.query.status !== undefined) filter.status = v.choice(req.query.status, "status", ["active", "suspended"]);
  if (req.query.role !== undefined) {
    const key = v.choice(req.query.role, "role", editableRoles);
    filter.roleId = { $in: roles.filter((r) => r.key === key).map((r) => r._id) };
  }
  const result = await v.list(User, filter, req.query);
  result.data = result.data.map((u) => staffView(u, roles.find((r) => String(r._id) === String(u.roleId))));
  res.json(result);
}

// Trả chi tiết tài khoản thuộc đúng hai vai trò nhân viên.
async function detail(req, res) {
  const roles = await Role.find({ key: { $in: editableRoles } }).lean();
  const user = await User.findOne({ _id: v.id(req.params.id), roleId: { $in: roles.map((r) => r._id) } }).lean();
  if (!user) throw new v.HttpError(404, "Staff account not found.");
  res.json({ data: staffView(user, roles.find((r) => String(r._id) === String(user.roleId))) });
}

// Tạo nhân viên với mật khẩu tạm đã băm.
async function create(req, res) {
  const data = validate(req.body, true);
  const passwordHash = await hashPassword(req.body.password);
  res.status(201).json({ data: await createStaff(req, data, passwordHash) });
}

// Cập nhật nhân viên sau khi kiểm tra toàn bộ dữ liệu.
async function update(req, res) {
  res.json(await updateStaff(req, validate(req.body)));
}

// Giữ API cũ nhưng yêu cầu lý do và chỉ vô hiệu hóa tài khoản.
async function deactivate(req, res) {
  v.keys(req.body, ["reason"]);
  const reason = v.text(req.body.reason, "reason", 1, 500);
  res.json(await updateStaff(req, { status: "suspended", reason }));
}

module.exports = { listing, detail, create, update, deactivate };
