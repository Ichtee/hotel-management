const Notification = require("../models/Notification");
const v = require("../utils/validation");

// UC13: every user reads only their own notifications, newest first (BR-28).
async function listing(req, res) {
  const [data, unread] = await Promise.all([
    Notification.find({ accountId: req.user._id }).sort({ createdAt: -1 }).limit(50).lean(),
    Notification.countDocuments({ accountId: req.user._id, isRead: false }),
  ]);
  res.json({ data, meta: { unread } });
}
// UC13 step 3: opening a notification marks it read; no id marks them all read.
async function markRead(req, res) {
  v.keys(req.body || {}, ["id"]);
  const filter = { accountId: req.user._id, isRead: false };
  if (req.body?.id !== undefined) filter._id = v.id(req.body.id, "id");
  const result = await Notification.updateMany(filter, { $set: { isRead: true, readAt: new Date() } });
  res.json({ data: { updated: result.modifiedCount } });
}
module.exports = { listing, markRead };
