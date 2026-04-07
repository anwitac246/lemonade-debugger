import { ObjectId } from "mongodb";
import { getDb } from "./client.js";
import type { SessionMetadata } from "../types.js";

interface SessionDoc {
  _id?: ObjectId;
  createdAt: Date;
  updatedAt: Date;
  model: string;
  messageCount: number;
  title?: string;
}

export async function createSession(model: string): Promise<string> {
  const db = await getDb();
  const result = await db.collection<SessionDoc>("sessions").insertOne({
    createdAt: new Date(),
    updatedAt: new Date(),
    model,
    messageCount: 0,
  });
  return result.insertedId.toHexString();
}

export async function touchSession(sessionId: string): Promise<void> {
  try {
    const db = await getDb();
    await db.collection<SessionDoc>("sessions").updateOne(
      { _id: new ObjectId(sessionId) },
      {
        $set: { updatedAt: new Date() },
        $inc: { messageCount: 1 },
      }
    );
  } catch {
    // Non-fatal — session tracking is best-effort
  }
}

export async function listSessions(limit = 20): Promise<SessionMetadata[]> {
  const db = await getDb();
  const docs = await db
    .collection<SessionDoc>("sessions")
    .find()
    .sort({ createdAt: -1 })
    .limit(limit)
    .toArray();

  return docs.map((d) => ({
    id: d._id!.toHexString(),
    createdAt: d.createdAt,
    updatedAt: d.updatedAt,
    model: d.model,
    messageCount: d.messageCount,
    title: d.title,
  }));
}