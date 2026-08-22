import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  ensurePrivateDirectory,
  writePrivateBytes,
} from "../src/estate-store.mjs";
import { LocalSummonStore } from "../src/local-drill.mjs";
import { PrototypeHandoffBuilder } from "../src/prototype-handoff.mjs";

const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");

function fixture(t) {
  const home = mkdtempSync(path.join(os.tmpdir(), "rapp-zoo-handoff-"));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const sourceDir = ensurePrivateDirectory(
    path.join(home, "global-objects", "f".repeat(64)),
  );
  const bytes = Buffer.from('{"sample_customer":"synthetic","intent":"prototype"}');
  const sourceFile = path.join(sourceDir, "template.json");
  writePrivateBytes(sourceFile, bytes);
  const summonStore = new LocalSummonStore({ estateHome: home });
  const saved = summonStore.save({
    receipt: {
      object_id: `sha256:${"f".repeat(64)}`,
      manifest_sha256: "f".repeat(64),
      loaded_dimensions: ["template"],
    },
    manifest: {
      dimensions: [{ name: "template" }],
    },
    dimensions: {
      template: {
        media_type: "application/json",
        bytes: bytes.length,
        sha256: sha(bytes),
        local_path: sourceFile,
        value: JSON.parse(bytes),
      },
    },
  });
  const approvedEntry = {
    alias: "prototype-template",
    rappid: `rappid:@kody-w/prototype-template:${"a".repeat(64)}`,
    license: { spdx: "MIT" },
    approval: { scope: "public-telephone-line" },
    local_receipt: { receipt_file: saved.receiptFile },
  };
  const builder = new PrototypeHandoffBuilder({
    estateHome: home,
    summonStore,
    now: () => new Date("2026-08-22T12:00:00.000Z"),
    uuid: () => "00000000-0000-4000-8000-000000000040",
  });
  return { approvedEntry, builder, bytes, saved, sourceFile };
}

test("factory handoff copies immutable summon bytes into a mutable prototype", (t) => {
  const f = fixture(t);
  const result = f.builder.prepare({
    receiptFile: f.saved.receiptFile,
    approvedEntry: f.approvedEntry,
    goal: "Prototype an invoice-review agent team.",
    assumptions: ["Use synthetic invoice records."],
    acceptanceCriteria: ["The prototype classifies the supplied fixtures."],
  });
  assert.equal(result.handoff.stage, "prototype");
  assert.equal(result.handoff.non_production, true);
  assert.equal(result.handoff.default_protocol, "rapp/1");
  assert.equal(result.handoff.factory, "any-capable-agent-factory");
  assert.equal(result.handoff.productionization.required, true);
  assert.equal(result.handoff.productionization.customer_data_may_enter_here, false);
  const mutable = path.join(result.workspace, result.handoff.inputs[0].path);
  writeFileSync(mutable, '{"mutated":true}');
  assert.equal(readFileSync(f.sourceFile).equals(f.bytes), true);
  assert.equal(
    readFileSync(f.saved.receipt.dimensions[0].local_path).equals(f.bytes),
    true,
  );
});

test("unapproved inputs and secret/customer-shaped prototype text fail", (t) => {
  const f = fixture(t);
  assert.throws(
    () => f.builder.prepare({
      receiptFile: f.saved.receiptFile,
      approvedEntry: {
        ...f.approvedEntry,
        license: { spdx: "LicenseRef-Proprietary" },
      },
      goal: "Prototype.",
    }),
    /approved MIT/,
  );
  assert.throws(
    () => f.builder.prepare({
      receiptFile: f.saved.receiptFile,
      approvedEntry: f.approvedEntry,
      goal: "Use token=customer-secret in production.",
    }),
    /non-secret prototype text/,
  );
});
