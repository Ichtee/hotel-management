const Booking = require("../models/Booking");
const { notify } = require("./notifications");
const { currentCancellationPolicy, DEFAULT_CHECK_IN } = require("./policies");

// Notification service (SRS 2.4.4 #6): the arrival reminder one day before check-in, sent once per booking.
async function arrivalReminders(now = new Date()) {
  // Tomorrow in Asia/Ho_Chi_Minh (UTC+7); booking dates are stored as UTC midnight of the stay date.
  const local = new Date(now.getTime() + 7 * 3600000);
  const tomorrow = new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() + 1));
  const due = await Booking.find({
    status: "confirmed",
    customerId: { $exists: true },
    reminderSentAt: { $exists: false },
    checkInDate: { $gte: tomorrow, $lt: new Date(tomorrow.getTime() + 864e5) },
  }).select("_id customerId bookingReference checkInDate");
  const time = (await currentCancellationPolicy(now))?.checkInTime || DEFAULT_CHECK_IN;
  let sent = 0;
  for (const b of due) {
    // Claim first, so two runs never send the same reminder twice.
    const claimed = await Booking.updateOne({ _id: b._id, reminderSentAt: { $exists: false } }, { $set: { reminderSentAt: now } });
    if (!claimed.modifiedCount) continue;
    await notify("arrival_reminder", b.customerId, { reference: b.bookingReference, date: b.checkInDate.toISOString().slice(0, 10), time }, { bookingId: b._id })
      .catch((e) => console.error("Notification failed:", e.message));
    sent++;
  }
  return { sent };
}
module.exports = { arrivalReminders };
