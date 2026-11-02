const Booking = require("../models/Booking");
const Request = require("../models/CheckInOutRequest");
const { currentCancellationPolicy } = require("../services/policies");
const v = require("../utils/validation");

const parseTime = (value) => {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) v.fail("Enter a valid requested time.", "requestedTime");
  return new Date(value);
};
const bookingMoment = (date, time) => new Date(`${new Date(date).toISOString().slice(0, 10)}T${time}:00+07:00`);

async function create(req, res) {
  v.keys(req.body, ["type", "requestedTime", "note"]);
  const booking = await Booking.findOne({ _id: v.id(req.params.id), customerId: req.user._id });
  if (!booking) throw new v.HttpError(404, "Booking not found.");
  const type = v.choice(req.body.type, "type", ["check_in", "check_out"]);
  if ((type === "check_in" && booking.status !== "confirmed") || (type === "check_out" && booking.status !== "checked_in"))
    throw new v.HttpError(409, "This booking cannot accept that request in its current status.");
  if (await Request.exists({ bookingId: booking._id, type, status: { $in: ["pending", "approved"] } }))
    throw new v.HttpError(409, "There is already an open request of this type for this booking.");
  const requestedTime = parseTime(req.body.requestedTime);
  const policy = await currentCancellationPolicy();
  const standard = bookingMoment(type === "check_in" ? booking.checkInDate : booking.checkOutDate, type === "check_in" ? (policy?.checkInTime || "14:00") : (policy?.checkOutTime || "12:00"));
  const early = type === "check_in" && requestedTime < standard;
  const late = type === "check_out" && requestedTime > standard;
  const quotedFee = early ? (policy?.earlyCheckInFee || 0) : late ? (policy?.lateCheckOutFee || 0) : 0;
  const request = await Request.create({ bookingId: booking._id, customerId: req.user._id, type, requestedTime, note: v.text(req.body.note || "", "note", 0, 1000), quotedFee });
  res.status(201).json({ data: request });
}

async function listing(req, res) {
  v.keys(req.query, ["status", "page", "limit"]);
  const filter = {};
  if (req.query.status !== undefined) filter.status = v.choice(req.query.status, "status", ["pending", "approved", "rejected", "completed", "cancelled"]);
  const result = await v.list(Request, filter, req.query);
  result.data = await Request.populate(result.data, [{ path: "bookingId", select: "bookingReference guestName guestPhone checkInDate checkOutDate status" }, { path: "customerId", select: "customerProfile.fullName email phone" }]);
  res.json(result);
}

async function handle(req, res) {
  v.keys(req.body, ["action", "responseNote"]);
  const action = v.choice(req.body.action, "action", ["approve", "reject"]);
  const request = await Request.findById(v.id(req.params.id));
  if (!request) throw new v.HttpError(404, "Request not found.");
  if (request.status !== "pending") throw new v.HttpError(409, "This request has already been handled.");
  request.status = action === "approve" ? "approved" : "rejected";
  request.handledBy = req.user._id; request.handledAt = new Date(); request.responseNote = v.text(req.body.responseNote || "", "responseNote", 0, 1000);
  await request.save(); res.json({ data: request });
}

async function closeForBooking(bookingId, status = "completed") {
  await Request.updateMany({ bookingId, status: { $in: ["pending", "approved"] } }, { $set: { status } });
}
module.exports = { create, listing, handle, closeForBooking };
