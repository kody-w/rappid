import { createHash } from "node:crypto";
import {
  existsSync,
  lstatSync,
  readFileSync,
} from "node:fs";
import path from "node:path";

import {
  ensurePrivateDirectory,
  writePrivateBytes,
  writePrivateJson,
} from "./estate-store.mjs";
import { PROTOTYPE_HANDOFF_SCHEMA } from "./prototype-handoff.mjs";
import {
  canonical,
  parseIJson,
} from "./rapp1.mjs";
import { decodeUtf8 } from "./http.mjs";

export const PROTOTYPE_TRANSFER_SCHEMA = "rapp-zoo-prototype-transfer/2.0";
const SHA256 = /^[0-9a-f]{64}$/;
const MAX_TRANSFER_BYTES = 512 * 1024;

function digest(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function safeRelative(value) {
  if (
    typeof value !== "string"
    || !value
    || value.includes("\\")
    || value.startsWith("/")
    || value.split("/").some((segment) => !segment || segment === "." || segment === "..")
  ) {
    throw new Error("Prototype transfer path must be safe relative POSIX.");
  }
  return value;
}

function transferHash(value) {
  const unsigned = structuredClone(value);
  delete unsigned.transfer_hash;
  return digest(Buffer.from(canonical(unsigned), "utf8"));
}

export function exportPrototypeTransfer({
  handoffFile,
  outputFile,
  now = () => new Date(),
}) {
  const workspace = path.dirname(path.resolve(handoffFile));
  const handoff = parseIJson(
    decodeUtf8(readFileSync(handoffFile), "Prototype handoff"),
  );
  if (
    handoff.schema !== PROTOTYPE_HANDOFF_SCHEMA
    || handoff.stage !== "prototype"
    || handoff.non_production !== true
    || !Array.isArray(handoff.inputs)
  ) {
    throw new Error("Only a non-production prototype handoff can be transferred.");
  }
  const files = [];
  const seen = new Set();
  let totalBytes = 0;
  for (const input of handoff.inputs) {
    const relative = safeRelative(input.path);
    if (seen.has(relative)) throw new Error("Prototype transfer paths must be unique.");
    seen.add(relative);
    const file = path.resolve(workspace, ...relative.split("/"));
    if (!file.startsWith(`${workspace}${path.sep}`)) {
      throw new Error("Prototype transfer input escapes its workspace.");
    }
    const stats = lstatSync(file);
    if (!stats.isFile() || stats.isSymbolicLink()) {
      throw new Error("Prototype transfer inputs must be regular files.");
    }
    const bytes = readFileSync(file);
    totalBytes += bytes.length;
    if (totalBytes > MAX_TRANSFER_BYTES) {
      throw new Error(
        `Prototype transfer inputs exceed the ${MAX_TRANSFER_BYTES}-byte prototype limit.`,
      );
    }
    files.push({
      path: relative,
      bytes: bytes.length,
      sha256: digest(bytes),
      content_base64: bytes.toString("base64"),
    });
  }
  const transfer = {
    schema: PROTOTYPE_TRANSFER_SCHEMA,
    handoff_id: handoff.handoff_id,
    stage: "prototype",
    non_production: true,
    federation_ready: false,
    transport: "cross-device-prototype-data",
    source_rappid: handoff.source.summon_rappid,
    created_utc: now().toISOString(),
    handoff,
    files,
    transfer_hash: null,
  };
  transfer.transfer_hash = transferHash(transfer);
  writePrivateJson(path.resolve(outputFile), transfer);
  return transfer;
}

export function validatePrototypeTransfer(value) {
  if (
    !value
    || typeof value !== "object"
    || Array.isArray(value)
    || value.schema !== PROTOTYPE_TRANSFER_SCHEMA
    || value.stage !== "prototype"
    || value.non_production !== true
    || value.federation_ready !== false
    || value.transport !== "cross-device-prototype-data"
    || value.handoff?.schema !== PROTOTYPE_HANDOFF_SCHEMA
    || !Array.isArray(value.files)
    || !SHA256.test(String(value.transfer_hash))
    || transferHash(value) !== value.transfer_hash
  ) {
    throw new Error("Prototype transfer is invalid or integrity-drifted.");
  }
  const seen = new Set();
  let totalBytes = 0;
  for (const file of value.files) {
    const relative = safeRelative(file.path);
    if (
      seen.has(relative)
      || !Number.isSafeInteger(file.bytes)
      || file.bytes < 0
      || !SHA256.test(file.sha256)
      || typeof file.content_base64 !== "string"
    ) {
      throw new Error("Prototype transfer contains an invalid file entry.");
    }
    seen.add(relative);
    const bytes = Buffer.from(file.content_base64, "base64");
    totalBytes += bytes.length;
    if (totalBytes > MAX_TRANSFER_BYTES) {
      throw new Error("Prototype transfer exceeds the portable prototype limit.");
    }
    if (
      bytes.toString("base64") !== file.content_base64
      || bytes.length !== file.bytes
      || digest(bytes) !== file.sha256
    ) {
      throw new Error("Prototype transfer file failed byte/hash verification.");
    }
  }
  return value;
}

export function importPrototypeTransfer({
  transferFile,
  estateHome,
}) {
  const transfer = validatePrototypeTransfer(
    parseIJson(
      decodeUtf8(
        readFileSync(path.resolve(transferFile)),
        "Prototype transfer",
      ),
    ),
  );
  const root = ensurePrivateDirectory(
    path.join(path.resolve(estateHome), "imported-prototypes"),
  );
  const workspace = ensurePrivateDirectory(
    path.join(root, transfer.handoff_id),
  );
  for (const file of transfer.files) {
    const target = path.join(workspace, ...file.path.split("/"));
    if (existsSync(target)) {
      const current = readFileSync(target);
      if (digest(current) !== file.sha256) {
        throw new Error("Imported prototype conflicts with existing local bytes.");
      }
      continue;
    }
    writePrivateBytes(target, Buffer.from(file.content_base64, "base64"));
  }
  const handoffFile = path.join(workspace, "handoff.json");
  if (existsSync(handoffFile)) {
    const current = parseIJson(
      decodeUtf8(readFileSync(handoffFile), "Imported prototype handoff"),
    );
    if (canonical(current) !== canonical(transfer.handoff)) {
      throw new Error("Imported prototype handoff conflicts with existing lineage.");
    }
  } else {
    writePrivateJson(handoffFile, transfer.handoff);
  }
  return {
    workspace,
    handoffFile,
    handoff_id: transfer.handoff_id,
    source_rappid: transfer.source_rappid,
    federation_ready: false,
  };
}
