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

    // 3b. BR-29 Anti-hoarding limit (MSG-79)
    if (customer && customer._id && mongoose.connection.readyState === 1) {
      const pendingCount = await Booking.countDocuments({
        customerId: customer._id,
        status: 'pending'
      });
      if (pendingCount >= 3) {
        const error = new Error('The customer already has 3 pending reservations. Please complete or cancel one before creating a new reservation (BR-29, MSG-79)');
        error.status = 400;
        error.code = 'MSG-79';
        throw error;
      }
    }

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

    // BR-29 & BR-31: Total amount 0 confirmed at once, otherwise online reservation holds room 15 min with status 'pending'
    const initialStatus = totalAmount === 0 ? 'confirmed' : (paymentType === 'none' ? 'confirmed' : 'pending');
    const holdExpiresAt = initialStatus === 'pending' ? new Date(Date.now() + 15 * 60 * 1000) : undefined;

    // 6b. Atomic Concurrency Check: re-verify no overlapping reservation was created
    const conflictingBooking = await Booking.findOne({
      status: { $in: ['pending', 'confirmed', 'checked_in', 'cancellation_requested'] },
      'rooms.roomId': { $in: Array.from(usedRoomIds) },
      checkInDate: { $lt: outDate },
      checkOutDate: { $gt: inDate }
    });
    if (conflictingBooking) {
      const error = new Error('One or more selected rooms were just reserved by another guest. Please select another room or alternative dates.');
      error.status = 409;
      throw error;
    }

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
      status: initialStatus,
      holdExpiresAt,
      rooms: bookedRooms,
      couponCode: couponCode ? couponCode.trim().toUpperCase() : undefined,
      discountAmount,
      roomAmount: totalRoomAmount,
      serviceAmount: 0,
      totalAmount,
      depositRequired,
      currency: 'VND',
      bookingSource: 'online',
      policySnapshot: {
        depositType: 'percentage',
        depositValue: 20,
        cancellationTiers: [
          { minHoursBeforeCheckIn: 48, refundPercent: 100 },
          { minHoursBeforeCheckIn: 0, refundPercent: 0 }
        ]
      },
      events: [
        {
          actorId: customer._id,
          type: 'created',
          note: `Online reservation created with status ${initialStatus}. Payment option: ${paymentType}. Special requests: ${specialRequests || 'None'}`
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
   * Abandon Payment / Cancel Hold (BR-29: POST /api/bookings/:id/cancel-payment)
   * Releases room hold immediately and marks pending booking as expired
   */
  async abandonPayment(bookingId, { customerId } = {}) {
    const booking = await Booking.findById(bookingId);
    if (!booking) {
      const error = new Error('Booking not found');
      error.status = 404;
      throw error;
    }

    if (booking.status !== 'pending') {
      const error = new Error(`Cannot abandon payment for booking with status "${booking.status}". Only pending reservations can be abandoned.`);
      error.status = 400;
      throw error;
    }

    const actorId = customerId && mongoose.isValidObjectId(customerId) ? customerId : booking.customerId;

    booking.status = 'expired';
    booking.events.push({
      actorId,
      type: 'cancelled',
      note: 'Payment abandoned by customer. Room hold released immediately (BR-29).',
      createdAt: new Date()
    });

    await booking.save();
    return booking;
  }

  /**
   * Expire Room Holds Scheduled Job (BR-29: Hold expiry job)
   * Automatically expires pending bookings past holdExpiresAt
   */
  async expireHolds(now = new Date()) {
    const expiredBookings = await Booking.find({
      status: 'pending',
      holdExpiresAt: { $lte: now }
    });

    for (const b of expiredBookings) {
      b.status = 'expired';
      b.events.push({
        actorId: b.customerId,
        type: 'cancelled',
        note: 'Reservation hold expired after 15 minutes without deposit confirmation (BR-29).',
        createdAt: new Date()
      });
      await b.save();
    }
    return expiredBookings.length;
  }

  /**
   * Withdraw Cancellation Request (BR-36: Customer withdraws before receptionist review)
   */
  async withdrawCancellation(bookingId, { customerId } = {}) {
    const booking = await Booking.findById(bookingId);
    if (!booking) {
      const error = new Error('Booking not found');
      error.status = 404;
      throw error;
    }

    if (booking.status !== 'cancellation_requested') {
      const error = new Error(`Cannot withdraw cancellation for booking with status "${booking.status}". Only cancellation_requested reservations can be withdrawn.`);
      error.status = 400;
      throw error;
    }

    const actorId = customerId && mongoose.isValidObjectId(customerId) ? customerId : booking.customerId;

    booking.status = 'confirmed';
    booking.events.push({
      actorId,
      type: 'cancellation_withdrawn',
      note: 'Customer withdrew cancellation request before front-desk review (BR-36).',
      createdAt: new Date()
    });

    await booking.save();
    return booking;
  }

  /**
   * Cancel Reservation (UC08 / BR-16, BR-17, BR-32, BR-36)
   * For pending reservations: cancels immediately and releases hold.
   * For confirmed reservations: calculates refundable amount from policy tiers,
   * stores declared refund account, and transitions to 'cancellation_requested'.
   */
  async cancelReservation(bookingId, { customerId, reason = 'Cancelled by customer', refundAccount } = {}) {
    const booking = await Booking.findById(bookingId);
    if (!booking) {
      const error = new Error('Booking not found');
      error.status = 404;
      throw error;
    }

    // Pending booking: abandon payment directly
    if (booking.status === 'pending') {
      return this.abandonPayment(bookingId, { customerId });
    }

    if (!['pending', 'confirmed'].includes(booking.status)) {
      const error = new Error(`Cannot cancel booking with status "${booking.status}". Only pending or confirmed reservations can be cancelled.`);
      error.status = 400;
      throw error;
    }

    const actorId = customerId && mongoose.isValidObjectId(customerId) ? customerId : booking.customerId;
    const now = new Date();
    const checkInTime = new Date(booking.checkInDate);
    const hoursBeforeCheckIn = (checkInTime.getTime() - now.getTime()) / (1000 * 60 * 60);

    // Calculate refundable percent based on snapshot policy tiers (BR-32)
    let refundPercent = 0;
    const tiers = booking.policySnapshot?.cancellationTiers;
    if (Array.isArray(tiers) && tiers.length > 0) {
      const matched = tiers.find(t => hoursBeforeCheckIn >= (t.minHoursBeforeCheckIn || 0));
      if (matched) refundPercent = matched.refundPercent;
    } else {
      refundPercent = hoursBeforeCheckIn >= 48 ? 100 : 0;
    }

    const depositAmount = booking.depositRequired || booking.paidAmount || (booking.totalAmount * 0.2);
    const refundableAmount = refundPercent > 0 ? Math.round((depositAmount * refundPercent) / 100) : 0;

    // BR-16, BR-17: If refundable amount > 0, booking becomes cancellation_requested
    if (refundableAmount > 0) {
      booking.status = 'cancellation_requested';
      booking.cancellation = {
        requestedAt: now,
        reason,
        requestedBy: actorId,
        refundableAmount
      };
      if (refundAccount) {
        booking.refundAccount = {
          bank: refundAccount.bank || '',
          accountNumber: refundAccount.accountNumber || '',
          holderName: refundAccount.holderName || booking.guestName || '',
          status: 'declared'
        };
      }
      booking.events.push({
        actorId,
        type: 'cancellation_requested',
        note: `Cancellation requested. Estimated refundable deposit: ${refundableAmount} VND. Reason: ${reason}`,
        createdAt: now
      });
    } else {
      // 0% refund tier or zero deposit: cancel immediately
      booking.status = 'cancelled';
      booking.cancelledAt = now;
      booking.cancellationReason = reason;
      booking.events.push({
        actorId,
        type: 'cancelled',
        note: `Cancelled immediately (0% refund tier). Reason: ${reason}`,
        createdAt: now
      });
    }

    await booking.save();
    return booking;
  }

  /**
   * UC07: Modify Customer / Reception Reservation
   * Allows updating checkInDate, checkOutDate, guestCount, specialRequests.
   * Revalidates room availability for new dates (excluding this booking).
   * Enforces BR-46: dates can only be changed if cancellation is eligible for 100% refund.
   * Recalculates total stay amount, discounts, and logs 'modified' event.
   */
  async modifyReservation(bookingId, { customerId, checkInDate, checkOutDate, specialRequests, guestCount }) {
    const booking = await Booking.findById(bookingId);
    if (!booking) {
      const error = new Error('Booking not found');
      error.status = 404;
      throw error;
    }

    if (!['pending', 'confirmed'].includes(booking.status)) {
      const error = new Error(`Cannot modify booking with status "${booking.status}". Only pending or confirmed reservations can be modified.`);
      error.status = 400;
      throw error;
    }

    // Permission check if customerId specified
    if (customerId && mongoose.isValidObjectId(customerId)) {
      if (String(booking.customerId) !== String(customerId)) {
        const error = new Error('Unauthorized to modify this reservation');
        error.status = 403;
        throw error;
      }
    }

    const oldValues = {
      checkInDate: booking.checkInDate,
      checkOutDate: booking.checkOutDate,
      totalAmount: booking.totalAmount,
      roomAmount: booking.roomAmount
    };

    let datesChanged = false;
    let targetInDate = booking.checkInDate;
    let targetOutDate = booking.checkOutDate;

    if (checkInDate || checkOutDate) {
      const newIn = checkInDate ? new Date(checkInDate) : new Date(booking.checkInDate);
      const newOut = checkOutDate ? new Date(checkOutDate) : new Date(booking.checkOutDate);

      if (isNaN(newIn.getTime()) || isNaN(newOut.getTime())) {
        const error = new Error('Invalid date format for checkInDate or checkOutDate');
        error.status = 400;
        throw error;
      }

      if (newOut <= newIn) {
        const error = new Error('checkOutDate must be after checkInDate');
        error.status = 400;
        throw error;
      }

      targetInDate = newIn;
      targetOutDate = newOut;
      datesChanged = true;
    }

    // BR-46: Changing stay dates of a Confirmed booking requires full refund eligibility
    if (datesChanged && booking.status === 'confirmed') {
      const now = new Date();
      const checkInTime = new Date(booking.checkInDate);
      const hoursBeforeCheckIn = (checkInTime.getTime() - now.getTime()) / (1000 * 60 * 60);
      let isFullRefundEligible = false;
      const tiers = booking.policySnapshot?.cancellationTiers;
      if (Array.isArray(tiers) && tiers.length > 0) {
        const matched = tiers.find(t => hoursBeforeCheckIn >= (t.minHoursBeforeCheckIn || 0));
        isFullRefundEligible = matched && matched.refundPercent === 100;
      } else {
        isFullRefundEligible = hoursBeforeCheckIn >= 48;
      }

      if (!isFullRefundEligible) {
        const error = new Error('Stay dates cannot be modified because cancellation is no longer eligible for a full refund (BR-46, MSG-78)');
        error.status = 400;
        error.code = 'MSG-78';
        throw error;
      }
    }

    const nights = Math.max(1, Math.round((targetOutDate - targetInDate) / 86400000));

    // If dates changed, verify room availability for the updated range
    if (datesChanged) {
      let updatedTotalRoomAmount = 0;
      const updatedRooms = [];

      for (const item of booking.rooms) {
        const physicalRoom = await Room.findById(item.roomId);
        if (!physicalRoom) {
          const error = new Error(`Room with ID ${item.roomId} not found`);
          error.status = 404;
          throw error;
        }

        // Check if current room is available on the new dates (excluding this booking)
        const isFree = await roomService.isRoomAvailable(physicalRoom._id, targetInDate, targetOutDate, booking._id);
        let assignedRoom = physicalRoom;

        if (!isFree) {
          // Try to reassign to another available room of the same roomTypeId
          const replacement = await roomService.findAvailableRoomForType({
            hotelId: booking.hotelId,
            roomTypeId: item.roomTypeId,
            checkInDate: targetInDate,
            checkOutDate: targetOutDate,
            excludeBookingId: booking._id
          });

          if (!replacement) {
            const error = new Error(`Room ${physicalRoom.roomNumber} is unavailable for the selected dates and no replacement of type is available.`);
            error.status = 409;
            throw error;
          }
          assignedRoom = replacement;
        }

        // Recalculate price across new nights
        let stayPrice = 0;
        for (let d = 0; d < nights; d++) {
          const currentDay = new Date(targetInDate.getTime() + d * 86400000);
          const priceInfo = await roomTypeService.calculatePriceForDate(item.roomTypeId, currentDay);
          stayPrice += priceInfo.price;
        }

        const avgPrice = Math.round(stayPrice / nights);
        updatedTotalRoomAmount += stayPrice;

        updatedRooms.push({
          roomId: assignedRoom._id,
          roomTypeId: item.roomTypeId,
          priceAtBooking: avgPrice,
          guestCount: guestCount || item.guestCount || 1
        });
      }

      // Re-evaluate discount if coupon was applied
      let discountAmount = 0;
      if (booking.couponCode) {
        const couponDoc = await Coupon.findOne({ code: booking.couponCode });
        if (couponDoc && couponDoc.discountPercent) {
          discountAmount = Math.round((updatedTotalRoomAmount * couponDoc.discountPercent) / 100);
        } else if (booking.couponCode === 'LONGSTAY15') {
          discountAmount = Math.round(updatedTotalRoomAmount * 0.15);
        } else if (booking.couponCode === 'WELCOME10') {
          discountAmount = Math.round(updatedTotalRoomAmount * 0.10);
        }
      }

      const newTotal = Math.max(0, updatedTotalRoomAmount - discountAmount + (booking.serviceAmount || 0));
      const newDeposit = Math.round(newTotal * 0.2);

      booking.checkInDate = targetInDate;
      booking.checkOutDate = targetOutDate;
      booking.rooms = updatedRooms;
      booking.roomAmount = updatedTotalRoomAmount;
      booking.discountAmount = discountAmount;
      booking.totalAmount = newTotal;
      booking.depositRequired = newDeposit;
    }

    const actorId = customerId && mongoose.isValidObjectId(customerId) ? customerId : booking.customerId;
    booking.events.push({
      actorId,
      type: 'modified',
      note: `Reservation modified. Dates: ${targetInDate.toISOString().slice(0, 10)} → ${targetOutDate.toISOString().slice(0, 10)}. Special requests: ${specialRequests || 'None'}`,
      oldValue: oldValues,
      newValue: {
        checkInDate: targetInDate,
        checkOutDate: targetOutDate,
        totalAmount: booking.totalAmount,
        roomAmount: booking.roomAmount
      },
      createdAt: new Date()
    });

    await booking.save();

    return Booking.findById(booking._id)
      .populate('hotelId', 'name city address starRating')
      .populate('rooms.roomTypeId', 'name basePrice bedType images')
      .populate('rooms.roomId', 'roomNumber floor');
  }

  /**
   * UC37: Occupancy Report (W1-M2-1, W3-M2-1, W6-M2-2)
   * Formula: Occupancy Rate = (Occupied Room-Nights / Sellable Room-Nights) * 100%
   * - Denominator: Total physical rooms * nights - Maintenance/Blocked room-nights
   * - Numerator: Room-nights from bookings with status 'confirmed', 'checked_in', 'checked_out'
   */
  async getOccupancyReport({ hotelId, startDate, endDate, groupBy = 'day' }) {
    // 1. Determine date range
    const startStr = startDate ? String(startDate).slice(0, 10) : new Date(Date.now() - 29 * 86400000).toISOString().slice(0, 10);
    const endStr = endDate ? String(endDate).slice(0, 10) : new Date().toISOString().slice(0, 10);

    if (endStr < startStr) {
      const error = new Error('endDate must be after startDate');
      error.status = 400;
      throw error;
    }

    const start = new Date(startStr + 'T00:00:00.000Z');
    const end = new Date(endStr + 'T23:59:59.999Z');

    // 2. Fetch all physical rooms for this hotel
    const roomFilter = {};
    if (hotelId && mongoose.isValidObjectId(hotelId)) {
      roomFilter.hotelId = hotelId;
    }

    const allRooms = await Room.find(roomFilter).populate('roomTypeId', 'name basePrice');
    const totalPhysicalRooms = allRooms.length;

    // 3. Fetch overlapping active bookings in the period
    const bookingQuery = {
      status: { $in: ['confirmed', 'checked_in', 'checked_out'] },
      checkInDate: { $lte: end },
      checkOutDate: { $gte: start }
    };
    if (hotelId && mongoose.isValidObjectId(hotelId)) {
      bookingQuery.hotelId = hotelId;
    }
    const bookings = await Booking.find(bookingQuery);

    // 4. Daily series calculation
    const series = [];
    const roomTypeStats = {};

    // Initialize room type stats
    for (const r of allRooms) {
      const typeName = r.roomTypeId?.name || 'Standard';
      if (!roomTypeStats[typeName]) {
        roomTypeStats[typeName] = { totalRooms: 0, occupiedNights: 0, sellableNights: 0 };
      }
      roomTypeStats[typeName].totalRooms += 1;
    }

    const currentCursor = new Date(start);
    while (currentCursor <= end) {
      const dateStr = currentCursor.toISOString().slice(0, 10);

      // Count maintenance / blocked rooms on this day
      const maintenanceRoomsCount = allRooms.filter(r => r.status === 'maintenance').length;
      const sellableRooms = Math.max(0, totalPhysicalRooms - maintenanceRoomsCount);

      // Count occupied rooms on this night (a booking covers night dateStr if checkIn <= dateStr and checkOut > dateStr)
      let occupiedCount = 0;
      for (const b of bookings) {
        const bInStr = new Date(b.checkInDate).toISOString().slice(0, 10);
        const bOutStr = new Date(b.checkOutDate).toISOString().slice(0, 10);
        if (bInStr <= dateStr && bOutStr > dateStr) {
          occupiedCount += (b.rooms?.length || 1);
          // Track room type stats
          for (const rm of (b.rooms || [])) {
            const matchedRoom = allRooms.find(r => String(r._id) === String(rm.roomId));
            const tName = matchedRoom?.roomTypeId?.name || 'Standard';
            if (roomTypeStats[tName]) {
              roomTypeStats[tName].occupiedNights += 1;
            }
          }
        }
      }

      // Add sellable nights to room type stats
      for (const tName of Object.keys(roomTypeStats)) {
        roomTypeStats[tName].sellableNights += roomTypeStats[tName].totalRooms;
      }

      // Cap occupied count at sellable count for realistic metric
      const effectiveOccupied = Math.min(occupiedCount, sellableRooms);
      const occupancyRate = sellableRooms > 0
        ? Math.round((effectiveOccupied / sellableRooms) * 1000) / 10
        : 0;

      series.push({
        date: dateStr,
        totalRooms: totalPhysicalRooms,
        maintenanceRooms: maintenanceRoomsCount,
        sellableRooms,
        occupiedRooms: effectiveOccupied,
        occupancyRate
      });

      // Advance by 1 UTC day
      currentCursor.setUTCDate(currentCursor.getUTCDate() + 1);
    }

    // 5. Calculate overall period totals
    const totalSellableNights = series.reduce((sum, d) => sum + d.sellableRooms, 0);
    const totalOccupiedNights = series.reduce((sum, d) => sum + d.occupiedRooms, 0);
    const totalMaintenanceNights = series.reduce((sum, d) => sum + d.maintenanceRooms, 0);
    const averageOccupancyRate = totalSellableNights > 0
      ? Math.round((totalOccupiedNights / totalSellableNights) * 1000) / 10
      : 0;

    // Room type summary list
    const roomTypeBreakdown = Object.entries(roomTypeStats).map(([name, stat]) => ({
      roomType: name,
      totalRooms: stat.totalRooms,
      sellableNights: stat.sellableNights,
      occupiedNights: stat.occupiedNights,
      occupancyRate: stat.sellableNights > 0
        ? Math.round((stat.occupiedNights / stat.sellableNights) * 1000) / 10
        : 0
    }));

    return {
      hotelId: hotelId || 'all',
      from: start.toISOString().slice(0, 10),
      to: end.toISOString().slice(0, 10),
      totals: {
        totalPhysicalRooms,
        totalSellableNights,
        totalOccupiedNights,
        totalMaintenanceNights,
        averageOccupancyRate
      },
      series,
      roomTypeBreakdown
    };
  }

  /**
   * Search Bookings (Shared filter register for Customer, Receptionist, Manager)
   */
  async searchBookings({
    hotelId,
    customerId,
    status,
    reference,
    guestName,
    guestEmail,
    guestPhone,
    checkInFrom,
    checkInTo,
    page = 1,
    limit = 20
  } = {}) {
    const query = {};

    if (hotelId && mongoose.isValidObjectId(hotelId)) query.hotelId = hotelId;
    if (customerId && mongoose.isValidObjectId(customerId)) query.customerId = customerId;
    if (status) query.status = status;
    if (reference) query.bookingReference = new RegExp(reference.trim(), 'i');
    if (guestName) query.guestName = new RegExp(guestName.trim(), 'i');
    if (guestPhone) query.guestPhone = new RegExp(guestPhone.trim(), 'i');

    if (checkInFrom || checkInTo) {
      query.checkInDate = {};
      if (checkInFrom) query.checkInDate.$gte = new Date(checkInFrom);
      if (checkInTo) query.checkInDate.$lte = new Date(checkInTo);
    }

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.max(1, Math.min(100, parseInt(limit, 10) || 20));

    const [data, total] = await Promise.all([
      Booking.find(query)
        .populate('hotelId', 'name city')
        .populate('rooms.roomTypeId', 'name basePrice')
        .populate('rooms.roomId', 'roomNumber floor')
        .sort({ createdAt: -1 })
        .skip((pageNum - 1) * limitNum)
        .limit(limitNum),
      Booking.countDocuments(query)
    ]);

    return {
      data,
      meta: {
        page: pageNum,
        limit: limitNum,
        total,
        pages: Math.ceil(total / limitNum) || 1
      }
    };
  }
}

module.exports = new BookingService();
