import { Request, Response, NextFunction } from 'express';
import { ObjectId, Filter } from 'mongodb';
import { verifyJwtToken } from '../services/jwt.service.js';
import { getUsersCollection } from '../db/collections.js';
import { getDB } from '../db/connection.js';
import type { UserDocument, UserRole } from '../types/database.js';

const VALID_ROLES: UserRole[] = ['customer', 'technician', 'admin'];

export async function verifyToken(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  // 1. Extract token from Authorization header or Cookies
  let token: string | undefined;

  const authHeader = req.headers.authorization;
  if (authHeader) {
    const parts = authHeader.split(' ');
    if (parts.length === 2 && parts[0].toLowerCase() === 'bearer') {
      token = parts[1].trim();
    }
  }

  // Fallback to cookie tokens if no Authorization Bearer header provided
  if (!token && req.cookies) {
    const rawCookieToken =
      req.cookies['better-auth.session_token'] ||
      req.cookies['__Secure-better-auth.session_token'] ||
      req.cookies['better_auth_session_token'] ||
      req.cookies['fixmate_token'];
    if (rawCookieToken && typeof rawCookieToken === 'string') {
      token = rawCookieToken.trim();
    }
  }

  // Fallback to raw Cookie header if cookieParser missed signed/prefixed cookies
  if (!token && req.headers.cookie) {
    const match = req.headers.cookie.match(
      /(?:better-auth\.session_token|__Secure-better-auth\.session_token|fixmate_token)=([^;]+)/
    );
    if (match && match[1]) {
      try {
        token = decodeURIComponent(match[1]).trim();
      } catch {
        token = match[1].trim();
      }
    }
  }

  if (!token) {
    res.status(401).json({
      success: false,
      error: 'Unauthorized',
      message: 'Authentication token is required',
      statusCode: 401,
    });
    return;
  }

  try {
    let resolvedUserId: string | ObjectId | undefined;

    // 2. Check if token is a BetterAuth session token in MongoDB 'session' collection
    // BetterAuth session cookies often have format "token.signature" - check both full and prefix
    const cleanToken = token.includes('.') && token.split('.').length === 2 ? token.split('.')[0] : token;
    const db = getDB();
    const sessionDoc = await db.collection('session').findOne({
      $or: [
        { token: token },
        { token: cleanToken },
      ],
      expiresAt: { $gt: new Date() },
    });

    if (sessionDoc && sessionDoc.userId) {
      resolvedUserId = sessionDoc.userId;
    } else {
      // 3. Fallback: if token is a 3-part EdDSA JWT, verify with BetterAuth JWKS
      if (token.split('.').length === 3) {
        const verifiedPayload = await verifyJwtToken(token);
        if (verifiedPayload?.sub) {
          resolvedUserId = verifiedPayload.sub;
        }
      }
    }

    if (!resolvedUserId) {
      res.status(401).json({
        success: false,
        error: 'Unauthorized',
        message: 'Invalid or expired authentication token',
        statusCode: 401,
      });
      return;
    }

    // 4. Authoritative Database Role Enforcement:
    // Query the authoritative 'users' collection to verify account existence and current role.
    const usersCollection = getUsersCollection();
    const subStr = resolvedUserId.toString();

    const query: Filter<UserDocument> = {
      $or: [
        ...(ObjectId.isValid(subStr) && subStr.length === 24 ? [{ _id: new ObjectId(subStr) }] : []),
        { _id: resolvedUserId as unknown as ObjectId },
        { id: subStr },
      ],
    };

    const userDoc = await usersCollection.findOne(query);

    if (!userDoc) {
      res.status(401).json({
        success: false,
        error: 'Unauthorized',
        message: 'User account not found or has been removed',
        statusCode: 401,
      });
      return;
    }

    // Check if user account is disabled
    const rawUser = userDoc as unknown as Record<string, unknown>;
    if (rawUser.status === 'disabled' || rawUser.isDisabled === true) {
      res.status(401).json({
        success: false,
        error: 'Unauthorized',
        message: 'User account is disabled',
        statusCode: 401,
      });
      return;
    }

    const currentRole: UserRole = userDoc.role;
    if (!VALID_ROLES.includes(currentRole)) {
      res.status(403).json({
        success: false,
        error: 'Forbidden',
        message: 'User has invalid role configuration in database',
        statusCode: 403,
      });
      return;
    }

    // Attach verified identity and current authoritative database role to req.user
    req.user = {
      id: userDoc._id ? userDoc._id.toString() : subStr,
      email: userDoc.email,
      role: currentRole,
      name: userDoc.name,
    };

    next();
  } catch (error) {
    // Database lookup failed. Fail closed!
    res.status(503).json({
      success: false,
      error: 'ServiceUnavailable',
      message: 'Database identity verification temporarily unavailable',
      statusCode: 503,
    });
    return;
  }
}

export function verifyCustomer(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  if (!req.user) {
    res.status(401).json({
      success: false,
      error: 'Unauthorized',
      message: 'Authentication required',
      statusCode: 401,
    });
    return;
  }

  if (req.user.role !== 'customer') {
    res.status(403).json({
      success: false,
      error: 'Forbidden',
      message: 'Access denied: Customer role required',
      statusCode: 403,
    });
    return;
  }

  next();
}

export function verifyTechnician(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  if (!req.user) {
    res.status(401).json({
      success: false,
      error: 'Unauthorized',
      message: 'Authentication required',
      statusCode: 401,
    });
    return;
  }

  if (req.user.role !== 'technician') {
    res.status(403).json({
      success: false,
      error: 'Forbidden',
      message: 'Access denied: Technician role required',
      statusCode: 403,
    });
    return;
  }

  next();
}

export function verifyAdmin(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  if (!req.user) {
    res.status(401).json({
      success: false,
      error: 'Unauthorized',
      message: 'Authentication required',
      statusCode: 401,
    });
    return;
  }

  if (req.user.role !== 'admin') {
    res.status(403).json({
      success: false,
      error: 'Forbidden',
      message: 'Access denied: Admin role required',
      statusCode: 403,
    });
    return;
  }

  next();
}
