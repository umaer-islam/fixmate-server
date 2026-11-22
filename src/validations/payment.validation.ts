import { z } from 'zod';

export const createCheckoutSessionSchema = z
  .object({
    bookingId: z
      .string()
      .trim()
      .regex(/^[0-9a-fA-F]{24}$/, 'Invalid booking ID format'),
  })
  .strict();

export const paymentQuerySchema = z
  .object({
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
  .strict();
