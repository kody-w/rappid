import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  mkdtempSync,
  rmSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  ensurePrivateDirectory,
  writePrivateBytes,
} from "../src/estate-store.mjs";
import { LocalSummonStore } from "../src/local-drill.mjs";
import { SummonLibrary } from "../src/summon-library.mjs";

const COMMIT = "a".repeat(40);
const MANIFEST_SHA = "f".repeat(64);
const RAPPID = `rappid:@kody-w/weather:${"b".repeat(64)}`;
const raw = (file) => (
  `https://raw.githubusercontent.com/kody-w/rapp-zoo-data/${COMMIT}/${file}`
);
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");

function fixture(t) {
  const home = mkdtempSync(path.join(os.tmpdir(), "rapp-zoo-library-"));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const source = ensurePrivateDirectory(
    path.join(home, "global-objects", MANIFEST_SHA),
  );
  const license = Buffer.from(
    "MIT License\n\nPermission is hereby granted, free of charge...",
  );
  const frames = Buffer.from('{"frames":["sunny"]}');
  const licensePath = path.join(source, "license.txt");
  const framesPath = path.join(source, "frames.json");
  writePrivateBytes(licensePath, license);
  writePrivateBytes(framesPath, frames);
  const loaded = {
    receipt: {
      object_id: `sha256:${MANIFEST_SHA}`,
      manifest_sha256: MANIFEST_SHA,
      loaded_dimensions: ["frames", "license"],
    },
    manifest: {
      dimensions: [{ name: "frames" }, { name: "license" }],
    },
    dimensions: {
      license: {
        media_type: "text/plain",
        bytes: license.length,
        sha256: sha(license),
        local_path: licensePath,
        value: license.toString(),
      },
      frames: {
        media_type: "application/json",
        bytes: frames.length,
        sha256: sha(frames),
        local_path: framesPath,
        value: { frames: ["sunny"] },
      },
    },
  };
  const summonStore = new LocalSummonStore({
    estateHome: home,
    now: () => new Date("2026-08-22T12:00:00.000Z"),
  });
  const saved = summonStore.save(loaded);
  const library = new SummonLibrary({
    estateHome: home,
    summonStore,
    now: () => new Date("2026-08-22T12:01:00.000Z"),
  });
  return {
    home,
    library,
    licenseSha: sha(license),
    loaded,
    saved,
    summonStore,
  };
}

function approval(f) {
  return {
    alias: "weather",
    rappid: RAPPID,
    name: "Weather",
    version: "1.0.0",
    spdx: "MIT",
    licenseUrl: raw("LICENSE"),
    licenseSha256: f.licenseSha,
    manifestUrl: raw("manifest.json"),
    manifestSha256: MANIFEST_SHA,
    receiptFile: f.saved.receiptFile,
  };
}

test("MIT summon approval binds license, immutable source, and local receipt", (t) => {
  const f = fixture(t);
  const entry = f.library.approve(approval(f));
  assert.equal(entry.license.spdx, "MIT");
  assert.equal(entry.approval.scope, "public-telephone-line");
  assert.equal(entry.local_receipt.object_id, `sha256:${MANIFEST_SHA}`);
  const catalog = f.library.publicCatalog();
  assert.equal(catalog.summons.length, 1);
  assert.equal("local_receipt" in catalog.summons[0], false);
  assert.equal(JSON.stringify(catalog).includes(f.home), false);
});

test("unapproved and unverifiable licenses cannot enter the public line", (t) => {
  const f = fixture(t);
  assert.throws(
    () => f.library.approve({ ...approval(f), spdx: "LicenseRef-Proprietary" }),
    /not approved/,
  );
  assert.throws(
    () => f.library.approve({
      ...approval(f),
      licenseUrl: "https://raw.githubusercontent.com/kody-w/repo/main/LICENSE",
    }),
    /commit-pinned/,
  );
  assert.throws(
    () => f.library.approve({
      ...approval(f),
      licenseSha256: "c".repeat(64),
    }),
    /license text is not locally saved/,
  );
});

test("local dial is network-free; imported public dial saves before use", async (t) => {
  const source = fixture(t);
  source.library.approve(approval(source));
  let loads = 0;
  const local = await source.library.dial("weather", {
    globalLoader: {
      async load() {
        loads += 1;
        throw new Error("network must not be touched");
      },
    },
  });
  assert.equal(local.source, "local");
  assert.equal(loads, 0);

  const target = fixture(t);
  target.library.importCatalog(source.library.publicCatalog());
  const remote = await target.library.dial("weather", {
    globalLoader: {
      async load(options) {
        loads += 1;
        assert.deepEqual(options, {
          manifestUrl: raw("manifest.json"),
          manifestSha256: MANIFEST_SHA,
        });
        return target.loaded;
      },
    },
  });
  assert.equal(remote.source, "telephone-line-then-local");
  assert.equal(loads, 1);
  const redial = await target.library.dial("weather", {
    globalLoader: { async load() { loads += 1; } },
  });
  assert.equal(redial.source, "local");
  assert.equal(loads, 1);
});

test("catalog import rejects duplicate rappids before persisting corruption", (t) => {
  const source = fixture(t);
  source.library.approve(approval(source));
  const catalog = source.library.publicCatalog();
  catalog.summons.push({
    ...structuredClone(catalog.summons[0]),
    alias: "weather-alias",
  });
  const target = fixture(t);
  assert.throws(
    () => target.library.importCatalog(catalog),
    /conflicts with an existing alias or rappid/,
  );
  assert.deepEqual(target.library.list(), []);
});
