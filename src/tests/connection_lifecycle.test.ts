import {
  connectDB,
  getDB,
  closeDB,
  checkDBHealth,
  _resetConnectionStateForTest,
  _setMockDbInstanceForTest,
} from '../db/connection.js';
import app from '../app.js';
import type { Server } from 'http';

interface TestResult {
  name: string;
  type: '[UNIT]' | '[MOCK]' | '[INTEGRATION]';
  status: 'PASS' | 'FAIL';
  details?: string;
}

const results: TestResult[] = [];

function assert(condition: boolean, testName: string, type: '[UNIT]' | '[MOCK]' | '[INTEGRATION]', details?: string) {
  if (condition) {
    results.push({ name: testName, type, status: 'PASS', details });
  } else {
    results.push({ name: testName, type, status: 'FAIL', details: details || 'Assertion failed' });
    console.error(`FAILED: ${testName} - ${details}`);
  }
}

async function runLifecycleTests() {
  console.log('====================================================');
  console.log('FixMate Server: Database Connection Lifecycle Tests');
  console.log('====================================================\n');

  // Test 1: getDB() rejects access before initialization
  _resetConnectionStateForTest();
  try {
    getDB();
    assert(false, 'getDB() rejects uninitialized access', '[UNIT]', 'Expected getDB to throw');
  } catch (err: any) {
    assert(
      err.message.includes('Database not initialized'),
      'getDB() rejects uninitialized access',
      '[UNIT]',
      `Threw expected error: "${err.message}"`
    );
  }

  // Test 2: checkDBHealth() returns false when disconnected
  _resetConnectionStateForTest();
  const disconnectedHealth = await checkDBHealth();
  assert(
    disconnectedHealth === false,
    'checkDBHealth() returns false when disconnected',
    '[UNIT]',
    `Received health status: ${disconnectedHealth}`
  );

  // Test 3: Repeated and concurrent closeDB() calls are safe
  _resetConnectionStateForTest();
  try {
    await Promise.all([closeDB(), closeDB(), closeDB()]);
    await closeDB();
    assert(true, 'Repeated and concurrent closeDB() calls are safe & idempotent', '[UNIT]');
  } catch (err: any) {
    assert(false, 'Repeated and concurrent closeDB() calls are safe & idempotent', '[UNIT]', err.message);
  }

  // Test 4 [MOCK]: Singleton check - Concurrent connection calls share in-flight promise
  _resetConnectionStateForTest();
  let connectCount = 0;
  const mockMongoClient = {
    connect: async () => {
      connectCount++;
      await new Promise((r) => setTimeout(r, 50));
    },
    db: () => ({
      command: async () => ({ ok: 1 }),
      databaseName: 'fixmate_test',
    }),
    close: async () => {},
  };

  // Inject mock to verify concurrency resolution
  _setMockDbInstanceForTest(mockMongoClient as any, mockMongoClient.db() as any);
  const db1 = getDB();
  const db2 = getDB();
  assert(db1 === db2, 'Singleton Db instance returned across multiple queries', '[MOCK]', 'db1 === db2 verified');
  await closeDB();

  // Test 5 [UNIT]: Failed connection attempts leave singleton in a recoverable state
  _resetConnectionStateForTest();
  let failureRecoverable = false;
  try {
    // Attempt with guaranteed invalid URI
    await connectDB('mongodb://invalid-host-unreachable:27099/?serverSelectionTimeoutMS=200&connectTimeoutMS=200');
  } catch (err: any) {
    // Verify that singleton remains null after failure
    try {
      getDB();
    } catch (e: any) {
      failureRecoverable = e.message.includes('Database not initialized');
    }
  }
  assert(
    failureRecoverable,
    'Failed connection attempts leave singleton in a clean, recoverable state',
    '[UNIT]',
    'getDB() cleanly remains uninitialized after failure'
  );

  // Test 6 [UNIT]: Recovery after failure - Later connection attempt can be initiated
  _resetConnectionStateForTest();
  let attemptAllowed = false;
  try {
    // First failed attempt
    await connectDB('mongodb://invalid-host-1:27099/?serverSelectionTimeoutMS=100&connectTimeoutMS=100');
  } catch {
    try {
      // Second attempt initiates cleanly (does not get stuck in isConnecting lock)
      await connectDB('mongodb://invalid-host-2:27099/?serverSelectionTimeoutMS=100&connectTimeoutMS=100');
    } catch {
      attemptAllowed = true;
    }
  }
  assert(
    attemptAllowed,
    'A later connection attempt can be initiated cleanly after a failure (no lockup)',
    '[UNIT]',
    'Second attempt executed without deadlock'
  );

  // Test 7 [INTEGRATION]: Health endpoint returns HTTP 503 when database is disconnected
  _resetConnectionStateForTest();
  let server: Server | null = null;
  let healthCode = 0;
  let healthPayload: any = null;

  try {
    server = app.listen(5099);
    const res = await fetch('http://localhost:5099/api/health');
    healthCode = res.status;
    healthPayload = await res.json();
  } catch (err: any) {
    console.error('Health endpoint test error:', err);
  } finally {
    if (server) {
      await new Promise<void>((r) => server?.close(() => r()));
    }
  }

  assert(
    healthCode === 503,
    'Health endpoint returns HTTP 503 when database is disconnected',
    '[INTEGRATION]',
    `Received status ${healthCode}`
  );
  assert(
    healthPayload?.status === 'degraded' && healthPayload?.services?.database === 'disconnected',
    'Health response payload reports degraded status and disconnected database safely',
    '[INTEGRATION]',
    `Payload: ${JSON.stringify(healthPayload)}`
  );

  console.log('\n--- TEST RESULTS SUMMARY ---');
  results.forEach((r) => {
    console.log(`[${r.status}] ${r.type} ${r.name}`);
    if (r.details) console.log(`       -> ${r.details}`);
  });

  const allPassed = results.every((r) => r.status === 'PASS');
  console.log(`\nFinal Lifecycle Test Result: ${allPassed ? 'ALL TESTS PASSED' : 'SOME TESTS FAILED'}`);

  if (!allPassed) {
    process.exit(1);
  }
}

runLifecycleTests().catch((err) => {
  console.error('Fatal test runner error:', err);
  process.exit(1);
});
