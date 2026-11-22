import { MongoClient, Db, ServerApiVersion } from 'mongodb';
import { env, getMongoURI } from '../config/env.js';

let client: MongoClient | null = null;
let dbInstance: Db | null = null;
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

export async function connectDB(): Promise<Db> {
  if (dbInstance && client) {
    return dbInstance;
  }

  if (isConnecting) {
    while (isConnecting) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    if (dbInstance) return dbInstance;
  }

  isConnecting = true;
  const uri = getMongoURI();

  if (!uri) {
    isConnecting = false;
    throw new Error('MongoDB connection string is missing. Please set MONGODB_URI or DATABASE_URL in environment.');
  }

  try {
    const safeUri = sanitizeMongoURI(uri);
    console.log(`[MongoDB] Initiating connection to ${safeUri} (Database: ${env.DB_NAME})...`);

    const newClient = new MongoClient(uri, {
      serverSelectionTimeoutMS: env.MONGODB_TIMEOUT_MS,
      connectTimeoutMS: env.MONGODB_TIMEOUT_MS,
      serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true,
      },
    });

    await newClient.connect();
    client = newClient;
    dbInstance = client.db(env.DB_NAME);

    // Verify connectivity with ping command
    await dbInstance.command({ ping: 1 });
    console.log(`[MongoDB] Successfully connected and pinged database: ${env.DB_NAME}`);

    return dbInstance;
  } catch (error) {
    client = null;
    dbInstance = null;
    const errorMessage = error instanceof Error ? error.message : 'Unknown connection error';
    console.error(`[MongoDB Connection Error] Failed to connect: ${errorMessage}`);
    throw error;
  } finally {
    isConnecting = false;
  }
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
  if (client) {
    console.log('[MongoDB] Closing database connection...');
    try {
      await client.close();
      console.log('[MongoDB] Connection closed cleanly.');
    } catch (err) {
      console.error('[MongoDB Error] Error closing connection:', err);
    } finally {
      client = null;
      dbInstance = null;
    }
  }
}
