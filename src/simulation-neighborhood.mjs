import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  openSync,
  readSync,
} from "node:fs";
import { fileURLToPath } from "node:url";

import { canonical } from "./rapp1.mjs";
import { assertUnprivilegedMachineValue } from "./virtual-computer.mjs";

export const SIMULATION_SCHEMA = "rapp-zoo-simulation/2.0";
export const SIMULATION_REPORT_SCHEMA = "rapp-zoo-simulation-report/2.0";
export const MAX_SIMULATION_PLAN_BYTES = 256 * 1024;
export const MAX_SIMULATION_FIXTURE_BYTES = 128 * 1024;
export const MAX_SIMULATION_RESULTS_BYTES = 512 * 1024;
const ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SHA256 = /^[0-9a-f]{64}$/;
const OS = new Set(["windows", "macos", "linux", "as400-sim", "generic"]);
const MAX_REPLICAS = 256;
const MAX_RESULT_BYTES = 64 * 1024;
const TRUSTED_PROVIDER = "fully-trusted-local-code";
const MAX_PROVIDER_STDOUT_BYTES = 96 * 1024;
const MAX_PROVIDER_STDERR_BYTES = 8 * 1024;

function digest(value) {
  return createHash("sha256").update(canonical(value), "utf8").digest("hex");
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
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
    || plan.seeds.some((seed) => (
      typeof seed !== "string"
      || !seed
      || Buffer.byteLength(seed, "utf8") > 256
    ))
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
  const encoded = canonical(plan);
  if (Buffer.byteLength(encoded, "utf8") > MAX_SIMULATION_PLAN_BYTES) {
    throw new Error("Simulation plan exceeds 256 KiB.");
  }
  return plan;
}

function normalizeProvider(provider) {
  if (
    !provider
    || typeof provider !== "object"
    || Array.isArray(provider)
    || typeof provider.module_url !== "string"
    || typeof provider.export_name !== "string"
    || !/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(provider.export_name)
    || provider.trust !== TRUSTED_PROVIDER
  ) {
    throw new Error(
      "Simulation provider must be declared fully-trusted local code with a module URL and export.",
    );
  }
  const moduleUrl = new URL(provider.module_url);
  if (moduleUrl.protocol !== "file:") {
    throw new Error("Simulation provider module must be a local file URL.");
  }
  const moduleFile = fileURLToPath(moduleUrl);
  const stat = lstatSync(moduleFile);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 64 * 1024) {
    throw new Error("Simulation provider module must be a bounded regular file.");
  }
  const descriptor = openSync(
    moduleFile,
    constants.O_RDONLY | (constants.O_NOFOLLOW || 0),
  );
  let moduleBytes;
  try {
    const opened = fstatSync(descriptor);
    if (!opened.isFile() || opened.size > 64 * 1024) {
      throw new Error("Simulation provider module must be a bounded regular file.");
    }
    const buffer = Buffer.allocUnsafe((64 * 1024) + 1);
    let total = 0;
    while (total < buffer.length) {
      const count = readSync(
        descriptor,
        buffer,
        total,
        buffer.length - total,
        null,
      );
      if (count === 0) break;
      total += count;
    }
    if (total > 64 * 1024) {
      throw new Error("Simulation provider module must be a bounded regular file.");
    }
    moduleBytes = buffer.subarray(0, total);
  } finally {
    closeSync(descriptor);
  }
  const moduleSource = new TextDecoder("utf-8", { fatal: true }).decode(
    moduleBytes,
  );
  assertUnprivilegedMachineValue(provider.data ?? null);
  const encoded = canonical(provider.data ?? null);
  if (Buffer.byteLength(encoded, "utf8") > MAX_SIMULATION_FIXTURE_BYTES) {
    throw new Error("Simulation provider data exceeds 128 KiB.");
  }
  return {
    module_url: moduleUrl.href,
    module_source: moduleSource,
    export_name: provider.export_name,
    data: deepFreeze(JSON.parse(encoded)),
    identity: {
      trust: TRUSTED_PROVIDER,
      module_sha256: createHash("sha256")
        .update(moduleBytes)
        .digest("hex"),
      export_name: provider.export_name,
      data_sha256: createHash("sha256").update(encoded, "utf8").digest("hex"),
    },
  };
}

function terminateProvider(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  if (process.platform === "win32") {
    const killer = spawn("taskkill.exe", [
      "/PID",
      String(child.pid),
      "/T",
      "/F",
    ], {
      stdio: "ignore",
      windowsHide: true,
    });
    killer.once("error", () => child.kill("SIGKILL"));
    return;
  }
  try {
    process.kill(-child.pid, "SIGKILL");
  } catch {
    child.kill("SIGKILL");
  }
}

async function oneReplica(plan, replica, provider) {
  const started = performance.now();
  const child = spawn(process.execPath, [
    "--permission",
    `--allow-fs-read=${
      fileURLToPath(new URL("../", import.meta.url))
    }`,
    "--max-old-space-size=32",
    "--max-semi-space-size=4",
    fileURLToPath(new URL("./simulation-provider-process.mjs", import.meta.url)),
    provider.export_name,
  ], {
    env: {
      NODE_NO_WARNINGS: "1",
      PATH: process.env.PATH || "",
      SYSTEMROOT: process.env.SYSTEMROOT || "",
      TEMP: process.env.TEMP || "",
      TMP: process.env.TMP || "",
      TMPDIR: process.env.TMPDIR || "",
    },
    detached: process.platform !== "win32",
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
  });
  let settled = false;
  let timer;
  let forceTimer;
  let timedOut = false;
  let overflow = null;
  let stdoutBytes = 0;
  let stderrBytes = 0;
  const stdout = [];
  const stderr = [];
  try {
    const completion = new Promise((resolve) => {
      const finish = (value = {}) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        clearTimeout(forceTimer);
        resolve(value);
      };
      const terminateWithDeadline = () => {
        terminateProvider(child);
        if (forceTimer) return;
        forceTimer = setTimeout(() => {
          child.stdin.destroy();
          child.stdout.destroy();
          child.stderr.destroy();
          finish({ forced: true });
        }, 1000);
      };
      child.stdout.on("data", (chunk) => {
        stdoutBytes += chunk.length;
        if (stdoutBytes > MAX_PROVIDER_STDOUT_BYTES) {
          overflow = "simulation provider output exceeded 96 KiB";
          terminateWithDeadline();
          return;
        }
        stdout.push(chunk);
      });
      child.stderr.on("data", (chunk) => {
        stderrBytes += chunk.length;
        if (stderrBytes > MAX_PROVIDER_STDERR_BYTES) {
          overflow = "simulation provider error output exceeded 8 KiB";
          terminateWithDeadline();
          return;
        }
        stderr.push(chunk);
      });
      child.stdin.once("error", (error) => finish({ error }));
      child.once("error", (error) => finish({ error }));
      child.once("close", (code, signal) => finish({ code, signal }));
      timer = setTimeout(
        () => {
          timedOut = true;
          terminateWithDeadline();
        },
        plan.replica_timeout_ms,
      );
      timer.unref?.();
    });
    child.stdin.end(JSON.stringify({
      replica,
      seed: plan.seeds[replica],
      plan,
      provider_data: provider.data,
      provider_source: provider.module_source,
    }));
    const completed = await completion;
    if (timedOut) throw new Error("simulation replica timed out");
    if (overflow) throw new Error(overflow);
    if (completed.error) throw completed.error;
    if (completed.code !== 0) {
      const detail = Buffer.concat(stderr).toString("utf8").trim();
      throw new Error(detail || `simulation provider exited with code ${completed.code}`);
    }
    const decoded = new TextDecoder("utf-8", { fatal: true }).decode(
      Buffer.concat(stdout),
    );
    const outcome = JSON.parse(decoded);
    if (
      !outcome
      || typeof outcome !== "object"
      || Array.isArray(outcome)
      || outcome.ok !== true
      || typeof outcome.encoded !== "string"
      || Object.keys(outcome).some((key) => !["ok", "encoded"].includes(key))
      || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
        outcome.encoded,
      )
    ) {
      throw new Error("simulation provider returned an invalid response envelope");
    }
    const encodedBytes = Buffer.from(outcome.encoded, "base64");
    if (encodedBytes.length > MAX_RESULT_BYTES) {
      throw new Error("simulation result exceeds 64 KiB");
    }
    const encoded = new TextDecoder("utf-8", { fatal: true }).decode(encodedBytes);
    const value = JSON.parse(encoded);
    assertUnprivilegedMachineValue(value);
    if (canonical(value) !== encoded) {
      throw new Error("simulation provider result is not canonical JSON");
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
    terminateProvider(child);
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
    clearTimeout(forceTimer);
  }
}

export async function runSimulation(plan, {
  provider: providerValue,
  now = () => new Date(),
} = {}) {
  validateSimulationPlan(plan);
  plan = deepFreeze(JSON.parse(canonical(plan)));
  const provider = normalizeProvider(providerValue);
  const results = Array(plan.replicas);
  let next = 0;
  let active = 0;
  let peakConcurrency = 0;
  const workers = Array.from(
    { length: Math.min(plan.max_concurrency, plan.replicas) },
    async () => {
      while (true) {
        const replica = next;
        next += 1;
        if (replica >= plan.replicas) return;
        active += 1;
        peakConcurrency = Math.max(peakConcurrency, active);
        try {
          results[replica] = await oneReplica(
            plan,
            replica,
            provider,
          );
        } finally {
          active -= 1;
        }
      }
    },
  );
  await Promise.all(workers);

  let encodedResults;
  try {
    encodedResults = canonical(results);
  } catch (error) {
    if (/exceeds 1048576 bytes/.test(String(error?.message || error))) {
      throw new Error("Simulation results exceed the 512 KiB aggregate budget.");
    }
    throw error;
  }
  if (Buffer.byteLength(encodedResults, "utf8") > MAX_SIMULATION_RESULTS_BYTES) {
    throw new Error("Simulation results exceed the 512 KiB aggregate budget.");
  }

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
    peak_concurrency: peakConcurrency,
    provider: provider.identity,
    clusters: ordered.map(({ result: _result, ...cluster }) => cluster),
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

export async function runSimulationFixture(plan, fixture, options = {}) {
  validateSimulationPlan(plan);
  if (!Array.isArray(fixture) || fixture.length !== plan.replicas) {
    throw new Error("Simulation fixture must contain exactly one result per replica.");
  }
  const encoded = canonical(fixture);
  if (Buffer.byteLength(encoded, "utf8") > MAX_SIMULATION_FIXTURE_BYTES) {
    throw new Error("Simulation fixture exceeds 128 KiB.");
  }
  return runSimulation(plan, {
    ...options,
    provider: {
      module_url: new URL("./simulation-fixture-provider.mjs", import.meta.url).href,
      export_name: "executeReplica",
      trust: TRUSTED_PROVIDER,
      data: fixture,
    },
  });
}
