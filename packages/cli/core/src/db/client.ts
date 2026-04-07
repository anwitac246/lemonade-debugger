/**
 * MongoDB client — connection pooling with graceful degradation.
 *
 * If MongoDB is unavailable, operations fail silently (noDb mode).
 * The agent still works; history just isn't persisted.
 */

import { MongoClient, Db } from "mongodb";

let client: MongoClient | null = null;
let db: Db | null = null;
let connectionFailed = false;

export async function getDb(): Promise<Db> {
  if (db) return db;
  if (connectionFailed) {
    throw new Error("MongoDB connection previously failed — running in offline mode");
  }

  const uri = process.env.MONGODB_URI ?? "mongodb://localhost:27017";
  const dbName = process.env.MONGODB_DB ?? "lemonade";

  client = new MongoClient(uri, {
    serverSelectionTimeoutMS: 3000,
    connectTimeoutMS: 3000,
    socketTimeoutMS: 10_000,
    maxPoolSize: 5,
    minPoolSize: 1,
  });

  try {
    await client.connect();
    db = client.db(dbName);
    await ensureIndexes(db);
    return db;
  } catch (err) {
    connectionFailed = true;
    await client.close().catch(() => undefined);
    client = null;
    throw err;
  }
}

async function ensureIndexes(database: Db): Promise<void> {
  await Promise.all([
    database
      .collection("sessions")
      .createIndex({ createdAt: -1 })
      .catch(() => undefined),
    database
      .collection("messages")
      .createIndex({ sessionId: 1, createdAt: 1 })
      .catch(() => undefined),
  ]);
}

export async function closeDb(): Promise<void> {
  await client?.close();
  client = null;
  db = null;
  connectionFailed = false;
}