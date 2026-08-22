import { randomBytes } from "node:crypto";
import { createServer } from "node:http";
import {
  existsSync,
  lstatSync,
  readFileSync,
  rmSync,
} from "node:fs";
import path from "node:path";

import { CONTROL_SCHEMA } from "./contracts.mjs";
import {
  ensurePrivateDirectory,
  readPrivateJson,
  writePrivateJson,
} from "./estate-store.mjs";
import { parseIJson } from "./rapp1.mjs";
import {
  decodeUtf8,
  readBoundedText,
} from "./http.mjs";

const MAX_CONTROL_BYTES = 2048;
const TOKEN = /^[0-9a-f]{64}$/;

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

function json(response, status, value) {
  const body = JSON.stringify(value);
  response.writeHead(status, {
    "content-type": "application/json",
    "content-length": Buffer.byteLength(body),
    "cache-control": "no-store",
  });
  response.end(body);
}

async function requestBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    request.on("data", (chunk) => {
      total += chunk.length;
      if (total > MAX_CONTROL_BYTES) {
        reject(new Error("Control request exceeds its byte limit."));
        request.destroy();
      } else {
        chunks.push(chunk);
      }
    });
    request.on("end", () => {
      try {
        resolve(decodeUtf8(Buffer.concat(chunks), "Control request"));
      } catch (error) {
        reject(error);
      }
    });
    request.on("error", reject);
  });
}

export function validateControlMetadata(value, { estateId = null } = {}) {
  exactKeys(
    value,
    ["schema", "estate_id", "endpoint", "instance_token", "pid", "started_utc"],
    "Control metadata",
  );
  let endpoint;
  try {
    endpoint = new URL(value.endpoint);
  } catch {
    throw new Error("Control endpoint is not a URL.");
  }
  if (
    value.schema !== CONTROL_SCHEMA
    || (estateId && value.estate_id !== estateId)
    || typeof value.estate_id !== "string"
    || endpoint.protocol !== "http:"
    || endpoint.hostname !== "127.0.0.1"
    || !endpoint.port
    || endpoint.pathname !== "/control"
    || endpoint.search
    || endpoint.hash
    || !TOKEN.test(value.instance_token)
    || !Number.isSafeInteger(value.pid)
    || value.pid < 1
    || typeof value.started_utc !== "string"
  ) {
    throw new Error("Control metadata is invalid.");
  }
  return value;
}

export async function startControlServer({
  estateHome,
  estateId,
  instanceToken = randomBytes(32).toString("hex"),
  now = () => new Date(),
  onStop = () => {},
}) {
  if (!TOKEN.test(instanceToken)) {
    throw new Error("Control capability must be 32 random bytes.");
  }
  const home = ensurePrivateDirectory(path.resolve(estateHome));
  const metadataFile = path.join(home, "control.json");
  let stopped = false;
  const server = createServer(async (request, response) => {
    if (request.url !== "/control") {
      json(response, 404, { error: "not-found" });
      return;
    }
    if (request.method !== "POST") {
      json(response, 405, { error: "method-not-allowed" });
      return;
    }
    if (request.headers.authorization !== `Bearer ${instanceToken}`) {
      json(response, 403, { error: "capability-refused" });
      return;
    }
    if (
      String(request.headers["content-type"] || "")
        .split(";", 1)[0]
        .trim()
        .toLowerCase() !== "application/json"
    ) {
      json(response, 415, { error: "content-type-refused" });
      return;
    }
    try {
      const value = parseIJson(await requestBody(request));
      exactKeys(value, ["action"], "Control request");
      if (!["probe", "stop"].includes(value.action)) {
        json(response, 422, { error: "unknown-action" });
        return;
      }
      json(response, 200, {
        schema: CONTROL_SCHEMA,
        estate_id: estateId,
        action: value.action,
        accepted: true,
      });
      if (value.action === "stop" && !stopped) {
        stopped = true;
        response.once("finish", () => queueMicrotask(onStop));
      }
    } catch (error) {
      if (!response.headersSent) {
        json(response, 400, { error: "invalid-request" });
      }
    }
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const metadata = {
    schema: CONTROL_SCHEMA,
    estate_id: estateId,
    endpoint: `http://127.0.0.1:${server.address().port}/control`,
    instance_token: instanceToken,
    pid: process.pid,
    started_utc: now().toISOString(),
  };
  validateControlMetadata(metadata, { estateId });
  writePrivateJson(metadataFile, metadata);

  return {
    metadata,
    metadataFile,
    async close() {
      await new Promise((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve());
      });
      if (existsSync(metadataFile)) {
        const current = readPrivateJson(metadataFile, "Control metadata");
        if (current?.instance_token === instanceToken) rmSync(metadataFile);
      }
    },
  };
}

export async function requestInstanceControl(metadataFile, action, {
  fetchImpl = globalThis.fetch,
  timeoutMs = 3000,
  estateId = null,
} = {}) {
  if (!["probe", "stop"].includes(action)) {
    throw new Error("Instance control action must be probe or stop.");
  }
  if (!existsSync(metadataFile)) {
    return false;
  }
  const stats = lstatSync(metadataFile);
  if (!stats.isFile() || stats.isSymbolicLink()) {
    throw new Error("Control metadata must be a regular file.");
  }
  const metadata = validateControlMetadata(
    parseIJson(readFileSync(metadataFile, "utf8")),
    { estateId },
  );
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(new Error("Instance control timed out.")),
    timeoutMs,
  );
  timer.unref?.();
  try {
    const response = await fetchImpl(metadata.endpoint, {
      method: "POST",
      redirect: "error",
      signal: controller.signal,
      headers: {
        authorization: `Bearer ${metadata.instance_token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ action }),
    });
    if (response.status !== 200) return false;
    const mediaType = String(response.headers.get("content-type") || "")
      .split(";", 1)[0]
      .trim()
      .toLowerCase();
    if (mediaType !== "application/json") return false;
    const result = parseIJson(await readBoundedText(response, MAX_CONTROL_BYTES));
    exactKeys(
      result,
      ["schema", "estate_id", "action", "accepted"],
      "Control response",
    );
    return result.schema === CONTROL_SCHEMA
      && result.estate_id === metadata.estate_id
      && result.action === action
      && result.accepted === true;
  } catch (error) {
    if (controller.signal.aborted) throw controller.signal.reason;
    return false;
  } finally {
    clearTimeout(timer);
  }
}
