const express = require('express');
const router = express.Router();
const bookingController = require('../controllers/bookingController');

// UC07: Customer Make Reservation
router.post('/', bookingController.create);

// T10: Customer Bookings / Dashboard
router.get('/', bookingController.getMyBookings);
router.get('/my', bookingController.getMyBookings);
router.get('/ref/:reference', bookingController.getByReference);

// Cancel reservation & abandon hold (BR-29, BR-36)
router.post('/:id/cancel-payment', bookingController.cancelPayment);
router.post('/:id/cancel', bookingController.cancel);
router.delete('/:id/cancel', bookingController.withdrawCancellation);
router.post('/:id/withdraw-cancellation', bookingController.withdrawCancellation);

// UC07: Modify reservation
router.post('/:id/modify', bookingController.modify);
router.patch('/:id/modify', bookingController.modify);
router.patch('/:id', bookingController.modify);

// Search reservations (shared filters)
router.get('/search', bookingController.search);

module.exports = router;

