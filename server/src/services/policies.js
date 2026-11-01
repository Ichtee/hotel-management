const HotelPolicy = require("../models/HotelPolicy");
const current = (kind) => (now = new Date()) =>
  HotelPolicy.findOne({
    kind,
    isActive: true,
    effectiveFrom: { $lte: now },
    $or: [{ effectiveTo: null }, { effectiveTo: { $gt: now } }],
  }).sort({ effectiveFrom: -1 });
// The policies in force at `now`; booking creation snapshots them (BR-31, BR-35).
const currentDepositPolicy = current("deposit");
const currentCancellationPolicy = current("cancellation");
const DEFAULT_CHECK_IN = "14:00"; // CR-19

// MSG-63: tiers must not overlap or leave gaps (one tier starts at 0 h), refund 100% or 0%,
// and a tier closer to check-in never refunds more than an earlier one.
function tiersProblem(tiers) {
  const byHours = [...tiers].sort((a, b) => b.minHoursBeforeCheckIn - a.minHoursBeforeCheckIn);
  return (
    new Set(tiers.map((t) => t.minHoursBeforeCheckIn)).size !== tiers.length ||
    byHours.at(-1).minHoursBeforeCheckIn !== 0 ||
    tiers.some((t) => ![0, 100].includes(t.refundPercent)) ||
    byHours.some((t, i) => i > 0 && t.refundPercent > byHours[i - 1].refundPercent)
  );
}
// BR-32: share of the deposit refunded when the request is made `hoursBefore` the check-in time;
// after the check-in time the shortest tier applies.
function refundPercent(tiers, hoursBefore) {
  // ponytail: no policy configured at all refunds in full; the manager sets tiers in UC27.
  if (!tiers?.length) return 100;
  const byHours = [...tiers].sort((a, b) => b.minHoursBeforeCheckIn - a.minHoursBeforeCheckIn);
  return (byHours.find((t) => hoursBefore >= t.minHoursBeforeCheckIn) || byHours.at(-1)).refundPercent;
}
// Check-in moment of a stay: the standard check-in time (Asia/Ho_Chi_Minh, UTC+7) of the check-in date.
const checkInAt = (checkInDate, time = DEFAULT_CHECK_IN) =>
  new Date(`${new Date(checkInDate).toISOString().slice(0, 10)}T${time}:00+07:00`);
module.exports = { currentDepositPolicy, currentCancellationPolicy, tiersProblem, refundPercent, checkInAt, DEFAULT_CHECK_IN };
