import { Router, Request, Response, NextFunction } from 'express';
import {
  createServiceSchema,
  updateServiceSchema,
  updateAvailabilitySchema,
  adminApprovalSchema,
  publicServiceQuerySchema,
  technicianServiceQuerySchema,
  adminServiceQuerySchema,
  idParamSchema,
} from '../validations/service.validation.js';
import {
  getPublicServices,
  getPublicServiceById,
  createTechnicianService,
  getTechnicianServices,
  getTechnicianServiceById,
  updateTechnicianService,
  updateTechnicianServiceAvailability,
  deleteTechnicianService,
  getAdminServices,
  moderateServiceApproval,
} from '../services/service.service.js';
import {
  verifyToken,
  verifyTechnician,
  verifyAdmin,
} from '../middleware/auth.middleware.js';

const router = Router();

// ============================================================================
// 1. PUBLIC SERVICE ROUTES
// ============================================================================

/**
 * GET /api/services
 * Public browsing of approved and available services with filtering, search, sorting, and pagination.
 */
router.get(
  '/services',
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const parsedQuery = publicServiceQuerySchema.safeParse(req.query);
      if (!parsedQuery.success) {
        res.status(400).json({
          success: false,
          error: 'BadRequest',
          message: 'Invalid query parameters provided for services search.',
          details: parsedQuery.error.format(),
          statusCode: 400,
        });
        return;
      }

      const result = await getPublicServices(parsedQuery.data);

      res.status(200).json({
        success: true,
        data: result.services,
        pagination: {
          page: result.page,
          limit: result.limit,
          totalCount: result.totalCount,
          totalPages: result.totalPages,
        },
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * GET /api/services/:id
 * Retrieve details for an individual approved and available service.
 */
router.get(
  '/services/:id',
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const parsedParams = idParamSchema.safeParse(req.params);
      if (!parsedParams.success) {
        res.status(400).json({
          success: false,
          error: 'BadRequest',
          message: 'Invalid service ID parameter.',
          statusCode: 400,
        });
        return;
      }

      const service = await getPublicServiceById(parsedParams.data.id);

      if (!service) {
        res.status(404).json({
          success: false,
          error: 'NotFound',
          message: 'Service not found or unavailable.',
          statusCode: 404,
        });
        return;
      }

      res.status(200).json({
        success: true,
        data: service,
      });
    } catch (error) {
      next(error);
    }
  }
);

// ============================================================================
// 2. TECHNICIAN SERVICE MANAGEMENT ROUTES
// ============================================================================

/**
 * POST /api/technician/services
 * Create a new service owned by the authenticated technician (forced to pending approval).
 */
router.post(
  '/technician/services',
  verifyToken,
  verifyTechnician,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const parsedBody = createServiceSchema.safeParse(req.body);
      if (!parsedBody.success) {
        res.status(400).json({
          success: false,
          error: 'BadRequest',
          message: 'Validation failed for service creation.',
          details: parsedBody.error.format(),
          statusCode: 400,
        });
        return;
      }

      const created = await createTechnicianService(req.user!, parsedBody.data);

      res.status(201).json({
        success: true,
        message: 'Service created successfully and submitted for administrator approval.',
        data: created,
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * GET /api/technician/services
 * Retrieve only services owned by the authenticated technician.
 */
router.get(
  '/technician/services',
  verifyToken,
  verifyTechnician,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const parsedQuery = technicianServiceQuerySchema.safeParse(req.query);
      if (!parsedQuery.success) {
        res.status(400).json({
          success: false,
          error: 'BadRequest',
          message: 'Invalid query parameters provided.',
          details: parsedQuery.error.format(),
          statusCode: 400,
        });
        return;
      }

      const result = await getTechnicianServices(req.user!, parsedQuery.data);

      res.status(200).json({
        success: true,
        data: result.services,
        pagination: {
          page: result.page,
          limit: result.limit,
          totalCount: result.totalCount,
          totalPages: result.totalPages,
        },
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * GET /api/technician/services/:id
 * Retrieve an individual service owned by the authenticated technician.
 */
router.get(
  '/technician/services/:id',
  verifyToken,
  verifyTechnician,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const parsedParams = idParamSchema.safeParse(req.params);
      if (!parsedParams.success) {
        res.status(400).json({
          success: false,
          error: 'BadRequest',
          message: 'Invalid service ID parameter.',
          statusCode: 400,
        });
        return;
      }

      const service = await getTechnicianServiceById(req.user!, parsedParams.data.id);

      if (!service) {
        res.status(404).json({
          success: false,
          error: 'NotFound',
          message: 'Service not found or unauthorized to view.',
          statusCode: 404,
        });
        return;
      }

      res.status(200).json({
        success: true,
        data: service,
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * PATCH /api/technician/services/:id
 * Update service details. Ownership enforced. Any content edit returns service to pending approval.
 */
router.patch(
  '/technician/services/:id',
  verifyToken,
  verifyTechnician,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const parsedParams = idParamSchema.safeParse(req.params);
      if (!parsedParams.success) {
        res.status(400).json({
          success: false,
          error: 'BadRequest',
          message: 'Invalid service ID parameter.',
          statusCode: 400,
        });
        return;
      }

      const parsedBody = updateServiceSchema.safeParse(req.body);
      if (!parsedBody.success) {
        res.status(400).json({
          success: false,
          error: 'BadRequest',
          message: 'Validation failed for service update.',
          details: parsedBody.error.format(),
          statusCode: 400,
        });
        return;
      }

      const updated = await updateTechnicianService(
        req.user!,
        parsedParams.data.id,
        parsedBody.data
      );

      if (!updated) {
        res.status(404).json({
          success: false,
          error: 'NotFound',
          message: 'Service not found or unauthorized to update.',
          statusCode: 404,
        });
        return;
      }

      res.status(200).json({
        success: true,
        message: 'Service updated successfully and returned to pending approval.',
        data: updated,
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * PATCH /api/technician/services/:id/availability
 * Toggle service availability. Ownership enforced. Does NOT reset approval status.
 */
router.patch(
  '/technician/services/:id/availability',
  verifyToken,
  verifyTechnician,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const parsedParams = idParamSchema.safeParse(req.params);
      if (!parsedParams.success) {
        res.status(400).json({
          success: false,
          error: 'BadRequest',
          message: 'Invalid service ID parameter.',
          statusCode: 400,
        });
        return;
      }

      const parsedBody = updateAvailabilitySchema.safeParse(req.body);
      if (!parsedBody.success) {
        res.status(400).json({
          success: false,
          error: 'BadRequest',
          message: 'Validation failed for availability update.',
          details: parsedBody.error.format(),
          statusCode: 400,
        });
        return;
      }

      const updated = await updateTechnicianServiceAvailability(
        req.user!,
        parsedParams.data.id,
        parsedBody.data.isAvailable
      );

      if (!updated) {
        res.status(404).json({
          success: false,
          error: 'NotFound',
          message: 'Service not found or unauthorized to update.',
          statusCode: 404,
        });
        return;
      }

      res.status(200).json({
        success: true,
        message: `Service availability updated to ${parsedBody.data.isAvailable ? 'available' : 'unavailable'}.`,
        data: updated,
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * DELETE /api/technician/services/:id
 * Delete a service owned by the authenticated technician.
 */
router.delete(
  '/technician/services/:id',
  verifyToken,
  verifyTechnician,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const parsedParams = idParamSchema.safeParse(req.params);
      if (!parsedParams.success) {
        res.status(400).json({
          success: false,
          error: 'BadRequest',
          message: 'Invalid service ID parameter.',
          statusCode: 400,
        });
        return;
      }

      const deleted = await deleteTechnicianService(req.user!, parsedParams.data.id);

      if (!deleted) {
        res.status(404).json({
          success: false,
          error: 'NotFound',
          message: 'Service not found or unauthorized to delete.',
          statusCode: 404,
        });
        return;
      }

      res.status(200).json({
        success: true,
        message: 'Service deleted successfully.',
      });
    } catch (error) {
      next(error);
    }
  }
);

// ============================================================================
// 3. ADMIN SERVICE MODERATION ROUTES
// ============================================================================

/**
 * GET /api/admin/services
 * Inspect all services across all technicians with moderation filters.
 */
router.get(
  '/admin/services',
  verifyToken,
  verifyAdmin,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const parsedQuery = adminServiceQuerySchema.safeParse(req.query);
      if (!parsedQuery.success) {
        res.status(400).json({
          success: false,
          error: 'BadRequest',
          message: 'Invalid query parameters provided.',
          details: parsedQuery.error.format(),
          statusCode: 400,
        });
        return;
      }

      const result = await getAdminServices(parsedQuery.data);

      res.status(200).json({
        success: true,
        data: result.services,
        pagination: {
          page: result.page,
          limit: result.limit,
          totalCount: result.totalCount,
          totalPages: result.totalPages,
        },
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * PATCH /api/admin/services/:id/approval
 * Approve or reject a service. Only approved services become publicly visible.
 */
router.patch(
  '/admin/services/:id/approval',
  verifyToken,
  verifyAdmin,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const parsedParams = idParamSchema.safeParse(req.params);
      if (!parsedParams.success) {
        res.status(400).json({
          success: false,
          error: 'BadRequest',
          message: 'Invalid service ID parameter.',
          statusCode: 400,
        });
        return;
      }

      const parsedBody = adminApprovalSchema.safeParse(req.body);
      if (!parsedBody.success) {
        res.status(400).json({
          success: false,
          error: 'BadRequest',
          message: 'Validation failed for approval status moderation.',
          details: parsedBody.error.format(),
          statusCode: 400,
        });
        return;
      }

      const updated = await moderateServiceApproval(
        parsedParams.data.id,
        parsedBody.data.approvalStatus,
        parsedBody.data.moderationNotes
      );

      if (!updated) {
        res.status(404).json({
          success: false,
          error: 'NotFound',
          message: 'Service not found.',
          statusCode: 404,
        });
        return;
      }

      res.status(200).json({
        success: true,
        message: `Service approval status successfully updated to ${parsedBody.data.approvalStatus}.`,
        data: updated,
      });
    } catch (error) {
      next(error);
    }
  }
);

export default router;
