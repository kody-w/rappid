import assert from "node:assert/strict";
import {
  mkdtempSync,
  readFileSync,
  rmSync,
} from "node:fs";
import os from "node:os";
import { spawnSync } from "node:child_process";
import path from "node:path";
import test from "node:test";

import { validateGlobalManifest } from "../src/global-object.mjs";

const root = path.resolve(import.meta.dirname, "..");
test("example manifest builder pins every public dimension to source commit", (t) => {
  const commit = "a".repeat(40);
  const temporary = mkdtempSync(path.join(os.tmpdir(), "hello-cage-manifest-"));
  t.after(() => rmSync(temporary, { recursive: true, force: true }));
  const manifestFile = path.join(temporary, "manifest.json");
  const result = spawnSync(
    process.execPath,
    ["scripts/build-example-manifest.mjs", commit, manifestFile],
    { cwd: root, encoding: "utf8" },
  );
  assert.equal(result.status, 0, result.stderr);
  const manifest = JSON.parse(readFileSync(manifestFile, "utf8"));
  assert.equal(validateGlobalManifest(manifest), manifest);
  assert.deepEqual(
    manifest.dimensions.map((entry) => entry.name),
    ["handoff", "license", "template"],
  );
  assert.equal(
    manifest.dimensions.every((entry) => entry.url.includes(`/${commit}/`)),
    true,
  );
  assert.equal(
    manifest.dimensions.every((entry) => !entry.url.includes("/main/")),
    true,
  );
});
