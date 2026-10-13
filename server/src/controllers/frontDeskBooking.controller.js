const service = require('../services/frontDeskBooking.service');
const { asyncHandler } = require('../utils/http');

const respond = (operation, key = 'booking') => asyncHandler(async (req, res) => {
  const result = await operation(req.params.bookingId, req.body, req.actorId);
  res.status(key === 'created' ? 201 : 200).json({ [key === 'created' ? 'booking' : key]: result });
});

exports.create = asyncHandler(async (req, res) => res.status(201).json({ booking: await service.createBooking(req.body, req.actorId) }));
exports.modify = respond((id, body, actorId) => service.modifyBooking(id, body, actorId));
exports.cancel = respond((id, body, actorId) => service.cancelBooking(id, body, actorId));
exports.checkIn = respond((id, _body, actorId) => service.checkIn(id, actorId));
exports.changeRoom = respond((id, body, actorId) => service.changeRoom(id, body, actorId));
exports.recordService = respond((id, body, actorId) => service.recordService(id, body, actorId));
exports.checkOut = asyncHandler(async (req, res) => res.json(await service.checkOut(req.params.bookingId, req.actorId)));
