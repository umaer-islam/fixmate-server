import assert from 'node:assert/strict';
import http from 'node:http';
import { memoryAdapter } from 'better-auth/adapters/memory';
import { betterAuth } from 'better-auth';
import { jwt, bearer } from 'better-auth/plugins';
import app from '../app.js';
import { _setMockAuthForTest, FixMateAuth } from '../auth/auth.js';
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
    baseURL: 'http://localhost:5005',
    secret: 'test_better_auth_secret_minimum_32_characters_12345678',
    trustedOrigins: ['http://localhost:5005', 'http://localhost:3000'],
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
      jwt({
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
  console.log('=== FixMate TASK 008: Authentication & Identity Test Suite ===');
  console.log('(Running in isolated test harness with in-memory adapter double)\n');

  const memoryDb: TestMemoryDb = {
    users: [],
    session: [],
    account: [],
    verification: [],
    jwks: [],
  };

  const testAuth = createTestAuth(memoryDb);
  _setMockAuthForTest(testAuth);

  // Start HTTP test server for Express endpoint tests
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(5005, resolve));

  try {
    // ---------------------------------------------------------
    // GROUP A: BetterAuth Lifecycle & Role Safety Tests
    // ---------------------------------------------------------
    console.log('--- Group A: BetterAuth Lifecycle & Role Safety ---');

    // Test 1: Successful Registration
    const regRes = await testAuth.api.signUpEmail({
      body: {
        name: 'Alice Customer',
        email: 'alice@example.com',
        password: 'Password123!',
      },
    });
    assert.ok(regRes.user, 'Registration must return a user object');
    assert.equal(regRes.user.email, 'alice@example.com');
    assert.equal(regRes.user.role, 'customer', 'Default role must be customer');
    assert.equal(
      (regRes.user as Record<string, unknown>).password,
      undefined,
      'Password hash must NOT be exposed in user output'
    );
    console.log('[Test 1 Passed] Successful registration with default customer role & password excluded.');

    // Test 2: Invariant Check: Stored in "users" collection (not "user")
    assert.equal(memoryDb.users.length, 1, 'User must be stored in "users" table');
    assert.equal(memoryDb.user, undefined, 'No redundant "user" table should be created');
    console.log('[Test 2 Passed] User collection mapping verified: "users" domain collection preserved.');

    // Test 3: Public registration cannot assign admin or technician role
    // Documented type assertion: deliberately passing unexpected payload to test runtime privilege escalation defense
    const attackPayload = {
      name: 'Hacker Joe',
      email: 'hacker@example.com',
      password: 'Password123!',
      role: 'admin',
    };
    const attackerRes = await (
      testAuth.api.signUpEmail as unknown as (opts: { body: unknown }) => Promise<{ user: { role: string } }>
    )({
      body: attackPayload,
    });
    assert.equal(
      attackerRes.user.role,
      'customer',
      'Attacker attempt to register as admin must be neutralized to customer'
    );
    console.log('[Test 3 Passed] Privilege escalation prevented: Registration cannot self-assign admin role.');

    // Test 4: Duplicate Email Registration Rejection
    let duplicateRejected = false;
    try {
      await testAuth.api.signUpEmail({
        body: {
          name: 'Alice Duplicate',
          email: 'alice@example.com',
          password: 'Password456!',
        },
      });
    } catch {
      duplicateRejected = true;
    }
    assert.ok(duplicateRejected, 'Duplicate email registration must be rejected');
    console.log('[Test 4 Passed] Duplicate email registration rejected.');

    // Test 5: Successful Sign-In
    const signInRes = await testAuth.api.signInEmail({
      body: {
        email: 'alice@example.com',
        password: 'Password123!',
      },
    });
    assert.ok(signInRes.token, 'Sign-in must return a session token');
    assert.equal(signInRes.user.email, 'alice@example.com');
    console.log('[Test 5 Passed] Successful sign-in returning session token.');

    // Test 6: Invalid Password Rejection
    let invalidPasswordRejected = false;
    try {
      await testAuth.api.signInEmail({
        body: {
          email: 'alice@example.com',
          password: 'WrongPassword!',
        },
      });
    } catch {
      invalidPasswordRejected = true;
    }
    assert.ok(invalidPasswordRejected, 'Invalid password must be rejected');
    console.log('[Test 6 Passed] Invalid password rejected.');

    // Test 7: Session Retrieval
    const sessionRes = await testAuth.api.getSession({
      headers: new Headers({
        authorization: 'Bearer ' + signInRes.token,
      }),
    });
    assert.ok(sessionRes?.session, 'Session must be retrieved for valid bearer token');
    assert.equal(sessionRes.user.email, 'alice@example.com');
    console.log('[Test 7 Passed] Session retrieval verified.');

    // Test 8: Sign-Out & Session Invalidation
    await testAuth.api.signOut({
      headers: new Headers({
        authorization: 'Bearer ' + signInRes.token,
      }),
    });
    const afterSignOutSession = await testAuth.api.getSession({
      headers: new Headers({
        authorization: 'Bearer ' + signInRes.token,
      }),
    });
    assert.equal(afterSignOutSession, null, 'Session must be invalidated after sign-out');
    console.log('[Test 8 Passed] Sign-out and session invalidation verified.');

    // Test 9: Profile Mass-Assignment Protection (Cannot update role)
    const bob = await testAuth.api.signUpEmail({
      body: {
        name: 'Bob',
        email: 'bob@example.com',
        password: 'Password123!',
      },
    });
    let roleUpdateBlocked = false;
    try {
      // Documented type assertion: testing runtime rejection of unauthorized field update
      await (
        testAuth.api.updateUser as unknown as (opts: {
          headers: Headers;
          body: unknown;
        }) => Promise<unknown>
      )({
        headers: new Headers({
          authorization: 'Bearer ' + bob.token,
        }),
        body: {
          role: 'admin',
        },
      });
    } catch {
      roleUpdateBlocked = true;
    }
    assert.ok(roleUpdateBlocked, 'Role update via public updateUser API must be blocked');
    console.log('[Test 9 Passed] Mass-assignment protection: User cannot modify role via profile update.');

    // ---------------------------------------------------------
    // GROUP B: JWT Issuance & Verification Tests
    // ---------------------------------------------------------
    console.log('\n--- Group B: JWT Issuance & Cryptographic Verification ---');

    const customerUser: AuthenticatedUser = {
      id: String(bob.user.id),
      email: bob.user.email,
      role: 'customer',
      name: bob.user.name,
    };

    // Test 10: Valid Token Accepted
    const validJwt = await signUserToken(customerUser, { expiresIn: '1h' });
    assert.ok(typeof validJwt === 'string' && validJwt.split('.').length === 3, 'Token must be valid JWT');
    const verifiedUser = await verifyJwtToken(validJwt);
    assert.ok(verifiedUser, 'Valid token must be verified successfully');
    assert.equal(verifiedUser.email, 'bob@example.com');
    assert.equal(verifiedUser.role, 'customer');
    console.log('[Test 10 Passed] Valid JWT issued and cryptographically verified.');

    // Test 11: Missing Token Rejected
    const missingVerified = await verifyJwtToken('');
    assert.equal(missingVerified, null, 'Empty token must be rejected');
    console.log('[Test 11 Passed] Missing token rejected.');

    // Test 12: Malformed Token Rejected
    const malformedVerified = await verifyJwtToken('not.a.valid.jwt.string');
    assert.equal(malformedVerified, null, 'Malformed token must be rejected');
    console.log('[Test 12 Passed] Malformed token rejected.');

    // Test 13: Invalid Signature Rejected
    const parts = validJwt.split('.');
    const badSigToken = `${parts[0]}.${parts[1]}.tamperedSignatureStringHere12345`;
    const badSigVerified = await verifyJwtToken(badSigToken);
    assert.equal(badSigVerified, null, 'Token with invalid signature must be rejected');
    console.log('[Test 13 Passed] Invalid signature rejected.');

    // Test 14: Tampered Role Claim Rejected
    const payloadJson = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
    payloadJson.role = 'admin'; // Attacker alters signed payload
    const tamperedPayloadB64 = Buffer.from(JSON.stringify(payloadJson)).toString('base64url');
    const tamperedToken = `${parts[0]}.${tamperedPayloadB64}.${parts[2]}`;
    const tamperedVerified = await verifyJwtToken(tamperedToken);
    assert.equal(tamperedVerified, null, 'Token with tampered role claim must fail cryptographic verification');
    console.log('[Test 14 Passed] Tampered role claim rejected by cryptographic verification.');

    // Test 15: Expired Token Rejected
    const expiredJwt = await signUserToken(customerUser, { expiresIn: '-1s' });
    const expiredVerified = await verifyJwtToken(expiredJwt);
    assert.equal(expiredVerified, null, 'Expired token must be rejected');
    console.log('[Test 15 Passed] Expired token rejected.');

    // ---------------------------------------------------------
    // GROUP C: Role-Based Authorization Middleware Matrix Tests
    // ---------------------------------------------------------
    console.log('\n--- Group C: Role-Based Authorization Matrix ---');

    // Create tokens for all 3 roles
    const technicianUser: AuthenticatedUser = {
      id: 'tech_001',
      email: 'technician@fixmate.com',
      role: 'technician',
      name: 'Tech Person',
    };
    const adminUser: AuthenticatedUser = {
      id: 'admin_001',
      email: 'admin@fixmate.com',
      role: 'admin',
      name: 'Admin Boss',
    };

    const customerToken = await signUserToken(customerUser);
    const technicianToken = await signUserToken(technicianUser);
    const adminToken = await signUserToken(adminUser);

    // Test 16: Unauthenticated request -> 401
    const unauthRes = await fetch('http://localhost:5005/api/test/customer');
    assert.equal(unauthRes.status, 401, 'Unauthenticated request must return 401');
    const unauthBody = await unauthRes.json();
    assert.equal(unauthBody.success, false);
    assert.equal(unauthBody.statusCode, 401);
    console.log('[Test 16 Passed] Missing token on protected route correctly returns 401.');

    // Test 17: Customer accessing Customer route -> 200 Allowed
    const custCustRes = await fetch('http://localhost:5005/api/test/customer', {
      headers: { authorization: `Bearer ${customerToken}` },
    });
    assert.equal(custCustRes.status, 200, 'Customer accessing customer route must succeed with 200');
    console.log('[Test 17 Passed] Authenticated customer accessing customer route -> 200 OK.');

    // Test 18: Customer accessing Technician route -> 403 Forbidden
    const custTechRes = await fetch('http://localhost:5005/api/test/technician', {
      headers: { authorization: `Bearer ${customerToken}` },
    });
    assert.equal(custTechRes.status, 403, 'Customer accessing technician route must return 403');
    const custTechBody = await custTechRes.json();
    assert.equal(custTechBody.success, false);
    assert.equal(custTechBody.statusCode, 403);
    console.log('[Test 18 Passed] Customer accessing technician route -> 403 Forbidden.');

    // Test 19: Customer accessing Admin route -> 403 Forbidden
    const custAdminRes = await fetch('http://localhost:5005/api/test/admin', {
      headers: { authorization: `Bearer ${customerToken}` },
    });
    assert.equal(custAdminRes.status, 403, 'Customer accessing admin route must return 403');
    console.log('[Test 19 Passed] Customer accessing admin route -> 403 Forbidden.');

    // Test 20: Technician accessing Technician route -> 200 Allowed
    const techTechRes = await fetch('http://localhost:5005/api/test/technician', {
      headers: { authorization: `Bearer ${technicianToken}` },
    });
    assert.equal(techTechRes.status, 200, 'Technician accessing technician route must succeed with 200');
    console.log('[Test 20 Passed] Technician accessing technician route -> 200 OK.');

    // Test 21: Technician accessing Admin route -> 403 Forbidden
    const techAdminRes = await fetch('http://localhost:5005/api/test/admin', {
      headers: { authorization: `Bearer ${technicianToken}` },
    });
    assert.equal(techAdminRes.status, 403, 'Technician accessing admin route must return 403');
    console.log('[Test 21 Passed] Technician accessing admin route -> 403 Forbidden.');

    // Test 22: Admin accessing Admin route -> 200 Allowed
    const adminAdminRes = await fetch('http://localhost:5005/api/test/admin', {
      headers: { authorization: `Bearer ${adminToken}` },
    });
    assert.equal(adminAdminRes.status, 200, 'Admin accessing admin route must succeed with 200');
    console.log('[Test 22 Passed] Admin accessing admin route -> 200 OK.');

    // ---------------------------------------------------------
    // GROUP D: Health & Regression Preservation Tests
    // ---------------------------------------------------------
    console.log('\n--- Group D: Health Route & Regression Preservation ---');

    // Test 23: Base Health Route Preservation
    const healthRes = await fetch('http://localhost:5005/api/health');
    assert.equal(healthRes.status, 503, 'Health route returns 503 when live Atlas is disconnected');
    const healthData = await healthRes.json();
    assert.equal(healthData.services.database, 'disconnected');
    console.log('[Test 23 Passed] Existing health endpoint intact: 503 degraded status preserved.');

    console.log('\n===============================================================');
    console.log('=== ALL 23 TASK 008 AUTHENTICATION & JWT TESTS PASSED! ===');
    console.log('===============================================================');
  } finally {
    _setMockAuthForTest(null);
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

runTestSuite().catch((err) => {
  console.error('\n[Test Suite Failure]:', err);
  process.exit(1);
});
