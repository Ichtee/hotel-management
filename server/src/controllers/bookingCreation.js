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
async function assignRoom(roomTypeId, checkInDate, checkOutDate) {
  const candidates = await Room.find({ roomTypeId, isActive: true, status: "available" }).select("_id").lean();
  if (!candidates.length) return { inventoryExists: false, roomId: null };
  const busy = await Booking.distinct("rooms.roomId", { status: { $in: ACTIVE }, checkInDate: { $lt: new Date(`${checkOutDate}T00:00:00Z`) }, checkOutDate: { $gt: new Date(`${checkInDate}T00:00:00Z`) }, "rooms.roomId": { $in: candidates.map((r) => r._id) } });
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
module.exports = { create, roomTypes, createWalkIn };
