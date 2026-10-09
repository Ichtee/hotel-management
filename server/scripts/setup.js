require("dotenv").config({
  path: require("node:path").resolve(__dirname, "../.env"),
});
const mongoose = require("mongoose");
const connectDatabase = require("../src/config/database");
const User = require("../src/models/User");
const Hotel = require("../src/models/Hotel");
const { seedRoles } = require("../src/services/roles");
const { hashPassword } = require("../src/utils/password");
const v = require("../src/utils/validation");

// Explicit one-time setup for a persistent database; never runs at API startup.
async function bootstrap(env) {
  const username = v.username(env.ADMIN_USERNAME);
  const email = v.email(env.ADMIN_EMAIL);
  const fullName = v.text(env.ADMIN_NAME, "ADMIN_NAME", 2, 50);
  v.password(env.ADMIN_PASSWORD);
  const hotelName = env.HOTEL_NAME
    ? v.text(env.HOTEL_NAME, "HOTEL_NAME", 2, 100)
    : null;
  const city = env.HOTEL_CITY
    ? v.text(env.HOTEL_CITY, "HOTEL_CITY", 0, 100)
    : "";
  await User.init();
  if (await User.exists({ role: "admin" }))
    throw new Error(
      "An administrator already exists. Use Accounts to manage users.",
    );
  await seedRoles();
  const admin = await User.create({
    username,
    email,
    role: "admin",
    status: "active",
    passwordHash: await hashPassword(env.ADMIN_PASSWORD),
    customerProfile: { fullName },
  });
  if (hotelName)
    await Hotel.updateOne(
      { name: hotelName },
      { $setOnInsert: { name: hotelName, city } },
      { upsert: true },
    );
  return admin;
}
async function main() {
  try {
    await connectDatabase();
    await bootstrap(process.env);
    console.log(
      "Administrator created. Sign in using ADMIN_EMAIL. Remove ADMIN_PASSWORD from .env after setup.",
    );
  } finally {
    await mongoose.disconnect();
  }
}
if (require.main === module)
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
module.exports = { bootstrap };
