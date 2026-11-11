const { randomBytes } = require("node:crypto");
const Booking = require("../models/Booking");
const Room = require("../models/Room");
const RoomType = require("../models/RoomType");
const RoomIssue = require("../models/RoomIssue");
const Payment = require("../models/Payment");
const Penalty = require("../models/Penalty");
const Task = require("../models/CleaningTask");
const Request = require("../models/CheckInOutRequest");
const CouponUsage = require("../models/CouponUsage");
const Coupon = require("../models/Coupon");
const Service = require("../models/Service");
const Invoice = require("../models/Invoice");
const HotelInfo = require("../models/HotelInfo");
const { validateCoupon, recheckCoupon } = require("../services/promotions");
const { currentDepositPolicy, currentCancellationPolicy } = require("../services/policies");
const { createCleaningTask } = require("../services/housekeepingTasks");
const { paidAmount } = require("../services/payments");
const { estimate } = require("../services/cancellations");
const { assertCaptcha } = require("../services/captchaService");
const { notify } = require("../services/notifications");
const { audit } = require("../services/audit");
const { DAY, iso, priceAt, nightsOf, priceNights, sumNights, stayAmount, storedNights, percentOf } = require("../services/pricing");
const { closeForBooking } = require("./stayRequests");
const v = require("../utils/validation");

const { hotelTransaction } = require("../services/hotelOperations");
const { sellingFilter } = require("../services/roomInventory");

const OPEN_ISSUE = ["open", "in_progress"];
const NOT_AVAILABLE = "The selected room is not available for the selected dates. Please choose another room or date.";
const NO_CHECK_IN = "This booking cannot be checked in. Check its status and check-in date.";
const reference = () => `BK-${Date.now().toString(36).toUpperCase()}-${randomBytes(3).toString("hex").toUpperCase()}`;
const vnDate = (date = new Date()) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Ho_Chi_Minh" }).format(date);
// Ghép ngày và giờ theo múi giờ khách sạn.
const at = (date, time) => new Date(`${iso(date)}T${time}:00+07:00`);
// Lỗi gửi thông báo không hoàn tác nghiệp vụ đã lưu.
const tell = (...a) => notify(...a).catch((e) => console.error("Notification failed:", e.message));

// Ngày trả phải sau ngày nhận; ngày nhận mới không được nằm trong quá khứ.
function stayDates(checkInDate, checkOutDate, { allowPast = false } = {}) {
  v.date(checkInDate, "checkInDate"); v.date(checkOutDate, "checkOutDate");
  if (nightsOf(checkInDate, checkOutDate) < 1) v.fail("Check-out date must be later than check-in date.", "checkOutDate");
  if (!allowPast && checkInDate < vnDate()) v.fail("Check-in date must not be in the past.", "checkInDate");
}
// Chọn phòng không bảo trì và không bị booking khác giữ trong kỳ lưu trú.
async function assignRoom(roomTypeId, checkInDate, checkOutDate, ignoredBookingId) {
  const candidates = await Room.find({ roomTypeId, isActive: true, status: { $ne: "maintenance" } }).select("_id").lean();
  const busy = await busyRooms(candidates.map((r) => r._id), checkInDate, checkOutDate, ignoredBookingId);
  return { roomId: candidates.find((r) => !busy.has(String(r._id)))?._id || null };
}
async function busyRooms(ids, from, to, ignoredBookingId) {
  const filter = { ...sellingFilter(), checkInDate: { $lt: new Date(`${iso(to)}T00:00:00Z`) }, checkOutDate: { $gt: new Date(`${iso(from)}T00:00:00Z`) }, "rooms.roomId": { $in: ids } };
  if (ignoredBookingId) filter._id = { $ne: ignoredBookingId };
  return new Set((await Booking.distinct("rooms.roomId", filter)).map(String));
}
// Khóa thao tác chọn và lưu phòng để hai yêu cầu không cùng lấy phòng cuối.
const locked = (work) => hotelTransaction(() => work());
const reserve = (roomTypeId, from, to, save) => locked(async () => {
  const { roomId } = await assignRoom(roomTypeId, from, to);
  if (!roomId) throw new v.HttpError(409, NOT_AVAILABLE);
  return save(roomId);
});
const depositsPaid = async (bookingId) =>
  (await Payment.find({ bookingId, kind: "deposit", status: "success" }).select("amount").lean()).reduce((s, p) => s + p.amount, 0);
const totalOf = (b) => b.roomAmount - (b.discountAmount || 0) + (b.serviceAmount || 0) + (b.feeAmount || 0) + (b.penaltyAmount || 0);

// Khách đăng nhập đặt loại phòng còn trống; giữ phòng 15 phút để trả cọc.
async function create(req, res) {
  v.keys(req.body, ["roomTypeId", "checkInDate", "checkOutDate", "guestCount", "couponCode", "paymentOption", "fullName", "phone", "email", "consent", "captchaToken"]);
  const { roomTypeId, checkInDate, checkOutDate } = req.body;
  v.id(roomTypeId, "roomTypeId"); stayDates(checkInDate, checkOutDate);
  const guestCount = v.number(req.body.guestCount, "guestCount", 1, 20);
  // Booking trực tuyến phải trả cọc qua mạng, không chọn trả tại quầy hoặc trả toàn bộ.
  v.choice(req.body.paymentOption || "deposit", "paymentOption", ["deposit"]);
  // Yêu cầu đồng ý chính sách và điền sẵn liên hệ từ hồ sơ để khách chỉnh sửa.
  if (req.body.consent !== true) v.fail("Privacy consent is required.", "consent");
  const guestName = v.text(req.body.fullName ?? req.user.customerProfile?.fullName ?? req.user.username, "fullName", 2, 80);
  const guestPhone = req.body.phone === undefined ? req.user.phone : v.phone(req.body.phone, true);
  const guestEmail = req.body.email === undefined ? req.user.email : v.email(req.body.email);
  await assertCaptcha(req.body.captchaToken, req.ip);
  if ((await Booking.countDocuments({ customerId: req.user._id, status: "pending", holdExpiresAt: { $gt: new Date() } })) >= 3)
    throw new v.HttpError(409, "You already have 3 unpaid bookings. Please pay, cancel the payment or wait for one of them to expire.");
  const type = await RoomType.findOne({ _id: roomTypeId, isActive: true });
  if (!type) throw new v.HttpError(404, "This room type is no longer available.");
  if (guestCount > type.maxOccupancy) v.fail(`This room accommodates up to ${type.maxOccupancy} guests.`, "guestCount");
  // Tính từng đêm theo mức giá áp dụng riêng.
  const nightlyRates = priceNights(type, checkInDate, checkOutDate);
  const roomAmount = sumNights(nightlyRates);
  const coupon = req.body.couponCode?.trim() ? await validateCoupon({ code: req.body.couponCode, customerId: req.user._id, subtotal: roomAmount }) : null;
  const discountAmount = coupon?.discountAmount || 0;
  const totalAmount = roomAmount - discountAmount;
  const [policy, cancellation] = await Promise.all([currentDepositPolicy(), currentCancellationPolicy()]);
  if (!policy) throw new v.HttpError(409, "Online booking is not available yet: the hotel has not set a deposit policy.");
  const depositRequired = percentOf(totalAmount, policy.deposit.value);
  // Giữ phòng 15 phút để trả cọc; xác nhận ngay nếu không có tiền phải trả.
  const held = depositRequired >= 1;
  const booking = await reserve(type._id, checkInDate, checkOutDate, (roomId) => Booking.create({
    bookingReference: reference(), customerId: req.user._id, createdBy: req.user._id, checkInDate, checkOutDate,
    status: held ? "pending" : "confirmed", holdExpiresAt: held ? new Date(Date.now() + 15 * 60000) : undefined,
    rooms: [{ roomId, roomTypeId: type._id, priceAtBooking: Math.round(roomAmount / nightsOf(checkInDate, checkOutDate)), guestCount }],
    guestName, guestPhone, guestEmail, consentAt: new Date(), nightlyRates,
    couponCode: coupon?.code, discountAmount, roomAmount, totalAmount, depositRequired,
    // Chụp lại phần trăm cọc và các mốc hoàn tiền vào booking.
    policySnapshot: {
      depositPolicyId: policy._id, depositType: policy.deposit.type, depositValue: policy.deposit.value, depositDescription: policy.description,
      cancellationPolicyId: cancellation?._id, cancellationDescription: cancellation?.description,
      cancellationTiers: (cancellation?.cancellationTiers || []).map(({ minHoursBeforeCheckIn, refundPercent }) => ({ minHoursBeforeCheckIn, refundPercent })),
    },
    bookingSource: "online", events: [{ actorId: req.user._id, type: "created", note: "Booking created online" }],
  }));
  if (coupon) { await CouponUsage.create({ couponId: coupon.couponId, bookingId: booking._id, customerId: req.user._id }); await Coupon.updateOne({ _id: coupon.couponId }, { $inc: { usageCount: 1 } }); }
  if (!held) await tell("booking_confirmed", booking.customerId, { reference: booking.bookingReference }, { bookingId: booking._id });
  // Chỉ tạo đơn trả cọc khi mở trang thanh toán, không tạo bản ghi tạm ở đây.
  res.status(201).json({ data: booking });
}
// Trả loại phòng đủ sức chứa và còn trống suốt kỳ, kèm giá; không lộ phòng cụ thể.
async function availability(req, res) {
  v.keys(req.query, ["checkIn", "checkOut", "guests"]);
  const { checkIn, checkOut } = req.query;
  stayDates(checkIn, checkOut);
  const guests = req.query.guests === undefined ? 1 : v.number(Number(req.query.guests), "guests", 1, 20);
  const types = await RoomType.find({ isActive: true, maxOccupancy: { $gte: guests } }).select("name description basePrice maxOccupancy amenities images bedType roomSizeSqm seasonalPricing").sort({ basePrice: 1 }).lean();
  const rooms = await Room.find({ roomTypeId: { $in: types.map((t) => t._id) }, isActive: true, status: { $ne: "maintenance" } }).select("roomTypeId").lean();
  const busy = await busyRooms(rooms.map((r) => r._id), checkIn, checkOut);
  const data = types.map(({ seasonalPricing, ...t }) => ({
    ...t, nights: nightsOf(checkIn, checkOut), stayAmount: stayAmount({ ...t, seasonalPricing }, checkIn, checkOut),
    roomsLeft: rooms.filter((r) => String(r.roomTypeId) === String(t._id) && !busy.has(String(r._id))).length,
  })).filter((t) => t.roomsLeft > 0);
  res.json({ data });
}
// Báo giá trước khi tạo booking; bỏ giảm giá nếu mã sai và không yêu cầu cọc với khách tại quầy.
async function quote(req, res) {
  v.keys(req.body, ["roomTypeId", "checkInDate", "checkOutDate", "couponCode"]);
  const { roomTypeId, checkInDate, checkOutDate } = req.body;
  v.id(roomTypeId, "roomTypeId"); stayDates(checkInDate, checkOutDate);
  const type = await RoomType.findOne({ _id: roomTypeId, isActive: true });
  if (!type) throw new v.HttpError(404, "This room type is no longer available.");
  const nightlyRates = priceNights(type, checkInDate, checkOutDate), roomAmount = sumNights(nightlyRates);
  const isCustomer = req.role.key === "customer";
  let discountAmount = 0, couponError;
  if (req.body.couponCode?.trim()) {
    try { ({ discountAmount } = await validateCoupon({ code: req.body.couponCode, customerId: isCustomer ? req.user._id : undefined, subtotal: roomAmount })); }
    catch (error) { if (error.status !== 400) throw error; couponError = error.message; }
  }
  const totalAmount = roomAmount - discountAmount;
  const depositPercent = isCustomer ? (await currentDepositPolicy())?.deposit?.value ?? 0 : 0;
  res.json({ data: {
    nights: nightlyRates.map((n) => ({ date: iso(n.date), price: n.price })), roomAmount, discountAmount, couponError, totalAmount,
    depositPercent, depositRequired: percentOf(totalAmount, depositPercent), available: Boolean((await assignRoom(type._id, checkInDate, checkOutDate)).roomId),
  } });
}
async function roomTypes(_req, res) { res.json({ data: await RoomType.find({ isActive: true }).select("name description basePrice maxOccupancy amenities images bedType roomSizeSqm seasonalPricing").sort({ basePrice: 1 }).lean() }); }

// Đặt tại quầy bắt đầu hôm nay và không yêu cầu cọc.
async function createWalkIn(req, res) {
  v.keys(req.body, ["roomTypeId", "checkInDate", "checkOutDate", "guestCount", "fullName", "phone", "email", "idDocumentNo", "couponCode"]);
  const b = req.body;
  v.id(b.roomTypeId, "roomTypeId"); stayDates(b.checkInDate, b.checkOutDate);
  if (b.checkInDate !== vnDate()) v.fail("A booking without a deposit can only be created for today's check-in date.", "checkInDate", 409);
  const guestCount = v.number(b.guestCount, "guestCount", 1, 20);
  const fullName = v.text(b.fullName, "fullName", 2, 80), phone = v.phone(b.phone, true), idDocumentNo = v.text(b.idDocumentNo, "idDocumentNo", 3, 40);
  const email = b.email ? v.email(b.email) : undefined;
  const type = await RoomType.findOne({ _id: b.roomTypeId, isActive: true });
  if (!type) throw new v.HttpError(404, "This room type is no longer available.");
  if (guestCount > type.maxOccupancy) v.fail(`This room accommodates up to ${type.maxOccupancy} guests.`, "guestCount");
  const nightlyRates = priceNights(type, b.checkInDate, b.checkOutDate), roomAmount = sumNights(nightlyRates);
  // Áp dụng mã giảm giá khi đặt phòng tại quầy.
  const coupon = b.couponCode?.trim() ? await validateCoupon({ code: b.couponCode, subtotal: roomAmount }) : null;
  const discountAmount = coupon?.discountAmount || 0;
  const booking = await reserve(type._id, b.checkInDate, b.checkOutDate, (roomId) => Booking.create({ bookingReference: reference(), nightlyRates, createdBy: req.user._id, checkInDate: b.checkInDate, checkOutDate: b.checkOutDate, status: "confirmed", rooms: [{ roomId, roomTypeId: type._id, priceAtBooking: Math.round(roomAmount / nightsOf(b.checkInDate, b.checkOutDate)), guestCount }], guestName: fullName, guestPhone: phone, guestEmail: email, guestIdDocumentNo: idDocumentNo, roomAmount, couponCode: coupon?.code, discountAmount, totalAmount: roomAmount - discountAmount, depositRequired: 0, bookingSource: "front_desk", events: [{ actorId: req.user._id, type: "created", note: "Walk-in booking created by receptionist" }] }));
  if (coupon) await Coupon.updateOne({ _id: coupon.couponId }, { $inc: { usageCount: 1 } });
  res.status(201).json({ data: booking, message: "Booking created successfully." });
}

// Giữ giá đêm cũ, tính giá đêm thêm và kiểm tra lại mã giảm giá.
// Booking đã xác nhận giữ cọc; booking chờ cọc không được sửa khi đang thanh toán.
async function changeStay(booking, input, { byCustomer, dropCoupon = false }) {
  const line = booking.rooms[0];
  const type = await RoomType.findById(line.roomTypeId);
  if (!type) throw new v.HttpError(409, "The booked room type is unavailable.");
  const oldIn = iso(booking.checkInDate), oldOut = iso(booking.checkOutDate);
  const checkInDate = input.checkInDate || oldIn, checkOutDate = input.checkOutDate || oldOut;
  if (input.guestCount !== undefined) {
    const guests = v.number(input.guestCount, "guestCount", 1, 20);
    if (guests > type.maxOccupancy) v.fail(`This room accommodates up to ${type.maxOccupancy} guests.`, "guestCount");
    line.guestCount = guests;
  }
  if (checkInDate === oldIn && checkOutDate === oldOut) return;
  if (booking.status === "checked_in" && (checkInDate !== oldIn || checkOutDate <= oldOut)) throw new v.HttpError(409, "A checked-in booking can only be extended.");
  stayDates(checkInDate, checkOutDate, { allowPast: checkInDate === oldIn });
  if (booking.status === "pending" && (await Payment.exists({ bookingId: booking._id, status: "pending" })))
    throw new v.HttpError(409, "A payment of this booking is waiting for the payment gateway. Wait for the result or cancel the payment first.");
  if (byCustomer && booking.status === "confirmed") {
    // Chỉ cho sửa khi hủy tại thời điểm này vẫn được hoàn toàn bộ cọc.
    const now = await estimate(booking);
    if (now.depositPaid > 0 && now.refundPercent < 100) throw new v.HttpError(409, "The stay dates can no longer be changed for this booking. Keep the current dates or cancel the booking.");
  }
  let roomId;
  // Giữ nguyên phòng khách đang sử dụng.
  if (booking.status === "checked_in") roomId = (await busyRooms([line.roomId], oldOut, checkOutDate, booking._id)).size ? null : line.roomId;
  else roomId = (await assignRoom(type._id, checkInDate, checkOutDate, booking._id)).roomId;
  if (!roomId) throw new v.HttpError(409, NOT_AVAILABLE);
  // Giữ giá đã chốt của các đêm không đổi.
  const nightlyRates = priceNights(type, checkInDate, checkOutDate, storedNights(booking));
  const roomAmount = sumNights(nightlyRates);
  let discountAmount = 0, couponCode = booking.couponCode;
  if (couponCode) {
    try { discountAmount = await recheckCoupon({ code: couponCode, subtotal: roomAmount }); }
    // Chỉ áp dụng thay đổi khi khách đồng ý.
    catch (error) { if (byCustomer || !dropCoupon) throw error; couponCode = undefined; }
  }
  Object.assign(booking, { checkInDate, checkOutDate, nightlyRates, roomAmount, discountAmount, couponCode });
  booking.totalAmount = totalOf(booking);
  if (booking.status === "pending") booking.depositRequired = percentOf(booking.totalAmount, booking.policySnapshot?.depositValue ?? (await currentDepositPolicy())?.deposit?.value ?? 0);
  else if (booking.totalAmount < (await depositsPaid(booking._id)))
    throw new v.HttpError(409, "The new total would be lower than the deposit already paid. Cancel the booking instead.");
  line.roomId = roomId; line.priceAtBooking = Math.round(roomAmount / nightsOf(checkInDate, checkOutDate));
}

// Lễ tân sửa lịch lưu trú và liên hệ trên booking, không sửa thông tin đăng nhập.
async function modifyWalkIn(req, res) {
  v.keys(req.body, ["checkInDate", "checkOutDate", "guestCount", "fullName", "phone", "idDocumentNo", "dropCoupon"]);
  const booking = await Booking.findById(v.id(req.params.id)).select("+guestIdDocumentNo");
  if (!booking) throw new v.HttpError(404, "Booking not found.");
  const b = req.body;
  if (!["pending", "confirmed", "checked_in", "checked_out"].includes(booking.status)) throw new v.HttpError(409, "This booking can no longer be modified.");
  const stayChange = ["checkInDate", "checkOutDate", "guestCount"].some((key) => b[key] !== undefined);
  if (booking.status === "checked_out" && stayChange) throw new v.HttpError(409, "Only guest information can be corrected after check-out.");
  if (b.fullName !== undefined) booking.guestName = v.text(b.fullName, "fullName", 2, 80);
  if (b.phone !== undefined) booking.guestPhone = v.phone(b.phone, true);
  if (b.idDocumentNo !== undefined) booking.guestIdDocumentNo = v.text(b.idDocumentNo, "idDocumentNo", 3, 40);
  booking.events.push({ actorId: req.user._id, type: "modified", note: "Booking modified by receptionist" });
  // Khóa việc giữ và lưu các đêm mới để tránh tranh chấp phòng.
  await locked(async () => {
    if (stayChange) await changeStay(booking, b, { byCustomer: false, dropCoupon: b.dropCoupon === true });
    await booking.save();
  });
  if (booking.customerId) await tell("booking_modified", booking.customerId, { reference: booking.bookingReference }, { bookingId: booking._id });
  res.json({ data: booking, message: "Updated successfully." });
}

// Khách chỉ sửa lịch và liên hệ booking của mình; giữ loại phòng, thu giấy tờ khi nhận phòng.
async function modifyOwn(req, res) {
  v.keys(req.body, ["checkInDate", "checkOutDate", "guestCount", "fullName", "phone", "email", "specialRequests"]);
  const booking = await Booking.findOne({ _id: v.id(req.params.id), customerId: req.user._id });
  if (!booking) throw new v.HttpError(404, "Booking not found.");
  if (!["pending", "confirmed"].includes(booking.status)) throw new v.HttpError(409, "This booking can no longer be modified.");
  const b = req.body;
  if (b.fullName !== undefined) booking.guestName = v.text(b.fullName, "fullName", 2, 80);
  if (b.phone !== undefined) booking.guestPhone = v.phone(b.phone, true);
  if (b.email !== undefined) booking.guestEmail = v.email(b.email);
  booking.events.push({ actorId: req.user._id, type: "modified", note: "Booking modified by the customer" });
  await locked(async () => { await changeStay(booking, b, { byCustomer: true }); await booking.save(); });
  await tell("booking_modified", booking.customerId, { reference: booking.bookingReference }, { bookingId: booking._id });
  res.json({ data: booking, message: "Updated successfully." });
}

// Lấy phòng trống đúng loại và thông tin yêu cầu đã duyệt để điền sẵn khi nhận phòng.
async function availableRooms(req, res) {
  const booking = await Booking.findById(v.id(req.params.id));
  if (!booking) throw new v.HttpError(404, "Booking not found.");
  const candidates = await Room.find({ roomTypeId: booking.rooms[0].roomTypeId, isActive: true, status: "available" }).select("roomNumber floor roomTypeId").lean();
  const busy = await busyRooms(candidates.map((r) => r._id), booking.checkInDate, booking.checkOutDate, booking._id);
  const request = await Request.findOne({ bookingId: booking._id, type: "check_in", status: "approved" }).select("+mainGuestIdNumber");
  res.json({ data: candidates.filter((r) => !busy.has(String(r._id))), meta: { request: request && { _id: request._id, hasIdPhoto: request.hasIdPhoto, guestCount: request.numberOfGuests, idDocumentNo: request.mainGuestIdNumber, requestedTime: request.requestedTime } } });
}
// Cho nhận phòng đúng ngày hoặc sau nửa đêm trước mốc vắng mặt 06:00.
async function checkIn(req, res) {
  v.keys(req.body, ["roomId", "guestCount", "idDocumentNo"]);
  const booking = await Booking.findById(v.id(req.params.id)).select("+guestIdDocumentNo");
  if (!booking) throw new v.HttpError(404, "Booking not found.");
  const now = new Date();
  if (booking.status !== "confirmed" || now < at(booking.checkInDate, "00:00") || now >= new Date(at(booking.checkInDate, "06:00").getTime() + DAY))
    throw new v.HttpError(409, NO_CHECK_IN);
  const room = await Room.findOne({ _id: v.id(req.body.roomId, "roomId"), roomTypeId: booking.rooms[0].roomTypeId, isActive: true, status: "available" });
  if (!room) throw new v.HttpError(409, NOT_AVAILABLE);
  const guestCount = v.number(req.body.guestCount, "guestCount", 1, 20);
  const type = await RoomType.findById(booking.rooms[0].roomTypeId);
  if (!type || guestCount > type.maxOccupancy) v.fail("Invalid guest count.", "guestCount");
  booking.rooms[0].roomId = room._id; booking.rooms[0].guestCount = guestCount; booking.guestIdDocumentNo = v.text(req.body.idDocumentNo, "idDocumentNo", 3, 40);
  // Chỉ ghi phí nhận sớm một lần khi khách thực sự nhận trước giờ chuẩn.
  const policy = await currentCancellationPolicy();
  const earlyFee = now < at(booking.checkInDate, policy?.checkInTime || "14:00") ? policy?.earlyCheckInFee || 0 : 0;
  if (earlyFee && !booking.feeLines.some((l) => l.type === "early_check_in")) {
    booking.feeLines.push({ type: "early_check_in", amount: earlyFee, postedAt: now });
    booking.feeAmount += earlyFee; booking.totalAmount += earlyFee;
  }
  booking.status = "checked_in"; booking.actualCheckInAt = now; booking.checkedInBy = req.user._id;
  booking.events.push({ actorId: req.user._id, type: "checked_in", note: `Checked in to room ${room.roomNumber}` });
  room.status = "occupied"; await room.save(); await booking.save();
  await closeForBooking(booking._id);
  res.json({ data: booking, message: "Check-in completed successfully." });
}

// Tìm lựa chọn đổi phòng cho các đêm còn lại; chỉ cho hạ hạng khi hết phòng cùng hoặc cao hơn.
async function moveOptions(booking) {
  const checkedIn = booking.status === "checked_in";
  const line = booking.rooms[0];
  const from = checkedIn ? vnDate() : iso(booking.checkInDate), to = iso(booking.checkOutDate);
  const current = await RoomType.findById(line.roomTypeId);
  const types = (await RoomType.find({ isActive: true }).select("name basePrice seasonalPricing maxOccupancy")).filter((t) => t.maxOccupancy >= line.guestCount);
  const base = stayAmount(current, from, to);
  let options = [];
  if (checkedIn) {
    const rooms = await Room.find({ roomTypeId: { $in: types.map((t) => t._id) }, _id: { $ne: line.roomId }, isActive: true, status: "available" }).select("roomNumber floor roomTypeId").lean();
    const busy = await busyRooms(rooms.map((r) => r._id), from, to, booking._id);
    options = rooms.filter((r) => !busy.has(String(r._id))).map((room) => ({ room, roomType: types.find((t) => t._id.equals(room.roomTypeId)) }));
  } else {
    for (const t of types) if (!t._id.equals(current._id) && (await assignRoom(t._id, from, to, booking._id)).roomId) options.push({ roomType: t });
  }
  options = options.map((o) => ({ ...o, amount: stayAmount(o.roomType, from, to), lower: stayAmount(o.roomType, from, to) < base }));
  const sameOrHigher = options.filter((o) => !o.lower);
  return { from, to, current, base, options: sameOrHigher.length ? sameOrHigher : options, onlyLower: !sameOrHigher.length && options.length > 0 };
}
async function changeRoomOptions(req, res) {
  const booking = await Booking.findById(v.id(req.params.id));
  if (!booking || !["confirmed", "checked_in"].includes(booking.status)) throw new v.HttpError(409, "Only a confirmed or checked-in booking can change rooms.");
  const { base, options, onlyLower } = await moveOptions(booking);
  res.json({
    data: options.map((o) => ({ ...(o.room || {}), _id: o.room?._id || o.roomType._id, roomType: { _id: o.roomType._id, name: o.roomType.name, basePrice: o.roomType.basePrice }, amount: o.amount, difference: o.amount - base, lower: o.lower })),
    meta: { mode: booking.status === "checked_in" ? "room" : "room_type", currentAmount: base, onlyLower },
  });
}
async function changeRoom(req, res) {
  v.keys(req.body, ["newRoomId", "newRoomTypeId", "guestAgrees", "dropCoupon"]);
  const booking = await Booking.findById(v.id(req.params.id));
  if (!booking || !["confirmed", "checked_in"].includes(booking.status)) throw new v.HttpError(409, "Only a confirmed or checked-in booking can change rooms.");
  const checkedIn = booking.status === "checked_in";
  const line = booking.rooms[0];
  const { from, to, options } = await moveOptions(booking);
  const wanted = checkedIn ? v.id(req.body.newRoomId, "newRoomId") : v.id(req.body.newRoomTypeId, "newRoomTypeId");
  const pick = options.find((o) => String(checkedIn ? o.room._id : o.roomType._id) === wanted);
  if (!pick) {
    // Báo riêng trường hợp hạ hạng không hợp lệ và trường hợp hết phòng.
    const target = checkedIn ? await Room.findById(wanted).select("roomTypeId") : { roomTypeId: wanted };
    const targetType = target && (await RoomType.findById(target.roomTypeId));
    if (targetType && options.length && !options[0].lower && stayAmount(targetType, from, to) < stayAmount(await RoomType.findById(line.roomTypeId), from, to))
      throw new v.HttpError(409, "A room of a lower-priced room type can be assigned only when no room of the booked or a higher-priced room type is available.");
    throw new v.HttpError(409, NOT_AVAILABLE);
  }
  if (pick.lower && req.body.guestAgrees !== true) v.fail("Record the guest's agreement to move to a lower-priced room type.", "guestAgrees");
  const before = { roomId: line.roomId, roomTypeId: line.roomTypeId, roomAmount: booking.roomAmount };
  const nights = nightsOf(booking.checkInDate, booking.checkOutDate);
  if (checkedIn) {
    // Đêm đã ở giữ giá cũ; đêm còn lại dùng giá loại mới, nâng hạng luôn thu chênh lệch.
    booking.nightlyRates = [...storedNights(booking).filter((n) => iso(n.date) < from), ...priceNights(pick.roomType, from, to)];
    booking.roomAmount = sumNights(booking.nightlyRates);
  } else {
    // Đổi trước nhận phòng thì tính lại toàn kỳ nhưng giữ nguyên cọc.
    booking.nightlyRates = priceNights(pick.roomType, from, to);
    booking.roomAmount = sumNights(booking.nightlyRates);
    if (booking.couponCode) {
      try { booking.discountAmount = await recheckCoupon({ code: booking.couponCode, subtotal: booking.roomAmount }); }
      catch (error) { if (req.body.dropCoupon !== true) throw error; booking.discountAmount = 0; booking.couponCode = undefined; }
    }
  }
  // Nếu giá sau hạ hạng thấp hơn cọc, khoản còn phải trả bằng không.
  booking.totalAmount = Math.max(0, totalOf(booking));
  line.roomTypeId = pick.roomType._id; line.priceAtBooking = Math.round(booking.roomAmount / nights);
  let turnover;
  if (checkedIn) {
    const oldRoom = await Room.findById(line.roomId);
    line.roomId = pick.room._id;
    // Phòng vừa rời chuyển sang bảo trì nếu có sự cố, nếu không thì chờ dọn.
    const broken = oldRoom && (await RoomIssue.exists({ roomId: oldRoom._id, status: { $in: OPEN_ISSUE } }));
    if (oldRoom) await Room.updateOne({ _id: oldRoom._id }, { $set: { status: broken ? "maintenance" : "cleaning" } });
    await Room.updateOne({ _id: pick.room._id }, { $set: { status: "occupied" } });
    if (oldRoom) turnover = (await createCleaningTask({ roomId: String(oldRoom._id), type: "turnover" })).data;
    await booking.save();
  // Khóa việc chọn và lưu phòng mới để tránh hai booking lấy cùng phòng.
  } else await locked(async () => {
    line.roomId = (await assignRoom(pick.roomType._id, from, to, booking._id)).roomId;
    if (!line.roomId) throw new v.HttpError(409, NOT_AVAILABLE);
    await booking.save();
  });
  booking.events.push({ actorId: req.user._id, type: "room_changed", note: `${checkedIn ? `Moved to room ${pick.room.roomNumber}` : `Room type changed to ${pick.roomType.name}`}${pick.lower ? " (lower-priced, guest agreed)" : ""}`, oldValue: before, newValue: { roomId: line.roomId, roomTypeId: line.roomTypeId, roomAmount: booking.roomAmount } });
  await booking.save();
  await audit(req.user._id, "booking.room_changed", "booking", booking._id, { before, after: { roomId: line.roomId, roomTypeId: line.roomTypeId, roomAmount: booking.roomAmount }, guestAgreedLower: pick.lower });
  res.json({ data: booking, meta: { difference: booking.roomAmount - before.roomAmount, turnoverTask: turnover }, message: "Room assigned successfully." });
}

async function services(_req, res) {
  res.json({ data: await Service.find({ isActive: true }).select("name category unitPrice").sort({ name: 1 }).lean() });
}
async function addService(req, res) {
  v.keys(req.body, ["serviceId", "quantity"]);
  const booking = await Booking.findById(v.id(req.params.id));
  if (!booking) throw new v.HttpError(404, "Booking not found.");
  if (booking.status !== "checked_in") throw new v.HttpError(409, "Services can only be recorded for a checked-in booking.");
  const service = await Service.findOne({ _id: v.id(req.body.serviceId, "serviceId"), isActive: true });
  if (!service) throw new v.HttpError(404, "This service is no longer available.");
  const quantity = v.number(req.body.quantity, "quantity", 1, 100); const amount = service.unitPrice * quantity;
  booking.services.push({ serviceId: service._id, name: service.name, quantity, unitPrice: service.unitPrice, amount, recordedBy: req.user._id });
  booking.serviceAmount += amount; booking.totalAmount += amount;
  booking.events.push({ actorId: req.user._id, type: "service_added", note: `Added ${quantity} × ${service.name}`, newValue: { serviceId: service._id, quantity, amount } });
  await booking.save(); res.status(201).json({ data: booking, message: "Saved successfully." });
}
async function voidService(req, res) {
  v.keys(req.body, ["reason"]);
  const booking = await Booking.findById(v.id(req.params.id));
  if (!booking) throw new v.HttpError(404, "Booking not found.");
  if (booking.status !== "checked_in") throw new v.HttpError(409, "Only services on a checked-in booking can be voided.");
  const line = booking.services.id(v.id(req.params.serviceLineId, "serviceLineId"));
  if (!line) throw new v.HttpError(404, "Service line not found.");
  if (line.status === "voided") throw new v.HttpError(409, "This service line has already been voided.");
  line.status = "voided"; line.voidReason = v.text(req.body.reason, "reason", 2, 500); line.voidedBy = req.user._id; line.voidedAt = new Date();
  booking.serviceAmount = Math.max(0, booking.serviceAmount - line.amount);
  booking.totalAmount = Math.max(0, booking.totalAmount - line.amount);
  booking.events.push({ actorId: req.user._id, type: "modified", note: `Voided service: ${line.name}` });
  await booking.save();
  await audit(req.user._id, "booking_service.voided", "booking", booking._id, { service: line.name, amount: line.amount, reason: line.voidReason });
  res.json({ data: booking });
}

// Tính phí trả muộn một lần; sau 18:00 thay bằng giá thêm một đêm, không đổi ngày trả.
// Hàm chỉ tính tiền, không ghi dữ liệu; trả sớm không tính thêm phí.
async function lateCharge(booking, now = new Date()) {
  if (booking.feeLines.some((l) => l.type === "late_check_out" || l.type === "extra_night")) return null;
  const policy = await currentCancellationPolicy();
  if (now <= at(booking.checkOutDate, policy?.checkOutTime || "12:00")) return null;
  const extraNight = now > at(booking.checkOutDate, "18:00");
  const amount = extraNight ? priceAt(await RoomType.findById(booking.rooms[0].roomTypeId), booking.checkOutDate) : policy?.lateCheckOutFee || 0;
  return amount ? { type: extraNight ? "extra_night" : "late_check_out", amount, postedAt: now } : null;
}
// Cập nhật nguyên tử để yêu cầu đồng thời chỉ ghi phí một lần, rồi đọc lại booking.
async function postLateCharge(booking, now = new Date()) {
  const line = await lateCharge(booking, now);
  if (!line) return 0;
  const done = await Booking.updateOne(
    { _id: booking._id, "feeLines.type": { $nin: ["late_check_out", "extra_night"] } },
    { $push: { feeLines: line }, $inc: { feeAmount: line.amount, totalAmount: line.amount } },
  );
  return done.modifiedCount ? line.amount : 0;
}
async function checkOutBill(booking) {
  const [paid, task, proposed] = await Promise.all([
    paidAmount(booking._id),
    Task.findOne({ bookingId: booking._id, type: "inspection" }).sort({ createdAt: -1 }).populate("assignedTo", "customerProfile.fullName username"),
    Penalty.countDocuments({ bookingId: booking._id, status: "proposed" }),
  ]);
  return {
    totalAmount: booking.totalAmount, paidAmount: paid, balance: Math.max(0, booking.totalAmount - paid), feeLines: booking.feeLines, proposedPenalties: proposed,
    inspection: task && { _id: task._id, status: task.status, notes: task.notes, assignedTo: task.assignedTo?.customerProfile?.fullName || task.assignedTo?.username || null },
  };
}
// Yêu cầu kiểm tra phòng, ghi phí trả muộn nếu có và lập bảng thanh toán cuối.
async function startCheckOut(req, res) {
  const booking = await Booking.findById(v.id(req.params.id));
  if (!booking) throw new v.HttpError(404, "Booking not found.");
  if (booking.status !== "checked_in") throw new v.HttpError(409, "Only a checked-in booking can be checked out.");
  if (!(await Task.exists({ bookingId: booking._id, type: "inspection" })) && booking.rooms[0].roomId) {
    // Dùng chung khóa với lịch nền để không tạo trùng nhiệm vụ kiểm tra.
    try { await createCleaningTask({ roomId: String(booking.rooms[0].roomId), bookingId: String(booking._id), type: "inspection", inspectionKey: `${booking.id}:${booking.rooms[0].roomId}`, requestContent: "Inspect the room at check-out: minibar, equipment, linen, keys." }); }
    catch (error) { if (error.code !== 11000) throw error; }
  }
  await postLateCharge(booking);
  res.json({ data: await checkOutBill(await Booking.findById(booking._id)) });
}
// Chỉ trả phòng khi đủ tiền, đã quyết định bồi thường và đã xử lý kiểm tra phòng.
async function checkOut(req, res) {
  v.keys(req.body, ["skipInspection"]);
  let booking = await Booking.findById(v.id(req.params.id));
  if (!booking) throw new v.HttpError(404, "Booking not found.");
  if (booking.status !== "checked_in") throw new v.HttpError(409, "Only a checked-in booking can be checked out.");
  await postLateCharge(booking);
  // Đọc lại khoản phí vừa ghi nguyên tử.
  booking = await Booking.findById(booking._id);
  if (await Penalty.exists({ bookingId: booking._id, status: "proposed" })) throw new v.HttpError(409, "Confirm or waive the damage / loss items reported by Housekeeping first.");
  const balance = Math.max(0, booking.totalAmount - (await paidAmount(booking._id)));
  if (balance) throw new v.HttpError(409, `Check-out cannot be completed while ${balance.toLocaleString("en-US")} VND is unpaid. Record the payment first.`);
  const task = await Task.findOne({ bookingId: booking._id, type: "inspection" }).sort({ createdAt: -1 });
  if (task?.status !== "completed") {
    if (req.body.skipInspection !== true) throw new v.HttpError(409, "The room inspection is not finished. Wait for the result or skip it.");
    // Đóng kiểm tra bị bỏ qua thành hoàn tất kèm ghi chú.
    if (task) await Task.updateOne({ _id: task._id }, { $set: { status: "completed", notes: "Skipped at check-out", completedAt: new Date() } });
    await audit(req.user._id, "inspection.skipped", "booking", booking._id, { taskId: task?._id });
  }
  const roomIds = booking.rooms.map((room) => room.roomId).filter(Boolean);
  const broken = new Set((await RoomIssue.distinct("roomId", { roomId: { $in: roomIds }, status: { $in: OPEN_ISSUE } })).map(String));
  for (const id of roomIds) await Room.updateOne({ _id: id }, { $set: { status: broken.has(String(id)) ? "maintenance" : "cleaning" } });
  booking.status = "checked_out"; booking.actualCheckOutAt = new Date(); booking.checkedOutBy = req.user._id;
  booking.events.push({ actorId: req.user._id, type: "checked_out", note: "Checked out" });
  await booking.save();
  await closeForBooking(booking._id);
  const turnovers = await Promise.all(roomIds.map((roomId) => createCleaningTask({ roomId: String(roomId), bookingId: String(booking._id), type: "turnover" })));
  let invoice, warning;
  try { invoice = await issueInvoice(booking, req.user._id); }
  catch (error) { console.error("Invoice generation failed:", error.message); warning = "The invoice could not be generated. Please try again."; }
  res.json({ data: { booking, invoice, turnoverTasks: turnovers.map((item) => item.data) }, message: "Check-out completed successfully.", ...(warning ? { warning } : {}) });
}
const FEE_NAMES = { early_check_in: "Early check-in fee", late_check_out: "Late check-out fee", extra_night: "Extra night (check-out after 18:00)" };
// Chụp các dòng tiền, tên và địa chỉ khách sạn vào hóa đơn khi phát hành.
async function issueInvoice(booking, issuedBy) {
  const existing = await Invoice.findOne({ bookingId: booking._id, kind: "checkout" });
  if (existing) return existing;
  const [hotel, penalties, paid] = await Promise.all([
    HotelInfo.findOne({ key: "main" }).lean(),
    Penalty.find({ bookingId: booking._id, status: { $in: ["confirmed", "paid"] }, afterCheckout: { $ne: true } }).lean(),
    paidAmount(booking._id),
  ]);
  const lines = [
    ...storedNights(booking).map((n) => ({ name: `Night of ${iso(n.date)}`, amount: n.price })),
    ...booking.feeLines.map((f) => ({ name: FEE_NAMES[f.type], amount: f.amount })),
    ...booking.services.filter((s) => s.status !== "voided").map((s) => ({ name: `${s.name} x${s.quantity}`, amount: s.amount })),
    ...(booking.discountAmount ? [{ name: `Discount${booking.couponCode ? ` (${booking.couponCode})` : ""}`, amount: -booking.discountAmount }] : []),
    ...penalties.map((p) => ({ name: `Damage / loss: ${p.itemName}`, amount: p.amount })),
  ];
  const day = vnDate().replace(/-/g, "");
  // Mã hóa đơn theo số thứ tự có thể trùng khi chạy đồng thời; chỉ mục chặn trùng và cho tạo lại.
  const seq = (await Invoice.countDocuments({ invoiceNumber: new RegExp(`^INV-${day}-`) })) + 1;
  const invoice = await Invoice.create({
    bookingId: booking._id, kind: "checkout", invoiceNumber: `INV-${day}-${String(seq).padStart(4, "0")}`, issuedBy, issuedAt: new Date(),
    lines, subtotal: booking.totalAmount + (booking.discountAmount || 0), tax: 0, discountAmount: booking.discountAmount || 0,
    totalAmount: booking.totalAmount, paidAmount: paid, balance: Math.max(0, booking.totalAmount - paid), status: "paid",
    hotelName: hotel?.name, hotelAddress: hotel?.address,
  });
  await audit(issuedBy, "invoice.generated", "invoice", invoice._id, { bookingId: booking._id, totalAmount: booking.totalAmount });
  return invoice;
}
// Cho tạo lại hóa đơn sau khi lần phát hành trước thất bại.
async function generateInvoice(req, res) {
  const booking = await Booking.findById(v.id(req.params.id));
  if (!booking || booking.status !== "checked_out") throw new v.HttpError(409, "An invoice is generated only after check-out.");
  res.status(201).json({ data: await issueInvoice(booking, req.user._id) });
}
module.exports = { create, availability, quote, roomTypes, createWalkIn, modifyWalkIn, modifyOwn, availableRooms, checkIn, changeRoomOptions, changeRoom, services, addService, voidService, startCheckOut, checkOut, generateInvoice, lateCharge };
