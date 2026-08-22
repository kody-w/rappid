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

import { writePrivateBytes, writePrivateJson } from "../src/estate-store.mjs";
import {
  exportPrototypeTransfer,
  importPrototypeTransfer,
  validatePrototypeTransfer,
} from "../src/prototype-transfer.mjs";
import { canonical } from "../src/rapp1.mjs";

function fixture(t) {
  const root = mkdtempSync(path.join(os.tmpdir(), "rapp-zoo-transfer-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const workspace = path.join(root, "source");
  const input = path.join(workspace, "inputs", "template.json");
  writePrivateBytes(input, '{"prototype":true}');
  const handoff = {
    schema: "rapp-zoo-prototype-handoff/2.0",
    handoff_id: "00000000-0000-4000-8000-000000000050",
    stage: "prototype",
    non_production: true,
    default_protocol: "rapp/1",
    factory: "any-capable-agent-factory",
    goal: "Prototype a portable neighborhood.",
    assumptions: [],
    acceptance_criteria: [],
    source: {
      object_id: `sha256:${"f".repeat(64)}`,
      manifest_sha256: "f".repeat(64),
      summon_rappid: `rappid:@kody-w/template:${"a".repeat(64)}`,
      summon_alias: "template",
      license: "MIT",
    },
    mutation_policy: "mutate-workspace-copy-never-source-receipt",
    customer_data_policy: "absent-use-synthetic-or-sanitized-prototype-data-only",
    productionization: {
      required: true,
      next_stage: "governed-customer-sdlc",
      customer_data_may_enter_here: false,
    },
    inputs: [{
      dimension: "template",
      path: "inputs/template.json",
      media_type: "application/json",
      source_sha256: "x",
      copied_sha256: "y",
      bytes: 18,
      mutable: true,
    }],
    created_utc: "2026-08-22T12:00:00.000Z",
  };
  const handoffFile = path.join(workspace, "handoff.json");
  writePrivateJson(handoffFile, handoff);
  return { handoffFile, input, root };
}

test("prototype transfer moves data and lineage without runtime authority", (t) => {
  const f = fixture(t);
  const output = path.join(f.root, "portable.rapp-prototype.json");
  const transfer = exportPrototypeTransfer({
    handoffFile: f.handoffFile,
    outputFile: output,
    now: () => new Date("2026-08-22T12:01:00.000Z"),
  });
  assert.equal(validatePrototypeTransfer(transfer), transfer);
  assert.equal(transfer.federation_ready, false);
  const encoded = JSON.stringify(transfer);
  for (const forbidden of ["control.json", "autopilot.json", "instance_token", "user_data", "\"pid\""]) {
    assert.equal(encoded.includes(forbidden), false);
  }
  const destination = path.join(f.root, "destination");
  const imported = importPrototypeTransfer({
    transferFile: output,
    estateHome: destination,
  });
  assert.equal(imported.source_rappid, transfer.source_rappid);
  assert.equal(
    readFileSync(path.join(imported.workspace, "inputs", "template.json"), "utf8"),
    '{"prototype":true}',
  );
});

test("transfer tampering and conflicting local import fail closed", (t) => {
  const f = fixture(t);
  const output = path.join(f.root, "portable.rapp-prototype.json");
  exportPrototypeTransfer({
    handoffFile: f.handoffFile,
    outputFile: output,
  });

  const value = JSON.parse(readFileSync(output, "utf8"));
  value.files[0].content_base64 = Buffer.from("tampered").toString("base64");
  assert.throws(() => validatePrototypeTransfer(value), /integrity|byte\/hash/);

  const destination = path.join(f.root, "destination");
  const first = importPrototypeTransfer({
    transferFile: output,
    estateHome: destination,
  });
  writeFileSync(path.join(first.workspace, "inputs", "template.json"), "conflict");
  assert.throws(
    () => importPrototypeTransfer({
      transferFile: output,
      estateHome: destination,
    }),
    /conflicts/,
  );
});

test("prototype mutation cannot silently outgrow the portable transfer profile", (t) => {
  const f = fixture(t);
  writeFileSync(f.input, Buffer.alloc(512 * 1024 + 1, 0x61));
  assert.throws(
    () => exportPrototypeTransfer({
      handoffFile: f.handoffFile,
      outputFile: path.join(f.root, "too-large.json"),
    }),
    /prototype limit/,
  );
});

test("import refuses malformed UTF-8 and oversized externally constructed transfers", (t) => {
  const f = fixture(t);
  const malformed = path.join(f.root, "malformed.json");
  writeFileSync(malformed, Buffer.from([0x7b, 0x22, 0x78, 0x22, 0x3a, 0x22, 0xff, 0x22, 0x7d]));
  assert.throws(
    () => importPrototypeTransfer({
      transferFile: malformed,
      estateHome: path.join(f.root, "destination"),
    }),
    /invalid UTF-8/,
  );

  const output = path.join(f.root, "portable.json");
  const transfer = exportPrototypeTransfer({
    handoffFile: f.handoffFile,
    outputFile: output,
  });
  const content = Buffer.alloc(512 * 1024 + 1, 0x61);
  transfer.files = [{
    path: "inputs/large.bin",
    bytes: content.length,
    sha256: createHash("sha256").update(content).digest("hex"),
    content_base64: content.toString("base64"),
  }];
  const unsigned = structuredClone(transfer);
  delete unsigned.transfer_hash;
  transfer.transfer_hash = createHash("sha256")
    .update(Buffer.from(canonical(unsigned), "utf8"))
    .digest("hex");
  assert.throws(
    () => validatePrototypeTransfer(transfer),
    /portable prototype limit/,
  );
});
