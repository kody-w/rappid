import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  sendAutopilotCommand,
} from "../../src/autopilot-server.mjs";
import {
  requestInstanceControl,
} from "../../src/control-server.mjs";

const require = createRequire(import.meta.url);
const electronPath = require("electron");
const projectRoot = path.resolve(import.meta.dirname, "../..");
const RAPPID = `rappid:@kody-w/autopilot-fixture:${"a".repeat(64)}`;

async function waitFor(predicate, label, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      const value = await predicate();
      if (value) return value;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for ${label}: ${lastError?.message || "not ready"}`);
}

async function fixtureServer(t) {
  const requests = [];
  const server = createServer((request, response) => {
    if (request.method === "GET" && request.url === "/health") {
      const body = JSON.stringify({ status: "ok", fixture: "local-only" });
      response.writeHead(200, {
        "content-type": "application/json",
        "content-length": Buffer.byteLength(body),
      });
      response.end(body);
      return;
    }
    if (request.method !== "POST" || request.url !== "/chat") {
      response.writeHead(404).end();
      return;
    }
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => { body += chunk; });
    request.on("end", () => {
      const value = JSON.parse(body);
      requests.push(value);
      const reply = JSON.stringify({
        response: `fixture heard: ${value.user_input}`,
        agent_logs: ["fixture-agent:complete"],
        session_id: value.session_id || "fixture-session",
      });
      response.writeHead(200, {
        "content-type": "application/json",
        "content-length": Buffer.byteLength(reply),
      });
      response.end(reply);
    });
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  t.after(() => new Promise((resolve) => server.close(resolve)));
  return {
    baseUrl: `http://127.0.0.1:${server.address().port}`,
    requests,
  };
}

async function launch(t, root) {
  const estateHome = path.join(root, "estates", "primary");
  const autopilotFile = path.join(estateHome, "autopilot.json");
  const controlFile = path.join(estateHome, "control.json");
  let output = "";
  const child = spawn(electronPath, [
    `--user-data-dir=${path.join(estateHome, "electron-user-data")}`,
    projectRoot,
    `--rapp-zoo-estate-home=${estateHome}`,
  ], {
    cwd: projectRoot,
    env: {
      ...process.env,
      RAPP_ZOO_ROOT: root,
      RAPP_ZOO_ESTATE_HOME: estateHome,
      RAPP_ZOO_HEADLESS: "1",
      RAPP_ZOO_PRINT_TO_PDF: "1",
      ELECTRON_DISABLE_SECURITY_WARNINGS: "1",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", (chunk) => { output += chunk; });
  child.stderr.on("data", (chunk) => { output += chunk; });
  const snapshot = await waitFor(async () => (
    existsSync(autopilotFile)
      ? sendAutopilotCommand(autopilotFile, { command: "snapshot" })
      : null
  ), "semantic Chromium snapshot");
  t.after(async () => {
    try {
      await requestInstanceControl(controlFile, "stop");
    } catch {}
    await new Promise((resolve) => {
      if (child.exitCode !== null) resolve();
      else {
        const timer = setTimeout(() => {
          child.kill("SIGKILL");
          resolve();
        }, 5000);
        child.once("exit", () => {
          clearTimeout(timer);
          resolve();
        });
      }
    });
  });
  return {
    autopilotFile,
    controlFile,
    estateHome,
    output: () => output,
    snapshot,
  };
}

async function invoke(app, snapshot, controlId) {
  return sendAutopilotCommand(app.autopilotFile, {
    command: "invoke",
    revision: snapshot.revision,
    args: { control_id: controlId },
  });
}

async function input(app, snapshot, controlId, value) {
  return sendAutopilotCommand(app.autopilotFile, {
    command: "input",
    revision: snapshot.revision,
    args: { control_id: controlId, value },
  });
}

async function current(app) {
  return sendAutopilotCommand(app.autopilotFile, { command: "snapshot" });
}

async function runCli(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [
      path.join(projectRoot, "bin", "rapp-zoo-v2.mjs"),
      ...args,
    ], {
      cwd: projectRoot,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.once("error", reject);
    child.once("exit", (code) => resolve({ code, stdout, stderr }));
  });
}

test("installed Electron UI is fully drivable through its semantic virtual object", async (t) => {
  const root = mkdtempSync(path.join(os.tmpdir(), "rapp-zoo-e2e-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const fixture = await fixtureServer(t);
  const app = await launch(t, root);
  let snapshot = app.snapshot;

  assert.equal(snapshot.schema, "rapp-zoo-virtual-browser/2.0");
  assert.equal(snapshot.browser.title, "RAPP Zoo v2");
  assert.equal(snapshot.browser.url.startsWith("file:"), true);
  assert.equal(
    snapshot.controls.some((control) => control.control_id === "attach.submit"),
    true,
  );

  snapshot = await input(app, snapshot, "attach.name", "Fixture Neighbor");
  snapshot = await input(app, snapshot, "attach.rappid", RAPPID);
  snapshot = await input(app, snapshot, "attach.url", fixture.baseUrl);
  snapshot = await invoke(app, snapshot, "attach.submit");
  snapshot = await waitFor(async () => {
    const value = await current(app);
    return value.app_state.neighborhoods.length === 2 ? value : null;
  }, "resident attachment");

  snapshot = await invoke(
    app,
    snapshot,
    `neighborhood.select.${RAPPID.slice(-8)}`,
  );
  snapshot = await invoke(app, snapshot, "chat.health");
  snapshot = await waitFor(async () => {
    const value = await current(app);
    return value.app_state.health[RAPPID]?.status === "ok" ? value : null;
  }, "typed local health");

  snapshot = await input(
    app,
    snapshot,
    "chat.input",
    "hello from semantic autopilot",
  );
  snapshot = await invoke(app, snapshot, "chat.send");
  snapshot = await waitFor(async () => {
    const value = await current(app);
    const messages = value.app_state.transcripts[RAPPID] || [];
    return messages.some(
      (message) => message.text === "fixture heard: hello from semantic autopilot",
    ) ? value : null;
  }, "exact RAPP chat response");
  assert.deepEqual(fixture.requests[0], {
    idempotency_key: fixture.requests[0].idempotency_key,
    user_input: "hello from semantic autopilot",
  });
  assert.match(fixture.requests[0].idempotency_key, /^[0-9a-f-]{36}$/);

  const machine = await runCli([
    "machine",
    RAPPID,
    "AS400",
    "library.create",
    '{"name":"DEVLIB"}',
    "--root",
    root,
    "--timeout",
    "30000",
  ]);
  assert.equal(machine.code, 0, machine.stderr);
  assert.match(
    fixture.requests[1].user_input,
    /^\|\|\|AS400\)\)\|\|\| \{"args":\{"name":"DEVLIB"\}/,
  );
  assert.equal(
    JSON.parse(machine.stdout).transcript.some(
      (message) => message.text.includes("fixture heard: |||AS400))|||"),
    ),
    true,
  );

  snapshot = await current(app);
  snapshot = await invoke(app, snapshot, "nav.handoff");
  snapshot = await input(
    app,
    snapshot,
    "report.handoff",
    "Continue from the installed local semantic proof.",
  );
  snapshot = await input(
    app,
    snapshot,
    "report.actions",
    "Review the captured evidence.",
  );
  snapshot = await invoke(app, snapshot, "report.generate");
  snapshot = await waitFor(async () => {
    const value = await current(app);
    return value.app_state.report.last ? value : null;
  }, "morning handoff report");
  snapshot = await invoke(app, snapshot, "report.print");
  await waitFor(
    () => existsSync(
      path.join(
        app.estateHome,
        "reports",
        snapshot.app_state.report.last.period_end_utc.slice(0, 10),
        "morning-handoff.pdf",
      ),
    ),
    "print-ready PDF",
  );

  const capture = await sendAutopilotCommand(app.autopilotFile, {
    command: "screenshot",
    revision: (await current(app)).revision,
    args: { name: "installed-proof" },
  });
  assert.equal(existsSync(capture.file), true);
  assert.ok(readFileSync(capture.file).length > 10_000);
  assert.equal(
    app.output().includes("Electron Security Warning"),
    false,
    app.output(),
  );
});

test("estate identity, resident, and transcript survive a real restart", async (t) => {
  const root = mkdtempSync(path.join(os.tmpdir(), "rapp-zoo-restart-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const fixture = await fixtureServer(t);
  const first = await launch(t, root);
  let snapshot = first.snapshot;
  const originalRappid = snapshot.app_state.estate.rappid;
  snapshot = await input(first, snapshot, "attach.name", "Restart Neighbor");
  snapshot = await input(first, snapshot, "attach.rappid", RAPPID);
  snapshot = await input(first, snapshot, "attach.url", fixture.baseUrl);
  await invoke(first, snapshot, "attach.submit");
  await waitFor(async () => (
    (await current(first)).app_state.neighborhoods.length === 2
  ), "first attachment");
  assert.equal(await requestInstanceControl(first.controlFile, "stop"), true);
  await waitFor(() => !existsSync(first.controlFile), "first process stop");

  const second = await launch(t, root);
  const restored = second.snapshot;
  assert.equal(restored.app_state.estate.rappid, originalRappid);
  assert.equal(restored.app_state.neighborhoods.length, 2);
  assert.equal(
    restored.app_state.neighborhoods[1].rappid,
    RAPPID,
  );
});
