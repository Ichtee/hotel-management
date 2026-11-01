const router = require('express').Router();
const controller = require('../controllers/frontDeskBooking.controller');
const { requireActor } = require('../middleware/actor');

router.use(requireActor);
router.post('/bookings', controller.create);
router.patch('/bookings/:bookingId', controller.modify);
// Cancellation (UC16) is recorded through POST /api/frontdesk/cancellations (M3), which applies BR-16/BR-36.
router.post('/bookings/:bookingId/check-in', controller.checkIn);
router.post('/bookings/:bookingId/change-room', controller.changeRoom);
router.post('/bookings/:bookingId/services', controller.recordService);
router.post('/bookings/:bookingId/check-out', controller.checkOut);
module.exports = router;
