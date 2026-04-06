import { ObjectId } from "mongodb";
import { getDb } from "./client.js";

export interface Session {
  _id?: ObjectId;
  createdAt: Date;
  updatedAt: Date;
  model: string;
  messageCount: number;
}

export async function createSession(model: string): Promise<string> {
  const db = await getDb();
  const result = await db.collection<Session>("sessions").insertOne({
    createdAt: new Date(),
    updatedAt: new Date(),
    model,
    messageCount: 0,
  });
  return result.insertedId.toHexString();
}

export async function touchSession(sessionId: string): Promise<void> {
  const db = await getDb();
  await db.collection<Session>("sessions").updateOne(
    { _id: new ObjectId(sessionId) },
    { $set: { updatedAt: new Date() }, $inc: { messageCount: 1 } }
  );
}

export async function listSessions(limit = 20): Promise<Session[]> {
  const db = await getDb();
  return db
    .collection<Session>("sessions")
    .find()
    .sort({ createdAt: -1 })
    .limit(limit)
    .toArray();
}