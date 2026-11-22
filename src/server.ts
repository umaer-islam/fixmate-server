import app from './app.js';
import { env } from './config/env.js';

const server = app.listen(env.PORT, () => {
  console.log(`FixMate server running on http://localhost:${env.PORT} [${env.NODE_ENV}]`);
});

// Graceful Shutdown Handling
const gracefulShutdown = (signal: string) => {
  console.log(`\nReceived ${signal}. Closing HTTP server gracefully...`);
  server.close(() => {
    console.log('HTTP server successfully closed.');
    process.exit(0);
  });

  // Force shutdown if cleanup takes longer than 10 seconds
  setTimeout(() => {
    console.error('Graceful shutdown timed out. Forcefully terminating process.');
    process.exit(1);
  }, 10000);
};

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
