import { Router, Request, Response, NextFunction } from 'express';
import {
  createBookingSchema,
  technicianStatusUpdateSchema,
  bookingQuerySchema,
  idParamSchema,
} from '../validations/booking.validation.js';
import {
  createBooking,
  getCustomerBookings,
  getCustomerBookingById,
  cancelCustomerBooking,
  getTechnicianBookings,
  getTechnicianBookingById,
  updateTechnicianBookingStatus,
  getAdminBookings,
} from '../services/booking.service.js';
import {
  verifyToken,
  verifyCustomer,
  verifyTechnician,
  verifyAdmin,
} from '../middleware/auth.middleware.js';

const router = Router();

// ============================================================================
// 1. CUSTOMER BOOKING ROUTES
// ============================================================================

/**
 * POST /api/bookings
 * Customer creates a new booking for an approved & available service.
 */
router.post(
  '/bookings',
  verifyToken,
  verifyCustomer,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const parsedBody = createBookingSchema.safeParse(req.body);
      if (!parsedBody.success) {
        res.status(400).json({
          success: false,
          error: 'BadRequest',
          message: 'Invalid booking payload provided.',
          details: parsedBody.error.format(),
          statusCode: 400,
        });
        return;
      }

      const result = await createBooking(req.user!, parsedBody.data);
      if (!result.success) {
        res.status(result.status).json({
          success: false,
          error: result.status === 409 ? 'Conflict' : result.status === 404 ? 'NotFound' : 'BadRequest',
          message: result.message,
          statusCode: result.status,
        });
        return;
      }

      res.status(201).json({
        success: true,
        message: 'Booking created successfully.',
        data: result.data,
        statusCode: 201,
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * GET /api/bookings/my
 * Customer views their own bookings with pagination and optional status filter.
 */
router.get(
  '/bookings/my',
  verifyToken,
  verifyCustomer,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const parsedQuery = bookingQuerySchema.safeParse(req.query);
      if (!parsedQuery.success) {
        res.status(400).json({
          success: false,
          error: 'BadRequest',
          message: 'Invalid query parameters for customer bookings.',
          details: parsedQuery.error.format(),
          statusCode: 400,
        });
        return;
      }

      const result = await getCustomerBookings(req.user!, parsedQuery.data);

      res.status(200).json({
        success: true,
        data: result.bookings,
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
 * GET /api/bookings/:id
 * Customer views details of a single booking they own.
 */
router.get(
  '/bookings/:id',
  verifyToken,
  (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({
        success: false,
        error: 'Unauthorized',
        message: 'Authentication required',
        statusCode: 401,
      });
      return;
    }
    if (req.user.role !== 'customer' && req.user.role !== 'admin') {
      res.status(403).json({
        success: false,
        error: 'Forbidden',
        message: 'Access denied: Customer or Admin role required',
        statusCode: 403,
      });
      return;
    }
    next();
  },
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const parsedParams = idParamSchema.safeParse(req.params);
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

      const booking = await getCustomerBookingById(req.user!, parsedParams.data.id);
      if (!booking) {
        res.status(404).json({
          success: false,
          error: 'NotFound',
          message: 'Booking not found.',
          statusCode: 404,
        });
        return;
      }

      res.status(200).json({
        success: true,
        data: booking,
        statusCode: 200,
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * PATCH /api/bookings/:id/cancel
 * Customer cancels their requested booking.
 */
router.patch(
  '/bookings/:id/cancel',
  verifyToken,
  verifyCustomer,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const parsedParams = idParamSchema.safeParse(req.params);
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

      const result = await cancelCustomerBooking(req.user!, parsedParams.data.id);
      if (!result.success) {
        res.status(result.status).json({
          success: false,
          error: result.status === 409 ? 'Conflict' : 'NotFound',
          message: result.message,
          statusCode: result.status,
        });
        return;
      }

      res.status(200).json({
        success: true,
        message: 'Booking cancelled successfully.',
        data: result.data,
        statusCode: 200,
      });
    } catch (error) {
      next(error);
    }
  }
);

// ============================================================================
// 2. TECHNICIAN BOOKING ROUTES
// ============================================================================

/**
 * GET /api/technician/bookings
 * Technician views their assigned bookings with pagination and status filter.
 */
router.get(
  '/technician/bookings',
  verifyToken,
  verifyTechnician,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const parsedQuery = bookingQuerySchema.safeParse(req.query);
      if (!parsedQuery.success) {
        res.status(400).json({
          success: false,
          error: 'BadRequest',
          message: 'Invalid query parameters for technician bookings.',
          details: parsedQuery.error.format(),
          statusCode: 400,
        });
        return;
      }

      const result = await getTechnicianBookings(req.user!, parsedQuery.data);

      res.status(200).json({
        success: true,
        data: result.bookings,
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
 * GET /api/technician/bookings/:id
 * Technician views a single assigned booking.
 */
router.get(
  '/technician/bookings/:id',
  verifyToken,
  verifyTechnician,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const parsedParams = idParamSchema.safeParse(req.params);
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

      const booking = await getTechnicianBookingById(req.user!, parsedParams.data.id);
      if (!booking) {
        res.status(404).json({
          success: false,
          error: 'NotFound',
          message: 'Booking not found.',
          statusCode: 404,
        });
        return;
      }

      res.status(200).json({
        success: true,
        data: booking,
        statusCode: 200,
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * PATCH /api/technician/bookings/:id/status
 * Technician advances booking status along the authorized lifecycle:
 * requested -> accepted | rejected
 * accepted -> in-progress
 * in-progress -> completed (requires positive finalAmount)
 */
router.patch(
  '/technician/bookings/:id/status',
  verifyToken,
  verifyTechnician,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const parsedParams = idParamSchema.safeParse(req.params);
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

      const parsedBody = technicianStatusUpdateSchema.safeParse(req.body);
      if (!parsedBody.success) {
        res.status(400).json({
          success: false,
          error: 'BadRequest',
          message: 'Invalid status transition payload.',
          details: parsedBody.error.format(),
          statusCode: 400,
        });
        return;
      }

      const result = await updateTechnicianBookingStatus(
        req.user!,
        parsedParams.data.id,
        parsedBody.data.status,
        parsedBody.data.finalAmount
      );

      if (!result.success) {
        res.status(result.status).json({
          success: false,
          error: result.status === 409 ? 'Conflict' : result.status === 404 ? 'NotFound' : 'BadRequest',
          message: result.message,
          statusCode: result.status,
        });
        return;
      }

      res.status(200).json({
        success: true,
        message: `Booking status updated to ${parsedBody.data.status}.`,
        data: result.data,
        statusCode: 200,
      });
    } catch (error) {
      next(error);
    }
  }
);

// ============================================================================
// 3. ADMIN BOOKING ROUTES
// ============================================================================

/**
 * GET /api/admin/bookings
 * Admin inspects all bookings with pagination and status filter.
 */
router.get(
  '/admin/bookings',
  verifyToken,
  verifyAdmin,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const parsedQuery = bookingQuerySchema.safeParse(req.query);
      if (!parsedQuery.success) {
        res.status(400).json({
          success: false,
          error: 'BadRequest',
          message: 'Invalid query parameters for admin bookings.',
          details: parsedQuery.error.format(),
          statusCode: 400,
        });
        return;
      }

      const result = await getAdminBookings(parsedQuery.data);

      res.status(200).json({
        success: true,
        data: result.bookings,
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

export default router;
