const Booking = require("../models/Booking");
const Penalty = require("../models/Penalty");
const CompensationItem = require("../models/CompensationItem");
const v = require("../utils/validation");
const { charge } = require("../services/penalties");
const { audit } = require("../services/audit");
// Penalties are recorded during the stay or after check-out (BR-43).
async function billable(id) {
  const booking = await Booking.findById(id).select("status rooms.roomId");
  if (!booking) throw new v.HttpError(404, "Booking not found.");
  if (!["checked_in", "checked_out"].includes(booking.status)) throw new v.HttpError(409, "Penalties can only be recorded for a checked-in or checked-out booking.");
  return booking;
}
async function listing(req, res) {
  const id = v.id(req.params.id);
  if (!(await Booking.exists({ _id: id }))) throw new v.HttpError(404, "Booking not found.");
  res.json({ data: await Penalty.find({ bookingId: id }).populate("roomId", "roomNumber").sort({ createdAt: 1 }).lean() });
}
// ponytail: sample prices, seeded on first use; replace them in the database or with the UC34 editor.
const DEFAULT_ITEMS = [["Bath towel", 150000], ["Bathrobe", 400000], ["Slippers", 50000], ["Key card", 100000], ["TV remote", 300000], ["Drinking glass", 80000], ["Hair dryer", 500000], ["Bed linen", 600000]];
async function items(req, res) {
  if (!(await CompensationItem.exists({}))) await CompensationItem.insertMany(DEFAULT_ITEMS.map(([name, price]) => ({ name, price }))).catch(() => {});
  res.json({ data: await CompensationItem.find({ isActive: true }).sort({ name: 1 }).lean() });
}
// UC38: the Receptionist records a damage / loss item directly; it is confirmed at once and added to the bill.
async function record(req, res) {
  v.keys(req.body, ["itemName", "amount", "description"]);
  const booking = await billable(v.id(req.params.id));
  const amount = v.number(req.body.amount, "amount", 1, 1e9);
  const now = new Date();
  const penalty = await Penalty.create({
    bookingId: booking._id, roomId: booking.rooms[0]?.roomId, itemName: v.text(req.body.itemName, "itemName", 1, 120),
    description: req.body.description ? v.text(req.body.description, "description", 1, 500) : undefined,
    proposedAmount: amount, amount, status: "confirmed", afterCheckout: booking.status === "checked_out",
    reportedBy: req.user._id, confirmedBy: req.user._id, confirmedAt: now,
  });
  await charge(booking._id, amount);
  await audit(req.user._id, "penalty.confirmed", "penalty", penalty._id, { bookingId: booking._id, amount });
  res.status(201).json({ data: penalty });
}
// UC38: confirm (optionally reduced) or waive a penalty proposed by Housekeeping (UC31).
async function review(req, res) {
  v.keys(req.body, ["action", "amount", "reason"]);
  const action = v.choice(req.body.action, "action", ["confirm", "waive"]);
  const proposed = await Penalty.findById(v.id(req.params.id));
  if (!proposed) throw new v.HttpError(404, "Penalty not found.");
  const booking = await billable(proposed.bookingId);
  const now = new Date();
  const update = action === "confirm"
    ? { status: "confirmed", amount: req.body.amount === undefined ? proposed.proposedAmount : v.number(req.body.amount, "amount", 1, proposed.proposedAmount), afterCheckout: booking.status === "checked_out", confirmedBy: req.user._id, confirmedAt: now }
    : { status: "waived", waivedReason: v.text(req.body.reason, "reason", 1, 300), waivedAt: now, confirmedBy: req.user._id };
  // Only one decision per proposal, even with two Receptionists clicking at once. BR-43: a Confirmed (unpaid) line can still be waived.
  const before = await Penalty.findOneAndUpdate({ _id: proposed._id, status: action === "confirm" ? "proposed" : { $in: ["proposed", "confirmed"] } }, update);
  if (!before) throw new v.HttpError(409, "This penalty has already been decided.");
  const penalty = await Penalty.findById(before._id);
  if (action === "confirm") await charge(booking._id, penalty.amount);
  else if (before.status === "confirmed") await charge(booking._id, -before.amount);
  await audit(req.user._id, `penalty.${action === "confirm" ? "confirmed" : "waived"}`, "penalty", penalty._id, { bookingId: booking._id, proposedAmount: penalty.proposedAmount, amount: penalty.amount, reason: penalty.waivedReason });
  res.json({ data: penalty });
}
module.exports = { items, listing, record, review };
