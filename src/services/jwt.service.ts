import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { getAuth } from '../auth/auth.js';
import type { AuthenticatedUser } from '../types/auth.js';
import type { UserRole } from '../types/database.js';

const VALID_ROLES: UserRole[] = ['customer', 'technician', 'admin'];

export async function signUserToken(
  user: AuthenticatedUser,
  options?: { expiresIn?: string }
): Promise<string> {
  const expiresIn = options?.expiresIn || '1d';

  // Attempt signing with BetterAuth's EdDSA/JWKS infrastructure
  try {
    const auth = getAuth();
    if (auth?.api?.signJWT) {
      const result = await auth.api.signJWT({
        body: {
          payload: {
            sub: user.id,
            email: user.email,
            role: user.role,
            name: user.name,
          },
          overrideOptions: {
            jwt: {
              expirationTime: expiresIn,
            },
          },
        },
      });
      if (result?.token) {
        return result.token;
      }
    }
  } catch {
    // Fall back to symmetric HMAC signing with JWT_SECRET if BetterAuth JWKS is unavailable
  }

  // Symmetric signing fallback with env.JWT_SECRET
  return jwt.sign(
    {
      sub: user.id,
      email: user.email,
      role: user.role,
      name: user.name,
    },
    env.JWT_SECRET,
    {
      expiresIn: expiresIn as jwt.SignOptions['expiresIn'],
      issuer: env.BETTER_AUTH_URL,
      audience: env.CLIENT_URL,
    }
  );
}

export async function verifyJwtToken(token: string): Promise<AuthenticatedUser | null> {
  if (!token || typeof token !== 'string') {
    return null;
  }

  const trimmedToken = token.trim();
  if (!trimmedToken) {
    return null;
  }

  // 1. Primary: Verify using BetterAuth's JWKS verification
  try {
    const auth = getAuth();
    if (auth?.api?.verifyJWT) {
      const response = await auth.api.verifyJWT({
        body: { token: trimmedToken },
      });
      const payload = response?.payload;
      if (payload && payload.sub && payload.role && typeof payload.email === 'string') {
        const role = payload.role as UserRole;
        if (VALID_ROLES.includes(role)) {
          return {
            id: String(payload.sub),
            email: payload.email,
            role,
            name: typeof payload.name === 'string' ? payload.name : undefined,
          };
        }
      }
    }
  } catch {
    // If BetterAuth verification failed or threw, proceed to symmetric verification check
  }

  // 2. Secondary: Verify using symmetric JWT_SECRET
  try {
    const decoded = jwt.verify(trimmedToken, env.JWT_SECRET) as jwt.JwtPayload;
    if (decoded && (decoded.sub || decoded.id) && decoded.role && typeof decoded.email === 'string') {
      const role = decoded.role as UserRole;
      if (VALID_ROLES.includes(role)) {
        return {
          id: String(decoded.sub || decoded.id),
          email: decoded.email,
          role,
          name: typeof decoded.name === 'string' ? decoded.name : undefined,
        };
      }
    }
  } catch {
    // Token signature invalid, expired, or malformed
  }

  return null;
}
