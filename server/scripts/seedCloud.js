require("dotenv").config({ path: require("node:path").resolve(__dirname, "../.env") });
const mongoose = require("mongoose");
const connectDatabase = require("../src/config/database");
const User = require("../src/models/User");
const { seedDemo } = require("./seedDemo");

// Nạp dữ liệu demo một lần vào database trống; cấu hình MONGO_URI rồi chạy npm run seed:cloud --prefix server.
async function main() {
  await connectDatabase();
  if (await User.exists({})) throw new Error(`Database "${mongoose.connection.name}" already has accounts; nothing was changed.`);
  await Promise.all(Object.values(mongoose.models).map((m) => m.init()));
  await seedDemo({ anyDatabase: true });
  console.log(`Seeded "${mongoose.connection.name}". Accounts: admin@, manager@, reception@, housekeeping@, customer@demo.hotel / HotelDemo123! (change them after the demo).`);
}
main().catch((e) => { console.error(e.message); process.exitCode = 1; }).finally(() => mongoose.disconnect());
