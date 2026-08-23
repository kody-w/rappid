import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";

import {
  runSimulation,
  runSimulationFixture,
  validateSimulationPlan,
} from "../src/simulation-neighborhood.mjs";

const providerModule = new URL(
  "./fixtures/simulation-provider.mjs",
  import.meta.url,
).href;
const provider = (data) => ({
  module_url: providerModule,
  export_name: "executeReplica",
  trust: "fully-trusted-local-code",
  data,
});

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
    provider: provider({ mode: "pattern-94", outlier_prefix: "diverged" }),
  });
  assert.equal(report.accepted, false);
  assert.equal(report.stable_result, null);
  assert.equal(report.matching_replicas, 94);
  assert.equal(report.divergence_count, 6);
  assert.equal(report.results.length, 100);
  assert.equal(report.provider.trust, "fully-trusted-local-code");
  assert.match(report.provider.module_sha256, /^[0-9a-f]{64}$/);
  assert.match(report.provider.data_sha256, /^[0-9a-f]{64}$/);
  assert.equal(
    report.results.filter((result) => result.result?.output.startsWith("diverged")).length,
    6,
    "no divergent evidence is cut out",
  );
});

test("live provider modules require an explicit full-trust declaration", async () => {
  const untrusted = provider({ mode: "pattern-94", outlier_prefix: "noise" });
  delete untrusted.trust;
  await assert.rejects(
    runSimulation(plan(), { provider: untrusted }),
    /fully-trusted local code/,
  );
});

test("predeclared stochastic quorum reports stable output and retains 6 outliers", async () => {
  const report = await runSimulation(plan({
    mode: "stochastic",
    minimumMatching: 94,
  }), {
    provider: provider({ mode: "pattern-94", outlier_prefix: "noise" }),
    now: () => new Date("2026-08-22T19:00:00.000Z"),
  });

  assert.equal(report.accepted, true);
  assert.deepEqual(report.stable_result, { output: "stable" });
  assert.equal(report.matching_replicas, 94);
  assert.equal(report.divergence_count, 6);
  assert.equal(report.clusters.reduce((sum, cluster) => sum + cluster.replicas.length, 0), 100);
  assert.match(report.evidence_hash, /^[0-9a-f]{64}$/);
});

test("fixture replay uses every declared result without loading code", async () => {
  const simulation = plan({ mode: "stochastic", minimumMatching: 94 });
  const fixture = Array.from({ length: 100 }, (_, replica) => (
    replica < 94 ? { output: "stable" } : { output: `noise-${replica}` }
  ));
  const report = await runSimulationFixture(simulation, fixture, {
    now: () => new Date("2026-08-22T20:00:00.000Z"),
  });
  assert.equal(report.accepted, true);
  assert.equal(report.matching_replicas, 94);
  assert.equal(report.results.length, 100);
  await assert.rejects(
    runSimulationFixture(simulation, fixture.slice(1)),
    /exactly one result per replica/,
  );
  await assert.rejects(
    runSimulationFixture(
      simulation,
      Array.from({ length: 100 }, (_, replica) => ({
        replica,
        output: "x".repeat(3000),
      })),
    ),
    /128 KiB/,
  );
});

test("aggregate result evidence stays inside the report budget", async () => {
  await assert.rejects(
    runSimulation(plan(), {
      provider: provider({ mode: "aggregate-overflow" }),
    }),
    /512 KiB aggregate budget/,
  );
});

test("providers cannot rewrite the predeclared acceptance policy", async () => {
  const simulation = plan({ mode: "stochastic", minimumMatching: 3 });
  simulation.replicas = 3;
  simulation.seeds = simulation.seeds.slice(0, 3);
  simulation.max_concurrency = 2;
  const report = await runSimulation(simulation, {
    provider: provider({ mode: "mutate-plan" }),
  });
  assert.equal(simulation.policy.minimum_matching, 3);
  assert.equal(report.accepted, false);
  assert.equal(report.matching_replicas, 2);
  assert.equal(
    report.results.every((result) => (
      result.result?.observed_minimum === 3
      && result.result?.mutation_blocked === true
    )),
    true,
  );
});

test("never-settling providers are terminated at the timeout boundary", async () => {
  const simulation = plan({ mode: "stochastic", minimumMatching: 2 });
  simulation.replicas = 10;
  simulation.seeds = simulation.seeds.slice(0, 10);
  simulation.max_concurrency = 2;
  simulation.replica_timeout_ms = 10;
  const started = Date.now();
  const report = await runSimulation(simulation, {
    provider: provider({ mode: "never" }),
  });
  assert.ok(Date.now() - started < 3000);
  assert.equal(report.peak_concurrency, 2);
  assert.equal(report.results.every((result) => result.status === "error"), true);
  assert.equal(
    report.results.every((result) => result.error === "simulation replica timed out"),
    true,
  );
});

test("timeout during a large request write remains a replica error", async () => {
  const simulation = plan({ mode: "stochastic", minimumMatching: 2 });
  simulation.replicas = 2;
  simulation.seeds = simulation.seeds.slice(0, 2);
  simulation.max_concurrency = 1;
  simulation.replica_timeout_ms = 10;
  simulation.steps = Array.from({ length: 1000 }, (_, step) => ({
    step,
    node: "linux-server",
    operation: "service.process",
    args: { request: `synthetic-${step}-${"x".repeat(100)}` },
  }));
  const report = await runSimulation(simulation, {
    provider: provider({
      mode: "never",
      padding: "x".repeat(120_000),
    }),
  });
  assert.equal(report.results.every((result) => result.status === "error"), true);
  assert.equal(
    report.results.every((result) => result.error === "simulation replica timed out"),
    true,
  );
});

test("providers cannot trap the timeout termination signal", async () => {
  const simulation = plan({ mode: "stochastic", minimumMatching: 2 });
  simulation.replicas = 2;
  simulation.seeds = simulation.seeds.slice(0, 2);
  simulation.max_concurrency = 1;
  simulation.replica_timeout_ms = 10;
  const started = Date.now();
  const report = await runSimulation(simulation, {
    provider: provider({ mode: "ignore-term" }),
  });
  assert.ok(Date.now() - started < 3000);
  assert.equal(report.results.every((result) => result.status === "error"), true);
  assert.equal(
    report.results.every((result) => result.error === "simulation replica timed out"),
    true,
  );
});

test("provider child-process creation is denied by the runtime boundary", async () => {
  const simulation = plan({ mode: "stochastic", minimumMatching: 2 });
  simulation.replicas = 2;
  simulation.seeds = simulation.seeds.slice(0, 2);
  simulation.max_concurrency = 1;
  simulation.replica_timeout_ms = 50;
  const started = Date.now();
  const report = await runSimulation(simulation, {
    provider: provider({ mode: "descendant" }),
  });
  assert.ok(Date.now() - started < 3000);
  assert.equal(report.results.every((result) => result.status === "error"), true);
  assert.match(
    report.results.map((result) => result.error).join(" "),
    /permission|access denied|ERR_ACCESS_DENIED/i,
  );
});

test("detached provider descendants are denied before they can escape", async () => {
  const simulation = plan({ mode: "stochastic", minimumMatching: 2 });
  simulation.replicas = 2;
  simulation.seeds = simulation.seeds.slice(0, 2);
  simulation.max_concurrency = 1;
  simulation.replica_timeout_ms = 50;
  const started = Date.now();
  const report = await runSimulation(simulation, {
    provider: provider({ mode: "detached-descendant" }),
  });
  assert.ok(Date.now() - started < 3000);
  assert.equal(report.results.every((result) => result.status === "error"), true);
  assert.match(
    report.results.map((result) => result.error).join(" "),
    /permission|access denied|ERR_ACCESS_DENIED/i,
  );
});

test("provider data is snapshotted before replicas start", async () => {
  const simulation = plan({ mode: "stochastic", minimumMatching: 6 });
  simulation.replicas = 6;
  simulation.seeds = simulation.seeds.slice(0, 6);
  simulation.max_concurrency = 1;
  const fixture = Array.from({ length: 6 }, () => ({ output: "original" }));
  const running = runSimulationFixture(simulation, fixture);
  fixture.forEach((entry) => {
    entry.output = "mutated";
  });
  const report = await running;
  assert.equal(
    report.results.every((result) => result.result?.output === "original"),
    true,
  );
});

test("provider module bytes are snapshotted before replicas start", async (t) => {
  const directory = mkdtempSync(path.join(tmpdir(), "zoo-provider-snapshot-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const moduleFile = path.join(directory, "provider.mjs");
  const original = `export async function executeReplica() {
  await new Promise((resolve) => setTimeout(resolve, 20));
  return { output: "original" };
}
`;
  writeFileSync(moduleFile, original);
  const simulation = plan({ mode: "stochastic", minimumMatching: 4 });
  simulation.replicas = 4;
  simulation.seeds = simulation.seeds.slice(0, 4);
  simulation.max_concurrency = 1;
  const running = runSimulation(simulation, {
    provider: {
      module_url: pathToFileURL(moduleFile).href,
      export_name: "executeReplica",
      trust: "fully-trusted-local-code",
      data: null,
    },
  });
  writeFileSync(
    moduleFile,
    "export async function executeReplica(){return {output:'mutated'}}\n",
  );
  const report = await running;
  assert.equal(
    report.results.every((result) => result.result?.output === "original"),
    true,
  );
  assert.equal(
    report.provider.module_sha256,
    createHash("sha256").update(original).digest("hex"),
  );
});

test("oversized provider output is rejected inside the worker", async () => {
  const simulation = plan({ mode: "stochastic", minimumMatching: 2 });
  simulation.replicas = 2;
  simulation.seeds = simulation.seeds.slice(0, 2);
  simulation.max_concurrency = 1;
  const report = await runSimulation(simulation, {
    provider: provider({ mode: "oversized" }),
  });
  assert.equal(report.results.every((result) => result.status === "error"), true);
  assert.match(
    report.results.map((result) => result.error).join(" "),
    /64 KiB|heap|memory|exceeds/i,
  );
});

test("provider stdout cannot bypass the parent byte limit", async () => {
  const simulation = plan({ mode: "stochastic", minimumMatching: 2 });
  simulation.replicas = 2;
  simulation.seeds = simulation.seeds.slice(0, 2);
  simulation.max_concurrency = 1;
  const report = await runSimulation(simulation, {
    provider: provider({ mode: "stdout-overflow" }),
  });
  assert.equal(report.results.every((result) => result.status === "error"), true);
  assert.match(
    report.results.map((result) => result.error).join(" "),
    /output exceeded 96 KiB|Unexpected token|invalid JSON/,
  );
});

test("replica concurrency, errors, and privileged provider flags remain bounded", async () => {
  const report = await runSimulation(plan({
    mode: "stochastic",
    minimumMatching: 99,
  }), {
    provider: provider({ mode: "stable-with-error", error_replica: 99 }),
  });
  assert.equal(report.peak_concurrency <= 10, true);
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
