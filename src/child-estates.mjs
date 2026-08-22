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
import { spawn } from "node:child_process";
import path from "node:path";

import {
  MAX_DIRECT_CHILDREN,
  MAX_GENERATION,
  createEstateManifest,
  slugify,
  validateEstate,
} from "./contracts.mjs";
import {
  EstateStore,
  ensurePrivateDirectory,
  readPrivateJson,
  writePrivateJson,
} from "./estate-store.mjs";
import { requestInstanceControl } from "./control-server.mjs";
import { parseIJson, validateRappid } from "./rapp1.mjs";

export const CHILDREN_SCHEMA = "rapp-zoo-children/2.0";
export const CHILD_SCHEMA = "rapp-zoo-child/2.0";
const STATUS = new Set(["prepared", "running", "stopped", "spawn-failed"]);
const CHILD_KEYS = [
  "schema",
  "name",
  "slug",
  "estate_id",
  "rappid",
  "generation",
  "estate_home",
  "user_data",
  "control_file",
  "created_utc",
  "launched_utc",
  "pid",
  "status",
];

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

function validateChild(record, { rootDir, parentEstateId }) {
  exactKeys(record, CHILD_KEYS, "Child estate record");
  const safeRoot = `${path.resolve(rootDir)}${path.sep}`;
  if (
    record.schema !== CHILD_SCHEMA
    || typeof record.name !== "string"
    || slugify(record.name) !== record.slug
    || !validateRappid(record.rappid)
    || record.estate_id !== `estate:${record.rappid}`
    || !Number.isSafeInteger(record.generation)
    || record.generation < 1
    || record.generation > MAX_GENERATION
    || !STATUS.has(record.status)
    || !path.resolve(record.estate_home).startsWith(safeRoot)
    || !path.resolve(record.user_data).startsWith(
      `${path.resolve(record.estate_home)}${path.sep}`,
    )
    || record.control_file !== path.join(record.estate_home, "control.json")
    || typeof parentEstateId !== "string"
    || typeof record.created_utc !== "string"
    || (
      record.launched_utc !== null
      && typeof record.launched_utc !== "string"
    )
    || (
      record.pid !== null
      && (!Number.isSafeInteger(record.pid) || record.pid < 1)
    )
  ) {
    throw new Error("Child estate record is invalid.");
  }
  return record;
}

function emptyRegistry(parentEstateId) {
  return {
    schema: CHILDREN_SCHEMA,
    parent_estate_id: parentEstateId,
    children: [],
  };
}

function validateRegistry(value, options) {
  exactKeys(
    value,
    ["schema", "parent_estate_id", "children"],
    "Child estate registry",
  );
  if (
    value.schema !== CHILDREN_SCHEMA
    || value.parent_estate_id !== options.parentEstateId
    || !Array.isArray(value.children)
    || value.children.length > MAX_DIRECT_CHILDREN
  ) {
    throw new Error("Child estate registry is invalid.");
  }
  const estates = new Set();
  const slugs = new Set();
  for (const child of value.children) {
    validateChild(child, options);
    if (estates.has(child.estate_id) || slugs.has(child.slug)) {
      throw new Error("Child estate registry identities must be unique.");
    }
    estates.add(child.estate_id);
    slugs.add(child.slug);
  }
  return value;
}

export class ChildEstateManager {
  constructor({
    parentStore,
    electronPath,
    appDir,
    spawnImpl = spawn,
    controlRequest = requestInstanceControl,
    now = () => new Date(),
  }) {
    if (!(parentStore instanceof EstateStore)) {
      throw new Error("ChildEstateManager requires an EstateStore.");
    }
    if (!electronPath || !appDir) {
      throw new Error("ChildEstateManager requires Electron and app paths.");
    }
    this.parentStore = parentStore;
    this.electronPath = path.resolve(electronPath);
    this.appDir = path.resolve(appDir);
    this.spawnImpl = spawnImpl;
    this.controlRequest = controlRequest;
    this.now = now;
    this.registryFile = path.join(parentStore.estateHome, "children.json");
    this.lockFile = path.join(parentStore.estateHome, ".children.lock");
  }

  async #withLock(callback) {
    let descriptor;
    try {
      descriptor = openSync(
        this.lockFile,
        constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY,
        0o600,
      );
    } catch (error) {
      if (error?.code === "EEXIST") {
        throw new Error("Child estate lock exists; lifecycle is fail-closed.");
      }
      throw error;
    }
    try {
      writeFileSync(
        descriptor,
        `${JSON.stringify({ pid: process.pid, opened_utc: this.now().toISOString() })}\n`,
      );
      fsyncSync(descriptor);
      return await callback();
    } finally {
      closeSync(descriptor);
      rmSync(this.lockFile, { force: true });
    }
  }

  #registry(parent) {
    const value = existsSync(this.registryFile)
      ? parseIJson(readFileSync(this.registryFile, "utf8"))
      : emptyRegistry(parent.estate_id);
    return validateRegistry(value, {
      rootDir: this.parentStore.rootDir,
      parentEstateId: parent.estate_id,
    });
  }

  #write(registry, parent) {
    validateRegistry(registry, {
      rootDir: this.parentStore.rootDir,
      parentEstateId: parent.estate_id,
    });
    writePrivateJson(this.registryFile, registry);
  }

  async hatch(name) {
    return this.#withLock(async () => {
      const parent = validateEstate(this.parentStore.read());
      if (parent.generation >= MAX_GENERATION) {
        throw new Error(`Estate spawning is limited to ${MAX_GENERATION} generations.`);
      }
      const slug = slugify(name);
      const registry = this.#registry(parent);
      let record = registry.children.find((entry) => entry.slug === slug);
      if (record) {
        if (record.status === "running" || record.status === "prepared") {
          const live = await this.controlRequest(
            record.control_file,
            "probe",
            { estateId: record.estate_id },
          );
          if (live) throw new Error(`Child estate ${slug} is already running.`);
          throw new Error(
            `Child estate ${slug} may still be live but its capability cannot be verified.`,
          );
        }
      } else {
        if (registry.children.length >= MAX_DIRECT_CHILDREN) {
          throw new Error(
            `An estate may own at most ${MAX_DIRECT_CHILDREN} direct children.`,
          );
        }
        const manifest = createEstateManifest({
          name,
          generation: parent.generation + 1,
          parentEstateId: parent.estate_id,
          parentNeighborhoodId: parent.root_neighborhood_id,
          createdUtc: this.now().toISOString(),
        });
        const estateKey = manifest.rappid.slice(-64);
        const estateHome = path.join(
          this.parentStore.estatesDir,
          estateKey,
        );
        const childStore = new EstateStore({
          rootDir: this.parentStore.rootDir,
          estateHome,
          now: this.now,
        });
        childStore.initialize({ manifest });
        const userData = ensurePrivateDirectory(
          path.join(childStore.estateHome, "electron-user-data"),
        );
        record = {
          schema: CHILD_SCHEMA,
          name: manifest.name,
          slug: manifest.slug,
          estate_id: manifest.estate_id,
          rappid: manifest.rappid,
          generation: manifest.generation,
          estate_home: childStore.estateHome,
          user_data: userData,
          control_file: path.join(childStore.estateHome, "control.json"),
          created_utc: manifest.created_utc,
          launched_utc: null,
          pid: null,
          status: "prepared",
        };
        registry.children.push(record);
        this.#write(registry, parent);
      }

      const args = [
        this.appDir,
        `--rapp-zoo-estate-home=${record.estate_home}`,
        `--user-data-dir=${record.user_data}`,
      ];
      try {
        const child = this.spawnImpl(this.electronPath, args, {
          detached: true,
          stdio: "ignore",
          windowsHide: true,
          env: {
            ...process.env,
            RAPP_ZOO_ROOT: this.parentStore.rootDir,
            RAPP_ZOO_ESTATE_HOME: record.estate_home,
          },
        });
        if (!Number.isSafeInteger(child?.pid) || child.pid < 1) {
          throw new Error("Electron spawn did not return a child PID.");
        }
        child.unref?.();
        record.pid = child.pid;
        record.launched_utc = this.now().toISOString();
        record.status = "running";
        this.#write(registry, parent);
        return structuredClone(record);
      } catch (error) {
        record.pid = null;
        record.launched_utc = null;
        record.status = "spawn-failed";
        this.#write(registry, parent);
        throw error;
      }
    });
  }

  async list() {
    return this.#withLock(async () => {
      const parent = validateEstate(this.parentStore.read());
      const registry = this.#registry(parent);
      return Promise.all(registry.children.map(async (record) => ({
        ...structuredClone(record),
        capability_live: record.status === "running"
          ? await this.controlRequest(record.control_file, "probe", {
            estateId: record.estate_id,
          })
          : false,
      })));
    });
  }

  async stop(slugOrEstateId) {
    return this.#withLock(async () => {
      const parent = validateEstate(this.parentStore.read());
      const registry = this.#registry(parent);
      const record = registry.children.find(
        (entry) => (
          entry.slug === slugOrEstateId
          || entry.estate_id === slugOrEstateId
        ),
      );
      if (!record || record.status !== "running") {
        return { stopped: false, reason: "not running" };
      }
      const stopped = await this.controlRequest(
        record.control_file,
        "stop",
        { estateId: record.estate_id },
      );
      if (!stopped) {
        return {
          stopped: false,
          reason: "instance capability could not be verified",
        };
      }
      record.status = "stopped";
      this.#write(registry, parent);
      return { stopped: true, estate_id: record.estate_id };
    });
  }
}
