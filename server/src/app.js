const express = require('express');
const frontDeskRoutes = require('./routes/frontDeskBooking.routes');
const customerRoutes = require('./routes/customer.routes');

const app = express();
app.use(express.json());
app.use('/api/front-desk', frontDeskRoutes);
app.use('/api/front-desk/customers', customerRoutes);
app.use((error, _req, res, _next) => {
  if (error.name === 'CastError') return res.status(400).json({ message: 'Invalid resource ID' });
  console.error(error);
  res.status(error.status || 500).json({ message: error.message || 'Internal server error' });
});
module.exports = app;
