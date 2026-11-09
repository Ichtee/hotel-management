const Role = require("../models/Role");
const User = require("../models/User");
const RoomType = require("../models/RoomType");
const Room = require("../models/Room");
const { hashPassword } = require("../utils/password");
const { staffPermissionCatalog, defaultStaffPermissions } = require("./staffPermissions");

const catalog = [
  { key: "users.manage", name: "Manage user accounts", scope: "system" },
  {
    key: "roles.manage",
    name: "Manage roles and permissions",
    scope: "system",
  },
  { key: "staff.manage", name: "Manage hotel staff", scope: "hotel" },
  { key: "promotions.manage", name: "Manage promotions", scope: "hotel" },
  { key: "revenue.read", name: "View revenue reports", scope: "hotel" },
  { key: "policies.manage", name: "Manage deposit policy", scope: "hotel" },
  ...staffPermissionCatalog,
];

const defaults = [
  {
    key: "admin",
    name: "Administrator",
    scope: "system",
    permissions: ["users.manage", "roles.manage"],
  },
  {
    key: "manager",
    name: "Hotel manager",
    scope: "hotel",
    permissions: [
      "staff.manage",
      "promotions.manage",
      "revenue.read",
      "policies.manage",
    ],
  },
  {
    key: "receptionist",
    name: "Receptionist",
    scope: "hotel",
    permissions: defaultStaffPermissions("receptionist"),
  },
  {
    key: "housekeeping",
    name: "Housekeeping",
    scope: "hotel",
    permissions: defaultStaffPermissions("housekeeping"),
  },
  { key: "customer", name: "Customer", scope: "self", permissions: [] },
];

// Tạo vai trò còn thiếu, giữ nguyên quyền đã được cấu hình.
async function seedRoles() {
  for (const role of defaults) {
    await Role.updateOne(
      { key: role.key },
      { $setOnInsert: { ...role, isSystem: true, isActive: true } },
      { upsert: true },
    );
  }
  await seedDefaultUsers();
  await seedDefaultRooms();
}

async function seedDefaultUsers() {
  try {
    // Xóa các tài khoản test theo yêu cầu người dùng
    const cleanup = await User.deleteMany({
      email: { $in: ['quangson2112004@gmail.com', 'sondnqhe180515@fpt.edu.vn'] }
    });
    if (cleanup.deletedCount > 0) {
      console.log(`[Database Cleanup] Deleted ${cleanup.deletedCount} requested test account(s).`);
    }

    const passwordHash = await hashPassword("HotelDemo123!");
    const accounts = [
      { username: "admin", roleKey: "admin", fullName: "Admin User", email: "admin@demo.hotel" },
      { username: "manager", roleKey: "manager", fullName: "Hotel Manager", email: "manager@demo.hotel" },
      { username: "customer", roleKey: "customer", fullName: "Customer Demo", email: "customer@demo.hotel" },
      { username: "reception", roleKey: "receptionist", fullName: "Front Desk Receptionist", email: "reception@demo.hotel" },
      { username: "housekeeping", roleKey: "housekeeping", fullName: "Housekeeping Staff", email: "housekeeping@demo.hotel" },
    ];

    for (const acc of accounts) {
      const role = await Role.findOne({ key: acc.roleKey });
      if (!role) continue;

      let user = await User.findOne({ email: acc.email });
      if (user) {
        // Reset password and ensure account is active and unlocked
        user.passwordHash = passwordHash;
        user.status = "active";
        user.roleId = role._id;
        user.failedLogins = 0;
        user.lockedUntil = undefined;
        await user.save();
      } else {
        // Avoid duplicate username if another user has the same username
        let uname = acc.username;
        const dupName = await User.findOne({ username: uname });
        if (dupName) uname = `demo_${acc.username}`;

        await User.create({
          username: uname,
          roleId: role._id,
          email: acc.email,
          passwordHash,
          phone: "0912345678",
          status: "active",
          failedLogins: 0,
          customerProfile: { fullName: acc.fullName, address: "Hanoi" },
          employeeProfile: ["manager", "receptionist", "housekeeping"].includes(acc.roleKey)
            ? {
                position: acc.roleKey === "manager" ? "Hotel manager" : acc.roleKey === "receptionist" ? "Front desk associate" : "Room attendant",
                shift: "Morning",
                hireDate: new Date("2026-01-05"),
              }
            : undefined,
        });
      }
    }
    console.log("Demo accounts verified & ready with password: HotelDemo123!");
  } catch (err) {
    console.error("seedDefaultUsers error:", err.message);
  }
}

async function seedDefaultRooms() {
  let types = await RoomType.find();
  if (types.length === 0) {
    types = await RoomType.create([
      { name: "Deluxe Double", basePrice: 2100000, maxOccupancy: 2, bedType: "King bed", roomSizeSqm: 35, amenities: ["WiFi", "Air conditioning", "Smart TV", "Mini bar", "Bathtub"], images: ["https://images.unsplash.com/photo-1590490360182-c33d57733427?auto=format&fit=crop&w=900&q=80"] },
      { name: "Superior Twin", basePrice: 1750000, maxOccupancy: 2, bedType: "2 Single beds", roomSizeSqm: 30, amenities: ["WiFi", "Air conditioning", "Smart TV"], images: ["https://images.unsplash.com/photo-1566665797739-1674de7a421a?auto=format&fit=crop&w=900&q=80"] },
      { name: "Family Suite", basePrice: 3600000, maxOccupancy: 4, bedType: "2 Queen beds", roomSizeSqm: 60, amenities: ["WiFi", "Air conditioning", "Smart TV", "Living room", "Balcony"], images: ["https://images.unsplash.com/photo-1582719478250-c89cae4dc85b?auto=format&fit=crop&w=900&q=80"] },
      { name: "Presidential Suite", basePrice: 7600000, maxOccupancy: 3, bedType: "Super King bed", roomSizeSqm: 100, amenities: ["WiFi", "Air conditioning", "Smart TV", "Jacuzzi", "Private bar", "Panoramic view"], images: ["https://images.unsplash.com/photo-1631049307264-da0ec9d70304?auto=format&fit=crop&w=900&q=80"] },
    ]);
  }
  for (let i = 0; i < types.length; i++) {
    const t = types[i];
    const roomExists = await Room.findOne({ roomTypeId: t._id });
    if (!roomExists) {
      await Room.create({ roomTypeId: t._id, roomNumber: `R${i + 101}`, floor: 1, status: "available" });
    }
  }
}

module.exports = { catalog, defaults, seedRoles };
