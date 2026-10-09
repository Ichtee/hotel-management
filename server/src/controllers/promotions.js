const Coupon = require("../models/Coupon");
const CouponUsage = require("../models/CouponUsage");
const v = require("../utils/validation");
function validate(body, coupon) {
  v.keys(body, [
    "code",
    "discountType",
    "discountValue",
    "usageLimit",
    "minimumSpend",
    "startDate",
    "endDate",
    "isActive",
  ]);
  const creating = !coupon;
  const data = {};
  if (creating || body.code !== undefined) {
    data.code = v.text(body.code, "code", 2, 30).toUpperCase();
    if (!/^[A-Z0-9]+$/.test(data.code))
      v.fail("Coupon code must be alphanumeric.", "code");
  }
  if (creating || body.discountType !== undefined)
    data.discountType = v.choice(body.discountType, "discountType", [
      "percentage",
      "fixed_amount",
    ]);
  if (creating || body.discountValue !== undefined)
    data.discountValue = v.number(body.discountValue, "discountValue", 1);
  if (creating || body.usageLimit !== undefined)
    data.usageLimit = v.number(body.usageLimit, "usageLimit", 1);
  if (creating || body.minimumSpend !== undefined)
    data.minimumSpend = v.number(body.minimumSpend ?? 0, "minimumSpend");
  for (const key of ["startDate", "endDate"])
    if (creating || body[key] !== undefined)
      data[key] = new Date(`${v.date(body[key], key)}T00:00:00+07:00`);
  if (body.isActive !== undefined)
    data.isActive = v.boolean(body.isActive, "isActive");
  const merged = { ...(coupon?.toObject() || {}), ...data };
  if (merged.discountType === "percentage" && merged.discountValue > 100)
    v.fail("Percentage cannot exceed 100.", "discountValue");
  if (merged.endDate <= merged.startDate)
    v.fail("End date must be after start date (exclusive).", "endDate");
  if (merged.usageLimit < merged.usageCount)
    v.fail("Usage limit cannot be below existing redemptions.", "usageLimit");
  return data;
}
async function listing(req, res) {
  const filter = { hotelId: req.hotelId, code: v.search(req.query) };
  if (req.query.status)
    filter.isActive =
      v.choice(req.query.status, "status", ["active", "inactive"]) === "active";
  res.json(await v.list(Coupon, filter, req.query));
}
async function create(req, res) {
  const data = validate(req.body);
  const coupon = await Coupon.create({ ...data, hotelId: req.hotelId });
  res.status(201).json({ data: coupon });
}
async function find(req) {
  const coupon = await Coupon.findOne({
    _id: v.id(req.params.id),
    hotelId: req.hotelId,
  });
  if (!coupon) throw new v.HttpError(404, "Promotion not found.");
  return coupon;
}
async function update(req, res) {
  const coupon = await find(req);
  const data = validate(req.body, coupon);
  if (
    data.code &&
    data.code !== coupon.code &&
    (coupon.usageCount > 0 ||
      (await CouponUsage.exists({ couponId: coupon.id })))
  )
    throw new v.HttpError(409, "A used coupon code cannot be changed.");
  Object.assign(coupon, data);
  await coupon.save();
  res.json({ data: coupon });
}
async function remove(req, res) {
  const coupon = await find(req);
  if (
    coupon.usageCount > 0 ||
    (await CouponUsage.exists({ couponId: coupon.id }))
  )
    throw new v.HttpError(
      409,
      "This coupon has been used. Deactivate it to preserve booking history.",
    );
  await coupon.deleteOne();
  res.json({ data: { message: "Promotion deleted." } });
}
module.exports = { listing, create, update, remove };
