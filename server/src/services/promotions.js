const Coupon = require("../models/Coupon");
const CouponUsage = require("../models/CouponUsage");
const v = require("../utils/validation");

// Kiểm tra thời hạn mã giảm giá và mức tiền phòng tối thiểu.
function checkPeriodAndSpend(coupon, subtotal, now) {
  if (coupon.startDate && now < coupon.startDate) v.fail("This coupon is not valid yet.", "couponCode");
  if (coupon.endDate && now >= coupon.endDate) v.fail("Coupon expired.", "couponCode");
  if (subtotal < coupon.minimumSpend)
    v.fail("The booking amount does not meet the minimum spend required for this coupon.", "couponCode");
  // Giảm giá không vượt tiền phòng; phần trăm được làm tròn xuống đồng nguyên.
  if (coupon.discountType === "fixed") return Math.min(subtotal, coupon.discountValue);
  return Math.min(subtotal, Math.floor((subtotal * coupon.discountValue) / 100));
}

// Khách tại quầy không có tài khoản thì bỏ giới hạn một lượt cho mỗi khách.
async function validateCoupon({ code, customerId, subtotal, now = new Date() }) {
  if (customerId) v.id(String(customerId), "customerId");
  v.number(subtotal, "subtotal", 1);
  const coupon = await Coupon.findOne({ code: v.text(code, "code", 2, 30).toUpperCase() });
  if (!coupon || !coupon.isActive) v.fail("Coupon code is invalid.", "couponCode");
  if (coupon.usageCount >= coupon.usageLimit) v.fail("Reached limit. This coupon can no longer be used.", "couponCode");
  const discountAmount = checkPeriodAndSpend(coupon, subtotal, now);
  if (customerId && (await CouponUsage.exists({ couponId: coupon._id, customerId }))) v.fail("You have already used this coupon.", "couponCode");
  return { couponId: coupon.id, code: coupon.code, discountAmount };
}

// Kiểm tra lại mã theo giá và ngày mới; không đếm lại lượt dùng của chính booking đang sửa.
async function recheckCoupon({ code, subtotal, now = new Date() }) {
  const coupon = await Coupon.findOne({ code });
  if (!coupon || !coupon.isActive) v.fail("Coupon code is invalid.", "couponCode");
  return checkPeriodAndSpend(coupon, subtotal, now);
}
module.exports = { validateCoupon, recheckCoupon };
