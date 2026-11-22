import { Request, Response, NextFunction } from 'express';
import { ObjectId, Filter } from 'mongodb';
import { verifyJwtToken } from '../services/jwt.service.js';
import { getUsersCollection } from '../db/collections.js';
import type { UserDocument, UserRole } from '../types/database.js';

const VALID_ROLES: UserRole[] = ['customer', 'technician', 'admin'];

export async function verifyToken(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const authHeader = req.headers.authorization;

  if (!authHeader) {
    res.status(401).json({
      success: false,
      error: 'Unauthorized',
      message: 'Authentication token is required',
      statusCode: 401,
    });
    return;
  }

  const parts = authHeader.split(' ');
  if (parts.length !== 2 || parts[0].toLowerCase() !== 'bearer') {
    res.status(401).json({
      success: false,
      error: 'Unauthorized',
      message: 'Invalid authorization header format. Expected "Bearer <token>"',
      statusCode: 401,
    });
    return;
  }

  const token = parts[1];
  const verifiedPayload = await verifyJwtToken(token);

  if (!verifiedPayload) {
    res.status(401).json({
      success: false,
      error: 'Unauthorized',
      message: 'Invalid or expired authentication token',
      statusCode: 401,
    });
    return;
  }

  // Authoritative Database Role Enforcement:
  // Query the authoritative 'users' collection to verify account existence and current role.
  // Never trust a stale role claim in the JWT without database confirmation.
  try {
    const usersCollection = getUsersCollection();
    const sub = verifiedPayload.sub;

    const query: Filter<UserDocument> = {
      $or: [
        ...(ObjectId.isValid(sub) ? [{ _id: new ObjectId(sub) }] : []),
        { _id: sub as unknown as ObjectId },
        { id: sub } as unknown as Filter<UserDocument>,
        { email: verifiedPayload.email.toLowerCase() },
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
      id: userDoc._id ? userDoc._id.toString() : sub,
      email: userDoc.email,
      role: currentRole,
      name: userDoc.name,
    };

    next();
  } catch (error) {
    // Database lookup failed (e.g. database error/unreachable).
    // NEVER fall back to trusting the JWT role claim! Fail closed!
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
