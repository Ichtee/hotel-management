const express = require("express");
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
const customers = require("./controllers/customers");
const roles = require("./controllers/roles");
const promotions = require("./controllers/promotions");
const bookings = require("./controllers/bookings");
const stays = require("./controllers/stays");
const stayRoutes = require("./routes/stayRoutes");
const stayCatalog = require("./controllers/stayCatalog");
const stayInvoices = require("./controllers/stayInvoices");
const stayPenalties = require("./controllers/stayPenalties");
const stayHousekeeping = require("./controllers/stayHousekeeping");
const RoomType = require("./models/RoomType");
const policies = require("./controllers/policies");
const payments = require("./controllers/payments");
const cancellations = require("./controllers/cancellations");
const refunds = require("./controllers/refunds");
const jobs = require("./controllers/jobs");
const { revenue } = require("./controllers/revenue");
const { occupancy } = require("./controllers/occupancy");
const roomIssues = require("./controllers/roomIssues");
const stayRequests = require("./controllers/stayRequests");
const invoices = require("./controllers/invoices");
const reviews = require("./controllers/reviews");
const housekeepingTasks = require("./controllers/housekeepingTasks");
const { HttpError } = require("./utils/validation");

// Member 2 Routes & Controllers
const roomTypeController = require("./controllers/roomTypeController");
const notifications = require("./controllers/notifications");
const auditLogs = require("./controllers/auditLogs");
const bookingCreation = require("./controllers/bookingCreation");
const bookingController = require("./controllers/bookingController");

// Front-desk routes (theanh)
const customerRoutes = require("./routes/customer.routes");

// The gateway calls this server-to-server, so it has no browser Origin or session; its HMAC signature authenticates it.
const GATEWAY_CALLBACK = "/api/payments/gateway/callback";
const PUBLIC_HOOKS = [GATEWAY_CALLBACK, "/api/payments/sepay/ipn"];
// Khởi tạo API với xác thực và kiểm soát quyền tại backend.
function createApp({
  mongoUri,
  jwtSecret,
  clientOrigin = "http://localhost:5173",
  production = false,
}) {
  if (!jwtSecret || jwtSecret.length < 32)
    throw new Error("JWT_SECRET must contain at least 32 characters.");
  const app = express();
  app.disable("x-powered-by");
  if (production) app.set("trust proxy", Number(process.env.TRUST_PROXY) || 1); // 2 when Vercel proxies /api to Render
  app.use(helmet());

  app.use((req, res, next) => {
    const origin = req.get("Origin");
    const allowed = !origin || origin === clientOrigin || (!production && /^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origin));
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
    if (!["GET", "HEAD"].includes(req.method) && !allowed && !PUBLIC_HOOKS.includes(req.path))
      throw new HttpError(403, "Request origin is not allowed.");
    next();
  });

  app.use(express.json({ limit: "32kb" }));

  // SDS: stateless JWT authentication (middleware/auth.js); the secret signs the tokens.
  app.set("jwtSecret", jwtSecret);
  app.set("production", production);

  app.use("/api", (req, res, next) => {
    res.set("Cache-Control", "no-store");
    next();
  });

  app.get("/api/health", (req, res) => res.json({ data: { status: "ok" } }));

  app.get("/api/rooms/search", stays.search);
  app.get("/api/public/room-types/:id", async (req, res) => {
    const type = await RoomType.findOne({ _id: require("./utils/validation").id(req.params.id), isActive: true }).lean();
    if (!type) throw new HttpError(404, "Room type not found.");
    res.json({ data: type });
  });


  // Creation (UC06), cancel (UC08) and cancel-payment are session-authenticated and registered below (bookingCreation, cancellations).
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
  app.get("/api/public/room-types", async (req, res, next) => {
    try {
      const data = await RoomType.find({ isActive: true }).lean();
      res.json({ success: true, count: data.length, data });
    } catch (err) {
      next(err);
    }
  });
  app.post("/api/auth/forgot-password", authLimit, auth.forgotPassword);
  app.post("/api/auth/reset-password", authLimit, auth.resetPassword);
  app.post("/api/auth/verify-email", auth.verifyEmail);
  app.post("/api/auth/resend-verification", authLimit, auth.resendVerification);
  app.get("/api/auth/captcha-config", auth.captchaConfig);

  // --- Authenticated Routes ---
  app.post(GATEWAY_CALLBACK, payments.callback);
  app.post("/api/payments/sepay/ipn", payments.sepayIpn);
  app.get("/api/payments/return", payments.back);
  app.post("/api/jobs/:name", jobs.run);
  app.get("/api/hotel-info", policies.hotelInfo);
  app.get("/api/public/policies", policies.publicSummary);
  app.get("/api/public/promotions", promotions.publicListing);
  app.use("/api", authenticate);

  app.get("/api/auth/me", auth.profile);
  // UC13 View Notifications: each user reads only their own (BR-28).
  app.get("/api/notifications", notifications.listing);
  app.post("/api/notifications/read", notifications.markRead);
  app.get("/api/audit-logs", auditLogs.listing);
  app.get("/api/profile", auth.profile);
  app.put("/api/profile/password", authLimit, auth.changePassword);
  app.use("/api", requirePasswordChanged);
  app.get("/api/bookings/my", bookings.listing);
  app.get("/api/bookings/ref/:reference", bookings.byReference);
  app.get("/api/bookings/:id/invoices", stayInvoices.list);
  app.use("/api/front-desk", stayRoutes);
  app.use("/api/frontdesk", stayRoutes);
  app.get("/api/catalog/:kind", (req, res, next) => {
    if (!["services", "compensation-items"].includes(req.params.kind)) throw new HttpError(404, "Catalog not found.");
    if (req.role.key !== "manager" && !req.role.permissions.some((p) => ["booking_services.record", "penalties.record", "damages.report"].includes(p))) throw new HttpError(403, "You cannot view this catalog.");
    next();
  }, stayCatalog.list);
  app.post("/api/catalog/:kind", requireManager, stayCatalog.save);
  app.patch("/api/catalog/:kind/:id", requireManager, stayCatalog.save);
  app.get("/api/housekeeping/tasks", permit("cleaning_tasks.own.read"), stayHousekeeping.list);
  app.patch("/api/housekeeping/tasks/:id/status", permit("cleaning_tasks.status.update"), stayHousekeeping.update);
  app.post("/api/housekeeping/bookings/:id/penalties", permit("damages.report"), stayPenalties.create);
  app.post("/api/housekeeping/issues", permit("room_issues.report"), stayHousekeeping.reportIssue);
  app.patch("/api/notifications/:id/read", async (req, res) => {
    const notification = await require("./models/Notification").findOneAndUpdate({ _id: require("./utils/validation").id(req.params.id), accountId: req.user._id }, { $set: { isRead: true, readAt: new Date() } }, { new: true });
    if (!notification) throw new HttpError(404, "Notification not found.");
    res.json({ data: notification });
  });
  // Member 2 modify / withdraw / search. The customer is always the signed-in user (never a body field or header),
  // so nobody can change another customer's booking; searching all bookings is for front-desk staff only.
  const staffSearch = (req, res, next) => {
    if (!["manager", "admin"].includes(req.role.key)) return permit("bookings.managed.read")(req, res, next);
    next();
  };
  app.post("/api/bookings/:id/withdraw-cancellation", cancellations.withdraw); // UC08 2b (same as DELETE /cancel)
  app.post("/api/bookings/:id/modify", bookingCreation.modifyOwn); // UC07
  app.patch("/api/bookings/:id/modify", bookingCreation.modifyOwn);
  app.get("/api/bookings/search", staffSearch, (req, res, next) => bookingController.search(req, res, next));
  app.patch("/api/profile", auth.updateProfile);
  // UC12 Submit Review (Customer session)
  app.post("/api/reviews", roomTypes.submitReview);
  app.get("/api/reviews/my", roomTypes.customerReviews);
  app.get("/api/room-issues/options", permit("room_issues.report"), roomIssues.options);
  app.post("/api/room-issues", permit("room_issues.report"), roomIssues.create);
  app.get("/api/room-issues", requireManager, roomIssues.listing);
  // M5 housekeeping workflows are authenticated: a Housekeeping user can only see/update own tasks.
  app.get("/api/housekeeping/tasks/mine", permit("cleaning_tasks.own.read"), housekeepingTasks.mine);
  app.get("/api/housekeeping/tasks/ad-hoc/options", permit("cleaning_tasks.ad_hoc.create"), housekeepingTasks.adHocOptions);
  app.post("/api/housekeeping/tasks/ad-hoc", permit("cleaning_tasks.ad_hoc.create"), housekeepingTasks.createAdHoc);
  app.get("/api/options", accounts.options);
  app.get("/api/customers", customers.list);
  app.patch("/api/customers/:id/blacklist", customers.blacklist);
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
  app.get("/api/room-types/:id/price-on-date", roomTypeController.getPriceForDate);
  app.use("/api/room-types", requireManager);
  app.get("/api/room-types", roomTypes.listing);
  app.post("/api/room-types", roomTypes.create);
  app.get("/api/room-types/:id", roomTypes.detail);
  app.patch("/api/room-types/:id", roomTypes.update);
  app.delete("/api/room-types/:id", roomTypes.remove);
  app.get("/api/room-types/:id/reviews", roomTypes.reviews);
  app.put("/api/room-types/:id/pricing", roomTypeController.updatePricing);
  app.patch("/api/reviews/:id/visibility", requireManager, roomTypes.visibility);
  // UC34 Additional services & compensation items (manager)
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
  const bookingLimit = rateLimit({ windowMs: 15 * 60 * 1000, limit: 30, standardHeaders: "draft-8", legacyHeaders: false });
  app.post("/api/bookings", bookingLimit, stays.createOnline);
  // UC11 View Booking Details
  app.get("/api/bookings/:id", bookings.detail);
  app.get("/api/bookings/:bookingId/invoice", invoices.customerDetail);
  app.post("/api/bookings/:id/requests", stayRequests.create);
  app.delete("/api/bookings/:id/requests/:requestId", stayRequests.withdraw);
  app.post("/api/bookings/:id/reviews", reviews.create);

  app.post("/api/bookings/:id/payments/deposit", payments.deposit);
  app.get("/api/payments/methods", payments.methods);
  app.get("/api/payments/:id", payments.show);
  if (!production || process.env.ENABLE_SANDBOX_GATEWAY === "true") app.post("/api/sandbox-gateway/orders/:orderId", payments.sandbox); // demo deployments only: moves no money
  // UC08 Cancel Reservation (customer)
  app.get("/api/bookings/:id/refund-estimate", cancellations.estimate);
  app.post("/api/bookings/:id/cancel", cancellations.requestOnline);
  app.delete("/api/bookings/:id/cancel", cancellations.withdraw);
  app.post("/api/bookings/:id/cancel-payment", cancellations.cancelPayment);

  // Front desk money flows: UC11, UC16, UC35, UC21
  // SRS 2.4.3 permissions (UC33 lets the manager change them).
  const settle = permit("payments.settle"), cancel = permit("bookings.managed.cancel"), review = permit("cancellations.review"), refund = permit("refunds.handle");
  app.post("/api/frontdesk/bookings/:id/payments", settle, payments.finalPayment);
  // Receptionists (payments.settle) and the Hotel Manager (revenue.read) read the billing lists.
  const billing = (req, res, next) => (req.role.permissions.includes("revenue.read") ? next() : settle(req, res, next));
  app.get("/api/frontdesk/payments", billing, payments.listing);
  app.get("/api/frontdesk/invoices", billing, invoices.listing);
  app.get("/api/frontdesk/invoices/:id", billing, invoices.detail);
  app.get("/api/frontdesk/requests", permit("stay_requests.manage"), stayRequests.listing);
  app.patch("/api/frontdesk/requests/:id", permit("stay_requests.manage"), stayRequests.handle);
  app.post("/api/frontdesk/bookings/:id/cancel-otp", cancel, cancellations.sendOtp);
  app.get("/api/frontdesk/cancellations/lookup", cancel, cancellations.lookup);
  app.get("/api/frontdesk/cancellations", review, cancellations.listing);
  app.post("/api/frontdesk/cancellations", cancel, cancellations.record);
  app.post("/api/frontdesk/cancellations/:id/approve", review, cancellations.approve);
  app.post("/api/frontdesk/cancellations/:id/withdraw", review, cancellations.withdrawAtDesk);
  app.get("/api/frontdesk/refunds", refund, refunds.listing);
  app.put("/api/frontdesk/refunds/:id/account", refund, refunds.setAccount);
  app.post("/api/frontdesk/refunds/:id/contacts", refund, refunds.addContact);
  app.post("/api/frontdesk/refunds/:id", refund, refunds.record);
  // UC27 Deposit & Cancellation Policy, hotel information
  app.use("/api/policies", permit("policies.manage"));
  app.get("/api/policies/deposit", policies.listing);
  app.post("/api/policies/deposit", policies.create);
  app.get("/api/policies/cancellation", policies.cancellationListing);
  app.post("/api/policies/cancellation", policies.createCancellation);
  app.put("/api/hotel-info", permit("policies.manage"), policies.updateHotelInfo);

  // Guest contact data is front-desk only (SRS 4.2.4); a Customer session must not read or change other customers.
  app.use("/api/front-desk/customers", (req, res, next) => permit(req.method === "GET" ? "bookings.managed.read" : "bookings.managed.update")(req, res, next), customerRoutes);

  app.get("/api/reports/revenue", permit("revenue.read"), revenue);
  app.get("/api/reports/occupancy", permit("revenue.read"), occupancy);

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
        success: false,
        message: status >= 500 ? "Something went wrong. Please try again." : error.message,
        ...(typeof error.code === "string" ? { code: error.code } : {}),
        ...(error.remainingAttempts !== undefined ? { remainingAttempts: error.remainingAttempts } : {}),
        ...(error.locked !== undefined ? { locked: error.locked } : {}),
        ...(error.remainingTime !== undefined ? { remainingTime: error.remainingTime } : {}),
        error: {
          message:
            status >= 500
              ? "Something went wrong. Please try again."
              : error.message,
          fields: error.fields,
          ...(typeof error.code === "string" ? { code: error.code } : {}),
          ...(error.details && status < 500 ? { details: error.details } : {}),
          ...(error.remainingAttempts !== undefined ? { remainingAttempts: error.remainingAttempts } : {}),
          ...(error.locked !== undefined ? { locked: error.locked } : {}),
          ...(error.remainingTime !== undefined ? { remainingTime: error.remainingTime } : {}),
        },
      });
  });

  return { app };
}

module.exports = { createApp };
