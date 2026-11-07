const Invoice = require("../models/Invoice");
const Booking = require("../models/Booking");
const v = require("../utils/validation");
const { generateInvoice } = require("../services/stayBilling");

async function list(req, res) {
  const id = v.id(req.params.id);
  const staff = req.role.permissions.includes("invoices.print");
  if (!staff && req.role.key !== "customer")
    throw new v.HttpError(403, "You cannot view invoices.");
  if (
    !(await Booking.exists({
      _id: id,
      ...(!staff ? { customerId: req.user._id } : {}),
    }))
  )
    throw new v.HttpError(404, "Booking not found.");
  res.json({
    data: await Invoice.find({ bookingId: id })
      .select("-sourceKey -issuedBy -__v")
      .sort({ issuedAt: 1 })
      .lean(),
  });
}

async function generate(req, res) {
  v.keys(req.body, ["penaltyId"]);
  const penaltyId = req.body.penaltyId
    ? v.id(req.body.penaltyId, "penaltyId")
    : undefined;
  res.status(201).json({ data: await generateInvoice(req, penaltyId) });
}

module.exports = { list, generate };
