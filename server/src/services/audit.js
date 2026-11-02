const AuditLog = require("../models/AuditLog");

// Ghi lịch sử cùng giao dịch nghiệp vụ, chỉ nhận chi tiết đã lọc.
async function logChange(req, action, targetType, targetId, detail, session) {
  await AuditLog.create([{
    actorId: req.user._id,
    action,
    targetType,
    targetId,
    ip: req.ip,
    detail,
  }], { session });
}

// M3 (cancellations, refunds, jobs): actorId null = a scheduled job.
const audit = (actorId, action, targetType, targetId, detail) =>
  AuditLog.create({ actorId: actorId || undefined, action, targetType, targetId, detail });

module.exports = { logChange, audit };
