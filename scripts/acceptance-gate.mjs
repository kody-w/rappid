import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const results = [];

function requireGate(name, pass, detail = "") {
  results.push({ name, pass: Boolean(pass), detail });
  console.log(`${pass ? " PASS" : "*FAIL"}  ${name}${detail ? ` - ${detail}` : ""}`);
}

function run(name, command, args) {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, NO_COLOR: "1" },
  });
  const output = `${result.stdout || ""}${result.stderr || ""}`;
  const noSkips = !/(?:# SKIP|skipped [1-9])/i.test(output);
  requireGate(name, result.status === 0 && noSkips, output.trim().split("\n").at(-1));
}

function filesBelow(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const candidate = path.join(directory, entry.name);
    return entry.isDirectory() ? filesBelow(candidate) : [candidate];
  });
}

for (const required of [
  "src/contracts.mjs",
  "src/rapp1.mjs",
  "src/estate-store.mjs",
  "src/keyed-queue.mjs",
  "src/conversation-store.mjs",
  "src/chat-client.mjs",
  "src/catalog-client.mjs",
  "src/control-server.mjs",
  "src/child-estates.mjs",
  "src/global-object.mjs",
  "src/local-drill.mjs",
  "src/summon-library.mjs",
  "src/summon-chant.mjs",
  "src/virtual-computer.mjs",
  "src/simulation-neighborhood.mjs",
  "src/prototype-handoff.mjs",
  "src/prototype-transfer.mjs",
  "src/monorepo-companion.mjs",
  "src/reporting.mjs",
  "src/autopilot-server.mjs",
  "src/main.mjs",
  "src/preload.cjs",
  "ui/index.html",
  "ui/app.js",
  "ui/style.css",
  "bin/rapp-zoo-v2.mjs",
]) {
  const file = path.join(root, required);
  requireGate(`ships ${required}`, statSync(file, { throwIfNoEntry: false })?.isFile());
}

const productionFiles = [
  ...filesBelow(path.join(root, "src")),
  ...filesBelow(path.join(root, "ui")),
].filter((file) => /\.(?:c?js|mjs|html|css)$/.test(file));
const productCoupling = productionFiles.flatMap((file) => {
  const text = readFileSync(file, "utf8");
  return /openrappter|brainstem/i.test(text) ? [path.relative(root, file)] : [];
});
requireGate(
  "production runtime is provider-neutral",
  productCoupling.length === 0,
  productCoupling.join(", "),
);

run("syntax gate", process.execPath, ["--run", "check"]);
run("RAPP/1 authority gate", process.execPath, ["scripts/rapp1-conformance.mjs"]);
run("MIT and dependency license gate", process.execPath, ["scripts/license-gate.mjs"]);
run("unit and integration tests", process.execPath, ["--run", "test:unit"]);
run("real Electron proof", process.execPath, ["--run", "test:e2e"]);
run("mutation gate", process.execPath, ["scripts/mutation-gate.mjs"]);

const failed = results.filter((entry) => !entry.pass);
console.log(`\n${failed.length ? "NOT READY" : "READY"} - ${results.length - failed.length}/${results.length} gates pass`);
process.exit(failed.length ? 1 : 0);
