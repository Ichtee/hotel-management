const Booking = require("../models/Booking");
const RoomType = require("../models/RoomType");
const Request = require("../models/CheckInOutRequest");
const { currentCancellationPolicy } = require("../services/policies");
const { notify, notifyRole } = require("../services/notifications");
const v = require("../utils/validation");
const idPhoto = require("../services/idPhoto");
const { dropPhotos } = idPhoto;
const { audit } = require("../services/audit");

const parseTime = (value) => {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) v.fail("Enter a valid requested time.", "requestedTime");
  return new Date(value);
};
const bookingMoment = (date, time) => new Date(`${new Date(date).toISOString().slice(0, 10)}T${time}:00+07:00`);
// Lỗi gửi thông báo không hủy yêu cầu đã lưu.
const quiet = (p) => p.catch((e) => console.error("Notification failed:", e.message));

// Cho yêu cầu nhận phòng trước giờ nhận của booking đã xác nhận; yêu cầu trả khi đang ở.
async function create(req, res) {
  v.keys(req.body, ["type", "requestedTime", "note", "numberOfGuests", "mainGuestName", "mainGuestIdNumber", "idPhoto"]);
  const booking = await Booking.findOne({ _id: v.id(req.params.id), customerId: req.user._id });
  if (!booking) throw new v.HttpError(404, "Booking not found.");
  const type = v.choice(req.body.type, "type", ["check_in", "check_out"]);
  const policy = await currentCancellationPolicy();
  const checkInAt = bookingMoment(booking.checkInDate, policy?.checkInTime || "14:00");
  if ((type === "check_in" && (booking.status !== "confirmed" || new Date() >= checkInAt)) || (type === "check_out" && booking.status !== "checked_in"))
    throw new v.HttpError(409, "This booking cannot accept that request in its current status.");
  // Mỗi loại chỉ có một yêu cầu đang mở; cần rút yêu cầu cũ trước khi gửi lại.
  if (await Request.exists({ bookingId: booking._id, type, status: { $in: ["pending", "approved"] } }))
    throw new v.HttpError(409, "There is already an open request of this type for this booking. Withdraw it first.");
  const requestedTime = parseTime(req.body.requestedTime);
  const data = { bookingId: booking._id, customerId: req.user._id, type, requestedTime, note: v.text(req.body.note || "", "note", 0, 1000) };
  if (type === "check_in") {
    const roomType = await RoomType.findById(booking.rooms[0].roomTypeId).select("maxOccupancy");
    data.numberOfGuests = v.number(req.body.numberOfGuests, "numberOfGuests", 1, roomType?.maxOccupancy || 20);
    data.mainGuestName = v.text(req.body.mainGuestName, "mainGuestName", 2, 80);
    // Số giấy tờ không bắt buộc ở bước này; lễ tân đối chiếu bản gốc khi nhận phòng.
    if (req.body.mainGuestIdNumber) data.mainGuestIdNumber = v.text(req.body.mainGuestIdNumber, "mainGuestIdNumber", 3, 40);
  }
  if (req.body.idPhoto) {
    if (!idPhoto.ownsPhoto(req.user._id, req.body.idPhoto)) v.fail("The ID photo is not valid. Upload it again.", "idPhoto");
    Object.assign(data, { idPhoto: req.body.idPhoto, hasIdPhoto: true });
  }
  const standard = type === "check_in" ? checkInAt : bookingMoment(booking.checkOutDate, policy?.checkOutTime || "12:00");
  const early = type === "check_in" && requestedTime < standard;
  const late = type === "check_out" && requestedTime > standard;
  if (late && requestedTime > bookingMoment(booking.checkOutDate, "18:00"))
    v.fail("A late check-out can be requested until 18:00 at the latest. To stay another night, ask the front desk to extend the stay.", "requestedTime");
  data.earlyOrLate = early || late;
  data.quotedFee = early ? policy?.earlyCheckInFee || 0 : late ? policy?.lateCheckOutFee || 0 : 0;
  // Tự duyệt nếu không nhận sớm hoặc trả muộn.
  if (!data.earlyOrLate) Object.assign(data, { status: "approved", handledAt: new Date() });
  const request = await Request.create(data);
  const reference = booking.bookingReference;
  await quiet(notifyRole("stay_request_submitted", "receptionist", { reference, type, auto: !data.earlyOrLate }, { bookingId: booking._id }));
  res.status(201).json({ data: request, message: "Your request has been sent to the front desk. You will be notified of the decision." });
}

// Khách rút yêu cầu đang mở mà không bị tính phí.
async function withdraw(req, res) {
  const request = await Request.findOneAndUpdate(
    { _id: v.id(req.params.requestId), bookingId: v.id(req.params.id), customerId: req.user._id, status: { $in: ["pending", "approved"] } },
    { $set: { status: "cancelled" } },
    { new: true },
  );
  if (!request) throw new v.HttpError(409, "There is no open request to withdraw.");
  await dropPhotos({ _id: request._id });
  res.json({ data: request, message: "Your request was withdrawn." });
}

async function listing(req, res) {
  v.keys(req.query, ["status", "page", "limit"]);
  const filter = {};
  if (req.query.status !== undefined) filter.status = v.choice(req.query.status, "status", ["pending", "approved", "rejected", "completed", "cancelled"]);
  const result = await v.list(Request, filter, req.query);
  result.data = await Request.populate(result.data, [{ path: "bookingId", select: "bookingReference guestName guestPhone checkInDate checkOutDate status" }, { path: "customerId", select: "customerProfile.fullName email phone" }]);
  res.json(result);
}

// Lễ tân duyệt hoặc từ chối kèm lý do; chỉ báo phí, chưa thu tiền.
async function handle(req, res) {
  v.keys(req.body, ["action", "responseNote"]);
  const action = v.choice(req.body.action, "action", ["approve", "reject"]);
  const request = await Request.findById(v.id(req.params.id));
  if (!request) throw new v.HttpError(404, "Request not found.");
  if (request.status !== "pending") throw new v.HttpError(409, "This request has already been handled.");
  const responseNote = v.text(req.body.responseNote || "", "responseNote", action === "reject" ? 2 : 0, 1000);
  request.status = action === "approve" ? "approved" : "rejected";
  request.handledBy = req.user._id; request.handledAt = new Date(); request.responseNote = responseNote;
  await request.save();
  const booking = await Booking.findById(request.bookingId).select("bookingReference");
  await quiet(notify("stay_request_decided", request.customerId, { reference: booking?.bookingReference, type: request.type, approved: action === "approve", fee: request.quotedFee, note: responseNote }, { bookingId: request.bookingId }));
  res.json({ data: request });
}

// Ký tham số để khách tải ảnh riêng tư trực tiếp lên Cloudinary.
async function photoUploadParams(req, res) {
  if (!(await Booking.exists({ _id: v.id(req.params.id), customerId: req.user._id, status: "confirmed" }))) throw new v.HttpError(404, "Booking not found.");
  res.json({ data: idPhoto.uploadParams(req.user._id) });
}
// Cấp liên kết ảnh hạn năm phút và ghi nhật ký mỗi lần xem.
async function photoLink(req, res) {
  const r = await Request.findOne({ _id: v.id(req.params.id), hasIdPhoto: true }).select("+idPhoto bookingId");
  if (!r?.idPhoto) throw new v.HttpError(404, "There is no ID photo for this request.");
  await audit(req.user._id, "stay_request.id_photo_viewed", "booking", r.bookingId, { requestId: r._id });
  res.json({ data: { url: idPhoto.downloadUrl(r.idPhoto) } });
}
// Xóa ảnh và đóng yêu cầu khi booking nhận, trả phòng hoặc ngừng hiệu lực.
async function closeForBooking(bookingId, status = "completed") {
  await dropPhotos({ bookingId, status: { $in: ["pending", "approved"] } });
  await Request.updateMany({ bookingId, status: { $in: ["pending", "approved"] } }, { $set: { status } });
}
module.exports = { create, withdraw, listing, handle, closeForBooking, photoUploadParams, photoLink };
