const bookingService = require('../services/bookingService');

class BookingController {
  async create(req, res, next) {
    try {
      const data = await bookingService.createOnlineReservation(req.body);
      res.status(201).json({
        success: true,
        message: 'Reservation created successfully',
        data
      });
    } catch (err) {
      next(err);
    }
  }

  async getMyBookings(req, res, next) {
    try {
      const { customerId, email, status } = req.query;
      const data = await bookingService.getCustomerBookings({
        customerId: customerId || req.headers['x-user-id'],
        guestEmail: email,
        status
      });
      res.json({
        success: true,
        count: data.length,
        data
      });
    } catch (err) {
      next(err);
    }
  }

  async getByReference(req, res, next) {
    try {
      const data = await bookingService.getBookingByReference(req.params.reference);
      res.json({
        success: true,
        data
      });
    } catch (err) {
      next(err);
    }
  }

  async cancel(req, res, next) {
    try {
      const { reason, customerId } = req.body;
      const data = await bookingService.cancelReservation(req.params.id, {
        customerId: customerId || req.headers['x-user-id'],
        reason
      });
      res.json({
        success: true,
        message: 'Reservation cancelled successfully',
        data
      });
    } catch (err) {
      next(err);
    }
  }
}

module.exports = new BookingController();
