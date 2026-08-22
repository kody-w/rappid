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
  MONOREPO_MANIFEST_BYTES,
  MONOREPO_MANIFEST_SHA256,
  MONOREPO_MANIFEST_URL,
  MonorepoCompanionLoader,
} from "../src/monorepo-companion.mjs";

test("monorepo snapshot becomes a selected-dimension companion in the cage", async (t) => {
  const home = mkdtempSync(path.join(os.tmpdir(), "rapp-monorepo-companion-"));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const fixture = Buffer.from(JSON.stringify({
    schema: "rapp-monorepo/1.0",
    owner: "kody-w",
    captured_at: "2026-08-22T08:50:36+00:00",
    repos: [
      {
        repo: "rapp-1",
        commit: "a".repeat(40),
        files: 60,
        bytes: 1000,
        skipped_large: [],
        withheld: [],
      },
      {
        repo: "rapp-zoo-v2",
        commit: "b".repeat(40),
        files: 30,
        bytes: 2000,
        skipped_large: ["video.mp4"],
        withheld: [{ file: ".env", reason: "withheld" }],
      },
    ],
  }));
  const customHash = createHash("sha256").update(fixture).digest("hex");
  const loader = new MonorepoCompanionLoader({
    estateHome: home,
    fetchImpl: async () => new Response(fixture, {
      status: 200,
      headers: {
        "content-type": "application/json",
        "content-length": String(fixture.length),
      },
    }),
  });
  await assert.rejects(
    () => loader.load({
      url: MONOREPO_MANIFEST_URL,
      sha256: customHash,
      bytes: fixture.length,
    }),
    /audited immutable snapshot pin/,
  );
});

test("the checked-in monorepo pin is exact and immutable", () => {
  assert.equal(MONOREPO_MANIFEST_BYTES, 67_148);
  assert.equal(
    MONOREPO_MANIFEST_SHA256,
    "6eb7cb606fba200c6aaa39bf57d871e60ee9000e2b6cbdd89f47f55c5a950076",
  );
  assert.match(
    MONOREPO_MANIFEST_URL,
    /raw\.githubusercontent\.com\/kody-w\/rapp-monorepo\/[0-9a-f]{40}\/MANIFEST\.json$/,
  );
});
