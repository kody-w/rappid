import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import { fetchPinnedCatalog } from "../src/catalog-client.mjs";

const COMMIT = "a".repeat(40);
const URL =
  `https://raw.githubusercontent.com/kody-w/RAPP_Store/${COMMIT}/api/v2/generation.json`;

test("catalog client verifies immutable public line bytes", async () => {
  const body = JSON.stringify({
    schema: "rapp-zoo-summon-line/2.0",
    generated_utc: "2026-08-22T12:00:00.000Z",
    summons: [],
  });
  const sha256 = createHash("sha256").update(body).digest("hex");
  assert.deepEqual(await fetchPinnedCatalog({
    url: URL,
    sha256,
    fetchImpl: async (_url, options) => {
      assert.equal(options.redirect, "error");
      return new Response(body, {
        status: 200,
        headers: { "content-type": "text/plain" },
      });
    },
  }), JSON.parse(body));
});

test("catalog client refuses mutable URLs, hash drift, and wrong schemas", async () => {
  const body = '{"schema":"wrong","generated_utc":"x","summons":[]}';
  const hash = createHash("sha256").update(body).digest("hex");
  await assert.rejects(
    () => fetchPinnedCatalog({
      url: URL.replace(COMMIT, "main"),
      sha256: hash,
      fetchImpl: async () => new Response(body),
    }),
    /commit-pinned/,
  );
  await assert.rejects(
    () => fetchPinnedCatalog({
      url: URL,
      sha256: "b".repeat(64),
      fetchImpl: async () => new Response(body, {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    }),
    /SHA-256 mismatch/,
  );
  await assert.rejects(
    () => fetchPinnedCatalog({
      url: URL,
      sha256: hash,
      fetchImpl: async () => new Response(body, {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    }),
    /schema is invalid/,
  );
});
