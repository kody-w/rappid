import assert from "node:assert/strict";
import {
  mkdtempSync,
  rmSync,
  statSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  sendAutopilotCommand,
  startAutopilotServer,
  validateAutopilotCommand,
} from "../src/autopilot-server.mjs";

const ESTATE = `estate:rappid:@kody-w/rapp-zoo-v2:${"a".repeat(64)}`;
const TOKEN = "b".repeat(64);

test("authenticated semantic commands round-trip with request identity", async (t) => {
  const home = mkdtempSync(path.join(os.tmpdir(), "rapp-zoo-autopilot-"));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const seen = [];
  const server = await startAutopilotServer({
    estateHome: home,
    estateId: ESTATE,
    token: TOKEN,
    now: () => new Date("2026-08-22T12:00:00.000Z"),
    execute: async (command) => {
      seen.push(command);
      return { revision: 7, controls: [] };
    },
  });
  t.after(() => server.close());
  assert.equal(statSync(server.metadataFile).mode & 0o777, 0o600);
  assert.deepEqual(
    await sendAutopilotCommand(server.metadataFile, {
      command: "snapshot",
    }),
    { revision: 7, controls: [] },
  );
  assert.equal(seen[0].command, "snapshot");
  assert.equal(
    (await sendAutopilotCommand(server.metadataFile, {
      command: "wait",
      args: { milliseconds: 1 },
    })).waited_ms,
    1,
  );
});

test("coordinates, arbitrary JavaScript, undeclared args, and stale revisions fail", async (t) => {
  for (const command of [
    {
      schema: "rapp-zoo-autopilot-command/2.0",
      request_id: "1",
      revision: 1,
      command: "click",
      args: { x: 10, y: 20 },
    },
    {
      schema: "rapp-zoo-autopilot-command/2.0",
      request_id: "2",
      revision: 1,
      command: "evaluate",
      args: { javascript: "document.body.remove()" },
    },
    {
      schema: "rapp-zoo-autopilot-command/2.0",
      request_id: "3",
      revision: 1,
      command: "invoke",
      args: { control_id: "x", x: 1 },
    },
  ]) {
    assert.throws(() => validateAutopilotCommand(command), /invalid|members/);
  }

  const home = mkdtempSync(path.join(os.tmpdir(), "rapp-zoo-stale-"));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const server = await startAutopilotServer({
    estateHome: home,
    estateId: ESTATE,
    token: TOKEN,
    execute: async () => {
      const error = new Error("Expected revision 9.");
      error.code = "STALE_REVISION";
      throw error;
    },
  });
  t.after(() => server.close());
  await assert.rejects(
    () => sendAutopilotCommand(server.metadataFile, {
      command: "invoke",
      revision: 8,
      args: { control_id: "neighborhood.attach" },
    }),
    (error) => error.code === "STALE_REVISION",
  );
});

test("tokenless calls cannot inspect the virtual browser", async (t) => {
  const home = mkdtempSync(path.join(os.tmpdir(), "rapp-zoo-tokenless-"));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  let executed = 0;
  const server = await startAutopilotServer({
    estateHome: home,
    estateId: ESTATE,
    token: TOKEN,
    execute: async () => { executed += 1; },
  });

  t.after(() => server.close());
  const response = await fetch(server.metadata.endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      schema: "rapp-zoo-autopilot-command/2.0",
      request_id: "x",
      revision: null,
      command: "snapshot",
      args: {},
    }),
  });
  assert.equal(response.status, 403);
  assert.equal(executed, 0);
});

test("semantic responses have a separate bounded budget from commands", async (t) => {
  const home = mkdtempSync(path.join(os.tmpdir(), "rapp-zoo-response-"));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const payload = "x".repeat(100 * 1024);
  const server = await startAutopilotServer({
    estateHome: home,
    estateId: ESTATE,
    token: TOKEN,
    execute: async () => ({ payload }),
  });
  t.after(() => server.close());
  assert.equal(
    (await sendAutopilotCommand(server.metadataFile, {
      command: "snapshot",
    })).payload.length,
    payload.length,
  );
});
