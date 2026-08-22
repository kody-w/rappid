import assert from "node:assert/strict";
import test from "node:test";

import {
  createSummonChant,
  parseSummonChant,
} from "../src/summon-chant.mjs";

const COMMIT = "a".repeat(40);
const HASH = "b".repeat(64);
const RAW =
  `https://raw.githubusercontent.com/kody-w/rapp-store/${COMMIT}/summons/weather/manifest.json`;

test("Summon Chant round-trips immutable GitHub raw user data", () => {
  const chant = createSummonChant({
    manifestUrl: RAW,
    manifestSha256: HASH,
  });
  assert.equal(
    chant,
    `rapp-summon://github/kody-w/rapp-store/${COMMIT}/summons/weather/manifest.json?sha256=${HASH}`,
  );
  assert.deepEqual(parseSummonChant(chant), {
    schema: "rapp-zoo-summon-chant/2.0",
    chant,
    owner: "kody-w",
    repo: "rapp-store",
    commit: COMMIT,
    manifest_path: "summons/weather/manifest.json",
    manifest_url: RAW,
    manifest_sha256: HASH,
  });
});

test("mutable, incomplete, extra-query, and malformed chants are refused", () => {
  for (const chant of [
    `rapp-summon://github/kody-w/repo/main/manifest.json?sha256=${HASH}`,
    `rapp-summon://github/kody-w/repo/${COMMIT}?sha256=${HASH}`,
    `rapp-summon://github/kody-w/repo/${COMMIT}/manifest.json?sha256=short`,
    `rapp-summon://github/kody-w/repo/${COMMIT}/manifest.json?sha256=${HASH}&run=true`,
    `https://raw.githubusercontent.com/kody-w/repo/${COMMIT}/manifest.json`,
  ]) {
    assert.throws(() => parseSummonChant(chant), /grammar|URI/);
  }
});
