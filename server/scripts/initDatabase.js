require('dotenv').config();

const mongoose = require('mongoose');
const fs = require('node:fs');
const path = require('node:path');
const connectDatabase = require('../src/config/database');

const modelsDir = path.join(__dirname, '../src/models');
const models = fs.readdirSync(modelsDir)
  .filter(file => file.endsWith('.js'))
  .map(file => require(path.join(modelsDir, file)));

async function initializeDatabase() {
  const connection = await connectDatabase();

  for (const model of models) {
    await model.createCollection();
    await model.syncIndexes();
  }

  console.log(
    `Initialized ${models.length} collections in ${connection.name}.`
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
