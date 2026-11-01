const User = require("../models/User");
const Role = require("../models/Role");
const { HttpError } = require("../utils/validation");
function publicUser(user, role) {
  const data = user.toObject ? user.toObject() : { ...user };
  delete data.passwordHash;
  delete data.authVersion;
  if (data.customerProfile) delete data.customerProfile.idDocumentNo;
  return {
    ...data,
    role: role.key,
    permissions: role.permissions,
    roleName: role.name,
    scope: role.scope,
  };
}
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
  req.user = user;
  req.role = role;
  next();
}
const permit = (permission) => (req, res, next) => {
  if (!req.role.permissions.includes(permission))
    throw new HttpError(403, "You do not have permission to use this feature.");
  next();
};
module.exports = { authenticate, permit, publicUser };
