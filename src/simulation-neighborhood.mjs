import { createHash } from "node:crypto";

import { canonical } from "./rapp1.mjs";
import { assertUnprivilegedMachineValue } from "./virtual-computer.mjs";

export const SIMULATION_SCHEMA = "rapp-zoo-simulation/2.0";
export const SIMULATION_REPORT_SCHEMA = "rapp-zoo-simulation-report/2.0";
const ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SHA256 = /^[0-9a-f]{64}$/;
const OS = new Set(["windows", "macos", "linux", "as400-sim", "generic"]);
const MAX_REPLICAS = 256;
const MAX_RESULT_BYTES = 64 * 1024;

function digest(value) {
  return createHash("sha256").update(canonical(value), "utf8").digest("hex");
}

export function validateSimulationPlan(plan) {
  if (
    !plan
    || typeof plan !== "object"
    || Array.isArray(plan)
    || plan.schema !== SIMULATION_SCHEMA
    || typeof plan.simulation_id !== "string"
    || !ID.test(plan.simulation_id)
    || !["deterministic", "stochastic"].includes(plan.mode)
    || !Number.isSafeInteger(plan.replicas)
    || plan.replicas < 2
    || plan.replicas > MAX_REPLICAS
    || !Number.isSafeInteger(plan.max_concurrency)
    || plan.max_concurrency < 1
    || plan.max_concurrency > 32
    || !Number.isSafeInteger(plan.replica_timeout_ms)
    || plan.replica_timeout_ms < 10
    || plan.replica_timeout_ms > 60_000
    || !Array.isArray(plan.seeds)
    || plan.seeds.length !== plan.replicas
    || new Set(plan.seeds).size !== plan.seeds.length
    || !plan.topology
    || !Array.isArray(plan.topology.nodes)
    || plan.topology.nodes.length < 1
    || plan.topology.nodes.length > 128
    || !Array.isArray(plan.topology.links)
    || !Array.isArray(plan.steps)
    || plan.steps.length < 1
    || plan.steps.length > 1000
    || !plan.policy
    || typeof plan.policy !== "object"
  ) {
    throw new Error("Simulation plan is invalid or outside bounded limits.");
  }
  const nodes = new Set();
  for (const node of plan.topology.nodes) {
    if (
      !node
      || typeof node !== "object"
      || !ID.test(String(node.id))
      || nodes.has(node.id)
      || !OS.has(node.os)
      || !SHA256.test(String(node.image_sha256))
      || !SHA256.test(String(node.config_sha256))
    ) {
      throw new Error("Simulation node identity or image/config pin is invalid.");
    }
    assertUnprivilegedMachineValue(node);
    nodes.add(node.id);
  }
  for (const link of plan.topology.links) {
    if (
      !nodes.has(link?.from)
      || !nodes.has(link?.to)
      || link.from === link.to
      || !ID.test(String(link.network))
      || !Number.isSafeInteger(link.latency_ms)
      || link.latency_ms < 0
      || link.latency_ms > 60_000
      || !Number.isSafeInteger(link.loss_basis_points)
      || link.loss_basis_points < 0
      || link.loss_basis_points > 10_000
    ) {
      throw new Error("Simulation vNet link is invalid.");
    }
    assertUnprivilegedMachineValue(link);
  }
  for (const step of plan.steps) {
    if (
      !Number.isSafeInteger(step?.step)
      || step.step < 0
      || !nodes.has(step.node)
      || !ID.test(String(step.operation).replaceAll(".", "-"))
      || !step.args
      || typeof step.args !== "object"
      || Array.isArray(step.args)
    ) {
      throw new Error("Simulation step is invalid.");
    }
    assertUnprivilegedMachineValue(step.args);
  }
  if (plan.mode === "deterministic") {
    if (
      plan.policy.kind !== "all-identical"
      || Object.keys(plan.policy).length !== 1
    ) {
      throw new Error("Deterministic simulation policy must require all-identical.");
    }
  } else if (
    plan.policy.kind !== "exact-quorum"
    || !Number.isSafeInteger(plan.policy.minimum_matching)
    || plan.policy.minimum_matching < 2
    || plan.policy.minimum_matching > plan.replicas
  ) {
    throw new Error("Stochastic simulation requires a bounded exact quorum.");
  }
  canonical(plan);
  return plan;
}

async function oneReplica(plan, replica, executeReplica) {
  const controller = new AbortController();
  const started = performance.now();
  const timer = setTimeout(
    () => controller.abort(new Error("simulation replica timed out")),
    plan.replica_timeout_ms,
  );
  timer.unref?.();
  try {
    const value = await Promise.race([
      executeReplica({
        replica,
        seed: plan.seeds[replica],
        plan,
        signal: controller.signal,
      }),
      new Promise((_, reject) => {
        controller.signal.addEventListener(
          "abort",
          () => reject(controller.signal.reason),
          { once: true },
        );
      }),
    ]);
    assertUnprivilegedMachineValue(value);
    const encoded = canonical(value);
    if (Buffer.byteLength(encoded, "utf8") > MAX_RESULT_BYTES) {
      throw new Error("simulation result exceeds 64 KiB");
    }
    return {
      replica,
      seed: plan.seeds[replica],
      status: "ok",
      result: value,
      result_hash: digest(value),
      duration_ms: Math.round((performance.now() - started) * 1000) / 1000,
    };
  } catch (error) {
    return {
      replica,
      seed: plan.seeds[replica],
      status: "error",
      error: String(error?.message || error).slice(0, 1000),
      result: null,
      result_hash: null,
      duration_ms: Math.round((performance.now() - started) * 1000) / 1000,
    };
  } finally {
    clearTimeout(timer);
  }
}

export async function runSimulation(plan, {
  executeReplica,
  now = () => new Date(),
} = {}) {
  validateSimulationPlan(plan);
  if (typeof executeReplica !== "function") {
    throw new Error("Simulation runner requires a replica provider.");
  }
  const results = Array(plan.replicas);
  let next = 0;
  const workers = Array.from(
    { length: Math.min(plan.max_concurrency, plan.replicas) },
    async () => {
      while (true) {
        const replica = next;
        next += 1;
        if (replica >= plan.replicas) return;
        results[replica] = await oneReplica(plan, replica, executeReplica);
      }
    },
  );
  await Promise.all(workers);

  const clusters = new Map();
  for (const result of results) {
    const key = result.status === "ok"
      ? `ok:${result.result_hash}`
      : `error:${result.error}`;
    const cluster = clusters.get(key) || {
      key,
      status: result.status,
      result_hash: result.result_hash,
      result: result.result,
      replicas: [],
    };
    cluster.replicas.push(result.replica);
    clusters.set(key, cluster);
  }
  const ordered = [...clusters.values()].sort((left, right) => (
    right.replicas.length - left.replicas.length
    || left.key.localeCompare(right.key)
  ));
  const leader = ordered[0];
  const tied = ordered[1]?.replicas.length === leader.replicas.length;
  const accepted = !tied
    && leader.status === "ok"
    && (
      plan.mode === "deterministic"
        ? leader.replicas.length === plan.replicas
        : leader.replicas.length >= plan.policy.minimum_matching
    );
  const report = {
    schema: SIMULATION_REPORT_SCHEMA,
    simulation_id: plan.simulation_id,
    plan_hash: digest(plan),
    mode: plan.mode,
    replicas: plan.replicas,
    accepted,
    stable_result: accepted ? leader.result : null,
    stable_result_hash: accepted ? leader.result_hash : null,
    matching_replicas: leader.status === "ok" ? leader.replicas.length : 0,
    divergence_count: plan.replicas - (
      leader.status === "ok" ? leader.replicas.length : 0
    ),
    clusters: ordered,
    results,
    generated_utc: now().toISOString(),
    evidence_hash: null,
  };
  report.evidence_hash = digest({
    ...report,
    evidence_hash: null,
  });
  return report;
}
