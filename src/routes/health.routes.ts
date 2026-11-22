import { Router, Request, Response } from 'express';
import { env } from '../config/env.js';
import { checkDBHealth } from '../db/connection.js';

const router = Router();

router.get('/health', async (_req: Request, res: Response) => {
  const isDbConnected = await checkDBHealth();
  const isHealthy = isDbConnected;

  res.status(isHealthy ? 200 : 503).json({
    success: isHealthy,
    status: isHealthy ? 'healthy' : 'degraded',
    timestamp: new Date().toISOString(),
    uptime: Math.floor(process.uptime()),
    environment: env.NODE_ENV,
    services: {
      database: isDbConnected ? 'connected' : 'disconnected',
    },
  });
});

export default router;
