const User = require("../models/User");
const Role = require("../models/Role");
const CleaningTask = require("../models/CleaningTask");
const HousekeepingAssignment = require("../models/HousekeepingAssignment");
const Notification = require("../models/Notification");
const { editableRoles } = require("./staffPermissions");
const { logChange } = require("./audit");
const v = require("../utils/validation");
const { hotelTransaction } = require("./hotelOperations");
const { planEnd } = require("../utils/hotelTime");

// Chỉ xuất thông tin nhân viên, không lộ dữ liệu xác thực hoặc khách hàng.
function staffView(user, role) {
  user = user.toObject ? user.toObject() : user;
  return {
    _id: user._id, username: user.username, email: user.email, phone: user.phone,
    customerProfile: { fullName: user.customerProfile?.fullName },
    employeeProfile: user.employeeProfile,
    roleId: user.roleId, role: role.key, status: user.status,
    statusReason: user.statusReason, mustChangePassword: user.mustChangePassword,
    createdAt: user.createdAt, updatedAt: user.updatedAt,
  };
}

// Giới hạn vai trò đích theo UC22, kể cả khi vai trò cũ đang bị tắt.
async function staffRole(key, session, requireActive = true) {
  v.choice(key, "role", editableRoles);
  const role = await Role.findOne({ key, ...(requireActive ? { isActive: true } : {}) }).session(session);
  if (!role) v.fail("Select an active staff role.", "role");
  return role;
}

// UC22 3b / BR-41: thu hồi phân công còn hiệu lực; task Assigned hoặc In Progress về Pending, task đã đóng giữ nguyên.
async function releaseResponsibilities(userId, req, reason, session) {
  const now = new Date();
  const tasks = await CleaningTask.updateMany(
    { assignedTo: userId, status: { $in: ["assigned", "pending", "in_progress"] } },
    { $set: { status: "pending" }, $unset: { assignedTo: 1, assignedBy: 1, assignmentId: 1, assignmentDate: 1, assignmentShift: 1 } },
    { session },
  );
  const activePlans = await HousekeepingAssignment.find({ staffId: userId, isActive: true }).session(session).lean();
  const planIds = activePlans.filter((plan) => planEnd(plan) > now).map((plan) => plan._id);
  const plans = await HousekeepingAssignment.updateMany(
    { _id: { $in: planIds } },
    { $set: { isActive: false, revokedAt: now, revokedBy: req.user._id, revocationReason: reason } },
    { session },
  );
  return { pendingTasks: tasks.modifiedCount, revokedAssignments: plans.modifiedCount };
}

// Gửi cảnh báo sau khi lưu; lỗi thông báo không hủy thay đổi tài khoản.
async function notifyResponsibilityChange(user, changes) {
  try {
    const role = await Role.findOne({ key: "manager", isActive: true });
    if (!role) return true;
    const managers = await User.find({ roleId: role._id, status: "active" }).select("_id").lean();
    if (managers.length) await Notification.insertMany(managers.map((manager) => ({
      accountId: manager._id,
      type: "staff_responsibility_released",
      title: "Housekeeping responsibility needs review",
      message: `${user.customerProfile.fullName}: ${changes.pendingTasks} open tasks returned to Pending and ${changes.revokedAssignments} assignments revoked. Give the rooms to other staff in the responsibility plan.`,
    })));
    return true;
  } catch {
    console.error("Staff responsibility notification could not be stored.");
    return false;
  }
}

// Lưu tài khoản và audit log trong cùng giao dịch.
async function createStaff(req, data, passwordHash) {
  return User.db.transaction(async (session) => {
    const role = await staffRole(data.role, session);
    const [user] = await User.create([{
      username: data.username, email: data.email, phone: data.phone,
      passwordHash, roleId: role._id, status: data.status || "active",
      statusReason: data.reason, mustChangePassword: true, isVerified: true,
      customerProfile: { fullName: data.fullName },
      employeeProfile: { position: data.position, shift: data.shift, hireDate: data.hireDate },
    }], { session });
    const result = staffView(user, role);
    await logChange(req, "staff.created", "User", user._id, { after: result }, session);
    return result;
  });
}

// Thay đổi nhân viên, thu hồi phiên và phân công một cách nguyên tử.
async function updateStaff(req, data) {
  const result = await hotelTransaction(async (session) => {
    const roles = await Role.find({ key: { $in: editableRoles } }).session(session);
    const user = await User.findOne({ _id: v.id(req.params.id), roleId: { $in: roles.map((r) => r._id) } })
      .select("+authVersion").session(session);
    if (!user) throw new v.HttpError(404, "Staff account not found.");
    const oldRole = roles.find((r) => String(r._id) === String(user.roleId));
    const roleChanged = data.role !== undefined && data.role !== oldRole.key;
    const role = roleChanged ? await staffRole(data.role, session) : oldRole;
    const statusChanged = data.status !== undefined && data.status !== user.status;
    if ((statusChanged || (data.status !== undefined && data.status !== "active")) && !data.reason)
      v.fail("A reason is required when changing account status.", "reason");
    if (data.status === "active" && !role.isActive)
      v.fail("Cannot activate an account whose role is inactive.", "role");
    const before = staffView(user, oldRole);
    for (const key of ["email", "phone", "status"])
      if (data[key] !== undefined) user[key] = data[key];
    if (data.fullName !== undefined) user.customerProfile.fullName = data.fullName;
    for (const key of ["position", "shift", "hireDate"])
      if (data[key] !== undefined) user.set(`employeeProfile.${key}`, data[key]);
    if (data.reason !== undefined && data.status !== undefined) user.statusReason = data.reason;
    user.roleId = role._id;
    if (statusChanged || roleChanged) user.authVersion = (user.authVersion || 0) + 1;
    const release = oldRole.key === "housekeeping" &&
      ((statusChanged && user.status !== "active") || roleChanged);
    const responsibility = release
      ? await releaseResponsibilities(user._id, req, data.reason || "Staff role changed.", session)
      : null;
    await user.save({ session });
    const after = staffView(user, role);
    await logChange(req, "staff.updated", "User", user._id, { before, after, reason: data.reason, responsibility }, session);
    return { data: after, responsibility };
  });
  if (result.responsibility) {
    const notified = await notifyResponsibilityChange(result.data, result.responsibility);
    result.meta = { responsibility: result.responsibility, notificationStored: notified };
  }
  delete result.responsibility;
  return result;
}

module.exports = { staffView, createStaff, updateStaff };
