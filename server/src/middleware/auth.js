const User = require("../models/User");
const Role = require("../models/Role");
const Hotel = require("../models/Hotel");
const { HttpError } = require("../utils/validation");
function publicUser(user, role) {
  const data = user.toObject ? user.toObject() : { ...user };
  delete data.passwordHash;
  delete data.authVersion;
  if (data.customerProfile) delete data.customerProfile.idDocumentNo;
  return {
    ...data,
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
  const role = await Role.findOne({ key: user.role, isActive: true });
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
async function hotelScope(req, res, next) {
  const hotelId = req.user.employeeProfile?.hotelId;
  if (
    req.role.scope !== "hotel" ||
    !hotelId ||
    !(await Hotel.exists({ _id: hotelId }))
  )
    throw new HttpError(403, "An active hotel assignment is required.");
  req.hotelId = hotelId;
  next();
}
module.exports = { authenticate, permit, hotelScope, publicUser };
