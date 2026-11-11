const { autoApprove, expireHolds } = require("./cancellations");
const { reconcileDaily } = require("./payments");
const { processNoShows } = require("./noShows");
const { arrivalReminders } = require("./reminders");
const { waiveUnpaid } = require("./penalties");
const { runHousekeepingTick } = require("./housekeepingTasks");
// Đăng ký các tác vụ nền dùng chung cho bộ hẹn giờ và cron bên ngoài.
const jobs = {
  // Duyệt hủy mỗi năm phút.
  "cancellation-auto-approval": autoApprove,
  // Đối soát thanh toán lúc 04:15 hằng ngày.
  "payment-reconciliation": reconcileDaily,
  // Xử lý khách không đến lúc 06:00 hằng ngày.
  "no-show-processing": processNoShows,
  // Kiểm tra hết hạn giữ phòng mỗi phút.
  "hold-expiry": expireHolds,
  // Gửi nhắc lịch lúc 09:00 hằng ngày.
  "arrival-reminder": arrivalReminders,
  // Miễn bồi thường quá hạn lúc 04:30 hằng ngày.
  "penalty-waiver": waiveUnpaid,
  // Kiểm tra và phân công housekeeping mỗi năm phút từ cron ngoài.
  "housekeeping-tick": (now) => runHousekeepingTick(now),
  // Tạo dọn định kỳ lúc 07:00, có thể chạy bù khi lỡ lịch.
  "routine-tasks": (now) => runHousekeepingTick(now, { routine: true }),
};
const run = (name) => jobs[name](new Date()).catch((e) => console.error(`Job ${name} failed:`, e.message));
// Tính lần chạy tiếp theo theo giờ Việt Nam UTC+7.
const untilNext = (hour, minute) => {
  const t = new Date();
  t.setUTCHours((hour + 17) % 24, minute, 0, 0);
  if (t <= Date.now()) t.setUTCDate(t.getUTCDate() + 1);
  return t - Date.now();
};
const daily = (name, hour, minute) => setTimeout(() => run(name).then(() => daily(name, hour, minute)), untilNext(hour, minute)).unref();
// Chạy lịch trong tiến trình; cron ngoài có thể gọi cùng tác vụ qua API.
function schedule() {
  setInterval(() => run("cancellation-auto-approval"), 5 * 60000).unref();
  // Chạy bù ngay sau khi máy chủ hoạt động trở lại.
  run("cancellation-auto-approval");
  daily("payment-reconciliation", 4, 15);
  daily("no-show-processing", 6, 0);
  setInterval(() => run("hold-expiry"), 60000).unref();
  run("hold-expiry");
  daily("arrival-reminder", 9, 0);
  daily("penalty-waiver", 4, 30);
}
module.exports = { jobs, schedule };
