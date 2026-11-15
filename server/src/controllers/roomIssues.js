const Room = require("../models/Room");
const RoomIssue = require("../models/RoomIssue");
const Booking = require("../models/Booking");
const v = require("../utils/validation");
const { hotelTransaction } = require("../services/hotelOperations");
const { assertCapacity } = require("../services/roomInventory");
const { logChange } = require("../services/audit");
const { deliver } = require("../services/operationNotifications");
const Penalty = require("../models/Penalty");
const CompensationItem = require("../models/CompensationItem");
const { notifyRole } = require("../services/notifications");

async function create(req) {
  v.keys(req.body, ["roomId", "title", "description", "unusable", "chargeItemId", "quantity"]);
  const chargeItemId = req.body.chargeItemId ? v.id(req.body.chargeItemId, "chargeItemId") : null;
  if (chargeItemId && !req.role.permissions.includes('damages.report')) throw new v.HttpError(403, 'You do not have permission to report damage.');
  if ((!chargeItemId || req.body.unusable === true) && !req.role.permissions.includes('room_issues.report')) throw new v.HttpError(403, 'You do not have permission to report room issues.');
  const quantity = req.body.quantity === undefined || req.body.quantity === "" ? 1 : Number(req.body.quantity);
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 20) v.fail("Quantity must be a whole number from 1 to 20.", "quantity");
  const input = { roomId: v.id(req.body.roomId, "roomId"), title: v.text(req.body.title, "title", 2, 120), description: v.text(req.body.description, "description", 0, 2000) };
  // Phòng không sử dụng được thì đưa phòng trống vào bảo trì.
  if (req.body.unusable !== undefined && typeof req.body.unusable !== "boolean") v.fail("Unusable must be true or false.", "unusable");
  const unusable = req.body.unusable === true;
  // Hư hỏng vật phẩm chỉ tạo bồi thường đề xuất; không đưa phòng vào bảo trì nếu vẫn sử dụng được.
  if (chargeItemId && !unusable) {
    if (!(await Room.exists({ _id: input.roomId }))) throw new v.HttpError(404, "Room not found.");
    return { data: { issue: null, maintenanceApplied: false, penalty: await proposePenalty(input, chargeItemId, req.user._id, quantity) } };
  }
  const result = await hotelTransaction(async (session) => {
    const room = await Room.findById(input.roomId).session(session);
    if (!room) throw new v.HttpError(404, "Room not found.");
    const [issue] = await RoomIssue.create([{ ...input, reportedBy: req.user._id }], { session });
    const events = [];
    let maintenanceApplied = false;
    if (unusable && ["available", "cleaning"].includes(room.status)) {
      const before = room.toObject();
      // Kiểm tra thiếu phòng cho booking sắp tới trước khi đưa phòng ra khỏi nguồn bán.
      let shortfall = false;
      try { await assertCapacity(room.roomTypeId, room._id, session); }
      catch (error) { if (error.code !== 'MSG-61') throw error; shortfall = true; }
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
  const penalty = chargeItemId ? await proposePenalty(result.issue, chargeItemId, req.user._id, quantity) : null;
  return { data: { issue: result.issue, maintenanceApplied: result.maintenanceApplied, penalty }, meta: { notificationStored: await deliver(result.events) } };
}

async function listing(req, res) {
  v.keys(req.query, ["status", "page", "limit"]);
  const filter = {};
  if (req.query.status !== undefined) filter.status = v.choice(req.query.status, "status", ["open", "in_progress", "resolved"]);
  const result = await v.list(RoomIssue, filter, req.query);
  // Gắn số phòng để quản lý xem được, kể cả phòng đã ngừng hoạt động.
  const rooms = await Room.find({ _id: { $in: result.data.map((i) => i.roomId) } }).select("roomNumber floor").lean();
  const byId = new Map(rooms.map((r) => [String(r._id), r]));
  result.data.forEach((i) => { const r = byId.get(String(i.roomId)); i.roomNumber = r?.roomNumber; i.floor = r?.floor; });
  res.json(result);
}

async function options(_req, res) {
  const [data, compensationItems] = await Promise.all([
    Room.find({ isActive: true }).select("roomNumber floor status").sort({ floor: 1, roomNumber: 1 }).lean(),
    CompensationItem.find({ isActive: true }).select("name price").sort({ name: 1 }).lean(),
  ]);
  res.json({ data, meta: { compensationItems } });
}

// Gắn bồi thường đề xuất vào booking đang ở hoặc lần trả phòng gần nhất để lễ tân xử lý.
async function proposePenalty(issue, itemId, reportedBy, quantity = 1) {
  const item = await CompensationItem.findOne({ _id: itemId, isActive: true });
  if (!item) throw new v.HttpError(404, "Compensation item not found.");
  const booking = (await Booking.findOne({ status: "checked_in", "rooms.roomId": issue.roomId }).select("_id bookingReference status"))
    || (await Booking.findOne({ status: "checked_out", "rooms.roomId": issue.roomId }).sort({ actualCheckOutAt: -1 }).select("_id bookingReference status"));
  if (!booking) return null;
  const penalty = await Penalty.create({
    bookingId: booking._id, roomId: issue.roomId, itemName: quantity > 1 ? `${item.name} x${quantity}` : item.name, description: issue.description || issue.title,
    proposedAmount: item.price * quantity, status: "proposed", afterCheckout: booking.status === "checked_out", reportedBy,
  });
  await notifyRole("penalty_proposed", "receptionist", { reference: booking.bookingReference, item: quantity > 1 ? `${item.name} x${quantity}` : item.name, amount: item.price * quantity }, { bookingId: booking._id, ...(issue._id ? { roomIssueId: issue._id } : {}) })
    .catch((e) => console.error("Notification failed:", e.message));
  return penalty;
}

module.exports = { create: require("../services/hotelOperations").transactional(create, 201), listing, options };
