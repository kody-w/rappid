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
  list.push(path.join(homedir(), "Documents", "GitHub", "aibast-agents-library", "beta"));
  list.push(path.join(homedir(), "aibast-agents-library", "beta"));
  return list;
}

function resolveFrontierDir() {
  for (const dir of candidates()) {
    const manifest = path.join(dir, "package.json");
    if (!existsSync(manifest)) continue;
    try {
      const parsed = JSON.parse(readFileSync(manifest, "utf8"));
      if (parsed.name === FRONTIER_PACKAGE) return dir;
    } catch {
      // An unreadable manifest is not the Frontier app; keep looking.
    }
  }
  return null;
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
const child = spawn("npm", ["start"], {
  cwd: frontierDir,
  stdio: "inherit",
});
child.on("exit", (code) => process.exit(code ?? 0));
