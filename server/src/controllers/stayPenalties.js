const Penalty = require("../models/Penalty");
const Item = require("../models/CompensationItem");
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
    const existing = await Penalty.findOne({ operationKey: key }).session(
      session,
    );
    if (existing) return existing;
    const b = await getBooking(req.params.id, session);
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
      ? await Item.findOne({
          _id: v.id(req.body.itemId),
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
    const [penalty] = await Penalty.create(
      [
        {
          bookingId: b._id,
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
        },
      ],
      { session },
    );
    if (roomUnusable)
      await require("./stayHousekeeping").recordRoomIssue(
        req,
        task?.roomId || b.rooms[0].roomId,
        description,
        session,
      );
    if (b.status === "checked_in") {
      await calculateBill(b, session);
      await b.save({ session });
    }
    await logChange(
      req,
      "penalty.reported",
      "Penalty",
      penalty._id,
      { bookingId: b._id, amount: value, status: penalty.status },
      session,
    );
    return penalty;
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
    const penalty = await Penalty.findById(v.id(req.params.penaltyId)).session(
      session,
    );
    if (!penalty) throw new v.HttpError(404, "Penalty not found.");
    if (
      penalty.paymentId ||
      penalty.status === "waived" ||
      (await require("../models/Invoice")
        .exists({ sourceKey: `penalty:${penalty._id}` })
        .session(session))
    )
      throw new v.HttpError(409, "This penalty can no longer be changed.");
    const b = await getBooking(penalty.bookingId, session);
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
    await penalty.save({ session });
    if (!penalty.afterCheckout) {
      await calculateBill(b, session);
      await b.save({ session });
    }
    await logChange(
      req,
      "penalty.decided",
      "Penalty",
      penalty._id,
      { status, amount: value, reason },
      session,
    );
    return penalty;
  });
  res.json({ data });
}

module.exports = { create, update };
