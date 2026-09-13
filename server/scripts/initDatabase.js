require('dotenv').config();

const mongoose = require('mongoose');
const connectDatabase = require('../src/config/database');
const models = require('../src/models');

async function initializeDatabase() {
  const connection = await connectDatabase();

  for (const model of Object.values(models)) {
    await model.createCollection();
    await model.syncIndexes();
  }

  console.log(
    `Initialized ${Object.keys(models).length} collections in ${connection.name}.`
  );
}

initializeDatabase()
  .catch((error) => {
    console.error('Database initialization failed:', error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
  });
