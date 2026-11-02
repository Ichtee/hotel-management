const User = require("../models/User");
const Role = require("../models/Role");
const { HttpError } = require("../utils/validation");
// Loại dữ liệu xác thực trước khi trả tài khoản cho client.
function publicUser(user, role) {
  const data = user.toObject ? user.toObject() : { ...user };
  delete data.passwordHash;
  delete data.authVersion;
  delete data.passwordReset;
  if (data.customerProfile) delete data.customerProfile.idDocumentNo;
  return {
    ...data,
    role: role.key,
    permissions: role.permissions,
    roleName: role.name,
    scope: role.scope,
  };
}
// Kiểm tra tài khoản và phiên bản quyền ở mỗi yêu cầu.
async function authenticate(req, res, next) {
  const user =
    req.session.userId &&
    (await User.findById(req.session.userId).select("+authVersion"));
  if (
    !user ||
    user.status !== "active" ||
    (user.authVersion || 0) !== req.session.authVersion
  )
    throw new HttpError(401, "Your session has ended. Please sign in.");
  const role = await Role.findOne({ _id: user.roleId, isActive: true });
  if (!role)
    throw new HttpError(
      401,
      "Your role is unavailable. Contact an administrator.",
    );
  if ((req.session.roleAuthVersion || 0) !== (role.authVersion || 0))
    throw new HttpError(401, "Your permissions have changed. Please sign in again.");
  req.user = user;
  req.role = role;
  next();
}
// Chặn API khi tài khoản không có quyền nghiệp vụ yêu cầu.
const permit = (permission) => (req, res, next) => {
  if (!req.role.permissions.includes(permission))
    throw new HttpError(403, "You do not have permission to use this feature.");
  next();
};
// Quyền quản lý nhân viên luôn thuộc Hotel Manager theo UC22 và UC33.
function requireManager(req, res, next) {
  if (req.role.key !== "manager") throw new HttpError(403, "Only a Hotel Manager can manage staff.");
  next();
}

// Mật khẩu tạm chỉ được dùng để xem tài khoản và đổi mật khẩu.
function requirePasswordChanged(req, res, next) {
  if (req.user.mustChangePassword) {
    const error = new HttpError(403, "Change your temporary password before using this feature.");
    error.code = "PASSWORD_CHANGE_REQUIRED";
    throw error;
  }
  next();
}

module.exports = { authenticate, permit, publicUser, requireManager, requirePasswordChanged };
