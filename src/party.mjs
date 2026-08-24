// party.mjs — the active rappid party and the PC.
//
// The keeper owns every hatched rappid on this device
// (records under $RAPP_HOME/rappids/), carries up to six in the ACTIVE
// PARTY, and the rest wait in the ROOST. Party membership is estate data
// ($RAPP_HOME/party.json, schema rappid-party/1); the records themselves
// are never moved or mutated by party operations.

import { execFile, spawn } from "node:child_process";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import os from "node:os";
import path from "node:path";

export const PARTY_SCHEMA = "rappid-party/1";
export const PARTY_MAX = 6;

export function rappHome() {
  return process.env.RAPP_HOME || path.join(os.homedir(), ".rapp");
}

function partyPath() {
  return path.join(rappHome(), "party.json");
}

// xmur3 → mulberry32, byte-identical to species/rappidex.py and the fauna page.
export function mkRng(seed) {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  h = Math.imul(h ^ (h >>> 16), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  let s = (h ^= h >>> 16) >>> 0;
  return function () {
    s += 0x6D2B79F5;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function readRappids() {
  const dir = path.join(rappHome(), "rappids");
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const entry of fs.readdirSync(dir).sort()) {
    const p = path.join(dir, entry, "rappid.json");
    if (!fs.existsSync(p)) continue;
    try {
      const rec = JSON.parse(fs.readFileSync(p, "utf8"));
      if (rec && rec.schema === "rapp/1" && rec.rappid) {
        // party views never need the heavy fields
        const { egg, genome, ...pub } = rec;
        out.push(pub);
      }
    } catch {
      // an unreadable record is skipped, never fatal
    }
  }
  return out;
}

export function readParty() {
  try {
    const value = JSON.parse(fs.readFileSync(partyPath(), "utf8"));
    if (value && value.schema === PARTY_SCHEMA && Array.isArray(value.active)) {
      return value;
    }
  } catch {
    // fall through to the empty party
  }
  return { schema: PARTY_SCHEMA, active: [], max: PARTY_MAX };
}

function writeParty(party) {
  fs.mkdirSync(rappHome(), { recursive: true });
  fs.writeFileSync(partyPath(), `${JSON.stringify(party, null, 2)}\n`);
  return party;
}

export function partyState() {
  const rappids = readRappids();
  const party = readParty();
  const byId = new Map(rappids.map((r) => [r.rappid, r]));
  const active = party.active.filter((id) => byId.has(id)).map((id) => byId.get(id));
  const activeSet = new Set(active.map((r) => r.rappid));
  const pc = rappids.filter((r) => !activeSet.has(r.rappid));
  return { schema: PARTY_SCHEMA, max: party.max || PARTY_MAX, active, pc };
}

export function addToParty(rappid) {
  const rappids = readRappids();
  if (!rappids.some((r) => r.rappid === rappid)) {
    throw new Error("That rappid does not live on this device.");
  }
  const party = readParty();
  if (party.active.includes(rappid)) return partyState();
  if (party.active.length >= (party.max || PARTY_MAX)) {
    throw new Error(`The party is full (${party.max || PARTY_MAX}). Send one to the roost first.`);
  }
  party.active.push(rappid);
  writeParty(party);
  return partyState();
}

export function sendToPC(rappid) {
  const party = readParty();
  party.active = party.active.filter((id) => id !== rappid);
  writeParty(party);
  return partyState();
}

function which(binary) {
  const dirs = (process.env.PATH || "").split(path.delimiter).filter(Boolean);
  return dirs.some((dir) => {
    try {
      fs.accessSync(path.join(dir, binary), fs.constants.X_OK);
      return true;
    } catch {
      return false;
    }
  });
}

// Same fallback chain the species engine uses, so a cry never depends on one player.
function playerCommand(file, rate) {
  if (process.platform === "darwin" && which("afplay")) {
    return ["afplay", ["-r", rate.toFixed(3), file]];
  }
  if (which("ffplay")) {
    return ["ffplay", ["-nodisp", "-autoexit", "-loglevel", "quiet",
      "-af", `atempo=${rate.toFixed(3)}`, file]];
  }
  if (which("paplay")) return ["paplay", [file]];
  if (which("aplay")) return ["aplay", ["-q", file]];
  return null;
}

export function playCry(rec, { criesDir } = {}) {
  const dir = criesDir
    || (fs.existsSync(rec.cry || "") ? path.dirname(rec.cry) : null)
    // fileURLToPath, never URL.pathname: pathname is percent-encoded and keeps
    // the leading slash before a Windows drive letter.
    || path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "species", "cries");
  const file = path.join(dir, `${rec.species}.wav`);
  if (!fs.existsSync(file)) return false;
  const r = mkRng(rec.genome_id || rec.rappid);
  const rate = 0.94 + r() * 0.14; // the individual's accent — same math everywhere
  const player = playerCommand(file, rate);
  if (!player) return false;
  const [cmd, args] = player;
  const child = spawn(cmd, args, { stdio: "ignore", detached: true });
  child.on("error", () => {});
  child.unref();
  return true;
}

export function cryFor(rappid) {
  const rec = readRappids().find((r) => r.rappid === rappid);
  if (!rec) throw new Error("That rappid does not live on this device.");
  return playCry(rec);
}
