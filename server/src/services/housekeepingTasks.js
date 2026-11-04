const Room = require("../models/Room");
const Booking = require("../models/Booking");
const Task = require("../models/CleaningTask");
const v = require("../utils/validation");
const { currentShift, dayDate } = require("../utils/hotelTime");
const { hotelDay } = require("./roomInventory");
const { currentCancellationPolicy } = require("./policies");
const { responsibleStaff } = require("./housekeepingPlans");
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

// Giao task Pending; chỉ chuyển Assigned khi Manager cập nhật phân công liên quan.
async function reconcileTasks(session, events, { now = new Date(), roomIds, reassignAssigned = false } = {}) {
  const filter = { status: { $in: reassignAssigned ? ["pending", "assigned"] : ["pending"] },
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
  const task = new Task({ ...input, priority: await taskPriority(room, input.type, session, now), scheduledDate: now });
  await assignTask(task, room, currentShift(now), session, events);
  return task;
}

// Điểm tích hợp cho module check-out, đổi phòng, kiểm tra và yêu cầu vệ sinh.
async function createCleaningTask(input, { now = new Date() } = {}) {
  v.keys(input, ["roomId", "bookingId", "type", "requestContent"]);
  const data = { roomId: v.id(String(input.roomId), "roomId"), type: v.choice(input.type, "type", ["turnover", "ad_hoc", "inspection"]) };
  if (input.bookingId !== undefined) data.bookingId = v.id(String(input.bookingId), "bookingId");
  if (input.requestContent !== undefined) data.requestContent = v.text(input.requestContent, "requestContent", 1, 1000);
  const result = await hotelTransaction(async (session) => {
    const events = [];
    if (data.bookingId && !await Booking.exists({ _id: data.bookingId, "rooms.roomId": data.roomId }).session(session))
      throw new v.HttpError(409, "The booking is not linked to this room.");
    const task = await createTaskInSession(data, session, events, now);
    return { task, events };
  });
  return { data: result.task, notificationStored: await deliver(result.events) };
}

// UC30: only the Housekeeping employee assigned to a task can progress it.
// A room becomes Available only after its Turnover task is actually completed.
async function updateOwnTaskStatus(taskId, actorId, input, { now = new Date() } = {}) {
  v.keys(input, ["status"]);
  const status = v.choice(input.status, "status", ["in_progress", "completed", "skipped"]);
  const result = await hotelTransaction(async (session) => {
    const task = await Task.findById(taskId).session(session);
    if (!task) throw new v.HttpError(404, "Cleaning task not found.");
    if (!task.assignedTo || String(task.assignedTo) !== String(actorId))
      throw new v.HttpError(403, "You can only update cleaning tasks assigned to you.");
    if (["completed", "skipped"].includes(task.status))
      throw new v.HttpError(409, "This cleaning task is already closed.");
    if (status === "completed" && task.status !== "in_progress")
      throw new v.HttpError(409, "Start the cleaning task before completing it.");

    task.status = status;
    if (status === "completed") task.completedAt = now;
    await task.save({ session });

    if (task.type === "turnover" && status === "completed")
      await Room.updateOne({ _id: task.roomId, status: "cleaning" }, { $set: { status: "available" } }, { session });

    return task.populate([{ path: "roomId", select: "roomNumber floor status" }, { path: "assignedTo", select: "username customerProfile.fullName" }]);
  });
  return { data: result };
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
  if (now < opensAt || now >= checkOutAt) return 0;
  const start = dayDate(today), end = new Date(start.getTime() + 86400000);
  const bookings = await Booking.find({ status: "checked_in", checkOutDate: { $gte: start, $lt: end } }).select("_id rooms").session(session);
  let created = 0;
  for (const booking of bookings) for (const line of booking.rooms) {
    if (!line.roomId) continue;
    const inspectionKey = `${booking.id}:${line.roomId}`;
    if (await Task.exists({ inspectionKey }).session(session)) continue;
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
