const mongoose = require('mongoose');

// Prevent StrictPopulateError across all models
mongoose.set('strictPopulate', false);

async function connectDatabase(uri = process.env.MONGO_URI) {
  if (!uri) {
    throw new Error('MONGO_URI is required. Copy server/.env.example to server/.env.');
  }

  await mongoose.connect(uri);
  return mongoose.connection;
}

module.exports = connectDatabase;
