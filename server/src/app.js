const express = require("express");
const session = require("express-session");
const { MongoStore } = require("connect-mongo");
const { rateLimit } = require("express-rate-limit");
const helmet = require("helmet");
const { authenticate, permit, requireManager, requirePasswordChanged } = require("./middleware/auth");
const staff = require("./controllers/staff");
const staffRoles = require("./controllers/staffRoles");
const rooms = require("./controllers/rooms");
const roomTypes = require("./controllers/roomTypes");
const assignments = require("./controllers/housekeepingAssignments");
const auth = require("./controllers/auth");
const accounts = require("./controllers/accounts");
const roles = require("./controllers/roles");
const promotions = require("./controllers/promotions");
const bookings = require("./controllers/bookings");
const policies = require("./controllers/policies");
const { revenue } = require("./controllers/revenue");
const { HttpError } = require("./utils/validation");

// Member 2 Routes & Controllers
const roomTypeRoutes = require("./routes/roomTypeRoutes");
const roomRoutes = require("./routes/roomRoutes");
const housekeepingRoutes = require("./routes/housekeepingRoutes");
const bookingController = require("./controllers/bookingController");

// Front-desk routes (theanh)
const frontDeskRoutes = require("./routes/frontDeskBooking.routes");
const customerRoutes = require("./routes/customer.routes");

// Khởi tạo API với xác thực và kiểm soát quyền tại backend.
function createApp({
  mongoUri,
  sessionSecret,
  clientOrigin = "http://localhost:5173",
  production = false,
}) {
  if (!sessionSecret || sessionSecret.length < 32)
    throw new Error("SESSION_SECRET must contain at least 32 characters.");
  const app = express();
  app.disable("x-powered-by");
  if (production) app.set("trust proxy", 1);
  app.use(helmet());

  app.use((req, res, next) => {
    const origin = req.get("Origin");
    const allowed = !origin || origin === clientOrigin || origin.startsWith("http://localhost:") || origin.startsWith("http://127.0.0.1:");
    if (allowed) {
      res.set("Access-Control-Allow-Origin", origin || clientOrigin);
      res.set("Access-Control-Allow-Credentials", "true");
      res.vary("Origin");
    }
    if (req.method === "OPTIONS") {
      if (!allowed) return res.sendStatus(403);
      res.set("Access-Control-Allow-Methods", "GET,POST,PATCH,PUT,DELETE");
      res.set("Access-Control-Allow-Headers", "Content-Type,x-admin-secret,x-user-id");
      return res.sendStatus(204);
    }
    if (!["GET", "HEAD"].includes(req.method) && !allowed)
      throw new HttpError(403, "Request origin is not allowed.");
    next();
  });

  app.use(express.json({ limit: "32kb" }));

  const store = MongoStore.create({
    mongoUrl: mongoUri,
    collectionName: "sessions",
    ttl: 60 * 60 * 8,
  });

  app.use(
    session({
      name: "hotel.sid",
      secret: sessionSecret,
      store,
      resave: false,
      saveUninitialized: false,
      cookie: {
        httpOnly: true,
        sameSite: "lax",
        secure: production,
        maxAge: 8 * 60 * 60 * 1000,
      },
    }),
  );

  app.use("/api", (req, res, next) => {
    res.set("Cache-Control", "no-store");
    next();
  });

  app.get("/api/health", (req, res) => res.json({ data: { status: "ok" } }));

  // --- Public Member 2 Routes (Room Search, Types, Housekeeping) ---
  app.use("/api/room-types", roomTypeRoutes);
  app.use("/api/rooms", roomRoutes);
  app.use("/api/housekeeping", housekeepingRoutes);

  // --- Member 2 Booking Endpoints (UC07 Make Reservation & Cancellation) ---
  app.post("/api/bookings", (req, res, next) => {
    bookingController.create(req, res, next);
  });
  app.post("/api/bookings/:id/cancel", (req, res, next) => {
    bookingController.cancel(req, res, next);
  });
  app.get("/api/bookings/ref/:reference", (req, res, next) => {
    bookingController.getByReference(req, res, next);
  });
  app.get("/api/bookings/my", (req, res, next) => {
    bookingController.getMyBookings(req, res, next);
  });

  // --- Auth Rate Limiter & Public Auth Routes ---
  const authLimit = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 100,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    skipSuccessfulRequests: true,
    message: {
      error: { message: "Too many attempts. Try again in 15 minutes." },
    },
  });
  app.post("/api/auth/register", authLimit, auth.register);
  app.post("/api/auth/login", authLimit, auth.login);
  app.post("/api/auth/logout", auth.logout);
  app.get("/api/public/room-types/:id/reviews", roomTypes.reviews);
  app.post("/api/auth/forgot-password", authLimit, auth.forgotPassword);
  app.post("/api/auth/reset-password", authLimit, auth.resetPassword);

  // --- Authenticated Routes ---
  app.use("/api", authenticate);

  app.get("/api/auth/me", auth.profile);
  app.get("/api/profile", auth.profile);
  app.put("/api/profile/password", authLimit, auth.changePassword);
  app.use("/api", requirePasswordChanged);
  app.patch("/api/profile", auth.updateProfile);
  app.get("/api/options", accounts.options);
  app.get("/api/users", permit("users.manage"), accounts.listing(false));
  app.post("/api/users", permit("users.manage"), accounts.create(false));
  app.patch("/api/users/:id", permit("users.manage"), accounts.update(false));

  app.get("/api/roles", permit("roles.manage"), roles.list);
  app.post("/api/roles", permit("roles.manage"), roles.create);
  app.patch("/api/roles/:id", permit("roles.manage"), roles.update);
  app.delete("/api/roles/:id", permit("roles.manage"), roles.remove);
  app.use("/api/staff", requireManager);
  app.get("/api/staff/roles", staffRoles.listing);
  app.patch("/api/staff/roles/:id/permissions", staffRoles.updatePermissions);
  app.get("/api/staff", staff.listing);
  app.post("/api/staff", staff.create);
  app.get("/api/staff/:id", staff.detail);
  app.patch("/api/staff/:id", staff.update);
  app.delete("/api/staff/:id", staff.deactivate);
  app.use("/api/rooms", requireManager);
  app.get("/api/rooms", rooms.listing);
  app.post("/api/rooms", rooms.create);
  app.get("/api/rooms/:id", rooms.detail);
  app.patch("/api/rooms/:id", rooms.update);
  app.patch("/api/rooms/:id/maintenance", rooms.maintenance);
  app.get("/api/rooms/:id/issues", rooms.issues);
  app.patch("/api/room-issues/:id/resolve", requireManager, rooms.resolveIssue);
  app.use("/api/room-types", requireManager);
  app.get("/api/room-types", roomTypes.listing);
  app.post("/api/room-types", roomTypes.create);
  app.get("/api/room-types/:id", roomTypes.detail);
  app.patch("/api/room-types/:id", roomTypes.update);
  app.delete("/api/room-types/:id", roomTypes.remove);
  app.get("/api/room-types/:id/reviews", roomTypes.reviews);
  app.patch("/api/reviews/:id/visibility", requireManager, roomTypes.visibility);
  app.use("/api/housekeeping-assignments", requireManager);
  app.get("/api/housekeeping-assignments/options", assignments.options);
  app.get("/api/housekeeping-assignments", assignments.listing);
  app.post("/api/housekeeping-assignments", assignments.create);
  app.patch("/api/housekeeping-assignments/:id", assignments.update);
  app.delete("/api/housekeeping-assignments/:id", assignments.remove);
  app.use("/api/promotions", permit("promotions.manage"));
  app.get("/api/promotions", promotions.listing);
  app.post("/api/promotions", promotions.create);
  app.patch("/api/promotions/:id", promotions.update);
  app.delete("/api/promotions/:id", promotions.remove);

  // UC10 View Booking History (Session-authenticated)
  app.get("/api/bookings", bookings.listing);
  // UC11 View Booking Details
  app.get("/api/bookings/:id", bookings.detail);

  app.use("/api/policies/deposit", permit("policies.manage"));
  app.get("/api/policies/deposit", policies.listing);
  app.post("/api/policies/deposit", policies.create);

  app.use("/api/front-desk/customers", customerRoutes);
  app.use("/api/front-desk", frontDeskRoutes);

  app.get("/api/reports/revenue", permit("revenue.read"), revenue);

  app.use((req, res) =>
    res.status(404).json({ error: { message: "Endpoint not found." } }),
  );

  app.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    if (error.code === 11000)
      return res
        .status(409)
        .json({
          error: {
            message: error.keyPattern?.roomNumber ? "Room number already exists." : "This value is already in use.",
            ...(error.keyPattern?.roomNumber ? { code: "MSG-20" } : {}),
            fields: Object.fromEntries(
              Object.keys(error.keyPattern || {}).map((k) => [
                k,
                "Already in use.",
              ]),
            ),
          },
        });
    const status =
      error.status ||
      (["ValidationError", "CastError"].includes(error.name) ? 400 : 500);
    if (status >= 500) console.error(error);
    res
      .status(status)
      .json({
        error: {
          message:
            status >= 500
              ? "Something went wrong. Please try again."
              : error.message,
          fields: error.fields,
          ...(typeof error.code === "string" ? { code: error.code } : {}),
          ...(error.details && status < 500 ? { details: error.details } : {}),
        },
      });
  });

  return { app, store };
}

module.exports = { createApp };
