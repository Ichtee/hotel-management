const Assignment = require("../models/HousekeepingAssignment");
const Room = require("../models/Room");
const User = require("../models/User");
const Role = require("../models/Role");
const Task = require("../models/CleaningTask");
const v = require("../utils/validation");
const fields = require("../utils/managerValidation");
const { currentShift, dayDate, covers, planEnd } = require("../utils/hotelTime");
const { hotelTransaction } = require("../services/hotelOperations");
const { matchesRoom, assertNoOverlap } = require("../services/housekeepingPlans");
const { reconcileTasks } = require("../services/housekeepingTasks");
const { deliver } = require("../services/operationNotifications");
const { logChange } = require("../services/audit");

// Kiểm tra kế hoạch theo ca và khoảng ngày, tính cả hai ngày đầu cuối.
function validate(body, creating = false) {
  fields.body(body, ["staffId", "shift", "roomIds", "floors", "effectiveFrom", "effectiveTo"]);
  const data = {};
  if (creating || body.staffId !== undefined) data.staffId = v.id(body.staffId, "staffId");
  if (creating || body.shift !== undefined) data.shift = v.choice(body.shift, "shift", ["morning", "afternoon", "night"]);
  for (const key of ["effectiveFrom", "effectiveTo"])
    if (creating || body[key] !== undefined) data[key] = dayDate(body[key], key);
  if (body.roomIds !== undefined) data.roomIds = fields.strings(body.roomIds, "roomIds", 500, 24).map((id) => v.id(id, "roomIds"));
  if (body.floors !== undefined) {
    if (!Array.isArray(body.floors) || body.floors.length > 100) v.fail("Invalid floor list.", "floors");
    data.floors = [...new Set(body.floors.map((f) => v.number(f, "floors", -100, 1000)))];
  }
  return data;
}

// Chỉ nhận nhân viên housekeeping đang hoạt động và phòng hoặc tầng hợp lệ.
async function validateTargets(plan, session) {
  const role = await Role.findOne({ key: "housekeeping", isActive: true }).session(session);
  if (!role || !await User.exists({ _id: plan.staffId, roleId: role._id, status: "active" }).session(session))
    v.fail("Select an active Housekeeping staff member.", "staffId");
  if (plan.roomIds.length && await Room.countDocuments({ _id: { $in: plan.roomIds }, isActive: true }).session(session) !== plan.roomIds.length)
    v.fail("Select active existing rooms.", "roomIds");
  const floors = await Room.find({ isActive: true, floor: { $in: plan.floors } }).distinct("floor").session(session);
  if (floors.length !== plan.floors.length) v.fail("Select floors containing active rooms.", "floors");
  await plan.validate();
}

// Tìm các phòng chịu tác động trong ca hiện tại của thay đổi kế hoạch.
async function affectedRooms(before, after, session, now) {
  const slot = currentShift(now);
  const relevant = [before, after].filter((p) => p && covers({ ...p, isActive: true }, slot.date, slot.shift));
  const rooms = await Room.find({ isActive: true }).select("floor").session(session).lean();
  const result = rooms.filter((r) => relevant.some((p) => matchesRoom(p, r))).map((r) => String(r._id));
  if (before) {
    const heldTasks = await Task.find({ assignmentId: before._id, status: { $in: ["assigned", "in_progress"] },
      $or: [{ scheduledDate: { $lte: now } }, { scheduledDate: null }] }).select("roomId").session(session).lean();
    result.push(...heldTasks.map((task) => String(task.roomId)));
  }
  return [...new Set(result)];
}

// Lưu kế hoạch, kiểm tra trùng và chuyển nhiệm vụ trong cùng giao dịch.
async function savePlan(req, creating) {
  const input = validate(req.body, creating);
  const id = creating ? undefined : v.id(req.params.id);
  const now = new Date();
  const result = await hotelTransaction(async (session) => {
    const plan = creating ? new Assignment({ ...input, assignedBy: req.user._id }) : await Assignment.findById(id).session(session);
    if (!plan) throw new v.HttpError(404, "Assignment not found.");
    if (!creating && !plan.isActive) throw new v.HttpError(409, "A revoked assignment cannot be edited.");
    const before = creating ? null : plan.toObject();
    if (!creating) Object.assign(plan, input);
    if (planEnd(plan) <= now) v.fail("The final shift must not have ended.", "effectiveTo");
    await validateTargets(plan, session);
    await plan.save({ session });
    await assertNoOverlap(session, now);
    const after = plan.toObject();
    const roomIds = await affectedRooms(before, after, session, now);
    const events = [{ accountIds: [plan.staffId, ...(before ? [before.staffId] : [])], type: "housekeeping_plan_changed",
      title: "Housekeeping plan updated", message: `Your ${plan.shift} responsibility plan has changed.` }];
    if (roomIds.length) await reconcileTasks(session, events, { now, roomIds, reassignAssigned: true });
    await logChange(req, creating ? "housekeeping_assignment.created" : "housekeeping_assignment.updated", "HousekeepingAssignment", plan._id, { before, after }, session);
    return { data: plan, events };
  });
  return { data: result.data, meta: { notificationStored: await deliver(result.events) } };
}

// Tạo kế hoạch phụ trách, không giao từng nhiệm vụ từ trang quản lý.
async function create(req, res) { res.status(201).json(await savePlan(req, true)); }

// Cập nhật kế hoạch và lưu phiên bản trước vào nhật ký.
async function update(req, res) { res.json(await savePlan(req, false)); }

// Hủy mềm kế hoạch, chuyển nhiệm vụ sang người mới hoặc về trạng thái chờ.
async function remove(req, res) {
  const id = v.id(req.params.id);
  v.keys(req.body, []);
  const now = new Date();
  const result = await hotelTransaction(async (session) => {
    const plan = await Assignment.findById(id).session(session);
    if (!plan) throw new v.HttpError(404, "Assignment not found.");
    if (!plan.isActive) return { data: plan, events: [] };
    const before = plan.toObject();
    plan.isActive = false;
    plan.revokedAt = now;
    plan.revokedBy = req.user._id;
    plan.revocationReason = "Manager revoked the responsibility plan.";
    await plan.save({ session });
    const events = [{ accountIds: [plan.staffId], type: "housekeeping_plan_changed", title: "Housekeeping plan revoked",
      message: `Your ${plan.shift} responsibility plan was revoked.` }];
    const roomIds = await affectedRooms(before, null, session, now);
    if (roomIds.length) await reconcileTasks(session, events, { now, roomIds, reassignAssigned: true });
    await logChange(req, "housekeeping_assignment.revoked", "HousekeepingAssignment", plan._id, { before, after: plan.toObject() }, session);
    return { data: plan, events };
  });
  res.json({ data: result.data, meta: { notificationStored: await deliver(result.events) } });
}

// Liệt kê lịch phân công và hỗ trợ lọc theo nhân viên, ca, ngày.
async function listing(req, res) {
  v.keys(req.query, ["staffId", "shift", "date", "isActive", "page", "limit"]);
  const filter = {};
  if (req.query.staffId !== undefined) filter.staffId = v.id(req.query.staffId, "staffId");
  if (req.query.shift !== undefined) filter.shift = v.choice(req.query.shift, "shift", ["morning", "afternoon", "night"]);
  if (req.query.isActive !== undefined) filter.isActive = v.choice(req.query.isActive, "isActive", ["true", "false"]) === "true";
  if (req.query.date !== undefined) {
    const date = dayDate(req.query.date);
    filter.effectiveFrom = { $lte: date };
    filter.effectiveTo = { $gte: date };
  }
  res.json(await v.list(Assignment, filter, req.query));
}

// Trả phòng theo tầng và nhân viên hợp lệ để lập kế hoạch.
async function options(req, res) {
  const role = await Role.findOne({ key: "housekeeping", isActive: true });
  const staff = role ? await User.find({ roleId: role._id, status: "active" }).select("customerProfile.fullName email").lean() : [];
  const rooms = await Room.find({ isActive: true }).select("roomNumber floor roomTypeId status").sort({ floor: 1, roomNumber: 1 }).lean();
  res.json({ data: { staff, rooms, floors: [...new Set(rooms.map((r) => r.floor).filter((f) => f !== undefined))],
    shifts: ["morning", "afternoon", "night"], timezone: "Asia/Ho_Chi_Minh" } });
}
module.exports = { create, update, remove, listing, options };
