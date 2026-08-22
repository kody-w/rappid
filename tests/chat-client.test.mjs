import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";

import {
  RappChatClient,
} from "../src/chat-client.mjs";
import { RappChatRefusal } from "../src/rapp1.mjs";

async function server(t, handler) {
  const instance = createServer(handler);
  await new Promise((resolve, reject) => {
    instance.once("error", reject);
    instance.listen(0, "127.0.0.1", resolve);
  });
  t.after(() => new Promise((resolve) => instance.close(resolve)));
  return `http://127.0.0.1:${instance.address().port}`;
}

function json(response, status, value, headers = {}) {
  const body = typeof value === "string" ? value : JSON.stringify(value);
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    ...headers,
  });
  response.end(body);
}

test("client emits the exact RAPP/1 request and accepts exact success", async (t) => {
  let observed;
  const baseUrl = await server(t, (request, response) => {
    if (request.url === "/health") {
      json(response, 200, { status: "ok", provider_detail: "allowed extension" });
      return;
    }
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => { body += chunk; });
    request.on("end", () => {
      observed = {
        body,
        contentType: request.headers["content-type"],
        method: request.method,
        url: request.url,
      };
      json(response, 200, {
        response: "ready",
        agent_logs: ["tool:done"],
        session_id: "session-1",
      });
    });
  });
  const client = new RappChatClient({ baseUrl });
  assert.equal((await client.health()).status, "ok");
  assert.deepEqual(await client.chat({
    user_input: "hello",
    idempotency_key: "turn-1",
  }), {
    response: "ready",
    agent_logs: ["tool:done"],
    session_id: "session-1",
  });
  assert.deepEqual(observed, {
    body: '{"idempotency_key":"turn-1","user_input":"hello"}',
    contentType: "application/json",
    method: "POST",
    url: "/chat",
  });
});

test("nonconforming success, refusal, status, and media type fail closed", async (t) => {
  let mode = "extra";
  const baseUrl = await server(t, (_request, response) => {
    if (mode === "extra") {
      json(response, 200, {
        response: "ready",
        agent_logs: [],
        session_id: "s",
        extra: true,
      });
    } else if (mode === "refusal") {
      json(response, 422, {
        error: { code: "unknown-session", step: null },
      });
    } else if (mode === "server") {
      json(response, 500, { error: "nope" });
    } else {
      response.writeHead(200, { "content-type": "text/html" });
      response.end("<p>not json</p>");
    }
  });
  const client = new RappChatClient({ baseUrl });
  await assert.rejects(() => client.chat({ user_input: "x" }), /members/);
  mode = "refusal";
  await assert.rejects(
    () => client.chat({ user_input: "x" }),
    RappChatRefusal,
  );
  mode = "server";
  await assert.rejects(() => client.chat({ user_input: "x" }), /HTTP status 500/);
  mode = "html";
  await assert.rejects(() => client.chat({ user_input: "x" }), /application\/json/);
});

test("health cannot become ready from generic HTTP 200", async (t) => {
  let mode = "wrong-status";
  const baseUrl = await server(t, (_request, response) => {
    if (mode === "wrong-status") json(response, 200, { status: "ready" });
    else if (mode === "array") json(response, 200, []);
    else json(response, 200, { status: "ok" });
  });
  const client = new RappChatClient({ baseUrl });
  await assert.rejects(() => client.health(), /status "ok"/);
  mode = "array";
  await assert.rejects(() => client.health(), /status "ok"/);
  mode = "ok";
  assert.equal((await client.health()).status, "ok");
});

test("redirects, oversized bodies, and hanging endpoints are bounded", async (t) => {
  let mode = "redirect";
  const baseUrl = await server(t, (_request, response) => {
    if (mode === "redirect") {
      response.writeHead(302, { location: "http://127.0.0.1:1/chat" });
      response.end();
    } else if (mode === "large") {
      json(response, 200, "x".repeat(4096));
    }
  });

  const client = new RappChatClient({
    baseUrl,
    maxBytes: 1024,
    timeoutMs: 50,
  });
  await assert.rejects(() => client.chat({ user_input: "x" }), /redirect|fetch/i);
  mode = "large";
  await assert.rejects(() => client.chat({ user_input: "x" }), /1024-byte/);
  mode = "hang";
  await assert.rejects(() => client.chat({ user_input: "x" }), /timed out/);
});

test("invalid UTF-8 is refused instead of repaired into RAPP JSON", async (t) => {
  const baseUrl = await server(t, (_request, response) => {
    const prefix = Buffer.from('{"response":"');
    const suffix = Buffer.from('","agent_logs":[],"session_id":"s"}');
    const body = Buffer.concat([prefix, Buffer.from([0xff]), suffix]);
    response.writeHead(200, {
      "content-type": "application/json",
      "content-length": String(body.length),
    });
    response.end(body);
  });
  await assert.rejects(
    () => new RappChatClient({ baseUrl }).chat({ user_input: "x" }),
    /invalid UTF-8/,
  );
});
