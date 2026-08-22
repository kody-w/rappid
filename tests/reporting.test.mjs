import assert from "node:assert/strict";
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createEstateManifest } from "../src/contracts.mjs";
import {
  OperationLedger,
  buildMorningReport,
  nextLocalReportAt,
  persistMorningReport,
  renderMorningReport,
  validateReportConfig,
} from "../src/reporting.mjs";

function fixture(t) {
  const home = mkdtempSync(path.join(os.tmpdir(), "rapp-zoo-report-"));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  let tick = 0;
  const now = () => new Date(Date.UTC(2026, 7, 22, 5, tick++, 0));
  const estate = createEstateManifest({
    uuid: "00000000-0000-4000-8000-000000000030",
    createdUtc: "2026-08-21T20:00:00.000Z",
  });
  return { estate, home, now };
}

test("operation ledger is private, contiguous, and period-filterable", (t) => {
  const { estate, home, now } = fixture(t);
  const ledger = new OperationLedger({
    estateHome: home,
    estateId: estate.estate_id,
    now,
  });
  ledger.append({
    action: "test.run",
    status: "completed",
    summary: "All focused tests passed.",
    evidence: ["55/55"],
  });
  ledger.append({
    action: "package.prove",
    status: "in-progress",
    summary: "Package proof remains.",
    handoff: "Run the package gate twice.",
  });
  assert.equal(statSync(ledger.file).mode & 0o777, 0o600);
  assert.deepEqual(
    ledger.read().map((entry) => entry.seq),
    [0, 1],
  );
  assert.equal(
    ledger.read({
      sinceUtc: "2026-08-22T05:00:01.000Z",
      untilUtc: "2026-08-22T05:02:00.000Z",
    }).length,
    1,
  );
  assert.throws(
    () => ledger.append({
      action: "secret.log",
      status: "completed",
      summary: "token=should-not-persist",
    }),
    /non-secret/,
  );
});

test("morning report groups the shift and renders print-safe escaped HTML", (t) => {
  const { estate, home, now } = fixture(t);
  const ledger = new OperationLedger({
    estateHome: home,
    estateId: estate.estate_id,
    now,
  });
  ledger.append({
    action: "tests.complete",
    status: "completed",
    summary: "Suite <green>.",
    evidence: ["717 passed"],
  });
  ledger.append({
    action: "architecture.decide",
    status: "decision",
    summary: "One estate can host many neighborhoods.",
  });
  ledger.append({
    action: "package.run",
    status: "blocked",
    summary: "Awaiting current-source build.",
  });
  const report = buildMorningReport({
    estate,
    operations: ledger.read(),
    periodStartUtc: "2026-08-21T20:00:00.000Z",
    periodEndUtc: "2026-08-22T08:00:00.000Z",
    generatedUtc: "2026-08-22T08:00:01.000Z",
    handoffPoint: "Build and prove the installed semantic UI.",
    primaryActions: ["Run the real Electron autopilot proof."],
  });
  assert.deepEqual(report.summary, {
    operation_count: 3,
    completed: 1,
    in_progress: 0,
    blocked: 1,
    decisions: 1,
  });
  const html = renderMorningReport(report);
  assert.ok(html.includes("Suite &lt;green&gt;."));
  assert.equal(html.includes("Suite <green>."), false);
  assert.match(html, /@page \{ size: Letter/);
  assert.match(html, /Content-Security-Policy/);
  const files = persistMorningReport({ estateHome: home, report });
  assert.equal(statSync(files.htmlFile).mode & 0o777, 0o600);
  assert.equal(
    JSON.parse(readFileSync(files.jsonFile, "utf8")).summary.blocked,
    1,
  );
});

test("daily print configuration is explicit and computes the next local run", () => {
  assert.deepEqual(validateReportConfig({
    schema: "rapp-zoo-report-config/2.0",
    enabled: true,
    local_time: "07:00",
    printer_name: "EPSON_ET_3760_Series",
    last_printed_date: null,
  }), {
    schema: "rapp-zoo-report-config/2.0",
    enabled: true,
    local_time: "07:00",
    printer_name: "EPSON_ET_3760_Series",
    last_printed_date: null,
  });
  const before = nextLocalReportAt(new Date(2026, 7, 22, 6, 30), "07:00");
  assert.deepEqual(
    [before.getFullYear(), before.getMonth(), before.getDate(), before.getHours(), before.getMinutes()],
    [2026, 7, 22, 7, 0],
  );
  const after = nextLocalReportAt(new Date(2026, 7, 22, 8, 0), "07:00");
  assert.deepEqual(
    [after.getFullYear(), after.getMonth(), after.getDate(), after.getHours(), after.getMinutes()],
    [2026, 7, 23, 7, 0],
  );
});
