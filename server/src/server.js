require('dotenv').config();
const mongoose = require('mongoose');
const app = require('./app');
const connectDatabase = require('./config/database');

const PORT = process.env.PORT || 5000;

async function bootstrap() {
  try {
    const connection = await connectDatabase();
    console.log(`[Database] Connected to MongoDB: ${connection.name}`);
  } catch (error) {
    console.warn(`[Database Warning] Could not connect to MongoDB: ${error.message}`);
    console.warn('[Database Warning] API server will still start, but database operations may fail until MongoDB is started.');
  }

  const server = app.listen(PORT, () => {
    console.log(`[Server] Hotel Management API server running on http://localhost:${PORT}`);
  });

  const shutdown = async () => {
    console.log('\n[Server] Shutting down gracefully...');
    server.close(async () => {
      await mongoose.disconnect();
      console.log('[Server] Closed database connection and HTTP server.');
      process.exit(0);
    });
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

bootstrap();
