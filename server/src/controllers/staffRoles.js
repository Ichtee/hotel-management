const Role = require("../models/Role");
const { editableRoles, staffPermissionCatalog, allowedStaffPermissions } = require("../services/staffPermissions");
const { logChange } = require("../services/audit");
const v = require("../utils/validation");

// Chỉ liệt kê hai vai trò và các quyền nghiệp vụ được phép cấp.
async function listing(req, res) {
  const data = await Role.find({ key: { $in: editableRoles } }).select("key name permissions isActive").sort({ key: 1 }).lean();
  res.json({ data, meta: { permissions: staffPermissionCatalog, personalAccountAccess: "always_enabled" } });
}

// Đổi quyền, tăng phiên bản xác thực và ghi nhật ký trong cùng giao dịch.
async function updatePermissions(req, res) {
  v.keys(req.body, ["permissions"]);
  const input = req.body.permissions;
  if (!Array.isArray(input) || input.length > staffPermissionCatalog.length ||
      input.some((p) => typeof p !== "string" || !allowedStaffPermissions.has(p)))
    throw new v.HttpError(403, "Only the staff business permissions in SRS 2.4.3 can be granted.");
  const permissions = [...new Set(input)].sort();
  const id = v.id(req.params.id);
  const data = await Role.db.transaction(async (session) => {
    const role = await Role.findById(id).session(session);
    if (!role) throw new v.HttpError(404, "Role not found.");
    if (!editableRoles.includes(role.key)) throw new v.HttpError(403, "Only Receptionist and Housekeeping permissions can be changed.");
    const before = [...role.permissions].sort();
    if (JSON.stringify(before) !== JSON.stringify(permissions)) {
      role.permissions = permissions;
      role.authVersion = (role.authVersion || 0) + 1;
      await role.save({ session });
      await logChange(req, "staff_role.permissions_changed", "Role", role._id, { role: role.key, before, after: permissions }, session);
    }
    return { _id: role._id, key: role.key, name: role.name, permissions: role.permissions, isActive: role.isActive };
  });
  res.json({ data });
}

module.exports = { listing, updatePermissions };
