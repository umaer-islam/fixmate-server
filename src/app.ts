import express, { Request, Response } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { toNodeHandler } from 'better-auth/node';
import { env } from './config/env.js';
import { getAuth } from './auth/auth.js';
import healthRoutes from './routes/health.routes.js';
import serviceRoutes from './routes/service.routes.js';
import bookingRoutes from './routes/booking.routes.js';
import paymentRoutes from './routes/payment.routes.js';
import userRoutes from './routes/user.routes.js';
import uploadRoutes from './routes/upload.routes.js';
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

// Strict CORS Configuration (Handles exact domains & Vercel deployments)
const cleanUrl = (url?: string) => (url ? url.replace(/\/+$/, '') : '');

const allowedOrigins = [
  cleanUrl(env.CLIENT_URL),
  'https://fixmate23.vercel.app',
  'http://localhost:3000',
  'http://localhost:5000',
  cleanUrl(env.BETTER_AUTH_URL),
].filter(Boolean);

app.use(
  cors({
    origin: (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => {
      // Allow requests with no origin (e.g. mobile apps, curl, server-to-server)
      if (!origin) {
        return callback(null, true);
      }
      const normalized = origin.replace(/\/+$/, '');
      if (
        allowedOrigins.includes(normalized) ||
        allowedOrigins.includes(origin) ||
        normalized.endsWith('.vercel.app')
      ) {
        callback(null, true);
      } else {
        callback(new Error(`CORS policy violation: origin ${origin} not permitted.`));
      }
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Cookie'],
    exposedHeaders: ['set-auth-token', 'set-auth-jwt'],
  })
);

// Stripe Webhook Raw Body Middleware:
// Must receive the unparsed raw request body before global JSON parser consumes it
app.use(
  '/api/payments/webhook',
  express.raw({ type: 'application/json' })
);

// Payload size restrictions supporting device image base64 uploads
app.use(
  express.json({
    limit: '15mb',
    verify: (req: any, _res: any, buf: Buffer) => {
      req.rawBody = buf;
    },
  })
);
app.use(express.urlencoded({ extended: true, limit: '15mb' }));
app.use(cookieParser());

// 1. BetterAuth Handler mounted under /api/auth/* before conflicting routes
const authHandler = async (req: Request, res: Response, next: any) => {
  try {
    return await toNodeHandler(getAuth())(req, res);
  } catch (err) {
    console.error('[BetterAuth Request Error]:', err);
    next(err);
  }
};

app.all('/api/auth', authHandler);
app.all('/api/auth/{*splat}', authHandler);

// Root & Health Verification Endpoints
app.get('/', (_req: Request, res: Response) => {
  res.status(200).json({
    success: true,
    service: 'FixMate Backend API',
    author: 'Umaer Islam',
    version: '1.0.0',
    status: 'online',
    timestamp: new Date().toISOString(),
  });
});

app.get('/api', (_req: Request, res: Response) => {
  res.status(200).json({
    success: true,
    message: 'FixMate API Gateway active',
    author: 'Umaer Islam',
    health: '/api/health',
    services: '/api/services',
  });
});

// 2. Base API Health Route
app.use('/api', healthRoutes);

// 3. Domain Services Management Routes
app.use('/api', serviceRoutes);

// 4. Domain Booking Management Routes
app.use('/api', bookingRoutes);

// 5. Domain Payment & Stripe Checkout Routes
app.use('/api', paymentRoutes);

// 6. User Profile & Admin Operations Routes
app.use('/api', userRoutes);

// 7. Media & ImgBB Upload Routes
app.use('/api', uploadRoutes);

// 4. Role Authorization Test/Verification Routes
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
