const Booking = require("../models/Booking");
const Service = require("../models/Service");
const Task = require("../models/CleaningTask");
const v = require("../utils/validation");
const { amount } = require("../services/stayPricing");
const {
  getBooking,
  calculateBill,
  operationKey,
} = require("../services/stayBilling");
const { hotelTransaction } = require("../services/hotelOperations");
const { logChange } = require("../services/audit");
const { deliver } = require("../services/operationNotifications");

async function create(req, res) {
  v.keys(req.body, [
    "itemId",
    "description",
    "quantity",
    "amount",
    "taskId",
    "roomUnusable",
    "operationKey",
  ]);
  const roomUnusable =
    req.body.roomUnusable === undefined
      ? false
      : v.boolean(req.body.roomUnusable, "roomUnusable");
  if (roomUnusable && !req.role.permissions.includes("room_issues.report"))
    throw new v.HttpError(403, "You cannot report room issues.");
  const direct = req.role.permissions.includes("penalties.record");
  if (!direct && !req.role.permissions.includes("damages.report"))
    throw new v.HttpError(403, "You cannot report a penalty.");
  const key = operationKey(req, `penalty:${v.id(req.params.id)}`);
  const quantity = v.number(req.body.quantity, "quantity", 1, 1000);
  const result = await hotelTransaction(async (session) => {
    const b = await getBooking(req.params.id, session);
    const existing = b.penalties.find((p) => p.operationKey === key);
    if (existing) return { ...existing.toObject(), bookingId: b._id };
    if (!["checked_in", "checked_out"].includes(b.status))
      throw new v.HttpError(
        409,
        "A penalty requires an active or completed stay.",
      );
    const task = req.body.taskId
      ? await Task.findOne({
          _id: v.id(req.body.taskId),
          bookingId: b._id,
          ...(!direct ? { assignedTo: req.user._id } : {}),
        }).session(session)
      : null;
    if ((!direct || b.status === "checked_out") && !task)
      v.fail("Select the assigned task for this report.", "taskId");
    if (b.status === "checked_out" && task.type !== "turnover")
      throw new v.HttpError(
        409,
        "After check-out, a penalty must come from turnover cleaning.",
      );
    const item = req.body.itemId
      ? await Service.findOne({
          _id: v.id(req.body.itemId),
          kind: "compensation",
          isActive: true,
        }).session(session)
      : null;
    if (req.body.itemId && !item)
      throw new v.HttpError(404, "Compensation item is unavailable.");
    const description =
      item?.name || v.text(req.body.description, "description", 2, 1000);
    const proposedAmount = item ? amount(item.unitPrice * quantity) : undefined;
    if (!direct && req.body.amount !== undefined)
      v.fail("The front desk confirms the amount.");
    const value = direct
      ? item
        ? proposedAmount
        : v.number(req.body.amount, "amount", 0, 1e12)
      : proposedAmount;
    const penalty = b.penalties.create({
      taskId: task?._id,
      itemId: item?._id,
      description,
      quantity,
      unitPrice: item?.unitPrice,
      proposedAmount,
      amount: value,
      afterCheckout: b.status === "checked_out",
      status: direct ? "confirmed" : "proposed",
      reportedBy: req.user._id,
      confirmedBy: direct ? req.user._id : undefined,
      confirmedAt: direct ? new Date() : undefined,
      operationKey: key,
    });
    b.penalties.push(penalty);
    if (roomUnusable)
      await require("./stayHousekeeping").recordRoomIssue(
        req,
        task?.roomId || b.rooms[0].roomId,
        description,
        session,
      );
    if (b.status === "checked_in") {
      await calculateBill(b, session);
    }
    await b.save({ session });
    await logChange(
      req,
      "penalty.reported",
      "Booking",
      b._id,
      { penaltyId: penalty._id, amount: value, status: penalty.status },
      session,
    );
    return { ...penalty.toObject(), bookingId: b._id };
  });
  const notificationStored = await deliver([
    {
      roles: roomUnusable ? ["receptionist", "manager"] : ["receptionist"],
      type: "penalty_reported",
      title: "Damage report",
      message: roomUnusable
        ? "A damage report marks the room as unusable. Review availability and upcoming arrivals."
        : "A damage report is ready for review.",
      bookingId: result.bookingId,
    },
  ]);
  res.status(201).json({ data: result, meta: { notificationStored } });
}

async function update(req, res) {
  v.keys(req.body, ["status", "amount", "reason"]);
  const status = v.choice(req.body.status, "status", ["confirmed", "waived"]);
  const data = await hotelTransaction(async (session) => {
    const penaltyId = v.id(req.params.penaltyId);
    const owner = await Booking.findOne({ "penalties._id": penaltyId })
      .select("_id")
      .session(session);
    if (!owner) throw new v.HttpError(404, "Penalty not found.");
    const b = await getBooking(owner._id, session);
    const penalty = b.penalties.id(penaltyId);
    if (
      penalty.paymentId ||
      penalty.status === "waived" ||
      (await require("../models/Invoice")
        .exists({ sourceKey: `penalty:${penalty._id}` })
        .session(session))
    )
      throw new v.HttpError(409, "This penalty can no longer be changed.");
    if (!penalty.afterCheckout && b.status !== "checked_in")
      throw new v.HttpError(409, "The original stay bill is already closed.");
    const value =
      status === "waived"
        ? 0
        : req.body.amount === undefined
          ? penalty.amount
          : v.number(req.body.amount, "amount", 0, 1e12);
    if (value === undefined)
      v.fail("Enter an amount for the Other item.", "amount");
    if (penalty.itemId && value > penalty.proposedAmount)
      v.fail("The amount cannot exceed the catalog charge.", "amount");
    const reason =
      status === "waived" ||
      value < (penalty.amount ?? penalty.proposedAmount ?? value)
        ? v.text(req.body.reason, "reason", 2, 500)
        : undefined;
    Object.assign(penalty, {
      status,
      amount: value,
      reason,
      confirmedBy: req.user._id,
      confirmedAt: new Date(),
    });
    if (!penalty.afterCheckout) {
      await calculateBill(b, session);
    }
    await b.save({ session });
    await logChange(
      req,
      "penalty.decided",
      "Booking",
      b._id,
      { penaltyId: penalty._id, status, amount: value, reason },
      session,
    );
    return { ...penalty.toObject(), bookingId: b._id };
  });
  res.json({ data });
}

module.exports = { create, update };
