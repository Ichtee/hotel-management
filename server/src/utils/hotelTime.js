const v = require("./validation");
const DAY = 86400000;
const HOURS = { morning: [6, 14], afternoon: [14, 22], night: [22, 30] };

// Chuyển ngày lịch thành mốc UTC chuẩn, không phụ thuộc múi giờ máy chạy.
function dayDate(value, field = "date") {
  return new Date(`${v.date(value, field)}T00:00:00Z`);
}

// Xác định ca hiện tại; trước 06:00 vẫn thuộc ca đêm của ngày trước.
function currentShift(now = new Date()) {
  const local = new Date(now.getTime() + 7 * 3600000);
  const hour = local.getUTCHours();
  const shift = hour < 6 || hour >= 22 ? "night" : hour < 14 ? "morning" : "afternoon";
  if (hour < 6) local.setUTCDate(local.getUTCDate() - 1);
  return { shift, date: local.toISOString().slice(0, 10) };
}

// Tính thời gian ca, gồm giờ bắt đầu và không gồm giờ kết thúc.
function shiftWindow(date, shift) {
  const hours = HOURS[shift];
  if (!hours) v.fail("Invalid shift.", "shift");
  const start = dayDate(date).getTime();
  return { start: new Date(start + (hours[0] - 7) * 3600000), end: new Date(start + (hours[1] - 7) * 3600000) };
}

// Tính thời điểm kết thúc ca cuối cùng của một kế hoạch.
function planEnd(plan) {
  return shiftWindow(new Date(plan.effectiveTo).toISOString().slice(0, 10), plan.shift).end;
}

// Kiểm tra ngày ca thuộc khoảng phân công, tính cả hai ngày đầu cuối.
function covers(plan, date, shift) {
  const from = new Date(plan.effectiveFrom).toISOString().slice(0, 10);
  const to = new Date(plan.effectiveTo).toISOString().slice(0, 10);
  return plan.isActive && plan.shift === shift && from <= date && date <= to;
}
module.exports = { DAY, dayDate, currentShift, shiftWindow, planEnd, covers };
