import {
  chmodSync,
  closeSync,
  constants,
  existsSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

import {
  createEstateManifest,
  createResidentNeighborhood,
  validateEstate,
} from "./contracts.mjs";
import {
  parseIJson,
  validateRappid,
} from "./rapp1.mjs";
import { decodeUtf8 } from "./http.mjs";

export const CLAIMS_SCHEMA = "rapp-zoo-claims/2.0";
export const TRANSACTION_SCHEMA = "rapp-zoo-membership-transaction/2.0";

function privateDirectory(directory) {
  if (existsSync(directory) && lstatSync(directory).isSymbolicLink()) {
    throw new Error(`Managed root cannot be a symlink: ${directory}`);
  }
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const stats = lstatSync(directory);
  if (!stats.isDirectory() || stats.isSymbolicLink()) {
    throw new Error(`Managed root must be a real directory: ${directory}`);
  }
  try {
    chmodSync(directory, 0o700);
  } catch {
    // Windows does not expose POSIX modes.
  }
  return realpathSync(directory);
}

function privateBytes(file, bytes) {
  privateDirectory(path.dirname(file));
  const temporary = `${file}.${process.pid}.${Date.now()}.tmp`;
  const descriptor = openSync(
    temporary,
    constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY,
    0o600,
  );
  try {
    writeFileSync(descriptor, bytes);
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
  renameSync(temporary, file);
  try {
    chmodSync(file, 0o600);
  } catch {
    // Windows does not expose POSIX modes.
  }
}

function privateJson(file, value) {
  privateBytes(file, `${JSON.stringify(value, null, 2)}\n`);
}

function readJson(file, label) {
  if (!existsSync(file)) return null;
  const stats = lstatSync(file);
  if (!stats.isFile() || stats.isSymbolicLink()) {
    throw new Error(`${label} must be a regular file.`);
  }
  return parseIJson(decodeUtf8(readFileSync(file), label));
}

export {
  privateDirectory as ensurePrivateDirectory,
  privateBytes as writePrivateBytes,
  privateJson as writePrivateJson,
  readJson as readPrivateJson,
};

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

function identityRecord(estate) {
  return {
    schema: "rapp/1",
    rappid: estate.rappid,
    parent_rappid: estate.parent_neighborhood_id,
  };
}

function validateIdentity(value, estate) {
  exactKeys(value, ["schema", "rappid", "parent_rappid"], "rappid.json");
  if (
    value.schema !== "rapp/1"
    || !validateRappid(value.rappid)
    || value.rappid !== estate.rappid
    || value.parent_rappid !== estate.parent_neighborhood_id
  ) {
    throw new Error("rappid.json conflicts with the durable estate identity.");
  }
  return value;
}

function emptyClaims() {
  return { schema: CLAIMS_SCHEMA, claims: {} };
}

function validateClaims(value) {
  exactKeys(value, ["schema", "claims"], "Claims registry");
  if (
    value.schema !== CLAIMS_SCHEMA
    || !value.claims
    || typeof value.claims !== "object"
    || Array.isArray(value.claims)
  ) {
    throw new Error("Claims registry is invalid.");
  }
  for (const [rappid, claim] of Object.entries(value.claims)) {
    if (!validateRappid(rappid)) {
      throw new Error("Claims registry contains an invalid rappid.");
    }
    exactKeys(claim, ["estate_id", "kind", "base_url"], "Neighborhood claim");
    if (
      typeof claim.estate_id !== "string"
      || !["root", "resident"].includes(claim.kind)
      || (claim.kind === "root" && claim.base_url !== null)
      || (claim.kind === "resident" && typeof claim.base_url !== "string")
    ) {
      throw new Error("Claims registry contains an invalid claim.");
    }
  }
  return value;
}

function claimFor(neighborhood) {
  return {
    estate_id: neighborhood.estate_id,
    kind: neighborhood.kind,
    base_url: neighborhood.base_url,
  };
}

export class EstateStore {
  constructor({
    rootDir,
    estateHome = null,
    now = () => new Date(),
  }) {
    if (!rootDir) throw new Error("EstateStore requires rootDir.");
    const requestedRoot = path.resolve(rootDir);
    this.rootDir = privateDirectory(requestedRoot);
    this.estatesDir = privateDirectory(path.join(this.rootDir, "estates"));
    let estateKey = "primary";
    if (estateHome) {
      const requestedEstateHome = path.resolve(estateHome);
      const bases = [
        path.join(requestedRoot, "estates"),
        this.estatesDir,
      ];
      const match = bases
        .map((base) => path.relative(base, requestedEstateHome))
        .find((relative) => (
          relative
          && !relative.startsWith("..")
          && !path.isAbsolute(relative)
          && !relative.includes(path.sep)
        ));
      if (!match) {
        throw new Error("Estate home must be a distinct child of the Zoo estates root.");
      }
      estateKey = match;
    }
    const requestedHome = path.join(this.estatesDir, estateKey);
    this.estateHome = privateDirectory(requestedHome);
    if (!this.estateHome.startsWith(`${this.estatesDir}${path.sep}`)) {
      throw new Error("Estate home escapes the Zoo estates root.");
    }
    this.estateFile = path.join(this.estateHome, "estate.json");
    this.identityFile = path.join(this.estateHome, "rappid.json");
    this.claimsFile = path.join(this.rootDir, "claims.json");
    this.transactionFile = path.join(this.rootDir, "membership-transaction.json");
    this.lockFile = path.join(this.rootDir, ".membership.lock");
    this.now = now;
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
        throw new Error("Zoo membership lock exists; recovery is fail-closed.");
      }
      throw error;
    }
    try {
      writeFileSync(
        descriptor,
        `${JSON.stringify({ pid: process.pid, opened_utc: this.now().toISOString() })}\n`,
      );
      fsyncSync(descriptor);
      return callback();
    } finally {
      closeSync(descriptor);
      rmSync(this.lockFile, { force: true });
    }
  }

  #safeRelative(relative, label) {
    if (
      typeof relative !== "string"
      || !relative
      || path.isAbsolute(relative)
      || relative.split(/[\\/]/).includes("..")
    ) {
      throw new Error(`${label} is not a safe relative path.`);
    }
    const resolved = path.resolve(this.rootDir, relative);
    if (!resolved.startsWith(`${this.rootDir}${path.sep}`)) {
      throw new Error(`${label} escapes the Zoo root.`);
    }
    return resolved;
  }

  #validateTransaction(transaction) {
    exactKeys(
      transaction,
      ["schema", "estate_path", "identity_path", "estate", "identity", "claims"],
      "Membership transaction",
    );
    if (transaction.schema !== TRANSACTION_SCHEMA) {
      throw new Error("Membership transaction schema is invalid.");
    }
    validateEstate(transaction.estate);
    validateIdentity(transaction.identity, transaction.estate);
    validateClaims(transaction.claims);
    this.#safeRelative(transaction.estate_path, "Transaction estate_path");
    this.#safeRelative(transaction.identity_path, "Transaction identity_path");
    return transaction;
  }

  #recoverTransaction() {
    const transaction = readJson(
      this.transactionFile,
      "Membership transaction",
    );
    if (!transaction) return false;
    this.#validateTransaction(transaction);
    privateJson(
      this.#safeRelative(transaction.identity_path, "Transaction identity_path"),
      transaction.identity,
    );
    privateJson(
      this.#safeRelative(transaction.estate_path, "Transaction estate_path"),
      transaction.estate,
    );
    privateJson(this.claimsFile, transaction.claims);
    rmSync(this.transactionFile);
    return true;
  }

  #claims() {
    const current = readJson(this.claimsFile, "Claims registry");
    return current ? validateClaims(current) : emptyClaims();
  }

  #commit(estate, claims) {
    validateEstate(estate);
    validateClaims(claims);
    const identity = identityRecord(estate);
    const transaction = {
      schema: TRANSACTION_SCHEMA,
      estate_path: path.relative(this.rootDir, this.estateFile),
      identity_path: path.relative(this.rootDir, this.identityFile),
      estate,
      identity,
      claims,
    };
    this.#validateTransaction(transaction);
    privateJson(this.transactionFile, transaction);
    privateJson(this.identityFile, identity);
    privateJson(this.estateFile, estate);
    privateJson(this.claimsFile, claims);
    rmSync(this.transactionFile);
  }

  initialize(options = {}) {
    return this.#withLock(() => {
      this.#recoverTransaction();
      const existing = readJson(this.estateFile, "Estate manifest");
      if (existing) {
        const estate = validateEstate(existing);
        validateIdentity(
          readJson(this.identityFile, "rappid.json"),
          estate,
        );
        return estate;
      }
      const estate = options.manifest
        ? validateEstate(structuredClone(options.manifest))
        : createEstateManifest({
          ...options,
          createdUtc: options.createdUtc || this.now().toISOString(),
        });
      const claims = this.#claims();
      for (const neighborhood of estate.neighborhoods) {
        const claimed = claims.claims[neighborhood.rappid];
        if (claimed && claimed.estate_id !== estate.estate_id) {
          throw new Error("Estate root identity is already claimed by another estate.");
        }
        claims.claims[neighborhood.rappid] = claimFor(neighborhood);
      }
      this.#commit(estate, claims);
      return estate;
    });
  }

  read() {
    return this.#withLock(() => {
      this.#recoverTransaction();
      const estate = readJson(this.estateFile, "Estate manifest");
      if (!estate) throw new Error("Estate has not been initialized.");
      validateEstate(estate);
      validateIdentity(readJson(this.identityFile, "rappid.json"), estate);
      return estate;
    });
  }

  attach({ rappid, name, baseUrl, attachedUtc } = {}) {
    return this.#withLock(() => {
      this.#recoverTransaction();
      const estate = validateEstate(
        readJson(this.estateFile, "Estate manifest"),
      );
      const resident = createResidentNeighborhood({
        estate,
        rappid,
        name,
        baseUrl,
        attachedUtc: attachedUtc || this.now().toISOString(),
      });
      const claims = this.#claims();
      const claimed = claims.claims[resident.rappid];
      if (claimed && claimed.estate_id !== estate.estate_id) {
        throw new Error("Neighborhood is already claimed by another estate.");
      }
      const duplicate = estate.neighborhoods.find(
        (entry) => entry.rappid === resident.rappid,
      );
      if (duplicate) {
        if (JSON.stringify(duplicate) !== JSON.stringify(resident)) {
          throw new Error("Neighborhood identity is already attached with different data.");
        }
        return { estate, resident: duplicate, attached: false };
      }
      if (
        Object.entries(claims.claims).some(([candidate, claim]) => (
          candidate !== resident.rappid
          && claim.kind === "resident"
          && claim.base_url === resident.base_url
        ))
      ) {
        throw new Error("Loopback endpoint is already claimed by another neighborhood.");
      }
      estate.neighborhoods.push(resident);
      claims.claims[resident.rappid] = claimFor(resident);
      this.#commit(estate, claims);
      return { estate, resident, attached: true };
    });
  }

  detach(rappid) {
    return this.#withLock(() => {
      this.#recoverTransaction();
      const estate = validateEstate(
        readJson(this.estateFile, "Estate manifest"),
      );
      if (rappid === estate.root_neighborhood_id) {
        throw new Error("The estate root neighborhood cannot be detached.");
      }
      const index = estate.neighborhoods.findIndex(
        (entry) => entry.rappid === rappid,
      );
      if (index === -1) {
        return { estate, detached: false };
      }
      const claims = this.#claims();
      if (claims.claims[rappid]?.estate_id !== estate.estate_id) {
        throw new Error("Neighborhood claim conflicts with this estate.");
      }
      estate.neighborhoods.splice(index, 1);
      delete claims.claims[rappid];
      this.#commit(estate, claims);
      return { estate, detached: true };
    });
  }
}
