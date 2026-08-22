export async function readBoundedBytes(response, maxBytes) {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) {
    await response.body?.cancel();
    throw new Error(`Response exceeds the ${maxBytes}-byte limit.`);
  }
  if (!response.body) return Buffer.alloc(0);
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new Error(`Response exceeds the ${maxBytes}-byte limit.`);
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks, total);
}

export async function readBoundedText(response, maxBytes) {
  return decodeUtf8(await readBoundedBytes(response, maxBytes), "Response");
}

export function responseMediaType(response) {
  return String(response.headers.get("content-type") || "")
    .split(";", 1)[0]
    .trim()
    .toLowerCase();
}

export function requireJsonMediaType(response, label = "Endpoint") {
  if (responseMediaType(response) !== "application/json") {
    throw new Error(`${label} must return application/json.`);
  }
}

export async function withTimeout(timeoutMs, operation, label = "Endpoint") {
  if (
    !Number.isSafeInteger(timeoutMs)
    || timeoutMs < 1
    || timeoutMs > 5 * 60 * 1000
  ) {
    throw new Error(`${label} timeout must be between 1 ms and 5 minutes.`);
  }
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(new Error(`${label} timed out.`)),
    timeoutMs,
  );
  timer.unref?.();
  try {
    return await operation(controller.signal);
  } catch (error) {
    if (controller.signal.aborted) throw controller.signal.reason;
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
import { TextDecoder } from "node:util";

export function decodeUtf8(bytes, label = "UTF-8 input") {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new Error(`${label} contains invalid UTF-8.`);
  }
}
