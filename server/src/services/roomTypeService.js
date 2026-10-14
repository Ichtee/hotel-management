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
    return RoomType.find(query).populate('hotelId', 'name city address starRating').sort({ createdAt: -1 });
  }

  /**
   * Get room type details by ID
   * (UC06 - View Room Details)
   */
  async getRoomTypeById(id) {
    const roomType = await RoomType.findById(id).populate('hotelId', 'name city address starRating phone email');
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
    if (basePrice !== undefined) update.basePrice = basePrice;
    if (seasonalPricing !== undefined) {
      // Validate dates
      for (const season of seasonalPricing) {
        const start = new Date(season.startDate);
        const end = new Date(season.endDate);
        if (end <= start) {
          const error = new Error(`Seasonal price "${season.seasonName || 'Custom'}" endDate must be after startDate`);
          error.status = 400;
          throw error;
        }
      }
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
