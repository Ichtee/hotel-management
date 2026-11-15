const Notification = require("../models/Notification");
const User = require("../models/User");
const Role = require("../models/Role");

// Gửi thông báo sau khi giao dịch hoàn tất; lỗi gửi không làm mất dữ liệu nghiệp vụ.
async function deliver(events) {
  let stored = true;
  for (const event of events) {
    try {
      let accountIds = event.accountIds || [];
      if (event.roles) {
        const roles = await Role.find({ key: { $in: event.roles }, isActive: true }).distinct("_id");
        const users = await User.find({ roleId: { $in: roles }, status: "active" }).select("_id").lean();
        accountIds = users.map((u) => u._id);
      }
      if (accountIds.length) await Notification.insertMany([...new Set(accountIds.map(String))].map((accountId) => ({
        accountId, type: event.type, title: event.title, message: event.message, roomId: event.roomId,
      })));
    } catch {
      stored = false;
      console.error("An operation notification could not be stored.");
    }
  }
  return stored;
}
module.exports = { deliver };
