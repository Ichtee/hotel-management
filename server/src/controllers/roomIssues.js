const Room = require("../models/Room");
const RoomIssue = require("../models/RoomIssue");
const Booking = require("../models/Booking");
const v = require("../utils/validation");
const { hotelTransaction } = require("../services/hotelOperations");
const { assertCapacity } = require("../services/roomInventory");
const { logChange } = require("../services/audit");
const { deliver } = require("../services/operationNotifications");

async function create(req, res) {
  v.keys(req.body, ["roomId", "title", "description", "severity"]);
  const input = { roomId: v.id(req.body.roomId, "roomId"), title: v.text(req.body.title, "title", 2, 120), description: v.text(req.body.description, "description", 0, 2000), severity: v.choice(req.body.severity, "severity", ["low", "medium", "high"]) };
  const result = await hotelTransaction(async (session) => {
    const room = await Room.findById(input.roomId).session(session);
    if (!room) throw new v.HttpError(404, "Room not found.");
    const [issue] = await RoomIssue.create([{ ...input, reportedBy: req.user._id }], { session });
    const events = [];
    let maintenanceApplied = false;
    if (input.severity === "high" && ["available", "cleaning"].includes(room.status)) {
      const before = room.toObject();
      // The capacity check detects an upcoming booking shortfall before this room is removed from sale.
      let shortfall = false;
      try { await assertCapacity(room.roomTypeId, room._id, session); } catch { shortfall = true; }
      room.status = "maintenance";
      await room.save({ session });
      maintenanceApplied = true;
      events.push({ roles: ["manager"], type: "room_maintenance", title: "Room moved to maintenance", message: `Room ${room.roomNumber}: ${input.title}.`, roomId: room._id });
      if (shortfall) events.push({ roles: ["manager", "receptionist"], type: "room_capacity_shortfall", title: "Upcoming room shortfall", message: `Room ${room.roomNumber} is now in maintenance and upcoming bookings may need reassignment.`, roomId: room._id });
      await logChange(req, "room.auto_maintenance", "Room", room._id, { before, after: room.toObject() }, session);
    }
    await logChange(req, "room_issue.reported", "RoomIssue", issue._id, { after: issue.toObject() }, session);
    return { issue, maintenanceApplied, events };
  });
  res.status(201).json({ data: { issue: result.issue, maintenanceApplied: result.maintenanceApplied }, meta: { notificationStored: await deliver(result.events) } });
}

async function listing(req, res) {
  v.keys(req.query, ["status", "page", "limit"]);
  const filter = {};
  if (req.query.status !== undefined) filter.status = v.choice(req.query.status, "status", ["open", "in_progress", "resolved"]);
  res.json(await v.list(RoomIssue, filter, req.query));
}

async function options(_req, res) {
  const data = await Room.find({ isActive: true }).select("roomNumber floor status").sort({ floor: 1, roomNumber: 1 }).lean();
  res.json({ data });
}

module.exports = { create, listing, options };
