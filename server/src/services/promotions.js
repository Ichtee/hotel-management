const Coupon = require("../models/Coupon");
const CouponUsage = require("../models/CouponUsage");
const v = require("../utils/validation");
async function validateCoupon({
  code,
  hotelId,
  customerId,
  subtotal,
  now = new Date(),
}) {
  v.id(String(hotelId), "hotelId");
  v.id(String(customerId), "customerId");
  v.number(subtotal, "subtotal", 1);
  const coupon = await Coupon.findOne({
    code: v.text(code, "code", 2, 30).toUpperCase(),
    hotelId,
  });
  if (!coupon || !coupon.isActive) v.fail("Coupon is unavailable.");
  if (coupon.startDate && now < coupon.startDate)
    v.fail("Coupon has not started.");
  if (coupon.endDate && now >= coupon.endDate) v.fail("Coupon expired.");
  if (coupon.usageCount >= coupon.usageLimit)
    v.fail("Coupon reached its usage limit.");
  if (subtotal < coupon.minimumSpend)
    v.fail("The booking does not meet the minimum spend.");
  if (await CouponUsage.exists({ couponId: coupon._id, customerId }))
    v.fail("You have already used this coupon.");
  const discountAmount = Math.min(
    subtotal,
    coupon.discountType === "percentage"
      ? Math.floor((subtotal * coupon.discountValue) / 100)
      : coupon.discountValue,
  );
  return { couponId: coupon.id, code: coupon.code, discountAmount };
}
module.exports = { validateCoupon };
