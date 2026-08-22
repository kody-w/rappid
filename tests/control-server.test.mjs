import assert from "node:assert/strict";
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  requestInstanceControl,
  startControlServer,
} from "../src/control-server.mjs";

const ESTATE_ID = `estate:rappid:@kody-w/rapp-zoo-v2:${"a".repeat(64)}`;
const TOKEN = "b".repeat(64);

function fixture(t) {
  const home = mkdtempSync(path.join(os.tmpdir(), "rapp-zoo-control-"));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  return home;
}

test("probe and stop require the private instance capability", async (t) => {
  const home = fixture(t);
  let stops = 0;
  const control = await startControlServer({
    estateHome: home,
    estateId: ESTATE_ID,
    instanceToken: TOKEN,
    now: () => new Date("2026-08-22T12:00:00.000Z"),
    onStop: () => { stops += 1; },
  });
  t.after(() => control.close());
  assert.equal(statSync(control.metadataFile).mode & 0o777, 0o600);
  assert.equal(
    await requestInstanceControl(control.metadataFile, "probe", {
      estateId: ESTATE_ID,
    }),
    true,
  );

  const wrong = await fetch(control.metadata.endpoint, {
    method: "POST",
    headers: {
      authorization: `Bearer ${"c".repeat(64)}`,
      "content-type": "application/json",
    },
    body: '{"action":"stop"}',
  });
  assert.equal(wrong.status, 403);
  assert.equal(stops, 0);
  assert.equal(
    await requestInstanceControl(control.metadataFile, "stop", {
      estateId: ESTATE_ID,
    }),
    true,
  );
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(stops, 1);
});

test("malformed or stale authority fails without PID signaling", async (t) => {
  const home = fixture(t);
  const metadataFile = path.join(home, "control.json");
  writeFileSync(metadataFile, JSON.stringify({
    schema: "rapp-zoo-control/2.0",
    estate_id: ESTATE_ID,
    endpoint: "http://127.0.0.1:9/control",
    instance_token: TOKEN,
    pid: 1,
    started_utc: "2026-08-22T12:00:00.000Z",
  }));
  let fetched = 0;
  assert.equal(
    await requestInstanceControl(metadataFile, "probe", {
      fetchImpl: async () => {
        fetched += 1;
        throw new Error("unreachable");
      },
    }),
    false,
  );
  assert.equal(fetched, 1);

  const malformed = JSON.parse(readFileSync(metadataFile, "utf8"));
  malformed.endpoint = "http://example.com/control";
  writeFileSync(metadataFile, JSON.stringify(malformed));
  await assert.rejects(
    () => requestInstanceControl(metadataFile, "stop"),
    /metadata is invalid/,
  );
});
