const express = require("express");
const session = require("express-session");
const { MongoStore } = require("connect-mongo");
const { rateLimit } = require("express-rate-limit");
const helmet = require("helmet");
const { authenticate, permit, hotelScope } = require("./middleware/auth");
const auth = require("./controllers/auth");
const accounts = require("./controllers/accounts");
const roles = require("./controllers/roles");
const promotions = require("./controllers/promotions");
const { revenue } = require("./controllers/revenue");
const { HttpError } = require("./utils/validation");
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
    if (origin === clientOrigin) {
      res.set("Access-Control-Allow-Origin", clientOrigin);
      res.set("Access-Control-Allow-Credentials", "true");
      res.vary("Origin");
    }
    if (req.method === "OPTIONS") {
      if (origin !== clientOrigin) return res.sendStatus(403);
      res.set("Access-Control-Allow-Methods", "GET,POST,PATCH,PUT,DELETE");
      res.set("Access-Control-Allow-Headers", "Content-Type");
      return res.sendStatus(204);
    }
    if (!["GET", "HEAD"].includes(req.method) && origin !== clientOrigin)
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
  app.use("/api", authenticate);
  app.get("/api/auth/me", auth.profile);
  app.get("/api/profile", auth.profile);
  app.patch("/api/profile", auth.updateProfile);
  app.put("/api/profile/password", authLimit, auth.changePassword);
  app.get("/api/options", accounts.options);
  app.get("/api/users", permit("users.manage"), accounts.listing(false));
  app.post("/api/users", permit("users.manage"), accounts.create(false));
  app.patch("/api/users/:id", permit("users.manage"), accounts.update(false));
  app.get("/api/roles", permit("roles.manage"), roles.list);
  app.post("/api/roles", permit("roles.manage"), roles.create);
  app.patch("/api/roles/:id", permit("roles.manage"), roles.update);
  app.delete("/api/roles/:id", permit("roles.manage"), roles.remove);
  app.use("/api/staff", permit("staff.manage"), hotelScope);
  app.get("/api/staff", accounts.listing(true));
  app.post("/api/staff", accounts.create(true));
  app.patch("/api/staff/:id", accounts.update(true));
  app.delete("/api/staff/:id", accounts.deactivateStaff);
  app.use("/api/promotions", permit("promotions.manage"), hotelScope);
  app.get("/api/promotions", promotions.listing);
  app.post("/api/promotions", promotions.create);
  app.patch("/api/promotions/:id", promotions.update);
  app.delete("/api/promotions/:id", promotions.remove);
  app.get("/api/reports/revenue", permit("revenue.read"), hotelScope, revenue);
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
            message: "This email, username or code is already in use.",
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
        },
      });
  });
  return { app, store };
}
module.exports = { createApp };
