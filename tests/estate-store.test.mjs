import assert from "node:assert/strict";
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { EstateStore } from "../src/estate-store.mjs";

const UUID_A = "00000000-0000-4000-8000-000000000010";
const UUID_B = "00000000-0000-4000-8000-000000000011";
const RESIDENT_A = `rappid:@kody-w/research:${"a".repeat(64)}`;
const RESIDENT_B = `rappid:@kody-w/finance:${"b".repeat(64)}`;

function fixture(t) {
  const directory = mkdtempSync(path.join(os.tmpdir(), "rapp-zoo-v2-store-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  let tick = 0;
  const now = () => new Date(Date.UTC(2026, 7, 22, 12, 0, tick++));
  return { directory, now };
}

test("estate identity is private, persistent, and never reminted", (t) => {
  const { directory, now } = fixture(t);
  const priorUmask = process.umask(0o377);
  t.after(() => process.umask(priorUmask));
  const store = new EstateStore({ rootDir: directory, now });
  const first = store.initialize({ uuid: UUID_A });
  const second = new EstateStore({ rootDir: directory, now }).initialize({
    uuid: UUID_B,
  });
  assert.equal(second.rappid, first.rappid);
  assert.equal(statSync(store.estateHome).mode & 0o777, 0o700);
  assert.equal(statSync(store.estateFile).mode & 0o777, 0o600);
  assert.equal(statSync(store.identityFile).mode & 0o777, 0o600);
  assert.equal(statSync(store.claimsFile).mode & 0o777, 0o600);
  assert.deepEqual(
    JSON.parse(readFileSync(store.identityFile, "utf8")),
    { schema: "rapp/1", rappid: first.rappid, parent_rappid: null },
  );
});

test("attach and detach update estate membership and global ownership together", (t) => {
  const { directory, now } = fixture(t);
  const primary = new EstateStore({ rootDir: directory, now });
  const estate = primary.initialize({ uuid: UUID_A });
  const attached = primary.attach({
    rappid: RESIDENT_A,
    name: "Research",
    baseUrl: "http://127.0.0.1:7071/",
  });
  assert.equal(attached.attached, true);
  assert.equal(attached.estate.neighborhoods.length, 2);
  const claims = JSON.parse(readFileSync(primary.claimsFile, "utf8"));
  assert.equal(claims.claims[RESIDENT_A].estate_id, estate.estate_id);

  const again = primary.attach({
    rappid: RESIDENT_A,
    name: "Research",
    baseUrl: "http://127.0.0.1:7071/",
    attachedUtc: attached.resident.attached_utc,
  });
  assert.equal(again.attached, false);

  const detached = primary.detach(RESIDENT_A);
  assert.equal(detached.detached, true);
  assert.equal(detached.estate.neighborhoods.length, 1);
  assert.equal(
    Object.hasOwn(
      JSON.parse(readFileSync(primary.claimsFile, "utf8")).claims,
      RESIDENT_A,
    ),
    false,
  );
});

test("another estate cannot claim a resident or endpoint already owned", (t) => {
  const { directory, now } = fixture(t);
  const primary = new EstateStore({ rootDir: directory, now });
  primary.initialize({ uuid: UUID_A });
  primary.attach({
    rappid: RESIDENT_A,
    name: "Research",
    baseUrl: "http://127.0.0.1:7071/",
  });

  const child = new EstateStore({
    rootDir: directory,
    estateHome: path.join(directory, "estates", "child"),
    now,
  });
  const parent = primary.read();
  child.initialize({
    name: "Child",
    generation: 1,
    parentEstateId: parent.estate_id,
    parentNeighborhoodId: parent.rappid,
    uuid: UUID_B,
  });
  assert.throws(
    () => child.attach({
      rappid: RESIDENT_A,
      name: "Stowaway",
      baseUrl: "http://127.0.0.1:7072/",
    }),
    /already claimed/,
  );
  assert.throws(
    () => child.attach({
      rappid: RESIDENT_B,
      name: "Endpoint Alias",
      baseUrl: "http://127.0.0.1:7071/",
    }),
    /endpoint is already claimed/,
  );
});

test("an interrupted membership transaction rolls forward atomically", (t) => {
  const { directory, now } = fixture(t);
  const store = new EstateStore({ rootDir: directory, now });
  const estate = store.initialize({ uuid: UUID_A });
  const claims = JSON.parse(readFileSync(store.claimsFile, "utf8"));
  const transaction = {
    schema: "rapp-zoo-membership-transaction/2.0",
    estate_path: path.relative(store.rootDir, store.estateFile),
    identity_path: path.relative(store.rootDir, store.identityFile),
    estate,
    identity: {
      schema: "rapp/1",
      rappid: estate.rappid,
      parent_rappid: null,
    },
    claims,
  };
  writeFileSync(
    store.transactionFile,
    `${JSON.stringify(transaction, null, 2)}\n`,
    { mode: 0o600 },
  );
  writeFileSync(store.estateFile, "{broken", { mode: 0o600 });
  const recovered = store.read();
  assert.equal(recovered.rappid, estate.rappid);
  assert.equal(existsSync(store.transactionFile), false);
});

test("managed symlinks and unexplained locks fail closed", (t) => {
  const { directory, now } = fixture(t);
  const target = path.join(directory, "real");
  const link = path.join(directory, "linked");
  writeFileSync(target, "not a directory");
  symlinkSync(target, link);
  assert.throws(
    () => new EstateStore({ rootDir: link, now }),
    /symlink|real directory/,
  );

  const store = new EstateStore({ rootDir: directory, now });
  store.initialize({ uuid: UUID_A });
  writeFileSync(store.lockFile, "stale\n", { mode: 0o600 });
  assert.throws(() => store.read(), /lock exists/);
  rmSync(store.lockFile);

  assert.equal(lstatSync(store.estateHome).isSymbolicLink(), false);
  chmodSync(store.identityFile, 0o644);
  store.read();
  assert.equal(
    statSync(store.identityFile).mode & 0o777,
    0o644,
    "read does not silently rewrite permissions or hide drift",
  );
});
