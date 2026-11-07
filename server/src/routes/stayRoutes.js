const router = require("express").Router();
const { permit } = require("../middleware/auth");
const stays = require("../controllers/stays");
const penalties = require("../controllers/stayPenalties");
const invoices = require("../controllers/stayInvoices");
const Service = require("../models/Service");

router.get("/availability", permit("rooms.search"), stays.search);
router.get(
  "/customers",
  permit("bookings.walk_in.create"),
  async (req, res) => {
    const v = require("../utils/validation");
    const role = await require("../models/Role").findOne({ key: "customer" });
    const q = v.search(req.query);
    res.json(
      await v.list(
        require("../models/User"),
        {
          roleId: role._id,
          status: "active",
          $or: [{ "customerProfile.fullName": q }, { phone: q }, { email: q }],
        },
        req.query,
        "customerProfile.fullName phone email",
      ),
    );
  },
);
router.post("/bookings", permit("bookings.walk_in.create"), stays.createWalkIn);
router.patch("/bookings/:id", permit("bookings.managed.update"), stays.modify);
router.get(
  "/bookings/:id/available-rooms",
  permit("stays.check_in"),
  stays.availableRooms,
);
router.post("/bookings/:id/check-in", permit("stays.check_in"), stays.checkIn);
router.get(
  "/bookings/:id/change-room-options",
  permit("rooms.change"),
  stays.changeRoomOptions,
);
router.post(
  "/bookings/:id/change-room",
  permit("rooms.change"),
  stays.changeRoom,
);
router.get("/services", permit("booking_services.record"), async (req, res) =>
  res.json({
    data: await Service.find({ isActive: true }).sort({ name: 1 }).lean(),
  }),
);
router.post(
  "/bookings/:id/services",
  permit("booking_services.record"),
  stays.addService,
);
router.patch(
  "/bookings/:id/services/:lineId/void",
  permit("booking_services.record"),
  stays.voidService,
);
router.get(
  "/bookings/:id/bill",
  permit("bookings.managed.read"),
  stays.getBill,
);
router.post(
  "/bookings/:id/check-out/start",
  permit("stays.check_out"),
  stays.startCheckout,
);
router.post(
  "/bookings/:id/check-out/skip-inspection",
  permit("stays.check_out"),
  stays.skipInspection,
);
router.post(
  "/bookings/:id/check-out/complete",
  permit("stays.check_out"),
  stays.completeCheckout,
);
router.post(
  "/bookings/:id/penalties",
  permit("penalties.record"),
  penalties.create,
);
router.patch(
  "/penalties/:penaltyId",
  permit("penalties.record"),
  penalties.update,
);
router.post(
  "/bookings/:id/invoices",
  permit("invoices.print"),
  invoices.generate,
);
module.exports = router;
