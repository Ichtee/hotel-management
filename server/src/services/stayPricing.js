const Booking = require("../models/Booking");
const Room = require("../models/Room");
const RoomType = require("../models/RoomType");
const Payment = require("../models/Payment");
const HotelPolicy = require("../models/HotelPolicy");
const v = require("../utils/validation");
const { hotelDay } = require("./roomInventory");

const day = (value) => new Date(value).toISOString().slice(0, 10);
const nextDay = (value) =>
  day(new Date(Date.parse(`${value}T00:00:00Z`) + 86400000));
const atHotel = (value, time) => new Date(`${day(value)}T${time}:00+07:00`);

function dates(from, to) {
  v.date(from, "checkInDate");
  v.date(to, "checkOutDate");
  const length = (Date.parse(to) - Date.parse(from)) / 86400000;
  if (length < 1 || length > 730)
    v.fail("Stay must contain between 1 and 730 nights.");
  return Array.from({ length }, (_, i) =>
    day(new Date(Date.parse(from) + i * 86400000)),
  );
}

function amount(value) {
  if (!Number.isSafeInteger(value) || value < 0)
    throw new v.HttpError(409, "The amount cannot be calculated safely.");
  return value;
}

function priceNights(type, from, to, previous = []) {
  const saved = new Map(previous.map((n) => [n.date, n]));
  return dates(from, to).map((date) => {
    const rate = (type.seasonalPricing || []).find(
      (p) => day(p.startDate) <= date && date <= day(p.endDate),
    );
    return {
      date,
      roomTypeId: saved.get(date)?.roomTypeId || type._id,
      price: saved.has(date)
        ? saved.get(date).price
        : amount(rate?.price ?? type.basePrice),
    };
  });
}

// Chặn tính lại giá lịch sử khi booking cũ không đủ snapshot đã xác minh.
function requireSnapshot(booking) {
  if (
    !booking.nightlyRates?.length ||
    !booking.policySnapshot?.checkInTime ||
    !booking.policySnapshot?.checkOutTime ||
    !Number.isSafeInteger(booking.policySnapshot?.earlyCheckInFee) ||
    !Number.isSafeInteger(booking.policySnapshot?.lateCheckOutFee)
  )
    throw new v.HttpError(
      409,
      "This booking needs its historical rates and stay policy verified before this action.",
    );
  if (
    amount(booking.nightlyRates.reduce((sum, n) => sum + n.price, 0)) !==
    booking.roomAmount
  )
    throw new v.HttpError(409, "The stored nightly rates need to be reviewed.");
}

async function policySnapshot(session, now = new Date()) {
  const filter = {
    isActive: true,
    effectiveFrom: { $lte: now },
    $or: [{ effectiveTo: null }, { effectiveTo: { $gt: now } }],
  };
  const deposit = await HotelPolicy.findOne({ ...filter, kind: "deposit" })
    .sort({ effectiveFrom: -1 })
    .session(session);
  const stay = await HotelPolicy.findOne({ ...filter, kind: "cancellation" })
    .sort({ effectiveFrom: -1 })
    .session(session);
  return {
    depositPolicyId: deposit?._id,
    depositType: "percentage",
    depositValue: deposit?.deposit.value ?? 0,
    cancellationPolicyId: stay?._id,
    cancellationTiers: stay?.cancellationTiers?.toObject() || [],
    checkInTime: stay?.checkInTime || "14:00",
    checkOutTime: stay?.checkOutTime || "12:00",
    earlyCheckInFee: stay?.earlyCheckInFee ?? 0,
    lateCheckOutFee: stay?.lateCheckOutFee ?? 0,
  };
}

// Tồn theo từng đêm gồm cả thay đổi đang chờ cọc, không giữ hai lần cùng một đêm.
async function availability(
  typeId,
  from,
  to,
  session,
  ignoredId,
  now = new Date(),
) {
  const nights = dates(from, to);
  const capacity = await Room.countDocuments({
    roomTypeId: typeId,
    isActive: true,
    status: { $ne: "maintenance" },
  }).session(session);
  const candidates = await Booking.find({
    ...(ignoredId ? { _id: { $ne: ignoredId } } : {}),
    status: {
      $in: ["pending", "confirmed", "cancellation_requested", "checked_in"],
    },
    $or: [
      {
        checkInDate: { $lt: new Date(to) },
        checkOutDate: { $gt: new Date(from) },
      },
      {
        "pendingChange.checkInDate": { $lt: new Date(to) },
        "pendingChange.checkOutDate": { $gt: new Date(from) },
      },
    ],
  })
    .select(
      "rooms checkInDate checkOutDate nightlyRates pendingChange status holdExpiresAt",
    )
    .session(session)
    .lean();
  const pending = await Payment.distinct("bookingId", {
    bookingId: {
      $in: candidates.filter((b) => b.status === "pending").map((b) => b._id),
    },
    status: "pending",
    gatewayOrderId: { $exists: true },
  }).session(session);
  const waiting = new Set(pending.map(String));
  const held = new Map(nights.map((d) => [d, 0]));
  for (const booking of candidates) {
    if (
      booking.status === "pending" &&
      booking.holdExpiresAt &&
      +booking.holdExpiresAt +
        (waiting.has(String(booking._id)) ? 900000 : 0) <=
        +now
    )
      continue;
    const countOn = (d, rates, start, end) =>
      d >= day(start) && d < day(end)
        ? rates?.length
          ? rates.filter(
              (n) => n.date === d && String(n.roomTypeId) === String(typeId),
            ).length
          : booking.rooms.filter((r) => String(r.roomTypeId) === String(typeId))
              .length
        : 0;
    for (const d of nights) {
      const original = countOn(
        d,
        booking.nightlyRates,
        booking.checkInDate,
        booking.checkOutDate,
      );
      const change = booking.pendingChange;
      const proposed =
        change?.holdExpiresAt > now
          ? countOn(
              d,
              change.nightlyRates,
              change.checkInDate,
              change.checkOutDate,
            )
          : 0;
      held.set(d, held.get(d) + Math.max(original, proposed));
    }
  }
  return Math.max(0, Math.min(...nights.map((d) => capacity - held.get(d))));
}

async function assertAvailable(typeId, from, to, session, ignoredId, now) {
  if (!(await availability(typeId, from, to, session, ignoredId, now)))
    throw new v.HttpError(409, "No room is available for the entire stay.");
}

async function getType(typeId, guests, session) {
  const type = await RoomType.findOne({
    _id: v.id(String(typeId), "roomTypeId"),
    isActive: true,
  }).session(session);
  if (!type) throw new v.HttpError(404, "Room type is unavailable.");
  if (guests > type.maxOccupancy)
    v.fail("The guest count exceeds the room capacity.", "guestCount");
  return type;
}

function noShowAt(booking) {
  return atHotel(nextDay(day(booking.checkInDate)), "06:00");
}

// Giữ giá đêm đang ở; khoảng giữa giờ trả và nhận phòng tính cho đêm sắp tới.
function repriceFrom(booking, now) {
  if (booking.status === "confirmed") return day(booking.checkInDate);
  const today = hotelDay(now);
  return now >= atHotel(today, booking.policySnapshot.checkInTime)
    ? nextDay(today)
    : today;
}

module.exports = {
  day,
  nextDay,
  atHotel,
  dates,
  amount,
  priceNights,
  requireSnapshot,
  policySnapshot,
  availability,
  assertAvailable,
  getType,
  noShowAt,
  repriceFrom,
  hotelDay,
};
