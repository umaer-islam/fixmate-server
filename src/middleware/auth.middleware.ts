import { Request, Response, NextFunction } from 'express';
import { verifyJwtToken } from '../services/jwt.service.js';
import type { AuthenticatedUser } from '../types/auth.js';

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
  const user = await verifyJwtToken(token);

  if (!user) {
    res.status(401).json({
      success: false,
      error: 'Unauthorized',
      message: 'Invalid or expired authentication token',
      statusCode: 401,
    });
    return;
  }

  // Attach strictly verified server-derived user context
  req.user = user;
  next();
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
