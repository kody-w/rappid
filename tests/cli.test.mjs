import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
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
  assert.match(value.commands.simulate, /fixture/);
  assert.match(value.policy, /no coordinates or arbitrary JavaScript/);
});

test("simulate command replays typed local results", (t) => {
  const directory = mkdtempSync(path.join(tmpdir(), "zoo-simulate-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const planFile = path.join(directory, "plan.json");
  const fixtureFile = path.join(directory, "fixture.json");
  const hash = "1".repeat(64);
  writeFileSync(planFile, JSON.stringify({
    schema: "rapp-zoo-simulation/2.0",
    simulation_id: "cli-replay",
    mode: "stochastic",
    replicas: 2,
    max_concurrency: 2,
    replica_timeout_ms: 1000,
    seeds: ["seed-a", "seed-b"],
    topology: {
      nodes: [{
        id: "linux-one",
        os: "linux",
        image_sha256: hash,
        config_sha256: hash,
      }],
      links: [],
    },
    steps: [{
      step: 0,
      node: "linux-one",
      operation: "job.run",
      args: { name: "proof" },
    }],
    policy: { kind: "exact-quorum", minimum_matching: 2 },
  }));
  writeFileSync(fixtureFile, JSON.stringify([
    { output: "same" },
    { output: "same" },
  ]));
  const result = spawnSync(process.execPath, [
    cli,
    "simulate",
    planFile,
    fixtureFile,
  ], {
    cwd: root,
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.accepted, true);
  assert.equal(report.matching_replicas, 2);

  writeFileSync(fixtureFile, Buffer.alloc((128 * 1024) + 1));
  const oversized = spawnSync(process.execPath, [
    cli,
    "simulate",
    planFile,
    fixtureFile,
  ], {
    cwd: root,
    encoding: "utf8",
  });
  assert.equal(oversized.status, 1);
  assert.match(oversized.stderr, /bounded regular file|replay limit/);

  writeFileSync(planFile, Buffer.from([0xff]));
  const malformedUtf8 = spawnSync(process.execPath, [
    cli,
    "simulate",
    planFile,
    fixtureFile,
  ], {
    cwd: root,
    encoding: "utf8",
  });
  assert.equal(malformedUtf8.status, 1);
  assert.match(malformedUtf8.stderr, /encoded data|utf-8/i);
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
