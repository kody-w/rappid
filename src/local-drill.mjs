import { createHash } from "node:crypto";
import {
  existsSync,
  lstatSync,
  readFileSync,
  readdirSync,
} from "node:fs";
import path from "node:path";
import { TextDecoder } from "node:util";

import {
  ensurePrivateDirectory,
  writePrivateBytes,
  writePrivateJson,
} from "./estate-store.mjs";
import { parseIJson } from "./rapp1.mjs";

export const LOCAL_SUMMON_SCHEMA = "rapp-zoo-local-summon/2.0";
export const LOCAL_DRILL_SCHEMA = "rapp-zoo-local-drill/2.0";
const SHA256 = /^[0-9a-f]{64}$/;
const NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function digest(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

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

function validateReceipt(value, localRoot) {
  exactKeys(
    value,
    [
      "schema",
      "object_id",
      "manifest_sha256",
      "saved_utc",
      "dimensions",
    ],
    "Local summon receipt",
  );
  if (
    value.schema !== LOCAL_SUMMON_SCHEMA
    || value.object_id !== `sha256:${value.manifest_sha256}`
    || !SHA256.test(value.manifest_sha256)
    || typeof value.saved_utc !== "string"
    || !Array.isArray(value.dimensions)
    || value.dimensions.length < 1
  ) {
    throw new Error("Local summon receipt is invalid.");
  }
  const safeRoot = `${path.resolve(localRoot)}${path.sep}`;
  const names = new Set();
  for (const entry of value.dimensions) {
    exactKeys(
      entry,
      ["name", "media_type", "bytes", "sha256", "local_path"],
      "Local summon dimension",
    );
    if (
      typeof entry.name !== "string"
      || !NAME.test(entry.name)
      || names.has(entry.name)
      || !SHA256.test(entry.sha256)
      || !Number.isSafeInteger(entry.bytes)
      || entry.bytes < 0
      || typeof entry.media_type !== "string"
      || typeof entry.local_path !== "string"
      || !path.resolve(entry.local_path).startsWith(safeRoot)
    ) {
      throw new Error("Local summon dimension is invalid.");
    }
    names.add(entry.name);
  }
  return value;
}

function verifyLocalDimension(entry, localRoot) {
  const file = path.resolve(entry.local_path);
  if (!file.startsWith(`${path.resolve(localRoot)}${path.sep}`)) {
    throw new Error("Local summon path escapes its private root.");
  }
  if (!existsSync(file)) throw new Error("Local summon dimension is not saved.");
  const stats = lstatSync(file);
  if (!stats.isFile() || stats.isSymbolicLink()) {
    throw new Error("Local summon dimension must be a saved regular file.");
  }
  const bytes = readFileSync(file);
  if (bytes.length !== entry.bytes || digest(bytes) !== entry.sha256) {
    throw new Error("Local summon dimension failed saved-byte verification.");
  }
  let value = null;
  if (
    entry.media_type === "application/json"
    || entry.media_type === "text/plain"
    || entry.media_type === "text/markdown"
  ) {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    value = entry.media_type === "application/json" ? parseIJson(text) : text;
  }
  return { bytes, value };
}

export class LocalSummonStore {
  constructor({ estateHome, now = () => new Date() }) {
    this.estateHome = ensurePrivateDirectory(path.resolve(estateHome));
    this.root = ensurePrivateDirectory(
      path.join(this.estateHome, "local-summons"),
    );
    this.now = now;
  }

  save(loadedGlobalObject) {
    const dimensions = Object.entries(loadedGlobalObject?.dimensions || {});
    const declaredNames = loadedGlobalObject?.manifest?.dimensions
      ?.map((entry) => entry.name)
      .sort();
    const loadedNames = dimensions.map(([name]) => name).sort();
    if (
      !loadedGlobalObject?.receipt
      || !SHA256.test(loadedGlobalObject.receipt.manifest_sha256)
      || dimensions.length === 0
      || !Array.isArray(declaredNames)
      || declaredNames.length !== loadedNames.length
      || declaredNames.some((name, index) => name !== loadedNames[index])
      || !Array.isArray(loadedGlobalObject.receipt.loaded_dimensions)
      || loadedGlobalObject.receipt.loaded_dimensions.length !== loadedNames.length
      || loadedGlobalObject.receipt.loaded_dimensions
        .some((name, index) => name !== loadedNames[index])
    ) {
      throw new Error("Only a fully loaded verified global object can be saved.");
    }
    const directory = ensurePrivateDirectory(
      path.join(this.root, loadedGlobalObject.receipt.manifest_sha256),
    );
    const receipt = {
      schema: LOCAL_SUMMON_SCHEMA,
      object_id: loadedGlobalObject.receipt.object_id,
      manifest_sha256: loadedGlobalObject.receipt.manifest_sha256,
      saved_utc: this.now().toISOString(),
      dimensions: dimensions.map(([name, entry]) => {
        const source = {
          name,
          media_type: entry.media_type,
          bytes: entry.bytes,
          sha256: entry.sha256,
          local_path: entry.local_path,
        };
        const verified = verifyLocalDimension(source, this.estateHome);
        const extension = entry.media_type === "application/json"
          ? "json"
          : entry.media_type.startsWith("text/")
            ? "txt"
            : entry.media_type.split("/")[1];
        const localPath = path.join(directory, `${name}.${extension}`);
        writePrivateBytes(localPath, verified.bytes);
        const record = {
          name,
          media_type: entry.media_type,
          bytes: entry.bytes,
          sha256: entry.sha256,
          local_path: localPath,
        };
        verifyLocalDimension(record, this.root);
        return record;
      }).sort((left, right) => left.name.localeCompare(right.name)),
    };
    validateReceipt(receipt, this.root);
    const receiptFile = path.join(directory, "receipt.json");
    writePrivateJson(receiptFile, receipt);
    return { receipt, receiptFile };
  }

  open(receiptFile) {
    if (
      typeof receiptFile !== "string"
      || /^https?:\/\//i.test(receiptFile)
    ) {
      throw new Error("Quantum Drill accepts only a local summon receipt path.");
    }
    const resolved = path.resolve(receiptFile);
    if (!resolved.startsWith(`${this.root}${path.sep}`)) {
      throw new Error("Quantum Drill receipt is outside the local summon store.");
    }
    if (!existsSync(resolved)) throw new Error("Quantum Drill summon is not local.");
    const stats = lstatSync(resolved);
    if (!stats.isFile() || stats.isSymbolicLink()) {
      throw new Error("Quantum Drill receipt must be a local regular file.");
    }
    const receipt = validateReceipt(
      parseIJson(readFileSync(resolved, "utf8")),
      this.root,
    );
    const dimensions = Object.fromEntries(
      receipt.dimensions.map((entry) => {
        const verified = verifyLocalDimension(entry, this.root);
        return [entry.name, {
          media_type: entry.media_type,
          bytes: entry.bytes,
          sha256: entry.sha256,
          value: verified.value,
        }];
      }),
    );
    return { receipt, dimensions };
  }

  receipts() {
    return readdirSync(this.root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && SHA256.test(entry.name))
      .map((entry) => path.join(this.root, entry.name, "receipt.json"))
      .filter(existsSync)
      .sort();
  }
}

export class LocalQuantumDrill {
  constructor({ summonStore }) {
    if (!(summonStore instanceof LocalSummonStore)) {
      throw new Error("LocalQuantumDrill requires a LocalSummonStore.");
    }
    this.summonStore = summonStore;
  }

  lookup({ dimension, sha256 = null }) {
    if (typeof dimension !== "string" || !NAME.test(dimension)) {
      throw new Error("Quantum Drill dimension name is invalid.");
    }
    if (sha256 !== null && !SHA256.test(sha256)) {
      throw new Error("Quantum Drill digest is invalid.");
    }
    const matches = [];
    for (const receiptFile of this.summonStore.receipts()) {
      const local = this.summonStore.open(receiptFile);
      const entry = local.dimensions[dimension];
      if (entry && (sha256 === null || entry.sha256 === sha256)) {
        matches.push({
          object_id: local.receipt.object_id,
          dimension,
          media_type: entry.media_type,
          bytes: entry.bytes,
          sha256: entry.sha256,
          value: entry.value,
        });
      }
    }
    return {
      schema: LOCAL_DRILL_SCHEMA,
      source: "local-saved-summons-only",
      dimension,
      digest: sha256,
      matches,
    };
  }
}
