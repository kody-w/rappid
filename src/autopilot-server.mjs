import { randomBytes, randomUUID } from "node:crypto";
import { createServer } from "node:http";
import {
  existsSync,
  lstatSync,
  readFileSync,
  rmSync,
} from "node:fs";
import path from "node:path";

import {
  ensurePrivateDirectory,
  writePrivateJson,
} from "./estate-store.mjs";
import {
  decodeUtf8,
  readBoundedText,
  requireJsonMediaType,
  withTimeout,
} from "./http.mjs";
import { parseIJson } from "./rapp1.mjs";

export const AUTOPILOT_SCHEMA = "rapp-zoo-autopilot/2.0";
export const AUTOPILOT_COMMAND_SCHEMA = "rapp-zoo-autopilot-command/2.0";
export const AUTOPILOT_RESULT_SCHEMA = "rapp-zoo-autopilot-result/2.0";
const TOKEN = /^[0-9a-f]{64}$/;
const MAX_COMMAND_BYTES = 64 * 1024;
const MAX_RESPONSE_BYTES = 1024 * 1024;
const COMMANDS = new Set(["snapshot", "invoke", "input", "wait", "screenshot"]);

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

async function body(request) {
  return new Promise((resolve, reject) => {
    let total = 0;
    const chunks = [];
    request.on("data", (chunk) => {
      total += chunk.length;
      if (total > MAX_COMMAND_BYTES) {
        request.destroy();
        reject(new Error("Autopilot command exceeds its byte limit."));
      } else {
        chunks.push(chunk);
      }
    });
    request.on("end", () => {
      try {
        resolve(decodeUtf8(Buffer.concat(chunks), "Autopilot command"));
      } catch (error) {
        reject(error);
      }
    });
    request.on("error", reject);
  });
}

export function validateAutopilotCommand(value) {
  exactKeys(
    value,
    ["schema", "request_id", "revision", "command", "args"],
    "Autopilot command",
  );
  if (
    value.schema !== AUTOPILOT_COMMAND_SCHEMA
    || typeof value.request_id !== "string"
    || !value.request_id
    || !COMMANDS.has(value.command)
    || !value.args
    || typeof value.args !== "object"
    || Array.isArray(value.args)
    || (
      value.revision !== null
      && (!Number.isSafeInteger(value.revision) || value.revision < 0)
    )
  ) {
    throw new Error("Autopilot command is invalid.");
  }
  if (["invoke", "input", "screenshot"].includes(value.command) && value.revision === null) {
    throw new Error("State-changing autopilot commands require a screen revision.");
  }
  if (value.command === "invoke") {
    exactKeys(value.args, ["control_id"], "Autopilot invoke args");
    if (typeof value.args.control_id !== "string" || !value.args.control_id) {
      throw new Error("Autopilot invoke requires a semantic control ID.");
    }
  } else if (value.command === "input") {
    exactKeys(value.args, ["control_id", "value"], "Autopilot input args");
    if (
      typeof value.args.control_id !== "string"
      || !value.args.control_id
      || typeof value.args.value !== "string"
      || value.args.value.length > 64 * 1024
    ) {
      throw new Error("Autopilot input requires a semantic control ID and bounded text.");
    }
  } else if (value.command === "wait") {
    exactKeys(value.args, ["milliseconds"], "Autopilot wait args");
    if (
      !Number.isSafeInteger(value.args.milliseconds)
      || value.args.milliseconds < 0
      || value.args.milliseconds > 5000
    ) {
      throw new Error("Autopilot wait must be between 0 and 5000 ms.");
    }
  } else if (value.command === "screenshot") {
    exactKeys(value.args, ["name"], "Autopilot screenshot args");
    if (
      typeof value.args.name !== "string"
      || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value.args.name)
    ) {
      throw new Error("Autopilot screenshot requires a safe semantic name.");
    }
  } else {
    exactKeys(value.args, [], "Autopilot snapshot args");
  }
  return value;
}

export function validateAutopilotMetadata(value, { estateId = null } = {}) {
  exactKeys(
    value,
    ["schema", "estate_id", "endpoint", "token", "pid", "started_utc"],
    "Autopilot metadata",
  );
  let endpoint;
  try {
    endpoint = new URL(value.endpoint);
  } catch {
    throw new Error("Autopilot endpoint is invalid.");
  }
  if (
    value.schema !== AUTOPILOT_SCHEMA
    || typeof value.estate_id !== "string"
    || (estateId && value.estate_id !== estateId)
    || endpoint.protocol !== "http:"
    || endpoint.hostname !== "127.0.0.1"
    || !endpoint.port
    || endpoint.pathname !== "/command"
    || endpoint.search
    || endpoint.hash
    || !TOKEN.test(value.token)
    || !Number.isSafeInteger(value.pid)
    || value.pid < 1
    || typeof value.started_utc !== "string"
  ) {
    throw new Error("Autopilot metadata is invalid.");
  }
  return value;
}

export async function startAutopilotServer({
  estateHome,
  estateId,
  execute,
  token = randomBytes(32).toString("hex"),
  now = () => new Date(),
}) {
  if (typeof execute !== "function") {
    throw new Error("Autopilot server requires a semantic command executor.");
  }
  if (!TOKEN.test(token)) {
    throw new Error("Autopilot token must be 32 random bytes.");
  }
  const home = ensurePrivateDirectory(path.resolve(estateHome));
  const metadataFile = path.join(home, "autopilot.json");
  const server = createServer(async (request, response) => {
    if (request.url !== "/command") {
      json(response, 404, { error: "not-found" });
      return;
    }
    if (request.method !== "POST") {
      json(response, 405, { error: "method-not-allowed" });
      return;
    }
    if (request.headers.authorization !== `Bearer ${token}`) {
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
      const command = validateAutopilotCommand(parseIJson(await body(request)));
      const value = command.command === "wait"
        ? await new Promise((resolve) => {
          setTimeout(() => resolve({ waited_ms: command.args.milliseconds }), command.args.milliseconds);
        })
        : await execute(command);
      json(response, 200, {
        schema: AUTOPILOT_RESULT_SCHEMA,
        request_id: command.request_id,
        ok: true,
        value,
      });
    } catch (error) {
      const stale = error?.code === "STALE_REVISION";
      json(response, stale ? 409 : 422, {
        schema: AUTOPILOT_RESULT_SCHEMA,
        request_id: null,
        ok: false,
        error: stale ? "stale-revision" : "command-refused",
        detail: String(error?.message || error),
      });
    }
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const metadata = {
    schema: AUTOPILOT_SCHEMA,
    estate_id: estateId,
    endpoint: `http://127.0.0.1:${server.address().port}/command`,
    token,
    pid: process.pid,
    started_utc: now().toISOString(),
  };
  validateAutopilotMetadata(metadata, { estateId });
  writePrivateJson(metadataFile, metadata);
  return {
    metadata,
    metadataFile,
    async close() {
      await new Promise((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve());
      });
      if (existsSync(metadataFile)) {
        const current = parseIJson(readFileSync(metadataFile, "utf8"));
        if (current.token === token) rmSync(metadataFile);
      }
    },
  };
}

export async function sendAutopilotCommand(metadataFile, {
  command,
  args = {},
  revision = null,
  timeoutMs = 10_000,
  fetchImpl = globalThis.fetch,
}) {
  if (!existsSync(metadataFile)) {
    throw new Error("RAPP Zoo v2 autopilot is not running.");
  }
  const stats = lstatSync(metadataFile);
  if (!stats.isFile() || stats.isSymbolicLink()) {
    throw new Error("Autopilot metadata must be a regular file.");
  }
  const metadata = validateAutopilotMetadata(
    parseIJson(readFileSync(metadataFile, "utf8")),
  );
  const payload = validateAutopilotCommand({
    schema: AUTOPILOT_COMMAND_SCHEMA,
    request_id: randomUUID(),
    revision,
    command,
    args,
  });
  return withTimeout(timeoutMs, async (signal) => {
    const response = await fetchImpl(metadata.endpoint, {
      method: "POST",
      redirect: "error",
      signal,
      headers: {
        authorization: `Bearer ${metadata.token}`,
        "content-type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify(payload),
    });
    requireJsonMediaType(response, "Autopilot endpoint");
    const result = parseIJson(await readBoundedText(response, MAX_RESPONSE_BYTES));
    if (response.status === 409) {
      const error = new Error(result.detail || "Autopilot screen revision is stale.");
      error.code = "STALE_REVISION";
      throw error;
    }
    if (response.status !== 200 || result.ok !== true) {
      throw new Error(result.detail || "Autopilot command was refused.");
    }
    if (
      result.schema !== AUTOPILOT_RESULT_SCHEMA
      || result.request_id !== payload.request_id
    ) {
      throw new Error("Autopilot response identity mismatch.");
    }
    return result.value;
  }, "Autopilot command");
}
