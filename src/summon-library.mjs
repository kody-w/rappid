import {
  closeSync,
  constants,
  existsSync,
  fsyncSync,
  openSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

import {
  readPrivateJson,
  writePrivateJson,
} from "./estate-store.mjs";
import {
  pinnedRawUrl,
} from "./global-object.mjs";
import {
  LocalSummonStore,
} from "./local-drill.mjs";
import {
  validateRappid,
} from "./rapp1.mjs";

export const SUMMON_LIBRARY_SCHEMA = "rapp-zoo-summon-library/2.0";
export const SUMMON_ENTRY_SCHEMA = "rapp-zoo-approved-summon/2.0";
export const SUMMON_LINE_SCHEMA = "rapp-zoo-summon-line/2.0";
const ALIAS = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SHA256 = /^[0-9a-f]{64}$/;
const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9a-z.-]+)?$/;

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

function validateEntry(entry, {
  approvedLicenses,
  allowMissingLocalReceipt = true,
} = {}) {
  exactKeys(
    entry,
    [
      "schema",
      "alias",
      "rappid",
      "name",
      "version",
      "license",
      "manifest",
      "local_receipt",
      "approval",
    ],
    "Approved summon",
  );
  exactKeys(entry.license, ["spdx", "url", "sha256"], "Summon license");
  exactKeys(entry.manifest, ["url", "sha256"], "Summon manifest");
  exactKeys(
    entry.approval,
    ["approved_by", "approved_utc", "scope"],
    "Summon approval",
  );
  if (
    entry.schema !== SUMMON_ENTRY_SCHEMA
    || !ALIAS.test(entry.alias)
    || !validateRappid(entry.rappid)
    || typeof entry.name !== "string"
    || !entry.name
    || entry.name.length > 100
    || !SEMVER.test(entry.version)
    || typeof entry.license.spdx !== "string"
    || !approvedLicenses.has(entry.license.spdx)
    || !SHA256.test(entry.license.sha256)
    || !SHA256.test(entry.manifest.sha256)
    || entry.approval.approved_by !== "local-operator"
    || typeof entry.approval.approved_utc !== "string"
    || entry.approval.scope !== "public-telephone-line"
  ) {
    throw new Error("Approved summon entry is invalid or not publicly licensed.");
  }
  pinnedRawUrl(entry.license.url);
  pinnedRawUrl(entry.manifest.url);
  if (entry.local_receipt !== null) {
    exactKeys(
      entry.local_receipt,
      ["object_id", "manifest_sha256", "receipt_file"],
      "Local summon binding",
    );
    if (
      entry.local_receipt.object_id !== `sha256:${entry.manifest.sha256}`
      || entry.local_receipt.manifest_sha256 !== entry.manifest.sha256
      || typeof entry.local_receipt.receipt_file !== "string"
      || /^https?:\/\//i.test(entry.local_receipt.receipt_file)
    ) {
      throw new Error("Approved summon local receipt is invalid.");
    }
  } else if (!allowMissingLocalReceipt) {
    throw new Error("Public approval requires a verified local summon receipt.");
  }
  return entry;
}

function emptyLibrary() {
  return { schema: SUMMON_LIBRARY_SCHEMA, entries: [] };
}

export class SummonLibrary {
  constructor({
    estateHome,
    summonStore,
    approvedLicenses = new Set(["MIT"]),
    now = () => new Date(),
  }) {
    if (!(summonStore instanceof LocalSummonStore)) {
      throw new Error("SummonLibrary requires a LocalSummonStore.");
    }
    this.summonStore = summonStore;
    this.approvedLicenses = approvedLicenses;
    this.now = now;
    this.file = path.join(path.resolve(estateHome), "approved-summons.json");
    this.lockFile = path.join(path.resolve(estateHome), ".summon-library.lock");
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
        throw new Error("Summon library lock exists; update is fail-closed.");
      }
      throw error;
    }
    try {
      writeFileSync(descriptor, `${process.pid}\n`);
      fsyncSync(descriptor);
      return callback();
    } finally {
      closeSync(descriptor);
      rmSync(this.lockFile, { force: true });
    }
  }

  #read() {
    const library = existsSync(this.file)
      ? readPrivateJson(this.file, "Summon library")
      : emptyLibrary();
    exactKeys(library, ["schema", "entries"], "Summon library");
    if (
      library.schema !== SUMMON_LIBRARY_SCHEMA
      || !Array.isArray(library.entries)
    ) {
      throw new Error("Summon library is invalid.");
    }
    const aliases = new Set();
    const rappids = new Set();
    for (const entry of library.entries) {
      validateEntry(entry, { approvedLicenses: this.approvedLicenses });
      if (aliases.has(entry.alias) || rappids.has(entry.rappid)) {
        throw new Error("Summon library aliases and rappids must be unique.");
      }
      aliases.add(entry.alias);
      rappids.add(entry.rappid);
    }
    return library;
  }

  list() {
    return structuredClone(this.#read().entries);
  }

  approve({
    alias,
    rappid,
    name,
    version,
    spdx,
    licenseUrl,
    licenseSha256,
    manifestUrl,
    manifestSha256,
    receiptFile,
    licenseDimension = "license",
  }) {
    return this.#withLock(() => {
      if (!this.approvedLicenses.has(spdx)) {
        throw new Error(`License ${spdx} is not approved for the public summon line.`);
      }
      const local = this.summonStore.open(receiptFile);
      if (
        local.receipt.manifest_sha256 !== manifestSha256
        || local.receipt.object_id !== `sha256:${manifestSha256}`
      ) {
        throw new Error("Local summon receipt does not bind the approved manifest.");
      }
      const license = local.dimensions[licenseDimension];
      if (
        !license
        || typeof license.value !== "string"
        || license.sha256 !== licenseSha256
        || !license.value.includes("MIT License")
      ) {
        throw new Error("Summon license text is not locally saved and verified.");
      }
      const entry = {
        schema: SUMMON_ENTRY_SCHEMA,
        alias,
        rappid,
        name,
        version,
        license: {
          spdx,
          url: pinnedRawUrl(licenseUrl),
          sha256: licenseSha256,
        },
        manifest: {
          url: pinnedRawUrl(manifestUrl),
          sha256: manifestSha256,
        },
        local_receipt: {
          object_id: local.receipt.object_id,
          manifest_sha256: local.receipt.manifest_sha256,
          receipt_file: path.resolve(receiptFile),
        },
        approval: {
          approved_by: "local-operator",
          approved_utc: this.now().toISOString(),
          scope: "public-telephone-line",
        },
      };
      validateEntry(entry, {
        approvedLicenses: this.approvedLicenses,
        allowMissingLocalReceipt: false,
      });
      const library = this.#read();
      const conflict = library.entries.find(
        (candidate) => (
          candidate.alias === entry.alias
          || candidate.rappid === entry.rappid
        ),
      );
      if (conflict) {
        if (JSON.stringify(conflict) === JSON.stringify(entry)) return conflict;
        throw new Error("Summon alias or rappid is already approved differently.");
      }
      library.entries.push(entry);
      library.entries.sort((left, right) => left.alias.localeCompare(right.alias));
      writePrivateJson(this.file, library);
      return structuredClone(entry);
    });
  }

  publicCatalog() {
    return {
      schema: SUMMON_LINE_SCHEMA,
      generated_utc: this.now().toISOString(),
      summons: this.#read().entries.map((entry) => ({
        schema: entry.schema,
        alias: entry.alias,
        rappid: entry.rappid,
        name: entry.name,
        version: entry.version,
        license: structuredClone(entry.license),
        manifest: structuredClone(entry.manifest),
        approval: structuredClone(entry.approval),
      })),
    };
  }

  importCatalog(catalog) {
    exactKeys(catalog, ["schema", "generated_utc", "summons"], "Summon line");
    if (
      catalog.schema !== SUMMON_LINE_SCHEMA
      || typeof catalog.generated_utc !== "string"
      || !Array.isArray(catalog.summons)
    ) {
      throw new Error("Summon line catalog is invalid.");
    }
    return this.#withLock(() => {
      const library = this.#read();
      for (const publicEntry of catalog.summons) {
        const entry = { ...structuredClone(publicEntry), local_receipt: null };
        validateEntry(entry, { approvedLicenses: this.approvedLicenses });
        const conflict = library.entries.find((candidate) => (
          candidate.alias === entry.alias
          || candidate.rappid === entry.rappid
        ));
        if (conflict) {
          const samePublicEntry = conflict.alias === entry.alias
            && conflict.rappid === entry.rappid
            && conflict.name === entry.name
            && conflict.version === entry.version
            && JSON.stringify(conflict.license) === JSON.stringify(entry.license)
            && JSON.stringify(conflict.manifest) === JSON.stringify(entry.manifest)
            && JSON.stringify(conflict.approval) === JSON.stringify(entry.approval);
          if (!samePublicEntry) {
            throw new Error(
              "Summon catalog conflicts with an existing alias or rappid.",
            );
          }
          continue;
        }
        library.entries.push(entry);
      }
      library.entries.sort((left, right) => left.alias.localeCompare(right.alias));
      writePrivateJson(this.file, library);
      return structuredClone(library.entries);
    });
  }

  async dial(alias, { globalLoader }) {
    const library = this.#read();
    const entry = library.entries.find((candidate) => candidate.alias === alias);
    if (!entry) throw new Error(`Summon ${alias} is not in the approved library.`);
    if (entry.local_receipt) {
      return {
        source: "local",
        entry: structuredClone(entry),
        summon: this.summonStore.open(entry.local_receipt.receipt_file),
      };
    }
    if (!globalLoader || typeof globalLoader.load !== "function") {
      throw new Error("Approved summon is not local and no telephone-line loader is available.");
    }
    const loaded = await globalLoader.load({
      manifestUrl: entry.manifest.url,
      manifestSha256: entry.manifest.sha256,
    });
    const saved = this.summonStore.save(loaded);
    entry.local_receipt = {
      object_id: saved.receipt.object_id,
      manifest_sha256: saved.receipt.manifest_sha256,
      receipt_file: saved.receiptFile,
    };
    validateEntry(entry, { approvedLicenses: this.approvedLicenses });
    this.#withLock(() => {
      const latest = this.#read();
      const index = latest.entries.findIndex(
        (candidate) => candidate.alias === alias,
      );
      latest.entries[index] = entry;
      writePrivateJson(this.file, latest);
    });
    return {
      source: "telephone-line-then-local",
      entry: structuredClone(entry),
      summon: this.summonStore.open(saved.receiptFile),
    };
  }
}
