import dns from 'node:dns';
import app from './app.js';
import { env } from './config/env.js';
import { connectDB, closeDB } from './db/connection.js';
import { initializeIndexes } from './db/indexes.js';
import { initAuth } from './auth/auth.js';
import type { Server } from 'http';

// Configure public DNS resolvers to ensure MongoDB Atlas SRV records resolve reliably on Windows
try {
  dns.setServers(['8.8.8.8', '1.1.1.1']);
} catch {
  // Fall back to system default if custom DNS assignment is restricted
}

let server: Server | null = null;
let isShuttingDown = false;

async function bootstrap() {
  console.log('[Bootstrap] Initializing FixMate backend database & authentication foundation...');

  try {
    // 1. Connect to MongoDB and ping
    const db = await connectDB();

    // 2. Initialize domain collection indexes
    await initializeIndexes();

    // 3. Initialize BetterAuth instance with MongoDB connection
    initAuth(db);
    console.log('[Bootstrap] BetterAuth authentication foundation initialized successfully.');

    // 4. Start HTTP server ONLY after required initialization succeeds
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
