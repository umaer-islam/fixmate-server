import { MongoClient, Db, ServerApiVersion } from 'mongodb';
import { env, getMongoURI } from '../config/env.js';

let client: MongoClient | null = null;
let dbInstance: Db | null = null;
let connectionPromise: Promise<Db> | null = null;
let isConnecting = false;

function sanitizeMongoURI(uri: string): string {
  try {
    const url = new URL(uri);
    url.username = '***';
    url.password = '***';
    return url.toString();
  } catch {
    return 'mongodb://***:***@hidden';
  }
}

export async function connectDB(customUri?: string): Promise<Db> {
  // If already connected, return existing db singleton
  if (dbInstance && client) {
    return dbInstance;
  }

  // If another connection attempt is in-flight, await the same promise
  if (connectionPromise) {
    return connectionPromise;
  }

  const uri = customUri || getMongoURI();

  if (!uri) {
    throw new Error('MongoDB connection string is missing. Please set MONGODB_URI or DATABASE_URL in environment.');
  }

  connectionPromise = (async () => {
    isConnecting = true;
    let newClient: MongoClient | null = null;

    try {
      const safeUri = sanitizeMongoURI(uri);
      console.log(`[MongoDB] Initiating connection to ${safeUri} (Database: ${env.DB_NAME})...`);

      newClient = new MongoClient(uri, {
        serverSelectionTimeoutMS: env.MONGODB_TIMEOUT_MS,
        connectTimeoutMS: env.MONGODB_TIMEOUT_MS,
        serverApi: {
          version: ServerApiVersion.v1,
          strict: false,
          deprecationErrors: true,
        },
      });

      await newClient.connect();

      // Check if closeDB() was triggered while connecting
      if (!isConnecting) {
        await newClient.close();
        throw new Error('Connection aborted: closeDB was called during connection initialization.');
      }

      client = newClient;
      dbInstance = client.db(env.DB_NAME);

      // Verify connectivity with ping command
      await dbInstance.command({ ping: 1 });
      console.log(`[MongoDB] Successfully connected and pinged database: ${env.DB_NAME}`);

      return dbInstance;
    } catch (error) {
      if (newClient) {
        try {
          await newClient.close();
        } catch {
          // ignore close error during connection failure cleanup
        }
      }
      client = null;
      dbInstance = null;
      const errorMessage = error instanceof Error ? error.message : 'Unknown connection error';
      console.error(`[MongoDB Connection Error] Failed to connect: ${errorMessage}`);
      throw error;
    } finally {
      isConnecting = false;
      connectionPromise = null;
    }
  })();

  return connectionPromise;
}

export function getDB(): Db {
  if (!dbInstance) {
    throw new Error('Database not initialized. Ensure connectDB() has resolved before accessing collections.');
  }
  return dbInstance;
}

export function getMongoClient(): MongoClient | null {
  return client;
}

export async function checkDBHealth(): Promise<boolean> {
  if (!dbInstance || !client) {
    return false;
  }
  try {
    await dbInstance.command({ ping: 1 });
    return true;
  } catch {
    return false;
  }
}

export async function closeDB(): Promise<void> {
  isConnecting = false;
  connectionPromise = null;

  if (!client) {
    dbInstance = null;
    return;
  }

  const clientToClose = client;
  client = null;
  dbInstance = null;

  console.log('[MongoDB] Closing database connection...');
  try {
    await clientToClose.close();
    console.log('[MongoDB] Connection closed cleanly.');
  } catch (err) {
    console.error('[MongoDB Error] Error closing connection:', err);
  }
}

// Test/Mock helper to inspect or reset internal connection state in isolated unit tests
export function _resetConnectionStateForTest(): void {
  client = null;
  dbInstance = null;
  connectionPromise = null;
  isConnecting = false;
}

export function _setMockDbInstanceForTest(mockClient: MongoClient | null, mockDb: Db | null): void {
  client = mockClient;
  dbInstance = mockDb;
  connectionPromise = null;
  isConnecting = false;
}
