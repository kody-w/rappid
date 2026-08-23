#!/usr/bin/env node

import {
  closeSync,
  constants,
  existsSync,
  fstatSync,
  lstatSync,
  openSync,
  readFileSync,
  readSync,
} from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

import { sendAutopilotCommand } from "../src/autopilot-server.mjs";
import { requestInstanceControl } from "../src/control-server.mjs";
import { parseIJson } from "../src/rapp1.mjs";
import { parseSummonChant } from "../src/summon-chant.mjs";
import {
  MAX_SIMULATION_FIXTURE_BYTES,
  MAX_SIMULATION_PLAN_BYTES,
  runSimulationFixture,
} from "../src/simulation-neighborhood.mjs";
import { buildMachineCommand } from "../src/virtual-computer.mjs";

const packageDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const argv = process.argv.slice(2);

function option(name, fallback = null) {
  const equal = argv.find((item) => item.startsWith(`${name}=`));
  if (equal) return equal.slice(name.length + 1);
  const index = argv.indexOf(name);
  return index === -1 ? fallback : argv[index + 1];
}

function positional() {
  const values = [];
  const optionsWithValues = new Set([
    "--root",
    "--estate-home",
    "--revision",
    "--timeout",
  ]);
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (item.startsWith("--") && item.includes("=")) continue;
    if (optionsWithValues.has(item)) {
      index += 1;
      continue;
    }
    if (item.startsWith("--")) continue;
    values.push(item);
  }
  return values;
}

const [command = "help", ...args] = positional();
const root = path.resolve(
  option("--root", process.env.RAPP_ZOO_ROOT || path.join(homedir(), ".rapp-zoo-v2")),
);
const estateHome = path.resolve(
  option(
    "--estate-home",
    process.env.RAPP_ZOO_ESTATE_HOME || path.join(root, "estates", "primary"),
  ),
);
const autopilotFile = path.join(estateHome, "autopilot.json");
const controlFile = path.join(estateHome, "control.json");
const revisionOption = option("--revision");
const revision = revisionOption === null ? null : Number(revisionOption);
const timeoutMs = Number(option("--timeout", "10000"));

function print(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

async function semantic(name, semanticArgs = {}, semanticRevision = revision) {
  return sendAutopilotCommand(autopilotFile, {
    command: name,
    args: semanticArgs,
    revision: semanticRevision,
    timeoutMs,
  });
}

async function start({ headless }) {
  if (existsSync(autopilotFile)) {
    try {
      return { already_running: true, snapshot: await semantic("snapshot") };
    } catch {
      throw new Error(
        "Autopilot metadata exists but cannot be verified; lifecycle is fail-closed.",
      );
    }
  }
  const electronPath = path.resolve(
    process.env.RAPP_ZOO_ELECTRON
    || path.join(
      packageDir,
      "node_modules",
      ".bin",
      process.platform === "win32" ? "electron.cmd" : "electron",
    ),
  );
  if (!existsSync(electronPath)) {
    throw new Error("Electron runtime is not installed; run npm install first.");
  }
  const child = spawn(electronPath, [
    packageDir,
    `--rapp-zoo-estate-home=${estateHome}`,
    `--user-data-dir=${path.join(estateHome, "electron-user-data")}`,
  ], {
    detached: true,
    stdio: "ignore",
    windowsHide: true,
    env: {
      ...process.env,
      RAPP_ZOO_ROOT: root,
      RAPP_ZOO_ESTATE_HOME: estateHome,
      ...(headless ? { RAPP_ZOO_HEADLESS: "1" } : {}),
    },
  });
  child.unref();
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (existsSync(autopilotFile)) {
      try {
        return {
          started: true,
          snapshot: await semantic("snapshot"),
        };
      } catch {
        // Metadata may appear just before the renderer command bus is ready.
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("RAPP Zoo v2 did not become autopilot-ready before the deadline.");
}

async function summon(chantText) {
  const chant = parseSummonChant(chantText);
  let snapshot = await semantic("snapshot");
  snapshot = await semantic(
    "invoke",
    { control_id: "nav.global" },
    snapshot.revision,
  );
  snapshot = await semantic(
    "input",
    { control_id: "global.url", value: chant.manifest_url },
    snapshot.revision,
  );
  snapshot = await semantic(
    "input",
    { control_id: "global.hash", value: chant.manifest_sha256 },
    snapshot.revision,
  );
  snapshot = await semantic(
    "invoke",
    { control_id: "global.load" },
    snapshot.revision,
  );
  snapshot = await semantic(
    "invoke",
    { control_id: "global.save" },
    snapshot.revision,
  );
  return {
    chant,
    cage: "local-saved-offline-ready",
    object_id: snapshot.app_state.global_object.object_id,
    local_summons: snapshot.app_state.local_summons,
  };
}

async function machineChat(rappid, machine, op, rawArgs = "{}") {
  const args = parseIJson(rawArgs);
  const prompt = buildMachineCommand({
    machine,
    op,
    args,
    idempotencyKey: `cli-${Date.now()}`,
    turnBudget: 1,
  });
  let snapshot = await semantic("snapshot");
  snapshot = await semantic(
    "invoke",
    { control_id: "nav.neighborhoods" },
    snapshot.revision,
  );
  snapshot = await semantic(
    "invoke",
    { control_id: `neighborhood.select.${rappid.slice(-8)}` },
    snapshot.revision,
  );
  snapshot = await semantic(
    "input",
    { control_id: "chat.input", value: prompt },
    snapshot.revision,
  );
  snapshot = await semantic(
    "invoke",
    { control_id: "chat.send" },
    snapshot.revision,
  );
  return {
    machine,
    op,
    resident: rappid,
    transcript: snapshot.app_state.transcripts[rappid] || [],
  };
}

async function workflow(file) {
  const document = parseIJson(readFileSync(path.resolve(file), "utf8"));
  if (!Array.isArray(document)) {
    throw new Error("Autopilot workflow must be a JSON array.");
  }
  let snapshot = await semantic("snapshot");
  const results = [];
  for (const step of document) {
    if (!step || typeof step !== "object" || Array.isArray(step)) {
      throw new Error("Every autopilot workflow step must be an object.");
    }
    const allowed = new Set(["snapshot", "invoke", "input", "wait", "screenshot"]);
    if (!allowed.has(step.command)) {
      throw new Error(`Workflow command ${step.command} is not semantic.`);
    }
    let value;
    if (step.command === "invoke") {
      value = await semantic(
        "invoke",
        { control_id: step.control_id },
        snapshot.revision,
      );
    } else if (step.command === "input") {
      value = await semantic(
        "input",
        { control_id: step.control_id, value: String(step.value) },
        snapshot.revision,
      );
    } else if (step.command === "wait") {
      value = await semantic(
        "wait",
        { milliseconds: step.milliseconds },
        null,
      );
    } else if (step.command === "screenshot") {
      value = await semantic(
        "screenshot",
        { name: step.name },
        snapshot.revision,
      );
    } else {
      value = await semantic("snapshot");
    }
    if (value?.schema === "rapp-zoo-virtual-browser/2.0") {
      snapshot = value;
    } else {
      snapshot = await semantic("snapshot");
    }
    results.push({ step, value });
  }
  return { results, snapshot };
}

function readBoundedLocalFile(file, maximumBytes, label) {
  const resolved = path.resolve(file);
  const entry = lstatSync(resolved);
  if (!entry.isFile() || entry.isSymbolicLink() || entry.size > maximumBytes) {
    throw new Error(`${label} must be a bounded regular file.`);
  }
  const noFollow = constants.O_NOFOLLOW || 0;
  const descriptor = openSync(resolved, constants.O_RDONLY | noFollow);
  try {
    const opened = fstatSync(descriptor);
    if (!opened.isFile() || opened.size > maximumBytes) {
      throw new Error(`${label} must be a bounded regular file.`);
    }
    const bytes = Buffer.allocUnsafe(maximumBytes + 1);
    let total = 0;
    while (total < bytes.length) {
      const count = readSync(
        descriptor,
        bytes,
        total,
        bytes.length - total,
        null,
      );
      if (count === 0) break;
      total += count;
    }
    if (total > maximumBytes) {
      throw new Error(`${label} exceeds its local replay limit.`);
    }
    return new TextDecoder("utf-8", { fatal: true }).decode(
      bytes.subarray(0, total),
    );
  } finally {
    closeSync(descriptor);
  }
}

async function simulate(planFile, fixtureFile) {
  const planSource = readBoundedLocalFile(
    planFile,
    MAX_SIMULATION_PLAN_BYTES,
    "Simulation plan",
  );
  const fixtureSource = readBoundedLocalFile(
    fixtureFile,
    MAX_SIMULATION_FIXTURE_BYTES,
    "Simulation fixture",
  );
  return runSimulationFixture(
    parseIJson(planSource),
    parseIJson(fixtureSource),
  );
}

async function main() {
  if (command === "help") {
    print({
      commands: {
        start: "Launch visible local app",
        headless: "Launch hidden real Electron app",
        stop: "Stop through the instance capability",
        snapshot: "Read the semantic Chromium virtual object",
        invoke: "invoke <control_id> --revision <n>",
        input: "input <control_id> <value> --revision <n>",
        wait: "wait <milliseconds>",
        screenshot: "screenshot <name> --revision <n>",
        run: "run <workflow.json>",
        summon: "summon <rapp-summon://... chant>",
        machine: "machine <resident-rappid> <MACHINE> <op> [args-json]",
        simulate: "simulate <plan.json> <fixture.json>",
      },
      policy: "semantic controls only; no coordinates or arbitrary JavaScript",
    });
    return;
  }
  if (command === "start") return print(await start({ headless: false }));
  if (command === "headless") return print(await start({ headless: true }));
  if (command === "stop") {
    return print({
      stopped: await requestInstanceControl(controlFile, "stop"),
    });
  }
  if (command === "snapshot") return print(await semantic("snapshot"));
  if (command === "invoke") {
    return print(await semantic("invoke", { control_id: args[0] }));
  }
  if (command === "input") {
    return print(await semantic("input", {
      control_id: args[0],
      value: args.slice(1).join(" "),
    }));
  }
  if (command === "wait") {
    return print(await semantic("wait", { milliseconds: Number(args[0]) }));
  }
  if (command === "screenshot") {
    return print(await semantic("screenshot", { name: args[0] }));
  }
  if (command === "run") return print(await workflow(args[0]));
  if (command === "summon") return print(await summon(args[0]));
  if (command === "simulate") return print(await simulate(args[0], args[1]));
  if (command === "machine") {
    return print(await machineChat(args[0], args[1], args[2], args[3] || "{}"));
  }
  throw new Error(`Unknown command ${command}. Run rapp-zoo-v2 help.`);
}

main().catch((error) => {
  process.stderr.write(`rapp-zoo-v2: ${error.message}\n`);
  process.exitCode = 1;
});
