const Booking = require("../models/Booking");
const Payment = require("../models/Payment");
const CouponUsage = require("../models/CouponUsage");
const Coupon = require("../models/Coupon");
const AuditLog = require("../models/AuditLog");
const { hotelTransaction } = require("./hotelOperations");
const { noShowAt } = require("./stayPricing");

// Xử lý cả mốc bị bỏ lỡ; chạy lại không đổi booking đã kết thúc.
async function runStayJobs(now = new Date()) {
  return hotelTransaction(async (session) => {
    const bookings = await Booking.find({
      $or: [
        { status: "confirmed", checkInDate: { $lt: now } },
        { status: "pending", holdExpiresAt: { $lte: now } },
        { "pendingChange.holdExpiresAt": { $lte: now } },
      ],
    }).session(session);
    let noShows = 0,
      expired = 0,
      changesExpired = 0;
    for (const b of bookings) {
      let changed = false;
      if (b.pendingChange?.holdExpiresAt <= now) {
        b.pendingChange = undefined;
        changed = true;
        changesExpired++;
      }
      if (b.status === "confirmed" && noShowAt(b) <= now) {
        b.status = "no_show";
        changed = true;
        noShows++;
      }
      if (b.status === "pending" && b.holdExpiresAt <= now) {
        const waiting = await Payment.exists({
          bookingId: b._id,
          status: "pending",
          gatewayOrderId: { $exists: true },
        }).session(session);
        if (!waiting || +b.holdExpiresAt + 900000 <= +now) {
          b.status = "expired";
          changed = true;
          expired++;
          const usage = await CouponUsage.findOneAndDelete(
            { bookingId: b._id },
            { session },
          );
          if (usage)
            await Coupon.updateOne(
              { _id: usage.couponId, usageCount: { $gt: 0 } },
              { $inc: { usageCount: -1 } },
              { session },
            );
        }
      }
      if (changed) {
        await b.save({ session });
        await AuditLog.create(
          [
            {
              action: "stay.job_processed",
              targetType: "Booking",
              targetId: b._id,
              detail: { status: b.status, at: now },
            },
          ],
          { session },
        );
      }
    }
    return { noShows, expired, changesExpired };
  });
}

module.exports = { runStayJobs };
