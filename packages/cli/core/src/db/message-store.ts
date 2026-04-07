import { ObjectId } from "mongodb";
import { getDb } from "./client.js";
import type { StoredMessage } from "../types.js";

interface MessageDoc {
  _id?: ObjectId;
  sessionId: string;
  role: string;
  content: string;
  toolName?: string;
  toolCallId?: string;
  isError?: boolean;
  createdAt: Date;
  tokens?: number;
}

export async function saveMessage(
  msg: Omit<StoredMessage, "id" | "createdAt">
): Promise<void> {
  try {
    const db = await getDb();
    await db.collection<MessageDoc>("messages").insertOne({
      ...msg,
      createdAt: new Date(),
    });
  } catch {
    // Non-fatal — persistence is best-effort
  }
}

export async function getMessages(sessionId: string): Promise<StoredMessage[]> {
  const db = await getDb();
  const docs = await db
    .collection<MessageDoc>("messages")
    .find({ sessionId })
    .sort({ createdAt: 1 })
    .toArray();

  return docs.map((d) => ({
    id: d._id?.toHexString(),
    sessionId: d.sessionId,
    role: d.role as StoredMessage["role"],
    content: d.content,
    toolName: d.toolName,
    toolCallId: d.toolCallId,
    isError: d.isError,
    createdAt: d.createdAt,
    tokens: d.tokens,
  }));
}

export async function clearMessages(sessionId: string): Promise<void> {
  const db = await getDb();
  await db.collection<MessageDoc>("messages").deleteMany({ sessionId });
}