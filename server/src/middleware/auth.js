const User = require("../models/User");
const Role = require("../models/Role");
const { HttpError } = require("../utils/validation");
const { sign, verify } = require("../utils/jwt");
// Loại dữ liệu xác thực trước khi trả tài khoản cho client.
function publicUser(user, role) {
  const data = user.toObject ? user.toObject() : { ...user };
  delete data.passwordHash;
  delete data.authVersion;
  delete data.passwordReset;
  delete data.failedLogins;
  delete data.lockedUntil;
  delete data.emailVerification;
  if (data.customerProfile) delete data.customerProfile.idDocumentNo;
  return {
    ...data,
    role: role.key,
    permissions: role.permissions,
    roleName: role.name,
    scope: role.scope,
  };
}
// SDS: the JWT travels in an httpOnly cookie (no token in JavaScript, so XSS cannot steal it); it carries the
// user's tokenVersion (authVersion) and the role's version, so deactivation, blacklist, role or permission change
// and logout end every session of the user at once (BR-25).
const COOKIE = "hotel.token";
const idleMs = (role) => (role.key === "customer" ? 30 : 15) * 60 * 1000; // SRS 4.2.4
const cookieOptions = (req) => ({ httpOnly: true, sameSite: "lax", secure: Boolean(req.app.get("production")), path: "/" });
const readCookie = (req) => (req.headers.cookie || "").split(/;\s*/).find((c) => c.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1);
const tokenClaims = (req) => verify(readCookie(req), req.app.get("jwtSecret"));
// Sliding idle timeout: every authenticated request receives a fresh token valid 15 (staff) or 30 (customer) minutes.
function issueToken(req, res, user, role) {
  const ttl = idleMs(role);
  const token = sign({ sub: String(user._id), ver: user.authVersion || 0, rver: role.authVersion || 0 }, req.app.get("jwtSecret"), ttl);
  res.cookie(COOKIE, token, { ...cookieOptions(req), maxAge: ttl });
}
const clearToken = (req, res) => res.clearCookie(COOKIE, cookieOptions(req));

// Kiểm tra token, tài khoản và phiên bản quyền ở mỗi yêu cầu.
async function authenticate(req, res, next) {
  const claims = tokenClaims(req);
  const user = claims && (await User.findById(claims.sub).select("+authVersion"));
  if (!user || user.status !== "active" || (user.authVersion || 0) !== claims.ver)
    throw new HttpError(401, "Your session has ended. Please sign in.");
  const role = await Role.findOne({ _id: user.roleId, isActive: true });
  if (!role)
    throw new HttpError(
      401,
      "Your role is unavailable. Contact an administrator.",
    );
  if ((claims.rver || 0) !== (role.authVersion || 0))
    throw new HttpError(401, "Your permissions have changed. Please sign in again.");
  req.user = user;
  req.role = role;
  issueToken(req, res, user, role);
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

module.exports = { authenticate, permit, publicUser, requireManager, requirePasswordChanged, issueToken, clearToken, tokenClaims };
