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
const promotions = require("./controllers/promotions");
const bookings = require("./controllers/bookings");
const bookingCreation = require("./controllers/bookingCreation");
const policies = require("./controllers/policies");
const payments = require("./controllers/payments");
const cancellations = require("./controllers/cancellations");
const refunds = require("./controllers/refunds");
const penalties = require("./controllers/penalties");
const jobs = require("./controllers/jobs");
const { revenue } = require("./controllers/revenue");
const { occupancy } = require("./controllers/occupancy");
const roomIssues = require("./controllers/roomIssues");
const stayRequests = require("./controllers/stayRequests");
const invoices = require("./controllers/invoices");
const reviews = require("./controllers/reviews");
const housekeepingTasks = require("./controllers/housekeepingTasks");
const { HttpError } = require("./utils/validation");
const RoomType = require("./models/RoomType");

// Bộ xử lý khách hàng, loại phòng và tìm phòng.
const roomTypeController = require("./controllers/roomTypeController");
const catalog = require("./controllers/catalog");
const notifications = require("./controllers/notifications");
const auditLogs = require("./controllers/auditLogs");
const roomController = require("./controllers/roomController");

const customerRoutes = require("./routes/customer.routes");

// Chỉ khách hàng đã đăng nhập được dùng chức năng tự phục vụ; từ chối nhân viên và Admin.
const customerOnly = (req, res, next) => {
  if (req.role.key !== "customer") throw new HttpError(403, "Only a customer account can use this function.");
  next();
};
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
  // Dùng hai lớp proxy khi Vercel chuyển tiếp /api đến Render.
  if (production) app.set("trust proxy", Number(process.env.TRUST_PROXY) || 1);
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
      res.set("Access-Control-Allow-Headers", "Content-Type");
      return res.sendStatus(204);
    }
    if (!["GET", "HEAD"].includes(req.method) && !allowed && !PUBLIC_HOOKS.includes(req.path))
      throw new HttpError(403, "Request origin is not allowed.");
    next();
  });

  app.use(express.json({ limit: "32kb" }));

  // Dùng khóa cấu hình để ký và kiểm tra JWT.
  app.set("jwtSecret", jwtSecret);
  app.set("production", production);

  app.use("/api", (req, res, next) => {
    res.set("Cache-Control", "no-store");
    next();
  });

  app.get("/api/health", (req, res) => res.json({ data: { status: "ok" } }));

  // API công khai trả loại phòng, số phòng còn lại và giá, không lộ phòng cụ thể.
  app.get("/api/public/availability", bookingCreation.availability);


  // Khai báo API xác thực công khai và giới hạn tần suất đăng nhập.
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

  // Cổng thanh toán và cron dùng cơ chế xác minh riêng, không dùng phiên trình duyệt.
  app.post(GATEWAY_CALLBACK, payments.callback);
  app.post("/api/payments/sepay/ipn", payments.sepayIpn);
  app.get("/api/payments/return", payments.back);
  app.post("/api/jobs/:name", jobs.run);
  app.get("/api/hotel-info", policies.hotelInfo);
  app.get("/api/public/policies", policies.publicSummary);
  app.get("/api/public/promotions", promotions.publicListing);
  // Các API bên dưới yêu cầu đăng nhập.
  app.use("/api", authenticate);

  app.get("/api/auth/me", auth.profile);
  // Mỗi người dùng chỉ đọc thông báo của chính mình.
  app.get("/api/notifications", notifications.listing);
  app.post("/api/notifications/read", notifications.markRead);
  app.get("/api/audit-logs", auditLogs.listing);
  app.get("/api/profile", auth.profile);
  app.put("/api/profile/password", authLimit, auth.changePassword);
  app.use("/api", requirePasswordChanged);
  // Cho Admin, quản lý hoặc nhân viên có quyền đọc booking tìm danh sách của mọi khách.
  const staffSearch = (req, res, next) => {
    if (!["manager", "admin"].includes(req.role.key)) return permit("bookings.managed.read")(req, res, next);
    next();
  };
  // Rút yêu cầu hủy như API DELETE /cancel.
  app.post("/api/bookings/:id/withdraw-cancellation", customerOnly, cancellations.withdraw);
  app.post("/api/bookings/:id/modify", customerOnly, bookingCreation.modifyOwn);
  app.patch("/api/bookings/:id/modify", customerOnly, bookingCreation.modifyOwn);
  app.get("/api/bookings/search", staffSearch, bookings.search);
  // Báo giá dùng chung cho đặt phòng trực tuyến và tại quầy.
  app.post("/api/bookings/quote", bookingCreation.quote);
  // Phòng cụ thể chỉ dành cho nhân viên có quyền tìm phòng.
  app.get("/api/rooms/search", permit("rooms.search"), roomController.search);
  app.patch("/api/profile", auth.updateProfile);
  // Khách đã đăng nhập gửi đánh giá booking của mình.
  app.post("/api/reviews", customerOnly, roomTypes.submitReview);
  app.get("/api/reviews/my", customerOnly, roomTypes.customerReviews);
  app.get("/api/room-issues/options", permit("room_issues.report"), roomIssues.options);
  app.post("/api/room-issues", permit("room_issues.report"), roomIssues.create);
  app.get("/api/room-issues", requireManager, roomIssues.listing);
  // Housekeeping chỉ xem và cập nhật nhiệm vụ được giao cho mình.
  app.get("/api/housekeeping/tasks/mine", permit("cleaning_tasks.own.read"), housekeepingTasks.mine);
  app.patch("/api/housekeeping/tasks/:id/status", permit("cleaning_tasks.status.update"), housekeepingTasks.updateMine);
  app.get("/api/housekeeping/tasks/ad-hoc/options", permit("cleaning_tasks.ad_hoc.create"), housekeepingTasks.adHocOptions);
  app.post("/api/housekeeping/tasks/ad-hoc", permit("cleaning_tasks.ad_hoc.create"), housekeepingTasks.createAdHoc);
  app.get("/api/options", accounts.options);
  app.get("/api/customers", customers.list);
  app.patch("/api/customers/:id/blacklist", customers.blacklist);
  app.get("/api/users", permit("users.manage"), accounts.listing(false));
  app.post("/api/users", permit("users.manage"), accounts.create(false));
  app.patch("/api/users/:id", permit("users.manage"), accounts.update(false));

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
  app.put("/api/room-types/:id/pricing", roomTypeController.updatePricing);
  app.patch("/api/reviews/:id/visibility", requireManager, roomTypes.visibility);
  // Quản lý danh mục dịch vụ và vật phẩm bồi thường.
  app.get("/api/catalog/:catalog", requireManager, catalog.listing);
  app.post("/api/catalog/:catalog", requireManager, catalog.create);
  app.patch("/api/catalog/:catalog/:id", requireManager, catalog.update);
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

  // Lấy lịch sử booking của người đang đăng nhập.
  app.get("/api/bookings", customerOnly, bookings.listing);
  // Giới hạn đặt phòng theo IP, vẫn cho phép nhiều khách dùng chung mạng.
  const bookingLimit = rateLimit({ windowMs: 15 * 60 * 1000, limit: 30, standardHeaders: "draft-8", legacyHeaders: false, message: { error: { message: "Too many requests. Please try again later." } } });
  app.post("/api/bookings", customerOnly, bookingLimit, bookingCreation.create);
  // Áp dụng quyền đã cấu hình cho từng thao tác tại quầy.
  app.post("/api/front-desk/bookings", permit("bookings.walk_in.create"), bookingCreation.createWalkIn);
  app.patch("/api/front-desk/bookings/:id", permit("bookings.managed.update"), bookingCreation.modifyWalkIn);
  app.post("/api/front-desk/bookings/:id/cancel", permit("bookings.managed.cancel"), cancellations.recordAtDesk);
  app.get("/api/front-desk/bookings/:id/available-rooms", permit("stays.check_in"), bookingCreation.availableRooms);
  app.post("/api/front-desk/bookings/:id/check-in", permit("stays.check_in"), bookingCreation.checkIn);
  app.get("/api/front-desk/bookings/:id/change-room-options", permit("rooms.change"), bookingCreation.changeRoomOptions);
  app.post("/api/front-desk/bookings/:id/change-room", permit("rooms.change"), bookingCreation.changeRoom);
  app.get("/api/front-desk/services", permit("booking_services.record"), bookingCreation.services);
  app.post("/api/front-desk/bookings/:id/services", permit("booking_services.record"), bookingCreation.addService);
  app.post("/api/front-desk/bookings/:id/services/:serviceLineId/void", permit("booking_services.record"), bookingCreation.voidService);
  app.post("/api/front-desk/bookings/:id/check-out/start", permit("stays.check_out"), bookingCreation.startCheckOut);
  app.post("/api/front-desk/bookings/:id/check-out", permit("stays.check_out"), bookingCreation.checkOut);
  app.post("/api/front-desk/bookings/:id/invoice", permit("stays.check_out"), bookingCreation.generateInvoice);
  // Xem chi tiết booking theo quyền của người gọi.
  app.get("/api/bookings/:id", bookings.detail);
  app.get("/api/bookings/:bookingId/invoice", invoices.customerDetail);
  app.post("/api/bookings/:id/requests", customerOnly, stayRequests.create);
  app.delete("/api/bookings/:id/requests/:requestId", customerOnly, stayRequests.withdraw);
  app.get("/api/bookings/:id/id-photo-upload", customerOnly, stayRequests.photoUploadParams);
  app.post("/api/bookings/:id/reviews", customerOnly, reviews.create);

  app.post("/api/bookings/:id/payments/deposit", customerOnly, payments.deposit);
  app.get("/api/payments/methods", payments.methods);
  app.get("/api/payments/:id", payments.show);
  // Cổng giả lập chỉ dùng cho demo, không chuyển tiền thật.
  if (!production || process.env.ENABLE_SANDBOX_GATEWAY === "true") app.post("/api/sandbox-gateway/orders/:orderId", payments.sandbox);
  app.get("/api/bookings/:id/refund-estimate", customerOnly, cancellations.estimate);
  app.post("/api/bookings/:id/cancel", customerOnly, cancellations.requestOnline);
  app.delete("/api/bookings/:id/cancel", customerOnly, cancellations.withdraw);
  app.post("/api/bookings/:id/cancel-payment", customerOnly, cancellations.cancelPayment);

  // Kiểm tra quyền trước các thao tác thanh toán, hủy và hoàn tiền tại quầy.
  const settle = permit("payments.settle"), cancel = permit("bookings.managed.cancel"), review = permit("cancellations.review"), refund = permit("refunds.handle");
  app.post("/api/frontdesk/bookings/:id/payments", settle, payments.finalPayment);
  // Lễ tân có quyền thu tiền và quản lý có quyền doanh thu được xem danh sách thanh toán.
  const billing = (req, res, next) => (req.role.permissions.includes("revenue.read") ? next() : settle(req, res, next));
  app.get("/api/frontdesk/payments", billing, payments.listing);
  app.get("/api/frontdesk/invoices", billing, invoices.listing);
  app.get("/api/frontdesk/invoices/:id", billing, invoices.detail);
  app.get("/api/frontdesk/requests", permit("stay_requests.manage"), stayRequests.listing);
  app.patch("/api/frontdesk/requests/:id", permit("stay_requests.manage"), stayRequests.handle);
  app.get("/api/frontdesk/requests/:id/id-photo", permit("stays.check_in"), stayRequests.photoLink);
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
  // Ghi nhận và xử lý khoản bồi thường hư hỏng hoặc mất mát.
  const penalize = permit("penalties.record");
  app.get("/api/frontdesk/compensation-items", penalize, penalties.items);
  app.get("/api/frontdesk/bookings/:id/penalties", penalize, penalties.listing);
  app.post("/api/frontdesk/bookings/:id/penalties", penalize, penalties.record);
  app.patch("/api/frontdesk/penalties/:id", penalize, penalties.review);

  // Quản lý chính sách đặt cọc, hủy phòng và thông tin khách sạn.
  app.use("/api/policies", permit("policies.manage"));
  app.get("/api/policies/deposit", policies.listing);
  app.post("/api/policies/deposit", policies.create);
  app.get("/api/policies/cancellation", policies.cancellationListing);
  app.post("/api/policies/cancellation", policies.createCancellation);
  app.put("/api/hotel-info", permit("policies.manage"), policies.updateHotelInfo);

  // Chỉ lễ tân được truy cập thông tin liên hệ của khách khác.
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
