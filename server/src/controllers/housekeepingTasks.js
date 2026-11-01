const Task = require("../models/CleaningTask");
const v = require("../utils/validation");
const { createCleaningTask, updateOwnTaskStatus } = require("../services/housekeepingTasks");

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

// UC37: a receptionist can request an ad-hoc cleaning task; assignment is resolved from the active plan.
async function createAdHoc(req, res) {
  v.keys(req.body, ["roomId", "requestContent"]);
  const result = await createCleaningTask({ ...req.body, type: "ad_hoc" });
  res.status(201).json(result);
}

module.exports = { mine, updateMine, createAdHoc };
