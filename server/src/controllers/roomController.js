const roomService = require('../services/roomService');

class RoomController {
  async getAll(req, res, next) {
    try {
      const { hotelId, floor, status, roomTypeId } = req.query;
      const data = await roomService.getAllRooms({ hotelId, floor, status, roomTypeId });
      res.json({ success: true, count: data.length, data });
    } catch (err) {
      next(err);
    }
  }

  async getById(req, res, next) {
    try {
      const data = await roomService.getRoomById(req.params.id);
      res.json({ success: true, data });
    } catch (err) {
      next(err);
    }
  }

  async create(req, res, next) {
    try {
      const data = await roomService.createRoom(req.body);
      res.status(201).json({ success: true, message: 'Room created successfully', data });
    } catch (err) {
      next(err);
    }
  }

  async update(req, res, next) {
    try {
      const data = await roomService.updateRoom(req.params.id, req.body);
      res.json({ success: true, message: 'Room updated successfully', data });
    } catch (err) {
      next(err);
    }
  }

  async updateStatus(req, res, next) {
    try {
      const { status } = req.body;
      const data = await roomService.updateRoomStatus(req.params.id, status);
      res.json({ success: true, message: `Room status updated to ${status}`, data });
    } catch (err) {
      next(err);
    }
  }

  async delete(req, res, next) {
    try {
      const result = await roomService.deleteRoom(req.params.id);
      res.json(result);
    } catch (err) {
      next(err);
    }
  }

  async search(req, res, next) {
    try {
      const { hotelId, checkIn, checkOut, guests, minPrice, maxPrice } = req.query;
      const data = await roomService.searchAvailableRooms({
        hotelId,
        checkInDate: checkIn,
        checkOutDate: checkOut,
        guests,
        minPrice,
        maxPrice
      });
      res.json({ success: true, count: data.length, data });
    } catch (err) {
      next(err);
    }
  }
}

module.exports = new RoomController();
