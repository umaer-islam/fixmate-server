import { getDB } from './connection.js';
import {
  getUsersCollection,
  getServicesCollection,
  getBookingsCollection,
  getPaymentsCollection,
} from './collections.js';

export async function initializeIndexes(): Promise<void> {
  const db = getDB();
  console.log(`[MongoDB Indexes] Initializing domain indexes on database: ${db.databaseName}...`);

  try {
    // 1. USERS COLLECTION INDEXES
    const users = getUsersCollection();
    await users.createIndexes([
      {
        key: { email: 1 },
        name: 'idx_users_email_unique',
        unique: true,
      },
      {
        key: { role: 1 },
        name: 'idx_users_role',
      },
    ]);
    console.log(' - Users indexes initialized.');

    // 2. SERVICES COLLECTION INDEXES
    const services = getServicesCollection();
    await services.createIndexes([
      {
        key: { technicianId: 1 },
        name: 'idx_services_technician_id',
      },
      {
        key: { technicianEmail: 1 },
        name: 'idx_services_technician_email',
      },
      {
        key: { status: 1 },
        name: 'idx_services_status',
      },
      {
        key: { category: 1 },
        name: 'idx_services_category',
      },
      {
        key: { serviceMode: 1 },
        name: 'idx_services_mode',
      },
      {
        key: { createdAt: -1 },
        name: 'idx_services_created_at',
      },
      {
        key: { status: 1, category: 1, serviceMode: 1, estimatedPrice: 1 },
        name: 'idx_services_public_browse',
      },
      {
        key: { title: 'text', description: 'text' },
        name: 'idx_services_text_search',
      },
    ]);
    console.log(' - Services indexes initialized.');

    // 3. BOOKINGS COLLECTION INDEXES
    const bookings = getBookingsCollection();
    await bookings.createIndexes([
      {
        key: { customerId: 1 },
        name: 'idx_bookings_customer_id',
      },
      {
        key: { customerEmail: 1 },
        name: 'idx_bookings_customer_email',
      },
      {
        key: { technicianId: 1 },
        name: 'idx_bookings_technician_id',
      },
      {
        key: { technicianEmail: 1 },
        name: 'idx_bookings_technician_email',
      },
      {
        key: { serviceId: 1 },
        name: 'idx_bookings_service_id',
      },
      {
        key: { status: 1 },
        name: 'idx_bookings_status',
      },
      {
        key: { preferredDate: 1 },
        name: 'idx_bookings_preferred_date',
      },
      {
        key: { customerId: 1, createdAt: -1 },
        name: 'idx_bookings_customer_dashboard',
      },
      {
        key: { technicianId: 1, status: 1 },
        name: 'idx_bookings_technician_queue',
      },
      {
        key: { status: 1, paymentStatus: 1 },
        name: 'idx_bookings_status_payment',
      },
    ]);
    console.log(' - Bookings indexes initialized.');

    // 4. PAYMENTS COLLECTION INDEXES
    const payments = getPaymentsCollection();
    await payments.createIndexes([
      {
        key: { bookingId: 1 },
        name: 'idx_payments_booking_unique',
        unique: true,
      },
      {
        key: { stripeSessionId: 1 },
        name: 'idx_payments_stripe_session_unique',
        unique: true,
      },
      {
        key: { customerId: 1 },
        name: 'idx_payments_customer_id',
      },
      {
        key: { customerEmail: 1 },
        name: 'idx_payments_customer_email',
      },
      {
        key: { status: 1 },
        name: 'idx_payments_status',
      },
    ]);
    console.log(' - Payments indexes initialized.');
    console.log('[MongoDB Indexes] All domain collection indexes verified successfully.');
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown index initialization error';
    console.error(`[MongoDB Indexes Error] Failed to initialize indexes: ${message}`);
    throw error;
  }
}
