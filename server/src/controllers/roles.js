const Role = require("../models/Role");
const User = require("../models/User");
const v = require("../utils/validation");
const { catalog, defaults } = require("../services/roles");
// Kiểm tra cấu hình vai trò theo phạm vi cho phép.
function validate(body, current) {
  v.keys(
    body,
    current
      ? ["name", "permissions", "isActive"]
      : ["key", "name", "scope", "permissions"],
  );
  const data = {};
  if (!current) {
    data.key = v.text(body.key, "key", 2, 40).toLowerCase();
    if (!/^[a-z][a-z0-9_]+$/.test(data.key))
      v.fail("Use lowercase letters, numbers and underscores.", "key");
    data.scope = v.choice(body.scope, "scope", ["self", "hotel"]);
  }
  if (!current || body.name !== undefined)
    data.name = v.text(body.name, "name", 2, 60);
  const scope = current?.scope || data.scope;
  if (!current || body.permissions !== undefined) {
    if (
      !Array.isArray(body.permissions) ||
      body.permissions.some(
        (p) =>
          typeof p !== "string" ||
          !catalog.some((c) => c.key === p && c.scope === scope),
      )
    )
      v.fail("Permissions must match the role scope.", "permissions");
    data.permissions = [...new Set(body.permissions)];
  }
  if (body.isActive !== undefined)
    data.isActive = v.boolean(body.isActive, "isActive");
  if (
    current?.key === "admin" &&
    (data.isActive === false ||
      (data.permissions &&
        ["users.manage", "roles.manage"].some(
          (p) => !data.permissions.includes(p),
        )))
  )
    throw new v.HttpError(409, "Administrator access must remain enabled.");
  return data;
}
// Liệt kê cấu hình vai trò cho API quản trị hiện có.
async function list(req, res) {
  res.json({
    data: await Role.find().sort({ isSystem: -1, name: 1 }).lean(),
    meta: { permissions: catalog },
  });
}
// Tạo vai trò tùy chỉnh, không thay thế vai trò hệ thống.
async function create(req, res) {
  const role = await Role.create(validate(req.body));
  res.status(201).json({ data: role });
}
// Chặn sửa vai trò hệ thống qua API quản trị cũ.
async function update(req, res) {
  const role = await Role.findById(v.id(req.params.id));
  if (!role) throw new v.HttpError(404, "Role not found.");
  if (defaults.some((r) => r.key === role.key))
    throw new v.HttpError(403, "System roles are fixed. Staff permissions use the Hotel Manager API.");
  Object.assign(role, validate(req.body, role));
  await role.save();
  res.json({ data: role });
}
// Chỉ xóa vai trò tùy chỉnh chưa được sử dụng.
async function remove(req, res) {
  const role = await Role.findById(v.id(req.params.id));
  if (!role) throw new v.HttpError(404, "Role not found.");
  if (role.isSystem || (await User.exists({ roleId: role._id })))
    throw new v.HttpError(
      409,
      "System roles and roles assigned to accounts cannot be deleted.",
    );
  await role.deleteOne();
  res.json({ data: { message: "Role deleted." } });
}
module.exports = { list, create, update, remove };
