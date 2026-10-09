require("dotenv").config({
  path: require("node:path").resolve(__dirname, "../.env"),
});
const { randomBytes } = require("node:crypto");
const mongoose = require("mongoose");
const { createApp } = require("./app");
const connectDatabase = require("./config/database");
const { seedRoles } = require("./services/roles");
async function start() {
  const production = process.env.NODE_ENV === "production";
  if (production && !process.env.CLIENT_ORIGIN)
    throw new Error("CLIENT_ORIGIN is required in production.");
  await connectDatabase();
  await seedRoles();
  const { app, store } = createApp({
    mongoUri: process.env.MONGO_URI,
    sessionSecret:
      process.env.SESSION_SECRET ||
      (production ? "" : randomBytes(32).toString("hex")),
    clientOrigin: process.env.CLIENT_ORIGIN,
    production,
  });
  const server = app.listen(process.env.PORT || 3001, () =>
    console.log("Hotel API listening on port", process.env.PORT || 3001),
  );
  const stop = () =>
    server.close(async () => {
      await store.close();
      await mongoose.disconnect();
      process.exit(0);
    });
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}
start().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
