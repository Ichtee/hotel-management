const Task = require("../models/CleaningTask");
const Room = require("../models/Room");
const RoomIssue = require("../models/RoomIssue");
const v = require("../utils/validation");
const { hotelTransaction } = require("../services/hotelOperations");
const { logChange } = require("../services/audit");
const { deliver } = require("../services/operationNotifications");

async function list(req, res) {
  res.json({
    data: await Task.find({ assignedTo: req.user._id })
      .populate("roomId", "roomNumber status")
      .sort({ createdAt: -1 })
      .limit(100)
      .lean(),
  });
}

async function update(req, res) {
  v.keys(req.body, ["status", "result", "reason"]);
  const status = v.choice(req.body.status, "status", [
    "in_progress",
    "completed",
    "skipped",
  ]);
  const data = await hotelTransaction(async (session) => {
    const task = await Task.findOne({
      _id: v.id(req.params.id),
      assignedTo: req.user._id,
    }).session(session);
    if (!task) throw new v.HttpError(404, "Assigned task not found.");
    if (task.status === status) return task;
    if (status === "skipped") {
      if (
        !["routine", "ad_hoc"].includes(task.type) ||
        !["assigned", "in_progress"].includes(task.status)
      )
        throw new v.HttpError(409, "This task cannot be skipped.");
      task.skipReason = v.text(req.body.reason, "reason", 2, 500);
    } else if (
      (status === "in_progress" && task.status !== "assigned") ||
      (status === "completed" && task.status !== "in_progress")
    )
      throw new v.HttpError(
        409,
        "Follow the assigned, in progress, completed task sequence.",
      );
    if (status === "completed") {
      task.completedAt = new Date();
      if (task.type === "inspection")
        task.inspectionResult = v.text(req.body.result, "result", 2, 1000);
      if (task.type === "turnover") {
        const other = await Task.exists({
          _id: { $ne: task._id },
          roomId: task.roomId,
          type: "turnover",
          status: { $in: ["pending", "assigned", "in_progress"] },
        }).session(session);
        if (!other)
          await Room.updateOne(
            { _id: task.roomId, status: "cleaning" },
            { $set: { status: "available" } },
            { session },
          );
      }
    }
    if (status === "in_progress") task.startedAt = new Date();
    task.status = status;
    await task.save({ session });
    await logChange(
      req,
      "task.updated",
      "CleaningTask",
      task._id,
      { status, type: task.type },
      session,
    );
    return task;
  });
  const notificationStored =
    data.type === "inspection" && data.status === "completed"
      ? await deliver([
          {
            roles: ["receptionist"],
            type: "inspection_completed",
            title: "Inspection completed",
            message: "The inspection result is ready for check-out.",
            bookingId: data.bookingId,
            roomId: data.roomId,
          },
        ])
      : true;
  res.json({ data, meta: { notificationStored } });
}

async function recordRoomIssue(req, roomId, description, session) {
  const room = await Room.findById(roomId).session(session);
  if (!room) throw new v.HttpError(404, "Room not found.");
  const [issue] = await RoomIssue.create(
    [
      {
        roomId: room._id,
        reportedBy: req.user._id,
        title: "Room issue",
        description,
        status: "open",
      },
    ],
    { session },
  );
  if (["available", "cleaning"].includes(room.status)) {
    room.status = "maintenance";
    await room.save({ session });
  }
  await logChange(
    req,
    "room_issue.reported",
    "RoomIssue",
    issue._id,
    { roomId: room._id },
    session,
  );
  return issue;
}

async function reportIssue(req, res) {
  v.keys(req.body, ["roomId", "taskId", "description"]);
  const description = v.text(req.body.description, "description", 2, 1000);
  const result = await hotelTransaction(async (session) => {
    const room = await Room.findById(v.id(req.body.roomId, "roomId")).session(
      session,
    );
    if (!room) throw new v.HttpError(404, "Room not found.");
    if (
      req.role.key === "housekeeping" &&
      !(await Task.exists({
        _id: v.id(req.body.taskId, "taskId"),
        roomId: room._id,
        assignedTo: req.user._id,
      }).session(session))
    )
      throw new v.HttpError(403, "Report an issue from your assigned task.");
    return recordRoomIssue(req, room._id, description, session);
  });
  const notificationStored = await deliver([
    {
      roles: ["manager", "receptionist"],
      type: "room_issue",
      title: "Room issue reported",
      message: "Review room availability and upcoming arrivals.",
      roomId: result.roomId,
    },
  ]);
  res.status(201).json({ data: result, meta: { notificationStored } });
}

module.exports = { list, update, reportIssue, recordRoomIssue };
