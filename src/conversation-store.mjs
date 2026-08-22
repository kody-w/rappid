import { existsSync } from "node:fs";

import {
  readPrivateJson,
  writePrivateJson,
} from "./estate-store.mjs";
import { KeyedQueue } from "./keyed-queue.mjs";

const SCHEMA = "rapp-zoo-conversations/2.0";

function emptyDocument() {
  return { schema: SCHEMA, sessions: {} };
}

function validateDocument(value) {
  if (
    value?.schema !== SCHEMA
    || !value.sessions
    || typeof value.sessions !== "object"
    || Array.isArray(value.sessions)
  ) {
    throw new Error("Conversation store is invalid.");
  }
  for (const session of Object.values(value.sessions)) {
    if (
      !session
      || typeof session !== "object"
      || Array.isArray(session)
      || (
        session.session_id !== null
        && typeof session.session_id !== "string"
      )
      || !Array.isArray(session.messages)
      || session.messages.some((message) => (
        !message
        || typeof message !== "object"
        || !["user", "assistant", "log"].includes(message.role)
        || typeof message.text !== "string"
      ))
    ) {
      throw new Error("Conversation session is invalid.");
    }
  }
  return value;
}

export class ConversationStore {
  constructor({ file }) {
    this.file = file;
    this.writer = new KeyedQueue();
  }

  read() {
    return validateDocument(
      existsSync(this.file)
        ? readPrivateJson(this.file, "Conversations")
        : emptyDocument(),
    );
  }

  session(rappid) {
    return structuredClone(this.read().sessions[rappid] || {
      session_id: null,
      messages: [],
    });
  }

  async commit(rappid, session) {
    return this.writer.run("conversation-document", async () => {
      const latest = this.read();
      latest.sessions[rappid] = structuredClone(session);
      validateDocument(latest);
      writePrivateJson(this.file, latest);
      return structuredClone(session);
    });
  }

  publicMessages() {
    return Object.fromEntries(
      Object.entries(this.read().sessions).map(([rappid, session]) => [
        rappid,
        structuredClone(session.messages),
      ]),
    );
  }
}
