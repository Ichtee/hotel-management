const mongoose = require("mongoose");
const RoomType = require("../models/RoomType");
const Room = require("../models/Room");
const Booking = require("../models/Booking");
const Review = require("../models/Review");
const v = require("../utils/validation");
const fields = require("../utils/managerValidation");
const { hotelTransaction } = require("../services/hotelOperations");
const { logChange } = require("../services/audit");
const visibleStatuses = ["visible", "approved"];

// Kiểm tra dữ liệu loại phòng; giá theo mùa có luồng cập nhật riêng.
function validate(body, creating = false) {
  fields.body(body, ["name", "description", "basePrice", "maxOccupancy", "amenities", "images", "bedType", "roomSizeSqm", "isActive"]);
  const data = {};
  if (creating || body.name !== undefined) data.name = v.text(body.name, "name", 1, 100);
  if (creating || body.basePrice !== undefined) data.basePrice = v.number(body.basePrice, "basePrice", 1);
  if (creating || body.maxOccupancy !== undefined) data.maxOccupancy = v.number(body.maxOccupancy, "maxOccupancy", 1, 100);
  for (const key of ["description", "bedType"])
    if (body[key] !== undefined) data[key] = v.text(body[key], key, 0, key === "description" ? 5000 : 100);
  if (body.amenities !== undefined) data.amenities = fields.strings(body.amenities, "amenities");
  if (body.images !== undefined) data.images = fields.images(body.images);
  if (body.roomSizeSqm !== undefined) {
    if (typeof body.roomSizeSqm !== "number" || !Number.isFinite(body.roomSizeSqm) || body.roomSizeSqm <= 0)
      v.fail("Room size must be positive.", "roomSizeSqm");
    data.roomSizeSqm = body.roomSizeSqm;
  }
  if (body.isActive !== undefined) data.isActive = v.boolean(body.isActive, "isActive");
  return data;
}

// Tính điểm từ đánh giá đang công khai, không dùng điểm trung bình cũ.
async function reviewSummary(id) {
  const rows = await Review.aggregate([
    { $match: { roomTypeId: new mongoose.Types.ObjectId(id), status: { $in: visibleStatuses } } },
    { $group: { _id: null, count: { $sum: 1 }, averageRating: { $avg: "$rating" } } },
  ]);
  return rows.length ? { count: rows[0].count, averageRating: rows[0].averageRating } : { count: 0, averageRating: null };
}

// Liệt kê loại phòng cho quản lý với bộ lọc và phân trang.
async function listing(req, res) {
  v.keys(req.query, ["q", "status", "page", "limit"]);
  const filter = { name: v.search(req.query) };
  if (req.query.status !== undefined) filter.isActive = v.choice(req.query.status, "status", ["active", "inactive"]) === "active";
  res.json(await v.list(RoomType, filter, req.query));
}

// Trả chi tiết loại phòng, số lượng và điểm đánh giá công khai.
async function detail(req, res) {
  const id = v.id(req.params.id);
  const data = await RoomType.findById(id).lean();
  if (!data) throw new v.HttpError(404, "Room type not found.");
  data.reviewSummary = await reviewSummary(id);
  res.json({ data });
}

// Tạo loại phòng và ghi nhật ký trong cùng giao dịch.
async function create(req, res) {
  const input = validate(req.body, true);
  const data = await hotelTransaction(async (session) => {
    const [type] = await RoomType.create([input], { session });
    await logChange(req, "room_type.created", "RoomType", type._id, { after: type.toObject() }, session);
    return type;
  });
  res.status(201).json({ data });
}

// Sửa loại phòng, giữ nguyên phòng và dữ liệu đã chốt trên booking cũ.
async function update(req, res) {
  const input = validate(req.body);
  const id = v.id(req.params.id);
  const data = await hotelTransaction(async (session) => {
    const type = await RoomType.findById(id).session(session);
    if (!type) throw new v.HttpError(404, "Room type not found.");
    const before = type.toObject();
    Object.assign(type, input);
    await type.save({ session });
    await logChange(req, "room_type.updated", "RoomType", type._id, { before, after: type.toObject() }, session);
    return type;
  });
  res.json({ data });
}

// Chặn xóa loại phòng còn dữ liệu liên quan, gồm cả giá theo mùa.
async function remove(req, res) {
  const id = v.id(req.params.id);
  await hotelTransaction(async (session) => {
    const type = await RoomType.findById(id).session(session);
    if (!type) throw new v.HttpError(404, "Room type not found.");
    const linkedRoom = await Room.exists({ roomTypeId: id }).session(session);
    const linkedBooking = await Booking.exists({ "rooms.roomTypeId": id }).session(session);
    const linkedReview = await Review.exists({ roomTypeId: id }).session(session);
    if (linkedRoom || linkedBooking || linkedReview || type.seasonalPricing.length) {
      const error = new v.HttpError(409, "This room type has linked data. Deactivate it instead.");
      error.code = "MSG-19";
      throw error;
    }
    await type.deleteOne({ session });
    await logChange(req, "room_type.deleted", "RoomType", type._id, { before: type.toObject() }, session);
  });
  res.json({ data: { message: "Room type deleted." } });
}

// Quản lý xem được đánh giá ẩn; khách chỉ xem đánh giá công khai.
async function reviews(req, res) {
  const id = v.id(req.params.id);
  const publicView = req.path.startsWith("/api/public/");
  v.keys(req.query, publicView ? ["page", "limit"] : ["page", "limit", "status"]);
  if (!await RoomType.exists({ _id: id, ...(publicView ? { isActive: true } : {}) }))
    throw new v.HttpError(404, "Room type not found.");
  const filter = { roomTypeId: id };
  if (publicView) filter.status = { $in: visibleStatuses };
  else if (req.query.status !== undefined) filter.status = v.choice(req.query.status, "status", Review.schema.path("status").enumValues);
  const result = await v.list(Review, filter, req.query, publicView ? "rating title comment hotelResponse createdAt" : undefined);
  result.meta.summary = await reviewSummary(id);
  res.json(result);
}

// Ẩn hoặc hiện đánh giá, ghi lý do và người xử lý vào nhật ký.
async function visibility(req, res) {
  v.keys(req.body, ["hidden", "reason"]);
  const hidden = v.boolean(req.body.hidden, "hidden");
  const reason = hidden ? v.text(req.body.reason, "reason", 1, 500) : undefined;
  const id = v.id(req.params.id);
  const data = await hotelTransaction(async (session) => {
    const review = await Review.findById(id).session(session);
    if (!review) throw new v.HttpError(404, "Review not found.");
    const before = review.toObject();
    review.status = hidden ? "hidden" : "visible";
    review.hiddenReason = reason;
    review.moderatedBy = req.user._id;
    review.moderatedAt = new Date();
    await review.save({ session });
    await logChange(req, "review.visibility_changed", "Review", review._id, { before, after: review.toObject() }, session);
    return review;
  });
  res.json({ data });
}
// Gửi đánh giá cho booking đã hoàn tất lưu trú.
async function submitReview(req, res) {
  const { bookingId, rating, title, comment } = req.body;
  if (!bookingId) throw new v.HttpError(400, "Booking ID is required.");
  const numRating = Number(rating);
  if (!Number.isInteger(numRating) || numRating < 1 || numRating > 5) {
    throw new v.HttpError(400, "Rating must be an integer between 1 and 5.");
  }

  const booking = await Booking.findById(bookingId);
  if (!booking) throw new v.HttpError(404, "Booking not found.");

  const userId = req.user?._id;
  if (!userId || (booking.customerId && String(booking.customerId) !== String(userId))) {
    throw new v.HttpError(403, "You can only review your own booking.");
  }

  if (booking.status !== "checked_out") {
    throw new v.HttpError(400, "You can only review a booking after checkout (BR-23).");
  }

  const existing = await Review.findOne({ bookingId: booking._id });
  if (existing) {
    throw new v.HttpError(409, "A review has already been submitted for this booking.");
  }

  const roomTypeId = booking.rooms?.[0]?.roomTypeId || booking.roomTypeId;
  if (!roomTypeId) {
    throw new v.HttpError(400, "Room type not found on booking.");
  }

  const review = await Review.create({
    customerId: userId,
    bookingId: booking._id,
    roomTypeId,
    rating: numRating,
    title: title ? String(title).trim() : undefined,
    comment: comment ? String(comment).trim() : undefined,
    status: "visible"
  });

  res.status(201).json({
    data: review,
    message: "Review submitted successfully"
  });
}

// Lấy đánh giá của khách đang đăng nhập.
async function customerReviews(req, res) {
  const userId = req.user?._id;
  if (!userId) return res.json({ data: [] });
  const reviews = await Review.find({ customerId: userId }).lean();
  res.json({ data: reviews });
}

module.exports = { listing, detail, create, update, remove, reviews, visibility, submitReview, customerReviews };
