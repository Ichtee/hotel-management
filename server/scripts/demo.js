const { MongoMemoryServer } = require("mongodb-memory-server");
const mongoose = require("mongoose");
const { randomBytes } = require("node:crypto");
const { createApp } = require("../src/app");
const { seedDemo } = require("./seedDemo");
async function main() {
  if (process.env.NODE_ENV === "production")
    throw new Error("Demo mode must not run in production.");
  const db = await MongoMemoryServer.create({
    instance: { dbName: "hotel_member1_demo" },
  });
  const mongoUri = db.getUri("hotel_member1_demo");
  await mongoose.connect(mongoUri);
  await seedDemo();
  const { app, store } = createApp({
    mongoUri,
    sessionSecret: randomBytes(32).toString("hex"),
    clientOrigin: "http://localhost:5173",
  });
  const server = app.listen(3001, "127.0.0.1", () =>
    console.log(
      "Local demo API: http://localhost:3001. Sample data only; resets on restart. Accounts: admin@demo.hotel, manager@demo.hotel, customer@demo.hotel. Password: HotelDemo123!",
    ),
  );
  const stop = () =>
    server.close(async () => {
      await store.close();
      await mongoose.disconnect();
      await db.stop();
      process.exit(0);
    });
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
