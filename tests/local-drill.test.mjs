import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  LocalQuantumDrill,
  LocalSummonStore,
} from "../src/local-drill.mjs";
import {
  ensurePrivateDirectory,
  writePrivateBytes,
} from "../src/estate-store.mjs";

const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");

function fixture(t) {
  const home = mkdtempSync(path.join(os.tmpdir(), "rapp-zoo-drill-"));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const globalRoot = ensurePrivateDirectory(path.join(home, "global-objects", "f".repeat(64)));
  const bytes = Buffer.from('{"frames":["local","ready"]}');
  const localPath = path.join(globalRoot, "frames.json");
  writePrivateBytes(localPath, bytes);
  const loaded = {
    receipt: {
      object_id: `sha256:${"f".repeat(64)}`,
      manifest_sha256: "f".repeat(64),
      loaded_dimensions: ["frames"],
    },
    manifest: {
      dimensions: [{ name: "frames" }],
    },
    dimensions: {
      frames: {
        media_type: "application/json",
        bytes: bytes.length,
        sha256: sha(bytes),
        local_path: localPath,
        value: { frames: ["local", "ready"] },
      },
    },
  };
  const store = new LocalSummonStore({
    estateHome: home,
    now: () => new Date("2026-08-22T12:00:00.000Z"),
  });
  return { bytes, home, loaded, localPath, store };
}

test("Drill is an immediate lookup over fully saved local summons", (t) => {
  const { loaded, store } = fixture(t);
  const saved = store.save(loaded);
  const drill = new LocalQuantumDrill({ summonStore: store });
  const result = drill.lookup({ dimension: "frames" });
  assert.equal(result.source, "local-saved-summons-only");
  assert.equal(result.matches.length, 1);
  assert.deepEqual(result.matches[0].value, {
    frames: ["local", "ready"],
  });
  assert.equal(saved.receiptFile.startsWith(store.root), true);
});

test("URLs, memory-only objects, partial saves, and drifted bytes are worthless", (t) => {
  const { loaded, store } = fixture(t);
  assert.throws(
    () => store.open(
      "https://raw.githubusercontent.com/kody-w/repo/"
        + `${"a".repeat(40)}/receipt.json`,
    ),
    /only a local summon receipt path/,
  );
  const memoryOnly = structuredClone(loaded);
  memoryOnly.dimensions.frames.local_path = path.join(store.root, "missing.json");
  assert.throws(() => store.save(memoryOnly), /not saved/);

  const saved = store.save(loaded);
  writeFileSync(saved.receipt.dimensions[0].local_path, "tampered");
  assert.throws(
    () => store.open(saved.receiptFile),
    /saved-byte verification/,
  );
});

test("lookup has no network input or fallback surface", (t) => {
  const { loaded, store } = fixture(t);
  store.save(loaded);
  const drill = new LocalQuantumDrill({ summonStore: store });
  assert.deepEqual(
    Object.getOwnPropertyNames(
      Object.getPrototypeOf(drill),
    ).sort(),
    ["constructor", "lookup"],
  );
  assert.equal(
    drill.lookup({
      dimension: "missing",
    }).matches.length,
    0,
  );
  assert.throws(
    () => drill.lookup({
      dimension: "frames",
      sha256: "not-a-digest",
      url: "https://example.com",
    }),
    /digest is invalid/,
  );
});

test("a selected-dimension projection cannot become or downgrade a local summon", (t) => {
  const { loaded, store } = fixture(t);
  const complete = store.save(loaded);
  const partial = structuredClone(loaded);
  partial.manifest.dimensions.push({ name: "license" });
  assert.throws(
    () => store.save(partial),
    /fully loaded verified global object/,
  );
  assert.deepEqual(
    store.open(complete.receiptFile).receipt.dimensions.map((entry) => entry.name),
    ["frames"],
    "the existing complete receipt remains intact",
  );
});
