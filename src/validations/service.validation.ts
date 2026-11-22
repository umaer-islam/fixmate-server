import { z } from 'zod';

export const serviceModeEnum = z.enum([
  'Home Visit',
  'Shop Drop-off',
  'home-visit',
  'drop-off',
  'onsite',
  'remote',
  'both',
]);

export const approvalStatusEnum = z.enum(['pending', 'approved', 'rejected']);

export const sortEnum = z.enum(['newest', 'price_asc', 'price_desc']);

export const createServiceSchema = z
  .object({
    title: z.string().trim().min(3, 'Title must be at least 3 characters').max(120, 'Title cannot exceed 120 characters'),
    category: z.string().trim().min(2, 'Category must be at least 2 characters').max(50, 'Category cannot exceed 50 characters'),
    description: z.string().trim().min(10, 'Description must be at least 10 characters').max(2000, 'Description cannot exceed 2000 characters'),
    image: z.string().trim().url('Image must be a valid HTTP or HTTPS URL'),
    basePrice: z.number().nonnegative('Base price must be a non-negative number').finite('Base price must be a finite number'),
    estimatedDuration: z.string().trim().min(2, 'Estimated duration must be specified').max(50, 'Estimated duration cannot exceed 50 characters'),
    serviceMode: serviceModeEnum,
    serviceArea: z.string().trim().min(2, 'Service area must be at least 2 characters').max(100, 'Service area cannot exceed 100 characters').optional(),
    turnaroundTime: z.string().trim().max(50).optional(),
  })
  .strict();

export const updateServiceSchema = z
  .object({
    title: z.string().trim().min(3, 'Title must be at least 3 characters').max(120).optional(),
    category: z.string().trim().min(2).max(50).optional(),
    description: z.string().trim().min(10).max(2000).optional(),
    image: z.string().trim().url('Image must be a valid HTTP or HTTPS URL').optional(),
    basePrice: z.number().nonnegative('Base price must be a non-negative number').finite().optional(),
    estimatedDuration: z.string().trim().min(2).max(50).optional(),
    serviceMode: serviceModeEnum.optional(),
    serviceArea: z.string().trim().min(2).max(100).optional(),
    turnaroundTime: z.string().trim().max(50).optional(),
  })
  .strict()
  .refine(
    (data) => Object.keys(data).length > 0,
    'At least one editable field must be provided for update.'
  );

export const updateAvailabilitySchema = z
  .object({
    isAvailable: z.boolean(),
  })
  .strict();

export const adminApprovalSchema = z
  .object({
    approvalStatus: z.enum(['approved', 'rejected']),
    moderationNotes: z.string().trim().max(500, 'Moderation notes cannot exceed 500 characters.').optional(),
  })
  .strict();

export const publicServiceQuerySchema = z
  .object({
    search: z.string().trim().max(100).optional(),
    category: z.string().trim().max(50).optional(),
    serviceMode: serviceModeEnum.optional(),
    minPrice: z
      .string()
      .optional()
      .transform((val) => (val !== undefined ? parseFloat(val) : undefined))
      .refine((val) => val === undefined || (!isNaN(val) && val >= 0), {
        message: 'minPrice must be a valid positive number',
      }),
    maxPrice: z
      .string()
      .optional()
      .transform((val) => (val !== undefined ? parseFloat(val) : undefined))
      .refine((val) => val === undefined || (!isNaN(val) && val >= 0), {
        message: 'maxPrice must be a valid positive number',
      }),
    sort: sortEnum.default('newest'),
    page: z
      .string()
      .default('1')
      .transform((val) => {
        const parsed = parseInt(val, 10);
        return isNaN(parsed) || parsed < 1 ? 1 : parsed;
      }),
    limit: z
      .string()
      .default('10')
      .transform((val) => {
        const parsed = parseInt(val, 10);
        if (isNaN(parsed) || parsed < 1) return 10;
        if (parsed > 50) return 50;
        return parsed;
      }),
  })
  .refine(
    (data) => {
      if (data.minPrice !== undefined && data.maxPrice !== undefined) {
        return data.minPrice <= data.maxPrice;
      }
      return true;
    },
    {
      message: 'minPrice cannot exceed maxPrice',
      path: ['minPrice'],
    }
  );

export const technicianServiceQuerySchema = z.object({
  approvalStatus: approvalStatusEnum.optional(),
  page: z
    .string()
    .default('1')
    .transform((val) => {
      const parsed = parseInt(val, 10);
      return isNaN(parsed) || parsed < 1 ? 1 : parsed;
    }),
  limit: z
    .string()
    .default('10')
    .transform((val) => {
      const parsed = parseInt(val, 10);
      if (isNaN(parsed) || parsed < 1) return 10;
      if (parsed > 50) return 50;
      return parsed;
    }),
});

export const adminServiceQuerySchema = z.object({
  approvalStatus: approvalStatusEnum.optional(),
  category: z.string().trim().max(50).optional(),
  search: z.string().trim().max(100).optional(),
  page: z
    .string()
    .default('1')
    .transform((val) => {
      const parsed = parseInt(val, 10);
      return isNaN(parsed) || parsed < 1 ? 1 : parsed;
    }),
  limit: z
    .string()
    .default('10')
    .transform((val) => {
      const parsed = parseInt(val, 10);
      if (isNaN(parsed) || parsed < 1) return 10;
      if (parsed > 50) return 50;
      return parsed;
    }),
});

export const idParamSchema = z.object({
  id: z.string().trim().min(1, 'Service ID is required'),
});
