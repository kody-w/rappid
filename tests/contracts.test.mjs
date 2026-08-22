import assert from "node:assert/strict";
import test from "node:test";

import {
  createEstateManifest,
  createResidentNeighborhood,
  normalizeLoopbackBaseUrl,
  validateEstate,
} from "../src/contracts.mjs";

const UUID_ROOT = "00000000-0000-4000-8000-000000000001";
const UUID_CHILD = "00000000-0000-4000-8000-000000000002";
const RESIDENT = `rappid:@kody-w/research:${"a".repeat(64)}`;

test("a root estate is a fresh RAPP/1 identity and visible neutral app", () => {
  const estate = createEstateManifest({
    name: "Primary",
    uuid: UUID_ROOT,
    createdUtc: "2026-08-22T12:00:00.000Z",
  });
  assert.equal(estate.schema, "rapp-zoo-estate/2.0");
  assert.match(
    estate.rappid,
    /^rappid:@kody-w\/rapp-zoo-v2:[0-9a-f]{64}$/,
  );
  assert.equal(estate.estate_id, `estate:${estate.rappid}`);
  assert.equal(estate.app_name, "RAPP Zoo v2");
  assert.equal(estate.dock_badge, "Z2");
  assert.equal(estate.neighborhoods.length, 1);
  assert.equal(estate.neighborhoods[0].kind, "root");
});

test("a detached child carries exact parent lineage and a separate app identity", () => {
  const parent = createEstateManifest({
    uuid: UUID_ROOT,
    createdUtc: "2026-08-22T12:00:00.000Z",
  });
  const child = createEstateManifest({
    name: "Research Lab",
    generation: 1,
    parentEstateId: parent.estate_id,
    parentNeighborhoodId: parent.root_neighborhood_id,
    uuid: UUID_CHILD,
    createdUtc: "2026-08-22T12:01:00.000Z",
  });
  assert.equal(child.parent_estate_id, parent.estate_id);
  assert.equal(child.parent_neighborhood_id, parent.rappid);
  assert.equal(child.generation, 1);
  assert.match(child.app_name, /^RAPP Zoo v2 · Research Lab · [0-9a-f]{4}$/);
  assert.notEqual(child.rappid, parent.rappid);
});

test("resident attachment is explicit, loopback-only, and estate-attributed", () => {
  const estate = createEstateManifest({
    uuid: UUID_ROOT,
    createdUtc: "2026-08-22T12:00:00.000Z",
  });
  const resident = createResidentNeighborhood({
    estate,
    rappid: RESIDENT,
    name: "Research",
    baseUrl: "http://127.0.0.1:7071/",
    attachedUtc: "2026-08-22T12:02:00.000Z",
  });
  assert.equal(resident.estate_id, estate.estate_id);
  assert.equal(resident.adapter, "rapp/1");
  assert.equal(resident.base_url, "http://127.0.0.1:7071");
  estate.neighborhoods.push(resident);
  assert.equal(validateEstate(estate), estate);
});

test("foreign, duplicate, malformed, and remote residents fail closed", () => {
  const estate = createEstateManifest({
    uuid: UUID_ROOT,
    createdUtc: "2026-08-22T12:00:00.000Z",
  });
  const resident = createResidentNeighborhood({
    estate,
    rappid: RESIDENT,
    name: "Research",
    baseUrl: "http://127.0.0.1:7071",
    attachedUtc: "2026-08-22T12:02:00.000Z",
  });
  estate.neighborhoods.push(resident, structuredClone(resident));
  assert.throws(() => validateEstate(estate), /unique/);

  for (const url of [
    "https://127.0.0.1:7071/",
    "http://localhost:7071/",
    "http://10.0.0.1:7071/",
    "http://127.0.0.1:7071/chat",
    "http://user:pass@127.0.0.1:7071/",
  ]) {
    assert.throws(() => normalizeLoopbackBaseUrl(url), /127\.0\.0\.1/);
  }

  const clean = createEstateManifest({
    uuid: UUID_CHILD,
    createdUtc: "2026-08-22T12:00:00.000Z",
  });
  const foreign = createResidentNeighborhood({
    estate: clean,
    rappid: RESIDENT,
    name: "Research",
    baseUrl: "http://127.0.0.1:7071",
    attachedUtc: "2026-08-22T12:02:00.000Z",
  });
  foreign.estate_id = `estate:rappid:@kody-w/foreign:${"b".repeat(64)}`;
  clean.neighborhoods.push(foreign);
  assert.throws(() => validateEstate(clean), /foreign/);
});
