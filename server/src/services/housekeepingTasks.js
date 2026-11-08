const Room = require("../models/Room");
const Booking = require("../models/Booking");
const Task = require("../models/CleaningTask");
const CheckInOutRequest = require("../models/CheckInOutRequest");
const v = require("../utils/validation");
const { currentShift, dayDate } = require("../utils/hotelTime");
const { hotelDay } = require("./roomInventory");
const { currentCancellationPolicy } = require("./policies");
const { responsibleStaff, onDutyStaff } = require("./housekeepingPlans");
const { hotelTransaction } = require("./hotelOperations");
const { deliver } = require("./operationNotifications");
const checklist = ["Change bed linen and pillowcases", "Replace towels", "Refill amenities", "Empty bins", "Clean bathroom", "Vacuum"];

// Áp dụng người phụ trách theo ca, ghi sự kiện để gửi sau commit.
async function assignTask(task, room, slot, session, events) {
  const person = await responsibleStaff(room, slot.date, slot.shift, session);
  const previous = task.assignedTo ? String(task.assignedTo) : null;
  const next = person ? String(person.staffId) : null;
  task.assignmentDate = slot.date;
  task.assignmentShift = slot.shift;
  task.assignmentId = person?.assignmentId;
  task.assignedTo = person?.staffId;
  task.assignedBy = undefined;
  task.status = person ? "assigned" : "pending";
  if (person) {
    task.unassignedNotifiedKey = undefined;
    if (previous !== next) events.push({ accountIds: [person.staffId], type: "task_assigned", title: "Cleaning task assigned",
      message: `Room ${room.roomNumber}: ${task.type}.`, roomId: room._id });
  } else {
    const key = `${slot.date}:${slot.shift}`;
    if (task.unassignedNotifiedKey !== key) {
      events.push({ roles: ["manager"], type: "task_without_responsible_staff", title: "Housekeeping assignment needed",
        message: `Room ${room.roomNumber} has a Pending task without responsible staff.`, roomId: room._id });
      task.unassignedNotifiedKey = key;
    }
  }
  await task.save({ session });
}

// Giao task Pending; khi Manager đổi kế hoạch, task đang mở (Assigned, In Progress) về Pending và được giao lại (BR-41).
async function reconcileTasks(session, events, { now = new Date(), roomIds, reassignAssigned = false } = {}) {
  const filter = { status: { $in: reassignAssigned ? ["pending", "assigned", "in_progress"] : ["pending"] },
    $or: [{ scheduledDate: { $lte: now } }, { scheduledDate: null }] };
  if (roomIds) filter.roomId = { $in: roomIds };
  const tasks = await Task.find(filter).session(session);
  const slot = currentShift(now);
  for (const task of tasks) {
    const room = await Room.findById(task.roomId).session(session);
    if (room) await assignTask(task, room, slot, session, events);
  }
}

// Ưu tiên kiểm tra phòng và phòng sắp đón khách mà không còn phòng trống khác.
async function taskPriority(room, type, session, now) {
  if (type === "inspection") return "urgent";
  const today = dayDate(hotelDay(now));
  const tomorrow = new Date(today.getTime() + 86400000);
  const arrival = await Booking.exists({ status: "confirmed", "rooms.roomTypeId": room.roomTypeId,
    checkInDate: { $gte: today, $lt: tomorrow } }).session(session);
  const available = await Room.exists({ _id: { $ne: room._id }, roomTypeId: room.roomTypeId, isActive: true, status: "available" }).session(session);
  return arrival && !available ? "urgent" : "normal";
}

// Tạo task trong giao dịch hiện tại và tự chọn người theo kế hoạch.
async function createTaskInSession(input, session, events, now) {
  const room = await Room.findById(input.roomId).session(session);
  if (!room || !room.isActive) throw new v.HttpError(409, "An active room is required for a cleaning task.");
  // BR-41: an Ad-hoc request marked Urgent by the Receptionist is urgent; otherwise the rule of taskPriority applies.
  const priority = input.priority === "urgent" ? "urgent" : await taskPriority(room, input.type, session, now);
  const task = new Task({ ...input, priority, scheduledDate: now });
  await assignTask(task, room, currentShift(now), session, events);
  return task;
}

// Điểm tích hợp cho module check-out, đổi phòng, kiểm tra và yêu cầu vệ sinh.
async function createCleaningTask(input, { now = new Date() } = {}) {
  v.keys(input, ["roomId", "bookingId", "type", "requestContent", "priority", "preferredTime", "requestedBy", "assignTo", "inspectionKey"]);
  const data = { roomId: v.id(String(input.roomId), "roomId"), type: v.choice(input.type, "type", ["turnover", "ad_hoc", "inspection"]) };
  if (input.bookingId !== undefined) data.bookingId = v.id(String(input.bookingId), "bookingId");
  if (input.requestContent !== undefined) data.requestContent = v.text(input.requestContent, "requestContent", 1, 1000);
  if (input.priority !== undefined) data.priority = v.choice(input.priority, "priority", ["normal", "urgent"]);
  if (input.preferredTime !== undefined) data.preferredTime = input.preferredTime;
  if (input.requestedBy !== undefined) data.requestedBy = input.requestedBy;
  if (input.inspectionKey !== undefined) data.inspectionKey = String(input.inspectionKey); // unique: one inspection per stay and room
  const result = await hotelTransaction(async (session) => {
    const events = [];
    if (data.bookingId && !await Booking.exists({ _id: data.bookingId, "rooms.roomId": data.roomId }).session(session))
      throw new v.HttpError(409, "The booking is not linked to this room.");
    const task = await createTaskInSession(data, session, events, now);
    // UC37 4a / BR-41: only when nobody is responsible for the room may the Receptionist pick a staff member on duty in this shift.
    if (task.status === "pending" && input.assignTo) {
      const slot = currentShift(now);
      if (!(await onDutyStaff(slot, session)).some((id) => String(id) === String(input.assignTo)))
        v.fail("Select a Housekeeping Staff member on duty in the current shift.", "assignTo");
      Object.assign(task, { assignedTo: input.assignTo, assignedBy: data.requestedBy, status: "assigned", assignmentDate: slot.date, assignmentShift: slot.shift });
      await task.save({ session });
      events.push({ accountIds: [input.assignTo], type: "task_assigned", title: "Cleaning task assigned", message: `Ad-hoc request: ${task.requestContent || "cleaning"}.`, roomId: task.roomId });
    }
    return { task, events };
  });
  return { data: result.task, notificationStored: await deliver(result.events) };
}

// UC30: only the Housekeeping employee assigned to a task can progress it.
// A room becomes Available only after its Turnover task is actually completed.
const INVALID_CHANGE = "Invalid status change. A task must follow Assigned, In Progress, Completed (or Skipped)."; // MSG-49
async function updateOwnTaskStatus(taskId, actorId, input, { now = new Date() } = {}) {
  v.keys(input, ["status", "reason"]);
  const status = v.choice(input.status, "status", ["in_progress", "completed", "skipped"]);
  const result = await hotelTransaction(async (session) => {
    const task = await Task.findById(taskId).session(session);
    if (!task) throw new v.HttpError(404, "Cleaning task not found.");
    if (!task.assignedTo || String(task.assignedTo) !== String(actorId))
      throw new v.HttpError(403, "You can only update cleaning tasks assigned to you.");
    // BR-22: Assigned -> In Progress -> Completed; only a Routine or Ad-hoc task can be Skipped (with a reason).
    if (["completed", "skipped"].includes(task.status)) throw new v.HttpError(409, INVALID_CHANGE);
    if (status === "in_progress" && task.status !== "assigned") throw new v.HttpError(409, INVALID_CHANGE);
    if (status === "completed" && task.status !== "in_progress") throw new v.HttpError(409, INVALID_CHANGE);
    if (status === "skipped") {
      if (!["routine", "ad_hoc"].includes(task.type)) throw new v.HttpError(409, "Only a routine or ad-hoc task can be skipped.");
      task.skipReason = v.text(input.reason, "reason", 2, 500); // guest declined, Do not disturb...
    }

    task.status = status;
    if (status === "completed") task.completedAt = now;
    await task.save({ session });

    if (task.type === "turnover" && status === "completed")
      await Room.updateOne({ _id: task.roomId, status: "cleaning" }, { $set: { status: "available" } }, { session });

    return task.populate([{ path: "roomId", select: "roomNumber floor status" }, { path: "assignedTo", select: "username customerProfile.fullName" }]);
  });
  // BR-28: the Receptionist hears when an ad-hoc task is completed or skipped and when an inspection result is in.
  const room = result.roomId?.roomNumber;
  const events = [];
  if (result.type === "ad_hoc" && ["completed", "skipped"].includes(status))
    events.push({ roles: ["receptionist"], type: "ad_hoc_task_closed", title: `Ad-hoc task ${status}`, message: `Room ${room}: ${result.requestContent || "ad-hoc request"} - ${status}${result.skipReason ? ` (${result.skipReason})` : ""}.`, roomId: result.roomId?._id });
  if (result.type === "inspection" && status === "completed")
    events.push({ roles: ["receptionist"], type: "inspection_result", title: "Room inspection completed", message: `Room ${room} was inspected; reported damage, if any, is waiting on the booking's penalties.`, roomId: result.roomId?._id });
  return { data: result, notificationStored: await deliver(events) };
}

// Mỗi ngày tạo tối đa một Routine cho phòng Occupied, trừ phòng trả trong ngày.
async function createRoutineTasks(session, events, now) {
  const date = hotelDay(now);
  const today = dayDate(date), tomorrow = new Date(today.getTime() + 86400000);
  const rooms = await Room.find({ status: "occupied", isActive: true }).session(session);
  let created = 0;
  for (const room of rooms) {
    const routineKey = `${date}:${room.id}`;
    if (await Task.exists({ routineKey }).session(session)) continue;
    const checkout = await Booking.exists({ status: "checked_in", "rooms.roomId": room._id,
      checkOutDate: { $gte: today, $lt: tomorrow } }).session(session);
    if (checkout) continue;
    await createTaskInSession({ roomId: room._id, type: "routine", routineKey,
      checklist: checklist.map((label) => ({ label, completed: false })) }, session, events, now);
    created++;
  }
  return created;
}

// T18: create one urgent inspection per occupied room in the 30-minute checkout window.
async function createInspectionTasks(session, events, now) {
  const policy = await currentCancellationPolicy(now).session(session);
  const checkOutTime = policy?.checkOutTime || "12:00";
  const today = hotelDay(now);
  const [hour, minute] = checkOutTime.split(":").map(Number);
  const checkOutAt = new Date(`${today}T00:00:00+07:00`);
  checkOutAt.setTime(checkOutAt.getTime() + (hour * 60 + minute) * 60000);
  const opensAt = new Date(checkOutAt.getTime() - 30 * 60000);
  const inWindow = now >= opensAt && now < checkOutAt;
  // T18 / UC39: an approved check-out request moves the inspection to 30 minutes before the requested time.
  const soon = await CheckInOutRequest.find({ type: "check_out", status: "approved", requestedTime: { $gt: now, $lte: new Date(now.getTime() + 30 * 60000) } })
    .select("bookingId").session(session);
  if (!inWindow && !soon.length) return 0;
  const start = dayDate(today), end = new Date(start.getTime() + 86400000);
  const bookings = await Booking.find({ status: "checked_in", $or: [
    ...(inWindow ? [{ checkOutDate: { $gte: start, $lt: end } }] : []),
    { _id: { $in: soon.map((r) => r.bookingId) } },
  ] }).select("_id rooms").session(session);
  // A stay with an approved later check-out is inspected at its own time, not at the hotel's check-out time.
  const later = new Set((await CheckInOutRequest.find({ type: "check_out", status: "approved", bookingId: { $in: bookings.map((b) => b._id) }, requestedTime: { $gt: new Date(now.getTime() + 30 * 60000) } })
    .select("bookingId").session(session)).map((r) => String(r.bookingId)));
  let created = 0;
  for (const booking of bookings) for (const line of booking.rooms) {
    if (later.has(String(booking._id))) continue;
    if (!line.roomId) continue;
    const inspectionKey = `${booking.id}:${line.roomId}`;
    // One inspection per stay: the Receptionist may already have requested it at check-out (UC20 step 2).
    if (await Task.exists({ $or: [{ inspectionKey }, { bookingId: booking._id, type: "inspection" }] }).session(session)) continue;
    await createTaskInSession({ roomId: line.roomId, bookingId: booking._id, type: "inspection", inspectionKey,
      requestContent: "Inspect room before scheduled checkout." }, session, events, now);
    created++;
  }
  return created;
}

// Runs housekeeping schedules and assigns Pending tasks without moving active work between shifts.
async function runHousekeepingTick(now = new Date()) {
  const local = new Date(now.getTime() + 7 * 3600000);
  const result = await hotelTransaction(async (session) => {
    const events = [];
    const routineCreated = local.getUTCHours() === 7 && local.getUTCMinutes() === 0
      ? await createRoutineTasks(session, events, now) : 0;
    const inspectionCreated = await createInspectionTasks(session, events, now);
    await reconcileTasks(session, events, { now });
    return { created: routineCreated + inspectionCreated, routineCreated, inspectionCreated, events };
  });
  return { created: result.created, notificationStored: await deliver(result.events) };
}
module.exports = { reconcileTasks, createCleaningTask, updateOwnTaskStatus, runHousekeepingTick };
