import { addToParty, cryFor, partyState, sendToPC } from "./party.mjs";
import {
  app,
  BrowserWindow,
  ipcMain,
  session,
} from "electron";
import { randomUUID } from "node:crypto";
import {
  appendFileSync,
  closeSync,
  constants,
  existsSync,
  fsyncSync,
  openSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { startAutopilotServer } from "./autopilot-server.mjs";
import { RappChatClient } from "./chat-client.mjs";
import { fetchPinnedCatalog } from "./catalog-client.mjs";
import { ChildEstateManager } from "./child-estates.mjs";
import { ConversationStore } from "./conversation-store.mjs";
import { startControlServer } from "./control-server.mjs";
import {
  EstateStore,
  ensurePrivateDirectory,
  readPrivateJson,
  writePrivateBytes,
  writePrivateJson,
} from "./estate-store.mjs";
import {
  GlobalObjectLoader,
  publicGlobalProjection,
} from "./global-object.mjs";
import {
  LocalQuantumDrill,
  LocalSummonStore,
} from "./local-drill.mjs";
import { KeyedQueue } from "./keyed-queue.mjs";
import { PrototypeHandoffBuilder } from "./prototype-handoff.mjs";
import {
  exportPrototypeTransfer,
} from "./prototype-transfer.mjs";
import { MonorepoCompanionLoader } from "./monorepo-companion.mjs";
import {
  OperationLedger,
  REPORT_CONFIG_SCHEMA,
  buildMorningReport,
  nextLocalReportAt,
  persistMorningReport,
  validateReportConfig,
} from "./reporting.mjs";
import { SummonLibrary } from "./summon-library.mjs";

const dirname = path.dirname(fileURLToPath(import.meta.url));
const packageDir = path.resolve(dirname, "..");

function argument(prefix) {
  const item = process.argv.find((value) => value.startsWith(`${prefix}=`));
  return item ? item.slice(prefix.length + 1) : null;
}

const requestedRoot = path.resolve(
  process.env.RAPP_ZOO_ROOT || path.join(homedir(), ".rapp-zoo-v2"),
);
const requestedEstateHome = path.resolve(
  argument("--rapp-zoo-estate-home")
  || process.env.RAPP_ZOO_ESTATE_HOME
  || path.join(requestedRoot, "estates", "primary"),
);
const earlyEstateHome = ensurePrivateDirectory(requestedEstateHome);
const userData = ensurePrivateDirectory(
  argument("--user-data-dir")
  || path.join(earlyEstateHome, "electron-user-data"),
);
app.setPath("userData", userData);

const store = new EstateStore({
  rootDir: requestedRoot,
  estateHome: requestedEstateHome,
});
let estate = store.initialize();
app.setName(estate.app_name);
app.setAppUserModelId(`io.github.kody-w.rapp-zoo-v2.${estate.rappid.slice(-12)}`);

const conversationsFile = path.join(store.estateHome, "conversations.json");
const reportConfigFile = path.join(store.estateHome, "report-config.json");
const bootLogFile = path.join(store.estateHome, "boot.jsonl");
const instanceLockFile = path.join(store.estateHome, ".instance.lock");
const readyFile = process.env.RAPP_ZOO_READY_FILE
  ? path.resolve(process.env.RAPP_ZOO_READY_FILE)
  : null;

function defaultReportConfig() {
  return {
    schema: REPORT_CONFIG_SCHEMA,
    enabled: false,
    local_time: "07:00",
    printer_name: null,
    last_printed_date: null,
  };
}

function reportConfig() {
  return existsSync(reportConfigFile)
    ? validateReportConfig(readPrivateJson(reportConfigFile, "Report config"))
    : defaultReportConfig();
}

const ledger = new OperationLedger({
  estateHome: store.estateHome,
  estateId: estate.estate_id,
});
const conversationStore = new ConversationStore({
  file: conversationsFile,
});
const globalLoader = new GlobalObjectLoader({ estateHome: store.estateHome });
const summonStore = new LocalSummonStore({ estateHome: store.estateHome });
const localDrill = new LocalQuantumDrill({ summonStore });
const library = new SummonLibrary({
  estateHome: store.estateHome,
  summonStore,
});
const prototypeBuilder = new PrototypeHandoffBuilder({
  estateHome: store.estateHome,
  summonStore,
});
const monorepoLoader = new MonorepoCompanionLoader({
  estateHome: store.estateHome,
});
const children = new ChildEstateManager({
  parentStore: store,
  electronPath: process.execPath,
  appDir: packageDir,
});

let mainWindow = null;
let controlServer = null;
let autopilotServer = null;
let loadedGlobalObject = null;
let monorepoCompanion = null;
let selectedNeighborhood = null;
let drillResult = null;
let lastReport = null;
let lastReportFiles = null;
let reportTimer = null;
let lastPrototype = null;
let lastPrototypeTransfer = null;
const health = {};
const rendererCommands = new Map();
const chatQueue = new KeyedQueue();
let instanceLockDescriptor = null;

function boot(event, detail = null) {
  appendFileSync(bootLogFile, `${JSON.stringify({
    utc: new Date().toISOString(),
    event,
    detail,
  })}\n`, { mode: 0o600 });
}

function acquireInstanceLock() {
  try {
    instanceLockDescriptor = openSync(
      instanceLockFile,
      constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY,
      0o600,
    );
  } catch (error) {
    if (error?.code === "EEXIST") {
      throw new Error(
        "This estate has an existing instance lock; lifecycle is fail-closed.",
      );
    }
    throw error;
  }
  writeFileSync(
    instanceLockDescriptor,
    `${JSON.stringify({ pid: process.pid, opened_utc: new Date().toISOString() })}\n`,
  );
  fsyncSync(instanceLockDescriptor);
}

function releaseInstanceLock() {
  if (instanceLockDescriptor !== null) {
    closeSync(instanceLockDescriptor);
    instanceLockDescriptor = null;
    rmSync(instanceLockFile, { force: true });
  }
}

function publicLibrary() {
  return library.list().map((entry) => ({
    alias: entry.alias,
    rappid: entry.rappid,
    name: entry.name,
    version: entry.version,
    license: entry.license,
    approval: entry.approval,
    local_receipt: Boolean(entry.local_receipt),
  }));
}

function publicChildren(records) {
  return records.map((child) => ({
    name: child.name,
    slug: child.slug,
    estate_id: child.estate_id,
    rappid: child.rappid,
    generation: child.generation,
    status: child.status,
    capability_live: child.capability_live,
  }));
}

function publicTranscripts() {
  return conversationStore.publicMessages();
}

async function state(requestedSelection = undefined) {
  estate = store.read();
  if (requestedSelection !== undefined) {
    const resident = estate.neighborhoods.find(
      (entry) => (
        entry.rappid === requestedSelection
        && entry.kind === "resident"
      ),
    );
    if (!resident) throw new Error("Selected neighborhood is not a resident of this estate.");
    selectedNeighborhood = resident.rappid;
  }
  if (
    selectedNeighborhood
    && !estate.neighborhoods.some(
      (entry) => entry.rappid === selectedNeighborhood,
    )
  ) {
    selectedNeighborhood = null;
  }
  const childRecords = await children.list();
  const localSummons = summonStore.receipts().map((receiptFile) => {
    const local = summonStore.open(receiptFile);
    return {
      object_id: local.receipt.object_id,
      saved_utc: local.receipt.saved_utc,
      dimensions: local.receipt.dimensions.map((entry) => entry.name),
    };
  });
  return {
    schema: "rapp-zoo-ui-state/2.0",
    estate: structuredClone(estate),
    neighborhoods: structuredClone(estate.neighborhoods),
    selected_neighborhood: selectedNeighborhood,
    transcripts: publicTranscripts(),
    health: structuredClone(health),
    global_object: loadedGlobalObject
      ? publicGlobalProjection(loadedGlobalObject)
      : null,
    monorepo_companion: monorepoCompanion
      ? structuredClone(monorepoCompanion)
      : null,
    local_summons: localSummons,
    drill_result: drillResult ? structuredClone(drillResult) : null,
    library: publicLibrary(),
    prototype: lastPrototype
      ? {
        handoff_id: lastPrototype.handoff.handoff_id,
        goal: lastPrototype.handoff.goal,
        source_rappid: lastPrototype.handoff.source.summon_rappid,
        non_production: true,
        transfer_file: lastPrototypeTransfer,
      }
      : null,
    children: publicChildren(childRecords),
    report: {
      config: reportConfig(),
      last: lastReport ? structuredClone(lastReport) : null,
    },
  };
}

async function emitState() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send("zoo:state-changed", await state());
}

function resident(rappid) {
  const found = store.read().neighborhoods.find(
    (entry) => entry.rappid === rappid && entry.kind === "resident",
  );
  if (!found) throw new Error("Neighborhood is not an attached resident.");
  return found;
}

function register(channel, handler) {
  ipcMain.handle(channel, async (_event, ...args) => {
    const result = await handler(...args);
    await emitState();
    return result;
  });
}

ipcMain.handle("zoo:state", async (_event, requestedSelection) => (
  state(requestedSelection)
));

register("zoo:attach", async ({ rappid, name, baseUrl }) => {
  const result = store.attach({ rappid, name, baseUrl });
  selectedNeighborhood = result.resident.rappid;
  ledger.append({
    action: "neighborhood.attach",
    status: "completed",
    summary: `Attached local resident ${result.resident.name}.`,
    evidence: [result.resident.rappid, result.resident.base_url],
  });
  return { attached: result.attached, rappid: result.resident.rappid };
});

register("zoo:party-state", async () => partyState());

register("zoo:party-add", async (rappid) => {
  const result = addToParty(rappid);
  cryFor(rappid);
  ledger.append({
    action: "party.add",
    status: "completed",
    summary: "A rappid joined the active party.",
    evidence: [rappid],
  });
  return result;
});

register("zoo:party-pc", async (rappid) => {
  const result = sendToPC(rappid);
  ledger.append({
    action: "party.pc",
    status: "completed",
    summary: "A rappid was sent to the roost.",
    evidence: [rappid],
  });
  return result;
});

register("zoo:party-cry", async (rappid) => ({ played: cryFor(rappid) }));

register("zoo:detach", async (rappid) => {
  const result = store.detach(rappid);
  if (selectedNeighborhood === rappid) selectedNeighborhood = null;
  ledger.append({
    action: "neighborhood.detach",
    status: "completed",
    summary: `Detached local resident ${rappid}.`,
    evidence: [rappid],
  });
  return { detached: result.detached };
});

register("zoo:health", async (rappid) => {
  const target = resident(rappid);
  const value = await new RappChatClient({
    baseUrl: target.base_url,
  }).health();
  health[rappid] = {
    status: value.status,
    checked_utc: new Date().toISOString(),
  };
  ledger.append({
    actor: rappid,
    action: "neighborhood.health",
    status: "completed",
    summary: `Verified exact local health for ${target.name}.`,
    evidence: [target.base_url],
  });
  return health[rappid];
});

register("zoo:chat", async (rappid, prompt) => {
  return chatQueue.run(rappid, async () => {
  if (typeof prompt !== "string" || !prompt.trim() || prompt.length > 64 * 1024) {
    throw new Error("Chat prompt must be non-empty and bounded.");
  }
  const target = resident(rappid);
  const sessionRecord = conversationStore.session(rappid);
  sessionRecord.messages.push({ role: "user", text: prompt });
  const result = await new RappChatClient({
    baseUrl: target.base_url,
  }).chat({
    user_input: prompt,
    ...(sessionRecord.session_id
      ? { session_id: sessionRecord.session_id }
      : {}),
    idempotency_key: randomUUID(),
  });
  sessionRecord.session_id = result.session_id;
  sessionRecord.messages.push({ role: "assistant", text: result.response });
  for (const line of result.agent_logs) {
    sessionRecord.messages.push({ role: "log", text: line });
  }
  await conversationStore.commit(rappid, sessionRecord);
  ledger.append({
    actor: rappid,
    action: "chat.turn",
    status: "completed",
    summary: `Completed one exact RAPP/1 turn with ${target.name}.`,
    evidence: [`session:${result.session_id}`, `agent_logs:${result.agent_logs.length}`],
  });
  return { response: result.response, session_id: result.session_id };
  });
});

register("zoo:global-load", async (options) => {
  loadedGlobalObject = await globalLoader.load(options);
  ledger.append({
    action: "global.load",
    status: "completed",
    summary: `Loaded verified global object ${loadedGlobalObject.receipt.name}.`,
    evidence: [
      loadedGlobalObject.receipt.object_id,
      ...loadedGlobalObject.receipt.loaded_dimensions,
    ],
  });
  return publicGlobalProjection(loadedGlobalObject);
});

register("zoo:global-save", async () => {
  if (!loadedGlobalObject) throw new Error("No verified global object is loaded.");
  const saved = summonStore.save(loadedGlobalObject);
  ledger.append({
    action: "summon.save",
    status: "completed",
    summary: "Saved verified global object as a local summon.",
    evidence: [saved.receipt.object_id],
  });
  return { object_id: saved.receipt.object_id };
});

register("zoo:monorepo-load", async () => {
  monorepoCompanion = await monorepoLoader.load();
  ledger.append({
    action: "companion.load",
    status: "completed",
    summary: "Loaded the pinned monorepo companion body map into the local cage.",
    evidence: [
      monorepoCompanion.companion_id,
      `dimensions:${monorepoCompanion.repository_count}`,
      "execution:none",
    ],
  });
  return {
    companion_id: monorepoCompanion.companion_id,
    repository_count: monorepoCompanion.repository_count,
  };
});

register("zoo:drill", async (query) => {
  drillResult = localDrill.lookup(query);
  ledger.append({
    action: "drill.lookup",
    status: "completed",
    summary: `Local Drill found ${drillResult.matches.length} matches.`,
    evidence: [`dimension:${drillResult.dimension}`, "network:none"],
  });
  return structuredClone(drillResult);
});

register("zoo:library-dial", async (alias) => {
  const result = await library.dial(alias, { globalLoader });
  ledger.append({
    action: "summon.dial",
    status: "completed",
    summary: `Dialed approved summon ${alias}.`,
    evidence: [result.entry.rappid, `source:${result.source}`],
  });
  return { source: result.source, alias };
});

register("zoo:library-import", async ({ url, sha256 }) => {
  const catalog = await fetchPinnedCatalog({ url, sha256 });
  const entries = library.importCatalog(catalog);
  ledger.append({
    action: "summon.catalog-import",
    status: "completed",
    summary: `Imported ${entries.length} approved public summons.`,
    evidence: [sha256, `entries:${entries.length}`],
  });
  return { entries: entries.length };
});

register("zoo:library-approve", async ({
  alias,
  rappid,
  name,
  version,
  objectId,
  manifestUrl,
  manifestSha256,
  licenseUrl,
  licenseSha256,
}) => {
  const receiptFile = summonStore.receipts().find((candidate) => (
    summonStore.open(candidate).receipt.object_id === objectId
  ));
  if (!receiptFile) {
    throw new Error("Approved summon must name a fully saved local object ID.");
  }
  const entry = library.approve({
    alias,
    rappid,
    name,
    version,
    spdx: "MIT",
    licenseUrl,
    licenseSha256,
    manifestUrl,
    manifestSha256,
    receiptFile,
  });
  ledger.append({
    action: "summon.approve",
    status: "decision",
    summary: `Approved MIT summon ${entry.alias} for public-line use.`,
    evidence: [
      entry.rappid,
      entry.manifest.sha256,
      entry.license.sha256,
    ],
  });
  return { alias: entry.alias, rappid: entry.rappid };
});

register("zoo:prototype-prepare", async ({
  alias,
  goal,
  assumptions,
  acceptanceCriteria,
}) => {
  const dialed = await library.dial(alias, { globalLoader });
  const approvedEntry = library.list().find((entry) => entry.alias === alias);
  if (!approvedEntry?.local_receipt) {
    throw new Error("Approved summon did not produce a local receipt.");
  }
  lastPrototype = prototypeBuilder.prepare({
    receiptFile: approvedEntry.local_receipt.receipt_file,
    approvedEntry,
    goal,
    assumptions,
    acceptanceCriteria,
  });
  lastPrototypeTransfer = null;
  ledger.append({
    action: "prototype.prepare",
    status: "completed",
    summary: `Prepared mutable non-production prototype from ${alias}.`,
    evidence: [
      lastPrototype.handoff.handoff_id,
      approvedEntry.rappid,
      `source:${dialed.source}`,
    ],
  });
  return {
    handoff_id: lastPrototype.handoff.handoff_id,
    non_production: true,
  };
});

register("zoo:prototype-export", async () => {
  if (!lastPrototype) throw new Error("Prepare a prototype first.");
  const directory = ensurePrivateDirectory(
    path.join(store.estateHome, "transfers"),
  );
  lastPrototypeTransfer = path.join(
    directory,
    `${lastPrototype.handoff.handoff_id}.rapp-prototype.json`,
  );
  const transfer = exportPrototypeTransfer({
    handoffFile: lastPrototype.handoffFile,
    outputFile: lastPrototypeTransfer,
  });
  ledger.append({
    action: "prototype.export",
    status: "completed",
    summary: "Exported cross-device prototype data without runtime authority.",
    evidence: [
      transfer.transfer_hash,
      "federation_ready:false",
    ],
  });
  return {
    transfer_file: lastPrototypeTransfer,
    transfer_hash: transfer.transfer_hash,
    federation_ready: false,
  };
});

register("zoo:report-generate", async ({
  handoffPoint,
  primaryActions,
}) => {
  const end = new Date();
  const start = new Date(end.valueOf() - 12 * 60 * 60 * 1000);
  const endUtc = end.toISOString();
  const startUtc = start.toISOString();
  lastReport = buildMorningReport({
    estate,
    operations: ledger.read({
      sinceUtc: startUtc,
      untilUtc: endUtc,
    }),
    periodStartUtc: startUtc,
    periodEndUtc: endUtc,
    generatedUtc: new Date().toISOString(),
    handoffPoint,
    primaryActions,
  });
  lastReportFiles = persistMorningReport({
    estateHome: store.estateHome,
    report: lastReport,
  });
  return { generated_utc: lastReport.generated_utc };
});

async function printReport({ silent }) {
  if (!lastReportFiles?.htmlFile) throw new Error("Generate a morning report first.");
  const printWindow = new BrowserWindow({
    show: false,
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  try {
    await printWindow.loadFile(lastReportFiles.htmlFile);
    if (process.env.RAPP_ZOO_PRINT_TO_PDF === "1") {
      const pdf = await printWindow.webContents.printToPDF({
        printBackground: true,
        pageSize: "Letter",
      });
      const file = path.join(
        path.dirname(lastReportFiles.htmlFile),
        "morning-handoff.pdf",
      );
      writePrivateBytes(file, pdf);
      return { printed: false, preview_pdf: file };
    }
    const config = reportConfig();
    await new Promise((resolve, reject) => {
      printWindow.webContents.print({
        silent,
        printBackground: true,
        ...(silent && config.printer_name
          ? { deviceName: config.printer_name }
          : {}),
      }, (success, reason) => {
        if (success) resolve();
        else reject(new Error(reason || "Print request failed."));
      });
    });
    return { printed: true };
  } finally {
    printWindow.destroy();
  }
}

register("zoo:report-print", printReport);

register("zoo:report-config-save", async ({
  enabled,
  localTime,
  printerName,
}) => {
  const config = validateReportConfig({
    schema: REPORT_CONFIG_SCHEMA,
    enabled,
    local_time: localTime,
    printer_name: printerName,
    last_printed_date: reportConfig().last_printed_date,
  });
  writePrivateJson(reportConfigFile, config);
  scheduleReport();
  return config;
});

register("zoo:child-hatch", async (name) => {
  const child = await children.hatch(name);
  ledger.append({
    action: "estate.hatch",
    status: "completed",
    summary: `Hatched detached child estate ${child.name}.`,
    evidence: [child.rappid, `generation:${child.generation}`],
  });
  return { estate_id: child.estate_id, rappid: child.rappid };
});

register("zoo:child-stop", async (estateId) => {
  const result = await children.stop(estateId);
  ledger.append({
    action: "estate.stop",
    status: result.stopped ? "completed" : "blocked",
    summary: result.stopped
      ? `Stopped child estate ${estateId} through its capability.`
      : `Could not verify stop capability for ${estateId}.`,
    evidence: [estateId],
    handoff: result.stopped ? null : result.reason,
  });
  return result;
});

function rendererCommand(command) {
  if (!mainWindow || mainWindow.isDestroyed()) {
    throw new Error("Renderer is unavailable.");
  }
  const requestId = randomUUID();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      rendererCommands.delete(requestId);
      reject(new Error("Semantic renderer command timed out."));
    }, 10_000);
    timer.unref?.();
    rendererCommands.set(requestId, { resolve, reject, timer });
    mainWindow.webContents.send("zoo:autopilot-command", requestId, command);
  });
}

ipcMain.on("zoo:autopilot-result", (_event, requestId, result) => {
  const pending = rendererCommands.get(requestId);
  if (!pending) return;
  rendererCommands.delete(requestId);
  clearTimeout(pending.timer);
  if (result.ok) pending.resolve(result.value);
  else {
    const error = new Error(result.error);
    error.code = result.code;
    pending.reject(error);
  }
});

async function executeAutopilot(command) {
  if (command.command !== "screenshot") {
    return rendererCommand(command);
  }
  const snapshot = await rendererCommand({
    ...command,
    command: "snapshot",
    args: {},
  });
  if (snapshot.revision !== command.revision) {
    const error = new Error(
      `Expected screen revision ${snapshot.revision}, received ${command.revision}.`,
    );
    error.code = "STALE_REVISION";
    throw error;
  }
  const captures = ensurePrivateDirectory(path.join(store.estateHome, "captures"));
  const image = await mainWindow.webContents.capturePage();
  const file = path.join(
    captures,
    `${command.args.name}-${Date.now()}.png`,
  );
  writePrivateBytes(file, image.toPNG());
  return { file, revision: snapshot.revision };
}

async function scheduledReport() {
  const config = reportConfig();
  const today = new Date().toLocaleDateString("en-CA");
  if (!config.enabled || config.last_printed_date === today) return;
  const records = ledger.read();
  const lastHandoff = [...records].reverse().find((entry) => entry.handoff)?.handoff
    || "Review overnight evidence and continue from the first blocked or in-progress action.";
  const end = new Date();
  const start = new Date(end.valueOf() - 12 * 60 * 60 * 1000);
  lastReport = buildMorningReport({
    estate,
    operations: records.filter(
      (entry) => entry.utc >= start.toISOString() && entry.utc < end.toISOString(),
    ),
    periodStartUtc: start.toISOString(),
    periodEndUtc: end.toISOString(),
    generatedUtc: new Date().toISOString(),
    handoffPoint: lastHandoff,
    primaryActions: records
      .filter((entry) => ["blocked", "in-progress"].includes(entry.status))
      .map((entry) => entry.summary),
  });
  lastReportFiles = persistMorningReport({
    estateHome: store.estateHome,
    report: lastReport,
  });
  await printReport({ silent: true });
  config.last_printed_date = today;
  writePrivateJson(reportConfigFile, config);
  await emitState();
}

function scheduleReport() {
  if (reportTimer) clearTimeout(reportTimer);
  reportTimer = null;
  const config = reportConfig();
  if (!config.enabled) return;
  const delay = nextLocalReportAt(new Date(), config.local_time).valueOf()
    - Date.now();
  reportTimer = setTimeout(async () => {
    try {
      await scheduledReport();
    } finally {
      scheduleReport();
    }
  }, delay);
  reportTimer.unref?.();
}

function configureRendererSandbox() {
  session.defaultSession.setPermissionRequestHandler(
    (_webContents, _permission, callback) => callback(false),
  );
  session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
    try {
      const url = new URL(details.url);
      const allowed = url.protocol === "file:"
        || (
          url.protocol === "http:"
          && url.hostname === "127.0.0.1"
        );
      callback({ cancel: !allowed });
    } catch {
      callback({ cancel: true });
    }
  });
}

async function createWindow() {
  boot("window.creating");
  configureRendererSandbox();
  mainWindow = new BrowserWindow({
    width: 1320,
    height: 860,
    minWidth: 820,
    minHeight: 650,
    show: process.env.RAPP_ZOO_HEADLESS !== "1",
    title: estate.app_name,
    backgroundColor: "#091118",
    webPreferences: {
      preload: path.join(dirname, "preload.cjs"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
      devTools: process.env.RAPP_ZOO_DEVTOOLS === "1",
    },
  });
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  mainWindow.webContents.on("console-message", (_event, details) => {
    boot("renderer.console", {
      level: details?.level ?? null,
      message: details?.message ?? String(details),
      line: details?.lineNumber ?? null,
      source: details?.sourceId ?? null,
    });
  });
  mainWindow.webContents.on("render-process-gone", (_event, details) => {
    boot("renderer.gone", details);
  });
  mainWindow.webContents.on("did-fail-load", (
    _event,
    errorCode,
    errorDescription,
    validatedUrl,
  ) => {
    boot("renderer.load-failed", {
      errorCode,
      errorDescription,
      validatedUrl,
    });
  });
  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (!url.startsWith("file:")) event.preventDefault();
  });
  await Promise.race([
    mainWindow.loadFile(path.join(packageDir, "ui", "index.html")),
    new Promise((_, reject) => {
      const timer = setTimeout(
        () => reject(new Error("Renderer did not finish loading within 15 seconds.")),
        15_000,
      );
      timer.unref?.();
    }),
  ]);
  boot("window.loaded");
}

async function start() {
  boot("start.entered");
  acquireInstanceLock();
  boot("start.estate-lock-acquired");
  await app.whenReady();
  boot("start.app-ready");
  app.dock?.setBadge(estate.dock_badge);
  await createWindow();
  controlServer = await startControlServer({
    estateHome: store.estateHome,
    estateId: estate.estate_id,
    onStop: () => app.quit(),
  });
  autopilotServer = await startAutopilotServer({
    estateHome: store.estateHome,
    estateId: estate.estate_id,
    execute: executeAutopilot,
  });
  scheduleReport();
  boot("start.services-ready");
  if (readyFile) {
    writePrivateJson(readyFile, {
      schema: "rapp-zoo-ready/2.0",
      estate_id: estate.estate_id,
      rappid: estate.rappid,
      app_name: estate.app_name,
      pid: process.pid,
      autopilot_metadata: autopilotServer.metadataFile,
      control_metadata: controlServer.metadataFile,
      user_data: userData,
    });
  }
  ledger.append({
    action: "estate.boot",
    status: "completed",
    summary: "Materialized the local RAPP Zoo v2 estate.",
    evidence: [estate.rappid, "renderer-egress:loopback-only"],
  });
  await emitState();
  boot("start.complete");
}

app.on("before-quit", () => {
  if (reportTimer) clearTimeout(reportTimer);
  for (const pending of rendererCommands.values()) {
    clearTimeout(pending.timer);
    pending.reject(new Error("Application is quitting."));
  }
  rendererCommands.clear();
  controlServer?.close().catch(() => {});
  autopilotServer?.close().catch(() => {});
  releaseInstanceLock();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin" || process.env.RAPP_ZOO_HEADLESS === "1") {
    app.quit();
  }
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

start().catch((error) => {
  boot("start.failed", {
    message: String(error?.message || error),
    stack: String(error?.stack || ""),
  });
  console.error(error);
  app.quit();
});
