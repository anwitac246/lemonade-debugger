import { ObjectId } from "mongodb";
import { getDb } from "./client.js";
import type { MessageRole } from "../types.js";

export interface StoredMessage {
  _id?: ObjectId;
  sessionId: string;
  role: MessageRole | "tool";
  content: string;
  toolName?: string;
  isError?: boolean;
  createdAt: Date;
  tokens?: number;
}

export async function saveMessage(msg: Omit<StoredMessage, "_id" | "createdAt">): Promise<void> {
  const db = await getDb();
  await db.collection<StoredMessage>("messages").insertOne({
    ...msg,
    createdAt: new Date(),
  });
}

export async function getMessages(sessionId: string): Promise<StoredMessage[]> {
  const db = await getDb();
  return db
    .collection<StoredMessage>("messages")
    .find({ sessionId })
    .sort({ createdAt: 1 })
    .toArray();
}

export async function clearMessages(sessionId: string): Promise<void> {
  const db = await getDb();
  await db.collection<StoredMessage>("messages").deleteMany({ sessionId });
}