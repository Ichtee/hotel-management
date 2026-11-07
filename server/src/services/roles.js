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
  const passwordHash = await hashPassword("HotelDemo123!");
  const accounts = [
    ["admin", "admin", "Duc Anh"],
    ["manager", "manager", "Alex Morgan"],
    ["customer", "customer", "Jamie Nguyen"],
    ["reception", "receptionist", "Minh Tran"],
    ["housekeeping", "housekeeping", "Linh Pham"],
  ];

  for (const [username, roleKey, fullName] of accounts) {
    const email = `${username}@demo.hotel`;
    const exists = await User.findOne({ email });
    if (!exists) {
      const role = await Role.findOne({ key: roleKey });
      if (role) {
        await User.create({
          username,
          roleId: role._id,
          email,
          passwordHash,
          phone: "0912345678",
          status: "active",
          customerProfile: { fullName, address: "Hanoi" },
          employeeProfile: ["manager", "receptionist", "housekeeping"].includes(roleKey)
            ? {
                position: roleKey === "manager" ? "Hotel manager" : roleKey === "receptionist" ? "Front desk associate" : "Room attendant",
                shift: "Morning",
                hireDate: "2026-01-05",
              }
            : undefined,
        });
      }
    }
  }
}

async function seedDefaultRooms() {
  const count = await RoomType.countDocuments();
  if (count === 0) {
    const types = await RoomType.create([
      { name: "Deluxe Double", basePrice: 2100000, maxOccupancy: 2, bedType: "King bed", roomSizeSqm: 35, amenities: ["WiFi", "Air conditioning", "Smart TV", "Mini bar", "Bathtub"], images: ["https://images.unsplash.com/photo-1590490360182-c33d57733427?auto=format&fit=crop&w=900&q=80"] },
      { name: "Superior Twin", basePrice: 1750000, maxOccupancy: 2, bedType: "2 Single beds", roomSizeSqm: 30, amenities: ["WiFi", "Air conditioning", "Smart TV"], images: ["https://images.unsplash.com/photo-1566665797739-1674de7a421a?auto=format&fit=crop&w=900&q=80"] },
      { name: "Family Suite", basePrice: 3600000, maxOccupancy: 4, bedType: "2 Queen beds", roomSizeSqm: 60, amenities: ["WiFi", "Air conditioning", "Smart TV", "Living room", "Balcony"], images: ["https://images.unsplash.com/photo-1582719478250-c89cae4dc85b?auto=format&fit=crop&w=900&q=80"] },
      { name: "Presidential Suite", basePrice: 7600000, maxOccupancy: 3, bedType: "Super King bed", roomSizeSqm: 100, amenities: ["WiFi", "Air conditioning", "Smart TV", "Jacuzzi", "Private bar", "Panoramic view"], images: ["https://images.unsplash.com/photo-1631049307264-da0ec9d70304?auto=format&fit=crop&w=900&q=80"] },
    ]);
    await Room.create(types.map((type, index) => ({ roomTypeId: type._id, roomNumber: `D${index + 101}`, floor: 1, status: "available" })));
  }
}

module.exports = { catalog, defaults, seedRoles };
