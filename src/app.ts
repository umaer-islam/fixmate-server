import express, { Request, Response } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { toNodeHandler } from 'better-auth/node';
import { env } from './config/env.js';
import { getAuth } from './auth/auth.js';
import healthRoutes from './routes/health.routes.js';
import { errorHandler } from './middleware/errorHandler.js';
import {
  verifyToken,
  verifyCustomer,
  verifyTechnician,
  verifyAdmin,
} from './middleware/auth.middleware.js';

const app = express();

// Security Headers via Helmet
app.use(helmet());

// Strict CORS Configuration (No wildcard with credentials)
const allowedOrigins = [
  env.CLIENT_URL,
  'http://localhost:3000',
  'http://localhost:5000',
  env.BETTER_AUTH_URL,
].filter(Boolean);

app.use(
  cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (e.g. mobile apps, curl, server-to-server)
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error(`CORS policy violation: origin ${origin} not permitted.`));
      }
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Cookie'],
    exposedHeaders: ['set-auth-jwt'],
  })
);

// Payload size restrictions to mitigate DoS
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));
app.use(cookieParser());

// 1. BetterAuth Handler mounted under /api/auth/* before conflicting routes
const authHandler = (req: Request, res: Response) => {
  return toNodeHandler(getAuth())(req, res);
};

app.all('/api/auth', authHandler);
app.all('/api/auth/{*splat}', authHandler);

// 2. Base API Health Route
app.use('/api', healthRoutes);

// 3. Role Authorization Test/Verification Routes
app.get(
  '/api/test/customer',
  verifyToken,
  verifyCustomer,
  (req: Request, res: Response) => {
    res.status(200).json({
      success: true,
      message: 'Access granted: Customer role verified',
      user: req.user,
    });
  }
);

app.get(
  '/api/test/technician',
  verifyToken,
  verifyTechnician,
  (req: Request, res: Response) => {
    res.status(200).json({
      success: true,
      message: 'Access granted: Technician role verified',
      user: req.user,
    });
  }
);

app.get(
  '/api/test/admin',
  verifyToken,
  verifyAdmin,
  (req: Request, res: Response) => {
    res.status(200).json({
      success: true,
      message: 'Access granted: Admin role verified',
      user: req.user,
    });
  }
);

// Centralized Error Handling
app.use(errorHandler);

export default app;
