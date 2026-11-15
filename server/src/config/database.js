const mongoose = require('mongoose');

// Cho phép populate ngoài schema theo cấu hình dùng chung hiện tại.
mongoose.set('strictPopulate', false);

async function connectDatabase(uri = process.env.MONGO_URI) {
  if (!uri) {
    throw new Error('MONGO_URI is required. Copy server/.env.example to server/.env.');
  }

  await mongoose.connect(uri);
  return mongoose.connection;
}

module.exports = connectDatabase;
