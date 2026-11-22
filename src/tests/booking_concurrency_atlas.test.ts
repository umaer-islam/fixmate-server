import dns from 'node:dns';
import assert from 'node:assert/strict';
import http from 'node:http';
import { ObjectId } from 'mongodb';
import app from '../app.js';
import { connectDB, closeDB, getDB } from '../db/connection.js';
import { initializeIndexes } from '../db/indexes.js';
import { getServicesCollection, getBookingsCollection, getUsersCollection } from '../db/collections.js';
import { signUserToken } from '../services/jwt.service.js';
import type { AuthenticatedUser } from '../types/auth.js';
import type { ServiceDocument, UserDocument } from '../types/database.js';

// Configure public DNS resolvers to ensure MongoDB Atlas SRV records resolve reliably on Windows
try {
  dns.setServers(['8.8.8.8', '1.1.1.1']);
} catch {
  // ignore
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

async function runAtlasConcurrencyVerification() {
  console.log('========================================================================');
  console.log('=== FixMate TASK 010A: Live MongoDB Atlas Concurrency Verification ===');
  console.log('========================================================================\n');

  // 1. Connect to live MongoDB Atlas database
  console.log('[Step 1] Connecting to MongoDB Atlas...');
  const db = await connectDB();
  const adminDb = db.admin();
  const buildInfo = await adminDb.serverInfo();
  console.log(`[Atlas Verified] Connected to Database: "${db.databaseName}"`);
  console.log(`[Atlas Verified] MongoDB Server Version: ${buildInfo.version}`);

  // 2. Ensure indexes are initialized and inspect idx_bookings_active_unique metadata
  console.log('\n[Step 2] Initializing and verifying index specifications...');
  await initializeIndexes();

  const bookingsColl = getBookingsCollection();
  const indexes = await bookingsColl.indexes();
  console.log(`[Atlas Verified] Total indexes on "${bookingsColl.collectionName}": ${indexes.length}`);

  const activeIndex = indexes.find((idx) => idx.name === 'idx_bookings_active_unique');
  assert.ok(activeIndex, 'Index "idx_bookings_active_unique" must exist on bookings collection');
  console.log('[Atlas Verified] Index Specification for "idx_bookings_active_unique":', JSON.stringify({
    name: activeIndex.name,
    key: activeIndex.key,
    unique: activeIndex.unique,
    partialFilterExpression: activeIndex.partialFilterExpression,
  }, null, 2));

  assert.deepEqual(activeIndex.key, { customerId: 1, serviceId: 1 });
  assert.equal(activeIndex.unique, true);
  assert.deepEqual(
    activeIndex.partialFilterExpression,
    { status: { $in: ['requested', 'accepted', 'in-progress'] } }
  );
  console.log('[Step 2 Passed] Index metadata confirmed: key={customerId:1, serviceId:1}, unique=true, partialFilter={status: {$in: [requested, accepted, in-progress]}}');

  // Start real HTTP server on random port
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => {
      const address = server.address();
      if (address && typeof address !== 'string') {
        port = address.port;
      }
      resolve();
    });
  });
  console.log(`[HTTP Test Server] Listening on port ${port} connected to real Atlas cluster.`);

  // Cleanup tracking arrays
  const testUserIds: ObjectId[] = [];
  const testServiceIds: ObjectId[] = [];
  const testBookingIds: ObjectId[] = [];

  try {
    const usersColl = getUsersCollection();
    const servicesColl = getServicesCollection();

    // Setup Test Customer and Technician directly in real MongoDB Atlas users collection
    const testCustId = new ObjectId();
    const testTechId = new ObjectId();
    testUserIds.push(testCustId, testTechId);

    const testCustomer: UserDocument = {
      _id: testCustId,
      name: 'Atlas Test Customer',
      email: `test_customer_${Date.now()}@fixmate.test`,
      role: 'customer',
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const testTechnician: UserDocument = {
      _id: testTechId,
      name: 'Atlas Test Technician',
      email: `test_tech_${Date.now()}@fixmate.test`,
      role: 'technician',
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    await usersColl.insertMany([testCustomer, testTechnician]);

    const custToken = await signUserToken({
      id: testCustId.toHexString(),
      email: testCustomer.email,
      name: testCustomer.name,
      role: 'customer',
    });

    const techToken = await signUserToken({
      id: testTechId.toHexString(),
      email: testTechnician.email,
      name: testTechnician.name,
      role: 'technician',
    });

    // Create an approved, available service in real MongoDB Atlas services collection
    const testSrvId = new ObjectId();
    testServiceIds.push(testSrvId);

    const testService: ServiceDocument = {
      _id: testSrvId,
      title: 'Precision Drone Sensor Calibration',
      description: 'Sensor recalibration for multi-rotor commercial drones',
      category: 'Electronics',
      serviceMode: 'onsite',
      basePrice: 220,
      estimatedDuration: '2 hours',
      image: 'https://images.fixmate.io/drone.jpg',
      approvalStatus: 'approved',
      isAvailable: true,
      technicianId: testTechId,
      technicianName: testTechnician.name,
      technicianEmail: testTechnician.email,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    await servicesColl.insertOne(testService);
    console.log(`\n[Setup] Inserted test customer (${testCustomer.email}) and technician (${testTechnician.email})`);
    console.log(`[Setup] Inserted test service (${testService.title}, ID: ${testSrvId.toHexString()})`);

    // =========================================================================
    // 3. REAL CONCURRENCY TEST
    // =========================================================================
    console.log('\n--- Step 3: Real Concurrency Race Test ---');
    const futureDate = new Date();
    futureDate.setDate(futureDate.getDate() + 7);

    const bookingPayload = {
      serviceId: testSrvId.toHexString(),
      customerPhone: '+1-555-0188',
      address: '88 Tech Boulevard, Suite 400',
      preferredDate: futureDate.toISOString(),
      problemDescription: 'LiDAR sensor drift requires recalibration under load.',
    };

    console.log('[Concurrency Action] Dispatching 2 concurrent HTTP POST /api/bookings requests via Promise.all...');
    const [resA, resB] = await Promise.all([
      request({
        method: 'POST',
        path: '/api/bookings',
        headers: { Authorization: `Bearer ${custToken}` },
        body: bookingPayload,
      }),
      request({
        method: 'POST',
        path: '/api/bookings',
        headers: { Authorization: `Bearer ${custToken}` },
        body: bookingPayload,
      }),
    ]);

    const statuses = [resA.status, resB.status].sort();
    console.log(`[Concurrency Result] Competing HTTP Status Codes: [${resA.status}, ${resB.status}]`);
    assert.deepEqual(statuses, [201, 409], 'Exactly one request must succeed (201) and competing request must receive 409');

    const winnerRes = resA.status === 201 ? resA : resB;
    const loserRes = resA.status === 409 ? resA : resB;

    assert.equal(loserRes.body.success, false);
    assert.equal(loserRes.body.error, 'Conflict');
    assert.equal(loserRes.body.message, 'You already have an active booking for this service.');

    const activeBookingId = winnerRes.body.data._id;
    testBookingIds.push(new ObjectId(activeBookingId));

    // Confirm real database state has EXACTLY 1 active record
    const activeCountInDb = await bookingsColl.countDocuments({
      customerId: testCustId,
      serviceId: testSrvId,
      status: { $in: ['requested', 'accepted', 'in-progress'] },
    });
    console.log(`[Atlas Verified] Count of active bookings in real Atlas database: ${activeCountInDb}`);
    assert.equal(activeCountInDb, 1, 'Atlas database must contain exactly one active booking document');
    console.log('[Step 3 Passed] Real concurrency verified! Exactly one booking succeeded (201), competitor received 409, and database has exactly 1 active record.');

    // =========================================================================
    // 4. LIFECYCLE UNBLOCKING TEST
    // =========================================================================
    console.log('\n--- Step 4: Lifecycle Unblocking & Constraint Occupancy Test ---');

    // 4.1 While 'requested', attempt to create another booking -> blocked with 409
    const blockedWhileRequested = await request({
      method: 'POST',
      path: '/api/bookings',
      headers: { Authorization: `Bearer ${custToken}` },
      body: bookingPayload,
    });
    assert.equal(blockedWhileRequested.status, 409);
    console.log(' - [4.1 Verified] Booking with status "requested" occupies unique constraint (409 Conflict).');

    // 4.2 Customer cancels booking: requested -> cancelled
    const cancelRes = await request({
      method: 'PATCH',
      path: `/api/bookings/${activeBookingId}/cancel`,
      headers: { Authorization: `Bearer ${custToken}` },
    });
    assert.equal(cancelRes.status, 200);
    assert.equal(cancelRes.body.data.status, 'cancelled');
    console.log(' - [4.2 Verified] Booking transitioned to "cancelled".');

    // 4.3 Customer can now book again -> 201 Created (Unblocked by 'cancelled')
    const unblockedAfterCancel = await request({
      method: 'POST',
      path: '/api/bookings',
      headers: { Authorization: `Bearer ${custToken}` },
      body: bookingPayload,
    });
    assert.equal(unblockedAfterCancel.status, 201, 'Re-booking after cancellation must succeed with 201');
    const bookingId2 = unblockedAfterCancel.body.data._id;
    testBookingIds.push(new ObjectId(bookingId2));
    console.log(' - [4.3 Verified] Terminal state "cancelled" unblocked unique constraint (201 Created).');

    // 4.4 Technician accepts booking: requested -> accepted
    const acceptRes = await request({
      method: 'PATCH',
      path: `/api/technician/bookings/${bookingId2}/status`,
      headers: { Authorization: `Bearer ${techToken}` },
      body: { status: 'accepted' },
    });
    assert.equal(acceptRes.status, 200);
    assert.equal(acceptRes.body.data.status, 'accepted');

    // 4.5 While 'accepted', attempt to create another booking -> blocked with 409
    const blockedWhileAccepted = await request({
      method: 'POST',
      path: '/api/bookings',
      headers: { Authorization: `Bearer ${custToken}` },
      body: bookingPayload,
    });
    assert.equal(blockedWhileAccepted.status, 409);
    console.log(' - [4.4 & 4.5 Verified] State "accepted" continues to occupy unique constraint (409 Conflict).');

    // 4.6 Technician advances to in-progress: accepted -> in-progress
    const inProgressRes = await request({
      method: 'PATCH',
      path: `/api/technician/bookings/${bookingId2}/status`,
      headers: { Authorization: `Bearer ${techToken}` },
      body: { status: 'in-progress' },
    });
    assert.equal(inProgressRes.status, 200);
    assert.equal(inProgressRes.body.data.status, 'in-progress');

    // 4.7 While 'in-progress', attempt to create another booking -> blocked with 409
    const blockedWhileInProgress = await request({
      method: 'POST',
      path: '/api/bookings',
      headers: { Authorization: `Bearer ${custToken}` },
      body: bookingPayload,
    });
    assert.equal(blockedWhileInProgress.status, 409);
    console.log(' - [4.6 & 4.7 Verified] State "in-progress" continues to occupy unique constraint (409 Conflict).');

    // 4.8 Technician completes booking: in-progress -> completed
    const completeRes = await request({
      method: 'PATCH',
      path: `/api/technician/bookings/${bookingId2}/status`,
      headers: { Authorization: `Bearer ${techToken}` },
      body: { status: 'completed', finalAmount: 245.5 },
    });
    assert.equal(completeRes.status, 200);
    assert.equal(completeRes.body.data.status, 'completed');
    assert.equal(completeRes.body.data.finalAmount, 245.5);

    // 4.9 Customer can now book again -> 201 Created (Unblocked by 'completed')
    const unblockedAfterCompleted = await request({
      method: 'POST',
      path: '/api/bookings',
      headers: { Authorization: `Bearer ${custToken}` },
      body: bookingPayload,
    });
    assert.equal(unblockedAfterCompleted.status, 201, 'Re-booking after completion must succeed with 201');
    const bookingId3 = unblockedAfterCompleted.body.data._id;
    testBookingIds.push(new ObjectId(bookingId3));
    console.log(' - [4.8 & 4.9 Verified] Terminal state "completed" unblocked unique constraint (201 Created).');

    // 4.10 Technician rejects booking: requested -> rejected
    const rejectRes = await request({
      method: 'PATCH',
      path: `/api/technician/bookings/${bookingId3}/status`,
      headers: { Authorization: `Bearer ${techToken}` },
      body: { status: 'rejected' },
    });
    assert.equal(rejectRes.status, 200);
    assert.equal(rejectRes.body.data.status, 'rejected');

    // 4.11 Customer can now book again -> 201 Created (Unblocked by 'rejected')
    const unblockedAfterRejected = await request({
      method: 'POST',
      path: '/api/bookings',
      headers: { Authorization: `Bearer ${custToken}` },
      body: bookingPayload,
    });
    assert.equal(unblockedAfterRejected.status, 201, 'Re-booking after rejection must succeed with 201');
    const bookingId4 = unblockedAfterRejected.body.data._id;
    testBookingIds.push(new ObjectId(bookingId4));
    console.log(' - [4.10 & 4.11 Verified] Terminal state "rejected" unblocked unique constraint (201 Created).');

    console.log('[Step 4 Passed] Complete lifecycle constraint occupancy & terminal unblocking verified!');

    // =========================================================================
    // 5. DATE & COMPLETION AMOUNT VALIDATION
    // =========================================================================
    console.log('\n--- Step 5: Date & Final Amount Validation Checks ---');

    // 5.1 Past preferred date rejected
    const pastDate = new Date();
    pastDate.setDate(pastDate.getDate() - 3);
    const pastDateRes = await request({
      method: 'POST',
      path: '/api/bookings',
      headers: { Authorization: `Bearer ${custToken}` },
      body: {
        ...bookingPayload,
        preferredDate: pastDate.toISOString(),
      },
    });
    assert.equal(pastDateRes.status, 400);
    assert.ok(JSON.stringify(pastDateRes.body).includes('Preferred date cannot be in the past'));
    console.log(' - [5.1 Verified] Past preferred date strictly rejected with 400 Bad Request.');

    // 5.2 Invalid date string rejected
    const invalidDateRes = await request({
      method: 'POST',
      path: '/api/bookings',
      headers: { Authorization: `Bearer ${custToken}` },
      body: {
        ...bookingPayload,
        preferredDate: 'not-a-real-date',
      },
    });
    assert.equal(invalidDateRes.status, 400);
    console.log(' - [5.2 Verified] Invalid date format strictly rejected with 400 Bad Request.');

    // 5.3 Completion with 0, negative, NaN rejected
    const zeroAmountRes = await request({
      method: 'PATCH',
      path: `/api/technician/bookings/${bookingId4}/status`,
      headers: { Authorization: `Bearer ${techToken}` },
      body: { status: 'completed', finalAmount: 0 },
    });
    assert.equal(zeroAmountRes.status, 400);

    const negativeAmountRes = await request({
      method: 'PATCH',
      path: `/api/technician/bookings/${bookingId4}/status`,
      headers: { Authorization: `Bearer ${techToken}` },
      body: { status: 'completed', finalAmount: -100 },
    });
    assert.equal(negativeAmountRes.status, 400);
    console.log(' - [5.3 Verified] Completion amounts <= 0 rejected with 400 Bad Request.');

    console.log('[Step 5 Passed] All date and amount validation rules verified!');

    console.log('\n========================================================================');
    console.log('=== ALL TASK 010A ATLAS CONCURRENCY & INTEGRATION TESTS PASSED! ===');
    console.log('========================================================================\n');
  } finally {
    console.log('[Cleanup] Cleaning up test records from Atlas database...');
    try {
      if (testBookingIds.length > 0) {
        await bookingsColl.deleteMany({ _id: { $in: testBookingIds } });
      }
      if (testServiceIds.length > 0) {
        await getServicesCollection().deleteMany({ _id: { $in: testServiceIds } });
      }
      if (testUserIds.length > 0) {
        await getUsersCollection().deleteMany({ _id: { $in: testUserIds } });
      }
      console.log('[Cleanup] Cleaned up test bookings, services, and users.');
    } catch (cleanErr) {
      console.error('[Cleanup Error]', cleanErr);
    }

    if (server) {
      await new Promise<void>((res) => server.close(() => res()));
    }
    await closeDB();
  }
}

runAtlasConcurrencyVerification().catch(async (err) => {
  console.error('\n[FATAL] Atlas Concurrency Verification Failed:', err);
  if (server) server.close();
  await closeDB();
  process.exit(1);
});
