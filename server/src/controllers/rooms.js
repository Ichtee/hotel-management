const Room = require("../models/Room");
const RoomType = require("../models/RoomType");
const RoomIssue = require("../models/RoomIssue");
const CleaningTask = require("../models/CleaningTask");
const Booking = require("../models/Booking");
const v = require("../utils/validation");
const fields = require("../utils/managerValidation");
const { hotelTransaction } = require("../services/hotelOperations");
const { assertCapacity, holdingFilter } = require("../services/roomInventory");
const { logChange } = require("../services/audit");
const { assertNoOverlap, roomPlanEvents } = require("../services/housekeepingPlans");
const { reconcileTasks } = require("../services/housekeepingTasks");
const { deliver } = require("../services/operationNotifications");

// Kiểm tra thông tin phòng; trạng thái vận hành có API riêng.
function validate(body, creating = false) {
  fields.body(body, ["roomNumber", "roomTypeId", "floor", "viewType", "description", "images", "isActive"]);
  const input = {};
  if (creating || body.roomNumber !== undefined) input.roomNumber = v.text(body.roomNumber, "roomNumber", 1, 30);
  if (creating || body.roomTypeId !== undefined) input.roomTypeId = v.id(body.roomTypeId, "roomTypeId");
  if (body.floor !== undefined) input.floor = v.number(body.floor, "floor", -100, 1000);
  for (const key of ["viewType", "description"])
    if (body[key] !== undefined) input[key] = v.text(body[key], key, 0, key === "description" ? 5000 : 100);
  if (body.images !== undefined) input.images = fields.images(body.images);
  if (body.isActive !== undefined) input.isActive = v.boolean(body.isActive, "isActive");
  return input;
}

// Lấy phòng trong giao dịch hoặc báo không tìm thấy.
async function findRoom(id, session) {
  const room = await Room.findById(id).session(session);
  if (!room) throw new v.HttpError(404, "Room not found.");
  return room;
}

// Liệt kê phòng theo loại, tầng và trạng thái với phân trang.
async function listing(req, res) {
  v.keys(req.query, ["q", "page", "limit", "roomTypeId", "floor", "status", "isActive"]);
  const filter = { roomNumber: v.search(req.query) };
  if (req.query.roomTypeId !== undefined) filter.roomTypeId = v.id(req.query.roomTypeId, "roomTypeId");
  if (req.query.status !== undefined) filter.status = v.choice(req.query.status, "status", Room.schema.path("status").enumValues);
  if (req.query.isActive !== undefined) filter.isActive = v.choice(req.query.isActive, "isActive", ["true", "false"]) === "true";
  if (req.query.floor !== undefined) {
    if (typeof req.query.floor !== "string" || !/^-?\d+$/.test(req.query.floor)) v.fail("Invalid floor.", "floor");
    filter.floor = v.number(Number(req.query.floor), "floor", -100, 1000);
  }
  res.json(await v.list(Room, filter, req.query));
}

// Trả chi tiết phòng và số sự cố chưa giải quyết.
async function detail(req, res) {
  const id = v.id(req.params.id);
  const room = await Room.findById(id).populate("roomTypeId", "name isActive").lean();
  if (!room) throw new v.HttpError(404, "Room not found.");
  room.unresolvedIssues = await RoomIssue.countDocuments({ roomId: id, status: { $ne: "resolved" } });
  res.json({ data: room });
}

// Tạo phòng trống thuộc loại phòng đang hoạt động.
async function create(req, res) {
  const input = validate(req.body, true);
  const result = await hotelTransaction(async (session) => {
    if (!await RoomType.exists({ _id: input.roomTypeId, isActive: true }).session(session))
      v.fail("Choose an active room type.", "roomTypeId");
    const [room] = await Room.create([{ ...input, status: "available" }], { session });
    await assertNoOverlap(session);
    const events = [];
    await roomPlanEvents(null, room, session, events);
    await logChange(req, "room.created", "Room", room._id, { after: room.toObject() }, session);
    return { data: room, events };
  });
  res.status(201).json({ data: result.data, meta: { notificationStored: await deliver(result.events) } });
}

// Kiểm tra sức chứa khi đổi loại hoặc vô hiệu hóa phòng, đồng thời cập nhật phạm vi tầng.
async function update(req, res) {
  const input = validate(req.body);
  const id = v.id(req.params.id);
  const now = new Date();
  const result = await hotelTransaction(async (session) => {
    const room = await findRoom(id, session);
    const before = room.toObject();
    const typeChanged = input.roomTypeId !== undefined && String(room.roomTypeId) !== input.roomTypeId;
    const deactivating = input.isActive === false && room.isActive;
    if (typeChanged || deactivating) {
      if (!["available", "maintenance"].includes(room.status))
        throw new v.HttpError(409, "Only Available or Maintenance rooms can change type or be deactivated.");
      await assertCapacity(room.roomTypeId, room._id, session, now);
    }
    if (typeChanged) {
      if (!await RoomType.exists({ _id: input.roomTypeId, isActive: true }).session(session))
        v.fail("Choose an active room type.", "roomTypeId");
      if (await Booking.exists({ ...holdingFilter(now), "rooms.roomId": room._id }).session(session))
        throw new v.HttpError(409, "A holding booking still references this physical room.");
    }
    Object.assign(room, input);
    await room.save({ session });
    await assertNoOverlap(session, now);
    const events = [];
    if (before.floor !== room.floor || before.isActive !== room.isActive) {
      await roomPlanEvents(before, room, session, events, now);
      await reconcileTasks(session, events, { now, roomIds: [room._id], reassignAssigned: true });
    }
    await logChange(req, "room.updated", "Room", room._id, { before, after: room.toObject() }, session);
    return { data: room, events };
  });
  res.json({ data: result.data, meta: { notificationStored: await deliver(result.events) } });
}

// Bật bảo trì sau kiểm tra sức chứa hoặc gỡ bảo trì khi không còn sự cố mở.
async function maintenance(req, res) {
  v.keys(req.body, ["enabled"]);
  const enabled = v.boolean(req.body.enabled, "enabled");
  const id = v.id(req.params.id);
  const data = await hotelTransaction(async (session) => {
    const room = await findRoom(id, session);
    const before = room.toObject();
    if (enabled) {
      if (room.status !== "available") throw new v.HttpError(409, "Only an Available room can enter manual Maintenance.");
      if (room.isActive) await assertCapacity(room.roomTypeId, room._id, session);
      room.status = "maintenance";
    } else {
      if (room.status !== "maintenance") throw new v.HttpError(409, "The room is not in Maintenance.");
      if (await RoomIssue.exists({ roomId: id, status: { $ne: "resolved" } }).session(session))
        throw new v.HttpError(409, "Resolve all reported issues before clearing Maintenance.");
      const openTask = await CleaningTask.exists({ roomId: id, status: { $in: ["pending", "assigned", "in_progress"] } }).session(session);
      room.status = openTask ? "cleaning" : "available";
    }
    await room.save({ session });
    await logChange(req, "room.maintenance_changed", "Room", room._id, { before, after: room.toObject() }, session);
    return room;
  });
  res.json({ data });
}

// Liệt kê sự cố của phòng để quản lý xem và xử lý.
async function issues(req, res) {
  const id = v.id(req.params.id);
  v.keys(req.query, ["status", "page", "limit"]);
  if (!await Room.exists({ _id: id })) throw new v.HttpError(404, "Room not found.");
  const filter = { roomId: id };
  if (req.query.status !== undefined) filter.status = v.choice(req.query.status, "status", RoomIssue.schema.path("status").enumValues);
  res.json(await v.list(RoomIssue, filter, req.query));
}

// Đóng sự cố; quản lý gỡ bảo trì riêng khi đã xử lý hết.
async function resolveIssue(req, res) {
  v.keys(req.body, []);
  const id = v.id(req.params.id);
  const data = await hotelTransaction(async (session) => {
    const issue = await RoomIssue.findById(id).session(session);
    if (!issue) throw new v.HttpError(404, "Room issue not found.");
    if (issue.status === "resolved") return issue;
    await findRoom(issue.roomId, session);
    const before = issue.toObject();
    issue.status = "resolved";
    issue.resolvedBy = req.user._id;
    issue.resolvedAt = new Date();
    await issue.save({ session });
    await logChange(req, "room_issue.resolved", "RoomIssue", issue._id, { before, after: issue.toObject() }, session);
    return issue;
  });
  res.json({ data });
}

module.exports = { listing, detail, create, update, maintenance, issues, resolveIssue };
