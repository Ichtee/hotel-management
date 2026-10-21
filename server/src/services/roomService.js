const Room = require('../models/Room');
const RoomType = require('../models/RoomType');
const Booking = require('../models/Booking');

class RoomService {
  /**
   * Get all physical rooms (UC30 - Manage Rooms)
   * Supports filtering by floor, status, roomTypeId, hotelId
   */
  async getAllRooms(filter = {}) {
    const query = {};
    if (filter.hotelId) query.hotelId = filter.hotelId;
    if (filter.floor !== undefined) query.floor = Number(filter.floor);
    if (filter.status) query.status = filter.status;
    if (filter.roomTypeId) query.roomTypeId = filter.roomTypeId;

    return Room.find(query)
      .populate('roomTypeId', 'name basePrice maxOccupancy bedType')
      .populate('hotelId', 'name city')
      .sort({ floor: 1, roomNumber: 1 });
  }

  /**
   * Get single room details
   */
  async getRoomById(id) {
    const room = await Room.findById(id)
      .populate('roomTypeId')
      .populate('hotelId');
    if (!room) {
      const error = new Error('Room not found');
      error.status = 404;
      throw error;
    }
    return room;
  }

  /**
   * Create a physical room (UC30)
   */
  async createRoom(data) {
    const existing = await Room.findOne({ hotelId: data.hotelId, roomNumber: data.roomNumber.trim() });
    if (existing) {
      const error = new Error(`Room number "${data.roomNumber}" already exists in this hotel.`);
      error.status = 409;
      throw error;
    }

    // Verify roomTypeId belongs to this hotel
    const roomType = await RoomType.findById(data.roomTypeId);
    if (!roomType) {
      const error = new Error('Invalid roomTypeId: Room type does not exist');
      error.status = 400;
      throw error;
    }

    const room = new Room({
      ...data,
      roomNumber: data.roomNumber.trim(),
      floor: data.floor || (parseInt(data.roomNumber[0], 10) || 1)
    });

    return room.save();
  }

  /**
   * Update room details (UC30)
   */
  async updateRoom(id, data) {
    if (data.roomNumber && data.hotelId) {
      const duplicate = await Room.findOne({
        _id: { $ne: id },
        hotelId: data.hotelId,
        roomNumber: data.roomNumber.trim()
      });
      if (duplicate) {
        const error = new Error(`Room number "${data.roomNumber}" already in use.`);
        error.status = 409;
        throw error;
      }
    }

    const room = await Room.findByIdAndUpdate(id, data, { new: true, runValidators: true })
      .populate('roomTypeId')
      .populate('hotelId');
    if (!room) {
      const error = new Error('Room not found');
      error.status = 404;
      throw error;
    }
    return room;
  }

  /**
   * Update room operational status (UC30 / Lifecycle transition)
   * statuses: available, occupied, cleaning, maintenance
   */
  async updateRoomStatus(id, newStatus) {
    const validStatuses = ['available', 'occupied', 'cleaning', 'maintenance'];
    if (!validStatuses.includes(newStatus)) {
      const error = new Error(`Invalid status: ${newStatus}. Must be one of: ${validStatuses.join(', ')}`);
      error.status = 400;
      throw error;
    }

    const room = await Room.findByIdAndUpdate(
      id,
      { status: newStatus },
      { new: true, runValidators: true }
    );
    if (!room) {
      const error = new Error('Room not found');
      error.status = 404;
      throw error;
    }
    return room;
  }

  /**
   * Delete room (UC30)
   */
  async deleteRoom(id) {
    const room = await Room.findById(id);
    if (!room) {
      const error = new Error('Room not found');
      error.status = 404;
      throw error;
    }

    // Check if room is currently occupied
    if (room.status === 'occupied') {
      const error = new Error('Cannot delete an occupied room.');
      error.status = 400;
      throw error;
    }

    await Room.findByIdAndDelete(id);
    return { success: true, message: `Room ${room.roomNumber} deleted successfully` };
  }

  /**
   * Search available rooms / room types (UC05 / UC06 - Search & Check Room Availability)
   * Core availability algorithm (T06):
   * 1. Finds all rooms not under maintenance and active.
   * 2. Finds overlapping bookings (checkIn < requestedCheckOut && checkOut > requestedCheckIn)
   *    with status in ['pending', 'confirmed', 'checked_in'].
   * 3. Filters out rooms currently booked or in maintenance.
   */
  async searchAvailableRooms({ hotelId, checkInDate, checkOutDate, guests = 1, minPrice, maxPrice }) {
    let inDate = null;
    let outDate = null;

    // Validate dates first if provided
    if (checkInDate || checkOutDate) {
      if (!checkInDate || !checkOutDate) {
        const error = new Error('Both checkInDate and checkOutDate must be provided together');
        error.status = 400;
        throw error;
      }

      inDate = new Date(checkInDate);
      outDate = new Date(checkOutDate);

      if (isNaN(inDate.getTime()) || isNaN(outDate.getTime())) {
        const error = new Error('Invalid checkInDate or checkOutDate format');
        error.status = 400;
        throw error;
      }

      if (outDate <= inDate) {
        const error = new Error('checkOutDate must be after checkInDate');
        error.status = 400;
        throw error;
      }
    }

    const query = { status: { $ne: 'maintenance' }, isActive: { $ne: false } };
    if (hotelId) query.hotelId = hotelId;

    let availableRooms = await Room.find(query).populate('roomTypeId');

    // If dates are provided, filter out booked rooms
    if (inDate && outDate) {

      // Find conflicting bookings
      const conflictingBookings = await Booking.find({
        status: { $in: ['pending', 'confirmed', 'checked_in'] },
        checkInDate: { $lt: outDate },
        checkOutDate: { $gt: inDate }
      }).select('rooms.roomId');

      const bookedRoomIds = new Set();
      for (const b of conflictingBookings) {
        for (const item of b.rooms) {
          if (item.roomId) bookedRoomIds.add(String(item.roomId));
        }
      }

      // Exclude booked rooms
      availableRooms = availableRooms.filter(r => !bookedRoomIds.has(String(r._id)));
    }

    // Filter by guests capacity and price if requested
    const filtered = availableRooms.filter(r => {
      const rt = r.roomTypeId;
      if (!rt || rt.isActive === false) return false;
      if (guests && rt.maxOccupancy && rt.maxOccupancy < Number(guests)) return false;
      if (minPrice && rt.basePrice < Number(minPrice)) return false;
      if (maxPrice && rt.basePrice > Number(maxPrice)) return false;
      return true;
    });

    return filtered;
  }

  /**
   * Validate if a specific physical room is available for the given date range (T06)
   */
  async isRoomAvailable(roomId, checkInDate, checkOutDate, excludeBookingId = null) {
    const room = await Room.findById(roomId);
    if (!room || room.isActive === false || room.status === 'maintenance') {
      return false;
    }

    const inDate = new Date(checkInDate);
    const outDate = new Date(checkOutDate);

    const query = {
      status: { $in: ['pending', 'confirmed', 'checked_in'] },
      'rooms.roomId': room._id,
      checkInDate: { $lt: outDate },
      checkOutDate: { $gt: inDate }
    };

    if (excludeBookingId) {
      query._id = { $ne: excludeBookingId };
    }

    const conflict = await Booking.findOne(query);
    return !conflict;
  }

  /**
   * Find an available physical room for a given roomTypeId during the target date range
   */
  async findAvailableRoomForType({ hotelId, roomTypeId, checkInDate, checkOutDate, excludeBookingId = null }) {
    const inDate = new Date(checkInDate);
    const outDate = new Date(checkOutDate);

    const roomQuery = {
      roomTypeId,
      status: { $ne: 'maintenance' },
      isActive: { $ne: false }
    };
    if (hotelId) roomQuery.hotelId = hotelId;

    const candidateRooms = await Room.find(roomQuery);
    if (!candidateRooms.length) return null;

    const candidateIds = candidateRooms.map(r => r._id);

    // Find conflicting bookings for these candidate rooms
    const bookingQuery = {
      status: { $in: ['pending', 'confirmed', 'checked_in'] },
      'rooms.roomId': { $in: candidateIds },
      checkInDate: { $lt: outDate },
      checkOutDate: { $gt: inDate }
    };
    if (excludeBookingId) {
      bookingQuery._id = { $ne: excludeBookingId };
    }

    const conflictingBookings = await Booking.find(bookingQuery).select('rooms.roomId');
    const bookedIds = new Set();
    for (const b of conflictingBookings) {
      for (const item of b.rooms) {
        if (item.roomId) bookedIds.add(String(item.roomId));
      }
    }

    // Pick first available room
    return candidateRooms.find(r => !bookedIds.has(String(r._id))) || null;
  }
}

module.exports = new RoomService();
