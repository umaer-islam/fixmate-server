import { Collection } from 'mongodb';
import { getDB } from './connection.js';
import type {
  UserDocument,
  ServiceDocument,
  BookingDocument,
  PaymentDocument,
} from '../types/database.js';

export const collections = {
  users: (): Collection<UserDocument> => getDB().collection<UserDocument>('users'),
  services: (): Collection<ServiceDocument> => getDB().collection<ServiceDocument>('services'),
  bookings: (): Collection<BookingDocument> => getDB().collection<BookingDocument>('bookings'),
  payments: (): Collection<PaymentDocument> => getDB().collection<PaymentDocument>('payments'),
} as const;

export function getUsersCollection(): Collection<UserDocument> {
  return collections.users();
}

export function getServicesCollection(): Collection<ServiceDocument> {
  return collections.services();
}

export function getBookingsCollection(): Collection<BookingDocument> {
  return collections.bookings();
}

export function getPaymentsCollection(): Collection<PaymentDocument> {
  return collections.payments();
}
