import { Router, Request, Response, NextFunction } from 'express';
import { ObjectId } from 'mongodb';
import { z } from 'zod';
import { getUsersCollection, getServicesCollection, getBookingsCollection, getPaymentsCollection } from '../db/collections.js';
import { verifyToken, verifyAdmin } from '../middleware/auth.middleware.js';
import type { UserRole } from '../types/database.js';

const router = Router();

const updateProfileSchema = z
  .object({
    name: z.string().trim().min(2).max(100).optional(),
    phone: z.string().trim().max(20).optional(),
    area: z.string().trim().max(100).optional(),
    avatarUrl: z.string().trim().url().optional().or(z.literal('')),
    bio: z.string().trim().max(500).optional(),
    specialties: z.array(z.string().trim()).max(10).optional(),
    isAvailable: z.boolean().optional(),
  })
  .strict();

const updateRoleSchema = z
  .object({
    role: z.enum(['customer', 'technician', 'admin']),
  })
  .strict();

/**
 * GET /api/users/profile
 * Authenticated user retrieves their current profile.
 */
router.get(
  '/users/profile',
  verifyToken,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const usersColl = getUsersCollection();
      const userId = req.user!.id;

      const user = await usersColl.findOne({
        $or: [
          ...(ObjectId.isValid(userId) && userId.length === 24 ? [{ _id: new ObjectId(userId) }] : []),
          { _id: userId as unknown as ObjectId },
          { id: userId },
        ],
      });

      if (!user) {
        res.status(404).json({
          success: false,
          error: 'NotFound',
          message: 'User profile not found.',
          statusCode: 404,
        });
        return;
      }

      const { passwordHash, ...safeProfile } = user as any;
      res.status(200).json({
        success: true,
        data: safeProfile,
        statusCode: 200,
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * PATCH /api/users/profile
 * Authenticated user updates their profile fields.
 */
router.patch(
  '/users/profile',
  verifyToken,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const parsed = updateProfileSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({
          success: false,
          error: 'BadRequest',
          message: 'Invalid profile update payload.',
          details: parsed.error.format(),
          statusCode: 400,
        });
        return;
      }

      const usersColl = getUsersCollection();
      const userId = req.user!.id;
      const now = new Date();

      const updateData = {
        ...parsed.data,
        updatedAt: now,
      };

      const result = await usersColl.findOneAndUpdate(
        {
          $or: [
            ...(ObjectId.isValid(userId) && userId.length === 24 ? [{ _id: new ObjectId(userId) }] : []),
            { _id: userId as unknown as ObjectId },
            { id: userId },
          ],
        },
        { $set: updateData },
        { returnDocument: 'after' }
      );

      if (!result) {
        res.status(404).json({
          success: false,
          error: 'NotFound',
          message: 'User profile not found.',
          statusCode: 404,
        });
        return;
      }

      const { passwordHash, ...safeProfile } = result as any;
      res.status(200).json({
        success: true,
        message: 'Profile updated successfully.',
        data: safeProfile,
        statusCode: 200,
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * GET /api/admin/users
 * Admin lists all users with role filtering and pagination.
 */
router.get(
  '/admin/users',
  verifyToken,
  verifyAdmin,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const page = Math.max(1, parseInt(req.query.page as string, 10) || 1);
      const limit = Math.min(50, Math.max(1, parseInt(req.query.limit as string, 10) || 10));
      const role = req.query.role as UserRole | undefined;

      const filter: any = {};
      if (role && ['customer', 'technician', 'admin'].includes(role)) {
        filter.role = role;
      }

      const usersColl = getUsersCollection();
      const skip = (page - 1) * limit;

      const [users, totalCount] = await Promise.all([
        usersColl
          .find(filter)
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(limit)
          .project({ passwordHash: 0 })
          .toArray(),
        usersColl.countDocuments(filter),
      ]);

      res.status(200).json({
        success: true,
        data: users,
        pagination: {
          page,
          limit,
          totalCount,
          totalPages: Math.ceil(totalCount / limit) || 1,
        },
        statusCode: 200,
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * PATCH /api/admin/users/:id/role
 * Admin updates a user's role.
 */
router.patch(
  '/admin/users/:id/role',
  verifyToken,
  verifyAdmin,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const targetUserId = Array.isArray(req.params.id)
        ? req.params.id[0]
        : (req.params.id as string);
      const parsed = updateRoleSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({
          success: false,
          error: 'BadRequest',
          message: 'Invalid role update payload.',
          details: parsed.error.format(),
          statusCode: 400,
        });
        return;
      }

      const usersColl = getUsersCollection();
      const result = await usersColl.findOneAndUpdate(
        {
          $or: [
            ...(ObjectId.isValid(targetUserId) && targetUserId.length === 24 ? [{ _id: new ObjectId(targetUserId) }] : []),
            { _id: targetUserId as unknown as ObjectId },
            { id: targetUserId },
          ],
        },
        { $set: { role: parsed.data.role, updatedAt: new Date() } },
        { returnDocument: 'after' }
      );

      if (!result) {
        res.status(404).json({
          success: false,
          error: 'NotFound',
          message: 'User not found.',
          statusCode: 404,
        });
        return;
      }

      const { passwordHash, ...safeUser } = result as any;
      res.status(200).json({
        success: true,
        message: `User role updated to ${parsed.data.role}.`,
        data: safeUser,
        statusCode: 200,
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * GET /api/admin/stats
 * Real platform overview statistics for admin dashboard.
 */
router.get(
  '/admin/stats',
  verifyToken,
  verifyAdmin,
  async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const [totalUsers, totalServices, totalBookings, totalPayments, revenueAgg] = await Promise.all([
        getUsersCollection().countDocuments({}),
        getServicesCollection().countDocuments({}),
        getBookingsCollection().countDocuments({}),
        getPaymentsCollection().countDocuments({}),
        getPaymentsCollection()
          .aggregate([{ $group: { _id: null, totalRevenue: { $sum: '$amount' } } }])
          .toArray(),
      ]);

      const totalRevenue = revenueAgg[0]?.totalRevenue || 0;

      res.status(200).json({
        success: true,
        data: {
          totalUsers,
          totalServices,
          totalBookings,
          totalPayments,
          totalRevenue,
        },
        statusCode: 200,
      });
    } catch (error) {
      next(error);
    }
  }
);

export default router;
