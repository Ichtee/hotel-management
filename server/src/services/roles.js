const Role = require("../models/Role");
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
    permissions: ["staff.manage", "promotions.manage", "revenue.read"],
  },
  {
    key: "receptionist",
    name: "Receptionist",
    scope: "hotel",
    permissions: [],
  },
  {
    key: "housekeeping",
    name: "Housekeeping",
    scope: "hotel",
    permissions: [],
  },
  { key: "customer", name: "Customer", scope: "self", permissions: [] },
];
async function seedRoles() {
  // Never overwrite administrator changes during startup.
  for (const role of defaults)
    await Role.updateOne(
      { key: role.key },
      { $setOnInsert: { ...role, isSystem: true, isActive: true } },
      { upsert: true },
    );
}
module.exports = { catalog, defaults, seedRoles };
