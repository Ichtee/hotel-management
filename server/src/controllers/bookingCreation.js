const { randomBytes } = require("node:crypto");
const Booking = require("../models/Booking");
const Room = require("../models/Room");
const RoomType = require("../models/RoomType");
const Payment = require("../models/Payment");
const CouponUsage = require("../models/CouponUsage");
const Coupon = require("../models/Coupon");
const { validateCoupon } = require("../services/promotions");
const { currentDepositPolicy } = require("../services/policies");
const v = require("../utils/validation");

const ACTIVE = ["pending", "confirmed", "checked_in"];
const reference = () => `BK-${Date.now().toString(36).toUpperCase()}-${randomBytes(3).toString("hex").toUpperCase()}`;
function nightsBetween(a, b) {
  const nights = (Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000;
  if (!Number.isInteger(nights) || nights < 1) v.fail("Check-out must be after check-in.", "checkOutDate");
  return nights;
}
function priceAt(type, date) {
  const d = new Date(`${date}T00:00:00Z`);
  return (type.seasonalPricing || []).find((p) => d >= p.startDate && d <= p.endDate)?.price || type.basePrice;
}
async function assignRoom(roomTypeId, checkInDate, checkOutDate, ignoredBookingId) {
  const candidates = await Room.find({ roomTypeId, isActive: true, status: "available" }).select("_id").lean();
  if (!candidates.length) return { inventoryExists: false, roomId: null };
  const busy = await Booking.distinct("rooms.roomId", { _id: ignoredBookingId ? { $ne: ignoredBookingId } : undefined, status: { $in: ACTIVE }, checkInDate: { $lt: new Date(`${checkOutDate}T00:00:00Z`) }, checkOutDate: { $gt: new Date(`${checkInDate}T00:00:00Z`) }, "rooms.roomId": { $in: candidates.map((r) => r._id) } });
  return { inventoryExists: true, roomId: candidates.find((r) => !busy.some((id) => String(id) === String(r._id)))?._id || null };
}
async function create(req, res) {
  v.keys(req.body, ["roomTypeId", "checkInDate", "checkOutDate", "guestCount", "couponCode", "paymentOption"]);
  const { roomTypeId, checkInDate, checkOutDate } = req.body;
  v.id(roomTypeId, "roomTypeId"); v.date(checkInDate, "checkInDate"); v.date(checkOutDate, "checkOutDate");
  const guestCount = v.number(req.body.guestCount, "guestCount", 1, 20);
  const paymentOption = v.choice(req.body.paymentOption || "hotel", "paymentOption", ["deposit", "full", "hotel"]);
  const type = await RoomType.findOne({ _id: roomTypeId, isActive: true });
  if (!type) throw new v.HttpError(404, "This room type is no longer available.");
  if (guestCount > type.maxOccupancy) v.fail(`This room accommodates up to ${type.maxOccupancy} guests.`, "guestCount");
  const nights = nightsBetween(checkInDate, checkOutDate);
  const assignment = await assignRoom(type._id, checkInDate, checkOutDate);
  if (!assignment.roomId) throw new v.HttpError(409, "No rooms of this type are available for those dates.");
  const roomAmount = priceAt(type, checkInDate) * nights;
  const coupon = req.body.couponCode?.trim() ? await validateCoupon({ code: req.body.couponCode, customerId: req.user._id, subtotal: roomAmount }) : null;
  const discountAmount = coupon?.discountAmount || 0;
  const totalAmount = roomAmount - discountAmount;
  const policy = await currentDepositPolicy();
  const depositRequired = policy ? Math.floor((totalAmount * policy.deposit.value) / 100) : 0;
  const booking = await Booking.create({ bookingReference: reference(), customerId: req.user._id, createdBy: req.user._id, checkInDate, checkOutDate, status: paymentOption === "hotel" ? "confirmed" : "pending", rooms: [{ roomId: assignment.roomId, roomTypeId: type._id, priceAtBooking: priceAt(type, checkInDate), guestCount }], couponCode: coupon?.code, discountAmount, roomAmount, totalAmount, depositRequired, policySnapshot: policy ? { depositPolicyId: policy._id, depositType: policy.deposit.type, depositValue: policy.deposit.value, depositDescription: policy.description } : undefined, bookingSource: "online", events: [{ actorId: req.user._id, type: "created", note: "Booking created online" }] });
  if (coupon) { await CouponUsage.create({ couponId: coupon.couponId, bookingId: booking._id, customerId: req.user._id }); await Coupon.updateOne({ _id: coupon.couponId }, { $inc: { usageCount: 1 } }); }
  if (paymentOption !== "hotel") await Payment.create({ bookingId: booking._id, kind: paymentOption === "full" ? "final" : "deposit", amount: paymentOption === "full" ? totalAmount : depositRequired, method: "e_wallet", status: "pending" });
  res.status(201).json({ data: booking });
}
async function roomTypes(_req, res) { res.json({ data: await RoomType.find({ isActive: true }).select("name description basePrice maxOccupancy amenities images bedType roomSizeSqm seasonalPricing").sort({ basePrice: 1 }).lean() }); }
async function createWalkIn(req, res) {
  if (req.role.key !== "receptionist") throw new v.HttpError(403, "Only a receptionist can create a walk-in booking.");
  v.keys(req.body, ["roomTypeId", "checkInDate", "checkOutDate", "guestCount", "fullName", "phone", "email", "idDocumentNo"]);
  const b = req.body;
  v.id(b.roomTypeId, "roomTypeId"); v.date(b.checkInDate, "checkInDate"); v.date(b.checkOutDate, "checkOutDate");
  const guestCount = v.number(b.guestCount, "guestCount", 1, 20);
  const fullName = v.text(b.fullName, "fullName", 2, 80), phone = v.phone(b.phone, true), email = v.email(b.email), idDocumentNo = v.text(b.idDocumentNo, "idDocumentNo", 3, 40);
  const type = await RoomType.findOne({ _id: b.roomTypeId, isActive: true });
  if (!type) throw new v.HttpError(404, "This room type is no longer available.");
  if (guestCount > type.maxOccupancy) v.fail(`This room accommodates up to ${type.maxOccupancy} guests.`, "guestCount");
  const nights = nightsBetween(b.checkInDate, b.checkOutDate), assignment = await assignRoom(type._id, b.checkInDate, b.checkOutDate);
  if (!assignment.roomId) throw new v.HttpError(409, "No rooms of this type are available for those dates.");
  const unitPrice = priceAt(type, b.checkInDate), roomAmount = unitPrice * nights;
  const booking = await Booking.create({ bookingReference: reference(), createdBy: req.user._id, checkInDate: b.checkInDate, checkOutDate: b.checkOutDate, status: "confirmed", rooms: [{ roomId: assignment.roomId, roomTypeId: type._id, priceAtBooking: unitPrice, guestCount }], guestName: fullName, guestPhone: phone, guestEmail: email, guestIdDocumentNo: idDocumentNo, roomAmount, totalAmount: roomAmount, depositRequired: 0, bookingSource: "front_desk", events: [{ actorId: req.user._id, type: "created", note: "Walk-in booking created by receptionist" }] });
  res.status(201).json({ data: booking });
}
async function modifyWalkIn(req, res) {
  if (req.role.key !== "receptionist") throw new v.HttpError(403, "Only a receptionist can modify a booking.");
  v.keys(req.body, ["checkInDate", "checkOutDate", "guestCount", "fullName", "phone", "idDocumentNo"]);
  const booking = await Booking.findById(v.id(req.params.id)).select("+guestIdDocumentNo");
  if (!booking) throw new v.HttpError(404, "Booking not found.");
  const b = req.body;
  const editable = ["pending", "confirmed", "checked_in", "checked_out"];
  if (!editable.includes(booking.status)) throw new v.HttpError(409, "This booking can no longer be modified.");
  const profileOnly = booking.status === "checked_out";
  const stayChange = ["checkInDate", "checkOutDate", "guestCount"].some((key) => b[key] !== undefined);
  if (profileOnly && stayChange) throw new v.HttpError(409, "Only guest information can be corrected after check-out.");
  if (booking.status === "checked_in" && b.checkInDate !== undefined) throw new v.HttpError(409, "A checked-in booking can only be extended.");
  if (b.fullName !== undefined) booking.guestName = v.text(b.fullName, "fullName", 2, 80);
  if (b.phone !== undefined) booking.guestPhone = v.phone(b.phone, true);
  if (b.idDocumentNo !== undefined) booking.guestIdDocumentNo = v.text(b.idDocumentNo, "idDocumentNo", 3, 40);
  if (stayChange) {
    const checkInDate = b.checkInDate || booking.checkInDate.toISOString().slice(0, 10);
    const checkOutDate = b.checkOutDate || booking.checkOutDate.toISOString().slice(0, 10);
    const nights = nightsBetween(checkInDate, checkOutDate);
    if (booking.status === "checked_in" && new Date(`${checkOutDate}T00:00:00Z`) <= booking.checkOutDate) throw new v.HttpError(409, "A checked-in booking can only be extended.");
    const room = booking.rooms[0]; const type = await RoomType.findById(room.roomTypeId);
    if (!type) throw new v.HttpError(409, "The booked room type is unavailable.");
    const guests = b.guestCount === undefined ? room.guestCount : v.number(b.guestCount, "guestCount", 1, 20);
    if (guests > type.maxOccupancy) v.fail(`This room accommodates up to ${type.maxOccupancy} guests.`, "guestCount");
    const assignment = await assignRoom(type._id, checkInDate, checkOutDate, booking._id);
    if (!assignment.roomId) throw new v.HttpError(409, "No rooms of this type are available for those dates.");
    const newRoomAmount = priceAt(type, checkInDate) * nights;
    const paid = await Payment.aggregate([{ $match: { bookingId: booking._id, status: "success" } }, { $group: { _id: null, total: { $sum: "$amount" } } }]);
    if ((paid[0]?.total || 0) > newRoomAmount + booking.serviceAmount - booking.discountAmount) throw new v.HttpError(409, "The new total cannot be lower than the amount already paid.");
    booking.checkInDate = checkInDate; booking.checkOutDate = checkOutDate; room.roomId = assignment.roomId; room.guestCount = guests; room.priceAtBooking = priceAt(type, checkInDate); booking.roomAmount = newRoomAmount; booking.totalAmount = newRoomAmount + booking.serviceAmount - booking.discountAmount;
  }
  booking.events.push({ actorId: req.user._id, type: "modified", note: "Booking modified by receptionist" });
  await booking.save(); res.json({ data: booking });
}
function refundFor(booking, paidDeposit) {
  const hours = (booking.checkInDate - new Date()) / 3600000;
  const tier = (booking.policySnapshot?.cancellationTiers || []).sort((a, b) => b.minHoursBeforeCheckIn - a.minHoursBeforeCheckIn).find((t) => hours >= t.minHoursBeforeCheckIn);
  return tier ? Math.round(paidDeposit * tier.refundPercent / 100) : 0;
}
async function cancelWalkIn(req, res) {
  if (req.role.key !== "receptionist") throw new v.HttpError(403, "Only a receptionist can cancel a booking.");
  v.keys(req.body, ["reason", "verificationMethod", "bank", "accountNumber", "accountHolderName"]);
  const b = req.body; const booking = await Booking.findById(v.id(req.params.id));
  if (!booking) throw new v.HttpError(404, "Booking not found.");
  if (booking.status === "cancellation_requested") throw new v.HttpError(409, "This cancellation request is already pending review.");
  if (!["pending", "confirmed"].includes(booking.status)) throw new v.HttpError(409, "This booking cannot be cancelled.");
  const reason = v.text(b.reason, "reason", 2, 250);
  const verificationMethod = v.choice(b.verificationMethod, "verificationMethod", ["front_desk_id"]);
  const deposits = await Payment.find({ bookingId: booking._id, kind: "deposit", status: "success" }).lean();
  const paidDeposit = deposits.reduce((sum, payment) => sum + payment.amount, 0);
  booking.cancellationReason = reason; booking.cancellationVerification = verificationMethod;
  if (!paidDeposit) {
    booking.status = "cancelled"; booking.cancelledAt = new Date();
    booking.events.push({ actorId: req.user._id, type: "cancelled", note: `Cancelled at front desk: ${reason}` });
    await booking.save(); return res.json({ data: booking, meta: { reviewRequired: false } });
  }
  const refundableAmount = refundFor(booking, paidDeposit);
  if (refundableAmount && (!b.bank || !b.accountNumber || !b.accountHolderName)) v.fail("Refund bank, account number and account holder are required.");
  booking.status = "cancellation_requested"; booking.cancellationRequestedAt = new Date(); booking.refundableAmount = refundableAmount;
  if (refundableAmount) booking.refundAccount = { bank: v.text(b.bank, "bank", 2, 80), accountNumber: v.text(b.accountNumber, "accountNumber", 4, 40), accountHolderName: v.text(b.accountHolderName, "accountHolderName", 2, 80) };
  booking.events.push({ actorId: req.user._id, type: "cancelled", note: `Cancellation requested at front desk: ${reason}` });
  await booking.save(); res.json({ data: booking, meta: { reviewRequired: true, refundableAmount } });
}
const vnDate = (date = new Date()) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Ho_Chi_Minh" }).format(date);
async function availableRooms(req, res) {
  if (req.role.key !== "receptionist") throw new v.HttpError(403, "Only a receptionist can check in a guest.");
  const booking = await Booking.findById(v.id(req.params.id));
  if (!booking) throw new v.HttpError(404, "Booking not found.");
  const roomTypeId = booking.rooms[0].roomTypeId;
  const candidates = await Room.find({ roomTypeId, isActive: true, status: "available" }).select("roomNumber floor roomTypeId").lean();
  const busy = await Booking.distinct("rooms.roomId", { _id: { $ne: booking._id }, status: { $in: ACTIVE }, checkInDate: { $lt: booking.checkOutDate }, checkOutDate: { $gt: booking.checkInDate }, "rooms.roomId": { $in: candidates.map((r) => r._id) } });
  res.json({ data: candidates.filter((r) => !busy.some((id) => String(id) === String(r._id))) });
}
async function checkIn(req, res) {
  if (req.role.key !== "receptionist") throw new v.HttpError(403, "Only a receptionist can check in a guest.");
  v.keys(req.body, ["roomId", "guestCount", "idDocumentNo"]);
  const booking = await Booking.findById(v.id(req.params.id)).select("+guestIdDocumentNo");
  if (!booking) throw new v.HttpError(404, "Booking not found.");
  if (booking.status !== "confirmed") throw new v.HttpError(409, "Only a confirmed booking can be checked in.");
  if (vnDate(booking.checkInDate) !== vnDate()) throw new v.HttpError(409, "This booking is outside its check-in period.");
  const room = await Room.findOne({ _id: v.id(req.body.roomId, "roomId"), roomTypeId: booking.rooms[0].roomTypeId, isActive: true, status: "available" });
  if (!room) throw new v.HttpError(409, "The selected room is no longer available.");
  const guestCount = v.number(req.body.guestCount, "guestCount", 1, 20);
  const type = await RoomType.findById(booking.rooms[0].roomTypeId);
  if (!type || guestCount > type.maxOccupancy) v.fail("Invalid guest count.", "guestCount");
  booking.rooms[0].roomId = room._id; booking.rooms[0].guestCount = guestCount; booking.guestIdDocumentNo = v.text(req.body.idDocumentNo, "idDocumentNo", 3, 40);
  booking.status = "checked_in"; booking.actualCheckInAt = new Date(); booking.checkedInBy = req.user._id;
  booking.events.push({ actorId: req.user._id, type: "checked_in", note: `Checked in to room ${room.roomNumber}` });
  room.status = "occupied"; await room.save(); await booking.save();
  res.json({ data: booking });
}
async function changeRoomOptions(req, res) {
  if (req.role.key !== "receptionist") throw new v.HttpError(403, "Only a receptionist can change a room.");
  const booking = await Booking.findById(v.id(req.params.id));
  if (!booking || booking.status !== "checked_in") throw new v.HttpError(409, "Only a checked-in booking can change rooms.");
  const current = booking.rooms[0]; const currentType = await RoomType.findById(current.roomTypeId);
  const types = await RoomType.find({ isActive: true, basePrice: { $gte: currentType.basePrice } }).select("name basePrice").lean();
  const rooms = await Room.find({ roomTypeId: { $in: types.map((t) => t._id) }, isActive: true, status: "available" }).select("roomNumber floor roomTypeId").lean();
  const typeById = new Map(types.map((t) => [String(t._id), t]));
  res.json({ data: rooms.map((room) => ({ ...room, roomType: typeById.get(String(room.roomTypeId)) })) });
}
async function changeRoom(req, res) {
  if (req.role.key !== "receptionist") throw new v.HttpError(403, "Only a receptionist can change a room.");
  v.keys(req.body, ["newRoomId", "cause"]);
  const booking = await Booking.findById(v.id(req.params.id));
  if (!booking || booking.status !== "checked_in") throw new v.HttpError(409, "Only a checked-in booking can change rooms.");
  const oldRoom = await Room.findById(booking.rooms[0].roomId); const newRoom = await Room.findOne({ _id: v.id(req.body.newRoomId, "newRoomId"), isActive: true, status: "available" });
  if (!oldRoom || !newRoom) throw new v.HttpError(409, "The selected room is no longer available.");
  const [oldType, newType] = await Promise.all([RoomType.findById(oldRoom.roomTypeId), RoomType.findById(newRoom.roomTypeId)]);
  if (!oldType || !newType || newType.basePrice < oldType.basePrice) throw new v.HttpError(409, "Only the booked room type or an upgrade is available.");
  const cause = v.choice(req.body.cause, "cause", ["hotel", "guest"]);
  const today = new Date(`${vnDate()}T00:00:00Z`); const remainingNights = Math.max(0, Math.ceil((booking.checkOutDate - today) / 86400000));
  const extra = cause === "guest" ? Math.max(0, newType.basePrice - oldType.basePrice) * remainingNights : 0;
  booking.rooms[0].roomId = newRoom._id; booking.rooms[0].roomTypeId = newType._id;
  if (cause === "guest") { booking.roomAmount += extra; booking.totalAmount += extra; }
  booking.events.push({ actorId: req.user._id, type: "room_changed", note: `${cause === "hotel" ? "Hotel" : "Guest"} room change to ${newRoom.roomNumber}`, oldValue: { roomId: oldRoom._id }, newValue: { roomId: newRoom._id, extra } });
  oldRoom.status = "cleaning"; newRoom.status = "occupied"; await Promise.all([oldRoom.save(), newRoom.save(), booking.save()]);
  res.json({ data: booking, meta: { extraCharge: extra } });
}
module.exports = { create, roomTypes, createWalkIn, modifyWalkIn, cancelWalkIn, availableRooms, checkIn, changeRoomOptions, changeRoom };
