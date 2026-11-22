import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const envSchema = z
  .object({
    PORT: z
      .string()
      .default('5000')
      .transform((val) => {
        const parsed = parseInt(val, 10);
        if (isNaN(parsed)) throw new Error('PORT must be an integer');
        return parsed;
      }),
    NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
    CLIENT_URL: z.string().default('http://localhost:3000'),
    MONGODB_URI: z.string().optional(),
    DATABASE_URL: z.string().optional(),
    DB_NAME: z.string().default('fixmate'),
    MONGODB_TIMEOUT_MS: z
      .string()
      .default('5000')
      .transform((val) => {
        const parsed = parseInt(val, 10);
        if (isNaN(parsed)) return 5000;
        return parsed;
      }),
    JWT_SECRET: z.string().default('fixmate_dev_jwt_secret_minimum_32_characters_12345678'),
    BETTER_AUTH_SECRET: z.string().default('fixmate_dev_better_auth_secret_minimum_32_chars_12345'),
    BETTER_AUTH_URL: z.string().default('http://localhost:5000'),
    STRIPE_SECRET_KEY: z.string().optional(),
    STRIPE_WEBHOOK_SECRET: z.string().optional(),
    IMGBB_API_KEY: z.string().optional(),
  })
  .superRefine((data, ctx) => {
    if (data.NODE_ENV === 'production') {
      if (
        !data.BETTER_AUTH_SECRET ||
        data.BETTER_AUTH_SECRET.length < 32 ||
        data.BETTER_AUTH_SECRET.includes('dev_better_auth_secret')
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['BETTER_AUTH_SECRET'],
          message: 'BETTER_AUTH_SECRET must be at least 32 characters in production and not use dev default.',
        });
      }
      if (
        !data.JWT_SECRET ||
        data.JWT_SECRET.length < 32 ||
        data.JWT_SECRET.includes('dev_jwt_secret')
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['JWT_SECRET'],
          message: 'JWT_SECRET must be at least 32 characters in production and not use dev default.',
        });
      }
      if (!data.MONGODB_URI && !data.DATABASE_URL) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['MONGODB_URI'],
          message: 'MONGODB_URI or DATABASE_URL is required in production.',
        });
      }
    }
  });

const parsedEnv = envSchema.safeParse(process.env);

if (!parsedEnv.success) {
  console.error('Invalid environment variables detected:', JSON.stringify(parsedEnv.error.format(), null, 2));
  process.exit(1);
}

export const env = parsedEnv.data;

export const getMongoURI = (): string => {
  return env.MONGODB_URI || env.DATABASE_URL || '';
};
