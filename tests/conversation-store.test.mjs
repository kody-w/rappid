import assert from "node:assert/strict";
import {
  mkdtempSync,
  rmSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { ConversationStore } from "../src/conversation-store.mjs";

test("concurrent neighborhood completions merge into the shared document", async (t) => {
  const root = mkdtempSync(path.join(os.tmpdir(), "rapp-zoo-conversations-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const store = new ConversationStore({
    file: path.join(root, "conversations.json"),
  });
  await Promise.all([
    store.commit("a", {
      session_id: "session-a",
      messages: [{ role: "assistant", text: "A" }],
    }),
    store.commit("b", {
      session_id: "session-b",
      messages: [{ role: "assistant", text: "B" }],
    }),
  ]);
  assert.deepEqual(Object.keys(store.read().sessions).sort(), ["a", "b"]);
  assert.equal(store.session("a").messages[0].text, "A");
  assert.equal(store.session("b").messages[0].text, "B");
});

test("same-neighborhood commits replace only that session", async (t) => {
  const root = mkdtempSync(path.join(os.tmpdir(), "rapp-zoo-conversations-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const store = new ConversationStore({
    file: path.join(root, "conversations.json"),
  });
  await store.commit("a", {
    session_id: "one",
    messages: [{ role: "user", text: "first" }],
  });
  await store.commit("a", {
    session_id: "one",
    messages: [
      { role: "user", text: "first" },
      { role: "assistant", text: "second" },
    ],
  });
  assert.equal(store.read().sessions.a.messages.length, 2);
});
