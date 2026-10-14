const roomTypeService = require('../services/roomTypeService');

class RoomTypeController {
  async getAll(req, res, next) {
    try {
      const { hotelId, isActive } = req.query;
      const filter = {};
      if (hotelId) filter.hotelId = hotelId;
      if (isActive !== undefined) filter.isActive = isActive === 'true';

      const data = await roomTypeService.getAllRoomTypes(filter);
      res.json({ success: true, count: data.length, data });
    } catch (err) {
      next(err);
    }
  }

  async getById(req, res, next) {
    try {
      const data = await roomTypeService.getRoomTypeById(req.params.id);
      res.json({ success: true, data });
    } catch (err) {
      next(err);
    }
  }

  async create(req, res, next) {
    try {
      const data = await roomTypeService.createRoomType(req.body);
      res.status(201).json({ success: true, message: 'Room type created successfully', data });
    } catch (err) {
      next(err);
    }
  }

  async update(req, res, next) {
    try {
      const data = await roomTypeService.updateRoomType(req.params.id, req.body);
      res.json({ success: true, message: 'Room type updated successfully', data });
    } catch (err) {
      next(err);
    }
  }

  async delete(req, res, next) {
    try {
      const result = await roomTypeService.deleteRoomType(req.params.id);
      res.json(result);
    } catch (err) {
      next(err);
    }
  }

  async updatePricing(req, res, next) {
    try {
      const data = await roomTypeService.updatePricing(req.params.id, req.body);
      res.json({ success: true, message: 'Room pricing updated successfully', data });
    } catch (err) {
      next(err);
    }
  }

  async getPriceForDate(req, res, next) {
    try {
      const date = req.query.date ? new Date(req.query.date) : new Date();
      const pricing = await roomTypeService.calculatePriceForDate(req.params.id, date);
      res.json({ success: true, data: pricing });
    } catch (err) {
      next(err);
    }
  }
}

module.exports = new RoomTypeController();
