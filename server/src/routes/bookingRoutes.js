const express = require('express');
const router = express.Router();
const bookingController = require('../controllers/bookingController');

// UC07: Customer Make Reservation
router.post('/', bookingController.create);

// T10: Customer Bookings / Dashboard
router.get('/', bookingController.getMyBookings);
router.get('/my', bookingController.getMyBookings);
router.get('/ref/:reference', bookingController.getByReference);

// Cancel reservation
router.post('/:id/cancel', bookingController.cancel);

module.exports = router;
