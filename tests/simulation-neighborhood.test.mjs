import assert from "node:assert/strict";
import test from "node:test";

import {
  runSimulation,
  validateSimulationPlan,
} from "../src/simulation-neighborhood.mjs";

const hash = (character) => character.repeat(64);

function plan({ mode = "deterministic", minimumMatching = 94 } = {}) {
  return {
    schema: "rapp-zoo-simulation/2.0",
    simulation_id: "mixed-os-vnet",
    mode,
    replicas: 100,
    max_concurrency: 10,
    replica_timeout_ms: 1000,
    seeds: Array.from({ length: 100 }, (_, index) => `seed-${index}`),
    topology: {
      nodes: [
        {
          id: "windows-client",
          os: "windows",
          image_sha256: hash("a"),
          config_sha256: hash("b"),
        },
        {
          id: "mac-client",
          os: "macos",
          image_sha256: hash("c"),
          config_sha256: hash("d"),
        },
        {
          id: "linux-server",
          os: "linux",
          image_sha256: hash("e"),
          config_sha256: hash("f"),
        },
      ],
      links: [
        {
          from: "windows-client",
          to: "linux-server",
          network: "private-vnet",
          latency_ms: 10,
          loss_basis_points: 0,
        },
        {
          from: "mac-client",
          to: "linux-server",
          network: "private-vnet",
          latency_ms: 10,
          loss_basis_points: 0,
        },
      ],
    },
    steps: [{
      step: 0,
      node: "linux-server",
      operation: "service.process",
      args: { request: "synthetic" },
    }],
    policy: mode === "deterministic"
      ? { kind: "all-identical" }
      : { kind: "exact-quorum", minimum_matching: minimumMatching },
  };
}

test("deterministic software fails when even 6 of 100 replicas diverge", async () => {
  const report = await runSimulation(plan(), {
    executeReplica: async ({ replica }) => (
      replica < 94 ? { output: "stable" } : { output: `diverged-${replica}` }
    ),
  });
  assert.equal(report.accepted, false);
  assert.equal(report.stable_result, null);
  assert.equal(report.matching_replicas, 94);
  assert.equal(report.divergence_count, 6);
  assert.equal(report.results.length, 100);
  assert.equal(
    report.results.filter((result) => result.result?.output.startsWith("diverged")).length,
    6,
    "no divergent evidence is cut out",
  );
});

test("predeclared stochastic quorum reports stable output and retains 6 outliers", async () => {
  const report = await runSimulation(plan({
    mode: "stochastic",
    minimumMatching: 94,
  }), {
    executeReplica: async ({ replica }) => (
      replica < 94 ? { output: "stable" } : { output: `noise-${replica}` }
    ),
    now: () => new Date("2026-08-22T19:00:00.000Z"),
  });
  assert.equal(report.accepted, true);
  assert.deepEqual(report.stable_result, { output: "stable" });
  assert.equal(report.matching_replicas, 94);
  assert.equal(report.divergence_count, 6);
  assert.equal(report.clusters.reduce((sum, cluster) => sum + cluster.replicas.length, 0), 100);
  assert.match(report.evidence_hash, /^[0-9a-f]{64}$/);
});

test("replica concurrency, errors, and privileged provider flags remain bounded", async () => {
  let active = 0;
  let peak = 0;
  const report = await runSimulation(plan({
    mode: "stochastic",
    minimumMatching: 99,
  }), {
    executeReplica: async ({ replica }) => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 1));
      active -= 1;
      if (replica === 99) throw new Error("synthetic provider error");
      return { output: "stable" };
    },
  });
  assert.equal(peak <= 10, true);
  assert.equal(report.accepted, true);
  assert.equal(report.results[99].status, "error");
  assert.equal(report.results.length, 100);

  const unsafe = plan();
  unsafe.steps[0].args = { hypervisor_flags: "--privileged" };
  assert.throws(
    () => validateSimulationPlan(unsafe),
    /privileged key/,
  );
});
