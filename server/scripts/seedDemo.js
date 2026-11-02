const mongoose = require("mongoose");
const { seedRoles } = require("../src/services/roles");
const { hashPassword } = require("../src/utils/password");
const User = require("../src/models/User");
const Role = require("../src/models/Role");
const RoomType = require("../src/models/RoomType");
const Room = require("../src/models/Room");
const Booking = require("../src/models/Booking");
const Payment = require("../src/models/Payment");
const Refund = require("../src/models/Refund");
const Coupon = require("../src/models/Coupon");
const HotelPolicy = require("../src/models/HotelPolicy");
async function seedDemo() {
  if (mongoose.connection.name !== "hotel_member1_demo")
    throw new Error("Demo seed is restricted to hotel_member1_demo.");
  await seedRoles();
  const passwordHash = await hashPassword("HotelDemo123!");
  const accounts = [
    ["admin", "admin", "Duc Anh"],
    ["manager", "manager", "Alex Morgan"],
    ["customer", "customer", "Jamie Nguyen"],
    ["reception", "receptionist", "Minh Tran"],
    ["housekeeping", "housekeeping", "Linh Pham"],
  ];
  const users = {};
  for (const [username, role, fullName] of accounts)
    users[role] = await User.create({
      username,
      roleId: (await Role.findOne({ key: role }))._id,
      email: `${username}@demo.hotel`,
      passwordHash,
      phone: "0912345678",
      customerProfile: { fullName, address: "Hanoi" },
      employeeProfile: ["manager", "receptionist", "housekeeping"].includes(
        role,
      )
        ? {
            position:
              role === "manager"
                ? "Hotel manager"
                : role === "receptionist"
                  ? "Front desk associate"
                  : "Room attendant",
            shift: "Morning",
            hireDate: "2026-01-05",
          }
        : undefined,
    });
  const roomType = await RoomType.create({
    name: "Courtyard Suite",
    basePrice: 2400000,
    maxOccupancy: 2,
  });
  // Customer-facing room cards use these room types; their presence also makes
  // the online Create Booking flow usable immediately in the demo database.
  const customerRoomTypes = await RoomType.create([
    { name: "Deluxe Double", basePrice: 2100000, maxOccupancy: 2 },
    { name: "Superior Twin", basePrice: 1750000, maxOccupancy: 2 },
    { name: "Family Suite", basePrice: 3600000, maxOccupancy: 4 },
    { name: "Presidential Suite", basePrice: 7600000, maxOccupancy: 3 },
  ]);
  await Room.create(customerRoomTypes.map((type, index) => ({ roomTypeId: type._id, roomNumber: `D${index + 101}`, floor: 1, status: "available" })));
  const now = new Date();
  const monthStart = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1),
  );
  for (let i = 0; i < 8; i++) {
    const date = new Date(monthStart.getTime() + i * 86400000 + 3600000);
    if (date > now) break;
    const amount = 1800000 + i * 300000;
    const booking = await Booking.create({
      customerId: users.customer.id,
      createdBy: users.receptionist.id,
      checkInDate: date,
      checkOutDate: new Date(+date + 86400000),
      rooms: [{ roomTypeId: roomType.id, priceAtBooking: amount }],
      roomAmount: amount,
      totalAmount: amount,
      status: "checked_out",
    });
    const payment = await Payment.create({
      bookingId: booking.id,
      kind: "final",
      amount,
      method: i % 2 ? "bank_transfer" : "cash",
      status: "success",
      paidAt: date,
    });
    if (i === 2)
      await Refund.create({
        bookingId: booking.id,
        paymentId: payment.id,
        amount: 300000,
        status: "completed",
        processedAt: date,
        reason: "Demo adjustment",
      });
  }
  // Customer-facing M3 samples: upcoming, awaiting deposit and cancelled-with-refund bookings.
  const day = 86400000;
  const sample = (offset, nights, amount, status, extra = {}) =>
    Booking.create({
      customerId: users.customer.id,
      createdBy: users.customer.id,
      checkInDate: new Date(+now + offset * day),
      checkOutDate: new Date(+now + (offset + nights) * day),
      rooms: [{ roomTypeId: roomType.id, priceAtBooking: amount / nights }],
      roomAmount: amount,
      totalAmount: amount,
      depositRequired: Math.round(amount * 0.3),
      status,
      ...extra,
    });
  const upcoming = await sample(14, 2, 4800000, "confirmed", { bookingReference: "BK2610A1" });
  const awaiting = await sample(30, 3, 7200000, "pending", { bookingReference: "BK2610B2", holdExpiresAt: new Date(+now + 15 * 60000) });
  const cancelled = await sample(7, 2, 3000000, "cancelled", { bookingReference: "BK2610C3", cancelledAt: now });
  await Payment.create([
    { bookingId: upcoming.id, kind: "deposit", amount: 1440000, method: "e_wallet", status: "success", paidAt: now },
  ]);
  // An approved cancellation waiting for the Receptionist to refund the deposit by bank transfer (UC21).
  const paidDeposit = await Payment.create({ bookingId: cancelled.id, kind: "deposit", amount: 900000, method: "e_wallet", status: "success", paidAt: new Date(+now - 2 * day) });
  await Booking.updateOne({ _id: cancelled._id }, { cancellationReason: "Cancelled by customer", cancellation: { requestedAt: now, requestedBy: users.customer._id, channel: "online", verifyMethod: "login", reason: "Cancelled by customer", refundableAmount: 900000, approvedAt: now, approvedBy: users.receptionist._id } });
  await Refund.create({ bookingId: cancelled.id, paymentId: paidDeposit.id, amount: 900000, status: "requested", requestedBy: users.customer._id, reason: "Approved cancellation" });
  await HotelPolicy.create({ kind: "deposit", name: "Deposit 30%", deposit: { type: "percentage", value: 30 }, effectiveFrom: new Date(+now - 30 * day) });
  await HotelPolicy.create({
    kind: "cancellation", name: "Cancellation policy", effectiveFrom: new Date(+now - 30 * day),
    cancellationTiers: [{ minHoursBeforeCheckIn: 48, refundPercent: 100 }, { minHoursBeforeCheckIn: 0, refundPercent: 0 }],
    checkInTime: "14:00", checkOutTime: "12:00", earlyCheckInFee: 200000, lateCheckOutFee: 300000,
  });
  const startDate = new Date(+monthStart - 86400000);
  const endDate = new Date(+monthStart + 90 * 86400000);
  await Coupon.create([
    {
      code: "DIRECT15",
      discountType: "percentage",
      discountValue: 15,
      minimumSpend: 1500000,
      usageLimit: 100,
      startDate,
      endDate,
      isActive: true,
    },
    {
      code: "WEEKEND5",
      discountType: "percentage",
      discountValue: 5,
      minimumSpend: 2000000,
      usageLimit: 50,
      startDate,
      endDate,
      isActive: true,
    },
    {
      code: "SUMMER10",
      discountType: "percentage",
      discountValue: 10,
      minimumSpend: 0,
      usageLimit: 200,
      startDate: "2025-06-01",
      endDate: "2025-09-01",
      isActive: false,
    },
  ]);
}
module.exports = { seedDemo };
