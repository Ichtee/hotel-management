const Room = require("../models/Room");
const User = require("../models/User");
const Role = require("../models/Role");
const Assignment = require("../models/HousekeepingAssignment");
const v = require("../utils/validation");
const { covers, planEnd } = require("../utils/hotelTime");

// Tính phòng thuộc kế hoạch theo tầng hiện tại và danh sách phòng cụ thể.
function matchesRoom(plan, room) {
  return plan.roomIds.some((id) => String(id) === String(room._id)) ||
    (room.floor !== undefined && plan.floors.includes(room.floor));
}

// Kiểm tra chồng ngày ca và phòng, kể cả hai kế hoạch của cùng một nhân viên.
async function assertNoOverlap(session, now = new Date()) {
  const plans = (await Assignment.find({ isActive: true }).session(session).lean()).filter((p) => planEnd(p) > now);
  const rooms = await Room.find({ isActive: true }).select("floor").session(session).lean();
  const activeIds = new Set(rooms.map((r) => String(r._id)));
  const byFloor = new Map();
  for (const room of rooms) {
    if (!byFloor.has(room.floor)) byFloor.set(room.floor, []);
    byFloor.get(room.floor).push(String(room._id));
  }
  const buckets = new Map();
  for (const plan of plans) {
    const keys = new Set(plan.roomIds.map(String).filter((id) => activeIds.has(id)).map((id) => `room:${id}`));
    for (const floor of plan.floors) {
      keys.add(`floor:${floor}`);
      for (const id of byFloor.get(floor) || []) keys.add(`room:${id}`);
    }
    for (const key of keys) {
      const slot = `${plan.shift}/${key}`;
      if (!buckets.has(slot)) buckets.set(slot, []);
      buckets.get(slot).push(plan);
    }
  }
  for (const [slot, entries] of buckets) {
    entries.sort((a, b) => a.effectiveFrom - b.effectiveFrom);
    for (let i = 1; i < entries.length; i++) {
      const a = entries[i - 1], b = entries[i];
      if (a.effectiveTo >= b.effectiveFrom) {
        const error = new v.HttpError(409, "A room already has a responsible staff member in this shift.");
        error.code = "MSG-72";
        error.details = { assignmentIds: [a._id, b._id], scope: slot };
        throw error;
      }
    }
  }
}

// Tìm người phụ trách đang hoạt động theo phòng, ngày và ca.
async function responsibleStaff(room, date, shift, session) {
  const plans = (await Assignment.find({ isActive: true, shift }).session(session).lean())
    .filter((p) => covers(p, date, shift) && matchesRoom(p, room));
  if (plans.length > 1) throw new v.HttpError(409, "Overlapping responsibility plans require correction.");
  if (!plans.length || !room.isActive) return null;
  const role = await Role.findOne({ key: "housekeeping", isActive: true }).session(session);
  if (!role) return null;
  const user = await User.findOne({ _id: plans[0].staffId, roleId: role._id, status: "active" }).select("_id").session(session);
  return user ? { staffId: user._id, assignmentId: plans[0]._id } : null;
}
// BR-41: on duty in a shift = an active Housekeeping account that the plan gives at least one room or floor in that shift.
async function onDutyStaff(slot, session) {
  const plans = (await Assignment.find({ isActive: true, shift: slot.shift }).session(session).lean()).filter((p) => covers(p, slot.date, slot.shift));
  const role = await Role.findOne({ key: "housekeeping", isActive: true }).session(session);
  if (!role || !plans.length) return [];
  return (await User.find({ _id: { $in: plans.map((p) => p.staffId) }, roleId: role._id, status: "active" }).select("_id").session(session)).map((u) => u._id);
}
// Báo nhân viên khi việc thêm hoặc chuyển phòng làm đổi phạm vi tầng phụ trách.
async function roomPlanEvents(before, after, session, events, now = new Date()) {
  const plans = await Assignment.find({ isActive: true }).session(session).lean();
  const accountIds = plans.filter((p) => planEnd(p) > now &&
    ((before && matchesRoom(p, before)) || matchesRoom(p, after))).map((p) => p.staffId);
  if (accountIds.length) events.push({ accountIds, type: "housekeeping_plan_changed", title: "Room responsibility updated",
    message: `Room ${after.roomNumber} was updated; check your floor responsibility plan.`, roomId: after._id });
}
module.exports = { matchesRoom, assertNoOverlap, responsibleStaff, roomPlanEvents, onDutyStaff };
