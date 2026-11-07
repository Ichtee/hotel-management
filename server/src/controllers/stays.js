const { randomBytes } = require("node:crypto");
const Booking = require("../models/Booking");
const Room = require("../models/Room");
const RoomType = require("../models/RoomType");
const RoomIssue = require("../models/RoomIssue");
const Payment = require("../models/Payment");
const Refund = require("../models/Refund");
const Coupon = require("../models/Coupon");
const CouponUsage = require("../models/CouponUsage");
const Service = require("../models/Service");
const User = require("../models/User");
const Role = require("../models/Role");
const Task = require("../models/CleaningTask");
const v = require("../utils/validation");
const p = require("../services/stayPricing");
const bill = require("../services/stayBilling");
const { phoneHash } = require("../utils/guestData");
const { hotelTransaction } = require("../services/hotelOperations");
const { logChange } = require("../services/audit");
const { createTaskInSession } = require("../services/housekeepingTasks");
const { deliver } = require("../services/operationNotifications");
const { notify } = require("../services/notifications");

async function tell(booking, event) {
  if (!booking.customerId) return;
  await notify(
    event,
    booking.customerId,
    {
      reference: booking.bookingReference,
      additionalDeposit: booking.pendingChange?.additionalDeposit,
    },
    { bookingId: booking._id },
  ).catch(() => console.error("A stay notification could not be delivered."));
}

async function couponFor(code, subtotal, session, now) {
  if (!code?.trim()) return null;
  const coupon = await Coupon.findOne({
    code: v.text(code, "couponCode", 2, 30).toUpperCase(),
    isActive: true,
  }).session(session);
  if (
    !coupon ||
    (coupon.startDate && coupon.startDate > now) ||
    (coupon.endDate && coupon.endDate <= now) ||
    coupon.usageCount >= coupon.usageLimit ||
    subtotal < coupon.minimumSpend
  )
    v.fail("Coupon is not valid for this booking.", "couponCode");
  return {
    coupon,
    discount: Math.min(
      subtotal,
      coupon.discountType === "fixed"
        ? coupon.discountValue
        : Math.floor((subtotal * coupon.discountValue) / 100),
    ),
  };
}

async function createBooking(req, res, online = false) {
  const allowed = [
    "roomTypeId",
    "checkInDate",
    "checkOutDate",
    "guestCount",
    "couponCode",
    "operationKey",
  ];
  v.keys(req.body, [
    ...allowed,
    ...(online
      ? ["paymentOption"]
      : ["fullName", "phone", "email", "customerId"]),
  ]);
  if (online && req.role.key !== "customer")
    throw new v.HttpError(403, "Only a customer can book online.");
  if (online && req.body.paymentOption && req.body.paymentOption !== "deposit")
    v.fail("Only the deposit can be paid online.");
  const now = new Date(),
    data = req.body;
  p.dates(data.checkInDate, data.checkOutDate);
  if (
    data.checkInDate < p.hotelDay(now) ||
    (!online && data.checkInDate !== p.hotelDay(now))
  )
    v.fail(
      online
        ? "Check-in cannot be in the past."
        : "A walk-in booking must start today.",
      "checkInDate",
    );
  const guestCount = v.number(data.guestCount, "guestCount", 1, 100);
  const createKey = bill.operationKey(req, online ? "online" : "walk-in");
  const booking = await hotelTransaction(async (session) => {
    const existing = await Booking.findOne({ createKey }).session(session);
    if (existing) return existing;
    let customer = online ? req.user : null;
    if (!online && data.customerId) {
      const role = await Role.findOne({ key: "customer" }).session(session);
      customer = await User.findOne({
        _id: v.id(data.customerId, "customerId"),
        roleId: role._id,
        status: "active",
      }).session(session);
      if (!customer) throw new v.HttpError(404, "Customer not found.");
    }
    const guestName = customer
      ? customer.customerProfile?.fullName || customer.username
      : v.text(data.fullName, "fullName", 2, 100);
    const guestPhone = v.phone(customer?.phone || data.phone, true);
    const guestEmail =
      customer?.email || (data.email ? v.email(data.email) : undefined);
    if (
      online &&
      (await Booking.countDocuments({
        customerId: customer._id,
        status: "pending",
      }).session(session)) >= 3
    )
      throw new v.HttpError(
        409,
        "Complete or cancel an existing pending booking first.",
      );
    const type = await p.getType(data.roomTypeId, guestCount, session);
    await p.assertAvailable(
      type._id,
      data.checkInDate,
      data.checkOutDate,
      session,
      null,
      now,
    );
    const nightlyRates = p.priceNights(
      type,
      data.checkInDate,
      data.checkOutDate,
    );
    const roomAmount = p.amount(
      nightlyRates.reduce((sum, n) => sum + n.price, 0),
    );
    const offer = await couponFor(data.couponCode, roomAmount, session, now);
    if (
      offer &&
      customer &&
      (await CouponUsage.exists({
        couponId: offer.coupon._id,
        customerId: customer._id,
      }).session(session))
    )
      v.fail("This customer has already used the coupon.", "couponCode");
    const snapshot = await p.policySnapshot(session, now);
    const discountAmount = offer?.discount || 0,
      totalAmount = roomAmount - discountAmount;
    if (online && totalAmount > 0 && !snapshot.depositValue)
      throw new v.HttpError(
        409,
        "Online booking is unavailable until a deposit policy is configured.",
      );
    const depositRequired = online
      ? Math.ceil((totalAmount * snapshot.depositValue) / 100)
      : 0;
    const [b] = await Booking.create(
      [
        {
          createKey,
          m4Version: 1,
          bookingReference: `BK-${randomBytes(6).toString("hex").toUpperCase()}`,
          customerId: customer?._id,
          createdBy: req.user._id,
          guestName,
          guestPhone,
          guestPhoneHash: phoneHash(guestPhone),
          guestEmail,
          checkInDate: data.checkInDate,
          checkOutDate: data.checkOutDate,
          rooms: [
            {
              roomTypeId: type._id,
              guestCount,
              priceAtBooking: nightlyRates[0].price,
            },
          ],
          nightlyRates,
          roomAmount,
          totalAmount,
          discountAmount,
          couponDiscountSnapshot: discountAmount,
          couponCode: offer?.coupon.code,
          depositRequired,
          policySnapshot: snapshot,
          bookingSource: online ? "online" : "front_desk",
          status: depositRequired ? "pending" : "confirmed",
          holdExpiresAt: depositRequired ? new Date(+now + 900000) : undefined,
        },
      ],
      { session },
    );
    if (offer) {
      await CouponUsage.create(
        [
          {
            couponId: offer.coupon._id,
            bookingId: b._id,
            customerId: customer?._id,
          },
        ],
        { session },
      );
      await Coupon.updateOne(
        { _id: offer.coupon._id },
        { $inc: { usageCount: 1 } },
        { session },
      );
    }
    await logChange(
      req,
      "booking.created",
      "Booking",
      b._id,
      { source: b.bookingSource, totalAmount },
      session,
    );
    return b;
  });
  if (booking.status === "confirmed") await tell(booking, "booking_confirmed");
  res.status(201).json({
    data: {
      _id: booking._id,
      bookingReference: booking.bookingReference,
      status: booking.status,
      totalAmount: booking.totalAmount,
      depositRequired: booking.depositRequired,
    },
  });
}

async function search(req, res) {
  const from = req.query.checkIn || req.query.checkInDate,
    to = req.query.checkOut || req.query.checkOutDate;
  p.dates(from, to);
  if (from < p.hotelDay())
    v.fail("Check-in cannot be in the past.", "checkInDate");
  const guests = Number(req.query.guests || req.query.guestCount || 1);
  v.number(guests, "guests", 1, 100);
  const types = await RoomType.find({
    isActive: true,
    maxOccupancy: { $gte: guests },
  })
    .sort({ basePrice: 1 })
    .lean();
  const result = [];
  for (const type of types) {
    const availableCount = await p.availability(type._id, from, to, null);
    if (availableCount)
      result.push({
        ...type,
        availableCount,
        availableRooms: availableCount,
        totalPrice: p
          .priceNights(type, from, to)
          .reduce((sum, n) => sum + n.price, 0),
      });
  }
  res.json({ data: result });
}

async function modify(req, res) {
  v.keys(req.body, [
    "checkInDate",
    "checkOutDate",
    "guestCount",
    "fullName",
    "phone",
    "idDocumentNo",
  ]);
  const now = new Date();
  const booking = await hotelTransaction(async (session) => {
    const b = await bill.getBooking(req.params.id, session);
    if (
      !["pending", "confirmed", "checked_in", "checked_out"].includes(b.status)
    )
      throw new v.HttpError(409, "This booking cannot be modified.");
    if (b.checkout?.startedAt && b.status === "checked_in")
      throw new v.HttpError(
        409,
        "Finish or cancel check-out before modifying the stay.",
      );
    if (b.pendingChange?.holdExpiresAt > now)
      throw new v.HttpError(409, "An additional deposit is still pending.");
    for (const field of ["fullName", "phone", "idDocumentNo"])
      if (req.body[field] !== undefined) {
        if (field === "fullName")
          b.guestName = v.text(req.body[field], field, 2, 100);
        if (field === "phone") {
          b.guestPhone = v.phone(req.body.phone, true);
          b.guestPhoneHash = phoneHash(b.guestPhone);
        }
        if (field === "idDocumentNo") {
          if (!["checked_in", "checked_out"].includes(b.status))
            v.fail("Identity documents are recorded at check-in.");
          b.guestIdDocumentNo = v.text(req.body[field], field, 3, 40);
        }
      }
    const stayChange = ["checkInDate", "checkOutDate", "guestCount"].some(
      (key) => req.body[key] !== undefined,
    );
    if (stayChange) {
      p.requireSnapshot(b);
      if (b.status === "checked_out")
        throw new v.HttpError(
          409,
          "Only guest information can be corrected after check-out.",
        );
      const from = req.body.checkInDate || p.day(b.checkInDate),
        to = req.body.checkOutDate || p.day(b.checkOutDate);
      p.dates(from, to);
      if (
        b.status === "checked_in" &&
        (from !== p.day(b.checkInDate) || to < p.day(b.checkOutDate))
      )
        v.fail("A checked-in stay can only be extended.");
      if (from !== p.day(b.checkInDate) && from < p.hotelDay(now))
        v.fail("Check-in cannot be in the past.");
      const guests =
        req.body.guestCount === undefined
          ? b.rooms[0].guestCount
          : v.number(req.body.guestCount, "guestCount", 1, 100);
      const type = await p.getType(b.rooms[0].roomTypeId, guests, session);
      if (b.status !== "checked_in" || to > p.day(b.checkOutDate))
        await p.assertAvailable(
          type._id,
          b.status === "checked_in" ? p.day(b.checkOutDate) : from,
          to,
          session,
          b._id,
          now,
        );
      if (
        b.status === "checked_in" &&
        (await Booking.exists({
          _id: { $ne: b._id },
          "rooms.roomId": b.rooms[0].roomId,
          status: {
            $in: [
              "confirmed",
              "checked_in",
              "cancellation_requested",
              "pending",
            ],
          },
          checkInDate: { $lt: new Date(to) },
          checkOutDate: { $gt: b.checkOutDate },
        }).session(session))
      )
        throw new v.HttpError(
          409,
          "The assigned room is needed for another booking. Arrange a room change first.",
        );
      const nightlyRates = p.priceNights(type, from, to, b.nightlyRates);
      const roomAmount = p.amount(
        nightlyRates.reduce((s, n) => s + n.price, 0),
      );
      if (b.couponCode) {
        const coupon = await Coupon.findOne({ code: b.couponCode }).session(
          session,
        );
        if (!coupon || roomAmount < coupon.minimumSpend)
          throw new v.HttpError(
            409,
            "The coupon is not valid for the new stay.",
          );
      }
      const oldBill = await bill.calculateBill(b, session);
      const discountAmount = Math.min(
        b.couponDiscountSnapshot ?? b.discountAmount,
        roomAmount,
      );
      const totalAmount = p.amount(
        roomAmount +
          b.serviceAmount +
          b.feeAmount +
          b.penaltyAmount -
          discountAmount,
      );
      const depositPaid = oldBill.payments
        .filter((x) => x.kind === "deposit")
        .reduce((s, x) => s + x.amount - (x.refundedAmount || 0), 0);
      if (totalAmount < depositPaid)
        throw new v.HttpError(
          409,
          "The new total cannot be below the deposit already paid.",
        );
      const depositRequired =
        b.bookingSource === "online" && b.status !== "checked_in"
          ? Math.max(
              depositPaid,
              Math.ceil((totalAmount * b.policySnapshot.depositValue) / 100),
            )
          : b.depositRequired;
      const change = {
        checkInDate: from,
        checkOutDate: to,
        nightlyRates,
        roomAmount,
        totalAmount,
        discountAmount,
        depositRequired,
        guestCount: guests,
      };
      if (b.status === "confirmed" && depositRequired > depositPaid)
        b.pendingChange = {
          ...change,
          key: randomBytes(12).toString("hex"),
          additionalDeposit: depositRequired - depositPaid,
          holdExpiresAt: new Date(+now + 900000),
        };
      else {
        Object.assign(b, change);
        b.rooms[0].guestCount = guests;
        b.pendingChange = undefined;
      }
    }
    await b.save({ session });
    await logChange(
      req,
      "booking.modified",
      "Booking",
      b._id,
      { stayChanged: stayChange, pendingChange: Boolean(b.pendingChange) },
      session,
    );
    return b;
  });
  await tell(
    booking,
    booking.pendingChange ? "booking_change_pending" : "booking_modified",
  );
  res.json({
    data: { _id: booking._id, pendingChange: booking.pendingChange },
  });
}

async function availableRooms(req, res) {
  const b = await bill.getBooking(req.params.id, null);
  const held = await Booking.distinct("rooms.roomId", {
    _id: { $ne: b._id },
    status: {
      $in: ["pending", "confirmed", "cancellation_requested", "checked_in"],
    },
    checkInDate: { $lt: b.checkOutDate },
    checkOutDate: { $gt: b.checkInDate },
  });
  const rooms = await Room.find({
    _id: { $nin: held },
    roomTypeId: b.rooms[0].roomTypeId,
    isActive: true,
    status: "available",
  })
    .select("roomNumber floor roomTypeId")
    .lean();
  res.json({ data: rooms });
}

async function checkIn(req, res) {
  v.keys(req.body, ["roomId", "guestCount", "idDocumentNo"]);
  const now = new Date();
  const result = await hotelTransaction(async (session) => {
    const b = await bill.getBooking(req.params.id, session);
    p.requireSnapshot(b);
    if (
      b.status !== "confirmed" ||
      p.hotelDay(now) < p.day(b.checkInDate) ||
      now >= p.noShowAt(b)
    )
      throw new v.HttpError(
        409,
        "This booking is outside its check-in period.",
      );
    if (b.pendingChange?.holdExpiresAt > now)
      throw new v.HttpError(
        409,
        "Complete the pending deposit change before check-in.",
      );
    const payments = await bill.calculateBill(b, session);
    const deposit = payments.payments
      .filter((x) => x.kind === "deposit")
      .reduce((s, x) => s + x.amount - (x.refundedAmount || 0), 0);
    if (b.bookingSource === "online" && deposit < b.depositRequired)
      throw new v.HttpError(
        409,
        "The required online deposit has not been paid.",
      );
    const guests = v.number(req.body.guestCount, "guestCount", 1, 100);
    await p.getType(b.rooms[0].roomTypeId, guests, session);
    const room = await Room.findOne({
      _id: v.id(req.body.roomId, "roomId"),
      roomTypeId: b.rooms[0].roomTypeId,
      isActive: true,
      status: "available",
    }).session(session);
    if (!room)
      throw new v.HttpError(409, "The selected room is no longer available.");
    if (
      await Booking.exists({
        _id: { $ne: b._id },
        "rooms.roomId": room._id,
        status: {
          $in: ["pending", "confirmed", "cancellation_requested", "checked_in"],
        },
        checkInDate: { $lt: b.checkOutDate },
        checkOutDate: { $gt: b.checkInDate },
      }).session(session)
    )
      throw new v.HttpError(
        409,
        "The selected room is assigned to another stay.",
      );
    b.guestIdDocumentNo = v.text(req.body.idDocumentNo, "idDocumentNo", 3, 40);
    b.rooms[0].roomId = room._id;
    b.rooms[0].guestCount = guests;
    b.roomHistory.push({
      roomId: room._id,
      roomTypeId: room.roomTypeId,
      from: now,
    });
    b.status = "checked_in";
    b.actualCheckInAt = now;
    b.checkedInBy = req.user._id;
    room.status = "occupied";
    if (now < p.atHotel(b.checkInDate, b.policySnapshot.checkInTime))
      bill.addFee(b, "early_check_in", b.policySnapshot.earlyCheckInFee, now);
    await bill.calculateBill(b, session);
    await room.save({ session });
    await b.save({ session });
    await logChange(
      req,
      "stay.checked_in",
      "Booking",
      b._id,
      { roomId: room._id },
      session,
    );
    return { _id: b._id, status: b.status };
  });
  res.json({ data: result });
}

async function changeOptionsFor(b, session, now) {
  p.requireSnapshot(b);
  const lastNight = p.day(new Date(+b.checkOutDate - 86400000));
  const physicalFrom =
    b.status === "confirmed"
      ? p.day(b.checkInDate)
      : [p.hotelDay(now), lastNight].sort()[0];
  const to = p.day(b.checkOutDate);
  const effectiveFrom = p.repriceFrom(b, now);
  const compareFrom = effectiveFrom < to ? effectiveFrom : physicalFrom;
  const currentType = await p.getType(
    b.rooms[0].roomTypeId,
    b.rooms[0].guestCount,
    session,
  );
  const currentPrice = p
    .priceNights(currentType, compareFrom, to)
    .reduce((s, n) => s + n.price, 0);
  const types = await RoomType.find({
    isActive: true,
    maxOccupancy: { $gte: b.rooms[0].guestCount },
  })
    .session(session)
    .lean();
  const options = [];
  for (const type of types) {
    if (
      !(await p.availability(type._id, physicalFrom, to, session, b._id, now))
    )
      continue;
    const held = await Booking.distinct("rooms.roomId", {
      _id: { $ne: b._id },
      status: {
        $in: ["pending", "confirmed", "cancellation_requested", "checked_in"],
      },
      checkInDate: { $lt: b.checkOutDate },
      checkOutDate: { $gt: new Date(physicalFrom) },
    }).session(session);
    const rooms = await Room.find({
      _id: {
        $nin: [...held, ...(b.rooms[0].roomId ? [b.rooms[0].roomId] : [])],
      },
      roomTypeId: type._id,
      isActive: true,
      status: "available",
    })
      .session(session)
      .lean();
    const quote = p
      .priceNights(type, compareFrom, to)
      .reduce((s, n) => s + n.price, 0);
    for (const room of rooms)
      options.push({
        _id: room._id,
        roomNumber: room.roomNumber,
        roomTypeId: type._id,
        roomTypeName: type.name,
        quote,
        direction:
          String(type._id) === String(currentType._id)
            ? "same"
            : quote < currentPrice
              ? "downgrade"
              : quote > currentPrice
                ? "upgrade"
                : "same",
        effectiveFrom,
      });
  }
  const higherExists = options.some((o) => o.direction !== "downgrade");
  return options.filter((o) => o.direction !== "downgrade" || !higherExists);
}

async function changeRoomOptions(req, res) {
  const b = await bill.getBooking(req.params.id, null);
  if (!["confirmed", "checked_in"].includes(b.status))
    throw new v.HttpError(409, "This booking cannot change rooms.");
  res.json({ data: await changeOptionsFor(b, null, new Date()) });
}

async function vacate(req, booking, roomId, session, events, now) {
  const room = await Room.findById(roomId).session(session);
  if (!room) throw new v.HttpError(409, "The assigned room is missing.");
  room.status = (await RoomIssue.exists({
    roomId,
    status: { $ne: "resolved" },
  }).session(session))
    ? "maintenance"
    : "cleaning";
  await room.save({ session });
  const task = await createTaskInSession(
    { roomId, bookingId: booking._id, type: "turnover" },
    session,
    events,
    now,
  );
  await logChange(
    req,
    "room.vacated",
    "Room",
    roomId,
    { bookingId: booking._id, taskId: task._id, status: room.status },
    session,
  );
}

async function changeRoom(req, res) {
  v.keys(req.body, [
    "newRoomId",
    "cause",
    "reason",
    "guestAgreed",
    "operationKey",
  ]);
  const cause = v.choice(req.body.cause, "cause", ["hotel", "guest"]),
    reason = v.text(req.body.reason, "reason", 2, 500);
  const operationKey = bill.operationKey(
    req,
    `room-change:${v.id(req.params.id)}`,
  );
  const now = new Date();
  const result = await hotelTransaction(async (session) => {
    const b = await bill.getBooking(req.params.id, session);
    if (
      await require("../models/AuditLog")
        .exists({
          targetId: b._id,
          action: "stay.room_changed",
          "detail.operationKey": operationKey,
        })
        .session(session)
    )
      return { booking: b, events: [] };
    if (
      !["confirmed", "checked_in"].includes(b.status) ||
      (b.status === "confirmed" && cause !== "hotel")
    )
      throw new v.HttpError(
        409,
        "Before check-in, only a hotel-caused relocation is allowed.",
      );
    if (b.checkout?.startedAt || b.pendingChange?.holdExpiresAt > now)
      throw new v.HttpError(
        409,
        "Finish the pending operation before changing rooms.",
      );
    const roomId = v.id(req.body.newRoomId, "newRoomId");
    if (String(b.rooms[0].roomId) === roomId)
      throw new v.HttpError(409, "Select a different room.");
    const options = await changeOptionsFor(b, session, now);
    const chosen = options.find((o) => String(o._id) === roomId);
    if (!chosen)
      throw new v.HttpError(409, "This room change is no longer available.");
    if (
      chosen.direction === "downgrade" &&
      (cause !== "hotel" || req.body.guestAgreed !== true)
    )
      v.fail(
        "A hotel-caused downgrade requires the guest's agreement and no suitable higher-priced room.",
      );
    const type = await p.getType(
      chosen.roomTypeId,
      b.rooms[0].guestCount,
      session,
    );
    const oldTypeId = b.rooms[0].roomTypeId;
    const quoted =
      chosen.effectiveFrom < p.day(b.checkOutDate)
        ? p.priceNights(type, chosen.effectiveFrom, p.day(b.checkOutDate))
        : [];
    const newPrices = new Map(quoted.map((n) => [n.date, n.price]));
    for (const night of b.nightlyRates) {
      if (
        night.date >=
        (b.status === "confirmed" ? p.day(b.checkInDate) : p.hotelDay(now))
      )
        night.roomTypeId = type._id;
      if (
        newPrices.has(night.date) &&
        ((cause === "guest" && chosen.direction === "upgrade") ||
          chosen.direction === "downgrade")
      )
        night.price = newPrices.get(night.date);
    }
    b.roomAmount = p.amount(b.nightlyRates.reduce((s, n) => s + n.price, 0));
    const events = [];
    if (b.status === "checked_in") {
      await vacate(req, b, b.rooms[0].roomId, session, events, now);
      const history = b.roomHistory.findLast((h) => !h.to);
      if (history) history.to = now;
      b.roomHistory.push({ roomId, roomTypeId: type._id, from: now });
      await Room.updateOne(
        { _id: roomId, status: "available" },
        { $set: { status: "occupied" } },
        { session },
      );
      b.rooms[0].roomId = roomId;
    } else b.rooms[0].roomId = undefined;
    b.rooms[0].roomTypeId = type._id;
    const updated = await bill.calculateBill(b, session);
    if (chosen.direction === "downgrade") {
      b.depositRequired = Math.min(b.depositRequired, b.totalAmount);
      const deposits = updated.payments.filter((x) => x.kind === "deposit");
      let excess = Math.max(
        0,
        deposits.reduce((s, x) => s + x.amount - (x.refundedAmount || 0), 0) -
          b.totalAmount,
      );
      const waiting = await Refund.find({
        bookingId: b._id,
        status: "requested",
      })
        .session(session)
        .lean();
      excess = Math.max(0, excess - waiting.reduce((s, r) => s + r.amount, 0));
      for (const payment of deposits) {
        const remaining =
          payment.amount -
          (payment.refundedAmount || 0) -
          waiting
            .filter((r) => String(r.paymentId) === String(payment._id))
            .reduce((s, r) => s + r.amount, 0);
        const refund = Math.min(excess, remaining);
        if (refund > 0) {
          await Refund.create(
            [
              {
                bookingId: b._id,
                paymentId: payment._id,
                amount: refund,
                status: "requested",
                reason: "Excess deposit after a hotel-caused downgrade",
              },
            ],
            { session },
          );
          excess -= refund;
        }
      }
    }
    await b.save({ session });
    await logChange(
      req,
      "stay.room_changed",
      "Booking",
      b._id,
      {
        operationKey,
        oldTypeId,
        roomTypeId: type._id,
        roomId,
        cause,
        reason,
        guestAgreed: req.body.guestAgreed === true,
        effectiveFrom: chosen.effectiveFrom,
      },
      session,
    );
    return { booking: b, events };
  });
  await tell(result.booking, "booking_modified");
  res.json({
    data: { _id: result.booking._id },
    meta: { notificationStored: await deliver(result.events) },
  });
}

async function addService(req, res) {
  v.keys(req.body, ["serviceId", "quantity", "operationKey"]);
  const operationKey = bill.operationKey(req, `service:${v.id(req.params.id)}`);
  await hotelTransaction(async (session) => {
    const b = await bill.getBooking(req.params.id, session);
    if (b.services.some((s) => s.operationKey === operationKey)) return;
    if (b.status !== "checked_in")
      throw new v.HttpError(
        409,
        "Services can only be recorded during a stay.",
      );
    const service = await Service.findOne({
      _id: v.id(req.body.serviceId, "serviceId"),
      isActive: true,
    }).session(session);
    if (!service) throw new v.HttpError(404, "Service is unavailable.");
    const quantity = v.number(req.body.quantity, "quantity", 1, 1000);
    b.services.push({
      serviceId: service._id,
      name: service.name,
      unitPrice: service.unitPrice,
      quantity,
      amount: p.amount(quantity * service.unitPrice),
      recordedBy: req.user._id,
      operationKey,
    });
    await bill.calculateBill(b, session);
    await b.save({ session });
    await logChange(
      req,
      "service.recorded",
      "Booking",
      b._id,
      { serviceId: service._id, quantity },
      session,
    );
  });
  res.status(201).json({ data: { saved: true } });
}

async function voidService(req, res) {
  v.keys(req.body, ["reason"]);
  const reason = v.text(req.body.reason, "reason", 2, 500);
  await hotelTransaction(async (session) => {
    const b = await bill.getBooking(req.params.id, session);
    if (b.status !== "checked_in")
      throw new v.HttpError(
        409,
        "A service can only be removed before check-out.",
      );
    const line = b.services.id(v.id(req.params.lineId));
    if (!line) throw new v.HttpError(404, "Service line not found.");
    if (line.isVoided) return;
    Object.assign(line, {
      isVoided: true,
      voidReason: reason,
      voidedAt: new Date(),
      voidedBy: req.user._id,
    });
    await bill.calculateBill(b, session);
    await b.save({ session });
    await logChange(
      req,
      "service.voided",
      "Booking",
      b._id,
      { lineId: line._id, reason },
      session,
    );
  });
  res.json({ data: { saved: true } });
}

async function startCheckout(req, res) {
  v.keys(req.body, []);
  const result = await hotelTransaction(async (session) => {
    const b = await bill.getBooking(req.params.id, session),
      events = [];
    if (b.status !== "checked_in")
      throw new v.HttpError(
        409,
        "Only a checked-in booking can start check-out.",
      );
    p.requireSnapshot(b);
    if (!b.checkout?.startedAt) {
      const task = await createTaskInSession(
        { roomId: b.rooms[0].roomId, bookingId: b._id, type: "inspection" },
        session,
        events,
        new Date(),
      );
      b.checkout = { startedAt: new Date(), inspectionTaskId: task._id };
      await b.save({ session });
      await logChange(
        req,
        "checkout.started",
        "Booking",
        b._id,
        { taskId: task._id },
        session,
      );
    }
    return { checkout: b.checkout, events };
  });
  res.json({
    data: result.checkout,
    meta: { notificationStored: await deliver(result.events) },
  });
}

async function skipInspection(req, res) {
  v.keys(req.body, ["reason"]);
  const reason = v.text(req.body.reason, "reason", 2, 500);
  await hotelTransaction(async (session) => {
    const b = await bill.getBooking(req.params.id, session);
    if (b.status !== "checked_in" || !b.checkout?.startedAt)
      throw new v.HttpError(409, "Start check-out first.");
    if (b.checkout.skippedAt) return;
    Object.assign(b.checkout, {
      skippedAt: new Date(),
      skippedBy: req.user._id,
      skipReason: reason,
    });
    await b.save({ session });
    await logChange(
      req,
      "inspection.skipped",
      "Booking",
      b._id,
      { reason },
      session,
    );
  });
  res.json({ data: { saved: true } });
}

async function getBill(req, res) {
  const result = await hotelTransaction(async (session) => {
    const b = await bill.getBooking(req.params.id, session);
    p.requireSnapshot(b);
    const calculated =
      b.status === "checked_in" && b.checkout?.startedAt
        ? await bill.prepareBill(b, session, new Date())
        : await bill.calculateBill(b, session);
    if (b.status === "checked_in") await b.save({ session });
    const inspection = b.checkout?.inspectionTaskId
      ? await Task.findById(b.checkout.inspectionTaskId).session(session).lean()
      : null;
    return {
      ...calculated,
      checkout: b.checkout,
      inspection,
      services: b.services,
      fees: b.fees,
      nightlyRates: b.nightlyRates,
    };
  });
  res.json({ data: result });
}

async function completeCheckout(req, res) {
  v.keys(req.body, []);
  const result = await hotelTransaction(async (session) => {
    const b = await bill.getBooking(req.params.id, session),
      events = [];
    if (b.status === "checked_out") return { booking: b, events };
    if (b.status !== "checked_in")
      throw new v.HttpError(409, "Only a checked-in booking can check out.");
    await bill.assertInspection(b, session);
    const calculated = await bill.prepareBill(b, session, new Date());
    if (calculated.balance)
      throw new v.HttpError(
        409,
        "Pay the remaining balance before completing check-out.",
      );
    const now = new Date();
    await vacate(req, b, b.rooms[0].roomId, session, events, now);
    const current = b.roomHistory.findLast((h) => !h.to);
    if (current) current.to = now;
    b.status = "checked_out";
    b.actualCheckOutAt = now;
    b.checkedOutBy = req.user._id;
    await b.save({ session });
    await logChange(
      req,
      "stay.checked_out",
      "Booking",
      b._id,
      { totalAmount: b.totalAmount },
      session,
    );
    return { booking: b, events };
  });
  let invoice,
    invoicePending = false;
  try {
    invoice = await bill.generateInvoice(req);
  } catch {
    invoicePending = true;
  }
  res.json({
    data: {
      _id: result.booking._id,
      status: "checked_out",
      invoice,
      invoicePending,
    },
    meta: { notificationStored: await deliver(result.events) },
    ...(invoicePending
      ? {
          message:
            "Check-out completed. Generate the invoice again from this booking.",
        }
      : {}),
  });
}

module.exports = {
  createWalkIn: (req, res) => createBooking(req, res),
  createOnline: (req, res) => createBooking(req, res, true),
  search,
  modify,
  availableRooms,
  checkIn,
  changeRoomOptions,
  changeRoom,
  addService,
  voidService,
  startCheckout,
  skipInspection,
  getBill,
  completeCheckout,
};
