import {
  closeSync,
  constants,
  existsSync,
  fsyncSync,
  openSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

import {
  OPERATION_SCHEMA,
  REPORT_SCHEMA,
  utc,
} from "./contracts.mjs";
import {
  ensurePrivateDirectory,
  writePrivateBytes,
  writePrivateJson,
} from "./estate-store.mjs";
import {
  parseIJson,
  validateRappid,
} from "./rapp1.mjs";

export const REPORT_CONFIG_SCHEMA = "rapp-zoo-report-config/2.0";
const ACTION = /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/;
const STATUS = new Set(["completed", "in-progress", "blocked", "decision"]);
const SECRET = /(?:github_pat_|gh[pousr]_[a-z0-9]+|bearer\s+\S+|(?:password|token|secret)\s*[:=]\s*\S+)/i;

function exactKeys(value, expected, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (
    actual.length !== wanted.length
    || actual.some((key, index) => key !== wanted[index])
  ) {
    throw new Error(`${label} has unknown or missing members.`);
  }
}

function safeText(value, label, max = 1000) {
  if (
    typeof value !== "string"
    || value.length < 1
    || value.length > max
    || value !== value.normalize("NFC")
    || SECRET.test(value)
  ) {
    throw new Error(`${label} must be a non-secret NFC string.`);
  }
  return value;
}

function validateOperation(value, estateId = null) {
  exactKeys(
    value,
    [
      "schema",
      "estate_id",
      "seq",
      "utc",
      "actor",
      "action",
      "status",
      "summary",
      "evidence",
      "handoff",
    ],
    "Operation record",
  );
  if (
    value.schema !== OPERATION_SCHEMA
    || (estateId && value.estate_id !== estateId)
    || typeof value.estate_id !== "string"
    || !Number.isSafeInteger(value.seq)
    || value.seq < 0
    || typeof value.actor !== "string"
    || (
      value.actor !== "local-operator"
      && !validateRappid(value.actor)
    )
    || !ACTION.test(value.action)
    || !STATUS.has(value.status)
    || !Array.isArray(value.evidence)
    || value.evidence.length > 32
    || (
      value.handoff !== null
      && typeof value.handoff !== "string"
    )
  ) {
    throw new Error("Operation record is invalid.");
  }
  utc(value.utc, "Operation utc");
  safeText(value.summary, "Operation summary");
  value.evidence.forEach((entry) => safeText(entry, "Operation evidence", 500));
  if (value.handoff !== null) safeText(value.handoff, "Operation handoff", 1000);
  return value;
}

function parseLedger(file, estateId) {
  if (!existsSync(file)) return [];
  const source = readFileSync(file, "utf8");
  const lines = source.endsWith("\n")
    ? source.slice(0, -1).split("\n")
    : source.split("\n");
  if (lines.length === 1 && lines[0] === "") return [];
  return lines.map((line, index) => {
    const record = validateOperation(parseIJson(line), estateId);
    if (record.seq !== index) {
      throw new Error("Operation ledger sequence is not contiguous.");
    }
    return record;
  });
}

export class OperationLedger {
  constructor({
    estateHome,
    estateId,
    now = () => new Date(),
  }) {
    this.estateId = estateId;
    this.now = now;
    this.directory = ensurePrivateDirectory(path.join(estateHome, "operations"));
    this.file = path.join(this.directory, "ledger.jsonl");
    this.lockFile = path.join(this.directory, ".ledger.lock");
  }

  #withLock(callback) {
    let descriptor;
    try {
      descriptor = openSync(
        this.lockFile,
        constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY,
        0o600,
      );
    } catch (error) {
      if (error?.code === "EEXIST") {
        throw new Error("Operation ledger lock exists; append is fail-closed.");
      }
      throw error;
    }
    try {
      return callback();
    } finally {
      closeSync(descriptor);
      rmSync(this.lockFile, { force: true });
    }
  }

  append({
    actor = "local-operator",
    action,
    status,
    summary,
    evidence = [],
    handoff = null,
  }) {
    return this.#withLock(() => {
      const records = parseLedger(this.file, this.estateId);
      const record = validateOperation({
        schema: OPERATION_SCHEMA,
        estate_id: this.estateId,
        seq: records.length,
        utc: this.now().toISOString(),
        actor,
        action,
        status,
        summary,
        evidence,
        handoff,
      }, this.estateId);
      const descriptor = openSync(
        this.file,
        constants.O_CREAT | constants.O_APPEND | constants.O_WRONLY,
        0o600,
      );
      try {
        writeFileSync(descriptor, `${JSON.stringify(record)}\n`, "utf8");
        fsyncSync(descriptor);
      } finally {
        closeSync(descriptor);
      }
      return record;
    });
  }

  read({ sinceUtc = null, untilUtc = null } = {}) {
    const records = parseLedger(this.file, this.estateId);
    return records.filter((record) => (
      (!sinceUtc || record.utc >= sinceUtc)
      && (!untilUtc || record.utc < untilUtc)
    ));
  }
}

function conciseOperation(record) {
  return {
    seq: record.seq,
    utc: record.utc,
    actor: record.actor,
    action: record.action,
    summary: record.summary,
    evidence: record.evidence,
    handoff: record.handoff,
  };
}

export function buildMorningReport({
  estate,
  operations,
  periodStartUtc,
  periodEndUtc,
  generatedUtc = new Date().toISOString(),
  handoffPoint,
  primaryActions = [],
}) {
  const categories = {
    completed: [],
    "in-progress": [],
    blocked: [],
    decision: [],
  };
  for (const operation of operations) {
    validateOperation(operation, estate.estate_id);
    categories[operation.status].push(conciseOperation(operation));
  }
  const report = {
    schema: REPORT_SCHEMA,
    estate_id: estate.estate_id,
    estate_name: estate.name,
    generated_utc: utc(generatedUtc, "Report generated_utc"),
    period_start_utc: utc(periodStartUtc, "Report period_start_utc"),
    period_end_utc: utc(periodEndUtc, "Report period_end_utc"),
    summary: {
      operation_count: operations.length,
      completed: categories.completed.length,
      in_progress: categories["in-progress"].length,
      blocked: categories.blocked.length,
      decisions: categories.decision.length,
    },
    completed: categories.completed,
    in_progress: categories["in-progress"],
    blocked: categories.blocked,
    decisions: categories.decision,
    handoff_point: safeText(handoffPoint, "Report handoff point", 2000),
    primary_actions: primaryActions.map((entry) => (
      safeText(entry, "Primary action", 1000)
    )),
  };
  return report;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#39;");
}

function list(title, values) {
  const items = values.length
    ? values.map((entry) => (
      `<li><strong>${escapeHtml(entry.action)}</strong> - ${
        escapeHtml(entry.summary)
      }${
        entry.evidence.length
          ? `<div class="evidence">Evidence: ${
            entry.evidence.map(escapeHtml).join("; ")
          }</div>`
          : ""
      }</li>`
    )).join("")
    : "<li>None recorded.</li>";
  return `<section><h2>${escapeHtml(title)}</h2><ul>${items}</ul></section>`;
}

export function renderMorningReport(report) {
  exactKeys(report, [
    "schema",
    "estate_id",
    "estate_name",
    "generated_utc",
    "period_start_utc",
    "period_end_utc",
    "summary",
    "completed",
    "in_progress",
    "blocked",
    "decisions",
    "handoff_point",
    "primary_actions",
  ], "Morning report");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">
<title>Morning AI Shift Handoff</title>
<style>
@page { size: Letter; margin: 0.65in; }
* { box-sizing: border-box; }
body { margin: 0; color: #18212a; font: 11pt Arial, sans-serif; line-height: 1.35; }
header { border-bottom: 3px solid #0f6b6d; margin-bottom: 18px; padding-bottom: 12px; }
h1 { color: #17324d; font-size: 25pt; margin: 5px 0; }
h2 { color: #17324d; font-size: 15pt; margin: 17px 0 7px; }
.eyebrow { color: #0f6b6d; font-size: 9pt; font-weight: 700; letter-spacing: 2px; }
.meta, .evidence { color: #52606d; font-size: 9pt; }
.handoff { background: #ddefef; border: 1px solid #9dc5c6; padding: 14px; }
.score { display: grid; grid-template-columns: repeat(5, 1fr); gap: 7px; margin: 14px 0; }
.score div { background: #f3f5f7; border: 1px solid #c8d0d7; padding: 8px; text-align: center; }
.score strong { display: block; color: #0f6b6d; font-size: 16pt; }
li { margin-bottom: 5px; }
footer { border-top: 1px solid #b8c4ce; color: #66727d; font-size: 8pt; margin-top: 24px; padding-top: 8px; }
</style>
</head>
<body>
<header>
  <div class="eyebrow">RAPP ZOO V2 / AI ESTATE OPERATIONS</div>
  <h1>Morning Meeting Minutes &amp; Shift Handoff</h1>
  <div class="meta">${escapeHtml(report.estate_name)} | ${
    escapeHtml(report.period_start_utc)
  } through ${escapeHtml(report.period_end_utc)}</div>
</header>
<div class="handoff"><strong>Exact handoff point:</strong> ${
  escapeHtml(report.handoff_point)
}</div>
<div class="score">
  <div><strong>${report.summary.operation_count}</strong>operations</div>
  <div><strong>${report.summary.completed}</strong>completed</div>
  <div><strong>${report.summary.in_progress}</strong>in progress</div>
  <div><strong>${report.summary.blocked}</strong>blocked</div>
  <div><strong>${report.summary.decisions}</strong>decisions</div>
</div>
${list("Completed overnight", report.completed)}
${list("In progress", report.in_progress)}
${list("Blocked / requires primary team", report.blocked)}
${list("Decisions recorded", report.decisions)}
<section><h2>Primary team actions</h2><ol>${
  report.primary_actions.length
    ? report.primary_actions.map((entry) => `<li>${escapeHtml(entry)}</li>`).join("")
    : "<li>Continue from the exact handoff point.</li>"
}</ol></section>
<footer>Generated ${escapeHtml(report.generated_utc)}. Operational evidence, not a release or compliance receipt.</footer>
</body>
</html>`;
}

export function persistMorningReport({
  estateHome,
  report,
}) {
  const date = report.period_end_utc.slice(0, 10);
  const directory = ensurePrivateDirectory(path.join(estateHome, "reports", date));
  const jsonFile = path.join(directory, "morning-handoff.json");
  const htmlFile = path.join(directory, "morning-handoff.html");
  writePrivateJson(jsonFile, report);
  writePrivateBytes(htmlFile, renderMorningReport(report));
  return { jsonFile, htmlFile };
}

export function validateReportConfig(value) {
  exactKeys(
    value,
    ["schema", "enabled", "local_time", "printer_name", "last_printed_date"],
    "Report config",
  );
  if (
    value.schema !== REPORT_CONFIG_SCHEMA
    || typeof value.enabled !== "boolean"
    || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value.local_time)
    || (
      value.printer_name !== null
      && (typeof value.printer_name !== "string" || !value.printer_name)
    )
    || (
      value.last_printed_date !== null
      && !/^\d{4}-\d{2}-\d{2}$/.test(value.last_printed_date)
    )
  ) {
    throw new Error("Report config is invalid.");
  }
  return value;
}

export function nextLocalReportAt(now, localTime) {
  if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(localTime)) {
    throw new Error("Report time must be HH:MM.");
  }
  const [hour, minute] = localTime.split(":").map(Number);
  const next = new Date(now);
  next.setHours(hour, minute, 0, 0);
  if (next <= now) next.setDate(next.getDate() + 1);
  return next;
}
