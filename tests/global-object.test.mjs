import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  GlobalObjectLoader,
  pinnedRawUrl,
  publicGlobalProjection,
} from "../src/global-object.mjs";

const COMMIT = "a".repeat(40);
const SOURCE = `rappid:@kody-w/global-object:${"b".repeat(64)}`;
const raw = (file) => (
  `https://raw.githubusercontent.com/kody-w/rapp-zoo-data/${COMMIT}/${file}`
);
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");

function fixture(t) {
  const home = mkdtempSync(path.join(os.tmpdir(), "rapp-zoo-global-"));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  return home;
}

function response(bytes, mediaType = "application/json", status = 200) {
  return new Response(bytes, {
    status,
    headers: {
      "content-type": mediaType,
      "content-length": String(Buffer.byteLength(bytes)),
    },
  });
}

test("commit-pinned dimensions stream into a verified local global object", async (t) => {
  const home = fixture(t);
  const catalog = Buffer.from('{"agents":["research","finance"]}');
  const handoff = Buffer.from("Continue with package proof.");
  const manifest = Buffer.from(JSON.stringify({
    schema: "rapp-zoo-global-object/2.0",
    name: "Morning operations",
    source_rappid: SOURCE,
    created_utc: "2026-08-22T12:00:00.000Z",
    dimensions: [
      {
        name: "catalog",
        url: raw("catalog.json"),
        sha256: sha(catalog),
        bytes: catalog.length,
        media_type: "application/json",
      },
      {
        name: "handoff",
        url: raw("handoff.md"),
        sha256: sha(handoff),
        bytes: handoff.length,
        media_type: "text/markdown",
      },
    ],
  }));
  const bodies = new Map([
    [raw("manifest.json"), [manifest, "application/json"]],
    [raw("catalog.json"), [catalog, "application/json"]],
    [raw("handoff.md"), [handoff, "text/markdown"]],
  ]);
  const seen = [];
  const loader = new GlobalObjectLoader({
    estateHome: home,
    fetchImpl: async (url, options) => {
      seen.push({ url, options });
      const [body, mediaType] = bodies.get(url);
      return response(body, mediaType);
    },
  });
  const loaded = await loader.load({
    manifestUrl: raw("manifest.json"),
    manifestSha256: sha(manifest),
  });
  const projection = publicGlobalProjection(loaded);
  assert.deepEqual(projection.loaded_dimensions, ["catalog", "handoff"]);
  assert.deepEqual(projection.dimensions.catalog.value, {
    agents: ["research", "finance"],
  });
  assert.equal(
    projection.dimensions.handoff.value,
    "Continue with package proof.",
  );
  assert.equal("local_path" in projection.dimensions.catalog, false);
  assert.equal(seen.every((entry) => entry.options.redirect === "error"), true);

  const cached = await loader.load({
    manifestUrl: raw("manifest.json"),
    manifestSha256: sha(manifest),
    dimensions: ["catalog"],
  });
  assert.deepEqual(cached.receipt.loaded_dimensions, ["catalog"]);
  assert.equal(
    seen.filter((entry) => entry.url === raw("catalog.json")).length,
    1,
    "verified cached dimensions are not fetched again",
  );
});

test("mutable, foreign-host, and malformed raw URLs are refused", () => {
  for (const url of [
    "https://raw.githubusercontent.com/kody-w/repo/main/data.json",
    `https://github.com/kody-w/repo/raw/${COMMIT}/data.json`,
    `https://raw.githubusercontent.com/kody-w/repo/${COMMIT}`,
    `https://raw.githubusercontent.com/kody-w/repo/${COMMIT}/data.json?x=1`,
  ]) {
    assert.throws(() => pinnedRawUrl(url), /commit-pinned/);
  }
});

test("hash, byte, media, duplicate, and cache drift fail closed", async (t) => {
  const home = fixture(t);
  const data = Buffer.from('{"ok":true}');
  const dimension = {
    name: "state",
    url: raw("state.json"),
    sha256: sha(data),
    bytes: data.length,
    media_type: "application/json",
  };
  const manifestValue = {
    schema: "rapp-zoo-global-object/2.0",
    name: "State",
    source_rappid: SOURCE,
    created_utc: "2026-08-22T12:00:00.000Z",
    dimensions: [dimension],
  };
  const manifest = Buffer.from(JSON.stringify(manifestValue));
  const loader = new GlobalObjectLoader({
    estateHome: home,
    fetchImpl: async (url) => (
      url.endsWith("manifest.json")
        ? response(manifest)
        : response(data)
    ),
  });
  await assert.rejects(
    () => loader.load({
      manifestUrl: raw("manifest.json"),
      manifestSha256: "f".repeat(64),
    }),
    /manifest SHA-256 mismatch/,
  );
  const loaded = await loader.load({
    manifestUrl: raw("manifest.json"),
    manifestSha256: sha(manifest),
  });
  writeFileSync(loaded.dimensions.state.local_path, "tampered");
  await assert.rejects(
    () => loader.load({
      manifestUrl: raw("manifest.json"),
      manifestSha256: sha(manifest),
    }),
    /Cached global dimension failed/,
  );

  const duplicate = Buffer.from(JSON.stringify({
    ...manifestValue,
    dimensions: [dimension, dimension],
  }));
  const duplicateLoader = new GlobalObjectLoader({
    estateHome: fixture(t),
    fetchImpl: async () => response(duplicate),
  });
  await assert.rejects(
    () => duplicateLoader.load({
      manifestUrl: raw("manifest.json"),
      manifestSha256: sha(duplicate),
    }),
    /invalid or duplicated/,
  );

  assert.equal(
    JSON.parse(readFileSync(
      path.join(path.dirname(loaded.dimensions.state.local_path), "receipt.json"),
      "utf8",
    )).manifest_sha256,
    sha(manifest),
  );
});
