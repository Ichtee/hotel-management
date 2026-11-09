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
const HotelInfo = require("../src/models/HotelInfo");
const Invoice = require("../src/models/Invoice");
const Review = require("../src/models/Review");
const Service = require("../src/models/Service");
const HousekeepingAssignment = require("../src/models/HousekeepingAssignment");
const { createCleaningTask } = require("../src/services/housekeepingTasks");
const CompensationItem = require("../src/models/CompensationItem");
async function seedDemo({ anyDatabase = false } = {}) {
  if (!anyDatabase && mongoose.connection.name !== "hotel_member1_demo")
    throw new Error("Demo seed is restricted to hotel_member1_demo.");
  await seedRoles();
  // UC34 catalogs the front desk picks from (UC19 services, UC38 compensation items).
  await Service.insertMany([["Airport transfer", "Transport", 450000], ["Breakfast buffet", "Food & drink", 250000], ["Spa massage 60 min", "Wellness", 800000], ["Laundry (per bag)", "Housekeeping", 120000], ["Minibar refill", "Food & drink", 180000]]
    .map(([name, category, unitPrice]) => ({ name, category, unitPrice })));
  await CompensationItem.insertMany([["Bath towel", 150000], ["Bathrobe", 400000], ["Slippers", 50000], ["Key card", 100000], ["TV remote", 300000], ["Drinking glass", 80000], ["Hair dryer", 500000], ["Bed linen", 600000]]
    .map(([name, price]) => ({ name, price })));
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
      isVerified: true,
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
  const photo = (id) => `https://images.unsplash.com/${id}?auto=format&fit=crop&w=1200&q=70`;
  const roomType = await RoomType.create({
    name: "Courtyard Suite", basePrice: 2400000, maxOccupancy: 2, bedType: "King bed", roomSizeSqm: 40,
    description: "A quiet suite facing the inner garden, with a sofa corner and a rain shower.",
    amenities: ["Free WiFi", "Garden view", "Air conditioning", "Rain shower"], images: [photo("photo-1611892440504-42a792e24d32")],
  });
  // Customer-facing room cards use these room types; their presence also makes
  // the online Create Booking flow usable immediately in the demo database.
  const customerRoomTypes = await RoomType.create([
    { name: "Deluxe Double", basePrice: 2100000, maxOccupancy: 2, bedType: "King bed", roomSizeSqm: 32, images: [photo("photo-1631049307264-da0ec9d70304")], amenities: ["Free WiFi", "Breakfast included", "Air conditioning", "Smart TV"], description: "A calm, light-filled room with a king bed and a work desk, ideal for couples and business travellers." },
    { name: "Superior Twin", basePrice: 1750000, maxOccupancy: 2, bedType: "2 single beds", roomSizeSqm: 28, images: [photo("photo-1590490360182-c33d57733427")], amenities: ["Free WiFi", "City view", "Air conditioning"], description: "Two comfortable single beds with a city view. A smart pick for friends or colleagues." },
    { name: "Family Suite", basePrice: 3600000, maxOccupancy: 4, bedType: "2 queen beds", roomSizeSqm: 55, images: [photo("photo-1578683010236-d716f9a3f461")], amenities: ["Free WiFi", "Breakfast included", "Kitchenette", "Balcony"], description: "Space for the whole family with two queen beds, a lounge area and a private balcony." },
    { name: "Presidential Suite", basePrice: 7600000, maxOccupancy: 3, bedType: "King bed", roomSizeSqm: 90, images: [photo("photo-1582719478250-c89cae4dc85b")], amenities: ["Free WiFi", "Breakfast included", "Jacuzzi", "Ocean view"], description: "Our finest room: panoramic ocean view, jacuzzi and a separate living room." },
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
      guestName: "Jamie Nguyen",
      bookingReference: `BK26${String(i + 1).padStart(4, "0")}`,
    });
    await Invoice.create({ bookingId: booking.id, invoiceNumber: `INV-2611-${String(i + 1).padStart(3, "0")}`, issuedBy: users.receptionist.id, subtotal: amount, tax: 0, totalAmount: amount, status: "paid", issuedAt: new Date(+date + 86400000) });
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
  await seedOperations({ users, roomTypes: [roomType, ...customerRoomTypes], day });
  const startDate = new Date(+monthStart - 86400000);
  const endDate = new Date(+monthStart + 90 * 86400000);
  await HotelInfo.create({ name: "GrandStay", city: "Da Nang", address: "Vo Nguyen Giap, Son Tra, Da Nang, Vietnam", phone: "+842360000000", email: "hello@grandstay.example", description: "A seaside retreat in Da Nang, Vietnam.", starRating: 5 });
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

// A small hotel in operation today: 3 floors of rooms, guests arriving, staying and leaving today,
// a cancellation waiting for review and a few published reviews, so every staff screen has something to show.
async function seedOperations({ users, roomTypes, day }) {
  const vnToday = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Ho_Chi_Minh" }).format(new Date());
  const at = (offset, time) => new Date(+new Date(`${vnToday}T${time}:00+07:00`) + offset * day);
  const rooms = [];
  for (const floor of [2, 3, 4])
    for (let k = 1; k <= 5; k++) {
      const type = roomTypes[(floor + k) % roomTypes.length];
      rooms.push(await Room.create({ roomTypeId: type._id, roomNumber: `${floor}0${k}`, floor, status: "available" }));
    }
  const guests = [
    ["Nguyen Van An", "0901234561"], ["Tran Thi Binh", "0901234562"], ["Le Minh Chau", "0901234563"], ["Pham Quoc Dung", "0901234564"],
    ["Hoang Thu Ha", "0901234565"], ["Vu Duc Khanh", "0901234566"], ["Do Thanh Lam", "0901234567"], ["Bui Ngoc Mai", "0901234568"],
  ];
  let ref = 100;
  const stay = async ([guestName, guestPhone], room, inOffset, nights, status) => {
    const type = roomTypes.find((t) => String(t._id) === String(room.roomTypeId));
    const amount = type.basePrice * nights;
    const booking = await Booking.create({
      bookingReference: `BK2611${ref++}`, createdBy: users.receptionist.id, guestName, guestPhone, bookingSource: "front_desk",
      checkInDate: at(inOffset, "14:00"), checkOutDate: at(inOffset + nights, "12:00"),
      rooms: [{ roomTypeId: type._id, roomId: status === "checked_in" ? room._id : undefined, priceAtBooking: type.basePrice }],
      roomAmount: amount, totalAmount: amount, depositRequired: Math.round(amount * 0.3), status,
      ...(status === "checked_in" ? { actualCheckInAt: at(inOffset, "14:30"), checkedInBy: users.receptionist.id } : {}),
    });
    await Payment.create({ bookingId: booking.id, kind: "deposit", amount: booking.depositRequired, method: "bank_transfer", status: "success", paidAt: at(inOffset - 3, "10:00") });
    if (status === "checked_in") await Room.updateOne({ _id: room._id }, { status: "occupied" });
    return booking;
  };
  // In-house: two leave today, two stay on
  await stay(guests[0], rooms[0], -2, 2, "checked_in");
  await stay(guests[1], rooms[1], -1, 1, "checked_in");
  await stay(guests[2], rooms[5], -1, 3, "checked_in");
  await stay(guests[3], rooms[10], 0, 2, "checked_in");
  // Arriving today, and later this week
  await stay(guests[4], rooms[2], 0, 2, "confirmed");
  await stay(guests[5], rooms[6], 0, 1, "confirmed");
  await stay(guests[6], rooms[11], 0, 3, "confirmed");
  await stay(guests[7], rooms[3], 3, 2, "confirmed");
  await Room.updateMany({ _id: { $in: [rooms[7]._id, rooms[12]._id] } }, { status: "cleaning" });
  await Room.updateOne({ _id: rooms[14]._id }, { status: "maintenance" });
  // UC36: Linh Pham covers floors 2-4 on every shift, so turnover tasks (UC30) reach her task list.
  for (const shift of ["morning", "afternoon", "night"])
    await HousekeepingAssignment.create({ staffId: users.housekeeping._id, shift, floors: [2, 3, 4], effectiveFrom: at(-30, "00:00"), effectiveTo: at(365, "00:00"), assignedBy: users.manager._id });
  for (const room of [rooms[7], rooms[12]]) await createCleaningTask({ roomId: String(room._id), type: "turnover" });
  // A customer cancellation waiting for the Receptionist (UC35)
  const pending = await stay(["Jamie Nguyen", "0912345678"], rooms[8], 5, 2, "confirmed");
  await Booking.updateOne({ _id: pending._id }, {
    customerId: users.customer._id, status: "cancellation_requested",
    cancellation: { requestedAt: new Date(), requestedBy: users.customer._id, channel: "online", verifyMethod: "login", reason: "Change of travel plans", refundableAmount: pending.depositRequired },
  });
  // Published reviews for the room-type pages (one review per stayed booking)
  const past = await Booking.find({ status: "checked_out" }).limit(3);
  const words = [[5, "Spotless room and very friendly front desk."], [4, "Quiet, comfortable and close to the beach."], [5, "Breakfast was great, will stay again."]];
  for (const [i, b] of past.entries())
    await Review.create({ customerId: users.customer._id, bookingId: b._id, roomTypeId: roomTypes[i + 1]._id, rating: words[i][0], comment: words[i][1], status: "visible" });
}
module.exports = { seedDemo };
