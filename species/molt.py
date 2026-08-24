#!/usr/bin/env python3
"""
molt.py — frames, mutation, and the reunion molt.

A rappid is not a fixed thing. What it IS at any moment is a **fold over its
frames**: the birth, then every mutation it earned afterwards. The form is
never stored as a second truth that could disagree with the frames — it is
recomputed, so it cannot drift.

Out in the field a creature meets things its desk life never had: a task that
needed a success chime, a surface that needed a warning, a job it learned to do.
Each of those appends a frame **on the device where it happened**. The laptop
copy and the phone copy therefore diverge on purpose — two dimensions of the
same creature, evolving independently while they are apart.

When they reunite, they **molt**: the frame sets are unioned (a frame is
identified by its content hash, so the same frame merged twice is still one
frame), ordered deterministically, and folded. Both dimensions come out of the
molt identical, and neither lost anything it learned alone.

Every mutation's sound is derived from the creature's own birth motif, so a
rappid that grows still sounds like itself.
"""
from __future__ import annotations

import hashlib
import json
import os
import time

FRAME_SCHEMA = "rappid-frame/1"
MOLT_SCHEMA = "rappid-molt/1"

# What a creature can grow. Each kind names a sound role it gains.
MUTATION_KINDS = {
    "success":  {"role": "success",  "shape": "rise",   "why": "it completed something that mattered"},
    "alert":    {"role": "alert",    "shape": "stab",   "why": "it met something that needed warning"},
    "greeting": {"role": "greeting", "shape": "call",   "why": "it met another keeper or creature"},
    "focus":    {"role": "focus",    "shape": "hold",   "why": "it worked a long task without help"},
    "recovery": {"role": "recovery", "shape": "fall",   "why": "it came back from a failure"},
}


def frame_id(frame: dict) -> str:
    """A frame is identified by its content, so merging is idempotent."""
    body = {k: frame[k] for k in sorted(frame) if k not in ("id",)}
    return hashlib.sha256(json.dumps(body, sort_keys=True, separators=(",", ":")).encode()).hexdigest()[:16]


def birth_frame(rec: dict) -> dict:
    """The first frame: every creature's fold starts at its own birth."""
    birth = rec.get("birth") or {}
    frame = {
        "schema": FRAME_SCHEMA,
        "kind": "birth",
        "at": birth.get("attested_at") or rec.get("created_at") or "",
        "host": rec.get("host", ""),
        "motif": birth.get("motif", []),
        "seal": birth.get("seal", ""),
    }
    anchor = birth.get("anchor")
    if anchor:   # what this creature was born OF stays in its lineage forever
        frame["anchor"] = {"kind": anchor.get("kind"), "sha256": anchor.get("sha256"),
                           "title": anchor.get("title")}
    frame["id"] = frame_id(frame)
    return frame


def mutate(rec: dict, kind: str, note: str, host: str, at: str | None = None) -> dict:
    """Earn a new frame in the field. Deterministic: the same encounter on the
    same creature yields the same frame, so a re-sync never duplicates it."""
    if kind not in MUTATION_KINDS:
        raise ValueError(f"unknown mutation '{kind}' — known: {', '.join(MUTATION_KINDS)}")
    spec = MUTATION_KINDS[kind]
    base = (rec.get("birth") or {}).get("motif") or [60, 64, 67]
    frame = {
        "schema": FRAME_SCHEMA,
        "kind": "mutation",
        "mutation": kind,
        "role": spec["role"],
        "note": note[:200],
        "at": at or time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "host": host,
        "motif": derive_motif(base, kind, note),
    }
    frame["id"] = frame_id(frame)
    return frame


def derive_motif(base: list, kind: str, note: str) -> list:
    """A new sound, grown from the creature's own birth song — never a stock
    sample. The shape of the phrase follows the mutation's role."""
    spec = MUTATION_KINDS[kind]
    h = hashlib.sha256(f"{kind}:{note}".encode()).digest()
    root = base[0] if base else 60
    span = (max(base) - min(base)) if len(base) > 1 else 7
    steps = {
        "rise": [0, 4, 7, 12],
        "stab": [0, 1, 0],
        "call": [0, 5, 3, 7],
        "hold": [0, 0, 2, 0],
        "fall": [12, 7, 4, 0],
    }[spec["shape"]]
    drift = (h[0] % 5) - 2
    return [max(21, min(108, root + drift + s + (h[i % len(h)] % max(2, span // 4))))
            for i, s in enumerate(steps)]


# A creature does not get old. It gets ADAPTED. Nothing here is measured in
# elapsed time: what a rappid has become is exactly what it has met and answered.
STANDINGS = [(0, "newly hatched"), (1, "adapting"), (3, "capable"),
             (6, "storied"), (12, "deep")]


def standing_for(mutations: int, breadth: int) -> str:
    """What this creature has become, read only from what it has adapted to."""
    standing = STANDINGS[0][1]
    for count, name in STANDINGS:
        if mutations >= count:
            standing = name
    if breadth >= 4:
        return f"{standing}, broad"      # it has answered many kinds of thing
    if mutations >= 4 and breadth == 1:
        return f"{standing}, specialised"  # it went deep on one
    return standing


def fold(frames: list) -> dict:
    """What the creature IS right now — recomputed, never stored twice."""
    ordered = order(frames)
    birth = next((f for f in ordered if f.get("kind") == "birth"), None)
    voices, lineage_hosts = {}, []
    for f in ordered:
        if f.get("kind") == "mutation":
            voices[f["role"]] = f["motif"]          # latest frame of a role wins
        if f.get("host") and f["host"] not in lineage_hosts:
            lineage_hosts.append(f["host"])
    mutations = sum(1 for f in ordered if f.get("kind") == "mutation")
    traits = sorted({f["mutation"] for f in ordered if f.get("kind") == "mutation"})
    return {
        "schema": MOLT_SCHEMA,
        "frames": len(ordered),
        "born_at": (birth or {}).get("at", ""),
        "mutations": mutations,
        "standing": standing_for(mutations, len(traits)),
        "anchor": (birth or {}).get("anchor"),   # what it was born of, never lost
        "voices": voices,                            # role -> motif
        "traits": traits,
        "dimensions": lineage_hosts,                 # every device this creature lived on
        "molt_id": hashlib.sha256("".join(f["id"] for f in ordered).encode()).hexdigest()[:12],
    }


def order(frames: list) -> list:
    """Deterministic and order-independent: two devices folding the same union
    land on the same creature, whatever sequence they merged in."""
    unique = {}
    for f in frames:
        fid = f.get("id") or frame_id(f)
        unique[fid] = dict(f, id=fid)
    # birth first, then by (timestamp, id) so ties never depend on arrival order
    return sorted(unique.values(),
                  key=lambda f: (0 if f.get("kind") == "birth" else 1, f.get("at", ""), f["id"]))


def merge(local: list, incoming: list) -> tuple[list, dict]:
    """The reunion molt. Returns the merged frame set and what changed."""
    local_ids = {f.get("id") or frame_id(f) for f in local}
    incoming_ids = {f.get("id") or frame_id(f) for f in incoming}
    merged = order(list(local) + list(incoming))
    gained = incoming_ids - local_ids
    returned = local_ids - incoming_ids
    return merged, {
        "gained": len(gained),           # what the other dimension learned while apart
        "kept": len(returned),           # what this one learned while apart
        "shared": len(local_ids & incoming_ids),
        "total": len(merged),
    }


# ─────────────────────────────────────────────────────── persistence helpers
def frames_path(record_dir: str) -> str:
    return os.path.join(record_dir, "frames.jsonl")


def read_frames(record_dir: str, rec: dict | None = None) -> list:
    path = frames_path(record_dir)
    frames = []
    if os.path.exists(path):
        with open(path) as f:
            for line in f:
                line = line.strip()
                if line:
                    try:
                        frames.append(json.loads(line))
                    except ValueError:
                        continue          # a torn line is skipped, never fatal
    if not frames and rec:
        frames = [birth_frame(rec)]       # a creature always has its birth
    return frames


def write_frames(record_dir: str, frames: list):
    path = frames_path(record_dir)
    tmp = path + ".tmp"
    with open(tmp, "w") as f:
        for frame in order(frames):
            f.write(json.dumps(frame, sort_keys=True) + "\n")
    os.replace(tmp, path)                 # append-only in spirit, atomic in practice
    return path
