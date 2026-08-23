import { readFileSync } from "node:fs";

import { canonical } from "./rapp1.mjs";
import { assertUnprivilegedMachineValue } from "./virtual-computer.mjs";

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

try {
  const [exportName] = process.argv.slice(2);
  const source = readFileSync(0);
  if (source.length > 768 * 1024) {
    throw new Error("simulation provider request exceeds 768 KiB");
  }
  const request = JSON.parse(
    new TextDecoder("utf-8", { fatal: true }).decode(source),
  );
  if (
    typeof request.provider_source !== "string"
    || Buffer.byteLength(request.provider_source, "utf8") > 64 * 1024
  ) {
    throw new Error("simulation provider source is invalid");
  }
  const providerModule = await import(
    `data:text/javascript;base64,${
      Buffer.from(request.provider_source, "utf8").toString("base64")
    }`
  );
  const provider = providerModule[exportName];
  if (typeof provider !== "function") {
    throw new Error("simulation provider export is not a function");
  }
  const value = await provider({
    ...request,
    plan: deepFreeze(request.plan),
    provider_data: deepFreeze(request.provider_data),
    signal: new AbortController().signal,
  });
  assertUnprivilegedMachineValue(value);
  const encoded = canonical(value);
  if (Buffer.byteLength(encoded, "utf8") > 64 * 1024) {
    throw new Error("simulation result exceeds 64 KiB");
  }
  process.stdout.write(JSON.stringify({
    ok: true,
    encoded: Buffer.from(encoded, "utf8").toString("base64"),
  }));
} catch (error) {
  process.stderr.write(String(error?.message || error).slice(0, 8000));
  process.exitCode = 1;
}
