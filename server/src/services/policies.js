const HotelPolicy = require("../models/HotelPolicy");
// The deposit policy in force at `now`; booking creation snapshots it (BR-31).
const currentDepositPolicy = (now = new Date()) =>
  HotelPolicy.findOne({
    kind: "deposit",
    isActive: true,
    effectiveFrom: { $lte: now },
    $or: [{ effectiveTo: null }, { effectiveTo: { $gt: now } }],
  }).sort({ effectiveFrom: -1 });
module.exports = { currentDepositPolicy };
