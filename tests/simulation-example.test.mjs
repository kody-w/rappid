import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import { parseSummonChant } from "../src/summon-chant.mjs";

const directory = path.resolve(
  import.meta.dirname,
  "..",
  "examples",
  "multi-os-vnet-simulation",
);
const manifest = JSON.parse(
  readFileSync(path.join(directory, "manifest.json"), "utf8"),
);
const files = {
  "deterministic-plan": "deterministic-plan.json",
  "stochastic-plan": "stochastic-plan.json",
  fixture: "fixture.json",
  readme: "README.md",
  handoff: "handoff.md",
  license: "LICENSE",
};

test("public simulation manifest pins every complete local dimension", () => {
  assert.equal(manifest.schema, "rapp-zoo-global-object/2.0");
  assert.match(
    manifest.source_rappid,
    /^rappid:@kody-w\/multi-os-vnet-simulation:[0-9a-f]{64}$/,
  );
  assert.deepEqual(
    manifest.dimensions.map((dimension) => dimension.name).sort(),
    Object.keys(files).sort(),
  );
  const commits = new Set();
  for (const dimension of manifest.dimensions) {
    const url = new URL(dimension.url);
    const [, owner, repo, commit] = url.pathname.split("/");
    assert.equal(owner, "kody-w");
    assert.equal(repo, "rapp-zoo-v2");
    assert.match(commit, /^[0-9a-f]{40}$/);
    commits.add(commit);
    const bytes = readFileSync(path.join(directory, files[dimension.name]));
    assert.equal(bytes.length, dimension.bytes);
    assert.equal(
      createHash("sha256").update(bytes).digest("hex"),
      dimension.sha256,
    );
  }
  assert.equal(commits.size, 1);
});

test("public simulation fixture contains exactly 94 stable and 6 retained outliers", () => {
  const fixture = JSON.parse(readFileSync(path.join(directory, "fixture.json")));
  assert.equal(fixture.length, 100);
  assert.equal(
    fixture.filter((result) => result.receipt === "SIMULATION_STABLE").length,
    94,
  );
  assert.deepEqual(
    fixture.slice(94).map((result) => result.receipt),
    Array.from({ length: 6 }, (_, index) => `SIMULATION_NOISE_${index + 94}`),
  );
});

test("public simulation chant pins the committed manifest bytes", () => {
  const value = JSON.parse(readFileSync(path.join(directory, "chant.json")));
  const parsed = parseSummonChant(value.chant);
  const bytes = readFileSync(path.join(directory, "manifest.json"));
  const digest = createHash("sha256").update(bytes).digest("hex");
  assert.equal(value.manifest_sha256, digest);
  assert.equal(parsed.manifest_sha256, digest);
  assert.equal(parsed.manifest_url, value.manifest_url);
  assert.match(parsed.commit, /^[0-9a-f]{40}$/);
});
