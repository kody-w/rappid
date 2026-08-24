import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const home = mkdtempSync(path.join(os.tmpdir(), "rappid-party-"));
process.env.RAPP_HOME = home;

const { partyState, addToParty, sendToPC, readRappids, mkRng, PARTY_MAX } =
  await import("../src/party.mjs");

function mint(species, n) {
  const dir = path.join(home, "rappids", `${species}-test${n ?? ""}`);
  mkdirSync(dir, { recursive: true });
  const rappid = `rappid:@test/${species}-test${n ?? ""}:${String(n ?? 0).repeat(1).padStart(1, "0").repeat(64).slice(0, 64)}`;
  writeFileSync(path.join(dir, "rappid.json"), JSON.stringify({
    schema: "rapp/1", rappid, kind: "creature", species,
    name: `${species}-test`, display_name: `${species} test`, host: "test",
    genome_id: `gid-${species}-${n ?? 0}`, created_at: "2026-08-24T00:00:00Z",
  }));
  return rappid;
}

test("prng matches the species engine vectors", () => {
  const r = mkRng("rappid:claude:kody-mbp:0");
  assert.ok(Math.abs(r() - 0.22757202526554465) < 1e-15);
});

test("hatched rappids appear in the roost, never auto-partied", () => {
  const a = mint("claude", 1);
  const state = partyState();
  assert.equal(state.active.length, 0);
  assert.ok(state.pc.some((r) => r.rappid === a));
});

test("party add / send-to-roost round trip", () => {
  const a = readRappids()[0].rappid;
  let state = addToParty(a);
  assert.deepEqual(state.active.map((r) => r.rappid), [a]);
  state = sendToPC(a);
  assert.equal(state.active.length, 0);
  assert.ok(state.pc.some((r) => r.rappid === a));
});

test("party caps at six", () => {
  const ids = [1, 2, 3, 4, 5, 6, 7].map((n) => mint("copilot", n));
  for (const id of ids.slice(0, PARTY_MAX)) addToParty(id);
  assert.throws(() => addToParty(ids[6]), /party is full/);
  for (const id of ids.slice(0, PARTY_MAX)) sendToPC(id);
});

test("unknown rappid refused", () => {
  assert.throws(() => addToParty("rappid:@test/ghost:" + "f".repeat(64)), /does not live/);
});

test("records never expose egg or genome to the view", () => {
  for (const rec of readRappids()) {
    assert.ok(!("egg" in rec) && !("genome" in rec));
  }
});

test.after(() => rmSync(home, { recursive: true, force: true }));
