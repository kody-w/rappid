import assert from "node:assert/strict";
import test from "node:test";

import {
  H,
  Hb,
  RappChatRefusal,
  buildChatRequest,
  canonical,
  mintRappid,
  parseChatEnvelope,
  parseIJson,
  validateRappid,
} from "../src/rapp1.mjs";

test("RAPP/1 keyless identity uses raw UUIDv4 octets and a literal vector", () => {
  const tail = Hb(
    "rapp/1:rappid",
    Buffer.from("00000000000040008000000000000000", "hex"),
  );
  assert.equal(
    tail,
    "84d40a838d3ea28287f0dd4df33524d8f9ac71e385391c979c4cbe02a58a8609",
  );
  const rappid = mintRappid("kody-w", "rapp-zoo-v2", {
    uuid: "00000000-0000-4000-8000-000000000000",
  });
  assert.equal(rappid, `rappid:@kody-w/rapp-zoo-v2:${tail}`);
  assert.equal(validateRappid(rappid), true);
  assert.equal(validateRappid(`rappid:@Kody-W/rapp-zoo-v2:${tail}`), false);
  assert.equal(validateRappid(`rappid:@kody-w/rapp--zoo:${tail}`), false);
  assert.throws(
    () => mintRappid("kody-w", "rapp-zoo-v2", {
      uuid: "00000000-0000-0000-0000-000000000000",
    }),
    /UUIDv4/,
  );
});

test("RAPP/1 canonicalization and domain separation match literal vectors", () => {
  assert.equal(canonical({ b: 2, a: 1 }), '{"a":1,"b":2}');
  const hostile = JSON.parse('{"__proto__":{"x":1}}');
  assert.equal(canonical(hostile), '{"__proto__":{"x":1}}');
  assert.notEqual(
    H("rapp/1:particle", hostile),
    H("rapp/1:particle", {}),
  );
  assert.equal(
    H("rapp/1:particle", { b: 2, a: 1 }),
    "bd48cf9ef340c0bd7d5c84cef1c64ee11c329d699606729316e227b45307a0cf",
  );
  assert.notEqual(
    H("rapp/1:particle", { a: 1 }),
    H("rapp/1:wave", { a: 1 }),
  );
  assert.throws(() => canonical({ value: Number.POSITIVE_INFINITY }), /finite/);
  assert.throws(() => canonical({ value: "\ud800" }), /surrogate/);
});

test("strict I-JSON parsing refuses split-hash input domains", () => {
  assert.deepEqual(parseIJson('{"b":2,"a":0.1}'), { b: 2, a: 0.1 });
  assert.throws(() => parseIJson('{"a":1,"a":2}'), /duplicate/);
  assert.throws(() => parseIJson('{"value":"\\ud800"}'), /surrogate/);
  assert.throws(() => parseIJson('{"value":9007199254740993}'), /binary64/);
  assert.throws(() => parseIJson('{"value":0.10000000000000001}'), /binary64/);
  assert.throws(() => parseIJson('{"value":1e999}'), /binary64/);
  assert.throws(
    () => parseIJson('{"value":1e-10000000}'),
    /binary64|exponent/,
  );

  const tooDeep = `${"[".repeat(65)}0${"]".repeat(65)}`;
  assert.throws(() => parseIJson(tooDeep), /nesting/);
  assert.throws(
    () => parseIJson(`{"value":"${"x".repeat(1024 * 1024)}"}`),
    /exceeds/,
  );
});

test("the synchronous producer emits only the exact RAPP/1 request members", () => {
  assert.deepEqual(buildChatRequest({ user_input: "hello" }), {
    user_input: "hello",
  });
  assert.deepEqual(buildChatRequest({
    user_input: "hello",
    session_id: "session-1",
    idempotency_key: "turn-1",
  }), {
    user_input: "hello",
    session_id: "session-1",
    idempotency_key: "turn-1",
  });
  assert.throws(
    () => buildChatRequest({
      user_input: "hello",
      conversation_history: [],
    }),
    /unrecognized member/,
  );
});

test("the synchronous consumer accepts only exact success and refusal envelopes", () => {
  assert.deepEqual(
    parseChatEnvelope(
      200,
      '{"response":"ready","agent_logs":["agent:ok"],"session_id":"s1"}',
    ),
    {
      response: "ready",
      agent_logs: ["agent:ok"],
      session_id: "s1",
    },
  );
  assert.throws(
    () => parseChatEnvelope(
      200,
      '{"response":"ready","agent_logs":[],"session_id":"s1","extra":true}',
    ),
    /nonconforming members/,
  );
  assert.throws(
    () => parseChatEnvelope(
      422,
      '{"error":{"code":"unknown-session","step":null}}',
    ),
    RappChatRefusal,
  );
  assert.throws(
    () => parseChatEnvelope(
      422,
      '{"error":{"code":"invented-code","step":null}}',
    ),
    /not in the accepted registry/,
  );
  assert.throws(
    () => parseChatEnvelope(500, '{"error":"server"}'),
    /HTTP status 500/,
  );
});

test("rev-17: section 4 domain, section 5 tag table and RFC 8785 member order", async () => {
  const { decodeUtf8 } = await import("../src/http.mjs");
  assert.throws(() => parseIJson('["\\ufdd0"]'), /noncharacter/);
  assert.throws(() => parseIJson('{"\\udbff\\udfff":0}'), /noncharacter/);
  assert.throws(() => canonical({ value: "\uffff" }), /noncharacter/);
  assert.equal(
    canonical(parseIJson('{"9":2,"a":3,"10":1}')),
    '{"10":1,"9":2,"a":3}',
  );
  const deepest = `${"[".repeat(64)}0${"]".repeat(64)}`;
  assert.equal(canonical(parseIJson(deepest)), deepest);
  assert.throws(() => parseIJson(`[${deepest}]`), /nesting/);
  assert.equal(canonical(parseIJson("0e99999")), "0");
  assert.throws(
    () => parseIJson(decodeUtf8(Buffer.from("\ufeff{}", "utf8"))),
    /token/,
  );
  assert.throws(() => H("rapp/1:egg", []), /section 5/);
  assert.throws(() => Hb("rapp/1:particle", Buffer.alloc(0)), /section 5/);
  assert.throws(() => Hb("rappid", Buffer.alloc(0)), /section 5/);
});
