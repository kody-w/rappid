import assert from "node:assert/strict";
import test from "node:test";

import { KeyedQueue } from "../src/keyed-queue.mjs";

test("same-neighborhood turns serialize while different neighborhoods proceed", async () => {
  const queue = new KeyedQueue();
  const order = [];
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const first = queue.run("a", async () => {
    order.push("a1-start");
    await gate;
    order.push("a1-end");
  });
  const second = queue.run("a", async () => {
    order.push("a2");
  });
  const other = queue.run("b", async () => {
    order.push("b1");
  });
  await other;
  assert.deepEqual(order, ["a1-start", "b1"]);
  release();
  await Promise.all([first, second]);
  assert.deepEqual(order, ["a1-start", "b1", "a1-end", "a2"]);
});

test("a failed turn does not poison the next turn", async () => {
  const queue = new KeyedQueue();
  await assert.rejects(
    () => queue.run("a", async () => { throw new Error("failed"); }),
    /failed/,
  );
  assert.equal(await queue.run("a", async () => "recovered"), "recovered");
});
