import { ObjectId } from 'mongodb';

export type UserRole = 'customer' | 'technician' | 'admin';

export interface UserDocument {
  _id?: ObjectId;
  name: string;
  email: string;
  passwordHash?: string;
  phone?: string;
  area?: string;
  role: UserRole;
  avatarUrl?: string;
  isAvailable?: boolean;
  bio?: string;
  specialties?: string[];
  createdAt: Date;
  updatedAt: Date;
}

export type ServiceApprovalStatus = 'pending' | 'approved' | 'rejected';
export type ServiceMode = 'onsite' | 'remote' | 'both';

export interface ServiceDocument {
  _id?: ObjectId;
  technicianId: ObjectId | string;
  technicianName: string;
  technicianEmail: string;
  title: string;
  description: string;
  category: string;
  serviceMode: ServiceMode;
  basePrice: number;
  estimatedDuration: string;
  turnaroundTime?: string;
  serviceArea?: string;
  image: string;
  imageUrl?: string;
  approvalStatus: ServiceApprovalStatus;
  isAvailable: boolean;
  moderationNotes?: string;
  createdAt: Date;
  updatedAt: Date;
}

export type BookingStatus =
  | 'requested'
  | 'accepted'
  | 'in-progress'
  | 'completed'
  | 'rejected'
  | 'cancelled';

export type PaymentStatus = 'unpaid' | 'paid';

export interface BookingDocument {
  _id?: ObjectId;

  // Service Snapshot
  serviceId: ObjectId | string;
  serviceTitle: string;
  serviceImage: string;
  serviceCategory: string;
  basePrice: number;
  technicianId: ObjectId | string;
  technicianName: string;
  technicianEmail: string;

  // Customer Information
  customerId: ObjectId | string;
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  address: string;

  // Booking Details & Lifecycle
  preferredDate: Date;
  problemDescription: string;
  status: BookingStatus;
  finalAmount: number | null;
  paymentStatus: PaymentStatus;
  createdAt: Date;
  updatedAt: Date;

  // Backwards-compatible aliases if referenced in earlier tasks
  serviceAddress?: string;
  issueDescription?: string;
  deviceMakeModel?: string;
  rejectionReason?: string | null;
  completedAt?: Date | null;
}

export type PaymentTransactionStatus = 'succeeded' | 'failed';

export interface PaymentDocument {
  _id?: ObjectId;
  bookingId: ObjectId;
  customerId: ObjectId;
  customerEmail: string;
  technicianId: ObjectId;
  amount: number;
  currency: string;
  stripeSessionId: string;
  stripePaymentIntentId?: string | null;
  paymentStatus: PaymentTransactionStatus;
  paidAt: Date;
  createdAt: Date;
}
