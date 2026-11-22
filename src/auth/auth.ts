import { betterAuth } from 'better-auth';
import { mongodbAdapter } from 'better-auth/adapters/mongodb';
import { jwt, bearer } from 'better-auth/plugins';
import type { Db } from 'mongodb';
import { env } from '../config/env.js';
import { getDB } from '../db/connection.js';

export type FixMateAuth = ReturnType<typeof createAuthInstance>;

let authInstance: FixMateAuth | null = null;

export function createAuthInstance(db: Db) {
  const cleanUrl = (url?: string) => (url ? url.replace(/\/+$/, '') : '');
  const allowedOrigins = [
    cleanUrl(env.CLIENT_URL),
    'https://fixmate23.vercel.app',
    'https://fixmate-server.onrender.com',
    'http://localhost:3000',
    'http://localhost:5000',
    cleanUrl(env.BETTER_AUTH_URL),
  ].filter(Boolean);

  const activeBaseUrl =
    cleanUrl(env.BETTER_AUTH_URL) ||
    (env.NODE_ENV === 'production'
      ? 'https://fixmate-server.onrender.com'
      : 'http://localhost:5000');

  return betterAuth({
    database: mongodbAdapter(db),
    secret: env.BETTER_AUTH_SECRET,
    baseURL: activeBaseUrl,
    trustedOrigins: allowedOrigins,
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: false,
    },
    user: {
      modelName: 'users',
      additionalFields: {
        role: {
          type: 'string',
          required: false,
          defaultValue: 'customer',
          input: false, // Prevents client from setting role during sign-up or update
        },
        phone: {
          type: 'string',
          required: false,
        },
        area: {
          type: 'string',
          required: false,
        },
        bio: {
          type: 'string',
          required: false,
        },
      },
    },
    databaseHooks: {
      user: {
        create: {
          before: async (user) => {
            // Defense-in-depth: enforce customer role on all public registrations
            return {
              data: {
                ...user,
                role: 'customer',
              },
            };
          },
        },
      },
    },
    plugins: [
      jwt({
        jwt: {
          definePayload: (session) => ({
            sub: session.user.id,
            email: session.user.email,
            role: session.user.role,
          }),
        },
      }),
      bearer(),
    ],
  });
}

export function initAuth(customDb?: Db): FixMateAuth {
  if (authInstance) {
    return authInstance;
  }
  const db = customDb || getDB();
  authInstance = createAuthInstance(db);
  return authInstance;
}

export function getAuth(): FixMateAuth {
  if (!authInstance) {
    const db = getDB();
    authInstance = createAuthInstance(db);
  }
  return authInstance;
}

export function _setMockAuthForTest(mockAuth: FixMateAuth | null): void {
  authInstance = mockAuth;
}
