import { createHash } from "node:crypto";
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
} from "./rapp1.mjs";

export const MONOREPO_COMPANION_SCHEMA = "rapp-zoo-monorepo-companion/2.0";
export const MONOREPO_COMMIT = "ffd656b857722d82862051dc7097f0161812737f";
export const MONOREPO_MANIFEST_SHA256 =
  "6eb7cb606fba200c6aaa39bf57d871e60ee9000e2b6cbdd89f47f55c5a950076";
export const MONOREPO_MANIFEST_BYTES = 67_148;
export const MONOREPO_MANIFEST_URL =
  `https://raw.githubusercontent.com/kody-w/rapp-monorepo/${MONOREPO_COMMIT}/MANIFEST.json`;

function digest(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

export function validateMonorepoManifest(value) {
  if (
    !value
    || typeof value !== "object"
    || Array.isArray(value)
    || value.schema !== "rapp-monorepo/1.0"
    || value.owner !== "kody-w"
    || typeof value.captured_at !== "string"
    || !Array.isArray(value.repos)
    || value.repos.length < 1
  ) {
    throw new Error("RAPP monorepo companion manifest is invalid.");
  }
  const names = new Set();
  for (const repo of value.repos) {
    if (
      !repo
      || typeof repo !== "object"
      || Array.isArray(repo)
      || typeof repo.repo !== "string"
      || !repo.repo
      || names.has(repo.repo)
      || !/^[0-9a-f]{40}$/.test(repo.commit)
      || !Number.isSafeInteger(repo.files)
      || repo.files < 0
      || !Number.isSafeInteger(repo.bytes)
      || repo.bytes < 0
      || !Array.isArray(repo.skipped_large)
      || !Array.isArray(repo.withheld)
    ) {
      throw new Error("RAPP monorepo contains an invalid repository dimension.");
    }
    names.add(repo.repo);
  }
  return value;
}

export class MonorepoCompanionLoader {
  constructor({
    estateHome,
    fetchImpl = globalThis.fetch,
    timeoutMs = 30_000,
  }) {
    this.root = ensurePrivateDirectory(
      path.join(estateHome, "monorepo-companion"),
    );
    this.fetchImpl = fetchImpl;
    this.timeoutMs = timeoutMs;
  }

  async load({
    url = MONOREPO_MANIFEST_URL,
    sha256 = MONOREPO_MANIFEST_SHA256,
    bytes = MONOREPO_MANIFEST_BYTES,
  } = {}) {
    if (
      url !== MONOREPO_MANIFEST_URL
      || sha256 !== MONOREPO_MANIFEST_SHA256
      || bytes !== MONOREPO_MANIFEST_BYTES
    ) {
      throw new Error("Monorepo companion must use the audited immutable snapshot pin.");
    }
    const body = await withTimeout(this.timeoutMs, async (signal) => {
      const response = await this.fetchImpl(url, {
        method: "GET",
        redirect: "error",
        signal,
        headers: { accept: "application/json" },
      });
      if (response.status !== 200) {
        throw new Error(`Monorepo companion returned HTTP ${response.status}.`);
      }
      if (!["application/json", "text/plain"].includes(responseMediaType(response))) {
        throw new Error("Monorepo companion must return JSON-compatible raw bytes.");
      }
      return readBoundedBytes(response, bytes);
    }, "Monorepo companion");
    if (body.length !== bytes || digest(body) !== sha256) {
      throw new Error("Monorepo companion manifest failed byte/hash verification.");
    }
    const manifest = validateMonorepoManifest(
      parseIJson(new TextDecoder("utf-8", { fatal: true }).decode(body)),
    );
    const directory = ensurePrivateDirectory(path.join(this.root, sha256));
    writePrivateBytes(path.join(directory, "MANIFEST.json"), body);
    const projection = {
      schema: MONOREPO_COMPANION_SCHEMA,
      companion_id: `sha256:${sha256}`,
      source_repository: "kody-w/rapp-monorepo",
      source_commit: MONOREPO_COMMIT,
      captured_at: manifest.captured_at,
      cage_policy: "selected-dimensions-no-implicit-execution",
      repository_count: manifest.repos.length,
      file_count: manifest.repos.reduce((sum, repo) => sum + repo.files, 0),
      byte_count: manifest.repos.reduce((sum, repo) => sum + repo.bytes, 0),
      dimensions: manifest.repos.map((repo) => ({
        name: repo.repo,
        commit: repo.commit,
        files: repo.files,
        bytes: repo.bytes,
        withheld: repo.withheld.length,
        skipped_large: repo.skipped_large.length,
        raw_prefix:
          `https://raw.githubusercontent.com/kody-w/rapp-monorepo/${MONOREPO_COMMIT}/repos/${encodeURIComponent(repo.repo)}/`,
      })),
    };
    writePrivateJson(path.join(directory, "projection.json"), projection);
    return projection;
  }
}
