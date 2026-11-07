const Invoice = require("../models/Invoice");
const v = require("../utils/validation");

async function listing(req, res) {
  v.keys(req.query, ["page", "limit"]);
  const result = await v.list(Invoice, {}, req.query);
  result.data = await Invoice.populate(result.data, { path: "bookingId", select: "bookingReference guestName customerId checkInDate checkOutDate roomAmount serviceAmount totalAmount" });
  res.json(result);
}
async function detail(req, res) {
  const invoice = await Invoice.findById(v.id(req.params.id)).populate({ path: "bookingId", select: "bookingReference guestName guestPhone guestEmail checkInDate checkOutDate roomAmount serviceAmount feeAmount totalAmount services" }).lean();
  if (!invoice) throw new v.HttpError(404, "Invoice not found.");
  res.json({ data: invoice });
}
async function customerDetail(req, res) {
  const invoice = await Invoice.findOne({ bookingId: v.id(req.params.bookingId) })
    .populate({ path: "bookingId", select: "customerId bookingReference guestName guestPhone checkInDate checkOutDate roomAmount serviceAmount feeAmount totalAmount services" }).lean();
  if (!invoice || String(invoice.bookingId?.customerId) !== String(req.user._id)) throw new v.HttpError(404, "Invoice not found.");
  res.json({ data: invoice });
}
module.exports = { listing, detail, customerDetail };
