import { MongoClient, Db } from "mongodb";

let client: MongoClient | null = null;
let db: Db | null = null;

export async function getDb(): Promise<Db> {
  if (db) return db;
  const uri = process.env.MONGODB_URI ?? "mongodb://localhost:27017";
  client = new MongoClient(uri, { serverSelectionTimeoutMS: 4000 });
  await client.connect();
  db = client.db(process.env.MONGODB_DB ?? "lemonade");
  await ensureIndexes(db);
  return db;
}

async function ensureIndexes(db: Db) {
  await db.collection("sessions").createIndex({ createdAt: 1 });
  await db.collection("messages").createIndex({ sessionId: 1, createdAt: 1 });
  await db.collection("dap_logs").createIndex({ sessionId: 1, createdAt: 1 });
}

export async function closeDb() {
  await client?.close();
  client = null;
  db = null;
}