import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { writePrivateJson } from "../src/estate-store.mjs";
import { mintRappid } from "../src/rapp1.mjs";
import { createSummonChant } from "../src/summon-chant.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const directory = path.join(root, "examples", "multi-os-vnet-simulation");
const [command = "source", commit] = process.argv.slice(2);
const sha = (value) => createHash("sha256").update(value).digest("hex");
const pinned = (label) => sha(`rapp-zoo-v2 simulation fixture:${label}`);
const seeds = Array.from(
  { length: 100 },
  (_, replica) => `replica-${String(replica).padStart(3, "0")}`,
);
const topology = {
  nodes: [
    { id: "windows-one", os: "windows", image_sha256: pinned("windows-image"), config_sha256: pinned("windows-config") },
    { id: "macos-one", os: "macos", image_sha256: pinned("macos-image"), config_sha256: pinned("macos-config") },
    { id: "linux-one", os: "linux", image_sha256: pinned("linux-image"), config_sha256: pinned("linux-config") },
    { id: "as400-one", os: "as400-sim", image_sha256: pinned("as400-image"), config_sha256: pinned("as400-config") },
    { id: "generic-one", os: "generic", image_sha256: pinned("generic-image"), config_sha256: pinned("generic-config") },
  ],
  links: [
    { from: "windows-one", to: "linux-one", network: "private-vnet", latency_ms: 2, loss_basis_points: 0 },
    { from: "macos-one", to: "linux-one", network: "private-vnet", latency_ms: 2, loss_basis_points: 0 },
    { from: "linux-one", to: "as400-one", network: "private-vnet", latency_ms: 4, loss_basis_points: 0 },
    { from: "as400-one", to: "generic-one", network: "private-vnet", latency_ms: 3, loss_basis_points: 0 },
  ],
};
const steps = [
  { step: 0, node: "windows-one", operation: "artifact.prepare", args: { artifact: "daily-batch" } },
  { step: 1, node: "macos-one", operation: "artifact.sign", args: { artifact: "daily-batch" } },
  { step: 2, node: "linux-one", operation: "artifact.route", args: { network: "private-vnet" } },
  { step: 3, node: "as400-one", operation: "job.submit", args: { queue: "batch-one" } },
  { step: 4, node: "generic-one", operation: "evidence.seal", args: { receipt: "simulation-proof" } },
];
const plan = (mode) => ({
  schema: "rapp-zoo-simulation/2.0",
  simulation_id: `multi-os-vnet-${mode}`,
  mode,
  replicas: 100,
  max_concurrency: 16,
  replica_timeout_ms: 1000,
  seeds,
  topology,
  steps,
  policy: mode === "deterministic"
    ? { kind: "all-identical" }
    : { kind: "exact-quorum", minimum_matching: 94 },
});
const fixture = Array.from({ length: 100 }, (_, replica) => (
  replica < 94
    ? {
        outcome: "stable",
        completed_steps: 5,
        network: "private-vnet",
        receipt: "SIMULATION_STABLE",
      }
    : {
        outcome: "outlier",
        completed_steps: 5,
        network: "private-vnet",
        receipt: `SIMULATION_NOISE_${replica}`,
      }
));

if (command === "source") {
  writePrivateJson(path.join(directory, "deterministic-plan.json"), plan("deterministic"));
  writePrivateJson(path.join(directory, "stochastic-plan.json"), plan("stochastic"));
  writePrivateJson(path.join(directory, "fixture.json"), fixture);
} else if (command === "manifest") {
  if (!/^[0-9a-f]{40}$/.test(String(commit))) {
    throw new Error("manifest requires the exact source commit");
  }
  const files = {
    "deterministic-plan.json": ["deterministic-plan", "application/json"],
    "stochastic-plan.json": ["stochastic-plan", "application/json"],
    "fixture.json": ["fixture", "application/json"],
    "README.md": ["readme", "text/markdown"],
    "handoff.md": ["handoff", "text/markdown"],
    LICENSE: ["license", "text/plain"],
  };
  const dimensions = Object.entries(files).map(([file, [name, mediaType]]) => {
    const bytes = readFileSync(path.join(directory, file));
    return {
      name,
      url:
        `https://raw.githubusercontent.com/kody-w/rapp-zoo-v2/${commit}/examples/multi-os-vnet-simulation/${file}`,
      sha256: sha(bytes),
      bytes: bytes.length,
      media_type: mediaType,
    };
  }).sort((left, right) => left.name.localeCompare(right.name));
  writePrivateJson(path.join(directory, "manifest.json"), {
    schema: "rapp-zoo-global-object/2.0",
    name: "Multi-OS Private vNet Simulation",
    source_rappid: mintRappid("kody-w", "multi-os-vnet-simulation", {
      uuid: "00000000-0000-4000-8000-000000000100",
    }),
    created_utc: "2026-08-22T23:15:00.000Z",
    dimensions,
  });
} else if (command === "chant") {
  if (!/^[0-9a-f]{40}$/.test(String(commit))) {
    throw new Error("chant requires the exact manifest commit");
  }
  const manifestFile = path.join(directory, "manifest.json");
  const manifest = readFileSync(manifestFile);
  const manifestSha256 = sha(manifest);
  const manifestUrl =
    `https://raw.githubusercontent.com/kody-w/rapp-zoo-v2/${commit}/examples/multi-os-vnet-simulation/manifest.json`;
  writePrivateJson(path.join(directory, "chant.json"), {
    schema: "rapp-zoo-summon-chant/2.0",
    chant: createSummonChant({ manifestUrl, manifestSha256 }),
    manifest_url: manifestUrl,
    manifest_sha256: manifestSha256,
  });
} else {
  throw new Error("Usage: build-simulation-example.mjs source|manifest|chant [commit]");
}
