const HotelPolicy = require("../models/HotelPolicy");
const HotelInfo = require("../models/HotelInfo");
const v = require("../utils/validation");
const { audit } = require("../services/audit");
const { currentDepositPolicy, currentCancellationPolicy, tiersProblem, DEFAULT_CHECK_IN } = require("../services/policies");
async function listing(req, res) {
  const result = await v.list(HotelPolicy, { kind: "deposit" }, req.query);
  result.meta.current = await currentDepositPolicy();
  res.json(result);
}
// Saving creates a new version and retires the old one, so existing bookings keep their snapshot (BR-31, BR-35).
async function version(kind, fields, actorId) {
  const now = new Date();
  await HotelPolicy.updateMany({ kind, isActive: true }, { isActive: false, effectiveTo: now });
  const policy = await HotelPolicy.create({ kind, ...fields, effectiveFrom: now });
  await audit(actorId, `policy.${kind}_saved`, "hotel_policy", policy._id);
  return policy;
}
// UC27: deposit percentage.
async function create(req, res) {
  v.keys(req.body, ["percentage", "name", "description"]);
  const percentage = v.number(req.body.percentage, "percentage", 1, 100);
  const policy = await version("deposit", {
    name: req.body.name === undefined ? `Deposit ${percentage}%` : v.text(req.body.name, "name", 2, 100),
    description: req.body.description === undefined ? undefined : v.text(req.body.description, "description", 0, 500),
    deposit: { type: "percentage", value: percentage },
  }, req.user._id);
  res.status(201).json({ data: policy });
}

// UC27: cancellation / refund tiers with the standard check-in / check-out times and the early / late fees.
async function cancellationListing(req, res) {
  const result = await v.list(HotelPolicy, { kind: "cancellation" }, req.query);
  result.meta.current = await currentCancellationPolicy();
  res.json(result);
}
const time = (value, field) => {
  if (typeof value !== "string" || !/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) v.fail(`Enter ${field} as HH:mm.`, field);
  return value;
};
async function createCancellation(req, res) {
  v.keys(req.body, ["tiers", "checkInTime", "checkOutTime", "earlyCheckInFee", "lateCheckOutFee", "name"]);
  const { tiers } = req.body;
  if (!Array.isArray(tiers) || tiers.length < 1 || tiers.length > 10) v.fail("Add 1 to 10 cancellation tiers.", "tiers");
  const clean = tiers.map((t, i) => {
    v.keys(t, ["minHoursBeforeCheckIn", "refundPercent"]);
    return {
      minHoursBeforeCheckIn: v.number(t.minHoursBeforeCheckIn, `tiers[${i}].minHoursBeforeCheckIn`, 0, 8760),
      refundPercent: v.number(t.refundPercent, `tiers[${i}].refundPercent`, 0, 100),
    };
  });
  if (tiersProblem(clean))
    v.fail("Cancellation tiers must not overlap or leave gaps, each tier must refund 100% or 0%, and the refund must not increase as check-in gets closer.", "tiers"); // MSG-63
  clean.sort((a, b) => b.minHoursBeforeCheckIn - a.minHoursBeforeCheckIn);
  const policy = await version("cancellation", {
    name: req.body.name === undefined ? "Cancellation policy" : v.text(req.body.name, "name", 2, 100),
    cancellationTiers: clean,
    checkInTime: req.body.checkInTime === undefined ? DEFAULT_CHECK_IN : time(req.body.checkInTime, "checkInTime"),
    checkOutTime: req.body.checkOutTime === undefined ? "12:00" : time(req.body.checkOutTime, "checkOutTime"),
    earlyCheckInFee: req.body.earlyCheckInFee === undefined ? 0 : v.number(req.body.earlyCheckInFee, "earlyCheckInFee", 0, 1e9),
    lateCheckOutFee: req.body.lateCheckOutFee === undefined ? 0 : v.number(req.body.lateCheckOutFee, "lateCheckOutFee", 0, 1e9),
  }, req.user._id);
  res.status(201).json({ data: policy });
}

// Hotel & Room Information (public) and its edit in UC27.
async function hotelInfo(req, res) {
  res.json({ data: await HotelInfo.findOne({ key: "main" }).select("-key").lean() });
}
async function updateHotelInfo(req, res) {
  v.keys(req.body, ["name", "address", "phone", "email", "description"]);
  const opt = (field, max) => (req.body[field] === undefined ? undefined : v.text(req.body[field], field, 0, max));
  const fields = {
    name: v.text(req.body.name, "name", 2, 120),
    address: opt("address", 300),
    phone: req.body.phone === undefined ? undefined : v.phone(req.body.phone),
    email: req.body.email === undefined || req.body.email === "" ? undefined : v.email(req.body.email),
    description: opt("description", 2000),
  };
  const set = Object.fromEntries(Object.entries(fields).filter(([, x]) => x !== undefined));
  const info = await HotelInfo.findOneAndUpdate({ key: "main" }, { $set: set }, { new: true, upsert: true, runValidators: true }).select("-key");
  await audit(req.user._id, "hotel_info.updated", "hotel_info", info._id);
  res.json({ data: info });
}
module.exports = { listing, create, cancellationListing, createCancellation, hotelInfo, updateHotelInfo };
