import { ObjectId } from 'mongodb';

export type UserRole = 'customer' | 'technician' | 'admin';

export interface UserDocument {
  _id?: ObjectId;
  name: string;
  email: string;
  passwordHash?: string;
  phone?: string;
  role: UserRole;
  avatarUrl?: string;
  isAvailable?: boolean;
  bio?: string;
  specialties?: string[];
  createdAt: Date;
  updatedAt: Date;
}

export type ServiceStatus = 'pending' | 'approved' | 'rejected';
export type ServiceMode = 'home-visit' | 'drop-off' | 'remote';

export interface ServiceDocument {
  _id?: ObjectId;
  technicianId: ObjectId;
  technicianEmail: string;
  title: string;
  description: string;
  category: string;
  serviceMode: ServiceMode;
  estimatedPrice: number;
  turnaroundTime: string;
  imageUrl?: string;
  status: ServiceStatus;
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
  customerId: ObjectId;
  customerEmail: string;
  technicianId: ObjectId;
  technicianEmail: string;
  serviceId: ObjectId;
  deviceMakeModel: string;
  issueDescription: string;
  serviceAddress: string;
  preferredDate: Date;
  status: BookingStatus;
  paymentStatus: PaymentStatus;
  finalAmount?: number | null;
  rejectionReason?: string | null;
  completedAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export type TransactionStatus = 'succeeded' | 'failed';

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
  status: TransactionStatus;
  paidAt: Date;
  createdAt: Date;
}
