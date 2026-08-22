import { createHash } from "node:crypto";
import {
  existsSync,
  lstatSync,
  readFileSync,
} from "node:fs";
import path from "node:path";
import { TextDecoder } from "node:util";

import {
  ensurePrivateDirectory,
  writePrivateBytes,
  writePrivateJson,
} from "./estate-store.mjs";
import {
  readBoundedBytes,
  responseMediaType,
  withTimeout,
} from "./http.mjs";
import {
  parseIJson,
  validateRappid,
} from "./rapp1.mjs";

export const GLOBAL_OBJECT_SCHEMA = "rapp-zoo-global-object/2.0";
export const GLOBAL_PROJECTION_SCHEMA = "rapp-zoo-global-projection/2.0";
const COMMIT = /^[0-9a-f]{40}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MAX_MANIFEST_BYTES = 256 * 1024;
const MAX_DIMENSION_BYTES = 512 * 1024;
const MAX_TOTAL_BYTES = 512 * 1024;
const MEDIA_TYPES = new Set([
  "application/json",
  "text/plain",
  "text/markdown",
  "image/png",
  "image/jpeg",
  "image/webp",
]);

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

export function pinnedRawUrl(value) {
  let parsed;
  try {
    parsed = new URL(String(value));
  } catch {
    throw new Error("Global dimension URL must be absolute.");
  }
  const segments = parsed.pathname.split("/").filter(Boolean);
  if (
    parsed.protocol !== "https:"
    || parsed.hostname !== "raw.githubusercontent.com"
    || parsed.username
    || parsed.password
    || parsed.search
    || parsed.hash
    || segments.length < 4
    || !COMMIT.test(segments[2])
  ) {
    throw new Error(
      "Global dimension URL must be commit-pinned raw.githubusercontent.com user data.",
    );
  }
  return parsed.href;
}

export function validateGlobalManifest(value) {
  exactKeys(
    value,
    ["schema", "name", "source_rappid", "created_utc", "dimensions"],
    "Global object manifest",
  );
  if (
    value.schema !== GLOBAL_OBJECT_SCHEMA
    || typeof value.name !== "string"
    || value.name.length < 1
    || value.name.length > 100
    || value.name !== value.name.normalize("NFC")
    || !validateRappid(value.source_rappid)
    || typeof value.created_utc !== "string"
    || !Array.isArray(value.dimensions)
    || value.dimensions.length < 1
    || value.dimensions.length > 64
  ) {
    throw new Error("Global object manifest is invalid.");
  }
  const names = new Set();
  let total = 0;
  for (const dimension of value.dimensions) {
    exactKeys(
      dimension,
      ["name", "url", "sha256", "bytes", "media_type"],
      "Global object dimension",
    );
    if (
      typeof dimension.name !== "string"
      || !NAME.test(dimension.name)
      || names.has(dimension.name)
      || !SHA256.test(dimension.sha256)
      || !Number.isSafeInteger(dimension.bytes)
      || dimension.bytes < 0
      || dimension.bytes > MAX_DIMENSION_BYTES
      || !MEDIA_TYPES.has(dimension.media_type)
    ) {
      throw new Error("Global object dimension is invalid or duplicated.");
    }
    pinnedRawUrl(dimension.url);
    names.add(dimension.name);
    total += dimension.bytes;
  }
  if (total > MAX_TOTAL_BYTES) {
    throw new Error(`Global object exceeds the ${MAX_TOTAL_BYTES}-byte total limit.`);
  }
  return value;
}

function decodeDimension(bytes, mediaType) {
  if (mediaType === "application/json") {
    return parseIJson(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  }
  if (mediaType === "text/plain" || mediaType === "text/markdown") {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  }
  return null;
}

export class GlobalObjectLoader {
  constructor({
    estateHome,
    fetchImpl = globalThis.fetch,
    timeoutMs = 30_000,
  }) {
    if (typeof fetchImpl !== "function") {
      throw new Error("GlobalObjectLoader requires fetch.");
    }
    this.cacheRoot = ensurePrivateDirectory(
      path.join(path.resolve(estateHome), "global-objects"),
    );
    this.fetchImpl = fetchImpl;
    this.timeoutMs = timeoutMs;
  }

  async #fetch(url, maxBytes, expectedMediaType = "application/json") {
    return withTimeout(this.timeoutMs, async (signal) => {
      const response = await this.fetchImpl(pinnedRawUrl(url), {
        method: "GET",
        redirect: "error",
        signal,
        headers: { accept: expectedMediaType },
      });
      if (response.status !== 200) {
        throw new Error(`Global dimension returned HTTP ${response.status}.`);
      }
      const actualMediaType = responseMediaType(response);
      const githubRawText = actualMediaType === "text/plain"
        && [
          "application/json",
          "text/plain",
          "text/markdown",
        ].includes(expectedMediaType);
      if (actualMediaType !== expectedMediaType && !githubRawText) {
        throw new Error(
          `Global dimension media type must be ${expectedMediaType}.`,
        );
      }
      return readBoundedBytes(response, maxBytes);
    }, "Global dimension");
  }

  async load({
    manifestUrl,
    manifestSha256,
    dimensions = null,
  }) {
    if (!SHA256.test(String(manifestSha256))) {
      throw new Error("Global manifest requires an exact SHA-256.");
    }
    const manifestBytes = await this.#fetch(
      manifestUrl,
      MAX_MANIFEST_BYTES,
      "application/json",
    );
    if (digest(manifestBytes) !== manifestSha256) {
      throw new Error("Global manifest SHA-256 mismatch.");
    }
    const manifest = validateGlobalManifest(
      parseIJson(new TextDecoder("utf-8", { fatal: true }).decode(manifestBytes)),
    );
    const requested = dimensions === null
      ? new Set(manifest.dimensions.map((entry) => entry.name))
      : new Set(dimensions);
    if (
      [...requested].some((name) => (
        typeof name !== "string"
        || !manifest.dimensions.some((entry) => entry.name === name)
      ))
    ) {
      throw new Error("Requested global dimension is not in the manifest.");
    }
    const objectDirectory = ensurePrivateDirectory(
      path.join(this.cacheRoot, manifestSha256),
    );
    writePrivateBytes(path.join(objectDirectory, "manifest.json"), manifestBytes);

    const loaded = {};
    for (const dimension of manifest.dimensions) {
      if (!requested.has(dimension.name)) continue;
      const extension = dimension.media_type === "application/json"
        ? "json"
        : dimension.media_type.startsWith("text/")
          ? "txt"
          : dimension.media_type.split("/")[1];
      const localPath = path.join(
        objectDirectory,
        `${dimension.name}.${extension}`,
      );
      let bytes;
      if (existsSync(localPath)) {
        const stats = lstatSync(localPath);
        if (!stats.isFile() || stats.isSymbolicLink()) {
          throw new Error("Cached global dimension must be a regular file.");
        }
        bytes = readFileSync(localPath);
        if (
          bytes.length !== dimension.bytes
          || digest(bytes) !== dimension.sha256
        ) {
          throw new Error("Cached global dimension failed integrity verification.");
        }
      } else {
        bytes = await this.#fetch(
          dimension.url,
          dimension.bytes,
          dimension.media_type,
        );
        if (
          bytes.length !== dimension.bytes
          || digest(bytes) !== dimension.sha256
        ) {
          throw new Error(`Global dimension ${dimension.name} failed integrity verification.`);
        }
        writePrivateBytes(localPath, bytes);
      }
      loaded[dimension.name] = {
        media_type: dimension.media_type,
        bytes: dimension.bytes,
        sha256: dimension.sha256,
        local_path: localPath,
        value: decodeDimension(bytes, dimension.media_type),
      };
    }
    const receipt = {
      schema: GLOBAL_PROJECTION_SCHEMA,
      object_id: `sha256:${manifestSha256}`,
      manifest_url: pinnedRawUrl(manifestUrl),
      manifest_sha256: manifestSha256,
      name: manifest.name,
      source_rappid: manifest.source_rappid,
      created_utc: manifest.created_utc,
      loaded_dimensions: Object.keys(loaded).sort(),
    };
    writePrivateJson(path.join(objectDirectory, "receipt.json"), receipt);
    return { receipt, manifest, dimensions: loaded };
  }
}

export function publicGlobalProjection(loaded) {
  return {
    ...loaded.receipt,
    dimensions: Object.fromEntries(
      Object.entries(loaded.dimensions).map(([name, dimension]) => [
        name,
        {
          media_type: dimension.media_type,
          bytes: dimension.bytes,
          sha256: dimension.sha256,
          value: dimension.value,
        },
      ]),
    ),
  };
}
