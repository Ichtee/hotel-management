const Booking = require("../models/Booking");
const Payment = require("../models/Payment");
const Refund = require("../models/Refund");
const Penalty = require("../models/Penalty");
const Invoice = require("../models/Invoice");
const CheckInOutRequest = require("../models/CheckInOutRequest");
require("../models/RoomType");
require("../models/Room");
const v = require("../utils/validation");
const { hotelDay } = require("../services/roomInventory");
// Suy ra trạng thái thanh toán chỉ từ các khoản thu đã xác minh thành công.
function paymentStatus(booking, payments) {
  const paid = payments.filter((p) => p.status === "success").reduce((s, p) => s + p.amount, 0);
  const status = paid > 0 && paid >= booking.totalAmount ? "fully_paid" : paid > 0 ? "deposit_paid" : "unpaid";
  return { paidAmount: paid, paymentStatus: status };
}
// Khách chỉ xem booking của mình; nhân viên cần quyền đọc booking quản lý.
const staffReads = (req) => ["manager", "admin"].includes(req.role.key) || req.role.permissions.includes("bookings.managed.read");
const mine = (req, id) => {
  const base = id ? { _id: v.id(id) } : {};
  if (req.role.key === "customer") return { ...base, customerId: req.user._id };
  if (!staffReads(req)) throw new v.HttpError(403, "You do not have permission to use this feature.");
  return base;
};
// Lấy lịch sử booking của khách đang đăng nhập.
async function listing(req, res) {
  const filter = mine(req);
  if (req.query.status)
    filter.status = v.choice(req.query.status, "status", Booking.schema.path("status").enumValues);
  const { page, limit } = v.pagination(req.query);
  const [rows, total] = await Promise.all([
    Booking.find(filter)
      .select("bookingReference guestName guestPhone status checkInDate checkOutDate rooms roomAmount totalAmount depositRequired holdExpiresAt currency createdAt")
      .populate("rooms.roomTypeId", "name images")
      .sort({ createdAt: -1, _id: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    Booking.countDocuments(filter),
  ]);
  const payments = await Payment.find({ bookingId: { $in: rows.map((b) => b._id) } }).select("bookingId amount status").lean();
  const data = rows.map((b) => ({
    ...b,
    ...paymentStatus(b, payments.filter((p) => String(p.bookingId) === String(b._id))),
  }));
  res.json({ data, meta: { page, limit, total, pages: Math.max(1, Math.ceil(total / limit)) } });
}
// Trả chi tiết booking và ẩn thông tin kiểm toán nội bộ.
async function detail(req, res) {
  const booking = await Booking.findOne(mine(req, req.params.id))
    .select(req.role.key === "receptionist" ? "+guestIdDocumentNo -events -createdBy -checkedInBy -checkedOutBy" : "-events -createdBy -checkedInBy -checkedOutBy")
    .populate("rooms.roomTypeId", "name images")
    .populate("rooms.roomId", "roomNumber floor")
    .lean();
  if (!booking) throw new v.HttpError(404, "Booking not found.");
  const [payments, refunds, penalties, invoices, requests] = await Promise.all([
    Payment.find({ bookingId: booking._id }).select("kind amount currency method status paidAt createdAt").sort({ createdAt: 1 }).lean(),
    Refund.find({ bookingId: booking._id }).select("amount currency status reason bankTransactionCode processedAt createdAt").sort({ createdAt: 1 }).lean(),
    // Chỉ hiển thị bồi thường cho khách sau khi lễ tân xác nhận.
    Penalty.find({ bookingId: booking._id, status: { $ne: "proposed" } }).select("itemName amount status waivedReason afterCheckout").sort({ createdAt: 1 }).lean(),
    Invoice.find({ bookingId: booking._id }).select("invoiceNumber kind lines totalAmount issuedAt createdAt").sort({ createdAt: 1 }).lean(),
    CheckInOutRequest.find({ bookingId: booking._id }).select("type requestedTime earlyOrLate quotedFee status responseNote numberOfGuests createdAt").sort({ createdAt: -1 }).lean(),
  ]);
  res.json({ data: { ...booking, ...paymentStatus(booking, payments), payments, refunds, penalties, invoices, requests } });
}
// Lọc booking theo trạng thái, từ khóa và công việc trong ngày.
// Ngày lưu trú dùng ngày UTC: trước ngày mai là đến hạn, trước hôm nay là quá hạn.
const VIEWS = {
  arrivals: (today, tomorrow) => ({ status: "confirmed", checkInDate: { $lt: tomorrow } }),
  departures: (today, tomorrow) => ({ status: "checked_in", checkOutDate: { $lt: tomorrow } }),
  // Booking đã xác nhận, quá ngày nhận nhưng khách chưa đến.
  overdue_check_in: (today) => ({ status: "confirmed", checkInDate: { $lt: today } }),
  // Khách vẫn đang ở sau ngày trả phòng dự kiến.
  overdue_check_out: (today) => ({ status: "checked_in", checkOutDate: { $lt: today } }),
};
async function search(req, res) {
  v.keys(req.query, ["status", "view", "q", "page", "limit"]);
  const today = new Date(`${hotelDay()}T00:00:00Z`);
  const filter = req.query.view ? VIEWS[v.choice(req.query.view, "view", Object.keys(VIEWS))](today, new Date(today.getTime() + 864e5)) : {};
  if (req.query.status) filter.status = v.choice(req.query.status, "status", Booking.schema.path("status").enumValues);
  if (req.query.q) { const q = v.search(req.query); filter.$or = [{ bookingReference: q }, { guestName: q }, { guestPhone: q }]; }
  const { page, limit } = v.pagination(req.query);
  const [data, total] = await Promise.all([
    Booking.find(filter).populate("rooms.roomTypeId", "name basePrice").populate("rooms.roomId", "roomNumber floor")
      .sort(req.query.view ? { checkInDate: 1, _id: 1 } : { createdAt: -1, _id: -1 }).skip((page - 1) * limit).limit(limit).lean(),
    Booking.countDocuments(filter),
  ]);
  res.json({ data, meta: { page, limit, total, pages: Math.max(1, Math.ceil(total / limit)) } });
}
module.exports = { listing, detail, search };
