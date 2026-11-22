import assert from 'node:assert/strict';
import http from 'node:http';
import jwt from 'jsonwebtoken';
import { memoryAdapter } from 'better-auth/adapters/memory';
import { betterAuth } from 'better-auth';
import { jwt as jwtPlugin, bearer } from 'better-auth/plugins';
import app from '../app.js';
import { _setMockAuthForTest, FixMateAuth } from '../auth/auth.js';
import { _setMockDbInstanceForTest } from '../db/connection.js';
import { signUserToken, verifyJwtToken } from '../services/jwt.service.js';
import type { AuthenticatedUser } from '../types/auth.js';

interface TestMemoryDb {
  users: Array<Record<string, unknown>>;
  session: Array<Record<string, unknown>>;
  account: Array<Record<string, unknown>>;
  verification: Array<Record<string, unknown>>;
  jwks: Array<Record<string, unknown>>;
  [key: string]: Array<Record<string, unknown>>;
}

function createTestAuth(memoryDb: TestMemoryDb): FixMateAuth {
  return betterAuth({
    database: memoryAdapter(memoryDb),
    baseURL: 'http://localhost:5006',
    secret: 'test_better_auth_secret_minimum_32_characters_12345678',
    trustedOrigins: ['http://localhost:5006', 'http://localhost:3000'],
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
        phone: { type: 'string', required: false },
        area: { type: 'string', required: false },
        bio: { type: 'string', required: false },
      },
    },
    databaseHooks: {
      user: {
        create: {
          before: async (user) => {
            return {
              data: {
                ...user,
                role: 'customer',
              },
            };
          },
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
  }) as FixMateAuth;
}

async function runTestSuite() {
  console.log('=== FixMate TASK 008A: Security Hardening & Regression Test Suite ===');
  console.log('(Running in isolated test harness with authoritative database mock)\n');

  const memoryDb: TestMemoryDb = {
    users: [],
    session: [],
    account: [],
    verification: [],
    jwks: [],
  };

  let simulateDbFailure = false;

  const mockDb = {
    collection: (name: string) => {
      return {
        findOne: async (query: any) => {
          if (simulateDbFailure) {
            throw new Error('Simulated database connection failure during query');
          }
          const table = memoryDb[name] || [];
          if (query.$or) {
            for (const item of query.$or) {
              for (const doc of table) {
                if (item._id && (String(doc._id) === String(item._id) || String(doc.id) === String(item._id))) return doc;
                if (item.id && (String(doc.id) === String(item.id) || String(doc._id) === String(item.id))) return doc;
                if (item.email && String(doc.email).toLowerCase() === String(item.email).toLowerCase()) return doc;
              }
            }
            return null;
          }
          return (
            table.find((u: any) => {
              if (query.email && u.email?.toLowerCase() === query.email?.toLowerCase()) return true;
              if (query.id && (u.id === query.id || u._id === query.id)) return true;
              if (query._id && (u._id === query._id || u.id === query._id)) return true;
              return false;
            }) || null
          );
        },
      };
    },
  };

  // Set test doubles for both auth and connection
  const testAuth = createTestAuth(memoryDb);
  _setMockAuthForTest(testAuth);
  _setMockDbInstanceForTest(null, mockDb as any);

  // Start HTTP test server for Express endpoint tests
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(5006, resolve));

  try {
    // ---------------------------------------------------------
    // GROUP A: Single Trust Model & Cryptographic Verification
    // ---------------------------------------------------------
    console.log('--- Group A: Single Trust Model (EdDSA/JWKS Exclusive) ---');

    // Register test user
    const alice = await testAuth.api.signUpEmail({
      body: {
        name: 'Alice Customer',
        email: 'alice@example.com',
        password: 'Password123!',
      },
    });

    const aliceUser: AuthenticatedUser = {
      id: String(alice.user.id),
      email: alice.user.email,
      role: 'customer',
      name: alice.user.name,
    };

    // Test 1: Valid EdDSA token issued and verified
    const validEdDsaToken = await signUserToken(aliceUser, { expiresIn: '1h' });
    const header = JSON.parse(Buffer.from(validEdDsaToken.split('.')[0], 'base64url').toString());
    assert.equal(header.alg, 'EdDSA', 'Token algorithm must strictly be EdDSA');
    assert.ok(header.kid, 'Token must contain kid referencing JWKS key');
    const verifiedEdDsa = await verifyJwtToken(validEdDsaToken);
    assert.ok(verifiedEdDsa, 'Valid EdDSA token must pass verification');
    assert.equal(verifiedEdDsa.email, 'alice@example.com');
    console.log('[Test 1 Passed] Valid EdDSA/JWKS token issued and verified.');

    // Test 2: HMAC-SHA256 Token Rejected (No dual-algorithm confusion)
    const hmacToken = jwt.sign(
      { sub: alice.user.id, email: alice.user.email, role: 'admin' },
      'any_arbitrary_symmetric_secret_key_12345'
    );
    const hmacVerified = await verifyJwtToken(hmacToken);
    assert.equal(hmacVerified, null, 'HMAC token must be rejected by EdDSA single trust model');
    console.log('[Test 2 Passed] HMAC-SHA256 token rejected (strict algorithm separation).');

    // Test 3: Token with Modified Role Claim Fails Signature Verification
    const parts = validEdDsaToken.split('.');
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
    payload.role = 'admin'; // Attacker alters role
    const tamperedPayloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const tamperedToken = `${parts[0]}.${tamperedPayloadB64}.${parts[2]}`;
    const tamperedVerified = await verifyJwtToken(tamperedToken);
    assert.equal(tamperedVerified, null, 'Tampered token must fail signature check');
    console.log('[Test 3 Passed] Tampered role claim rejected by cryptographic verification.');

    // ---------------------------------------------------------
    // GROUP B: Authoritative Database Role Enforcement
    // ---------------------------------------------------------
    console.log('\n--- Group B: Authoritative Database Role Enforcement ---');

    // Setup Technician User in DB
    const techDoc = {
      id: 'tech_100',
      _id: 'tech_100',
      name: 'Tim Technician',
      email: 'tim@fixmate.com',
      role: 'technician',
    };
    memoryDb.users.push(techDoc);

    const techUser: AuthenticatedUser = {
      id: 'tech_100',
      email: 'tim@fixmate.com',
      role: 'technician',
      name: 'Tim Technician',
    };

    // Issue valid EdDSA token while user has technician role
    const techToken = await signUserToken(techUser);

    // Verify technician can access technician route initially
    const techInitialRes = await fetch('http://localhost:5006/api/test/technician', {
      headers: { authorization: `Bearer ${techToken}` },
    });
    assert.equal(techInitialRes.status, 200, 'Technician with matching DB role must be allowed');
    console.log('[Test 4 Passed] Active technician accessing technician route -> 200 OK.');

    // Test 5: Stale Role Token Invalidation
    // Demote technician to customer in the authoritative database
    techDoc.role = 'customer';

    // The user presents their old token (which still contains role: 'technician')
    const demotedRes = await fetch('http://localhost:5006/api/test/technician', {
      headers: { authorization: `Bearer ${techToken}` },
    });
    assert.equal(
      demotedRes.status,
      403,
      'Stale token must NOT grant technician access after DB role changed to customer'
    );
    const demotedBody = await demotedRes.json();
    assert.equal(demotedBody.statusCode, 403);
    assert.equal(demotedBody.error, 'Forbidden');
    console.log('[Test 5 Passed] Stale token rejected: Demoted user denied privileged access (403).');

    // Test 6: Deleted User Invalidation
    // Remove user completely from database
    memoryDb.users = memoryDb.users.filter((u) => u.id !== 'tech_100');

    // User presents their otherwise valid cryptographic token
    const deletedUserRes = await fetch('http://localhost:5006/api/test/customer', {
      headers: { authorization: `Bearer ${techToken}` },
    });
    assert.equal(deletedUserRes.status, 401, 'Deleted user must be rejected with 401');
    const deletedBody = await deletedUserRes.json();
    assert.equal(deletedBody.message, 'User account not found or has been removed');
    console.log('[Test 6 Passed] Deleted user rejected (401) despite presenting valid token.');

    // Test 7: Disabled Account Invalidation
    const disabledDoc = {
      id: 'disabled_user_1',
      _id: 'disabled_user_1',
      name: 'Disabled Dave',
      email: 'dave@fixmate.com',
      role: 'customer',
      isDisabled: true,
    };
    memoryDb.users.push(disabledDoc);

    const disabledUser: AuthenticatedUser = {
      id: 'disabled_user_1',
      email: 'dave@fixmate.com',
      role: 'customer',
    };
    const disabledToken = await signUserToken(disabledUser);

    const disabledRes = await fetch('http://localhost:5006/api/test/customer', {
      headers: { authorization: `Bearer ${disabledToken}` },
    });
    assert.equal(disabledRes.status, 401, 'Disabled user must be rejected with 401');
    console.log('[Test 7 Passed] Disabled user rejected with 401.');

    // Test 8: Database Failure Fails Closed (503 Service Unavailable)
    // Simulate database outage during verifyToken lookup
    simulateDbFailure = true;
    const dbOutageRes = await fetch('http://localhost:5006/api/test/customer', {
      headers: { authorization: `Bearer ${validEdDsaToken}` },
    });
    assert.equal(
      dbOutageRes.status,
      503,
      'Database outage must fail closed with 503 and NEVER fall back to trusting token role'
    );
    simulateDbFailure = false; // Restore DB mock
    console.log('[Test 8 Passed] Database lookup failure fails closed (503) without fallback.');

    // ---------------------------------------------------------
    // GROUP C: BetterAuth Mapping & Privilege Escalation Checks
    // ---------------------------------------------------------
    console.log('\n--- Group C: Collection Mapping & Role Isolation ---');

    // Test 9: Public Registration Cannot Assign Admin Role
    const attackPayload = {
      name: 'Evil Hacker',
      email: 'evil@fixmate.com',
      password: 'Password123!',
      role: 'admin',
    };
    const evilRes = await (
      testAuth.api.signUpEmail as unknown as (opts: { body: unknown }) => Promise<{ user: { role: string } }>
    )({
      body: attackPayload,
    });
    assert.equal(evilRes.user.role, 'customer', 'Registration must enforce customer role');
    console.log('[Test 9 Passed] Public registration neutralized role to "customer".');

    // Test 10: Profile Update Cannot Mutate Role
    let roleUpdateBlocked = false;
    try {
      await (
        testAuth.api.updateUser as unknown as (opts: {
          headers: Headers;
          body: unknown;
        }) => Promise<unknown>
      )({
        headers: new Headers({ authorization: 'Bearer ' + alice.token }),
        body: { role: 'admin' },
      });
    } catch {
      roleUpdateBlocked = true;
    }
    assert.ok(roleUpdateBlocked, 'Profile update must block role tampering');
    console.log('[Test 10 Passed] Profile update blocked role mutation.');

    // Test 11: Invariant Check: Domain collection mapping
    assert.ok(memoryDb.users.length > 0, '"users" collection holds user records');
    assert.equal(memoryDb.user, undefined, 'No duplicate "user" collection exists');
    console.log('[Test 11 Passed] Domain collection invariant verified: "users" used exclusively.');

    // ---------------------------------------------------------
    // GROUP D: Role Authorization Matrix Verification
    // ---------------------------------------------------------
    console.log('\n--- Group D: Complete Role Authorization Matrix ---');

    // Setup active Admin
    const adminDoc = {
      id: 'admin_999',
      _id: 'admin_999',
      name: 'Admin Boss',
      email: 'boss@fixmate.com',
      role: 'admin',
    };
    memoryDb.users.push(adminDoc);
    const adminToken = await signUserToken({
      id: 'admin_999',
      email: 'boss@fixmate.com',
      role: 'admin',
    });

    // Test 12: Admin accessing Admin route -> 200
    const adminRes = await fetch('http://localhost:5006/api/test/admin', {
      headers: { authorization: `Bearer ${adminToken}` },
    });
    assert.equal(adminRes.status, 200);
    console.log('[Test 12 Passed] Admin accessing admin route -> 200 OK.');

    // Test 13: Customer accessing Admin route -> 403
    const custAdminRes = await fetch('http://localhost:5006/api/test/admin', {
      headers: { authorization: `Bearer ${validEdDsaToken}` },
    });
    assert.equal(custAdminRes.status, 403);
    console.log('[Test 13 Passed] Customer accessing admin route -> 403 Forbidden.');

    // Test 14: Health route regression preservation
    const healthRes = await fetch('http://localhost:5006/api/health');
    assert.equal(healthRes.status, 503, 'Health endpoint reports 503 when live Atlas is disconnected');
    console.log('[Test 14 Passed] Health endpoint intact (503 disconnected status preserved).');

    console.log('\n===============================================================');
    console.log('=== ALL TASK 008A SECURITY HARDENING TESTS PASSED! ===');
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
