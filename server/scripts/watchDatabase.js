require('dotenv').config();

const mongoose = require('mongoose');
const connectDatabase = require('../src/config/database');
require('../src/models');

async function start() {
  const connection = await connectDatabase();
  console.log(`MongoDB connected: ${connection.name}`);
}

start().catch((error) => {
  console.error('MongoDB connection failed:', error.message);
  process.exit(1);
});

async function shutdown() {
  await mongoose.disconnect();
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
