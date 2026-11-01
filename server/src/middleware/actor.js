const { appError } = require('../utils/http');

// Authentication is deliberately kept outside this module.  The real auth
// middleware should populate req.user; x-user-id makes these internal routes
// usable while that module is being integrated.
function requireActor(req, _res, next) {
  const actorId = req.user?._id || req.user?.id || req.get('x-user-id');
  if (!actorId) return next(appError('An authenticated staff user is required', 401));
  req.actorId = actorId;
  next();
}

module.exports = { requireActor };
