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
import type { ServiceDocument } from '../types/database.js';

interface TestMemoryStore {
  users: Array<Record<string, unknown>>;
  services: Array<ServiceDocument>;
  session: Array<Record<string, unknown>>;
  account: Array<Record<string, unknown>>;
  verification: Array<Record<string, unknown>>;
  jwks: Array<Record<string, unknown>>;
  [key: string]: Array<any>;
}

function createTestAuth(store: TestMemoryStore): FixMateAuth {
  return betterAuth({
    database: memoryAdapter(store as any),
    baseURL: 'http://localhost:5008',
    secret: 'test_better_auth_secret_minimum_32_characters_12345678',
    trustedOrigins: ['http://localhost:5008', 'http://localhost:3000'],
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

function buildMockDb(store: TestMemoryStore) {
  return {
    collection: (name: string) => {
      return {
        find: (filter: any = {}) => {
          let list = [...(store[name] || [])];

          // Apply filters
          list = list.filter((item: any) => {
            // Approval status
            if (filter.approvalStatus && item.approvalStatus !== filter.approvalStatus) return false;
            // Availability
            if (filter.isAvailable !== undefined && item.isAvailable !== filter.isAvailable) return false;
            // Category
            if (filter.category && item.category !== filter.category) return false;
            // ServiceMode
            if (filter.serviceMode && item.serviceMode !== filter.serviceMode) return false;
            // Base price range
            if (filter.basePrice) {
              if (filter.basePrice.$gte !== undefined && item.basePrice < filter.basePrice.$gte) return false;
              if (filter.basePrice.$lte !== undefined && item.basePrice > filter.basePrice.$lte) return false;
            }
            // Ownership / Search $or filters
            if (filter.$or) {
              const matchesAny = filter.$or.some((subCond: any) => {
                // Technician ID match
                if (subCond.technicianId && String(item.technicianId) === String(subCond.technicianId)) {
                  return true;
                }
                // Legacy email fallback (only when technicianId is absent)
                if (
                  subCond.technicianEmail &&
                  item.technicianEmail?.toLowerCase() === subCond.technicianEmail.toLowerCase() &&
                  (item.technicianId === null || item.technicianId === undefined)
                ) {
                  return true;
                }
                if (subCond.title && subCond.title.$regex) {
                  const reg = new RegExp(subCond.title.$regex, subCond.title.$options);
                  if (reg.test(item.title)) return true;
                }
                if (subCond.description && subCond.description.$regex) {
                  const reg = new RegExp(subCond.description.$regex, subCond.description.$options);
                  if (reg.test(item.description)) return true;
                }
                if (subCond.technicianName && subCond.technicianName.$regex) {
                  const reg = new RegExp(subCond.technicianName.$regex, subCond.technicianName.$options);
                  if (reg.test(item.technicianName)) return true;
                }
                return false;
              });
              if (!matchesAny) return false;
            }
            return true;
          });

          return {
            sort: (sortObj: any) => {
              if (sortObj?.basePrice === 1) {
                list.sort((a, b) => a.basePrice - b.basePrice);
              } else if (sortObj?.basePrice === -1) {
                list.sort((a, b) => b.basePrice - a.basePrice);
              } else if (sortObj?.createdAt === -1) {
                list.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
              }
              return {
                skip: (skipCount: number) => ({
                  limit: (limitCount: number) => ({
                    toArray: async () => list.slice(skipCount, skipCount + limitCount),
                  }),
                }),
              };
            },
          };
        },
        countDocuments: async (filter: any = {}) => {
          let list = [...(store[name] || [])];
          list = list.filter((item: any) => {
            if (filter.approvalStatus && item.approvalStatus !== filter.approvalStatus) return false;
            if (filter.isAvailable !== undefined && item.isAvailable !== filter.isAvailable) return false;
            if (filter.category && item.category !== filter.category) return false;
            if (filter.serviceMode && item.serviceMode !== filter.serviceMode) return false;
            if (filter.basePrice) {
              if (filter.basePrice.$gte !== undefined && item.basePrice < filter.basePrice.$gte) return false;
              if (filter.basePrice.$lte !== undefined && item.basePrice > filter.basePrice.$lte) return false;
            }
            if (filter.$or) {
              const matchesAny = filter.$or.some((subCond: any) => {
                if (subCond.technicianId && String(item.technicianId) === String(subCond.technicianId)) {
                  return true;
                }
                if (
                  subCond.technicianEmail &&
                  item.technicianEmail?.toLowerCase() === subCond.technicianEmail.toLowerCase() &&
                  (item.technicianId === null || item.technicianId === undefined)
                ) {
                  return true;
                }
                if (subCond.title && subCond.title.$regex) {
                  const reg = new RegExp(subCond.title.$regex, subCond.title.$options);
                  if (reg.test(item.title)) return true;
                }
                if (subCond.description && subCond.description.$regex) {
                  const reg = new RegExp(subCond.description.$regex, subCond.description.$options);
                  if (reg.test(item.description)) return true;
                }
                return false;
              });
              if (!matchesAny) return false;
            }
            return true;
          });
          return list.length;
        },
        findOne: async (filter: any) => {
          const table = store[name] || [];
          if (filter._id) {
            return (
              table.find((item: any) => {
                const idMatches = String(item._id) === String(filter._id);
                if (!idMatches) return false;
                if (filter.approvalStatus && item.approvalStatus !== filter.approvalStatus) return false;
                if (filter.isAvailable !== undefined && item.isAvailable !== filter.isAvailable) return false;
                if (filter.$or) {
                  return filter.$or.some((c: any) => {
                    if (c.technicianId && String(item.technicianId) === String(c.technicianId)) {
                      return true;
                    }
                    if (
                      c.technicianEmail &&
                      item.technicianEmail?.toLowerCase() === c.technicianEmail.toLowerCase() &&
                      (item.technicianId === null || item.technicianId === undefined)
                    ) {
                      return true;
                    }
                    return false;
                  });
                }
                return true;
              }) || null
            );
          }
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
          const insertedId = new ObjectId();
          const item = { ...doc, _id: insertedId };
          store[name].push(item);
          return { insertedId };
        },
        findOneAndUpdate: async (filter: any, update: any, _options: any) => {
          const table = store[name] || [];
          const targetIndex = table.findIndex((item: any) => {
            if (filter._id && String(item._id) !== String(filter._id)) return false;
            if (filter.$or) {
              return filter.$or.some((c: any) => {
                if (c.technicianId && String(item.technicianId) === String(c.technicianId)) {
                  return true;
                }
                if (
                  c.technicianEmail &&
                  item.technicianEmail?.toLowerCase() === c.technicianEmail.toLowerCase() &&
                  (item.technicianId === null || item.technicianId === undefined)
                ) {
                  return true;
                }
                return false;
              });
            }
            return true;
          });

          if (targetIndex === -1) return null;

          const updated = {
            ...table[targetIndex],
            ...(update.$set || {}),
          };
          table[targetIndex] = updated;
          return updated;
        },
        deleteOne: async (filter: any) => {
          const table = store[name] || [];
          const initialLen = table.length;
          store[name] = table.filter((item: any) => {
            if (filter._id && String(item._id) === String(filter._id)) {
              if (filter.$or) {
                const ownerMatches = filter.$or.some((c: any) => {
                  if (c.technicianId && String(item.technicianId) === String(c.technicianId)) {
                    return true;
                  }
                  if (
                    c.technicianEmail &&
                    item.technicianEmail?.toLowerCase() === c.technicianEmail.toLowerCase() &&
                    (item.technicianId === null || item.technicianId === undefined)
                  ) {
                    return true;
                  }
                  return false;
                });
                return !ownerMatches;
              }
              return false;
            }
            return true;
          });
          return { deletedCount: initialLen - store[name].length };
        },
      };
    },
  };
}

async function runTestSuite() {
  console.log('=== FixMate TASK 009A: Service API Specification & Security Audit Tests ===');
  console.log('(Running with in-memory double and authoritative database mock)\n');

  const store: TestMemoryStore = {
    users: [],
    services: [],
    session: [],
    account: [],
    verification: [],
    jwks: [],
  };

  const testAuth = createTestAuth(store);
  _setMockAuthForTest(testAuth);
  _setMockDbInstanceForTest(null, buildMockDb(store) as any);

  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(5008, resolve));

  try {
    // ------------------------------------------------------------------------
    // SETUP: Users & Tokens
    // ------------------------------------------------------------------------
    console.log('--- Setup: Users and Roles ---');

    const tech1Id = new ObjectId().toString();
    const tech2Id = new ObjectId().toString();
    const adminId = new ObjectId().toString();
    const customerId = new ObjectId().toString();

    const tech1User: AuthenticatedUser = {
      id: tech1Id,
      name: 'Tariq Tech',
      email: 'tariq@fixmate.com',
      role: 'technician',
    };
    const tech2User: AuthenticatedUser = {
      id: tech2Id,
      name: 'Rahim Tech',
      email: 'rahim@fixmate.com',
      role: 'technician',
    };
    const adminUser: AuthenticatedUser = {
      id: adminId,
      name: 'Sarah Admin',
      email: 'admin@fixmate.com',
      role: 'admin',
    };
    const customerUser: AuthenticatedUser = {
      id: customerId,
      name: 'Cathy Customer',
      email: 'cathy@example.com',
      role: 'customer',
    };

    store.users.push(
      { ...tech1User, _id: tech1Id },
      { ...tech2User, _id: tech2Id },
      { ...adminUser, _id: adminId },
      { ...customerUser, _id: customerId }
    );

    const tech1Token = await signUserToken(tech1User);
    const tech2Token = await signUserToken(tech2User);
    const adminToken = await signUserToken(adminUser);
    const customerToken = await signUserToken(customerUser);

    console.log('[Setup Complete] Minted tokens for Tech 1, Tech 2, Admin, and Customer.\n');

    // ------------------------------------------------------------------------
    // GROUP A: ServiceMode Strict Enum & Validation
    // ------------------------------------------------------------------------
    console.log('--- Group A: ServiceMode Strict Enum & Validation ---');

    // Test 1: ServiceMode must reject 'home-visit' and 'drop-off'
    const invalidModeRes = await fetch('http://localhost:5008/api/technician/services', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        authorization: `Bearer ${tech1Token}`,
      },
      body: JSON.stringify({
        title: 'Appliance Repair with Invalid Mode',
        category: 'Home Appliance',
        description: 'Testing that removed legacy serviceMode values are strictly rejected.',
        image: 'https://images.example.com/repair.jpg',
        basePrice: 50,
        estimatedDuration: '2 Hours',
        serviceMode: 'home-visit', // Legacy mode, now disallowed
      }),
    });
    assert.equal(invalidModeRes.status, 400, 'Legacy home-visit mode must be rejected with 400 Bad Request');
    console.log('[Test 1 Passed] Disallowed serviceMode "home-visit" rejected with 400.');

    // Test 2: Valid ServiceModes: 'onsite', 'remote', 'both'
    const validOnsiteRes = await fetch('http://localhost:5008/api/technician/services', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        authorization: `Bearer ${tech1Token}`,
      },
      body: JSON.stringify({
        title: 'AC Deep Cleaning & Gas Recharge',
        category: 'Home Appliance',
        description: 'Full chemical cleaning and vacuum leak check with factory gauge manifold.',
        image: 'https://images.example.com/ac.jpg',
        basePrice: 85,
        estimatedDuration: '3 Hours',
        serviceMode: 'onsite', // Valid
      }),
    });
    assert.equal(validOnsiteRes.status, 201, 'Valid serviceMode "onsite" must be accepted');
    const service1 = await validOnsiteRes.json();
    const service1Id = String(service1.data._id);
    assert.equal(service1.data.serviceMode, 'onsite');
    assert.ok(service1.data.image, 'Canonical property "image" must be present');
    console.log('[Test 2 Passed] Valid serviceMode "onsite" accepted and created with canonical "image".');

    // ------------------------------------------------------------------------
    // GROUP B: Query Safety & Price Range Validation
    // ------------------------------------------------------------------------
    console.log('\n--- Group B: Query Safety & Price Range Validation ---');

    // Test 3: minPrice cannot exceed maxPrice
    const invertedPriceRes = await fetch('http://localhost:5008/api/services?minPrice=100&maxPrice=50');
    assert.equal(invertedPriceRes.status, 400, 'minPrice exceeding maxPrice must be rejected with 400');
    const invertedPriceBody = await invertedPriceRes.json();
    assert.equal(invertedPriceBody.statusCode, 400);
    console.log('[Test 3 Passed] minPrice > maxPrice rejected with 400 Bad Request.');

    // ------------------------------------------------------------------------
    // GROUP C: Ownership Audit (Same ID, Different Email & Different ID, Same Email)
    // ------------------------------------------------------------------------
    console.log('\n--- Group C: Ownership Security Audit ---');

    // Test 4: Same ID, Changed Email (Technician retains ownership)
    // Technician 1 changes email in database to 'tariq_new@fixmate.com'
    const tech1UpdatedEmailUser: AuthenticatedUser = {
      id: tech1Id,
      name: 'Tariq Tech',
      email: 'tariq_new@fixmate.com',
      role: 'technician',
    };
    // Update user record in memory database
    const tech1Record = store.users.find((u) => u.id === tech1Id);
    if (tech1Record) tech1Record.email = 'tariq_new@fixmate.com';

    const tech1UpdatedToken = await signUserToken(tech1UpdatedEmailUser);

    // Technician 1 accesses their service with the new email token
    const sameIdDiffEmailRes = await fetch(`http://localhost:5008/api/technician/services/${service1Id}`, {
      headers: { authorization: `Bearer ${tech1UpdatedToken}` },
    });
    assert.equal(sameIdDiffEmailRes.status, 200, 'Technician with same ID and changed email must retain access');
    console.log('[Test 4 Passed] Same ID, different email: Ownership successfully preserved via immutable ID.');

    // Test 5: Different ID, Same Email (Cannot hijack service)
    // A different technician has tech2Id, but claims email 'tariq_new@fixmate.com'
    const impostorUser: AuthenticatedUser = {
      id: tech2Id,
      name: 'Rahim Impostor',
      email: 'tariq_new@fixmate.com', // Matching email, but different ID
      role: 'technician',
    };
    const tech2Record = store.users.find((u) => u.id === tech2Id);
    if (tech2Record) tech2Record.email = 'tariq_new@fixmate.com';

    const impostorToken = await signUserToken(impostorUser);

    // Impostor attempts to update Technician 1's service
    const impostorPatchRes = await fetch(`http://localhost:5008/api/technician/services/${service1Id}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        authorization: `Bearer ${impostorToken}`,
      },
      body: JSON.stringify({ basePrice: 999 }),
    });
    assert.equal(impostorPatchRes.status, 404, 'Different ID with same email must NOT be granted ownership');
    console.log('[Test 5 Passed] Different ID, same email: Impostor access strictly rejected with 404.');

    // Restore tech1 and tech2 emails
    if (tech1Record) tech1Record.email = 'tariq@fixmate.com';
    if (tech2Record) tech2Record.email = 'rahim@fixmate.com';

    // ------------------------------------------------------------------------
    // GROUP D: Moderation Notes & Content Edit Behavior
    // ------------------------------------------------------------------------
    console.log('\n--- Group D: Moderation Notes & Content Edit Behavior ---');

    // Test 6: Technician cannot pass or modify moderationNotes
    const techNotesAttemptRes = await fetch(`http://localhost:5008/api/technician/services/${service1Id}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        authorization: `Bearer ${tech1UpdatedToken}`,
      },
      body: JSON.stringify({
        basePrice: 90,
        moderationNotes: 'Self-cleared by technician', // Forbidden field
      }),
    });
    assert.equal(techNotesAttemptRes.status, 400, 'Technician modifying moderationNotes must be rejected with 400');
    console.log('[Test 6 Passed] Technician attempt to inject moderationNotes blocked with 400.');

    // Test 7: Admin approval makes service visible publicly
    // First verify service is NOT visible publicly (since it is pending)
    const pubCheckBefore = await fetch(`http://localhost:5008/api/services/${service1Id}`);
    assert.equal(pubCheckBefore.status, 404, 'Pending service must not be publicly visible');

    // Admin approves service
    const adminApproveRes = await fetch(`http://localhost:5008/api/admin/services/${service1Id}/approval`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({ approvalStatus: 'approved' }),
    });
    assert.equal(adminApproveRes.status, 200);

    // Verify service is NOW visible publicly with canonical "image"
    const pubCheckAfter = await fetch(`http://localhost:5008/api/services/${service1Id}`);
    assert.equal(pubCheckAfter.status, 200, 'Approved service must be publicly visible');
    const pubServiceData = await pubCheckAfter.json();
    assert.equal(pubServiceData.data.approvalStatus, 'approved');
    assert.ok(pubServiceData.data.image, 'Canonical property "image" must be returned');
    console.log('[Test 7 Passed] Admin approval makes service publicly visible with canonical "image".');

    // Test 8: Technician content edit on approved service returns approvalStatus to 'pending'
    const techEditApprovedRes = await fetch(`http://localhost:5008/api/technician/services/${service1Id}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        authorization: `Bearer ${tech1UpdatedToken}`,
      },
      body: JSON.stringify({ basePrice: 95 }),
    });
    assert.equal(techEditApprovedRes.status, 200);
    const techEditedData = await techEditApprovedRes.json();
    assert.equal(techEditedData.data.approvalStatus, 'pending', 'Edit on approved service must revert to pending');

    // Verify it is no longer visible publicly
    const pubCheckReverted = await fetch(`http://localhost:5008/api/services/${service1Id}`);
    assert.equal(pubCheckReverted.status, 404, 'Reverted pending service must not be publicly visible');
    console.log('[Test 8 Passed] Content edit reverted approved service to pending, removing it from public view.');

    console.log('\n===============================================================');
    console.log('=== ALL TASK 009A AUDIT & REGRESSION TESTS PASSED! ===');
    console.log('===============================================================');
  } finally {
    _setMockAuthForTest(null);
    _setMockDbInstanceForTest(null, null);
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

runTestSuite().catch((err) => {
  console.error('\n[Test Suite Failure]:', err);
  process.exit(1);
});
