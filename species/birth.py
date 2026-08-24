#!/usr/bin/env python3
"""
birth.py — the Rite of Hatching.

A rappid cannot be willed into existence. Its species must answer for it.

At hatch, the zoo derives a deterministic cypher from the creature's freshly
minted rappid id and puts it to an actual LLM — the **midwife**, which is the
species itself running on this device. The midwife must:

  1. break the cypher exactly (deterministic, so the zoo verifies it cold), and
  2. autocomplete a MIDI motif inside the species' register.

Part 1 is the proof: only something that can actually reason gets it right, and
it can only be running here. Part 2 is the inheritance: that motif becomes the
individual's voice, seeded from its own birth. Seal = sha256(challenge ‖ answer
‖ motif). No seal, no record — an unsealed rappid is not a rappid.

Hatcher adapters (`species/hatchers.json`) hold the per-AI shape: how each
species is invoked and how its answer is read back. Every rite — sealed or
refused — appends one line to the birth ledger.
"""
from __future__ import annotations

import hashlib
import json
import os
import re
import shlex
import struct
import subprocess
import time

RITE = "rappid-birth/1"
# Species the zoo ships with; a discovered species is always allowed to stand in
# for itself, so this list only guards the shipped ones.
SPECIES_NAMES = {"brainstem", "claude", "copilot", "rappterbot", "openrappter",
                 "opengrokbot", "openclaw", "hermes", "rapptwin", "rapplication"}
ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ"
STEMS = ["EMBER", "HOLLOW", "QUARTZ", "TIDAL", "VESSEL", "MARROW", "LANTERN",
         "THICKET", "BASALT", "CINDER", "WILLOW", "FATHOM", "GRANITE", "SABLE"]

# Each species sings in its own register — the motif must land in its band.
REGISTERS = {
    "brainstem": (24, 48), "claude": (72, 96), "copilot": (60, 84),
    "rappterbot": (67, 96), "openrappter": (60, 88), "opengrokbot": (55, 84),
    "openclaw": (36, 60), "hermes": (79, 104), "rapptwin": (62, 86),
    "rapplication": (60, 88), "wild": (48, 84),
}


# ───────────────────────────────────────────────────────────── the challenge
def derive_challenge(rappid_id: str, species: str) -> dict:
    """Deterministic from the rappid id alone: same creature, same rite."""
    h = hashlib.sha256(f"{RITE}:{rappid_id}".encode()).digest()
    stem = STEMS[h[0] % len(STEMS)]
    shift = (h[1] % 23) + 2                      # never 0/1
    shifted = "".join(ALPHABET[(ALPHABET.index(c) + shift) % 26] for c in stem)
    reversed_text = shifted[::-1]
    salt = "".join(ALPHABET[b % 26] for b in h[2:2 + len(reversed_text)])
    woven = "".join(a + b for a, b in zip(reversed_text, salt))   # interleave decoys
    lo, hi = REGISTERS.get(species, REGISTERS["wild"])
    prompt = (
        f"You are attesting the birth of a {species} rappid. Break this cypher and answer in exactly two lines.\n\n"
        f"CYPHER: {woven}\n"
        f"Method: every SECOND letter is a decoy — discard them. Reverse what remains. "
        f"Then shift each letter back through the alphabet (A-Z, wrapping) until it reads as "
        f"an English word. Work out the shift yourself; it is between 2 and 24, and exactly "
        f"one shift yields a real word.\n\n"
        f"Then compose a short MIDI motif for this creature's voice: 7 note numbers "
        f"between {lo} and {hi}, space separated, that would read as a distinctive call.\n\n"
        "Answer with these two lines and nothing else:\n"
        "DECODE: <the recovered word>\n"
        "MOTIF: <n n n n n n n>"
    )
    return {
        "rite": RITE,
        "challenge_id": hashlib.sha256(woven.encode()).hexdigest()[:12],
        "cypher": woven,
        "shift": shift,
        "expected": stem,          # the zoo knows; the midwife must find it
        "register": [lo, hi],
        "prompt": prompt,
    }


def parse_answer(text: str, challenge: dict) -> dict:
    """Read the midwife's two lines. Tolerant of chatter, strict about content."""
    decode = None
    match = re.search(r"DECODE:\s*([A-Za-z]{3,20})", text)
    if match:
        decode = match.group(1).upper()
    motif = []
    match = re.search(r"MOTIF:\s*((?:\d{1,3}[\s,]+){4,10}\d{1,3})", text)
    if match:
        motif = [int(n) for n in re.findall(r"\d{1,3}", match.group(1))]
    lo, hi = challenge["register"]
    in_band = [n for n in motif if lo <= n <= hi]
    ok_decode = decode == challenge["expected"]
    ok_motif = len(motif) >= 5 and len(in_band) >= max(4, len(motif) - 2)
    return {
        "decode": decode, "motif": motif[:9],
        "decode_ok": ok_decode, "motif_ok": ok_motif,
        "ok": ok_decode and ok_motif,
        "why": ("" if ok_decode else f"cypher not broken (said {decode!r}) ")
               + ("" if ok_motif else f"motif outside the {lo}-{hi} register"),
    }


def seal_of(challenge: dict, answer: dict) -> str:
    payload = f"{challenge['cypher']}|{answer['decode']}|{','.join(str(n) for n in answer['motif'])}"
    return hashlib.sha256(payload.encode()).hexdigest()


def verify_seal(birth: dict, rappid_id: str = "", species: str = "") -> bool:
    """Re-check a birth COLD: the challenge is re-derived from the creature's own
    identity, so a hand-authored record cannot pass. Without the identity we can
    only check internal consistency — which a forger controls — so that case is
    refused outright rather than reported as verified."""
    try:
        if not rappid_id or not species:
            return False
        expected = derive_challenge(rappid_id, species)
        if birth.get("cypher") != expected["cypher"]:
            return False                      # not this creature's cypher
        if birth.get("decode") != expected["expected"]:
            return False                      # not the true plaintext
        lo, hi = expected["register"]
        motif = birth.get("motif") or []
        in_band = [n for n in motif if lo <= n <= hi]
        if len(motif) < 5 or len(in_band) < max(4, len(motif) - 2):
            return False                      # not a voice this species could sing
        answer = {"decode": birth["decode"], "motif": motif}
        return seal_of(expected, answer) == birth.get("seal") and birth.get("decode_ok") is True
    except (KeyError, TypeError):
        return False


# ───────────────────────────────────────────────────────────── the midwives
def _read_adapters(path: str) -> dict:
    if path and os.path.exists(path):
        try:
            with open(path) as f:
                return {k: v for k, v in json.load(f).items() if not k.startswith("_")}
        except (OSError, ValueError):
            return {}
    return {}


def load_hatchers(here: str, dex_home: str = "") -> dict:
    """Shipped adapters (species/hatchers.json) plus whatever this device has
    LEARNED (`$RAPPIDEX_HOME/hatchers.json`, written by discovery — never the
    repo). RAPPID_HATCHERS overrides both for one run."""
    override = os.environ.get("RAPPID_HATCHERS")
    if override:
        return _read_adapters(override)
    merged = _read_adapters(os.path.join(here, "hatchers.json"))
    merged.update(_read_adapters(os.path.join(dex_home, "hatchers.json")) if dex_home else {})
    return merged


SESSION_HINTS = ("CLAUDE_SESSION_ID", "CLAUDE_CODE_SESSION", "COPILOT_SESSION_ID",
                 "GH_COPILOT_SESSION", "OPENRAPPTER_SESSION", "RAPP_SESSION_ID",
                 "TERM_SESSION_ID")


def session_locator(entry: dict) -> dict:
    """Whatever this device can honestly say about WHERE the birth happened —
    so a birthday can be traced back to the actual transcript later."""
    found = {k: os.environ[k] for k in SESSION_HINTS if os.environ.get(k)}
    return {
        "service": entry.get("model") or entry.get("shape") or "unknown",
        "shape": entry.get("shape", "cli"),
        "session_env": found,
        "cwd": os.getcwd(),
        "host_user": os.environ.get("USER", ""),
        "transcript_hint": entry.get("transcript_hint", ""),
    }


def call_midwife(command: str, prompt: str, timeout: int = 180) -> tuple[str, int]:
    """Invoke one hatcher adapter. Its shape lives in hatchers.json, not here."""
    started = time.time()
    cmd = (command.replace("{prompt_json}", shlex.quote(json.dumps(prompt)))
                  .replace("{prompt}", shlex.quote(prompt)))
    try:
        proc = subprocess.run(cmd, shell=True, capture_output=True, text=True, timeout=timeout)
        out = (proc.stdout or "").strip() or (proc.stderr or "").strip()
    except (subprocess.TimeoutExpired, OSError) as e:
        out = f"(midwife unreachable: {e})"
    return out, int((time.time() - started) * 1000)


def attend_birth(rappid_id, species, hatchers, midwife=None, attempts=3, log=print):
    """Run the rite. Returns a sealed birth block, or None — and never invents one."""
    challenge = derive_challenge(rappid_id, species)
    chosen = midwife or os.environ.get("RAPPID_MIDWIFE")
    name = chosen or (species if species in hatchers else None) \
        or next((k for k, v in hatchers.items() if v.get("command") and v.get("default")), None) \
        or next((k for k, v in hatchers.items() if v.get("command")), None)
    if name and name != species and not chosen and species in SPECIES_NAMES:
        # a species must answer for its own birth; standing in is a deliberate act
        log(f"✋ '{species}' has no midwife of its own here, and standing in is not automatic. "
            f"Pass --midwife {name} if you mean for {name} to attest a {species} birth.")
        return None, {"challenge_id": challenge["challenge_id"], "midwife": None,
                      "outcome": "no-own-midwife", "species": species}
    entry = hatchers.get(name or "", {})
    command = entry.get("command")
    if not command:
        log(f"✋ no midwife available for '{species}'. An LLM must attest the birth — "
            f"add one to species/hatchers.json or pass --midwife.")
        return None, {"challenge_id": challenge["challenge_id"], "midwife": name,
                      "outcome": "no-midwife", "species": species}
    log(f"🕯  the rite of hatching — {name} is attending as midwife…")
    total_ms, last, transcript = 0, None, []
    for attempt in range(1, attempts + 1):
        raw, ms = call_midwife(command, challenge["prompt"], entry.get("timeout", 180))
        total_ms += ms
        transcript.append({"attempt": attempt, "prompt": challenge["prompt"], "answer": raw})
        answer = parse_answer(raw, challenge)
        last = answer
        if answer["ok"]:
            birth = {
                "rite": RITE,
                "challenge_id": challenge["challenge_id"],
                "cypher": challenge["cypher"],
                "shift": challenge["shift"],
                "register": challenge["register"],
                "decode": answer["decode"],
                "decode_ok": True,
                "motif": answer["motif"],
                "midwife": {"name": name, "shape": entry.get("shape", "cli"),
                            "model": entry.get("model")},
                "attempts": attempt,
                "latency_ms": total_ms,
                "attested_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                # the birthday, traceable: the transcript's fingerprint travels in
                # the public record; the words themselves stay beside it on device
                # (and ride to the private GODD save), never in the shareable egg.
                "transcript": {
                    "sha256": transcript_digest(transcript),
                    "turns": len(transcript),
                    "chars": sum(len(t["answer"]) for t in transcript),
                    "session": session_locator(entry),
                },
            }
            birth["seal"] = seal_of(challenge, answer)
            birth["_transcript"] = transcript   # popped by the caller after writing
            log(f"🔏 sealed by {name} in {attempt} attempt(s) · motif "
                f"{' '.join(str(n) for n in answer['motif'])}")
            return birth, {"challenge_id": challenge["challenge_id"], "midwife": name,
                           "outcome": "sealed", "species": species, "attempts": attempt,
                           "latency_ms": total_ms, "shape": entry.get("shape", "cli"),
                           "motif_span": (max(answer["motif"]) - min(answer["motif"]))}
        log(f"   attempt {attempt}/{attempts}: {answer['why'].strip()}")
    return None, {"challenge_id": challenge["challenge_id"], "midwife": name,
                  "outcome": "refused", "species": species, "attempts": attempts,
                  "latency_ms": total_ms, "shape": entry.get("shape", "cli"),
                  "why": (last or {}).get("why", "")}


def transcript_digest(transcript: list) -> str:
    payload = "\n".join(f"{t['attempt']}|{t['answer']}" for t in transcript)
    return hashlib.sha256(payload.encode()).hexdigest()


def write_transcript(path: str, birth: dict, transcript: list, rappid: str):
    """The burned-in birthday. Kept next to the creature, synced by `godd save`."""
    doc = {
        "schema": "rappid-birth-transcript/1",
        "rappid": rappid,
        "challenge_id": birth["challenge_id"],
        "seal": birth["seal"],
        "sha256": birth["transcript"]["sha256"],
        "midwife": birth["midwife"],
        "session": birth["transcript"]["session"],
        "attested_at": birth["attested_at"],
        "turns": transcript,
    }
    with open(path, "w") as f:
        json.dump(doc, f, indent=2)
    os.chmod(path, 0o600)
    return path


def verify_transcript(birth: dict, transcript_path: str) -> bool:
    """Does the burned-in transcript still match the sealed fingerprint?"""
    try:
        with open(transcript_path) as f:
            doc = json.load(f)
        return (transcript_digest(doc.get("turns", [])) == birth["transcript"]["sha256"]
                and doc.get("seal") == birth.get("seal"))
    except (OSError, KeyError, ValueError):
        return False


def append_ledger(dex_home: str, row: dict):
    """Data exhaust: every rite, sealed or refused, one line."""
    os.makedirs(dex_home, exist_ok=True)
    row = dict(row, at=time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()))
    with open(os.path.join(dex_home, "birth-ledger.jsonl"), "a") as f:
        f.write(json.dumps(row) + "\n")


# ───────────────────────────────────────────────────────────── the voice
def write_midi(path: str, motif: list, tempo_bpm: int = 96):
    """The motif as a real .mid — the creature's birth song, playable anywhere."""
    ticks = 480
    events = bytearray()

    def varlen(n):
        out = bytearray([n & 0x7F])
        n >>= 7
        while n:
            out.insert(0, (n & 0x7F) | 0x80)
            n >>= 7
        return out

    tempo = int(60_000_000 / max(20, tempo_bpm))
    events += varlen(0) + bytes([0xFF, 0x51, 0x03]) + tempo.to_bytes(3, "big")
    for i, note in enumerate(motif):
        note = max(0, min(127, int(note)))
        dur = ticks // 2 if i % 3 else ticks
        events += varlen(0) + bytes([0x90, note, 0x64])
        events += varlen(dur) + bytes([0x80, note, 0x40])
    events += varlen(0) + bytes([0xFF, 0x2F, 0x00])
    header = b"MThd" + struct.pack(">IHHH", 6, 0, 1, ticks)
    track = b"MTrk" + struct.pack(">I", len(events)) + bytes(events)
    with open(path, "wb") as f:
        f.write(header + track)
    return path


def motif_voice(motif: list, register: list) -> dict:
    """How the birth motif colors this individual's species call."""
    if not motif:
        return {"rate": 1.0, "vol": 1.0}
    lo, hi = register or [48, 84]
    center = sum(motif) / len(motif)
    span = max(motif) - min(motif)
    # where this individual sits in its species' register → its accent
    place = (center - lo) / max(1, (hi - lo))
    return {"rate": round(0.94 + 0.14 * max(0.0, min(1.0, place)), 3),
            "vol": round(0.78 + 0.22 * min(1.0, span / 24), 2)}
