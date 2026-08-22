import { canonical, parseIJson } from "./rapp1.mjs";

export const MACHINE_COMMAND_SCHEMA = "rapp-zoo-machine-command/2.0";
export const MACHINE_EVENT_SCHEMA = "rapp-zoo-machine-event/2.0";
const MACHINE = /^[A-Z0-9]+(?:-[A-Z0-9]+)*$/;
const OPERATION = /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/;
const FORBIDDEN_KEYS = new Set([
  "shell",
  "exec",
  "eval",
  "command_line",
  "hypervisor_flags",
  "host_path",
  "credential",
  "token",
  "password",
  "secret",
]);

export function assertUnprivilegedMachineValue(value) {
  if (Array.isArray(value)) {
    value.forEach(assertUnprivilegedMachineValue);
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    if (FORBIDDEN_KEYS.has(key.toLowerCase())) {
      throw new Error(`Machine command refuses privileged key ${key}.`);
    }
    assertUnprivilegedMachineValue(child);
  }
}

function sigil(machine, event = false) {
  if (
    !MACHINE.test(String(machine))
    || String(machine).length < 2
    || String(machine).length > 32
  ) {
    throw new Error("Machine sigil must be a 2-32 character uppercase label.");
  }
  return `|||${machine}${event ? "-EVENT" : ""}))|||`;
}

export function buildMachineCommand({
  machine,
  op,
  args = {},
  idempotencyKey,
  turnBudget = 1,
}) {
  if (!OPERATION.test(String(op))) {
    throw new Error("Machine operation name is invalid.");
  }
  if (!args || typeof args !== "object" || Array.isArray(args)) {
    throw new Error("Machine command args must be an object.");
  }
  if (
    typeof idempotencyKey !== "string"
    || !idempotencyKey
    || idempotencyKey.length > 200
  ) {
    throw new Error("Machine command requires a bounded idempotency key.");
  }
  if (!Number.isSafeInteger(turnBudget) || turnBudget < 1 || turnBudget > 32) {
    throw new Error("Machine command turn budget must be 1-32.");
  }
  assertUnprivilegedMachineValue(args);
  const envelope = {
    schema: MACHINE_COMMAND_SCHEMA,
    op,
    args,
    idempotency_key: idempotencyKey,
    turn_budget: turnBudget,
  };
  const text = `${sigil(machine)} ${canonical(envelope)}`;
  if (Buffer.byteLength(text, "utf8") > 64 * 1024) {
    throw new Error("Machine command exceeds the RAPP chat input budget.");
  }
  return text;
}

export function parseMachineEnvelope(value) {
  const match = /^\|\|\|([A-Z0-9]+(?:-[A-Z0-9]+)*)\)\)\|\|\| ([\s\S]+)$/
    .exec(String(value));
  if (!match) throw new Error("Machine envelope sigil is invalid.");
  const [, label, source] = match;
  const eventMarker = label.endsWith("-EVENT");
  const machine = eventMarker ? label.slice(0, -"-EVENT".length) : label;
  sigil(machine, Boolean(eventMarker));
  const envelope = parseIJson(source);
  if (!envelope || typeof envelope !== "object" || Array.isArray(envelope)) {
    throw new Error("Machine envelope body must be an object.");
  }
  assertUnprivilegedMachineValue(envelope);
  if (!eventMarker) {
    if (
      envelope.schema !== MACHINE_COMMAND_SCHEMA
      || !OPERATION.test(String(envelope.op))
      || typeof envelope.idempotency_key !== "string"
      || !Number.isSafeInteger(envelope.turn_budget)
      || envelope.turn_budget < 1
      || envelope.turn_budget > 32
      || !envelope.args
      || typeof envelope.args !== "object"
      || Array.isArray(envelope.args)
    ) {
      throw new Error("Machine command envelope is invalid.");
    }
  } else if (
    envelope.schema !== MACHINE_EVENT_SCHEMA
    || !OPERATION.test(String(envelope.kind))
    || typeof envelope.event_id !== "string"
    || !envelope.event_id
    || !Number.isSafeInteger(envelope.chain_depth)
    || envelope.chain_depth < 0
    || envelope.chain_depth > 8
    || !envelope.payload
    || typeof envelope.payload !== "object"
    || Array.isArray(envelope.payload)
  ) {
    throw new Error("Machine event envelope is invalid.");
  }
  return { machine, type: eventMarker ? "event" : "command", envelope };
}

export function buildMachineEvent({
  machine,
  kind,
  eventId,
  payload = {},
  chainDepth = 0,
}) {
  if (!OPERATION.test(String(kind))) {
    throw new Error("Machine event kind is invalid.");
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("Machine event payload must be an object.");
  }
  if (typeof eventId !== "string" || !eventId || eventId.length > 200) {
    throw new Error("Machine event requires a bounded event ID.");
  }
  if (!Number.isSafeInteger(chainDepth) || chainDepth < 0 || chainDepth > 8) {
    throw new Error("Machine event chain depth must be 0-8.");
  }
  assertUnprivilegedMachineValue(payload);
  return `${sigil(machine, true)} ${canonical({
    schema: MACHINE_EVENT_SCHEMA,
    kind,
    event_id: eventId,
    chain_depth: chainDepth,
    payload,
  })}`;
}
