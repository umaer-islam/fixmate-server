import app from './app.js';
import { env } from './config/env.js';
import { connectDB, closeDB } from './db/connection.js';
import { initializeIndexes } from './db/indexes.js';
import type { Server } from 'http';

let server: Server | null = null;
let isShuttingDown = false;

async function bootstrap() {
  console.log('[Bootstrap] Initializing FixMate backend database foundation...');

  let dbInitialized = false;

  try {
    // 1. Connect to MongoDB
    await connectDB();

    // 2. Initialize domain collection indexes
    await initializeIndexes();

    dbInitialized = true;
    console.log('[Bootstrap] Database foundation successfully initialized.');
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Unknown error';
    console.error(`[Bootstrap Error] Database initialization failed: ${errorMsg}`);

    // If in production and degraded startup is not explicitly permitted, abort startup
    if (env.NODE_ENV === 'production' && !env.ALLOW_DEGRADED_STARTUP) {
      console.error('[Bootstrap Fatal] Server startup aborted in production due to database initialization failure.');
      process.exit(1);
    } else {
      console.warn('[Bootstrap Warning] Starting server in DEGRADED state (database offline). Health checks will report degraded.');
    }
  }

  // 3. Start HTTP server
  server = app.listen(env.PORT, () => {
    const mode = dbInitialized ? 'HEALTHY' : 'DEGRADED';
    console.log(`[Bootstrap] FixMate server running on http://localhost:${env.PORT} [${env.NODE_ENV}] [State: ${mode}]`);
  });
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
