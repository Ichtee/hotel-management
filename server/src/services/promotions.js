const Coupon = require("../models/Coupon");
const CouponUsage = require("../models/CouponUsage");
const v = require("../utils/validation");

// BR-09 with the SRS messages: validity period (MSG-59, MSG-26), minimum spend on the room charge (MSG-28).
function checkPeriodAndSpend(coupon, subtotal, now) {
  if (coupon.startDate && now < coupon.startDate) v.fail("This coupon is not valid yet.", "couponCode"); // MSG-59
  if (coupon.endDate && now >= coupon.endDate) v.fail("Coupon expired.", "couponCode"); // MSG-26
  if (subtotal < coupon.minimumSpend)
    v.fail("The booking amount does not meet the minimum spend required for this coupon.", "couponCode"); // MSG-28
  // A fixed amount is in whole VND and never exceeds the room charge (BR-09).
  if (coupon.discountType === "fixed") return Math.min(subtotal, coupon.discountValue);
  return Math.min(subtotal, Math.floor((subtotal * coupon.discountValue) / 100));
}

// `customerId` is missing for a walk-in guest without an account (UC14): the once-per-customer check is then skipped.
async function validateCoupon({ code, customerId, subtotal, now = new Date() }) {
  if (customerId) v.id(String(customerId), "customerId");
  v.number(subtotal, "subtotal", 1);
  const coupon = await Coupon.findOne({ code: v.text(code, "code", 2, 30).toUpperCase() });
  if (!coupon || !coupon.isActive) v.fail("Coupon code is invalid.", "couponCode"); // MSG-29
  if (coupon.usageCount >= coupon.usageLimit) v.fail("Reached limit. This coupon can no longer be used.", "couponCode"); // MSG-27
  const discountAmount = checkPeriodAndSpend(coupon, subtotal, now);
  if (customerId && (await CouponUsage.exists({ couponId: coupon._id, customerId }))) v.fail("You have already used this coupon.", "couponCode");
  return { couponId: coupon.id, code: coupon.code, discountAmount };
}

// UC07 3c / UC15 / UC18 (BR-09, BR-46): the coupon of a booking checked again for its new amount and dates.
// The booking already counts as one use, so the usage limit is not checked again.
async function recheckCoupon({ code, subtotal, now = new Date() }) {
  const coupon = await Coupon.findOne({ code });
  if (!coupon || !coupon.isActive) v.fail("Coupon code is invalid.", "couponCode"); // MSG-29
  return checkPeriodAndSpend(coupon, subtotal, now);
}
module.exports = { validateCoupon, recheckCoupon };
