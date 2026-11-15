const Room = require('../models/Room');
const RoomType = require('../models/RoomType');
const Booking = require('../models/Booking');

class RoomService {
  // Lọc danh sách phòng theo khách sạn, tầng, trạng thái và loại phòng.
  async getAllRooms(filter = {}) {
    const query = {};
    if (filter.hotelId) query.hotelId = filter.hotelId;
    if (filter.floor !== undefined) query.floor = Number(filter.floor);
    if (filter.status) query.status = filter.status;
    if (filter.roomTypeId) query.roomTypeId = filter.roomTypeId;

    return Room.find(query)
      .populate('roomTypeId', 'name basePrice maxOccupancy bedType')
      .sort({ floor: 1, roomNumber: 1 });
  }

  // Lấy chi tiết một phòng theo mã.
  async getRoomById(id) {
    const room = await Room.findById(id)
      .populate('roomTypeId');
    if (!room) {
      const error = new Error('Room not found');
      error.status = 404;
      throw error;
    }
    return room;
  }

  // Tạo phòng mới sau khi kiểm tra dữ liệu liên quan.
  async createRoom(data) {
    const existing = await Room.findOne({ hotelId: data.hotelId, roomNumber: data.roomNumber.trim() });
    if (existing) {
      const error = new Error(`Room number "${data.roomNumber}" already exists in this hotel.`);
      error.status = 409;
      throw error;
    }

    // Kiểm tra loại phòng thuộc đúng khách sạn.
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

  // Cập nhật thông tin phòng theo dữ liệu hợp lệ.
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
      .populate('roomTypeId');
    if (!room) {
      const error = new Error('Room not found');
      error.status = 404;
      throw error;
    }
    return room;
  }

  // Đổi trạng thái vận hành giữa trống, có khách, đang dọn và bảo trì.
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

  // Xóa phòng sau khi kiểm tra điều kiện sử dụng.
  async deleteRoom(id) {
    const room = await Room.findById(id);
    if (!room) {
      const error = new Error('Room not found');
      error.status = 404;
      throw error;
    }

    // Không xóa phòng đang có khách.
    if (room.status === 'occupied') {
      const error = new Error('Cannot delete an occupied room.');
      error.status = 400;
      throw error;
    }

    await Room.findByIdAndDelete(id);
    return { success: true, message: `Room ${room.roomNumber} deleted successfully` };
  }

  // Tìm phòng đang hoạt động, không bảo trì và không bị booking chồng lịch giữ.
  async searchAvailableRooms({ hotelId, checkInDate, checkOutDate, guests = 1, minPrice, maxPrice }) {
    let inDate = null;
    let outDate = null;

    // Kiểm tra ngày tìm kiếm trước khi truy vấn.
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
    // Giới hạn dữ liệu theo mô hình một khách sạn.

    let availableRooms = await Room.find(query).populate('roomTypeId');

    // Nếu có ngày lưu trú, loại các phòng đã được đặt trong kỳ.
    if (inDate && outDate) {

      // Tìm booking giao với khoảng ngày yêu cầu.
      const conflictingBookings = await Booking.find({
        // Booking hết thời gian giữ không tiếp tục chặn phòng.
        ...require('./roomInventory').sellingFilter(),
        checkInDate: { $lt: outDate },
        checkOutDate: { $gt: inDate }
      }).select('rooms.roomId');

      const bookedRoomIds = new Set();
      for (const b of conflictingBookings) {
        for (const item of b.rooms) {
          if (item.roomId) bookedRoomIds.add(String(item.roomId));
        }
      }

      // Loại phòng đang bị booking khác giữ.
      availableRooms = availableRooms.filter(r => !bookedRoomIds.has(String(r._id)));
    }

    // Lọc thêm theo sức chứa và mức giá nếu có yêu cầu.
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

  // Kiểm tra một phòng cụ thể có trống trong khoảng ngày yêu cầu không.
  async isRoomAvailable(roomId, checkInDate, checkOutDate, excludeBookingId = null) {
    const room = await Room.findById(roomId);
    if (!room || room.isActive === false || room.status === 'maintenance') {
      return false;
    }

    const inDate = new Date(checkInDate);
    const outDate = new Date(checkOutDate);

    const query = {
      status: { $in: ['pending', 'confirmed', 'cancellation_requested', 'checked_in'] },
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

  // Tìm phòng trống thuộc loại yêu cầu cho toàn kỳ lưu trú.
  async findAvailableRoomForType({ hotelId, roomTypeId, checkInDate, checkOutDate, excludeBookingId = null }) {
    const inDate = new Date(checkInDate);
    const outDate = new Date(checkOutDate);

    const roomQuery = {
      roomTypeId,
      status: { $ne: 'maintenance' },
      isActive: { $ne: false }
    };
    // Phòng được liên kết bằng roomTypeId trong mô hình một khách sạn.

    const candidateRooms = await Room.find(roomQuery);
    if (!candidateRooms.length) return null;

    const candidateIds = candidateRooms.map(r => r._id);

    // Tìm booking chồng lịch trên các phòng ứng viên.
    const bookingQuery = {
      status: { $in: ['pending', 'confirmed', 'cancellation_requested', 'checked_in'] },
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

    // Chọn phòng đầu tiên còn trống.
    return candidateRooms.find(r => !bookedIds.has(String(r._id))) || null;
  }
}

module.exports = new RoomService();
