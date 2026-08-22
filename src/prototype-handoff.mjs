import { randomUUID, createHash } from "node:crypto";
import {
  chmodSync,
  readFileSync,
  statSync,
} from "node:fs";
import path from "node:path";

import {
  ensurePrivateDirectory,
  writePrivateBytes,
  writePrivateJson,
} from "./estate-store.mjs";
import { LocalSummonStore } from "./local-drill.mjs";

export const PROTOTYPE_HANDOFF_SCHEMA = "rapp-zoo-prototype-handoff/2.0";
const SECRET = /(?:github_pat_|gh[pousr]_[a-z0-9]+|bearer\s+\S+|(?:password|token|secret)\s*[:=]\s*\S+)/i;

function safeText(value, label, max = 4000) {
  if (
    typeof value !== "string"
    || !value.trim()
    || value.length > max
    || value !== value.normalize("NFC")
    || SECRET.test(value)
  ) {
    throw new Error(`${label} must be non-secret prototype text.`);
  }
  return value;
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function extension(mediaType) {
  if (mediaType === "application/json") return "json";
  if (mediaType === "text/markdown") return "md";
  if (mediaType === "text/plain") return "txt";
  return mediaType.split("/")[1] || "bin";
}

export class PrototypeHandoffBuilder {
  constructor({
    estateHome,
    summonStore,
    now = () => new Date(),
    uuid = randomUUID,
  }) {
    if (!(summonStore instanceof LocalSummonStore)) {
      throw new Error("Prototype handoff requires a LocalSummonStore.");
    }
    this.root = ensurePrivateDirectory(path.join(estateHome, "prototypes"));
    this.summonStore = summonStore;
    this.now = now;
    this.uuid = uuid;
  }

  prepare({
    receiptFile,
    approvedEntry,
    goal,
    assumptions = [],
    acceptanceCriteria = [],
  }) {
    if (
      approvedEntry?.approval?.scope !== "public-telephone-line"
      || approvedEntry?.license?.spdx !== "MIT"
      || approvedEntry?.local_receipt?.receipt_file !== receiptFile
    ) {
      throw new Error("Prototype handoff requires an approved MIT local summon.");
    }
    const local = this.summonStore.open(receiptFile);
    const handoffId = this.uuid();
    const workspace = ensurePrivateDirectory(path.join(this.root, handoffId));
    const inputDirectory = ensurePrivateDirectory(path.join(workspace, "inputs"));
    const inputs = [];
    for (const dimension of local.receipt.dimensions) {
      const bytes = readFileSync(dimension.local_path);
      if (
        ["application/json", "text/plain", "text/markdown"].includes(
          dimension.media_type,
        )
        && SECRET.test(bytes.toString("utf8"))
      ) {
        throw new Error(`Prototype input ${dimension.name} contains secret-shaped data.`);
      }
      const relative = path.join(
        "inputs",
        `${dimension.name}.${extension(dimension.media_type)}`,
      );
      const target = path.join(workspace, relative);
      writePrivateBytes(target, bytes);
      try {
        chmodSync(target, 0o600);
      } catch {
        // Windows does not expose POSIX modes.
      }
      inputs.push({
        dimension: dimension.name,
        path: relative.split(path.sep).join("/"),
        media_type: dimension.media_type,
        source_sha256: dimension.sha256,
        copied_sha256: sha256(readFileSync(target)),
        bytes: statSync(target).size,
        mutable: true,
      });
    }
    const handoff = {
      schema: PROTOTYPE_HANDOFF_SCHEMA,
      handoff_id: handoffId,
      stage: "prototype",
      non_production: true,
      default_protocol: "rapp/1",
      factory: "any-capable-agent-factory",
      goal: safeText(goal, "Prototype goal"),
      assumptions: assumptions.map((entry) => safeText(entry, "Prototype assumption")),
      acceptance_criteria: acceptanceCriteria.map(
        (entry) => safeText(entry, "Prototype acceptance criterion"),
      ),
      source: {
        object_id: local.receipt.object_id,
        manifest_sha256: local.receipt.manifest_sha256,
        summon_rappid: approvedEntry.rappid,
        summon_alias: approvedEntry.alias,
        license: approvedEntry.license.spdx,
      },
      mutation_policy: "mutate-workspace-copy-never-source-receipt",
      customer_data_policy: "absent-use-synthetic-or-sanitized-prototype-data-only",
      productionization: {
        required: true,
        next_stage: "governed-customer-sdlc",
        customer_data_may_enter_here: false,
      },
      inputs,
      created_utc: this.now().toISOString(),
    };
    const handoffFile = path.join(workspace, "handoff.json");
    writePrivateJson(handoffFile, handoff);
    return { workspace, handoffFile, handoff };
  }
}
