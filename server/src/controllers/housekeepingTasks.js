const Task = require("../models/CleaningTask");
const Room = require("../models/Room");
const User = require("../models/User");
const v = require("../utils/validation");
const { createCleaningTask, updateOwnTaskStatus } = require("../services/housekeepingTasks");
const { onDutyStaff } = require("../services/housekeepingPlans");
const { currentShift } = require("../utils/hotelTime");

// Chỉ trả nhiệm vụ housekeeping của người đang đăng nhập.
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

// Lễ tân tạo yêu cầu dọn và giao cho người phụ trách phòng trong ca.
async function createAdHoc(req, res) {
  v.keys(req.body, ["roomId", "requestContent", "priority", "preferredTime", "assignTo"]);
  const b = req.body;
  if (typeof b.requestContent !== "string" || !b.requestContent.trim()) v.fail("Request content is required.", "requestContent");
  let preferredTime;
  if (b.preferredTime) {
    // CR-04: a full ISO timestamp with its offset (the form sends hotel time, +07:00); loose strings such as "tomorrow 9" are refused.
    if (typeof b.preferredTime !== "string" || !/^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):[0-5]\d(:[0-5]\d(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/.test(b.preferredTime))
      v.fail("Preferred time is invalid.", "preferredTime");
    v.date(b.preferredTime.slice(0, 10), "preferredTime"); // no 30 February
    preferredTime = new Date(b.preferredTime);
  }
  const result = await createCleaningTask({
    roomId: b.roomId, type: "ad_hoc", requestContent: b.requestContent, priority: b.priority || "normal", requestedBy: req.user._id,
    ...(preferredTime ? { preferredTime } : {}), ...(b.assignTo ? { assignTo: v.id(b.assignTo, "assignTo") } : {}),
  });
  res.status(201).json({ ...result, message: "Saved successfully." });
}

// Lấy phòng có thể yêu cầu dọn và nhân viên đang trực.
async function adHocOptions(_req, res) {
  const [data, onDuty] = await Promise.all([
    Room.find({ isActive: true, status: { $in: ["available", "occupied", "cleaning"] } }).select("roomNumber floor status").sort({ floor: 1, roomNumber: 1 }).lean(),
    onDutyStaff(currentShift(new Date()), null),
  ]);
  const staff = await User.find({ _id: { $in: onDuty } }).select("customerProfile.fullName username").lean();
  res.json({ data, meta: { onDuty: staff.map((s) => ({ _id: s._id, name: s.customerProfile?.fullName || s.username })) } });
}

module.exports = { mine, updateMine, createAdHoc, adHocOptions };
