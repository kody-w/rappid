import {
  buildChatRequest,
  canonical,
  parseChatEnvelope,
  parseIJson,
} from "./rapp1.mjs";
import { normalizeLoopbackBaseUrl } from "./contracts.mjs";
import {
  readBoundedText,
  requireJsonMediaType,
  withTimeout,
} from "./http.mjs";

const DEFAULT_MAX_BYTES = 1024 * 1024;
const HEALTH_MAX_BYTES = 32 * 1024;

export class RappChatClient {
  constructor({
    baseUrl,
    fetchImpl = globalThis.fetch,
    timeoutMs = 30_000,
    maxBytes = DEFAULT_MAX_BYTES,
    registeredErrorCodes = new Set(["unknown-session"]),
  }) {
    if (typeof fetchImpl !== "function") {
      throw new Error("RappChatClient requires fetch.");
    }
    if (
      !Number.isSafeInteger(maxBytes)
      || maxBytes < 1024
      || maxBytes > DEFAULT_MAX_BYTES
    ) {
      throw new Error(`RAPP response limit must be 1024-${DEFAULT_MAX_BYTES} bytes.`);
    }
    this.baseUrl = normalizeLoopbackBaseUrl(baseUrl);
    this.fetchImpl = fetchImpl;
    this.timeoutMs = timeoutMs;
    this.maxBytes = maxBytes;
    this.registeredErrorCodes = registeredErrorCodes;
  }

  async chat(input) {
    const request = buildChatRequest(input);
    return withTimeout(this.timeoutMs, async (signal) => {
      const response = await this.fetchImpl(`${this.baseUrl}/chat`, {
        method: "POST",
        redirect: "error",
        signal,
        headers: {
          accept: "application/json",
          "content-type": "application/json",
        },
        body: canonical(request),
      });
      requireJsonMediaType(response, "RAPP endpoint");
      const body = await readBoundedText(response, this.maxBytes);
      return parseChatEnvelope(response.status, body, {
        registeredErrorCodes: this.registeredErrorCodes,
      }, "RAPP endpoint");
    });
  }

  async health() {
    return withTimeout(this.timeoutMs, async (signal) => {
      const response = await this.fetchImpl(`${this.baseUrl}/health`, {
        method: "GET",
        redirect: "error",
        signal,
        headers: { accept: "application/json" },
      });
      if (response.status !== 200) {
        throw new Error(`Neighborhood health returned HTTP ${response.status}.`);
      }
      requireJsonMediaType(response, "RAPP endpoint");
      const value = parseIJson(await readBoundedText(response, HEALTH_MAX_BYTES));
      if (
        !value
        || typeof value !== "object"
        || Array.isArray(value)
        || value.status !== "ok"
      ) {
        throw new Error("Neighborhood health must carry exact status \"ok\".");
      }
      return value;
    }, "RAPP endpoint");
  }
}
