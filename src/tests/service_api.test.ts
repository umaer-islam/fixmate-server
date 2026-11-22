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
    baseURL: 'http://localhost:5007',
    secret: 'test_better_auth_secret_minimum_32_characters_12345678',
    trustedOrigins: ['http://localhost:5007', 'http://localhost:3000'],
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
            // Technician ownership $or filter
            if (filter.$or) {
              const matchesAny = filter.$or.some((subCond: any) => {
                if (subCond.technicianId && String(item.technicianId) === String(subCond.technicianId)) return true;
                if (subCond.technicianEmail && item.technicianEmail?.toLowerCase() === subCond.technicianEmail.toLowerCase()) return true;
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
                if (subCond.technicianId && String(item.technicianId) === String(subCond.technicianId)) return true;
                if (subCond.technicianEmail && item.technicianEmail?.toLowerCase() === subCond.technicianEmail.toLowerCase()) return true;
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
                    if (c.technicianId && String(item.technicianId) === String(c.technicianId)) return true;
                    if (c.technicianEmail && item.technicianEmail?.toLowerCase() === c.technicianEmail.toLowerCase()) return true;
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
                if (c.technicianId && String(item.technicianId) === String(c.technicianId)) return true;
                if (c.technicianEmail && item.technicianEmail?.toLowerCase() === c.technicianEmail.toLowerCase()) return true;
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
                  if (c.technicianId && String(item.technicianId) === String(c.technicianId)) return true;
                  if (c.technicianEmail && item.technicianEmail?.toLowerCase() === c.technicianEmail.toLowerCase()) return true;
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
  console.log('=== FixMate TASK 009: Service Management & API Test Suite ===');
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
  await new Promise<void>((resolve) => server.listen(5007, resolve));

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

    console.log('[Setup Complete] Tokens minted for Technician 1, Technician 2, Admin, and Customer.\n');

    // ------------------------------------------------------------------------
    // GROUP A: Technician Service Operations
    // ------------------------------------------------------------------------
    console.log('--- Group A: Technician Service Operations ---');

    // Test 1: Technician creates a valid service
    const createRes = await fetch('http://localhost:5007/api/technician/services', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        authorization: `Bearer ${tech1Token}`,
      },
      body: JSON.stringify({
        title: 'Inverter Refrigerator Compressor & PCB Repair',
        category: 'Home Appliance',
        description: 'Comprehensive diagnostics and board-level repair for inverter refrigerators.',
        image: 'https://images.example.com/fridge.jpg',
        basePrice: 120,
        estimatedDuration: '24 Hours',
        serviceMode: 'onsite',
        serviceArea: 'Downtown Metro',
        turnaroundTime: '24 Hours',
      }),
    });

    assert.equal(createRes.status, 201, 'Service creation should return 201 Created');
    const createdData = await createRes.json();
    assert.ok(createdData.data._id, 'Created service must have an ID');
    assert.equal(createdData.data.approvalStatus, 'pending', 'New services must start as pending');
    assert.equal(createdData.data.isAvailable, true, 'New services must start as available');
    assert.equal(createdData.data.technicianId, tech1Id, 'Technician ID must be derived from token');
    assert.equal(createdData.data.technicianEmail, 'tariq@fixmate.com');
    const service1Id = String(createdData.data._id);
    console.log('[Test 1 Passed] Technician created service: forced to pending and available.');

    // Test 2: Client cannot inject a different technicianId or approvalStatus
    const spoofAttemptRes = await fetch('http://localhost:5007/api/technician/services', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        authorization: `Bearer ${tech1Token}`,
      },
      body: JSON.stringify({
        title: 'AC Gas Refill Service',
        category: 'Home Appliance',
        description: 'Professional R32 and R410A refrigerant recharge with pressure testing.',
        image: 'https://images.example.com/ac.jpg',
        basePrice: 85,
        estimatedDuration: '3-4 Hours',
        serviceMode: 'onsite',
        // Attacker attempts injection
        technicianId: tech2Id,
        approvalStatus: 'approved',
      }),
    });
    // Schema is strict so extra fields return 400 Bad Request
    assert.equal(spoofAttemptRes.status, 400, 'Attempt to inject disallowed fields must be rejected');
    console.log('[Test 2 Passed] Field injection blocked: unexpected technicianId/approvalStatus rejected.');

    // Test 3: Technician lists own services
    const techListRes = await fetch('http://localhost:5007/api/technician/services', {
      headers: { authorization: `Bearer ${tech1Token}` },
    });
    assert.equal(techListRes.status, 200);
    const techListData = await techListRes.json();
    assert.equal(techListData.data.length, 1);
    assert.equal(techListData.data[0]._id, service1Id);
    console.log('[Test 3 Passed] Technician successfully listed own services.');

    // Test 4: Technician 2 cannot access Technician 1's service
    const crossTechGetRes = await fetch(`http://localhost:5007/api/technician/services/${service1Id}`, {
      headers: { authorization: `Bearer ${tech2Token}` },
    });
    assert.equal(crossTechGetRes.status, 404, 'Technician 2 accessing Tech 1 service must return 404');
    console.log('[Test 4 Passed] Cross-technician read blocked with 404.');

    // Test 5: Technician 2 cannot update Technician 1's service
    const crossTechPatchRes = await fetch(`http://localhost:5007/api/technician/services/${service1Id}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        authorization: `Bearer ${tech2Token}`,
      },
      body: JSON.stringify({ basePrice: 999 }),
    });
    assert.equal(crossTechPatchRes.status, 404, 'Technician 2 updating Tech 1 service must return 404');
    console.log('[Test 5 Passed] Cross-technician update blocked with 404.');

    // Test 6: Technician 2 cannot delete Technician 1's service
    const crossTechDeleteRes = await fetch(`http://localhost:5007/api/technician/services/${service1Id}`, {
      method: 'DELETE',
      headers: { authorization: `Bearer ${tech2Token}` },
    });
    assert.equal(crossTechDeleteRes.status, 404, 'Technician 2 deleting Tech 1 service must return 404');
    console.log('[Test 6 Passed] Cross-technician delete blocked with 404.');

    // Test 7: Availability toggle does NOT change approval status
    const availRes = await fetch(`http://localhost:5007/api/technician/services/${service1Id}/availability`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        authorization: `Bearer ${tech1Token}`,
      },
      body: JSON.stringify({ isAvailable: false }),
    });
    assert.equal(availRes.status, 200);
    const availData = await availRes.json();
    assert.equal(availData.data.isAvailable, false);
    assert.equal(availData.data.approvalStatus, 'pending', 'Availability change must NOT alter approvalStatus');
    console.log('[Test 7 Passed] Availability toggled to false without affecting approval status.');

    // Toggle back to true
    await fetch(`http://localhost:5007/api/technician/services/${service1Id}/availability`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        authorization: `Bearer ${tech1Token}`,
      },
      body: JSON.stringify({ isAvailable: true }),
    });

    // ------------------------------------------------------------------------
    // GROUP B: Admin Moderation Operations
    // ------------------------------------------------------------------------
    console.log('\n--- Group B: Admin Moderation Operations ---');

    // Test 8: Admin can inspect all services
    const adminListRes = await fetch('http://localhost:5007/api/admin/services', {
      headers: { authorization: `Bearer ${adminToken}` },
    });
    assert.equal(adminListRes.status, 200);
    const adminListData = await adminListRes.json();
    assert.ok(adminListData.data.length >= 1, 'Admin must see services across all technicians');
    console.log('[Test 8 Passed] Admin listed all pending services for moderation.');

    // Test 9: Admin rejects service with notes
    const rejectRes = await fetch(`http://localhost:5007/api/admin/services/${service1Id}/approval`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({
        approvalStatus: 'rejected',
        moderationNotes: 'Please update description with exact diagnostic procedures.',
      }),
    });
    assert.equal(rejectRes.status, 200);
    const rejectData = await rejectRes.json();
    assert.equal(rejectData.data.approvalStatus, 'rejected');
    assert.equal(rejectData.data.moderationNotes, 'Please update description with exact diagnostic procedures.');
    console.log('[Test 9 Passed] Admin rejected service with moderation notes.');

    // Test 10: Rejected service edited by owner returns to pending
    const editRejectedRes = await fetch(`http://localhost:5007/api/technician/services/${service1Id}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        authorization: `Bearer ${tech1Token}`,
      },
      body: JSON.stringify({
        description: 'Updated: Full 12-point inverter refrigerator diagnostic with factory OEM parts.',
      }),
    });
    assert.equal(editRejectedRes.status, 200);
    const editRejectedData = await editRejectedRes.json();
    assert.equal(editRejectedData.data.approvalStatus, 'pending', 'Owner edit on rejected service must return it to pending');
    console.log('[Test 10 Passed] Owner edit on rejected service reset approval to pending.');

    // Test 11: Admin approves service
    const approveRes = await fetch(`http://localhost:5007/api/admin/services/${service1Id}/approval`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({
        approvalStatus: 'approved',
      }),
    });
    assert.equal(approveRes.status, 200);
    const approveData = await approveRes.json();
    assert.equal(approveData.data.approvalStatus, 'approved');
    console.log('[Test 11 Passed] Admin approved service.');

    // Test 12: Editing an approved service returns it to pending
    const editApprovedRes = await fetch(`http://localhost:5007/api/technician/services/${service1Id}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        authorization: `Bearer ${tech1Token}`,
      },
      body: JSON.stringify({
        basePrice: 135,
      }),
    });
    assert.equal(editApprovedRes.status, 200);
    const editApprovedData = await editApprovedRes.json();
    assert.equal(editApprovedData.data.approvalStatus, 'pending', 'Technician edit on approved service must revert to pending');
    console.log('[Test 12 Passed] Technician edit on approved service successfully returned it to pending.');

    // Re-approve so we can test public browsing
    await fetch(`http://localhost:5007/api/admin/services/${service1Id}/approval`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({ approvalStatus: 'approved' }),
    });

    // ------------------------------------------------------------------------
    // GROUP C: Public Service Browsing, Search, Filters, Pagination
    // ------------------------------------------------------------------------
    console.log('\n--- Group C: Public Browsing, Filters & Search ---');

    // Add a second service: Mobile & Tablet, remote, price: $45 (Approved & Available)
    const service2Doc: ServiceDocument = {
      _id: new ObjectId(),
      title: 'Smartphone Screen & Battery Replacement',
      category: 'Smart Device',
      description: 'OEM screen and high-capacity battery installation with 6-month warranty.',
      image: 'https://images.example.com/phone.jpg',
      basePrice: 45,
      estimatedDuration: '1 Hour',
      serviceMode: 'remote',
      serviceArea: 'Nationwide',
      technicianId: tech2Id,
      technicianName: 'Rahim Tech',
      technicianEmail: 'rahim@fixmate.com',
      approvalStatus: 'approved',
      isAvailable: true,
      createdAt: new Date(Date.now() - 100000),
      updatedAt: new Date(),
    };
    store.services.push(service2Doc);

    // Add a third service: Pending approval (must NOT appear in public catalog)
    const service3Pending: ServiceDocument = {
      _id: new ObjectId(),
      title: 'Unapproved Secret Service',
      category: 'Smart Device',
      description: 'This is not yet approved by moderation.',
      image: 'https://images.example.com/secret.jpg',
      basePrice: 10,
      estimatedDuration: '1 Hour',
      serviceMode: 'onsite',
      technicianId: tech1Id,
      technicianName: 'Tariq Tech',
      technicianEmail: 'tariq@fixmate.com',
      approvalStatus: 'pending',
      isAvailable: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    store.services.push(service3Pending);

    // Add a fourth service: Unavailable (must NOT appear in public catalog)
    const service4Unavailable: ServiceDocument = {
      _id: new ObjectId(),
      title: 'Unavailable Refrigerator Repair',
      category: 'Home Appliance',
      description: 'Currently unavailable.',
      image: 'https://images.example.com/fridge2.jpg',
      basePrice: 100,
      estimatedDuration: '2 Hours',
      serviceMode: 'onsite',
      technicianId: tech1Id,
      technicianName: 'Tariq Tech',
      technicianEmail: 'tariq@fixmate.com',
      approvalStatus: 'approved',
      isAvailable: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    store.services.push(service4Unavailable);

    // Test 13: Public catalog returns ONLY approved and available services
    const pubListRes = await fetch('http://localhost:5007/api/services');
    assert.equal(pubListRes.status, 200);
    const pubListData = await pubListRes.json();
    assert.equal(pubListData.data.length, 2, 'Public catalog must only return 2 approved & available services');
    assert.ok(pubListData.data.every((s: any) => s.approvalStatus === 'approved' && s.isAvailable === true));
    console.log('[Test 13 Passed] Public catalog excludes pending, rejected, and unavailable services.');

    // Test 14: Category filtering
    const catFilterRes = await fetch('http://localhost:5007/api/services?category=Home+Appliance');
    assert.equal(catFilterRes.status, 200);
    const catData = await catFilterRes.json();
    assert.equal(catData.data.length, 1);
    assert.equal(catData.data[0].category, 'Home Appliance');
    console.log('[Test 14 Passed] Category filtering verified.');

    // Test 15: Service mode filtering
    const modeFilterRes = await fetch('http://localhost:5007/api/services?serviceMode=remote');
    assert.equal(modeFilterRes.status, 200);
    const modeData = await modeFilterRes.json();
    assert.equal(modeData.data.length, 1);
    assert.equal(modeData.data[0].serviceMode, 'remote');
    console.log('[Test 15 Passed] Service mode filtering verified.');

    // Test 16: Price range filtering
    const priceFilterRes = await fetch('http://localhost:5007/api/services?minPrice=50&maxPrice=200');
    assert.equal(priceFilterRes.status, 200);
    const priceData = await priceFilterRes.json();
    assert.equal(priceData.data.length, 1);
    assert.equal(priceData.data[0].basePrice, 135);
    console.log('[Test 16 Passed] Price range filtering verified.');

    // Test 17: Search by title/description
    const searchRes = await fetch('http://localhost:5007/api/services?search=refrigerator');
    assert.equal(searchRes.status, 200);
    const searchData = await searchRes.json();
    assert.equal(searchData.data.length, 1);
    assert.ok(searchData.data[0].title.toLowerCase().includes('refrigerator'));
    console.log('[Test 17 Passed] Title and description text search verified.');

    // Test 18: Sorting price ascending and descending
    const ascRes = await fetch('http://localhost:5007/api/services?sort=price_asc');
    const ascData = await ascRes.json();
    assert.equal(ascData.data[0].basePrice, 45);
    assert.equal(ascData.data[1].basePrice, 135);

    const descRes = await fetch('http://localhost:5007/api/services?sort=price_desc');
    const descData = await descRes.json();
    assert.equal(descData.data[0].basePrice, 135);
    assert.equal(descData.data[1].basePrice, 45);
    console.log('[Test 18 Passed] Price ascending and descending sorting verified.');

    // Test 19: Pagination metadata
    const pageRes = await fetch('http://localhost:5007/api/services?page=1&limit=1');
    const pageData = await pageRes.json();
    assert.equal(pageData.data.length, 1);
    assert.equal(pageData.pagination.page, 1);
    assert.equal(pageData.pagination.limit, 1);
    assert.equal(pageData.pagination.totalCount, 2);
    assert.equal(pageData.pagination.totalPages, 2);
    console.log('[Test 19 Passed] Pagination metadata verified.');

    // Test 20: Individual service details
    const detailRes = await fetch(`http://localhost:5007/api/services/${service1Id}`);
    assert.equal(detailRes.status, 200);
    const detailData = await detailRes.json();
    assert.equal(detailData.data.title, 'Inverter Refrigerator Compressor & PCB Repair');

    // Test 21: Unapproved service details returns 404 for public
    const unapprovedDetailRes = await fetch(`http://localhost:5007/api/services/${String(service3Pending._id)}`);
    assert.equal(unapprovedDetailRes.status, 404, 'Public user cannot view unapproved service details');
    console.log('[Test 20 & 21 Passed] Individual service details returns 200 for approved, 404 for unapproved.');

    // ------------------------------------------------------------------------
    // GROUP D: Security, Authorization & Regression
    // ------------------------------------------------------------------------
    console.log('\n--- Group D: Security, Authorization & Regression ---');

    // Test 22: Unauthenticated request to technician routes -> 401
    const unauthRes = await fetch('http://localhost:5007/api/technician/services');
    assert.equal(unauthRes.status, 401);
    console.log('[Test 22 Passed] Unauthenticated request to technician routes -> 401.');

    // Test 23: Customer accessing technician routes -> 403
    const custTechRes = await fetch('http://localhost:5007/api/technician/services', {
      headers: { authorization: `Bearer ${customerToken}` },
    });
    assert.equal(custTechRes.status, 403);
    console.log('[Test 23 Passed] Customer accessing technician routes -> 403 Forbidden.');

    // Test 24: Technician accessing admin routes -> 403
    const techAdminRes = await fetch('http://localhost:5007/api/admin/services', {
      headers: { authorization: `Bearer ${tech1Token}` },
    });
    assert.equal(techAdminRes.status, 403);
    console.log('[Test 24 Passed] Technician accessing admin routes -> 403 Forbidden.');

    // Test 25: Technician deletion deletes only own service
    const deleteRes = await fetch(`http://localhost:5007/api/technician/services/${service1Id}`, {
      method: 'DELETE',
      headers: { authorization: `Bearer ${tech1Token}` },
    });
    assert.equal(deleteRes.status, 200);
    const afterDeleteRes = await fetch(`http://localhost:5007/api/services/${service1Id}`);
    assert.equal(afterDeleteRes.status, 404, 'Deleted service must no longer exist in catalog');
    console.log('[Test 25 Passed] Technician successfully deleted own service.');

    console.log('\n===============================================================');
    console.log('=== ALL 25 TASK 009 SERVICE MANAGEMENT TESTS PASSED! ===');
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
