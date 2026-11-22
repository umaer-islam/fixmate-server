import { Router, Request, Response, NextFunction } from 'express';
import {
  createCheckoutSessionSchema,
  paymentQuerySchema,
} from '../validations/payment.validation.js';
import { idParamSchema } from '../validations/booking.validation.js';
import {
  createCheckoutSession,
  handleStripeWebhookEvent,
  getCustomerPayments,
  getBookingPaymentStatus,
} from '../services/payment.service.js';
import {
  verifyToken,
  verifyCustomer,
} from '../middleware/auth.middleware.js';

const router = Router();

/**
 * POST /api/payments/create-checkout-session
 * Customer creates a Stripe Checkout Session for their completed, unpaid booking.
 */
router.post(
  '/payments/create-checkout-session',
  verifyToken,
  verifyCustomer,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const parsedBody = createCheckoutSessionSchema.safeParse(req.body);
      if (!parsedBody.success) {
        res.status(400).json({
          success: false,
          error: 'BadRequest',
          message: 'Invalid payment payload provided.',
          details: parsedBody.error.format(),
          statusCode: 400,
        });
        return;
      }

      const result = await createCheckoutSession(req.user!, parsedBody.data.bookingId);
      if (!result.success) {
        res.status(result.status).json({
          success: false,
          error:
            result.status === 409
              ? 'Conflict'
              : result.status === 404
              ? 'NotFound'
              : result.status === 502
              ? 'BadGateway'
              : 'BadRequest',
          message: result.message,
          statusCode: result.status,
        });
        return;
      }

      res.status(200).json({
        success: true,
        message: 'Stripe Checkout Session created successfully.',
        data: result.data,
        statusCode: 200,
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * POST /api/payments/webhook
 * Public Stripe webhook endpoint.
 * Note: Raw body is verified before JSON parsing.
 */
router.post(
  '/payments/webhook',
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const signature = req.headers['stripe-signature'] as string | undefined;
      const rawBody = (req as any).rawBody || req.body;

      const result = await handleStripeWebhookEvent(rawBody, signature);
      if (!result.success) {
        res.status(result.status).json({
          success: false,
          error: result.message,
          statusCode: result.status,
        });
        return;
      }

      res.status(200).json({
        received: true,
        message: result.message,
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * GET /api/payments/my
 * Customer views their own payment history.
 */
router.get(
  '/payments/my',
  verifyToken,
  verifyCustomer,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const parsedQuery = paymentQuerySchema.safeParse(req.query);
      if (!parsedQuery.success) {
        res.status(400).json({
          success: false,
          error: 'BadRequest',
          message: 'Invalid query parameters for payments.',
          details: parsedQuery.error.format(),
          statusCode: 400,
        });
        return;
      }

      const result = await getCustomerPayments(req.user!, parsedQuery.data);

      res.status(200).json({
        success: true,
        data: result.payments,
        pagination: {
          page: result.page,
          limit: result.limit,
          totalCount: result.totalCount,
          totalPages: result.totalPages,
        },
        statusCode: 200,
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * GET /api/payments/booking/:bookingId
 * Customer retrieves payment status for a specific booking.
 */
router.get(
  '/payments/booking/:bookingId',
  verifyToken,
  verifyCustomer,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const parsedParams = idParamSchema.safeParse({ id: req.params.bookingId });
      if (!parsedParams.success) {
        res.status(400).json({
          success: false,
          error: 'BadRequest',
          message: 'Invalid booking ID format.',
          details: parsedParams.error.format(),
          statusCode: 400,
        });
        return;
      }

      const result = await getBookingPaymentStatus(req.user!, parsedParams.data.id);
      if (!result.success) {
        res.status(result.status).json({
          success: false,
          error: result.status === 404 ? 'NotFound' : 'BadRequest',
          message: result.message,
          statusCode: result.status,
        });
        return;
      }

      res.status(200).json({
        success: true,
        data: result.data,
        statusCode: 200,
      });
    } catch (error) {
      next(error);
    }
  }
);

export default router;
