const Task = require("../models/CleaningTask");
const Room = require("../models/Room");
const User = require("../models/User");
const v = require("../utils/validation");
const { createCleaningTask, updateOwnTaskStatus } = require("../services/housekeepingTasks");
const { onDutyStaff } = require("../services/housekeepingPlans");
const { currentShift } = require("../utils/hotelTime");

// UC30: the Housekeeping dashboard deliberately exposes only the current user's tasks.
async function mine(req, res) {
  v.keys(req.query, ["status"]);
  const filter = { assignedTo: req.user._id };
  if (req.query.status !== undefined)
    filter.status = v.choice(req.query.status, "status", ["assigned", "in_progress", "completed", "skipped"]);
  const data = await Task.find(filter)
    .populate("roomId", "roomNumber floor status")
    .sort({ scheduledDate: 1, priority: -1, createdAt: 1 })
    .lean();
  res.json({ data });
}

async function updateMine(req, res) {
  res.json(await updateOwnTaskStatus(v.id(req.params.id), req.user._id, req.body));
}

// UC37: the Receptionist pushes a guest's cleaning request; it goes to the staff member responsible for the room (BR-41).
async function createAdHoc(req, res) {
  v.keys(req.body, ["roomId", "requestContent", "priority", "preferredTime", "assignTo"]);
  const b = req.body;
  if (typeof b.requestContent !== "string" || !b.requestContent.trim()) v.fail("Request content is required.", "requestContent"); // MSG-04
  let preferredTime;
  if (b.preferredTime) {
    if (!Number.isFinite(Date.parse(b.preferredTime))) v.fail("Preferred time is invalid.", "preferredTime");
    preferredTime = new Date(b.preferredTime);
  }
  const result = await createCleaningTask({
    roomId: b.roomId, type: "ad_hoc", requestContent: b.requestContent, priority: b.priority || "normal", requestedBy: req.user._id,
    ...(preferredTime ? { preferredTime } : {}), ...(b.assignTo ? { assignTo: v.id(b.assignTo, "assignTo") } : {}),
  });
  res.status(201).json({ ...result, message: "Saved successfully." }); // MSG-01
}

// Rooms that can get an ad-hoc request and the staff on duty now (for UC37 4a).
async function adHocOptions(_req, res) {
  const [data, onDuty] = await Promise.all([
    Room.find({ isActive: true, status: { $in: ["available", "occupied", "cleaning"] } }).select("roomNumber floor status").sort({ floor: 1, roomNumber: 1 }).lean(),
    onDutyStaff(currentShift(new Date()), null),
  ]);
  const staff = await User.find({ _id: { $in: onDuty } }).select("customerProfile.fullName username").lean();
  res.json({ data, meta: { onDuty: staff.map((s) => ({ _id: s._id, name: s.customerProfile?.fullName || s.username })) } });
}

module.exports = { mine, updateMine, createAdHoc, adHocOptions };
