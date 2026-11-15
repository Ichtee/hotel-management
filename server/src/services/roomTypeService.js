const RoomType = require('../models/RoomType');
const Room = require('../models/Room');

class RoomTypeService {
  /**
   * Get all room types, optionally filtered by hotelId or isActive
   * (UC31 - Manage Room Types)
   */
  async getAllRoomTypes(filter = {}) {
    const query = {};
    if (filter.hotelId) query.hotelId = filter.hotelId;
    if (filter.isActive !== undefined) query.isActive = filter.isActive;
    return RoomType.find(query).sort({ createdAt: -1 });
  }

  /**
   * Get room type details by ID
   * (UC06 - View Room Details)
   */
  async getRoomTypeById(id) {
    const roomType = await RoomType.findById(id);
    if (!roomType) {
      const error = new Error('Room type not found');
      error.status = 404;
      throw error;
    }
    return roomType;
  }

  /**
   * Create a new room type
   * (UC31 - Manage Room Types)
   */
  async createRoomType(data) {
    const existing = await RoomType.findOne({ hotelId: data.hotelId, name: data.name });
    if (existing) {
      const error = new Error(`Room type with name "${data.name}" already exists in this hotel.`);
      error.status = 409;
      throw error;
    }
    const roomType = new RoomType(data);
    return roomType.save();
  }

  /**
   * Update room type details
   * (UC31 - Manage Room Types)
   */
  async updateRoomType(id, data) {
    const roomType = await RoomType.findByIdAndUpdate(id, data, {
      new: true,
      runValidators: true
    });
    if (!roomType) {
      const error = new Error('Room type not found');
      error.status = 404;
      throw error;
    }
    return roomType;
  }

  /**
   * Delete room type (soft delete or verify no rooms are attached)
   * (UC31 - Manage Room Types)
   */
  async deleteRoomType(id) {
    // Check if any physical room is using this room type
    const roomCount = await Room.countDocuments({ roomTypeId: id });
    if (roomCount > 0) {
      const error = new Error(`Cannot delete room type: ${roomCount} room(s) are currently assigned to it. Deactivate instead.`);
      error.status = 400;
      throw error;
    }
    const result = await RoomType.findByIdAndDelete(id);
    if (!result) {
      const error = new Error('Room type not found');
      error.status = 404;
      throw error;
    }
    return { success: true, message: 'Room type deleted successfully' };
  }

  /**
   * Manage Seasonal and Dynamic Pricing
   * (UC32 - Manage Room Prices)
   */
  async updatePricing(id, { basePrice, seasonalPricing }) {
    const update = {};
    const { HttpError } = require('../utils/validation');
    // BR-01 / CR-20: prices are whole VND amounts greater than 0.
    const whole = (n) => typeof n === 'number' && Number.isSafeInteger(n) && n > 0;
    if (basePrice !== undefined) {
      if (!whole(basePrice)) throw new HttpError(400, 'The base price must be a whole amount greater than 0.');
      update.basePrice = basePrice;
    }
    if (seasonalPricing !== undefined) {
      if (!Array.isArray(seasonalPricing)) throw new HttpError(400, 'seasonalPricing must be a list.');
      // UC25: valid dates and price (MSG-23 / MSG-24), and no two rates of a room type overlap (MSG-60).
      const spans = seasonalPricing.map((season) => {
        const start = new Date(season.startDate);
        const end = new Date(season.endDate);
        if (Number.isNaN(+start) || Number.isNaN(+end) || end < start)
          throw new HttpError(400, `Rate "${season.description || 'Custom'}": the end date cannot be before the start date.`);
        if (!whole(season.price))
          throw new HttpError(400, `Rate "${season.description || 'Custom'}": the price must be a whole amount greater than 0.`);
        return { name: season.description || 'Custom', start, end };
      }).sort((a, b) => a.start - b.start);
      for (let i = 1; i < spans.length; i++)
        if (spans[i].start <= spans[i - 1].end) // ranges include both days
          throw new HttpError(409, `Rate "${spans[i].name}" overlaps "${spans[i - 1].name}". Change its dates.`);
      update.seasonalPricing = seasonalPricing;
    }

    const roomType = await RoomType.findByIdAndUpdate(id, update, {
      new: true,
      runValidators: true
    });
    if (!roomType) {
      const error = new Error('Room type not found');
      error.status = 404;
      throw error;
    }
    return roomType;
  }

  /**
   * Calculate effective room price on a specific target date
   * Considers seasonal price overrides vs base price
   * (Shared helper for Member 3's Booking calculation)
   */
  async calculatePriceForDate(roomTypeId, targetDate = new Date()) {
    const roomType = await this.getRoomTypeById(roomTypeId);
    const date = new Date(targetDate);

    // Look for matching seasonal rate
    if (roomType.seasonalPricing && roomType.seasonalPricing.length > 0) {
      const matchedSeason = roomType.seasonalPricing.find(season => {
        const start = new Date(season.startDate);
        const end = new Date(season.endDate);
        return date >= start && date <= end;
      });
      if (matchedSeason) {
        return {
          price: matchedSeason.price,
          isSeasonal: true,
          seasonName: matchedSeason.seasonName || 'Seasonal Rate',
          basePrice: roomType.basePrice
        };
      }
    }

    return {
      price: roomType.basePrice,
      isSeasonal: false,
      seasonName: null,
      basePrice: roomType.basePrice
    };
  }
}

module.exports = new RoomTypeService();
