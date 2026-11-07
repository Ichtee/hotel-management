require("dotenv").config({
  path: require("node:path").resolve(__dirname, "../.env"),
});
const { MongoMemoryReplSet } = require("mongodb-memory-server");
const mongoose = require("mongoose");
const { randomBytes } = require("node:crypto");
const { createApp } = require("../src/app");
const { seedDemo } = require("./seedDemo");
const { startHousekeepingScheduler } = require("../src/services/housekeepingScheduler");
// Chạy replica set tạm để hỗ trợ giao dịch của API nhân viên.
async function main() {
  if (process.env.NODE_ENV === "production")
    throw new Error("Demo mode must not run in production.");
  // --persist keeps the data in server/data/mongo (port 27018, open it in Compass) and seeds only the first time.
  const persist = process.argv.includes("--persist");
  const dbPath = require("node:path").resolve(__dirname, "../data/mongo");
  if (persist) require("node:fs").mkdirSync(dbPath, { recursive: true });
  const db = await MongoMemoryReplSet.create({
    replSet: { count: 1, storageEngine: "wiredTiger", dbName: "hotel_member1_demo" },
    instanceOpts: persist ? [{ dbPath, port: 27018 }] : undefined,
  });
  const mongoUri = db.getUri("hotel_member1_demo");
  await mongoose.connect(mongoUri);
  if (!persist || !(await require("../src/models/User").exists({}))) await seedDemo();
  const { app, store } = createApp({
    mongoUri,
    sessionSecret: randomBytes(32).toString("hex"),
    clientOrigin: "http://localhost:5173",
  });
  const stopScheduler = startHousekeepingScheduler();
  const server = app.listen(3001, "127.0.0.1", () =>
    console.log(
      `Local API: http://localhost:3001. ${persist ? "Data kept in server/data/mongo (Compass: mongodb://127.0.0.1:27018/?directConnection=true)." : "Sample data only; resets on restart."} Accounts: admin@, manager@, reception@, housekeeping@, customer@demo.hotel. Password: HotelDemo123!`,
    ),
  );
  const stop = () =>
    server.close(async () => {
      await stopScheduler();
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
