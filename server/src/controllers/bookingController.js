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
      const { reason, customerId, refundAccount } = req.body;
      const data = await bookingService.cancelReservation(req.params.id, {
        customerId: customerId || req.user?._id || req.headers['x-user-id'],
        reason,
        refundAccount
      });
      const isRequested = data.status === 'cancellation_requested';
      res.json({
        success: true,
        message: isRequested
          ? 'Cancellation request submitted for front desk review'
          : 'Reservation cancelled successfully',
        data
      });
    } catch (err) {
      next(err);
    }
  }

  async cancelPayment(req, res, next) {
    try {
      const customerId = req.body.customerId || req.user?._id || req.headers['x-user-id'];
      const data = await bookingService.abandonPayment(req.params.id, { customerId });
      res.json({
        success: true,
        message: 'Payment abandoned and room hold released',
        data
      });
    } catch (err) {
      next(err);
    }
  }

  async withdrawCancellation(req, res, next) {
    try {
      const customerId = req.body?.customerId || req.user?._id || req.headers['x-user-id'];
      const data = await bookingService.withdrawCancellation(req.params.id, { customerId });
      res.json({
        success: true,
        message: 'Cancellation request withdrawn successfully',
        data
      });
    } catch (err) {
      next(err);
    }
  }

  async modify(req, res, next) {
    try {
      const { checkInDate, checkOutDate, specialRequests, guestCount, customerId } = req.body;
      const data = await bookingService.modifyReservation(req.params.id, {
        customerId: customerId || req.user?._id || req.headers['x-user-id'],
        checkInDate,
        checkOutDate,
        specialRequests,
        guestCount
      });
      res.json({
        success: true,
        message: 'Reservation updated successfully',
        data
      });
    } catch (err) {
      next(err);
    }
  }

  async occupancyReport(req, res, next) {
    try {
      const { hotelId, startDate, endDate, from, to, groupBy, format } = req.query;
      const data = await bookingService.getOccupancyReport({
        hotelId,
        startDate: startDate || from,
        endDate: endDate || to,
        groupBy
      });

      if (format === 'csv') {
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="occupancy_${data.from}_to_${data.to}.csv"`);
        let csv = 'Date,Total Rooms,Maintenance Rooms,Sellable Rooms,Occupied Rooms,Occupancy Rate (%)\n';
        for (const row of data.series) {
          csv += `${row.date},${row.totalRooms},${row.maintenanceRooms},${row.sellableRooms},${row.occupiedRooms},${row.occupancyRate}%\n`;
        }
        return res.send(csv);
      }

      res.json({
        success: true,
        data
      });
    } catch (err) {
      next(err);
    }
  }

  async search(req, res, next) {
    try {
      const result = await bookingService.searchBookings(req.query);
      res.json({
        success: true,
        ...result
      });
    } catch (err) {
      next(err);
    }
  }
}

module.exports = new BookingController();
