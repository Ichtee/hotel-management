const AuditLog = require("../models/AuditLog");
const User = require("../models/User");
const v = require("../utils/validation");

// UC32 step 5: the Admin reads the audit log (read-only), filtered by actor, action, target and date.
async function listing(req, res) {
  if (req.role.key !== "admin") throw new v.HttpError(403, "Only the Admin can view the audit log.");
  v.keys(req.query, ["actor", "action", "targetType", "from", "to", "page", "limit"]);
  const filter = {};
  const like = (s) => new RegExp(String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
  if (req.query.action) filter.action = like(req.query.action);
  if (req.query.targetType) filter.targetType = like(req.query.targetType);
  if (req.query.actor) {
    const ids = await User.find({ $or: [{ email: like(req.query.actor) }, { "customerProfile.fullName": like(req.query.actor) }] }).distinct("_id");
    filter.actorId = { $in: ids };
  }
  const day = (s, name) => { const d = new Date(`${s}T00:00:00+07:00`); if (Number.isNaN(+d)) v.fail("Use a valid date.", name); return d; };
  if (req.query.from || req.query.to) filter.createdAt = {};
  if (req.query.from) filter.createdAt.$gte = day(req.query.from, "from");
  if (req.query.to) filter.createdAt.$lt = new Date(day(req.query.to, "to").getTime() + 86400000);
  const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 200);
  const page = Math.max(Number(req.query.page) || 1, 1);
  const [data, total] = await Promise.all([
    AuditLog.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit)
      .populate("actorId", "email customerProfile.fullName").lean(),
    AuditLog.countDocuments(filter),
  ]);
  res.json({ data, meta: { page, limit, total } });
}

module.exports = { listing };
