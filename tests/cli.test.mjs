import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "..");
const cli = path.join(root, "bin", "rapp-zoo-v2.mjs");

test("CLI advertises semantic and Summon Chant commands", () => {
  const result = spawnSync(process.execPath, [cli, "help"], {
    cwd: root,
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
  const value = JSON.parse(result.stdout);
  assert.match(value.commands.summon, /rapp-summon/);
  assert.match(value.policy, /no coordinates or arbitrary JavaScript/);
});

test("summon command reaches chant validation instead of an undefined function", () => {
  const result = spawnSync(process.execPath, [cli, "summon", "not-a-chant"], {
    cwd: root,
    encoding: "utf8",
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Summon Chant must be a valid URI/);
  assert.doesNotMatch(result.stderr, /summon is not defined/);
});
