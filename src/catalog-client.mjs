import { createHash } from "node:crypto";

import { pinnedRawUrl } from "./global-object.mjs";
import {
  readBoundedText,
  responseMediaType,
  withTimeout,
} from "./http.mjs";
import { parseIJson } from "./rapp1.mjs";

const SHA256 = /^[0-9a-f]{64}$/;
const MAX_CATALOG_BYTES = 512 * 1024;

export async function fetchPinnedCatalog({
  url,
  sha256,
  fetchImpl = globalThis.fetch,
  timeoutMs = 30_000,
}) {
  if (!SHA256.test(String(sha256))) {
    throw new Error("Summon line requires an exact SHA-256.");
  }
  const source = pinnedRawUrl(url);
  const body = await withTimeout(timeoutMs, async (signal) => {
    const response = await fetchImpl(source, {
      method: "GET",
      redirect: "error",
      signal,
      headers: { accept: "application/json" },
    });
    if (response.status !== 200) {
      throw new Error(`Summon line returned HTTP ${response.status}.`);
    }
    if (!["application/json", "text/plain"].includes(responseMediaType(response))) {
      throw new Error("Summon line must return JSON-compatible raw bytes.");
    }
    return readBoundedText(response, MAX_CATALOG_BYTES);
  }, "Summon line");
  const actual = createHash("sha256").update(body, "utf8").digest("hex");
  if (actual !== sha256) throw new Error("Summon line SHA-256 mismatch.");
  const catalog = parseIJson(body);
  if (
    catalog?.schema !== "rapp-zoo-summon-line/2.0"
    || typeof catalog.generated_utc !== "string"
    || !Array.isArray(catalog.summons)
  ) {
    throw new Error("Summon line schema is invalid.");
  }
  return catalog;
}
