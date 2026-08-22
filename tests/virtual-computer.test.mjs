import assert from "node:assert/strict";
import test from "node:test";

import {
  buildMachineCommand,
  buildMachineEvent,
  parseMachineEnvelope,
} from "../src/virtual-computer.mjs";

test("typed AS400 sigil carries deterministic fine-grained control through chat", () => {
  const text = buildMachineCommand({
    machine: "AS400",
    op: "library.create",
    args: { name: "DEVLIB" },
    idempotencyKey: "job-1",
    turnBudget: 2,
  });
  assert.equal(
    text,
    '|||AS400))||| {"args":{"name":"DEVLIB"},"idempotency_key":"job-1","op":"library.create","schema":"rapp-zoo-machine-command/2.0","turn_budget":2}',
  );
  assert.deepEqual(parseMachineEnvelope(text), {
    machine: "AS400",
    type: "command",
    envelope: {
      args: { name: "DEVLIB" },
      idempotency_key: "job-1",
      op: "library.create",
      schema: "rapp-zoo-machine-command/2.0",
      turn_budget: 2,
    },
  });
});

test("machine events can drive one bounded AI reaction", () => {
  const event = buildMachineEvent({
    machine: "AS400",
    kind: "job.completed",
    eventId: "job-1:completed",
    chainDepth: 1,
    payload: { job: "DAILYREPORT", status: "ok" },
  });
  const parsed = parseMachineEnvelope(event);
  assert.equal(parsed.type, "event");
  assert.equal(parsed.envelope.chain_depth, 1);
  assert.equal(parsed.envelope.payload.job, "DAILYREPORT");
});

test("machine controls reject shell authority, unbounded loops, and malformed sigils", () => {
  assert.throws(
    () => buildMachineCommand({
      machine: "AS400",
      op: "job.submit",
      args: { shell: "rm -rf /" },
      idempotencyKey: "x",
    }),
    /privileged key shell/,
  );
  assert.throws(
    () => buildMachineCommand({
      machine: "AS400",
      op: "job.submit",
      args: {},
      idempotencyKey: "x",
      turnBudget: 33,
    }),
    /1-32/,
  );
  assert.throws(
    () => buildMachineEvent({
      machine: "AS400",
      kind: "job.completed",
      eventId: "x",
      chainDepth: 9,
    }),
    /0-8/,
  );
  assert.throws(
    () => parseMachineEnvelope('|||as400))||| {"schema":"x"}'),
    /sigil/,
  );
});
