import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const envSchema = z.object({
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
  ALLOW_DEGRADED_STARTUP: z
    .string()
    .optional()
    .transform((val) => val === 'true' || val === '1'),
  JWT_SECRET: z.string().optional(),
  BETTER_AUTH_SECRET: z.string().optional(),
  BETTER_AUTH_URL: z.string().optional(),
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
  IMGBB_API_KEY: z.string().optional(),
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
