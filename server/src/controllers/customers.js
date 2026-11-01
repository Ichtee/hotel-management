const User = require("../models/User");
const Role = require("../models/Role");
const AuditLog = require("../models/AuditLog");
const v = require("../utils/validation");
const managerOnly = (req) => { if (req.role.key !== "manager") throw new v.HttpError(403, "Only a hotel manager can manage customer accounts."); };
async function list(req, res) {
  managerOnly(req); const role = await Role.findOne({ key: "customer" }); const regex = v.search(req.query); const status = req.query.status ? v.choice(req.query.status, "status", ["active", "suspended"]) : undefined; const { page, limit } = v.pagination(req.query);
  const filter = { roleId: role._id, ...(status ? { status } : {}), $or: [{ username: regex }, { email: regex }, { "customerProfile.fullName": regex }] };
  const [data, total] = await Promise.all([User.find(filter).select("username email phone status customerProfile.fullName blacklistReason blacklistedAt createdAt").sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(), User.countDocuments(filter)]);
  res.json({ data, meta: { page, limit, total, pages: Math.max(1, Math.ceil(total / limit)) } });
}
async function blacklist(req, res) {
  managerOnly(req); v.keys(req.body, ["action", "reason"]); const action = v.choice(req.body.action, "action", ["blacklist", "restore"]); const reason = v.text(req.body.reason, "reason", 2, 250); const role = await Role.findOne({ key: "customer" }); const user = await User.findOne({ _id: v.id(req.params.id), roleId: role._id });
  if (!user) throw new v.HttpError(404, "Customer not found.");
  user.status = action === "blacklist" ? "suspended" : "active"; user.blacklistReason = reason; user.blacklistedAt = action === "blacklist" ? new Date() : undefined; user.authVersion = (user.authVersion || 0) + 1;
  await user.save(); await AuditLog.create({ actorId: req.user._id, action: action === "blacklist" ? "customer_blacklisted" : "customer_restored", targetType: "User", targetId: user._id, ip: req.ip, detail: { reason } });
  res.json({ data: { _id: user.id, status: user.status, blacklistReason: user.blacklistReason } });
}
module.exports = { list, blacklist };
