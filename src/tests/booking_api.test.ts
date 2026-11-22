import assert from 'node:assert/strict';
import http from 'node:http';
import { ObjectId } from 'mongodb';
import { memoryAdapter } from 'better-auth/adapters/memory';
import { betterAuth } from 'better-auth';
import { jwt as jwtPlugin, bearer } from 'better-auth/plugins';
import app from '../app.js';
import { _setMockAuthForTest, FixMateAuth } from '../auth/auth.js';
import { _setMockDbInstanceForTest } from '../db/connection.js';
import { signUserToken } from '../services/jwt.service.js';
import type { AuthenticatedUser } from '../types/auth.js';
import type { BookingDocument, ServiceDocument } from '../types/database.js';

interface TestMemoryStore {
  users: Array<Record<string, unknown>>;
  services: Array<ServiceDocument>;
  bookings: Array<BookingDocument>;
  session: Array<Record<string, unknown>>;
  account: Array<Record<string, unknown>>;
  verification: Array<Record<string, unknown>>;
  jwks: Array<Record<string, unknown>>;
  [key: string]: Array<any>;
}

function createTestAuth(store: TestMemoryStore): FixMateAuth {
  return betterAuth({
    database: memoryAdapter(store as any),
    baseURL: 'http://localhost:5009',
    secret: 'test_better_auth_secret_minimum_32_characters_12345678',
    trustedOrigins: ['http://localhost:5009', 'http://localhost:3000'],
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
            if (filter.status && item.status !== filter.status) return false;
            if (filter.approvalStatus && item.approvalStatus !== filter.approvalStatus) return false;
            if (filter.isAvailable !== undefined && item.isAvailable !== filter.isAvailable) return false;

            // Customer ownership
            if (filter.$or && (filter.$or[0]?.customerId || filter.$or[0]?.technicianId)) {
              if (filter.$or[0]?.customerId) {
                if (!matchesOwnership(item, filter.$or, 'customerId', 'customerEmail')) return false;
              } else if (filter.$or[0]?.technicianId) {
                if (!matchesOwnership(item, filter.$or, 'technicianId', 'technicianEmail')) return false;
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
            if (filter.status && item.status !== filter.status) return false;
            if (filter.approvalStatus && item.approvalStatus !== filter.approvalStatus) return false;
            if (filter.isAvailable !== undefined && item.isAvailable !== filter.isAvailable) return false;

            if (filter.$or && (filter.$or[0]?.customerId || filter.$or[0]?.technicianId)) {
              if (filter.$or[0]?.customerId) {
                if (!matchesOwnership(item, filter.$or, 'customerId', 'customerEmail')) return false;
              } else if (filter.$or[0]?.technicianId) {
                if (!matchesOwnership(item, filter.$or, 'technicianId', 'technicianEmail')) return false;
              }
            }
            return true;
          });
          return list.length;
        },
        findOne: async (filter: any) => {
          const table = store[name] || [];

          // Service / Booking lookup by ID
          if (filter._id) {
            return (
              table.find((item: any) => {
                if (String(item._id) !== String(filter._id)) return false;
                if (filter.approvalStatus && item.approvalStatus !== filter.approvalStatus) return false;
                if (filter.isAvailable !== undefined && item.isAvailable !== filter.isAvailable) return false;

                if (filter.$or && (filter.$or[0]?.customerId || filter.$or[0]?.technicianId)) {
                  if (filter.$or[0]?.customerId) {
                    if (!matchesOwnership(item, filter.$or, 'customerId', 'customerEmail')) return false;
                  } else if (filter.$or[0]?.technicianId) {
                    if (!matchesOwnership(item, filter.$or, 'technicianId', 'technicianEmail')) return false;
                  }
                }
                return true;
              }) || null
            );
          }

          // Active duplicate check using $and
          if (filter.$and) {
            const activeStatuses = ['requested', 'accepted', 'in-progress'];
            return (
              table.find((item: any) => {
                // Check status
                if (!activeStatuses.includes(item.status)) return false;
                // Check customer
                const custMatch = filter.$and[0]?.$or?.some(
                  (c: any) => String(c.customerId) === String(item.customerId)
                );
                if (!custMatch) return false;
                // Check service
                const servMatch = filter.$and[1]?.$or?.some(
                  (s: any) => String(s.serviceId) === String(item.serviceId)
                );
                if (!servMatch) return false;
                return true;
              }) || null
            );
          }

          // User lookup by sub or email
          if (filter.$or) {
            for (const item of filter.$or) {
              for (const doc of table) {
                if (item._id && (String(doc._id) === String(item._id) || String(doc.id) === String(item._id))) return doc;
                if (item.id && (String(doc.id) === String(item.id) || String(doc._id) === String(item.id))) return doc;
                if (item.email && String(doc.email).toLowerCase() === String(item.email).toLowerCase()) return doc;
              }
            }
            return null;
          }

          return null;
        },
        insertOne: async (doc: any) => {
          // Simulate partial unique index enforcement: idx_bookings_active_unique
          if (name === 'bookings') {
            const activeStatuses = ['requested', 'accepted', 'in-progress'];
            if (activeStatuses.includes(doc.status)) {
              const existingActive = (store.bookings || []).find(
                (b) =>
                  String(b.customerId) === String(doc.customerId) &&
                  String(b.serviceId) === String(doc.serviceId) &&
                  activeStatuses.includes(b.status)
              );
              if (existingActive) {
                const dupError: any = new Error(
                  `E11000 duplicate key error collection: fixmate.bookings index: idx_bookings_active_unique dup key: { customerId: "${doc.customerId}", serviceId: "${doc.serviceId}" }`
                );
                dupError.code = 11000;
                throw dupError;
              }
            }
          }

          const insertedId = new ObjectId();
          const item = { ...doc, _id: insertedId };
          store[name].push(item);
          return { insertedId };
        },
        findOneAndUpdate: async (filter: any, update: any, _options: any) => {
          const table = store[name] || [];
          const targetIndex = table.findIndex((item: any) => {
            if (filter._id && String(item._id) !== String(filter._id)) return false;
            if (filter.status && item.status !== filter.status) return false;

            if (filter.$or && (filter.$or[0]?.customerId || filter.$or[0]?.technicianId)) {
              if (filter.$or[0]?.customerId) {
                if (!matchesOwnership(item, filter.$or, 'customerId', 'customerEmail')) return false;
              } else if (filter.$or[0]?.technicianId) {
                if (!matchesOwnership(item, filter.$or, 'technicianId', 'technicianEmail')) return false;
              }
            }
            return true;
          });

          if (targetIndex === -1) return null;

          const currentDoc = table[targetIndex];
          const updatedDoc = {
            ...currentDoc,
            ...(update.$set || {}),
          };
          table[targetIndex] = updatedDoc;
          return updatedDoc;
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
}): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: any }> {
  return new Promise((resolve, reject) => {
    const postData = options.body ? JSON.stringify(options.body) : undefined;
    const reqHeaders: Record<string, string> = {
      ...(options.headers || {}),
    };
    if (postData) {
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

async function runBookingTestSuite() {
  console.log('=== FixMate TASK 010: Booking API & Lifecycle Management Tests ===');

  const store: TestMemoryStore = {
    users: [],
    services: [],
    bookings: [],
    session: [],
    account: [],
    verification: [],
    jwks: [],
  };

  const mockDb = buildMockDb(store);
  _setMockDbInstanceForTest({} as any, mockDb as any);

  const mockAuth = createTestAuth(store);
  _setMockAuthForTest(mockAuth);

  // Start HTTP test server
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
    // Setup test identities
    const customerUser1: AuthenticatedUser = {
      id: new ObjectId().toHexString(),
      email: 'customer1@fixmate.io',
      name: 'Alice Customer',
      role: 'customer',
    };
    const customerUser2: AuthenticatedUser = {
      id: new ObjectId().toHexString(),
      email: 'customer2@fixmate.io',
      name: 'Bob Customer',
      role: 'customer',
    };
    const techUser1: AuthenticatedUser = {
      id: new ObjectId().toHexString(),
      email: 'tech1@fixmate.io',
      name: 'Dave Technician',
      role: 'technician',
    };
    const techUser2: AuthenticatedUser = {
      id: new ObjectId().toHexString(),
      email: 'tech2@fixmate.io',
      name: 'Elena Technician',
      role: 'technician',
    };
    const adminUser: AuthenticatedUser = {
      id: new ObjectId().toHexString(),
      email: 'admin@fixmate.io',
      name: 'Admin Boss',
      role: 'admin',
    };

    store.users.push(
      customerUser1 as any,
      customerUser2 as any,
      techUser1 as any,
      techUser2 as any,
      adminUser as any
    );

    const tokenCust1 = await signUserToken(customerUser1);
    const tokenCust2 = await signUserToken(customerUser2);
    const tokenTech1 = await signUserToken(techUser1);
    const tokenTech2 = await signUserToken(techUser2);
    const tokenAdmin = await signUserToken(adminUser);

    // Setup active approved service owned by tech1
    const service1: ServiceDocument = {
      _id: new ObjectId(),
      technicianId: techUser1.id,
      technicianName: techUser1.name!,
      technicianEmail: techUser1.email,
      title: 'MacBook Logic Board Micro-soldering',
      description: 'Precision component-level repair for damaged logic boards',
      category: 'Laptop Repair',
      serviceMode: 'onsite',
      basePrice: 150,
      estimatedDuration: '2-3 hours',
      image: 'https://images.fixmate.io/macbook.jpg',
      approvalStatus: 'approved',
      isAvailable: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    // Unapproved service
    const unapprovedService: ServiceDocument = {
      _id: new ObjectId(),
      technicianId: techUser1.id,
      technicianName: techUser1.name!,
      technicianEmail: techUser1.email,
      title: 'Unapproved Repair Service',
      description: 'Pending review',
      category: 'Electronics',
      serviceMode: 'remote',
      basePrice: 50,
      estimatedDuration: '1 hour',
      image: 'https://images.fixmate.io/placeholder.jpg',
      approvalStatus: 'pending',
      isAvailable: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    // Unavailable service
    const unavailableService: ServiceDocument = {
      _id: new ObjectId(),
      technicianId: techUser1.id,
      technicianName: techUser1.name!,
      technicianEmail: techUser1.email,
      title: 'Unavailable Repair Service',
      description: 'Currently out of service parts',
      category: 'Appliance',
      serviceMode: 'onsite',
      basePrice: 120,
      estimatedDuration: '2 hours',
      image: 'https://images.fixmate.io/placeholder.jpg',
      approvalStatus: 'approved',
      isAvailable: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    store.services.push(service1, unapprovedService, unavailableService);

    // Future date for bookings
    const futureDate = new Date();
    futureDate.setDate(futureDate.getDate() + 5);

    console.log('\n--- Group A: Booking Creation & Service Snapshot Derivation ---');

    // Test 1: Customer creates valid booking -> 201 Created with server snapshot
    const createRes = await request({
      method: 'POST',
      path: '/api/bookings',
      headers: { Authorization: `Bearer ${tokenCust1}` },
      body: {
        serviceId: service1._id!.toHexString(),
        customerPhone: '+1-555-0199',
        address: '742 Evergreen Terrace, Springfield',
        preferredDate: futureDate.toISOString(),
        problemDescription: 'MacBook shuts down abruptly under GPU load.',
      },
    });

    assert.equal(createRes.status, 201, 'Valid booking creation should return 201');
    assert.equal(createRes.body.success, true);
    assert.equal(createRes.body.data.status, 'requested', 'New booking status must be requested');
    assert.equal(createRes.body.data.paymentStatus, 'unpaid', 'New booking paymentStatus must be unpaid');
    assert.equal(createRes.body.data.finalAmount, null, 'New booking finalAmount must be null');

    // Verify Server-derived Snapshot
    assert.equal(createRes.body.data.serviceTitle, service1.title);
    assert.equal(createRes.body.data.serviceImage, service1.image);
    assert.equal(createRes.body.data.serviceCategory, service1.category);
    assert.equal(createRes.body.data.basePrice, service1.basePrice);
    assert.equal(createRes.body.data.technicianName, techUser1.name);
    assert.equal(createRes.body.data.technicianEmail, techUser1.email);
    assert.equal(createRes.body.data.customerName, customerUser1.name);
    assert.equal(createRes.body.data.customerEmail, customerUser1.email);
    console.log('[Test 1 Passed] Valid customer booking created with server-derived snapshot & initial requested/unpaid status.');

    const bookingId1 = createRes.body.data._id;

    // Test 2: Client injection attempts blocked (.strict() rejects unexpected fields)
    const injectionRes = await request({
      method: 'POST',
      path: '/api/bookings',
      headers: { Authorization: `Bearer ${tokenCust1}` },
      body: {
        serviceId: service1._id!.toHexString(),
        customerPhone: '+1-555-0199',
        address: '742 Evergreen Terrace',
        preferredDate: futureDate.toISOString(),
        problemDescription: 'Testing injection attack',
        status: 'completed', // Injected!
        finalAmount: 1, // Injected!
        paymentStatus: 'paid', // Injected!
      },
    });
    assert.equal(injectionRes.status, 400, 'Injected fields must be rejected with 400 Bad Request');
    console.log('[Test 2 Passed] Client injection of status, finalAmount, or paymentStatus strictly rejected with 400.');

    // Test 3: Unapproved service rejected
    const unapprovedRes = await request({
      method: 'POST',
      path: '/api/bookings',
      headers: { Authorization: `Bearer ${tokenCust1}` },
      body: {
        serviceId: unapprovedService._id!.toHexString(),
        customerPhone: '+1-555-0199',
        address: '742 Evergreen Terrace',
        preferredDate: futureDate.toISOString(),
        problemDescription: 'Laptop won’t turn on',
      },
    });
    assert.equal(unapprovedRes.status, 400, 'Unapproved service booking must be rejected with 400');
    console.log('[Test 3 Passed] Unapproved service booking rejected with 400.');

    // Test 4: Unavailable service rejected
    const unavailableRes = await request({
      method: 'POST',
      path: '/api/bookings',
      headers: { Authorization: `Bearer ${tokenCust1}` },
      body: {
        serviceId: unavailableService._id!.toHexString(),
        customerPhone: '+1-555-0199',
        address: '742 Evergreen Terrace',
        preferredDate: futureDate.toISOString(),
        problemDescription: 'Appliance broken',
      },
    });
    assert.equal(unavailableRes.status, 400, 'Unavailable service booking must be rejected with 400');
    console.log('[Test 4 Passed] Unavailable service booking rejected with 400.');

    // Test 5: Missing service returns 404
    const missingRes = await request({
      method: 'POST',
      path: '/api/bookings',
      headers: { Authorization: `Bearer ${tokenCust1}` },
      body: {
        serviceId: new ObjectId().toHexString(),
        customerPhone: '+1-555-0199',
        address: '742 Evergreen Terrace',
        preferredDate: futureDate.toISOString(),
        problemDescription: 'Non-existent service test',
      },
    });
    assert.equal(missingRes.status, 404, 'Non-existent service must return 404');
    console.log('[Test 5 Passed] Missing service returns 404 Not Found.');

    // Test 6: Technician cannot book (Role guard blocks with 403)
    const techBookRes = await request({
      method: 'POST',
      path: '/api/bookings',
      headers: { Authorization: `Bearer ${tokenTech1}` },
      body: {
        serviceId: service1._id!.toHexString(),
        customerPhone: '+1-555-0199',
        address: '742 Evergreen Terrace',
        preferredDate: futureDate.toISOString(),
        problemDescription: 'Technician attempting customer action',
      },
    });
    assert.equal(techBookRes.status, 403, 'Technician role must be forbidden from customer booking route');
    console.log('[Test 6 Passed] Non-customer role blocked with 403 Forbidden.');

    console.log('\n--- Group B: Duplicate Active Booking Prevention ---');

    // Test 7: Duplicate active booking by same customer for same service returns 409
    const dupRes = await request({
      method: 'POST',
      path: '/api/bookings',
      headers: { Authorization: `Bearer ${tokenCust1}` },
      body: {
        serviceId: service1._id!.toHexString(),
        customerPhone: '+1-555-0199',
        address: '742 Evergreen Terrace',
        preferredDate: futureDate.toISOString(),
        problemDescription: 'Duplicate active booking attempt.',
      },
    });
    assert.equal(dupRes.status, 409, 'Duplicate active booking must return 409 Conflict');
    console.log('[Test 7 Passed] Duplicate active booking correctly rejected with 409 Conflict.');

    // Test 8: Another customer CAN book the same service (no cross-customer conflict)
    const cust2Res = await request({
      method: 'POST',
      path: '/api/bookings',
      headers: { Authorization: `Bearer ${tokenCust2}` },
      body: {
        serviceId: service1._id!.toHexString(),
        customerPhone: '+1-555-0222',
        address: '100 Main St, Metropolis',
        preferredDate: futureDate.toISOString(),
        problemDescription: 'Another customer booking same service.',
      },
    });
    assert.equal(cust2Res.status, 201, 'Different customer must be able to book same service');
    console.log('[Test 8 Passed] Different customer successfully books same service.');

    console.log('\n--- Group C: Customer Operations & Cancellation Lifecycle ---');

    // Test 9: Customer 1 sees only their own booking (Isolation)
    const myBookingsRes = await request({
      method: 'GET',
      path: '/api/bookings/my',
      headers: { Authorization: `Bearer ${tokenCust1}` },
    });
    assert.equal(myBookingsRes.status, 200);
    assert.equal(myBookingsRes.body.data.length, 1);
    assert.equal(myBookingsRes.body.data[0].customerEmail, customerUser1.email);
    console.log('[Test 9 Passed] Customer views only their own bookings in /api/bookings/my.');

    // Test 10: Customer 2 cannot read Customer 1 booking by ID (404 Not Found)
    const crossReadRes = await request({
      method: 'GET',
      path: `/api/bookings/${bookingId1}`,
      headers: { Authorization: `Bearer ${tokenCust2}` },
    });
    assert.equal(crossReadRes.status, 404, 'Cross-customer read must return 404');
    console.log('[Test 10 Passed] Cross-customer booking read strictly denied with 404.');

    // Test 11: Customer cancels their requested booking
    const cancelRes = await request({
      method: 'PATCH',
      path: `/api/bookings/${bookingId1}/cancel`,
      headers: { Authorization: `Bearer ${tokenCust1}` },
    });
    assert.equal(cancelRes.status, 200, 'Cancellation of requested booking must succeed');
    assert.equal(cancelRes.body.data.status, 'cancelled');
    console.log('[Test 11 Passed] Customer successfully cancelled requested booking.');

    // Test 12: Customer cannot cancel an already cancelled booking (409 Conflict)
    const cancelAgainRes = await request({
      method: 'PATCH',
      path: `/api/bookings/${bookingId1}/cancel`,
      headers: { Authorization: `Bearer ${tokenCust1}` },
    });
    assert.equal(cancelAgainRes.status, 409, 'Cancelling already cancelled booking must return 409');
    console.log('[Test 12 Passed] Repeat cancellation attempt returns 409 Conflict.');

    // Test 13: Customer can now book the same service again since previous is cancelled
    const rebookRes = await request({
      method: 'POST',
      path: '/api/bookings',
      headers: { Authorization: `Bearer ${tokenCust1}` },
      body: {
        serviceId: service1._id!.toHexString(),
        customerPhone: '+1-555-0199',
        address: '742 Evergreen Terrace',
        preferredDate: futureDate.toISOString(),
        problemDescription: 'Re-booking service after previous was cancelled.',
      },
    });
    assert.equal(rebookRes.status, 201, 'Re-booking after cancellation must succeed');
    const bookingId2 = rebookRes.body.data._id;
    console.log('[Test 13 Passed] Customer successfully re-booked service after previous was cancelled.');

    console.log('\n--- Group D: Technician Lifecycle Management & Validations ---');

    // Test 14: Tech 1 sees assigned booking; Tech 2 does not (Technician Isolation)
    const tech1QueueRes = await request({
      method: 'GET',
      path: '/api/technician/bookings',
      headers: { Authorization: `Bearer ${tokenTech1}` },
    });
    assert.equal(tech1QueueRes.status, 200);
    assert.ok(tech1QueueRes.body.data.some((b: any) => b._id === bookingId2));

    const tech2QueueRes = await request({
      method: 'GET',
      path: '/api/technician/bookings',
      headers: { Authorization: `Bearer ${tokenTech2}` },
    });
    assert.equal(tech2QueueRes.status, 200);
    assert.ok(!tech2QueueRes.body.data.some((b: any) => b._id === bookingId2));
    console.log('[Test 14 Passed] Technician booking queue strictly isolated to assigned technician.');

    // Test 15: Cross-technician read denied with 404
    const crossTechRead = await request({
      method: 'GET',
      path: `/api/technician/bookings/${bookingId2}`,
      headers: { Authorization: `Bearer ${tokenTech2}` },
    });
    assert.equal(crossTechRead.status, 404, 'Unassigned technician read must return 404');
    console.log('[Test 15 Passed] Cross-technician booking access denied with 404 Not Found.');

    // Test 16: Technician cannot skip steps (e.g. requested -> completed)
    const skipStepRes = await request({
      method: 'PATCH',
      path: `/api/technician/bookings/${bookingId2}/status`,
      headers: { Authorization: `Bearer ${tokenTech1}` },
      body: { status: 'completed', finalAmount: 200 },
    });
    assert.equal(skipStepRes.status, 409, 'Skipping lifecycle steps must return 409 Conflict');
    console.log('[Test 16 Passed] Invalid transition (requested -> completed) rejected with 409.');

    // Test 17: Technician accepts requested booking (requested -> accepted)
    const acceptRes = await request({
      method: 'PATCH',
      path: `/api/technician/bookings/${bookingId2}/status`,
      headers: { Authorization: `Bearer ${tokenTech1}` },
      body: { status: 'accepted' },
    });
    assert.equal(acceptRes.status, 200);
    assert.equal(acceptRes.body.data.status, 'accepted');
    console.log('[Test 17 Passed] Technician accepted requested booking.');

    // Test 18: Customer CANNOT cancel accepted booking (409 Conflict)
    const custCancelAccepted = await request({
      method: 'PATCH',
      path: `/api/bookings/${bookingId2}/cancel`,
      headers: { Authorization: `Bearer ${tokenCust1}` },
    });
    assert.equal(custCancelAccepted.status, 409, 'Customer cancelling accepted booking must return 409');
    console.log('[Test 18 Passed] Customer cancellation of accepted booking rejected with 409.');

    // Test 19: Technician advances accepted -> in-progress
    const inProgressRes = await request({
      method: 'PATCH',
      path: `/api/technician/bookings/${bookingId2}/status`,
      headers: { Authorization: `Bearer ${tokenTech1}` },
      body: { status: 'in-progress' },
    });
    assert.equal(inProgressRes.status, 200);
    assert.equal(inProgressRes.body.data.status, 'in-progress');
    console.log('[Test 19 Passed] Technician advanced booking to in-progress.');

    // Test 20: Completion without finalAmount rejected with 400
    const completeNoAmount = await request({
      method: 'PATCH',
      path: `/api/technician/bookings/${bookingId2}/status`,
      headers: { Authorization: `Bearer ${tokenTech1}` },
      body: { status: 'completed' },
    });
    assert.equal(completeNoAmount.status, 400, 'Completion without finalAmount must return 400');

    // Test 21: Completion with negative, zero or infinite amount rejected with 400
    const completeNegative = await request({
      method: 'PATCH',
      path: `/api/technician/bookings/${bookingId2}/status`,
      headers: { Authorization: `Bearer ${tokenTech1}` },
      body: { status: 'completed', finalAmount: -50 },
    });
    assert.equal(completeNegative.status, 400, 'Completion with negative amount must return 400');
    console.log('[Test 20 & 21 Passed] Completion without valid positive finalAmount rejected with 400.');

    // Test 22: Technician completes in-progress booking with valid finalAmount
    const completeValid = await request({
      method: 'PATCH',
      path: `/api/technician/bookings/${bookingId2}/status`,
      headers: { Authorization: `Bearer ${tokenTech1}` },
      body: { status: 'completed', finalAmount: 175.5 },
    });
    assert.equal(completeValid.status, 200);
    assert.equal(completeValid.body.data.status, 'completed');
    assert.equal(completeValid.body.data.finalAmount, 175.5);
    assert.equal(completeValid.body.data.paymentStatus, 'unpaid', 'Payment status must remain unpaid upon completion');
    assert.ok(completeValid.body.data.completedAt, 'completedAt timestamp must be recorded');
    console.log('[Test 22 Passed] Technician successfully completed booking with valid finalAmount.');

    // Test 23: Technician rejects requested booking (requested -> rejected)
    const cust2BookingId = cust2Res.body.data._id;
    const rejectRes = await request({
      method: 'PATCH',
      path: `/api/technician/bookings/${cust2BookingId}/status`,
      headers: { Authorization: `Bearer ${tokenTech1}` },
      body: { status: 'rejected' },
    });
    assert.equal(rejectRes.status, 200);
    assert.equal(rejectRes.body.data.status, 'rejected');
    console.log('[Test 23 Passed] Technician successfully rejected requested booking.');

    // Test 24: Customer 2 can book again after rejection
    const cust2Rebook = await request({
      method: 'POST',
      path: '/api/bookings',
      headers: { Authorization: `Bearer ${tokenCust2}` },
      body: {
        serviceId: service1._id!.toHexString(),
        customerPhone: '+1-555-0222',
        address: '100 Main St, Metropolis',
        preferredDate: futureDate.toISOString(),
        problemDescription: 'Re-booking after rejection test.',
      },
    });
    assert.equal(cust2Rebook.status, 201, 'Customer can re-book after rejection');
    console.log('[Test 24 Passed] Customer successfully re-booked service after previous was rejected.');

    console.log('\n--- Group E: Admin Booking Inspection & Filtering ---');

    // Test 25: Admin lists all bookings
    const adminAllRes = await request({
      method: 'GET',
      path: '/api/admin/bookings',
      headers: { Authorization: `Bearer ${tokenAdmin}` },
    });
    assert.equal(adminAllRes.status, 200);
    assert.ok(adminAllRes.body.data.length >= 3);
    assert.ok(adminAllRes.body.pagination);

    // Test 26: Admin filters by status (status=completed)
    const adminCompletedRes = await request({
      method: 'GET',
      path: '/api/admin/bookings?status=completed',
      headers: { Authorization: `Bearer ${tokenAdmin}` },
    });
    assert.equal(adminCompletedRes.status, 200);
    assert.ok(adminCompletedRes.body.data.every((b: any) => b.status === 'completed'));
    console.log('[Test 25 & 26 Passed] Admin lists all bookings and successfully filters by status.');

    console.log('\n--- Group F: Security & Role Boundaries ---');

    // Test 27: Missing token returns 401
    const unauthRes = await request({
      method: 'GET',
      path: '/api/admin/bookings',
    });
    assert.equal(unauthRes.status, 401, 'Missing token must return 401');

    // Test 28: Customer accessing admin routes returns 403
    const custAdminRes = await request({
      method: 'GET',
      path: '/api/admin/bookings',
      headers: { Authorization: `Bearer ${tokenCust1}` },
    });
    assert.equal(custAdminRes.status, 403, 'Customer on admin route must return 403');

    // Test 29: Technician accessing customer booking creation returns 403
    const techCreateRes = await request({
      method: 'POST',
      path: '/api/bookings',
      headers: { Authorization: `Bearer ${tokenTech1}` },
      body: {
        serviceId: service1._id!.toHexString(),
        customerPhone: '+1-555-0199',
        address: '742 Evergreen Terrace',
        preferredDate: futureDate.toISOString(),
        problemDescription: 'Technician role blocked from customer creation',
      },
    });
    assert.equal(techCreateRes.status, 403, 'Technician creating booking must return 403');
    console.log('[Test 27, 28, 29 Passed] Strict role boundaries and unauthenticated rejections verified.');

    console.log('\n===============================================================');
    console.log('=== ALL TASK 010 BOOKING LIFECYCLE TESTS PASSED! ===');
    console.log('===============================================================');
  } finally {
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  }
}

runBookingTestSuite().catch((err) => {
  console.error('\n[FATAL] Booking test suite failed:', err);
  if (server) server.close();
  process.exit(1);
});
