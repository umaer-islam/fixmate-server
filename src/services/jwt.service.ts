import { getAuth } from '../auth/auth.js';
import type { AuthenticatedUser } from '../types/auth.js';
import type { UserRole } from '../types/database.js';

const VALID_ROLES: UserRole[] = ['customer', 'technician', 'admin'];

export interface VerifiedJwtPayload {
  sub: string;
  email: string;
  tokenRole: UserRole;
  name?: string;
  exp?: number;
  iss?: string;
  aud?: string;
}

/**
 * Signs a JWT token strictly using BetterAuth's asymmetric EdDSA/JWKS infrastructure.
 * Rejects loose symmetric fallback to maintain a single cryptographic trust model.
 */
export async function signUserToken(
  user: AuthenticatedUser,
  options?: { expiresIn?: string }
): Promise<string> {
  const expiresIn = options?.expiresIn || '1d';
  const auth = getAuth();

  if (!auth?.api?.signJWT) {
    throw new Error('BetterAuth JWT plugin signJWT is not initialized.');
  }

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

  if (!result?.token) {
    throw new Error('Failed to sign JWT token via BetterAuth EdDSA/JWKS.');
  }

  return result.token;
}

/**
 * Cryptographically verifies a JWT token strictly using BetterAuth's EdDSA/JWKS public keys.
 * Enforces algorithm check (EdDSA), signature integrity, expiration, issuer, and audience.
 * Any non-EdDSA token, unsigned token, or invalid key ID is immediately rejected.
 */
export async function verifyJwtToken(token: string): Promise<VerifiedJwtPayload | null> {
  if (!token || typeof token !== 'string') {
    return null;
  }

  const trimmedToken = token.trim();
  if (!trimmedToken) {
    return null;
  }

  try {
    const auth = getAuth();
    if (!auth?.api?.verifyJWT) {
      return null;
    }

    const response = await auth.api.verifyJWT({
      body: { token: trimmedToken },
    });

    const payload = response?.payload;
    if (
      payload &&
      typeof payload.sub === 'string' &&
      typeof payload.email === 'string' &&
      payload.role &&
      VALID_ROLES.includes(payload.role as UserRole)
    ) {
      return {
        sub: payload.sub,
        email: payload.email,
        tokenRole: payload.role as UserRole,
        name: typeof payload.name === 'string' ? payload.name : undefined,
        exp: typeof payload.exp === 'number' ? payload.exp : undefined,
        iss: typeof payload.iss === 'string' ? payload.iss : undefined,
        aud: typeof payload.aud === 'string' ? payload.aud : undefined,
      };
    }
  } catch {
    // Cryptographic verification failed (signature mismatch, expired, malformed, or invalid alg)
  }

  return null;
}
