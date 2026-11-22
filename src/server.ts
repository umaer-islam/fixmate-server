import app from './app.js';
import { env } from './config/env.js';
import { connectDB, closeDB } from './db/connection.js';
import { initializeIndexes } from './db/indexes.js';
import type { Server } from 'http';

let server: Server | null = null;
let isShuttingDown = false;

async function bootstrap() {
  console.log('[Bootstrap] Initializing FixMate backend database foundation...');

  try {
    // 1. Connect to MongoDB and ping
    await connectDB();

    // 2. Initialize domain collection indexes
    await initializeIndexes();

    console.log('[Bootstrap] Database foundation and indexes successfully initialized.');

    // 3. Start HTTP server ONLY after required initialization succeeds
    server = app.listen(env.PORT, () => {
      console.log(`[Bootstrap] FixMate server running on http://localhost:${env.PORT} [${env.NODE_ENV}]`);
    });
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Unknown error';
    console.error(`[Bootstrap Fatal] Database initialization failed: ${errorMsg}`);
    console.error('[Bootstrap Fatal] Server startup aborted. HTTP server will NOT listen.');

    // Close any partially initialized resources
    await closeDB();

    // Exit with non-zero status
    process.exit(1);
  }
}

// Graceful Shutdown Handling
const gracefulShutdown = async (signal: string) => {
  if (isShuttingDown) {
    return;
  }
  isShuttingDown = true;
  console.log(`\nReceived ${signal}. Closing server gracefully...`);

  const forceExitTimeout = setTimeout(() => {
    console.error('Graceful shutdown timed out. Forcefully terminating process.');
    process.exit(1);
  }, 10000);

  try {
    if (server) {
      await new Promise<void>((resolve, reject) => {
        server?.close((err) => {
          if (err) return reject(err);
          console.log('HTTP server closed.');
          resolve();
        });
      });
    }

    await closeDB();
    clearTimeout(forceExitTimeout);
    console.log('FixMate backend shutdown complete.');
    process.exit(0);
  } catch (err) {
    console.error('Error during graceful shutdown:', err);
    clearTimeout(forceExitTimeout);
    process.exit(1);
  }
};

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

bootstrap();
