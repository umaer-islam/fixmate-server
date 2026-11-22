import assert from 'node:assert/strict';
import http from 'node:http';
import { ObjectId } from 'mongodb';
import { memoryAdapter } from 'better-auth/adapters/memory';
import { betterAuth } from 'better-auth';
import { jwt as jwtPlugin, bearer } from 'better-auth/plugins';
import app from '../app.js';
import { _setMockAuthForTest, FixMateAuth } from '../auth/auth.js';
import { _setMockDbInstanceForTest } from '../db/connection.js';
import { _setMockStripeClientForTest } from '../config/stripe.js';
import { signUserToken } from '../services/jwt.service.js';
import type { AuthenticatedUser } from '../types/auth.js';
import type { BookingDocument, PaymentDocument, ServiceDocument } from '../types/database.js';

interface TestMemoryStore {
  users: Array<Record<string, unknown>>;
  services: Array<ServiceDocument>;
  bookings: Array<BookingDocument>;
  payments: Array<PaymentDocument>;
  session: Array<Record<string, unknown>>;
  account: Array<Record<string, unknown>>;
  verification: Array<Record<string, unknown>>;
  jwks: Array<Record<string, unknown>>;
  [key: string]: Array<any>;
}

function createTestAuth(store: TestMemoryStore): FixMateAuth {
  return betterAuth({
    database: memoryAdapter(store as any),
    baseURL: 'http://localhost:5010',
    secret: 'test_better_auth_secret_minimum_32_characters_12345678',
    trustedOrigins: ['http://localhost:5010', 'http://localhost:3000'],
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: false,
    },
    user: {
      modelName: 'users',
      additionalFields: {
        role: {
          type: 'string',
          required: false,
          defaultValue: 'customer',
          input: false,
        },
      },
    },
    plugins: [
      jwtPlugin({
        jwt: {
          definePayload: (session) => ({
            sub: session.user.id,
            email: session.user.email,
            role: session.user.role,
          }),
        },
      }),
      bearer(),
    ],
  }) as unknown as FixMateAuth;
}

function matchesOwnership(doc: any, filterOr: any[], idField: string, emailField: string): boolean {
  if (!filterOr) return true;
  return filterOr.some((c: any) => {
    if (c[idField] && String(doc[idField]) === String(c[idField])) return true;
    if (
      c[emailField] &&
      doc[emailField]?.toLowerCase() === c[emailField].toLowerCase() &&
      (doc[idField] === null || doc[idField] === undefined)
    ) {
      return true;
    }
    return false;
  });
}

function buildMockDb(store: TestMemoryStore) {
  return {
    collection: (name: string) => {
      return {
        find: (filter: any = {}) => {
          let list = [...(store[name] || [])];

          list = list.filter((item: any) => {
            if (filter.paymentStatus && item.paymentStatus !== filter.paymentStatus) return false;
            if (filter.status && item.status !== filter.status) return false;

            if (filter.$or) {
              if (filter.$or[0]?.customerId) {
                if (!matchesOwnership(item, filter.$or, 'customerId', 'customerEmail')) return false;
              }
            }
            return true;
          });

          return {
            sort: (_sortObj: any) => ({
              skip: (skipCount: number) => ({
                limit: (limitCount: number) => ({
                  toArray: async () => list.slice(skipCount, skipCount + limitCount),
                }),
              }),
            }),
          };
        },
        countDocuments: async (filter: any = {}) => {
          let list = [...(store[name] || [])];
          list = list.filter((item: any) => {
            if (filter.paymentStatus && item.paymentStatus !== filter.paymentStatus) return false;
            if (filter.status && item.status !== filter.status) return false;

            if (filter.$or && filter.$or[0]?.customerId) {
              if (!matchesOwnership(item, filter.$or, 'customerId', 'customerEmail')) return false;
            }
            return true;
          });
          return list.length;
        },
        findOne: async (filter: any) => {
          const table = store[name] || [];

          if (filter.bookingId) {
            return (
              table.find((item: any) => String(item.bookingId) === String(filter.bookingId)) || null
            );
          }

          if (filter._id) {
            return (
              table.find((item: any) => {
                if (String(item._id) !== String(filter._id)) return false;
                if (filter.paymentStatus && item.paymentStatus !== filter.paymentStatus) return false;

                if (filter.$or && filter.$or[0]?.customerId) {
                  if (!matchesOwnership(item, filter.$or, 'customerId', 'customerEmail')) return false;
                }
                return true;
              }) || null
            );
          }

          if (filter.$or) {
            for (const cond of filter.$or) {
              const found = table.find((item: any) => {
                if (cond.stripeSessionId && item.stripeSessionId === cond.stripeSessionId) return true;
                if (cond.bookingId && String(item.bookingId) === String(cond.bookingId)) return true;
                if (cond._id && (String(item._id) === String(cond._id) || String(item.id) === String(cond._id))) return true;
                if (cond.id && (String(item.id) === String(cond.id) || String(item._id) === String(cond.id))) return true;
                if (cond.email && String(item.email).toLowerCase() === String(cond.email).toLowerCase()) return true;
                return false;
              });
              if (found) return found;
            }
            return null;
          }

          return null;
        },
        insertOne: async (doc: any) => {
          if (name === 'payments') {
            const dup = store.payments.find(
              (p) => String(p.bookingId) === String(doc.bookingId) || p.stripeSessionId === doc.stripeSessionId
            );
            if (dup) {
              const err: any = new Error('E11000 duplicate key error on payments unique index');
              err.code = 11000;
              throw err;
            }
          }
          const insertedId = new ObjectId();
          const item = { ...doc, _id: insertedId };
          store[name].push(item);
          return { insertedId };
        },
        updateOne: async (filter: any, update: any) => {
          const table = store[name] || [];
          const idx = table.findIndex((item: any) => String(item._id) === String(filter._id));
          if (idx !== -1) {
            table[idx] = { ...table[idx], ...(update.$set || {}) };
            return { matchedCount: 1, modifiedCount: 1 };
          }
          return { matchedCount: 0, modifiedCount: 0 };
        },
        findOneAndUpdate: async (filter: any, update: any, _options: any) => {
          const table = store[name] || [];
          const idx = table.findIndex((item: any) => {
            if (filter._id && String(item._id) !== String(filter._id)) return false;
            if (filter.paymentStatus && item.paymentStatus !== filter.paymentStatus) return false;
            if (filter.status && item.status !== filter.status) return false;
            return true;
          });

          if (idx === -1) return null;
          const updated = { ...table[idx], ...(update.$set || {}) };
          table[idx] = updated;
          return updated;
        },
      };
    },
  };
}

let server: http.Server;
let port: number;

function request(options: {
  method: string;
  path: string;
  headers?: Record<string, string>;
  body?: any;
  rawBodyBuffer?: Buffer;
}): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: any }> {
  return new Promise((resolve, reject) => {
    let postData: Buffer | string | undefined;
    const reqHeaders: Record<string, string> = { ...(options.headers || {}) };

    if (options.rawBodyBuffer) {
      postData = options.rawBodyBuffer;
      reqHeaders['Content-Length'] = options.rawBodyBuffer.length.toString();
    } else if (options.body) {
      postData = JSON.stringify(options.body);
      reqHeaders['Content-Type'] = 'application/json';
      reqHeaders['Content-Length'] = Buffer.byteLength(postData).toString();
    }

    const req = http.request(
      {
        hostname: 'localhost',
        port,
        path: options.path,
        method: options.method,
        headers: reqHeaders,
      },
      (res) => {
        let rawData = '';
        res.on('data', (chunk) => {
          rawData += chunk;
        });
        res.on('end', () => {
          let parsed: any = null;
          try {
            parsed = JSON.parse(rawData);
          } catch {
            parsed = rawData;
          }
          resolve({
            status: res.statusCode || 500,
            headers: res.headers,
            body: parsed,
          });
        });
      }
    );

    req.on('error', reject);
    if (postData) {
      req.write(postData);
    }
    req.end();
  });
}

async function runPaymentTestSuite() {
  console.log('=== FixMate TASK 011: Stripe Checkout & Payment Lifecycle Tests ===\n');

  const store: TestMemoryStore = {
    users: [],
    services: [],
    bookings: [],
    payments: [],
    session: [],
    account: [],
    verification: [],
    jwks: [],
  };

  const mockDb = buildMockDb(store);
  _setMockDbInstanceForTest({} as any, mockDb as any);

  const mockAuth = createTestAuth(store);
  _setMockAuthForTest(mockAuth);

  // Mock Stripe client
  let lastCreatedSessionParams: any = null;
  let lastIdempotencyKey: string | null = null;
  const mockStripe: any = {
    checkout: {
      sessions: {
        create: async (params: any, options?: any) => {
          lastCreatedSessionParams = params;
          lastIdempotencyKey = options?.idempotencyKey || null;
          return {
            id: 'cs_test_' + new ObjectId().toHexString(),
            url: `https://checkout.stripe.com/c/pay/cs_test_mock_url`,
            status: 'open',
          };
        },
        retrieve: async (sessionId: string) => {
          return {
            id: sessionId,
            url: `https://checkout.stripe.com/c/pay/${sessionId}`,
            status: 'open',
          };
        },
      },
    },
    webhooks: {
      constructEvent: (rawBody: Buffer | string, signature: string, secret: string) => {
        if (signature === 'invalid_sig') {
          throw new Error('Signature verification failed');
        }
        const text = Buffer.isBuffer(rawBody) ? rawBody.toString('utf8') : rawBody;
        return JSON.parse(text);
      },
    },
  };
  _setMockStripeClientForTest(mockStripe);

  await new Promise<void>((resolve) => {
    server = app.listen(0, () => {
      const address = server.address();
      if (address && typeof address !== 'string') {
        port = address.port;
      }
      resolve();
    });
  });

  try {
    // Setup test accounts
    const cust1: AuthenticatedUser = {
      id: new ObjectId().toHexString(),
      email: 'customer1@fixmate.io',
      name: 'Alice Customer',
      role: 'customer',
    };
    const cust2: AuthenticatedUser = {
      id: new ObjectId().toHexString(),
      email: 'customer2@fixmate.io',
      name: 'Bob Customer',
      role: 'customer',
    };
    const tech: AuthenticatedUser = {
      id: new ObjectId().toHexString(),
      email: 'tech@fixmate.io',
      name: 'Tom Technician',
      role: 'technician',
    };
    const admin: AuthenticatedUser = {
      id: new ObjectId().toHexString(),
      email: 'admin@fixmate.io',
      name: 'Boss Admin',
      role: 'admin',
    };

    store.users.push(cust1 as any, cust2 as any, tech as any, admin as any);

    const tokenCust1 = await signUserToken(cust1);
    const tokenCust2 = await signUserToken(cust2);
    const tokenTech = await signUserToken(tech);
    const tokenAdmin = await signUserToken(admin);

    // Setup completed unpaid booking for cust1
    const completedBookingId = new ObjectId();
    const completedBooking: BookingDocument = {
      _id: completedBookingId,
      serviceId: new ObjectId(),
      serviceTitle: 'Dishwasher Pump Replacement',
      serviceImage: 'https://images.fixmate.io/dishwasher.jpg',
      serviceCategory: 'Appliance',
      basePrice: 120,
      technicianId: tech.id,
      technicianName: tech.name!,
      technicianEmail: tech.email,
      customerId: cust1.id,
      customerName: cust1.name!,
      customerEmail: cust1.email,
      customerPhone: '+1-555-0199',
      address: '123 Pine St',
      preferredDate: new Date(),
      problemDescription: 'Water does not drain',
      status: 'completed',
      finalAmount: 185.5,
      paymentStatus: 'unpaid',
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    // Setup in-progress booking (non-completed)
    const inProgressBookingId = new ObjectId();
    const inProgressBooking: BookingDocument = {
      ...completedBooking,
      _id: inProgressBookingId,
      status: 'in-progress',
      finalAmount: null,
    };

    // Setup already paid booking
    const paidBookingId = new ObjectId();
    const paidBooking: BookingDocument = {
      ...completedBooking,
      _id: paidBookingId,
      status: 'completed',
      finalAmount: 150,
      paymentStatus: 'paid',
    };

    store.bookings.push(completedBooking, inProgressBooking, paidBooking);

    console.log('--- Group A: Checkout Session Authorization & Validation ---');

    // Test 1: Valid customer creates checkout session -> 200 OK
    const checkoutRes = await request({
      method: 'POST',
      path: '/api/payments/create-checkout-session',
      headers: { Authorization: `Bearer ${tokenCust1}` },
      body: { bookingId: completedBookingId.toHexString() },
    });
    assert.equal(checkoutRes.status, 200);
    assert.equal(checkoutRes.body.success, true);
    assert.ok(checkoutRes.body.data.url.includes('checkout.stripe.com'));
    assert.ok(checkoutRes.body.data.sessionId);

    // Verify Stripe parameters
    assert.equal(lastCreatedSessionParams.line_items[0].price_data.unit_amount, 18550); // $185.50 * 100
    assert.equal(lastCreatedSessionParams.line_items[0].price_data.currency, 'usd');
    assert.equal(lastCreatedSessionParams.metadata.bookingId, completedBookingId.toHexString());
    assert.equal(lastCreatedSessionParams.metadata.finalAmount, '185.5');
    assert.ok(lastIdempotencyKey);
    console.log('[Test 1 Passed] Customer creates Checkout Session with exact finalAmount cents and server metadata.');

    // Test 2: Customer cannot pay another customer's booking (404 Not Found)
    const crossPayRes = await request({
      method: 'POST',
      path: '/api/payments/create-checkout-session',
      headers: { Authorization: `Bearer ${tokenCust2}` },
      body: { bookingId: completedBookingId.toHexString() },
    });
    assert.equal(crossPayRes.status, 404, 'Paying another customer booking must return 404');
    console.log('[Test 2 Passed] Cross-customer payment initiation strictly denied with 404.');

    // Test 3: Technician cannot create Checkout Session (403 Forbidden)
    const techPayRes = await request({
      method: 'POST',
      path: '/api/payments/create-checkout-session',
      headers: { Authorization: `Bearer ${tokenTech}` },
      body: { bookingId: completedBookingId.toHexString() },
    });
    assert.equal(techPayRes.status, 403, 'Technician must be forbidden from payment creation');

    // Test 4: Admin cannot create Checkout Session (403 Forbidden)
    const adminPayRes = await request({
      method: 'POST',
      path: '/api/payments/create-checkout-session',
      headers: { Authorization: `Bearer ${tokenAdmin}` },
      body: { bookingId: completedBookingId.toHexString() },
    });
    assert.equal(adminPayRes.status, 403, 'Admin must be forbidden from customer checkout');
    console.log('[Test 3 & 4 Passed] Non-customer roles blocked with 403 Forbidden.');

    // Test 5: Non-completed booking rejected (400 Bad Request)
    const inProgressPayRes = await request({
      method: 'POST',
      path: '/api/payments/create-checkout-session',
      headers: { Authorization: `Bearer ${tokenCust1}` },
      body: { bookingId: inProgressBookingId.toHexString() },
    });
    assert.equal(inProgressPayRes.status, 400);
    assert.ok(inProgressPayRes.body.message.includes('Only completed bookings can be paid'));
    console.log('[Test 5 Passed] Non-completed booking payment rejected with 400.');

    // Test 6: Already paid booking rejected (409 Conflict)
    const alreadyPaidRes = await request({
      method: 'POST',
      path: '/api/payments/create-checkout-session',
      headers: { Authorization: `Bearer ${tokenCust1}` },
      body: { bookingId: paidBookingId.toHexString() },
    });
    assert.equal(alreadyPaidRes.status, 409);
    console.log('[Test 6 Passed] Already-paid booking payment rejected with 409 Conflict.');

    // Test 7: Client injection of amount/currency rejected (400 Bad Request)
    const injectionPayRes = await request({
      method: 'POST',
      path: '/api/payments/create-checkout-session',
      headers: { Authorization: `Bearer ${tokenCust1}` },
      body: {
        bookingId: completedBookingId.toHexString(),
        amount: 5, // Injected!
        currency: 'eur', // Injected!
      },
    });
    assert.equal(injectionPayRes.status, 400, 'Injected payment fields must be rejected');
    console.log('[Test 7 Passed] Client-supplied amount or currency injection rejected with 400.');

    console.log('\n--- Group B: Stripe Webhook Security & Signatures ---');

    const validWebhookPayload = {
      id: 'evt_test_123',
      type: 'checkout.session.completed',
      data: {
        object: {
          id: 'cs_test_session_abc',
          mode: 'payment',
          payment_status: 'paid',
          payment_intent: 'pi_test_intent_999',
          amount_total: 18550, // $185.50
          currency: 'usd',
          metadata: {
            bookingId: completedBookingId.toHexString(),
            customerId: cust1.id,
          },
        },
      },
    };

    // Test 8: Missing Stripe signature rejected with 400
    const missingSigRes = await request({
      method: 'POST',
      path: '/api/payments/webhook',
      body: validWebhookPayload,
    });
    assert.equal(missingSigRes.status, 400);
    assert.ok(missingSigRes.body.error.includes('Missing Stripe signature'));
    console.log('[Test 8 Passed] Missing Stripe signature rejected with 400.');

    // Test 9: Invalid Stripe signature rejected with 400
    const invalidSigRes = await request({
      method: 'POST',
      path: '/api/payments/webhook',
      headers: { 'stripe-signature': 'invalid_sig' },
      body: validWebhookPayload,
    });
    assert.equal(invalidSigRes.status, 400);
    assert.ok(invalidSigRes.body.error.includes('signature verification failed'));
    console.log('[Test 9 Passed] Cryptographically invalid Stripe signature rejected with 400.');

    // Test 10: Amount mismatch rejected with 400
    const tamperedAmountPayload = {
      ...validWebhookPayload,
      data: {
        object: {
          ...validWebhookPayload.data.object,
          amount_total: 5000, // Tampered!
        },
      },
    };
    const amountMismatchRes = await request({
      method: 'POST',
      path: '/api/payments/webhook',
      headers: { 'stripe-signature': 'valid_sig' },
      body: tamperedAmountPayload,
    });
    assert.equal(amountMismatchRes.status, 400);
    assert.ok(amountMismatchRes.body.error.includes('Amount mismatch'));
    console.log('[Test 10 Passed] Webhook payload with mismatched amount rejected with 400.');

    // Test 11: Valid webhook creates payment record & updates booking to paid
    const validWebhookRes = await request({
      method: 'POST',
      path: '/api/payments/webhook',
      headers: { 'stripe-signature': 'valid_sig' },
      body: validWebhookPayload,
    });
    assert.equal(validWebhookRes.status, 200);
    assert.equal(validWebhookRes.body.received, true);

    // Verify booking updated to paid
    const updatedBooking = store.bookings.find((b) => String(b._id) === completedBookingId.toHexString());
    assert.equal(updatedBooking?.paymentStatus, 'paid');

    // Verify payment record inserted
    const paymentRecord = store.payments.find((p) => String(p.bookingId) === completedBookingId.toHexString());
    assert.ok(paymentRecord);
    assert.equal(paymentRecord?.amount, 185.5);
    assert.equal(paymentRecord?.currency, 'usd');
    assert.equal(paymentRecord?.stripeSessionId, 'cs_test_session_abc');
    assert.equal(paymentRecord?.paymentStatus, 'paid');
    console.log('[Test 11 Passed] Valid webhook successfully settled booking & created payment record.');

    // Test 12: Idempotent repeat webhook does not create duplicate payment
    const repeatWebhookRes = await request({
      method: 'POST',
      path: '/api/payments/webhook',
      headers: { 'stripe-signature': 'valid_sig' },
      body: validWebhookPayload,
    });
    assert.equal(repeatWebhookRes.status, 200);
    assert.equal(repeatWebhookRes.body.received, true);
    const countPayments = store.payments.filter((p) => String(p.bookingId) === completedBookingId.toHexString());
    assert.equal(countPayments.length, 1, 'Only one payment record must exist');
    console.log('[Test 12 Passed] Repeat webhook delivery safely handled idempotently (0 duplicate records).');

    console.log('\n--- Group C: Customer Payment Status & History Retrieval ---');

    // Test 13: Customer 1 retrieves their payments
    const custPaymentsRes = await request({
      method: 'GET',
      path: '/api/payments/my',
      headers: { Authorization: `Bearer ${tokenCust1}` },
    });
    assert.equal(custPaymentsRes.status, 200);
    assert.equal(custPaymentsRes.body.data.length, 1);
    assert.equal(custPaymentsRes.body.data[0].amount, 185.5);

    // Test 14: Customer 2 has no payments (Isolation)
    const cust2PaymentsRes = await request({
      method: 'GET',
      path: '/api/payments/my',
      headers: { Authorization: `Bearer ${tokenCust2}` },
    });
    assert.equal(cust2PaymentsRes.status, 200);
    assert.equal(cust2PaymentsRes.body.data.length, 0);
    console.log('[Test 13 & 14 Passed] Customer payment history retrieved and isolated per customer.');

    // Test 15: Customer views payment status for their booking
    const bookingStatusRes = await request({
      method: 'GET',
      path: `/api/payments/booking/${completedBookingId.toHexString()}`,
      headers: { Authorization: `Bearer ${tokenCust1}` },
    });
    assert.equal(bookingStatusRes.status, 200);
    assert.equal(bookingStatusRes.body.data.paymentStatus, 'paid');
    assert.ok(bookingStatusRes.body.data.payment);

    // Test 16: Customer 2 cannot check Customer 1's booking payment status (404)
    const crossBookingStatusRes = await request({
      method: 'GET',
      path: `/api/payments/booking/${completedBookingId.toHexString()}`,
      headers: { Authorization: `Bearer ${tokenCust2}` },
    });
    assert.equal(crossBookingStatusRes.status, 404);
    console.log('[Test 15 & 16 Passed] Authoritative booking payment status retrieved and access-controlled.');

    console.log('\n===============================================================');
    console.log('=== ALL TASK 011 PAYMENT & STRIPE LIFECYCLE TESTS PASSED! ===');
    console.log('===============================================================');
  } finally {
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  }
}

runPaymentTestSuite().catch((err) => {
  console.error('\n[FATAL] Payment test suite failed:', err);
  if (server) server.close();
  process.exit(1);
});
