import { UserRole } from './database.js';

export interface AuthenticatedUser {
  id: string;
  email: string;
  role: UserRole;
  name?: string;
}

export interface JwtTokenPayload {
  sub: string;
  email: string;
  role: UserRole;
  name?: string;
  iat?: number;
  exp?: number;
  iss?: string;
  aud?: string;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthenticatedUser;
    }
  }
}
