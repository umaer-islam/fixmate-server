import { z } from 'zod';

export const bookingStatusEnum = z.enum([
  'requested',
  'accepted',
  'rejected',
  'in-progress',
  'completed',
  'cancelled',
]);

export const paymentStatusEnum = z.enum(['unpaid', 'paid']);

export const idParamSchema = z
  .object({
    id: z
      .string()
      .trim()
      .regex(/^[0-9a-fA-F]{24}$/, 'Invalid MongoDB ObjectId format'),
  })
  .strict();

export const createBookingSchema = z
  .object({
    serviceId: z
      .string()
      .trim()
      .regex(/^[0-9a-fA-F]{24}$/, 'Invalid service ID format'),
    customerPhone: z
      .string()
      .trim()
      .min(7, 'Phone number must be at least 7 characters')
      .max(20, 'Phone number must not exceed 20 characters'),
    address: z
      .string()
      .trim()
      .min(5, 'Address must be at least 5 characters')
      .max(250, 'Address must not exceed 250 characters'),
    preferredDate: z.coerce
      .date()
      .refine((date) => !isNaN(date.getTime()), {
        message: 'Invalid preferred date format',
      })
      .refine(
        (date) => {
          const today = new Date();
          today.setHours(0, 0, 0, 0);
          return date >= today;
        },
        {
          message: 'Preferred date cannot be in the past',
        }
      ),
    problemDescription: z
      .string()
      .trim()
      .min(5, 'Problem description must be at least 5 characters')
      .max(1000, 'Problem description must not exceed 1000 characters'),
  })
  .strict();

export const technicianStatusUpdateSchema = z
  .object({
    status: z.enum(['accepted', 'rejected', 'in-progress', 'completed']),
    finalAmount: z
      .number()
      .positive('finalAmount must be a positive number')
      .finite('finalAmount must be a finite number')
      .optional(),
  })
  .strict()
  .refine(
    (data) => {
      if (data.status === 'completed') {
        return (
          typeof data.finalAmount === 'number' &&
          !isNaN(data.finalAmount) &&
          data.finalAmount > 0
        );
      }
      return true;
    },
    {
      message:
        'finalAmount is required and must be a finite positive number when transitioning to completed',
      path: ['finalAmount'],
    }
  )
  .refine(
    (data) => {
      if (data.status !== 'completed' && data.finalAmount !== undefined) {
        return false;
      }
      return true;
    },
    {
      message: 'finalAmount is only permitted when transitioning status to completed',
      path: ['finalAmount'],
    }
  );

export const bookingQuerySchema = z.object({
  status: bookingStatusEnum.optional(),
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
