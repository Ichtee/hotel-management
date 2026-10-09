const mongoose = require("mongoose");
const { seedRoles } = require("../src/services/roles");
const { hashPassword } = require("../src/utils/password");
const User = require("../src/models/User");
const Hotel = require("../src/models/Hotel");
const RoomType = require("../src/models/RoomType");
const Booking = require("../src/models/Booking");
const Payment = require("../src/models/Payment");
const Refund = require("../src/models/Refund");
const Coupon = require("../src/models/Coupon");
async function seedDemo() {
  if (mongoose.connection.name !== "hotel_member1_demo")
    throw new Error("Demo seed is restricted to hotel_member1_demo.");
  await seedRoles();
  const hotel = await Hotel.create({
    name: "The Linden House",
    city: "Hanoi",
    address: "24 Old Quarter, Hanoi",
    starRating: 4,
  });
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
      role,
      email: `${username}@demo.hotel`,
      passwordHash,
      phone: "0912345678",
      customerProfile: { fullName, address: "Hanoi" },
      employeeProfile: ["manager", "receptionist", "housekeeping"].includes(
        role,
      )
        ? {
            hotelId: hotel._id,
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
    hotelId: hotel.id,
    name: "Courtyard Suite",
    basePrice: 2400000,
    maxOccupancy: 2,
  });
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
      hotelId: hotel.id,
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
  const startDate = new Date(+monthStart - 86400000);
  const endDate = new Date(+monthStart + 90 * 86400000);
  await Coupon.create([
    {
      hotelId: hotel.id,
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
      hotelId: hotel.id,
      code: "WEEKEND200",
      discountType: "fixed_amount",
      discountValue: 200000,
      minimumSpend: 2000000,
      usageLimit: 50,
      startDate,
      endDate,
      isActive: true,
    },
    {
      hotelId: hotel.id,
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
