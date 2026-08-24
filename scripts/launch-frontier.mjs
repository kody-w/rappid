#!/usr/bin/env node
// Launches the base Electron application for this estate: the RAPP Brainstem
// Frontier app (kody-w/aibast-agents-library, beta/). Frontier code never
// lives in this repository — this script only locates an existing checkout
// and starts it. The in-repo Zoo estate remains available via `npm run start:zoo`.
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

const FRONTIER_PACKAGE = "@aibast/rapp-brainstem-frontier";
const FRONTIER_REPO = "https://github.com/kody-w/aibast-agents-library";

function candidates() {
  const list = [];
  if (process.env.FRONTIER_APP_DIR) list.push(process.env.FRONTIER_APP_DIR);
  list.push(path.join(homedir(), "Documents", "GitHub", "aibast-agents-library-rappid-first", "beta"));
  list.push(path.join(homedir(), "Documents", "GitHub", "aibast-agents-library", "beta"));
  list.push(path.join(homedir(), "aibast-agents-library", "beta"));
  return list;
}

function isFrontier(dir) {
  try {
    return JSON.parse(readFileSync(path.join(dir, "package.json"), "utf8")).name
      === FRONTIER_PACKAGE;
  } catch {
    return false;   // an unreadable manifest is not the Frontier app
  }
}

function isRappidCapable(dir) {
  return existsSync(path.join(dir, "electron", "rappid-species.mjs"));
}

function resolveFrontierDir() {
  const frontiers = candidates().filter(isFrontier);
  // Prefer a checkout that carries the rappid integration — this repo's whole
  // point — over a plain Frontier; fall back so the app still launches.
  return frontiers.find(isRappidCapable) || frontiers[0] || null;
}

const frontierDir = resolveFrontierDir();
if (!frontierDir) {
  console.error(
    `Could not find the Frontier base app (${FRONTIER_PACKAGE}).\n`
    + `Clone ${FRONTIER_REPO} and point FRONTIER_APP_DIR at its beta/ directory,\n`
    + "or fall back to the in-repo reference estate: npm run start:zoo",
  );
  process.exit(1);
}

console.log(`Launching Frontier base app from ${frontierDir}`);
if (!isRappidCapable(frontierDir)) {
  console.warn(
    "Note: this Frontier checkout has no rappid integration (electron/rappid-species.mjs missing) — "
    + "citizens will not hatch as rappids. Point FRONTIER_APP_DIR at a rappid-capable checkout.",
  );
}
const child = spawn("npm", ["start"], {
  cwd: frontierDir,
  stdio: "inherit",
});
child.on("exit", (code) => process.exit(code ?? 0));
