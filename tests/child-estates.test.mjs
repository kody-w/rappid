import assert from "node:assert/strict";
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { ChildEstateManager } from "../src/child-estates.mjs";
import { EstateStore } from "../src/estate-store.mjs";

const UUID = "00000000-0000-4000-8000-000000000020";

function fixture(t, {
  spawnImpl = () => ({ pid: 4242, unref() {} }),
  controlRequest = async () => false,
  generation = 0,
} = {}) {
  const root = mkdtempSync(path.join(os.tmpdir(), "rapp-zoo-children-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  let tick = 0;
  const now = () => new Date(Date.UTC(2026, 7, 22, 12, 0, tick++));
  const parentStore = new EstateStore({ rootDir: root, now });
  parentStore.initialize({
    name: "Parent",
    generation,
    parentEstateId: generation ? `estate:rappid:@kody-w/ancestor:${"c".repeat(64)}` : null,
    parentNeighborhoodId: generation ? `rappid:@kody-w/ancestor:${"c".repeat(64)}` : null,
    uuid: UUID,
  });
  const launches = [];
  const manager = new ChildEstateManager({
    parentStore,
    electronPath: "/Applications/Electron.app/Contents/MacOS/Electron",
    appDir: "/opt/rapp-zoo-v2",
    now,
    controlRequest,
    spawnImpl: (command, args, options) => {
      launches.push({ command, args, options });
      return spawnImpl(command, args, options);
    },
  });
  return { launches, manager, parentStore, root };
}

test("hatch creates an isolated child estate and launches the same neutral app", async (t) => {
  const { launches, manager, parentStore } = fixture(t);
  const child = await manager.hatch("Research Lab");
  const manifest = JSON.parse(readFileSync(
    path.join(child.estate_home, "estate.json"),
    "utf8",
  ));
  const parent = parentStore.read();
  assert.equal(manifest.parent_estate_id, parent.estate_id);
  assert.equal(manifest.parent_neighborhood_id, parent.rappid);
  assert.equal(manifest.generation, 1);
  assert.equal(child.status, "running");
  assert.equal(child.pid, 4242);
  assert.equal(statSync(manager.registryFile).mode & 0o777, 0o600);
  assert.equal(launches.length, 1);
  assert.equal(
    launches[0].command,
    "/Applications/Electron.app/Contents/MacOS/Electron",
  );
  assert.ok(launches[0].args.includes("/opt/rapp-zoo-v2"));
  assert.ok(
    launches[0].args.includes(
      `--rapp-zoo-estate-home=${child.estate_home}`,
    ),
  );
  assert.equal(launches[0].options.env.RAPP_ZOO_ROOT, parentStore.rootDir);
  assert.notEqual(child.user_data, parentStore.estateHome);
});

test("stop and list use only the child capability channel", async (t) => {
  const actions = [];
  const { manager } = fixture(t, {
    controlRequest: async (file, action, options) => {
      actions.push({ file, action, options });
      return true;
    },
  });
  const child = await manager.hatch("Safe Child");
  const listed = await manager.list();
  assert.equal(listed[0].capability_live, true);
  const stopped = await manager.stop(child.estate_id);
  assert.deepEqual(stopped, { stopped: true, estate_id: child.estate_id });
  assert.deepEqual(
    actions.map((entry) => entry.action),
    ["probe", "stop"],
  );
  assert.equal((await manager.list())[0].capability_live, false);
});

test("unverifiable running authority fails closed and cannot respawn", async (t) => {
  const { manager } = fixture(t, {
    controlRequest: async () => false,
  });
  await manager.hatch("Uncertain Child");
  await assert.rejects(
    () => manager.hatch("Uncertain Child"),
    /may still be live.*cannot be verified/,
  );
  assert.deepEqual(await manager.stop("uncertain-child"), {
    stopped: false,
    reason: "instance capability could not be verified",
  });
});

test("a synchronous spawn failure preserves identity for a safe retry", async (t) => {
  let attempts = 0;
  const { manager } = fixture(t, {
    spawnImpl: () => {
      attempts += 1;
      if (attempts === 1) throw new Error("spawn failed");
      return { pid: 5252, unref() {} };
    },
  });
  await assert.rejects(() => manager.hatch("Retry Child"), /spawn failed/);
  const failed = JSON.parse(readFileSync(manager.registryFile, "utf8"))
    .children[0];
  assert.equal(failed.status, "spawn-failed");
  const retried = await manager.hatch("Retry Child");
  assert.equal(retried.rappid, failed.rappid);
  assert.equal(retried.pid, 5252);
});

test("recursive spawning is bounded to eight generations", async (t) => {
  const { manager } = fixture(t, { generation: 8 });
  await assert.rejects(
    () => manager.hatch("Too Deep"),
    /limited to 8 generations/,
  );
});
