const mongoose = require('mongoose');
const Booking = require('../models/Booking');
const Room = require('../models/Room');
const RoomType = require('../models/RoomType');
const Hotel = require('../models/HotelInfo');
const User = require('../models/User');
const Role = require('../models/Role');
const Coupon = require('../models/Coupon');
const roomService = require('./roomService');
const roomTypeService = require('./roomTypeService');

class BookingService {
  /**
   * Helper to ensure a customer User document exists for online booking
   */
  async ensureCustomerUser({ customerId, guestEmail, guestName, guestPhone }) {
    if (customerId && mongoose.isValidObjectId(customerId)) {
      const existingUser = await User.findById(customerId);
      if (existingUser) return existingUser;
    }

    const email = guestEmail?.toLowerCase().trim() || `guest_${Date.now()}@example.com`;
    let user = await User.findOne({ email });
    if (user) return user;

    // Look for customer role or find any role
    let customerRole = await Role.findOne({ key: 'customer' });
    if (!customerRole) {
      customerRole = await Role.findOne({});
    }
    const roleId = customerRole ? customerRole._id : new mongoose.Types.ObjectId();

    user = new User({
      username: email.split('@')[0] + '_' + Math.floor(100 + Math.random() * 900),
      email,
      passwordHash: 'guest_nologin_hash_' + Date.now(),
      roleId,
      phone: guestPhone || '0900000000',
      status: 'active',
      customerProfile: {
        fullName: guestName || 'Valued Guest'
      }
    });

    try {
      await user.save();
    } catch (err) {
      // If concurrent insert happens
      const found = await User.findOne({ email });
      if (found) return found;
    }
    return user;
  }

  /**
   * Generate a unique human-friendly booking reference: BK-XXXX
   */
  async generateBookingReference() {
    const code = `BK-${Math.floor(1000 + Math.random() * 9000)}`;
    if (mongoose.connection.readyState === 1) {
      for (let attempts = 0; attempts < 10; attempts++) {
        const candidate = `BK-${Math.floor(1000 + Math.random() * 9000)}`;
        const existing = await Booking.findOne({ bookingReference: candidate });
        if (!existing) return candidate;
      }
    }
    return code;
  }

  /**
   * UC07: Make Reservation (Core Customer Online Booking)
   */
  async createOnlineReservation(payload) {
    const {
      hotelId,
      customerId,
      guestName,
      guestEmail,
      guestPhone,
      checkInDate,
      checkOutDate,
      rooms = [],
      couponCode,
      paymentType = 'deposit',
      specialRequests
    } = payload;

    // 1. Date Validation
    if (!checkInDate || !checkOutDate) {
      const error = new Error('Both checkInDate and checkOutDate are required');
      error.status = 400;
      throw error;
    }

    const inDate = new Date(checkInDate);
    const outDate = new Date(checkOutDate);

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

    const nights = Math.max(1, Math.round((outDate - inDate) / 86400000));

    // 2. Validate Rooms array
    if (!Array.isArray(rooms) || rooms.length === 0) {
      const error = new Error('At least one room is required for reservation');
      error.status = 400;
      throw error;
    }

    // 3. Resolve Customer User
    const customer = await this.ensureCustomerUser({
      customerId,
      guestEmail,
      guestName,
      guestPhone
    });

    // 4. Resolve Hotel ID (fallback to first hotel if not specified)
    let resolvedHotelId = hotelId;
    if (!resolvedHotelId || !mongoose.isValidObjectId(resolvedHotelId)) {
      const firstHotel = await Hotel.findOne();
      resolvedHotelId = firstHotel ? firstHotel._id : new mongoose.Types.ObjectId();
    }

    // 5. Room allocation, pricing, and availability checks (T06)
    const bookedRooms = [];
    const usedRoomIds = new Set();
    let totalRoomAmount = 0;

    for (const roomReq of rooms) {
      let physicalRoom = null;
      let roomType = null;

      if (roomReq.roomId) {
        physicalRoom = await Room.findById(roomReq.roomId).populate('roomTypeId');
        if (!physicalRoom) {
          const error = new Error(`Room with ID ${roomReq.roomId} not found`);
          error.status = 404;
          throw error;
        }

        const isAvailable = await roomService.isRoomAvailable(physicalRoom._id, inDate, outDate);
        if (!isAvailable) {
          const error = new Error(`Room ${physicalRoom.roomNumber} is unavailable for the selected dates`);
          error.status = 409;
          throw error;
        }
        roomType = physicalRoom.roomTypeId;
      } else if (roomReq.roomTypeId) {
        roomType = await RoomType.findById(roomReq.roomTypeId);
        if (!roomType) {
          const error = new Error(`Room type with ID ${roomReq.roomTypeId} not found`);
          error.status = 404;
          throw error;
        }

        physicalRoom = await roomService.findAvailableRoomForType({
          hotelId: resolvedHotelId,
          roomTypeId: roomType._id,
          checkInDate: inDate,
          checkOutDate: outDate
        });

        if (!physicalRoom) {
          const error = new Error(`No available rooms for room type "${roomType.name}" on the selected dates`);
          error.status = 409;
          throw error;
        }
      } else {
        const error = new Error('Each room item must have either roomId or roomTypeId');
        error.status = 400;
        throw error;
      }

      // Check duplicate room in same booking
      if (usedRoomIds.has(String(physicalRoom._id))) {
        const error = new Error(`Duplicate room assignment: Room ${physicalRoom.roomNumber} cannot be booked twice in the same reservation`);
        error.status = 400;
        throw error;
      }
      usedRoomIds.add(String(physicalRoom._id));

      // Calculate total room price across stay nights (accounting for seasonal price if any)
      let roomStayPrice = 0;
      for (let dayIdx = 0; dayIdx < nights; dayIdx++) {
        const currentDay = new Date(inDate.getTime() + dayIdx * 86400000);
        const dayPriceInfo = await roomTypeService.calculatePriceForDate(roomType._id, currentDay);
        roomStayPrice += dayPriceInfo.price;
      }

      const avgPricePerNight = Math.round(roomStayPrice / nights);
      totalRoomAmount += roomStayPrice;

      bookedRooms.push({
        roomId: physicalRoom._id,
        roomTypeId: roomType._id,
        priceAtBooking: avgPricePerNight,
        guestCount: roomReq.guestCount || 1
      });
    }

    // 6. Discount & Coupon Calculation
    let discountAmount = 0;
    if (couponCode) {
      const codeClean = couponCode.trim().toUpperCase();
      // Look up in Coupon collection or fallback to known offers
      const couponDoc = await Coupon.findOne({ code: codeClean, isActive: { $ne: false } });
      if (couponDoc && couponDoc.discountPercent) {
        discountAmount = Math.round((totalRoomAmount * couponDoc.discountPercent) / 100);
      } else if (codeClean === 'LONGSTAY15') {
        discountAmount = Math.round(totalRoomAmount * 0.15);
      } else if (codeClean === 'WELCOME10') {
        discountAmount = Math.round(totalRoomAmount * 0.10);
      }
    }

    const totalAmount = Math.max(0, totalRoomAmount - discountAmount);
    const depositRequired = paymentType === 'deposit' ? Math.round(totalAmount * 0.2) : 0;
    const bookingReference = await this.generateBookingReference();

    // 7. Save Booking document
    const booking = new Booking({
      bookingReference,
      hotelId: resolvedHotelId,
      customerId: customer._id,
      createdBy: customer._id,
      guestName: guestName || customer.customerProfile?.fullName || 'Valued Guest',
      guestPhone: guestPhone || customer.phone || 'N/A',
      checkInDate: inDate,
      checkOutDate: outDate,
      status: 'confirmed',
      rooms: bookedRooms,
      couponCode: couponCode ? couponCode.trim().toUpperCase() : undefined,
      discountAmount,
      roomAmount: totalRoomAmount,
      serviceAmount: 0,
      totalAmount,
      depositRequired,
      currency: 'VND',
      bookingSource: 'online',
      events: [
        {
          actorId: customer._id,
          type: 'created',
          note: `Online reservation created. Payment option: ${paymentType}. Special requests: ${specialRequests || 'None'}`
        }
      ]
    });

    await booking.save();

    return Booking.findById(booking._id)
      .populate('hotelId', 'name city address phone email starRating')
      .populate('rooms.roomTypeId', 'name basePrice maxOccupancy bedType amenities images')
      .populate('rooms.roomId', 'roomNumber floor status');
  }

  /**
   * T10: Get Customer Bookings (Dashboard / My Bookings)
   */
  async getCustomerBookings({ customerId, guestEmail, status }) {
    const query = {};

    if (customerId && mongoose.isValidObjectId(customerId)) {
      query.customerId = customerId;
    } else if (guestEmail) {
      const user = await User.findOne({ email: guestEmail.toLowerCase().trim() });
      if (user) {
        query.customerId = user._id;
      } else {
        return [];
      }
    }

    if (status) {
      if (status === 'upcoming') {
        query.status = { $in: ['pending', 'confirmed'] };
      } else if (status === 'past') {
        query.status = { $in: ['checked_in', 'checked_out', 'cancelled'] };
      } else {
        query.status = status;
      }
    }

    return Booking.find(query)
      .populate('hotelId', 'name city address starRating')
      .populate('rooms.roomTypeId', 'name basePrice bedType images')
      .populate('rooms.roomId', 'roomNumber floor')
      .sort({ createdAt: -1 });
  }

  /**
   * Get Booking by Reference Code (BK-XXXX)
   */
  async getBookingByReference(reference) {
    const booking = await Booking.findOne({ bookingReference: reference.trim().toUpperCase() })
      .populate('hotelId', 'name city address phone email starRating')
      .populate('rooms.roomTypeId', 'name basePrice bedType amenities images')
      .populate('rooms.roomId', 'roomNumber floor');

    if (!booking) {
      const error = new Error(`Booking with reference "${reference}" not found`);
      error.status = 404;
      throw error;
    }
    return booking;
  }

  /**
   * Cancel Reservation
   */
  async cancelReservation(bookingId, { customerId, reason = 'Cancelled by customer' } = {}) {
    const booking = await Booking.findById(bookingId);
    if (!booking) {
      const error = new Error('Booking not found');
      error.status = 404;
      throw error;
    }

    if (!['pending', 'confirmed'].includes(booking.status)) {
      const error = new Error(`Cannot cancel booking with status "${booking.status}". Only pending or confirmed reservations can be cancelled.`);
      error.status = 400;
      throw error;
    }

    const actorId = customerId && mongoose.isValidObjectId(customerId) ? customerId : booking.customerId;

    booking.status = 'cancelled';
    booking.cancelledAt = new Date();
    booking.cancellationReason = reason;
    booking.events.push({
      actorId,
      type: 'cancelled',
      note: reason,
      createdAt: new Date()
    });

    await booking.save();
    return booking;
  }
}

module.exports = new BookingService();
