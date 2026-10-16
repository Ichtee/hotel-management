const Notification = require("../models/Notification");
const v = require("../utils/validation");
async function listing(req, res) {
  const filter = { accountId: req.user._id };
  if (req.query.unread === "true") filter.isRead = false;
  const result = await v.list(Notification, filter, req.query);
  result.meta.unread = await Notification.countDocuments({ accountId: req.user._id, isRead: false });
  res.json(result);
}
async function markRead(req, res) {
  const doc = await Notification.findOneAndUpdate(
    { _id: v.id(req.params.id), accountId: req.user._id },
    { isRead: true, readAt: new Date() },
    { new: true },
  );
  if (!doc) throw new v.HttpError(404, "Notification not found.");
  res.json({ data: doc });
}
module.exports = { listing, markRead };
