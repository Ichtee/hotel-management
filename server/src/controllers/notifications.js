const Notification = require("../models/Notification");
const v = require("../utils/validation");

// Chỉ trả thông báo của người đang đăng nhập, mới nhất trước.
async function listing(req, res) {
  v.keys(req.query, ["page", "limit", "unread"]);
  const filter = { accountId: req.user._id };
  if (req.query.unread === "true") filter.isRead = false;
  const [result, unread] = await Promise.all([
    v.list(Notification, filter, req.query),
    Notification.countDocuments({ accountId: req.user._id, isRead: false }),
  ]);
  res.json({ ...result, meta: { ...result.meta, unread } });
}
// Mở thông báo thì đánh dấu đã đọc; không gửi mã thì đánh dấu tất cả.
async function markRead(req, res) {
  v.keys(req.body || {}, ["id"]);
  const filter = { accountId: req.user._id, isRead: false };
  if (req.body?.id !== undefined) filter._id = v.id(req.body.id, "id");
  const result = await Notification.updateMany(filter, { $set: { isRead: true, readAt: new Date() } });
  res.json({ data: { updated: result.modifiedCount } });
}
module.exports = { listing, markRead };
