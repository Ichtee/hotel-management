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

const ACTIVE = ["pending", "confirmed", "checked_in"];
const OPEN_ISSUE = ["open", "in_progress"];
const NOT_AVAILABLE = "The selected room is not available for the selected dates. Please choose another room or date."; // MSG-30
const NO_CHECK_IN = "This booking cannot be checked in. Check its status and check-in date."; // MSG-69
const reference = () => `BK-${Date.now().toString(36).toUpperCase()}-${randomBytes(3).toString("hex").toUpperCase()}`;
const vnDate = (date = new Date()) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Ho_Chi_Minh" }).format(date);
const at = (date, time) => new Date(`${iso(date)}T${time}:00+07:00`); // a time of a date, hotel local time (CR-05)
// A notification failure never rolls back the business transaction (CR-15).
const tell = (...a) => notify(...a).catch((e) => console.error("Notification failed:", e.message));

// BR-12: check-out after check-in (MSG-32); a new check-in date is not in the past (MSG-56).
function stayDates(checkInDate, checkOutDate, { allowPast = false } = {}) {
  v.date(checkInDate, "checkInDate"); v.date(checkOutDate, "checkOutDate");
  if (nightsOf(checkInDate, checkOutDate) < 1) v.fail("Check-out date must be later than check-in date.", "checkOutDate");
  if (!allowPast && checkInDate < vnDate()) v.fail("Check-in date must not be in the past.", "checkInDate");
}
// BR-10: a room of the type that no other active booking holds on these nights; rooms in Maintenance are never offered.
async function assignRoom(roomTypeId, checkInDate, checkOutDate, ignoredBookingId) {
  const candidates = await Room.find({ roomTypeId, isActive: true, status: { $ne: "maintenance" } }).select("_id").lean();
  const busy = await busyRooms(candidates.map((r) => r._id), checkInDate, checkOutDate, ignoredBookingId);
  return { roomId: candidates.find((r) => !busy.has(String(r._id)))?._id || null };
}
async function busyRooms(ids, from, to, ignoredBookingId) {
  const filter = { status: { $in: ACTIVE }, checkInDate: { $lt: new Date(`${iso(to)}T00:00:00Z`) }, checkOutDate: { $gt: new Date(`${iso(from)}T00:00:00Z`) }, "rooms.roomId": { $in: ids } };
  if (ignoredBookingId) filter._id = { $ne: ignoredBookingId };
  return new Set((await Booking.distinct("rooms.roomId", filter)).map(String));
}
const depositsPaid = async (bookingId) =>
  (await Payment.find({ bookingId, kind: "deposit", status: "success" }).select("amount").lean()).reduce((s, p) => s + p.amount, 0);
const totalOf = (b) => b.roomAmount - (b.discountAmount || 0) + (b.serviceAmount || 0) + (b.feeAmount || 0) + (b.penaltyAmount || 0);

// UC06: a logged-in Customer books an available room type; the room is held 15 minutes for the deposit (BR-29).
async function create(req, res) {
  v.keys(req.body, ["roomTypeId", "checkInDate", "checkOutDate", "guestCount", "couponCode", "paymentOption", "fullName", "phone", "email", "consent", "captchaToken"]);
  const { roomTypeId, checkInDate, checkOutDate } = req.body;
  v.id(roomTypeId, "roomTypeId"); stayDates(checkInDate, checkOutDate);
  const guestCount = v.number(req.body.guestCount, "guestCount", 1, 20);
  // BR-13/BR-14: an online booking is confirmed by paying the deposit online; there is no pay-at-hotel or pay-in-full option.
  v.choice(req.body.paymentOption || "deposit", "paymentOption", ["deposit"]);
  if (req.body.consent !== true) v.fail("Privacy consent is required.", "consent"); // CR-21, MSG-04
  // Step 3: the contact data is pre-filled from the profile and can be corrected.
  const guestName = v.text(req.body.fullName ?? req.user.customerProfile?.fullName ?? req.user.username, "fullName", 2, 80);
  const guestPhone = req.body.phone === undefined ? req.user.phone : v.phone(req.body.phone, true);
  const guestEmail = req.body.email === undefined ? req.user.email : v.email(req.body.email);
  await assertCaptcha(req.body.captchaToken, req.ip); // MSG-80
  if ((await Booking.countDocuments({ customerId: req.user._id, status: "pending", holdExpiresAt: { $gt: new Date() } })) >= 3)
    throw new v.HttpError(409, "You already have 3 unpaid bookings. Please pay, cancel the payment or wait for one of them to expire."); // MSG-79
  const type = await RoomType.findOne({ _id: roomTypeId, isActive: true });
  if (!type) throw new v.HttpError(404, "This room type is no longer available."); // MSG-82
  if (guestCount > type.maxOccupancy) v.fail(`This room accommodates up to ${type.maxOccupancy} guests.`, "guestCount");
  const assignment = await assignRoom(type._id, checkInDate, checkOutDate);
  if (!assignment.roomId) throw new v.HttpError(409, NOT_AVAILABLE);
  const nightlyRates = priceNights(type, checkInDate, checkOutDate); // BR-07: every night at its own rate
  const roomAmount = sumNights(nightlyRates);
  const coupon = req.body.couponCode?.trim() ? await validateCoupon({ code: req.body.couponCode, customerId: req.user._id, subtotal: roomAmount }) : null;
  const discountAmount = coupon?.discountAmount || 0;
  const totalAmount = roomAmount - discountAmount;
  const [policy, cancellation] = await Promise.all([currentDepositPolicy(), currentCancellationPolicy()]);
  if (!policy) throw new v.HttpError(409, "Online booking is not available yet: the hotel has not set a deposit policy.");
  const depositRequired = percentOf(totalAmount, policy.deposit.value);
  // BR-29: the room is held for 15 minutes while the deposit is paid; BR-31: a booking with nothing to pay is confirmed at once.
  const held = depositRequired >= 1;
  const booking = await Booking.create({
    bookingReference: reference(), customerId: req.user._id, createdBy: req.user._id, checkInDate, checkOutDate,
    status: held ? "pending" : "confirmed", holdExpiresAt: held ? new Date(Date.now() + 15 * 60000) : undefined,
    rooms: [{ roomId: assignment.roomId, roomTypeId: type._id, priceAtBooking: Math.round(roomAmount / nightsOf(checkInDate, checkOutDate)), guestCount }],
    guestName, guestPhone, guestEmail, consentAt: new Date(), nightlyRates,
    couponCode: coupon?.code, discountAmount, roomAmount, totalAmount, depositRequired,
    // BR-35: deposit percentage and cancellation tiers are copied into the booking.
    policySnapshot: {
      depositPolicyId: policy._id, depositType: policy.deposit.type, depositValue: policy.deposit.value, depositDescription: policy.description,
      cancellationPolicyId: cancellation?._id, cancellationDescription: cancellation?.description,
      cancellationTiers: (cancellation?.cancellationTiers || []).map(({ minHoursBeforeCheckIn, refundPercent }) => ({ minHoursBeforeCheckIn, refundPercent })),
    },
    bookingSource: "online", events: [{ actorId: req.user._id, type: "created", note: "Booking created online" }],
  });
  if (coupon) { await CouponUsage.create({ couponId: coupon.couponId, bookingId: booking._id, customerId: req.user._id }); await Coupon.updateOne({ _id: coupon.couponId }, { $inc: { usageCount: 1 } }); }
  if (!held) await tell("booking_confirmed", booking.customerId, { reference: booking.bookingReference }, { bookingId: booking._id });
  // The deposit order is opened by the payment page (UC10), so no placeholder payment is created here.
  res.status(201).json({ data: booking });
}
async function roomTypes(_req, res) { res.json({ data: await RoomType.find({ isActive: true }).select("name description basePrice maxOccupancy amenities images bedType roomSizeSqm seasonalPricing").sort({ basePrice: 1 }).lean() }); }

// UC14: walk-in booking for today, no deposit (BR-12, BR-13).
async function createWalkIn(req, res) {
  v.keys(req.body, ["roomTypeId", "checkInDate", "checkOutDate", "guestCount", "fullName", "phone", "email", "idDocumentNo"]);
  const b = req.body;
  v.id(b.roomTypeId, "roomTypeId"); stayDates(b.checkInDate, b.checkOutDate);
  if (b.checkInDate !== vnDate()) v.fail("A booking without a deposit can only be created for today's check-in date.", "checkInDate", 409); // MSG-62
  const guestCount = v.number(b.guestCount, "guestCount", 1, 20);
  const fullName = v.text(b.fullName, "fullName", 2, 80), phone = v.phone(b.phone, true), idDocumentNo = v.text(b.idDocumentNo, "idDocumentNo", 3, 40);
  const email = b.email ? v.email(b.email) : undefined;
  const type = await RoomType.findOne({ _id: b.roomTypeId, isActive: true });
  if (!type) throw new v.HttpError(404, "This room type is no longer available.");
  if (guestCount > type.maxOccupancy) v.fail(`This room accommodates up to ${type.maxOccupancy} guests.`, "guestCount");
  const assignment = await assignRoom(type._id, b.checkInDate, b.checkOutDate);
  if (!assignment.roomId) throw new v.HttpError(409, NOT_AVAILABLE);
  const nightlyRates = priceNights(type, b.checkInDate, b.checkOutDate), roomAmount = sumNights(nightlyRates);
  const booking = await Booking.create({ bookingReference: reference(), nightlyRates, createdBy: req.user._id, checkInDate: b.checkInDate, checkOutDate: b.checkOutDate, status: "confirmed", rooms: [{ roomId: assignment.roomId, roomTypeId: type._id, priceAtBooking: Math.round(roomAmount / nightsOf(b.checkInDate, b.checkOutDate)), guestCount }], guestName: fullName, guestPhone: phone, guestEmail: email, guestIdDocumentNo: idDocumentNo, roomAmount, totalAmount: roomAmount, depositRequired: 0, bookingSource: "front_desk", events: [{ actorId: req.user._id, type: "created", note: "Walk-in booking created by receptionist" }] });
  res.status(201).json({ data: booking, message: "Booking created successfully." }); // MSG-31
}

// UC07 / UC15: new stay dates or number of guests. Kept nights keep their snapshot price (BR-35), added nights use the rate of
// that night (BR-07, BR-34) and the coupon is checked again (BR-09, BR-46). A Confirmed booking keeps its deposit and its total
// may not fall below it (BR-40); a Pending Payment booking gets a new deposit and cannot change while a gateway payment is pending.
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
    const now = await estimate(booking); // BR-46: only while a cancellation now would be refunded in full
    if (now.depositPaid > 0 && now.refundPercent < 100) throw new v.HttpError(409, "The stay dates can no longer be changed for this booking. Keep the current dates or cancel the booking."); // MSG-78
  }
  let roomId;
  if (booking.status === "checked_in") roomId = (await busyRooms([line.roomId], oldOut, checkOutDate, booking._id)).size ? null : line.roomId; // the guest keeps the room
  else roomId = (await assignRoom(type._id, checkInDate, checkOutDate, booking._id)).roomId;
  if (!roomId) throw new v.HttpError(409, NOT_AVAILABLE);
  const nightlyRates = priceNights(type, checkInDate, checkOutDate, storedNights(booking)); // kept nights keep their price (BR-35)
  const roomAmount = sumNights(nightlyRates);
  let discountAmount = 0, couponCode = booking.couponCode;
  if (couponCode) {
    try { discountAmount = await recheckCoupon({ code: couponCode, subtotal: roomAmount }); }
    catch (error) { if (byCustomer || !dropCoupon) throw error; couponCode = undefined; } // UC15: only when the guest agrees
  }
  Object.assign(booking, { checkInDate, checkOutDate, nightlyRates, roomAmount, discountAmount, couponCode });
  booking.totalAmount = totalOf(booking);
  if (booking.status === "pending") booking.depositRequired = percentOf(booking.totalAmount, booking.policySnapshot?.depositValue ?? (await currentDepositPolicy())?.deposit?.value ?? 0);
  else if (booking.totalAmount < (await depositsPaid(booking._id)))
    throw new v.HttpError(409, "The new total would be lower than the deposit already paid. Cancel the booking instead.");
  line.roomId = roomId; line.priceAtBooking = Math.round(roomAmount / nightsOf(checkInDate, checkOutDate));
}

// UC15: the Receptionist edits the stay and the customer information on the booking (not the e-mail or password of an account).
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
  if (stayChange) await changeStay(booking, b, { byCustomer: false, dropCoupon: b.dropCoupon === true });
  booking.events.push({ actorId: req.user._id, type: "modified", note: "Booking modified by receptionist" });
  await booking.save();
  if (booking.customerId) await tell("booking_modified", booking.customerId, { reference: booking.bookingReference }, { bookingId: booking._id });
  res.json({ data: booking, message: "Updated successfully." }); // MSG-02
}

// UC07: the Customer changes the dates, the number of guests and the contact data of his/her own booking; the room type is
// not changed and the ID / passport number is given only at check-in (SRS 4.2.4).
async function modifyOwn(req, res) {
  v.keys(req.body, ["checkInDate", "checkOutDate", "guestCount", "fullName", "phone", "email", "specialRequests"]);
  const booking = await Booking.findOne({ _id: v.id(req.params.id), customerId: req.user._id });
  if (!booking) throw new v.HttpError(404, "Booking not found.");
  if (!["pending", "confirmed"].includes(booking.status)) throw new v.HttpError(409, "This booking can no longer be modified.");
  const b = req.body;
  if (b.fullName !== undefined) booking.guestName = v.text(b.fullName, "fullName", 2, 80);
  if (b.phone !== undefined) booking.guestPhone = v.phone(b.phone, true);
  if (b.email !== undefined) booking.guestEmail = v.email(b.email);
  await changeStay(booking, b, { byCustomer: true });
  booking.events.push({ actorId: req.user._id, type: "modified", note: "Booking modified by the customer" });
  await booking.save();
  await tell("booking_modified", booking.customerId, { reference: booking.bookingReference }, { bookingId: booking._id });
  res.json({ data: booking, message: "Updated successfully." });
}

// UC17 step 2: Available rooms of the booked type, and the data of an approved check-in request to pre-fill the form.
async function availableRooms(req, res) {
  const booking = await Booking.findById(v.id(req.params.id));
  if (!booking) throw new v.HttpError(404, "Booking not found.");
  const candidates = await Room.find({ roomTypeId: booking.rooms[0].roomTypeId, isActive: true, status: "available" }).select("roomNumber floor roomTypeId").lean();
  const busy = await busyRooms(candidates.map((r) => r._id), booking.checkInDate, booking.checkOutDate, booking._id);
  const request = await Request.findOne({ bookingId: booking._id, type: "check_in", status: "approved" }).select("+mainGuestIdNumber");
  res.json({ data: candidates.filter((r) => !busy.has(String(r._id))), meta: { request: request && { guestCount: request.numberOfGuests, idDocumentNo: request.mainGuestIdNumber, requestedTime: request.requestedTime } } });
}
// UC17: on the check-in date, or after midnight until the 06:00 no-show cut-off (BR-18, BR-33).
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
  // BR-44: the early check-in fee is posted once, when the guest really checks in before the standard time (CR-19).
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
  res.json({ data: booking, message: "Check-in completed successfully." }); // MSG-44
}

// UC18 / BR-38: where the booking may move for the remaining nights - rooms during the stay, room types before check-in.
// A lower-priced room type is offered only when no room of the booked or a higher-priced type is free.
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
    // MSG-68: a lower-priced type while the booked or a higher-priced one is still free; otherwise MSG-30.
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
    // Nights already spent keep their price and room type; the remaining nights are charged at the new type (upgrade always charged).
    booking.nightlyRates = [...storedNights(booking).filter((n) => iso(n.date) < from), ...priceNights(pick.roomType, from, to)];
    booking.roomAmount = sumNights(booking.nightlyRates);
  } else {
    booking.nightlyRates = priceNights(pick.roomType, from, to); // UC18 1a: the whole stay is repriced; the deposit does not change (BR-40)
    booking.roomAmount = sumNights(booking.nightlyRates);
    if (booking.couponCode) {
      try { booking.discountAmount = await recheckCoupon({ code: booking.couponCode, subtotal: booking.roomAmount }); }
      catch (error) { if (req.body.dropCoupon !== true) throw error; booking.discountAmount = 0; booking.couponCode = undefined; }
    }
  }
  booking.totalAmount = Math.max(0, totalOf(booking)); // a downgrade below the deposit leaves a balance of 0 (LIM-08)
  line.roomTypeId = pick.roomType._id; line.priceAtBooking = Math.round(booking.roomAmount / nights);
  let turnover;
  if (checkedIn) {
    const oldRoom = await Room.findById(line.roomId);
    line.roomId = pick.room._id;
    // BR-05: the vacated room goes to Maintenance when it has a reported issue, otherwise to Cleaning.
    const broken = oldRoom && (await RoomIssue.exists({ roomId: oldRoom._id, status: { $in: OPEN_ISSUE } }));
    if (oldRoom) await Room.updateOne({ _id: oldRoom._id }, { $set: { status: broken ? "maintenance" : "cleaning" } });
    await Room.updateOne({ _id: pick.room._id }, { $set: { status: "occupied" } });
    if (oldRoom) turnover = (await createCleaningTask({ roomId: String(oldRoom._id), type: "turnover" })).data;
  } else line.roomId = (await assignRoom(pick.roomType._id, from, to, booking._id)).roomId;
  booking.events.push({ actorId: req.user._id, type: "room_changed", note: `${checkedIn ? `Moved to room ${pick.room.roomNumber}` : `Room type changed to ${pick.roomType.name}`}${pick.lower ? " (lower-priced, guest agreed)" : ""}`, oldValue: before, newValue: { roomId: line.roomId, roomTypeId: line.roomTypeId, roomAmount: booking.roomAmount } });
  await booking.save();
  await audit(req.user._id, "booking.room_changed", "booking", booking._id, { before, after: { roomId: line.roomId, roomTypeId: line.roomTypeId, roomAmount: booking.roomAmount }, guestAgreedLower: pick.lower });
  res.json({ data: booking, meta: { difference: booking.roomAmount - before.roomAmount, turnoverTask: turnover }, message: "Room assigned successfully." }); // MSG-45
}

async function services(_req, res) {
  res.json({ data: await Service.find({ isActive: true, kind: { $ne: "compensation" } }).select("name category unitPrice").sort({ name: 1 }).lean() });
}
async function addService(req, res) {
  v.keys(req.body, ["serviceId", "quantity"]);
  const booking = await Booking.findById(v.id(req.params.id));
  if (!booking) throw new v.HttpError(404, "Booking not found.");
  if (booking.status !== "checked_in") throw new v.HttpError(409, "Services can only be recorded for a checked-in booking.");
  const service = await Service.findOne({ _id: v.id(req.body.serviceId, "serviceId"), isActive: true, kind: { $ne: "compensation" } });
  if (!service) throw new v.HttpError(404, "This service is no longer available.");
  const quantity = v.number(req.body.quantity, "quantity", 1, 100); const amount = service.unitPrice * quantity;
  booking.services.push({ serviceId: service._id, name: service.name, quantity, unitPrice: service.unitPrice, amount, recordedBy: req.user._id });
  booking.serviceAmount += amount; booking.totalAmount += amount;
  booking.events.push({ actorId: req.user._id, type: "service_added", note: `Added ${quantity} × ${service.name}`, newValue: { serviceId: service._id, quantity, amount } });
  await booking.save(); res.status(201).json({ data: booking, message: "Saved successfully." }); // MSG-01
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
  await audit(req.user._id, "booking_service.voided", "booking", booking._id, { service: line.name, amount: line.amount, reason: line.voidReason }); // BR-19
  res.json({ data: booking });
}

// BR-44 / BR-47: after the standard check-out time of the check-out date the late check-out fee is posted, after 18:00 one
// extra night at the rate of that night instead; once per stay, without changing the check-out date. Leaving early costs
// nothing extra (BR-39).
// The charge due now, if any (pure: nothing is written).
async function lateCharge(booking, now = new Date()) {
  if (booking.feeLines.some((l) => l.type === "late_check_out" || l.type === "extra_night")) return null;
  const policy = await currentCancellationPolicy();
  if (now <= at(booking.checkOutDate, policy?.checkOutTime || "12:00")) return null;
  const extraNight = now > at(booking.checkOutDate, "18:00");
  const amount = extraNight ? priceAt(await RoomType.findById(booking.rooms[0].roomTypeId), booking.checkOutDate) : policy?.lateCheckOutFee || 0;
  return amount ? { type: extraNight ? "extra_night" : "late_check_out", amount, postedAt: now } : null;
}
// One atomic update, so two parallel calls (a double click, React strict mode) post the charge once; the caller re-reads the booking.
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
// UC20 steps 1-4: an urgent Inspection task for the responsible staff member (unless a check-out request already created
// one), the late charge if due, and the final bill.
async function startCheckOut(req, res) {
  const booking = await Booking.findById(v.id(req.params.id));
  if (!booking) throw new v.HttpError(404, "Booking not found.");
  if (booking.status !== "checked_in") throw new v.HttpError(409, "Only a checked-in booking can be checked out.");
  if (!(await Task.exists({ bookingId: booking._id, type: "inspection" })) && booking.rooms[0].roomId) {
    // The same key as the scheduler's, so a parallel call (or the 30-minute job) can never add a second inspection.
    try { await createCleaningTask({ roomId: String(booking.rooms[0].roomId), bookingId: String(booking._id), type: "inspection", inspectionKey: `${booking.id}:${booking.rooms[0].roomId}`, requestContent: "Inspect the room at check-out: minibar, equipment, linen, keys." }); }
    catch (error) { if (error.code !== 11000) throw error; }
  }
  await postLateCharge(booking);
  res.json({ data: await checkOutBill(await Booking.findById(booking._id)) });
}
// UC20 steps 5-7: only with the whole balance paid (UC11), the reported damage decided and the inspection done or skipped (BR-20).
async function checkOut(req, res) {
  v.keys(req.body, ["skipInspection"]);
  let booking = await Booking.findById(v.id(req.params.id));
  if (!booking) throw new v.HttpError(404, "Booking not found.");
  if (booking.status !== "checked_in") throw new v.HttpError(409, "Only a checked-in booking can be checked out.");
  await postLateCharge(booking);
  booking = await Booking.findById(booking._id); // the charge was written atomically
  if (await Penalty.exists({ bookingId: booking._id, status: "proposed" })) throw new v.HttpError(409, "Confirm or waive the damage / loss items reported by Housekeeping first.");
  const balance = Math.max(0, booking.totalAmount - (await paidAmount(booking._id)));
  if (balance) throw new v.HttpError(409, `Check-out cannot be completed while ${balance.toLocaleString("en-US")} VND is unpaid. Record the payment first.`);
  const task = await Task.findOne({ bookingId: booking._id, type: "inspection" }).sort({ createdAt: -1 });
  if (task?.status !== "completed") {
    if (req.body.skipInspection !== true) throw new v.HttpError(409, "The room inspection is not finished. Wait for the result or skip it.");
    // UC20 3a / BR-22: the skipped inspection is closed as Completed with a note, directly from Assigned or In Progress.
    if (task) await Task.updateOne({ _id: task._id }, { $set: { status: "completed", notes: "Skipped at check-out", completedAt: new Date() } });
    await audit(req.user._id, "inspection.skipped", "booking", booking._id, { taskId: task?._id });
  }
  const roomIds = booking.rooms.map((room) => room.roomId).filter(Boolean);
  const broken = new Set((await RoomIssue.distinct("roomId", { roomId: { $in: roomIds }, status: { $in: OPEN_ISSUE } })).map(String));
  for (const id of roomIds) await Room.updateOne({ _id: id }, { $set: { status: broken.has(String(id)) ? "maintenance" : "cleaning" } }); // BR-05
  booking.status = "checked_out"; booking.actualCheckOutAt = new Date(); booking.checkedOutBy = req.user._id;
  booking.events.push({ actorId: req.user._id, type: "checked_out", note: "Checked out" });
  await booking.save();
  await closeForBooking(booking._id);
  const turnovers = await Promise.all(roomIds.map((roomId) => createCleaningTask({ roomId: String(roomId), bookingId: String(booking._id), type: "turnover" })));
  let invoice, warning;
  try { invoice = await issueInvoice(booking, req.user._id); }
  catch (error) { console.error("Invoice generation failed:", error.message); warning = "The invoice could not be generated. Please try again."; } // UC20 7a, MSG-48
  res.json({ data: { booking, invoice, turnoverTasks: turnovers.map((item) => item.data) }, message: "Check-out completed successfully.", ...(warning ? { warning } : {}) }); // MSG-47
}
const FEE_NAMES = { early_check_in: "Early check-in fee", late_check_out: "Late check-out fee", extra_night: "Extra night (check-out after 18:00)" };
// BR-21: the bill lines, the hotel name and address are copied into the invoice when it is generated.
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
  // ponytail: the daily sequence is counted, so two check-outs in the same instant can collide; the unique index rejects one and "Generate invoice" retries.
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
// UC20 7a: "Generate invoice" again after a failure.
async function generateInvoice(req, res) {
  const booking = await Booking.findById(v.id(req.params.id));
  if (!booking || booking.status !== "checked_out") throw new v.HttpError(409, "An invoice is generated only after check-out.");
  res.status(201).json({ data: await issueInvoice(booking, req.user._id) });
}
module.exports = { create, roomTypes, createWalkIn, modifyWalkIn, modifyOwn, availableRooms, checkIn, changeRoomOptions, changeRoom, services, addService, voidService, startCheckOut, checkOut, generateInvoice, lateCharge };
