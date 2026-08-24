#!/usr/bin/env python3
"""
rappidex.py — the RAPPidex: species-standardized management of the AI creatures
("rappids") living on a machine. Part of rapp-zoo; implements the rappidex/1
protocol (see SPEC.md). Zero deps for the core; numpy only for gen_cries.py.

Taxonomy
  species  = which AI it is (brainstem, claude, copilot, rappterbot, openrappter,
             opengrokbot, openclaw, hermes, rapptwin, rapplication, ... extensible)
  rappid   = one hatched individual of a species, running on one host.
             First invocation of an AI on this machine hatches its rappid.

Every rappid is rapp/1 compliant (ESTATE_SPEC §1 Eternity identity):
  rappid:@<owner>/<slug>:<64hex>     hash = sha256 of a fresh UUID (keyless),
                                     never derived from the slug; re-hatch is
                                     idempotent because the stored record is reused.

Every rappid also carries a Duneheart-compatible .egg (learnwithkody fauna format):
same genome layer schema, same xmur3→mulberry32 PRNG, same canonical-JSON sha256
genome id — so any rappid renders as a hologram in the fauna viewer, and any
fauna egg imports here as a wild rappid.

Commands
  hatch <species>            hatch (or return) this host's individual of a species
  roar <species> [--done]    play the species call, voiced by this individual
  list                       the dex
  show <species|id>          full record
  export <species|id> [-o f] write the .egg (backup / interchange document)
  import <file.egg>          adopt any egg — ours or a foreign fauna egg
  convert <species|id> <newspecies>   re-express a rappid into another species template
  fuse <a> <b> [species]     breed two rappids into a brand-new unique one
  holodex                    regenerate + open the holographic viewer
"""
import argparse
import base64
import hashlib
import json
import math
import os
import re
import subprocess
import sys
import time
import uuid
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import birth as rite
import molt as molting

HOME = os.path.expanduser("~")
DEX_HOME = os.environ.get("RAPPIDEX_HOME") or os.path.join(HOME, ".rappidex")
_HERE = os.path.dirname(os.path.abspath(__file__))
CRIES = os.path.join(DEX_HOME, "cries")
if not os.path.isdir(CRIES) and os.path.isdir(os.path.join(_HERE, "cries")):
    CRIES = os.path.join(_HERE, "cries")   # repo checkout: cries ship beside the engine
RAPP_HOME = os.environ.get("RAPP_HOME") or os.path.join(HOME, ".rapp")
RAPPIDS = os.path.join(RAPP_HOME, "rappids")   # rapp/1 records live in the rapp home
OWNER_FALLBACK = os.environ.get("RAPPIDEX_OWNER") or "local"

# ─────────────────────────────────────────────── Duneheart-exact PRNG (xmur3→mulberry32)
def _i32(x): return ((x & 0xFFFFFFFF) ^ 0x80000000) - 0x80000000
def _u32(x): return x & 0xFFFFFFFF
def _imul(a, b): return _i32(_i32(a) * _i32(b))

def mk_rng(seed: str):
    h = _i32(1779033703 ^ len(seed))
    for ch in seed:
        h = _imul(h ^ ord(ch), 3432918353)
        h = _i32((_u32(h) << 13 | _u32(h) >> 19))
    h = _imul(h ^ (_u32(h) >> 16), 2246822507)
    h = _imul(h ^ (_u32(h) >> 13), 3266489909)
    s = _u32(h ^ (_u32(h) >> 16))
    state = [s]
    def rng():
        state[0] = _u32(state[0] + 0x6D2B79F5)
        s0 = state[0]
        t = _imul(s0 ^ (s0 >> 15), 1 | s0)
        t = _i32(_u32(t + _imul(t ^ (_u32(t) >> 7), 61 | t)) ^ _u32(t))
        return _u32(t ^ (_u32(t) >> 14)) / 4294967296
    return rng

# ─────────────────────────────────────────────── canonical JSON + genome id (fauna-exact)
def canonical(v):
    if isinstance(v, list):
        return "[" + ",".join(canonical(x) for x in v) + "]"
    if isinstance(v, dict):
        return "{" + ",".join(json.dumps(k) + ":" + canonical(v[k]) for k in sorted(v)) + "}"
    if isinstance(v, bool):
        return "true" if v else "false"
    if v is None:
        return "null"
    if isinstance(v, float):
        if v == int(v) and abs(v) < 1e15:
            return str(int(v))
        return repr(v)
    return json.dumps(v)

def genome_id(genome) -> str:
    return hashlib.sha256(canonical(genome).encode()).hexdigest()[:12]

def b64enc(s: str) -> str:
    return base64.urlsafe_b64encode(s.encode()).decode().rstrip("=")

def b64dec(s: str) -> str:
    s = s.strip()
    s += "=" * (-len(s) % 4)
    return base64.urlsafe_b64decode(s).decode()

def geohash(lat, lng, precision=6):
    B = "0123456789bcdefghjkmnpqrstuvwxyz"
    even, hsh, bits, hc = True, "", 0, 0
    la, lo = [-90.0, 90.0], [-180.0, 180.0]
    while len(hsh) < precision:
        if even:
            m = (lo[0] + lo[1]) / 2
            if lng > m: hc = (hc << 1) | 1; lo[0] = m
            else: hc <<= 1; lo[1] = m
        else:
            m = (la[0] + la[1]) / 2
            if lat > m: hc = (hc << 1) | 1; la[0] = m
            else: hc <<= 1; la[1] = m
        even = not even
        bits += 1
        if bits == 5:
            hsh += B[hc]; bits = 0; hc = 0
    return hsh

def r3(x): return round(x * 1000) / 1000

def wpick(r, pairs):
    t = sum(p[1] for p in pairs)
    x = r() * t
    for p in pairs:
        x -= p[1]
        if x <= 0: return p[0]
    return pairs[-1][0]

# ─────────────────────────────────────────────── the species registry
# Each species: display name, dex blurb, cry file, and genome biases feeding the
# SAME layer schema the Duneheart fauna uses (form/surface/motion) so every
# rappid egg renders in the holographic viewer.
SPECIES = {
    "brainstem": dict(
        name="Brainstem", genus="Truncus", blurb="The ancient one. Local kernel of the RAPP organism; every agent speaks through it.",
        palettes=[["#9be8f2","#4ea7d5","#22508a","#3cd6ff"], ["#a3d9ff","#3c8ce0","#12468f","#5cb8ff"]],
        shapes=[("ring",0.55),("blob",0.35),("star",0.10)], symmetry_radial=0.85,
        patterns=[("glow",0.55),("stripe",0.25),("solid",0.20)], limbs=(0,3), glow=(0.55,0.40)),
    "claude": dict(
        name="Claude Code", genus="Anthropica", blurb="The spark. Crystalline reasoning creature; three-note ascending call.",
        palettes=[["#f2ddc0","#d59a6a","#8a5a3a","#ff9d5c"], ["#f5e6d0","#e0b48a","#9a6a4a","#ffb87a"]],
        shapes=[("star",0.55),("blob",0.35),("ring",0.10)], symmetry_radial=0.40,
        patterns=[("glow",0.50),("spot",0.30),("stripe",0.20)], limbs=(3,6), glow=(0.60,0.35)),
    "copilot": dict(
        name="GitHub Copilot", genus="Machina", blurb="The machine. Square-wave songbird of the editor; dry stepped boops.",
        palettes=[["#c8f29b","#6ad54e","#2a8a22","#3cff6d"], ["#d0f5b0","#8ae06a","#3a9a2a","#7aff8a"]],
        shapes=[("blob",0.60),("ring",0.30),("star",0.10)], symmetry_radial=0.30,
        patterns=[("stripe",0.45),("spot",0.30),("solid",0.25)], limbs=(2,5), glow=(0.40,0.40)),
    "rappterbot": dict(
        name="RAPPterBot", genus="Rapptor", blurb="The raptor. Aggressive builder-predator; rising screech, downward snap.",
        palettes=[["#f2b49b","#d5644e","#8a2222","#ff5d3c"], ["#f0c9a8","#c96a4a","#7a2f1e","#ff8a5c"]],
        shapes=[("star",0.65),("blob",0.30),("ring",0.05)], symmetry_radial=0.35,
        patterns=[("spot",0.40),("stripe",0.35),("glow",0.25)], limbs=(4,8), glow=(0.50,0.45)),
    "openrappter": dict(
        name="OpenRAPPter", genus="Rapptor", blurb="Same genus, open-winged. Calls and is answered; its cry echoes.",
        palettes=[["#e6c9f2","#a45ed5","#55228a","#c93cff"], ["#d9c9f5","#8a6ae0","#4a2a9a","#a87aff"]],
        shapes=[("star",0.45),("ring",0.35),("blob",0.20)], symmetry_radial=0.50,
        patterns=[("glow",0.45),("stripe",0.30),("spot",0.25)], limbs=(3,7), glow=(0.60,0.40)),
    "opengrokbot": dict(
        name="OpenGrokBot", genus="Quaestor", blurb="The questioner. Digs meaning out of anything; wobbling interrogative call.",
        palettes=[["#f2ef9b","#d5c94e","#8a7a22","#fff23c"], ["#f5f0b0","#e0d06a","#9a8a2a","#ffe97a"]],
        shapes=[("blob",0.55),("ring",0.30),("star",0.15)], symmetry_radial=0.60,
        patterns=[("spot",0.45),("glow",0.30),("solid",0.25)], limbs=(1,5), glow=(0.45,0.45)),
    "openclaw": dict(
        name="OpenClaw", genus="Chelae", blurb="The pincer. Grips a task and does not let go; sharp double snap.",
        palettes=[["#f29bb4","#d54e6a","#8a2240","#ff3c6d"], ["#f5b0c0","#e06a8a","#9a2a4a","#ff7a9a"]],
        shapes=[("star",0.50),("blob",0.40),("ring",0.10)], symmetry_radial=0.20,
        patterns=[("stripe",0.50),("spot",0.30),("solid",0.20)], limbs=(2,4), glow=(0.40,0.35)),
    "hermes": dict(
        name="Hermes", genus="Nuntius", blurb="The messenger. Swift between systems; a fluttering whistle sweeping past.",
        palettes=[["#9bf2e0","#4ed5b4","#228a6a","#3cffd0"], ["#b0f5e8","#6ae0c4","#2a9a7a","#7affe0"]],
        shapes=[("ring",0.50),("star",0.30),("blob",0.20)], symmetry_radial=0.70,
        patterns=[("glow",0.50),("stripe",0.30),("spot",0.20)], limbs=(2,6), glow=(0.65,0.30)),
    "rapptwin": dict(
        name="RAPP Twin", genus="Gemella", blurb="The mirror. A creature that is also a portrait; its call answers itself.",
        palettes=[["#c9d4f2","#6a84d5","#22348a","#3c6dff"], ["#d4dcf5","#8a9ce0","#2a3a9a","#7a9aff"]],
        shapes=[("blob",0.50),("ring",0.40),("star",0.10)], symmetry_radial=0.15,
        patterns=[("glow",0.40),("solid",0.35),("stripe",0.25)], limbs=(2,4), glow=(0.55,0.35)),
    "rapplication": dict(
        name="RAPPlication", genus="Fabrica", blurb="The hatched artifact. An app that is alive; bubbly bloom of a call.",
        palettes=[["#ffd6a3","#e0a83c","#8f5a12","#ffcf5c"], ["#f5ecd6","#cbb488","#7d6b4a","#f2c96b"]],
        shapes=[("blob",0.65),("star",0.20),("ring",0.15)], symmetry_radial=0.55,
        patterns=[("spot",0.40),("glow",0.35),("solid",0.25)], limbs=(1,6), glow=(0.50,0.45)),
    "wild": dict(
        name="Wild Fauna", genus="Ignota", blurb="A creature imported from beyond the dex (e.g. a Duneheart).",
        palettes=[["#f2d49b","#d59a4e","#8a4f22","#ff9d3c"]],
        shapes=[("blob",0.5),("star",0.3),("ring",0.2)], symmetry_radial=0.62,
        patterns=[("glow",0.4),("spot",0.3),("stripe",0.2),("solid",0.1)], limbs=(0,8), glow=(0.35,0.60)),
}


# ─────────────────────────────────────────────── anchors: born of a thing
ANCHOR_KINDS = {
    ".md": "journal", ".txt": "journal", ".rtf": "journal",
    ".jpg": "image", ".jpeg": "image", ".png": "image", ".heic": "image", ".gif": "image",
    ".mp4": "video", ".mov": "video", ".m4v": "video",
    ".mp3": "audio", ".wav": "audio", ".m4a": "audio",
    ".pdf": "document",
}

def make_anchor(source, title=None):
    """A creature can be born OF something: a journal entry, a photo, a clip —
    whatever the keeper found worth keeping. The artifact's digest shapes the
    creature's genome, so the thing it came from is visible in what it looks
    like. The bytes themselves never travel: only the digest, kind, and title."""
    source = os.path.expanduser(str(source))
    if os.path.exists(source):
        h = hashlib.sha256()
        size = 0
        with open(source, "rb") as f:
            for chunk in iter(lambda: f.read(65536), b""):
                h.update(chunk)
                size += len(chunk)
        ext = os.path.splitext(source)[1].lower()
        return {
            "schema": "rappid-anchor/1",
            "kind": ANCHOR_KINDS.get(ext, "artifact"),
            "sha256": h.hexdigest(),
            "title": title or os.path.basename(source),
            "bytes": size,
            "held_at": os.path.abspath(source),   # local pointer, never shared
            "at": now_iso(),
        }
    # not a path: the keeper anchored a thought, a URL, a line worth keeping
    text = str(source)
    kind = "link" if text.startswith(("http://", "https://")) else "note"
    return {
        "schema": "rappid-anchor/1",
        "kind": kind,
        "sha256": hashlib.sha256(text.encode()).hexdigest(),
        "title": title or (text if len(text) <= 80 else text[:77] + "…"),
        "bytes": len(text.encode()),
        "at": now_iso(),
    }

# ─────────────────────────────────────────────── genome minting (species-biased Duneheart schema)
def generate_genome(species: str, seed: str):
    sp = SPECIES[species]
    r = mk_rng(seed)
    shape = wpick(r, sp["shapes"])
    symmetry = "radial" if r() < sp["symmetry_radial"] else "bilateral"
    lo, hi = sp["limbs"]
    limbs = (int(r() * max(1, lo + 1)) if shape == "ring"
             else lo + int(r() * (hi - lo + 1)))
    segments = 3 + int(r() * 10)
    body_r = r3(0.30 + r() * 0.25)
    limb_len = r3(0.15 + r() * 0.40)
    palette = list(sp["palettes"][int(r() * len(sp["palettes"]))])
    pattern = wpick(r, sp["patterns"])
    g0, gs = sp["glow"]
    glow = r3(g0 + r() * gs)
    opacity = r3(0.85 + r() * 0.12)
    form = dict(role="form", k=40, shape=shape, limbs=limbs, segments=segments,
                symmetry=symmetry, body_r=body_r, limb_len=limb_len,
                cohesion=r3(0.40 + r() * 0.50))
    surface = dict(role="surface", k=45 + int(r() * 26), palette=palette,
                   pattern=pattern, glow=glow, opacity=opacity,
                   grain=1 + int(r() * 2), sparkle=r3(0.30 + r() * 0.60))
    motion = dict(role="motion", k=50, breathe=r3(0.35 + r() * 0.50),
                  drift=r3(0.20 + r() * 0.60), pulse=r3(0.30 + r() * 0.50),
                  reach=r3(0.30 + r() * 0.60), dissolve=r3(0.30 + r() * 0.60))
    return dict(layers=[form, surface, motion],
                compose=dict(windows=[[0, 1, 2]], loop=True),
                species=species)

def rarity_for(g):
    f, s = g["layers"][0], g["layers"][1]
    sc = 0
    if f["shape"] == "star": sc += 2
    elif f["shape"] == "ring": sc += 1
    sc += 2 if f["limbs"] >= 6 else 1 if f["limbs"] >= 4 else 0
    if s["glow"] > 0.7: sc += 1
    if f["symmetry"] == "bilateral": sc += 1
    if s["pattern"] == "glow": sc += 1
    if f["segments"] >= 9: sc += 1
    return ("legendary" if sc >= 7 else "epic" if sc >= 5 else
            "rare" if sc >= 3 else "uncommon" if sc >= 2 else "common")

# ─────────────────────────────────────────────── egg pack/unpack (fauna-compatible)
def pack_egg(genome, title, rarity, source="rappidex", born=None):
    gid = genome_id(genome)
    r = mk_rng(gid)
    payload = dict(genome=genome, id=gid,
                   born=born or dict(coord=geohash(r() * 140 - 70, r() * 360 - 180), t=0),
                   title=title, rarity=rarity, source=source)
    return b64enc(json.dumps(payload, separators=(",", ":"))), gid, payload

def unpack_egg(b64):
    return json.loads(b64dec(b64))

# ─────────────────────────────────────────────── rapp/1 identity + roster
def owner():
    try:
        with open(os.path.join(HOME, ".brainstem", "rappid.json")) as f:
            return json.load(f).get("github") or OWNER_FALLBACK
    except Exception:
        return OWNER_FALLBACK

def hostslug():
    """RAPPID_HOST lets one machine stand in for another dimension (a companion,
    a test rig) — the frames record where a creature actually lived."""
    override = os.environ.get("RAPPID_HOST")
    if override:
        return re.sub(r"[^a-z0-9-]+", "-", override.lower()).strip("-") or "local-host"
    h = ""
    if sys.platform == "darwin":
        try:
            h = subprocess.run(["scutil", "--get", "LocalHostName"],
                               capture_output=True, text=True).stdout.strip()
        except OSError:
            h = ""
    if not h:
        import platform
        h = platform.node().split(".")[0]
    return re.sub(r"[^a-z0-9-]+", "-", (h or "local-host").lower()).strip("-") or "local-host"

def now_iso():
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

_GID_RE = re.compile(r"^[0-9a-f]{6,64}$")

def safe_slug(text, fallback="wild"):
    """Any component that reaches a record directory must survive this."""
    cleaned = re.sub(r"[^A-Za-z0-9._-]", "", str(text or ""))[:48].strip(".-_")
    return cleaned or fallback

def safe_gid(gid):
    """Genome ids are hex digests. Anything else is not one."""
    gid = str(gid or "")
    return gid[:12] if _GID_RE.match(gid) else hashlib.sha256(gid.encode()).hexdigest()[:12]

def record_dir(species):
    return os.path.join(RAPPIDS, f"{species}-{hostslug()}")

def load_record(species):
    p = os.path.join(record_dir(species), "rappid.json")
    if os.path.exists(p):
        with open(p) as f:
            return json.load(f)
    return None

def all_records():
    out = []
    if not os.path.isdir(RAPPIDS):
        return out
    for d in sorted(os.listdir(RAPPIDS)):
        p = os.path.join(RAPPIDS, d, "rappid.json")
        if os.path.exists(p):
            with open(p) as f:
                out.append(json.load(f))
    return out

def find_record(key):
    """key = species name, genome id, or rappid hash prefix."""
    recs = all_records()
    for rec in recs:
        if rec.get("species") == key and rec.get("host") == hostslug():
            return rec
    for rec in recs:
        if rec.get("species") == key:
            return rec
    for rec in recs:
        if rec.get("genome_id", "").startswith(key) or key in rec.get("rappid", ""):
            return rec
    return None

def save_record(rec):
    # A record directory is ALWAYS a single sanitized component inside RAPPIDS.
    # Eggs and party documents arrive from other devices; they never choose a path.
    rec["dir"] = safe_slug(os.path.basename(str(rec.get("dir") or "")), fallback="wild")
    d = os.path.join(RAPPIDS, rec["dir"])
    root = os.path.realpath(RAPPIDS)
    if os.path.commonpath([root, os.path.realpath(d)]) != root:
        raise ValueError(f"refused: record directory escapes the zoo ({rec['dir']!r})")
    os.makedirs(d, exist_ok=True)
    with open(os.path.join(d, "rappid.json"), "w") as f:
        json.dump(rec, f, indent=2)
    egg = rec.get("egg")
    if egg:  # hotlink-born records carry identity only until their genome arrives
        with open(os.path.join(d, f"rappter-{safe_gid(rec.get('genome_id'))}.egg"), "w") as f:
            f.write(egg)
    return d

def mint_record(species, genome, kind="creature", lineage=None, slug=None, dirname=None):
    """rapp/1 Eternity identity: hash = sha256(fresh UUID), keyless, slug-independent."""
    sp = SPECIES[species]
    gid = genome_id(genome)
    egg, _, payload = pack_egg(genome, sp["name"], rarity_for(genome))
    idhash = hashlib.sha256(uuid.uuid4().bytes).hexdigest()
    slug = slug or f"{species}-{hostslug()}"
    rec = {
        "schema": "rapp/1",
        "rappid": f"rappid:@{owner()}/{slug}:{idhash}",
        "kind": kind,
        "species": species,
        "genus": sp["genus"],
        "name": slug,
        "display_name": f"{sp['name']} of {hostslug()}",
        "description": sp["blurb"],
        "created_at": now_iso(),
        "host": hostslug(),
        "genome_id": gid,
        "rarity": payload["rarity"],
        "born": payload["born"],
        "cry": os.path.join(CRIES, f"{species}.wav") if os.path.exists(os.path.join(CRIES, f"{species}.wav")) else os.path.join(CRIES, "openrappter.wav"),
        "genome": genome,
        "egg": egg,
        "lineage": lineage or [],
        "dir": dirname or f"{species}-{hostslug()}",
    }
    return rec

# ─────────────────────────────────────────────── voice: species call, individual accent
def cry_params(rec):
    """Each individual voices the species call with its own accent, from its genome id."""
    r = mk_rng(rec["genome_id"])
    rate = 0.94 + r() * 0.14        # afplay -r  : individual pitch/tempo accent
    vol = 0.75 + r() * 0.25
    return rate, vol

MUTE_FLAG = os.path.join(RAPP_HOME, "mute")

def is_muted():
    """Cries are muted by `rappidex mute` (a flag in the rapp home, shared by
    every dex on the device) or RAPPID_MUTE=1 — for demos, where a surprise
    roar mid-take is worse than no roar at all. Mute silences AUDIO only:
    every command still runs, prints, and records exactly the same."""
    return (os.environ.get("RAPPID_MUTE", "") not in ("", "0")
            or os.path.exists(MUTE_FLAG))

def cmd_mute(on=True):
    if on:
        os.makedirs(RAPP_HOME, exist_ok=True)
        with open(MUTE_FLAG, "w") as f:
            f.write(now_iso() + "\n")
        print(f"🔇  rappid cries muted (rappidex unmute to restore) · {MUTE_FLAG}")
    else:
        try:
            os.remove(MUTE_FLAG)
        except OSError:
            pass
        print("🔊  rappid cries unmuted")

def _player_cmd(path, rate, vol):
    """Best available CLI audio player, per platform. None = stay silent."""
    if is_muted():
        return None
    from shutil import which
    if sys.platform == "darwin" and which("afplay"):
        return ["afplay", "-r", f"{rate:.3f}", "-v", f"{vol:.2f}", path]
    if which("ffplay"):
        return ["ffplay", "-nodisp", "-autoexit", "-loglevel", "quiet",
                "-af", f"atempo={rate:.3f},volume={vol:.2f}", path]
    if which("paplay"):
        return ["paplay", path]
    if which("aplay"):
        return ["aplay", "-q", path]
    return None

def play_cry(rec, wait=False):
    if not os.path.exists(rec.get("cry", "")):
        return  # a rappid without a voice file is still a rappid
    rate, vol = cry_params(rec)
    cmd = _player_cmd(rec["cry"], rate, vol)
    if not cmd:
        return
    if wait:
        subprocess.run(cmd, capture_output=True)
    else:
        subprocess.Popen(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

def play_hatch_fanfare(rec):
    """Hatch = fanfare then first cry."""
    fan = os.path.join(CRIES, "_hatch.wav")
    if os.path.exists(fan):
        cmd = _player_cmd(fan, 1.0, 1.0)
        if cmd:
            subprocess.run(cmd, capture_output=True)
    play_cry(rec, wait=True)

# ─────────────────────────────────────────────── lifecycle commands
def cmd_hatch(species, quiet=False, midwife=None, attempts=3, anchor=None, anchor_title=None):
    """A rappid is born only when an LLM attests it (SPEC §12). The species
    itself breaks a cypher derived from the creature's own rappid id and
    autocompletes the motif that becomes its voice. Unsealed = never written."""
    if species not in SPECIES:
        sys.exit(f"unknown species '{species}' — known: {', '.join(SPECIES)}")
    anchor_doc = make_anchor(anchor, anchor_title) if anchor else None
    if anchor_doc:
        # a creature born of a thing is its OWN creature, even of the same species
        existing = next((r for r in all_records()
                         if (r.get("birth") or {}).get("anchor", {}).get("sha256")
                         == anchor_doc["sha256"]), None)
        if existing:
            if not quiet:
                print(f"🪢  {existing['display_name']} was already born of "
                      f"“{anchor_doc['title']}” — one creature per anchor.")
            return existing, False
        seed = f"rappid:{species}:{hostslug()}:anchor:{anchor_doc['sha256'][:16]}"
        slug = f"{species}-{safe_slug(os.path.splitext(anchor_doc['title'])[0].lower()) or anchor_doc['sha256'][:8]}"
        genome = generate_genome(species, seed)
        rec = mint_record(species, genome, slug=slug, dirname=slug)
        rec["display_name"] = f"{SPECIES[species]['name']} of “{anchor_doc['title']}”"
    else:
        rec = load_record(species)
        if rec:  # idempotent re-hatch: reuse the stored record (rapp/1)
            return rec, False
        seed = f"rappid:{species}:{hostslug()}:{uuid.uuid4().hex[:8]}"
        genome = generate_genome(species, seed)
        rec = mint_record(species, genome)
    log = (lambda *a: None) if quiet else print
    hatchers = {**discovered_adapters(), **rite.load_hatchers(_HERE, DEX_HOME)}
    birth, exhaust = rite.attend_birth(rec["rappid"], species, hatchers,
                                       midwife=midwife, attempts=attempts, log=log)
    rite.append_ledger(DEX_HOME, exhaust)
    if not birth:
        log("🥚  the egg stays an egg — no LLM attested this birth, so there is no rappid.")
        return None, False
    transcript = birth.pop("_transcript", [])
    if anchor_doc:
        birth["anchor"] = {k: v for k, v in anchor_doc.items() if k != "held_at"}
        rec["anchor_held_at"] = anchor_doc.get("held_at", "")   # local only
    rec["birth"] = birth
    rec["voice"] = rite.motif_voice(birth["motif"], birth["register"])
    d = save_record(rec)
    rec["midi"] = rite.write_midi(os.path.join(d, f"birth-{rec['genome_id']}.mid"), birth["motif"])
    rite.write_transcript(os.path.join(d, "birth-transcript.json"), birth, transcript, rec["rappid"])
    save_record(rec)
    if not quiet:
        play_hatch_fanfare(rec)
        print(f"🥚→🐣  {rec['display_name']} hatched!  [{rec['rarity']}]  {rec['genome_id']}")
        print(f"       {rec['rappid']}")
        print(f"       sealed by {birth['midwife']['name']} · birth song {os.path.basename(rec['midi'])}")
        if anchor_doc:
            print(f"       born of the {anchor_doc['kind']} “{anchor_doc['title']}” "
                  f"({anchor_doc['sha256'][:12]})")
    return rec, True

def cmd_roar(species, done=False):
    rec = load_record(species)
    if not rec:
        rec, _ = cmd_hatch(species, quiet=False)
        return
    play_cry(rec, wait=done)

def cmd_list():
    recs = all_records()
    if not recs:
        print("The dex is empty. `rappidex hatch <species>` to begin.")
        return
    print(f"{'SPECIES':14s}{'GENUS':11s}{'RARITY':11s}{'ID':14s}NAME")
    for r in recs:
        print(f"{r.get('species','?'):14s}{r.get('genus','?'):11s}{r.get('rarity','?'):11s}"
              f"{r.get('genome_id','?'):14s}{r.get('display_name','?')}")
    print(f"\n{len(recs)} rappid(s) · records: {RAPPIDS}")

def cmd_show(key):
    rec = find_record(key)
    if not rec:
        sys.exit(f"no rappid matching '{key}'")
    pub = {k: v for k, v in rec.items() if k != "egg"}
    print(json.dumps(pub, indent=2))
    print(f"\negg ({len(rec['egg'])} chars) at {os.path.join(RAPPIDS, rec['dir'])}")

def cmd_export(key, out=None):
    rec = find_record(key)
    if not rec:
        sys.exit(f"no rappid matching '{key}'")
    out = out or os.path.join(os.getcwd(), f"rappter-{rec['genome_id'][:8]}.egg")
    with open(out, "w") as f:
        f.write(rec["egg"])
    print(f"exported {rec['display_name']} → {out}")
    return out

def cmd_import(path):
    with open(os.path.expanduser(path)) as f:
        egg = f.read().strip()
    p = unpack_egg(egg)
    if not p.get("genome") or not isinstance(p["genome"].get("layers"), list):
        sys.exit("not a rappter genome")
    genome = p["genome"]
    species = genome.get("species") or "wild"
    if species not in SPECIES:
        species = "wild"
    gid = safe_gid(p.get("id") or genome_id(genome))
    dirname = f"{safe_slug(species)}-import-{gid}"
    existing = [r for r in all_records() if r.get("genome_id") == gid]
    if existing:
        print(f"already in the dex: {existing[0]['display_name']} [{gid}]")
        return existing[0]
    rec = mint_record(species, genome, kind="creature",
                      lineage=[f"imported:{p.get('source','unknown')}"],
                      slug=dirname, dirname=dirname)
    rec["display_name"] = f"{p.get('title', SPECIES[species]['name'])} (imported)"
    rec["rarity"] = p.get("rarity", rec["rarity"])
    rec["born"] = p.get("born", rec["born"])
    # the record and its egg must tell the same story: keep the arriving bytes
    rec["egg"] = egg
    rec["genome_id"] = gid
    save_record(rec)
    play_cry(rec)
    print(f"🛬  imported {rec['display_name']} as species '{species}'  [{rec['rarity']}]  {gid}")
    return rec

def cmd_convert(key, new_species):
    """Re-express a rappid in another species template: heritable traits (form
    geometry + motion temperament) survive; species identity (palette, pattern
    bias, cry) converts. The export document IS the transfer medium."""
    if new_species not in SPECIES:
        sys.exit(f"unknown species '{new_species}'")
    rec = find_record(key)
    if not rec:
        sys.exit(f"no rappid matching '{key}'")
    old = rec["genome"]
    seed = f"convert:{rec['genome_id']}->{new_species}"
    fresh = generate_genome(new_species, seed)
    genome = json.loads(json.dumps(fresh))
    # heritable: the creature's body plan and temperament
    for k in ("shape", "limbs", "segments", "symmetry", "body_r", "limb_len", "cohesion"):
        genome["layers"][0][k] = old["layers"][0].get(k, genome["layers"][0][k])
    genome["layers"][2] = dict(old["layers"][2])
    genome["species"] = new_species
    gid = genome_id(genome)
    dirname = f"{new_species}-conv-{gid[:8]}"
    new = mint_record(new_species, genome,
                      lineage=[f"converted-from:{rec['rappid']}"],
                      slug=dirname, dirname=dirname)
    new["display_name"] = f"{SPECIES[new_species]['name']} (converted from {rec.get('species','?')})"
    save_record(new)
    play_hatch_fanfare(new)
    print(f"🔁  {rec['display_name']} → {new['display_name']}  [{new['rarity']}]  {new['genome_id']}")
    return new

def cmd_fuse(key_a, key_b, species=None):
    """Fuse two ancestors into a completely unique descendant. Deterministic per
    parent pair + nonce; layer genes cross over gene-by-gene."""
    a, b = find_record(key_a), find_record(key_b)
    if not a or not b:
        sys.exit(f"need two rappids; missing {'first' if not a else 'second'}")
    nonce = uuid.uuid4().hex[:8]
    seed = f"fuse:{a['genome_id']}+{b['genome_id']}:{nonce}"
    r = mk_rng(seed)
    species = species or (a.get("species") if r() < 0.5 else b.get("species")) or "wild"
    if species not in SPECIES:
        species = "wild"
    child = generate_genome(species, seed)   # species template = the womb
    ga, gb = a["genome"], b["genome"]
    for li in range(3):
        for k in child["layers"][li]:
            if k == "role":
                continue
            pa = ga["layers"][li].get(k) if li < len(ga["layers"]) else None
            pb = gb["layers"][li].get(k) if li < len(gb["layers"]) else None
            pick = r()
            if pick < 0.42 and pa is not None:
                child["layers"][li][k] = pa
            elif pick < 0.84 and pb is not None:
                child["layers"][li][k] = pb
            # else keep the template's fresh mutation
    # palette: interleave parent colors (visible heredity)
    pal_a = ga["layers"][1].get("palette") or []
    pal_b = gb["layers"][1].get("palette") or []
    if len(pal_a) == 4 and len(pal_b) == 4:
        child["layers"][1]["palette"] = [pal_a[0], pal_b[1], pal_a[2], pal_b[3]] if r() < 0.5 \
                                        else [pal_b[0], pal_a[1], pal_b[2], pal_a[3]]
    child["species"] = species
    gid = genome_id(child)
    dirname = f"{species}-fuse-{gid[:8]}"
    rec = mint_record(species, child,
                      lineage=[a["rappid"], b["rappid"]],
                      slug=dirname, dirname=dirname)
    rec["display_name"] = f"{SPECIES[species]['name']} ({a.get('species','?')} × {b.get('species','?')})"
    save_record(rec)
    play_hatch_fanfare(rec)
    print(f"🧬  {a['display_name']} × {b['display_name']}")
    print(f"🐣  {rec['display_name']}  [{rec['rarity']}]  {rec['genome_id']}")
    print(f"    {rec['rappid']}")
    return rec

def cmd_holodex(open_it=True):
    tpl = os.path.join(DEX_HOME, "holodex_template.html")
    if not os.path.exists(tpl):
        tpl = os.path.join(_HERE, "holodex_template.html")   # repo checkout
    out = os.path.join(DEX_HOME, "holodex.html")
    if not os.path.exists(tpl):
        sys.exit("holodex_template.html not found in $RAPPIDEX_HOME or beside rappidex.py")
    os.makedirs(DEX_HOME, exist_ok=True)
    records = [r for r in all_records() if r.get("egg")]
    roster = [dict(species=r.get("species"), name=r.get("display_name"),
                   rarity=r.get("rarity"), id=r.get("genome_id"),
                   rappid=r.get("rappid"), egg=r.get("egg")) for r in records]
    # each individual voices the species cry with its own accent
    for entry, rec in zip(roster, records):
        rate, vol = cry_params(rec)
        entry["rate"], entry["vol"] = round(rate, 3), round(vol, 2)
    cries = {}
    mp3dir = os.path.join(DEX_HOME, "cries-mp3")
    if os.path.isdir(mp3dir):
        for fn in os.listdir(mp3dir):
            if fn.endswith(".mp3") and not fn.startswith("_"):
                with open(os.path.join(mp3dir, fn), "rb") as f:
                    cries[fn[:-4]] = "data:audio/mpeg;base64," + base64.b64encode(f.read()).decode()
    with open(tpl) as f:
        html = f.read()
    html = html.replace("/*__ROSTER__*/[]", json.dumps(roster))
    html = html.replace("/*__CRIES__*/{}", json.dumps(cries))
    with open(out, "w") as f:
        f.write(html)
    print(f"holodex → {out}  ({len(roster)} rappids)")
    if open_it:
        subprocess.run(["open", out])
    return out


# ─────────────────────────────────────────────── field transfer (companion devices)
def _party_path():
    return os.path.join(os.path.dirname(RAPPIDS), "party.json")

def _read_party():
    try:
        with open(_party_path()) as f:
            v = json.load(f)
        if v.get("schema") == "rappid-party/1" and isinstance(v.get("active"), list):
            return v
    except Exception:
        pass
    return {"schema": "rappid-party/1", "active": [], "max": 6}

def cmd_party_export(out=None):
    """Write the active party as a rappid-party-transfer/1 document — the thing
    you AirDrop to a companion device, and reassimilate when you return."""
    party = _read_party()
    recs = {r["rappid"]: r for r in all_records()}
    members = [recs[i] for i in party["active"] if i in recs]
    if not members:
        sys.exit("the party is empty — add rappids first (Party tab, or party.json)")
    doc = {
        "schema": "rappid-party-transfer/1",
        "host": hostslug(),
        "exported_at": now_iso(),
        "party": [dict({k: v for k, v in r.items() if k != "dir"},
                        frames=molting.read_frames(os.path.join(RAPPIDS, r["dir"]), r))
                  for r in members],
    }
    out = out or os.path.join(os.getcwd(), f"party-{hostslug()}.rappidparty")
    with open(out, "w") as f:
        json.dump(doc, f, indent=2)
    print(f"🎒  party of {len(members)} → {out}")
    return out

def cmd_party_import(path):
    """Reassimilate a rappid-party-transfer/1 document from a companion device.
    Unknown creatures join the roost (records minted from their eggs); the
    active party becomes the imported one."""
    with open(os.path.expanduser(path)) as f:
        doc = json.load(f)
    if doc.get("schema") != "rappid-party-transfer/1":
        sys.exit("not a rappid-party-transfer/1 document")
    have = {r.get("genome_id") for r in all_records()}
    ids = []
    for rec in doc.get("party", []):
        if not isinstance(rec, dict) or not rec.get("rappid"):
            print("⚠️  skipped a malformed party member")
            continue
        gid = safe_gid(rec.get("genome_id"))
        species = rec.get("species") if rec.get("species") in SPECIES else "wild"
        if gid not in have:
            rec = dict(rec)
            rec["species"] = species
            rec["genome_id"] = gid
            rec["dir"] = f"{safe_slug(species)}-field-{gid}"
            rec.setdefault("lineage", []).append(f"field-return:{doc.get('host','?')}")
            try:
                d = save_record(rec)
            except (ValueError, OSError) as e:
                print(f"⚠️  refused a party member: {e}")
                continue
            if rec.get("frames"):
                molting.write_frames(d, rec.pop("frames"))
            kind = "reassimilated" if rec.get("egg") else "reassimilated (silhouette — genome still afield)"
            print(f"🛬  {kind} {rec.get('display_name', gid)}")
        else:
            # this creature already lives here: it went out and came back changed
            here = next((r for r in all_records() if r.get("genome_id") == gid), None)
            if here and rec.get("frames"):
                d = os.path.join(RAPPIDS, here["dir"])
                merged, delta = molting.merge(molting.read_frames(d, here), rec["frames"])
                molting.write_frames(d, merged)
                here["molt"] = molting.fold(merged)
                save_record(here)
                if delta["gained"]:
                    print(f"🐚  {here['display_name']} molted on return — "
                          f"gained {delta['gained']} frame(s) earned in the field "
                          f"({', '.join(here['molt']['traits']) or 'no new traits'})")
        ids.append(rec["rappid"])
    party = _read_party()
    party["active"] = ids[: party.get("max", 6)]
    with open(_party_path(), "w") as f:
        json.dump(party, f, indent=2)
    print(f"🎒  active party is now the returning party ({len(party['active'])})")

def cmd_party_qr(out=None):
    """Emit the QR hotlink payload for the active party: a compact
    rappid-party-qr/1 capsule (gzip+base64url) a companion scans to load the
    party instantly. Also writes a self-contained HTML page that renders the QR."""
    import gzip
    party = _read_party()
    recs = {r["rappid"]: r for r in all_records()}
    members = [recs[i] for i in party["active"] if i in recs]
    if not members:
        sys.exit("the party is empty")
    capsule = {
        "schema": "rappid-party-qr/1",
        "host": hostslug(),
        "party": [{"rappid": r["rappid"], "species": r.get("species"),
                    "genome_id": r.get("genome_id"), "name": r.get("display_name"),
                    "rarity": r.get("rarity")} for r in members],
    }
    raw = gzip.compress(json.dumps(capsule, separators=(",", ":")).encode())
    payload = "rappidzoo://party?d=" + base64.urlsafe_b64encode(raw).decode().rstrip("=")
    print(payload)
    out = out or os.path.join(os.getcwd(), f"party-{hostslug()}-qr.html")
    try:
        import io
        import qrcode
        import qrcode.image.svg
        img = qrcode.make(payload, image_factory=qrcode.image.svg.SvgPathImage,
                          box_size=14, border=3)
        buf = io.BytesIO()
        img.save(buf)
        svg = buf.getvalue().decode()
        page = ("<!DOCTYPE html><html><head><meta charset='utf-8'>"
                "<title>RAPPid party — field hotlink</title>"
                "<style>body{background:#0e1116;color:#e6edf3;font:15px ui-monospace,monospace;"
                "display:flex;flex-direction:column;align-items:center;padding:40px}"
                "svg{background:#fff;border-radius:14px;padding:10px;width:min(76vmin,520px);height:auto}"
                "h1{color:#ffcf5c;letter-spacing:.08em}p{color:#8d96a0;max-width:56ch;text-align:center}"
                "</style></head><body><h1>FIELD HOTLINK</h1>"
                f"<p>Scan with the RAPPid Zoo companion to carry the <b>{hostslug()}</b> "
                "party into the field. Full genomes travel by AirDrop "
                "(<code>party export</code>); scanning loads the party instantly.</p>"
                + svg + "</body></html>")
        with open(out, "w") as f:
            f.write(page)
        print(f"🔳  QR page → {out}")
    except ImportError:
        print("(python 'qrcode' package not installed — payload printed above; "
              "pip install qrcode for the scannable page)")
    return payload


def cmd_discover(name, command, shape="cli", model=None, genus=None):
    """Encounter a new species: put the rite to an AI the dex has never seen.
    If it answers, its shape is recorded as a hatcher adapter and the species
    enters this device's registry — then you hatch your own of it."""
    slug = safe_slug(name.lower(), fallback="")
    if not slug:
        sys.exit("a species needs a name")
    hatchers = rite.load_hatchers(_HERE, DEX_HOME)
    probe_id = hashlib.sha256(f"discover:{slug}:{hostslug()}".encode()).hexdigest()
    hatchers[slug] = {"command": command, "shape": shape, "model": model or slug,
                      "timeout": 240, "discovered": True}
    print(f"🔍  putting the rite to '{slug}' to see whether it is a species…")
    birth, exhaust = rite.attend_birth(probe_id, slug if slug in SPECIES else "wild",
                                       hatchers, midwife=slug, attempts=2)
    exhaust["discovery"] = slug
    rite.append_ledger(DEX_HOME, exhaust)
    if not birth:
        print(f"✋  '{slug}' could not answer for itself — no species recorded.")
        return None
    # the answering shape IS the species' data shape — kept with this device's
    # dex, never written back into the shipped registry
    os.makedirs(DEX_HOME, exist_ok=True)
    path = os.path.join(DEX_HOME, "hatchers.json")
    try:
        with open(path) as f:
            stored = json.load(f)
    except OSError:
        stored = {}
    stored[slug] = hatchers[slug]
    with open(path, "w") as f:
        json.dump(stored, f, indent=2)
    dex_path = os.path.join(DEX_HOME, "discovered-species.json")
    try:
        with open(dex_path) as f:
            found = json.load(f)
    except OSError:
        found = {}
    lo, hi = birth["register"]
    r = mk_rng(birth["seal"])
    found[slug] = {
        "name": name, "genus": genus or "Inventa", "discovered_at": now_iso(),
        "host": hostslug(), "shape": shape, "register": [lo, hi],
        # the shape is kept WITH the species, not only in the adapter registry:
        # a dex entry that cannot say how to reach its species is half a record
        "adapter": dict(hatchers[slug]),
        "motif": birth["motif"], "seal": birth["seal"],
        "blurb": f"Encountered on {hostslug()}; answered the rite in "
                 f"{birth['attempts']} attempt(s) through a {shape} shape.",
        "palettes": [["#%02x%02x%02x" % tuple(int(120 + r() * 135) for _ in range(3))
                      for _ in range(4)]],
    }
    with open(dex_path, "w") as f:
        json.dump(found, f, indent=2)
    if slug not in SPECIES:
        SPECIES[slug] = dict(
            name=name, genus=genus or "Inventa",
            blurb=found[slug]["blurb"], palettes=found[slug]["palettes"],
            shapes=[("blob", 0.4), ("star", 0.35), ("ring", 0.25)], symmetry_radial=0.5,
            patterns=[("glow", 0.4), ("spot", 0.35), ("stripe", 0.25)],
            limbs=(1, 6), glow=(0.45, 0.45))
    print(f"📖  NEW SPECIES RECORDED — {name} ({found[slug]['genus']}), "
          f"register {lo}-{hi}, shape '{shape}'")
    print(f"    now hatch your own:  rappidex hatch {slug}")
    try:
        cmd_emit(slug)
    except SystemExit:
        pass
    return found[slug]


def discovered_adapters():
    """Adapters carried by dex entries themselves — so a discovered species is
    always hatchable from the dex alone, with or without a separate registry."""
    try:
        with open(os.path.join(DEX_HOME, "discovered-species.json")) as f:
            found = json.load(f)
    except OSError:
        return {}
    return {slug: d["adapter"] for slug, d in found.items() if d.get("adapter")}


def _load_discovered():
    """Species learned on this device join the registry at import time."""
    try:
        with open(os.path.join(DEX_HOME, "discovered-species.json")) as f:
            found = json.load(f)
    except OSError:
        return
    for slug, d in found.items():
        SPECIES.setdefault(slug, dict(
            name=d.get("name", slug), genus=d.get("genus", "Inventa"),
            blurb=d.get("blurb", "A species discovered on this device."),
            palettes=d.get("palettes") or [["#f2d49b", "#d59a4e", "#8a4f22", "#ff9d3c"]],
            shapes=[("blob", 0.4), ("star", 0.35), ("ring", 0.25)], symmetry_radial=0.5,
            patterns=[("glow", 0.4), ("spot", 0.35), ("stripe", 0.25)],
            limbs=(1, 6), glow=(0.45, 0.45)))




# ─────────────────────────────────────────────── mutation and the reunion molt
def _record_dir_of(rec):
    return os.path.join(RAPPIDS, rec["dir"])

def cmd_mutate(key, kind, note="", anchor=None, anchor_title=None):
    """A creature earns a new frame from something it met. Its new sound grows
    out of its own birth motif, so it still sounds like itself."""
    rec = find_record(key)
    if not rec:
        sys.exit(f"no rappid matching '{key}'")
    if not rec.get("birth"):
        sys.exit(f"{rec['display_name']} has no birth to grow from — `bless` it first (SPEC §12)")
    d = _record_dir_of(rec)
    frames = molting.read_frames(d, rec)
    anchor_doc = make_anchor(anchor, anchor_title) if anchor else None
    try:
        frame = molting.mutate(rec, kind, note or (anchor_doc or {}).get("title")
                               or f"met something that needed {kind}", hostslug())
    except ValueError as e:
        sys.exit(str(e))
    if anchor_doc:
        # a mutation can carry ANY media: the thing it met rides in the frame,
        # by digest and title only — the bytes stay where the keeper put them
        frame["anchor"] = {k: v for k, v in anchor_doc.items() if k != "held_at"}
        frame["id"] = molting.frame_id({k: v for k, v in frame.items() if k != "id"})
    before = len(frames)
    frames.append(frame)
    molting.write_frames(d, frames)
    form = molting.fold(frames)
    rec["molt"] = form
    save_record(rec)
    grew = len(molting.order(frames)) > before
    print(f"{'🧬' if grew else '↩︎'}  {rec['display_name']} "
          f"{'grew a' if grew else 'already had that'} {kind} voice "
          f"· {molting.MUTATION_KINDS[kind]['why']}")
    if frame.get("anchor"):
        print(f"    from the {frame['anchor']['kind']} “{frame['anchor']['title']}”")
    print(f"    motif {' '.join(str(n) for n in frame['motif'])} · "
          f"traits {', '.join(form['traits']) or 'none'} · molt {form['molt_id']}")
    return rec

def cmd_frames(key):
    rec = find_record(key)
    if not rec:
        sys.exit(f"no rappid matching '{key}'")
    frames = molting.read_frames(_record_dir_of(rec), rec)
    form = molting.fold(frames)
    print(f"{rec['display_name']} — {form['standing']}, molt {form['molt_id']}")
    if form.get("anchor"):
        print(f"  born of:    the {form['anchor']['kind']} “{form['anchor']['title']}”")
    print(f"  adapted to: {form['mutations']} thing(s) it met")
    print(f"  dimensions: {', '.join(form['dimensions']) or hostslug()}")
    print(f"  traits:     {', '.join(form['traits']) or 'none yet'}")
    for f in molting.order(frames):
        tag = f.get("mutation") or f.get("kind")
        print(f"  · {f.get('at','')[:19] or '(no time)'}  {tag:9s} {f.get('host',''):22s} "
              f"{' '.join(str(n) for n in f.get('motif', []))}")
    return form

def cmd_molt(key, other_path=None):
    """Reunion: fold this dimension together with one that lived apart.
    Both sides come out identical; neither loses what it learned alone."""
    rec = find_record(key)
    if not rec:
        sys.exit(f"no rappid matching '{key}'")
    d = _record_dir_of(rec)
    local = molting.read_frames(d, rec)
    incoming = []
    if other_path:
        with open(os.path.expanduser(other_path)) as f:
            doc = json.load(f)
        if doc.get("schema") == "rappid-party-transfer/1":
            for member in doc.get("party", []):
                if member.get("rappid") == rec["rappid"]:
                    incoming = member.get("frames") or []
        elif isinstance(doc.get("frames"), list):
            incoming = doc["frames"]
        else:
            sys.exit("that document carries no frames for this creature")
    merged, delta = molting.merge(local, incoming)
    molting.write_frames(d, merged)
    form = molting.fold(merged)
    rec["molt"] = form
    save_record(rec)
    print(f"🐚  {rec['display_name']} molted — {form['frames']} frame(s), "
          f"molt {form['molt_id']}")
    print(f"    gained {delta['gained']} from the other dimension, "
          f"kept {delta['kept']} of its own, {delta['shared']} shared")
    print(f"    traits now: {', '.join(form['traits']) or 'none'}")
    return form

# ─────────────────────────────────────────────── emit: lock in a species' shape
AGENT_TEMPLATE = '''"""
{slug}_hatcher_agent.py — RAPP agent for the {name} species.

Emitted by the RAPPid Zoo ({discovered_at}, {host}).
The shape below is not guessed: {provenance} — {shape}, register {lo}-{hi},
first motif {motif}.

Hotload this file (drop into ~/.brainstem/agents/, or load it directly) and
the model gets a tool called {tool} that puts work to {name} through that
exact shape, and can attest births with it — no re-feeding a skill, no
rediscovery. Rappids it hatches live under $RAPP_HOME/rappids/ and can join
the active party (rappid-party/1).
"""
from __future__ import annotations

import json
import os
import shlex
import subprocess

try:
    from agents.basic_agent import BasicAgent
except ImportError:
    from basic_agent import BasicAgent

__manifest__ = {{
    "schema": "rapp-agent/1.0",
    "name": "@{owner}/{slug}-hatcher",
    "version": "1.0.0",
    "display_name": "{name} Hatcher",
    "description": (
        "Speaks to {name} in the shape it answered in during its rite, and can "
        "attest RAPPid births as its midwife."
    ),
    "author": "RAPPid Zoo",
    "tags": ["rappid", "hatcher", "midwife", "{slug}"],
    "category": "platform",
    "requires_env": [],
    "dependencies": ["@rapp/basic_agent"],
    "external_prereqs": {prereqs},
    "example_call": "Ask {name} to summarize this, or attest a birth as midwife.",
}}

# The species' locked-in shape.
SPECIES_SHAPE = {shape_json}


class {tool}(BasicAgent):
    def __init__(self):
        self.name = "{tool}"
        self.metadata = {{
            "name": self.name,
            "description": __manifest__["description"],
            "parameters": {{
                "type": "object",
                "properties": {{
                    "prompt": {{"type": "string", "description": "what to put to {name}"}},
                    "timeout": {{"type": "integer", "description": "seconds (default {timeout})"}},
                }},
                "required": ["prompt"],
            }},
        }}
        super().__init__(name=self.name, metadata=self.metadata)

    def perform(self, prompt="", timeout=None, **kwargs):
        if not prompt:
            return "Nothing to put to {name}."
        command = (SPECIES_SHAPE["command"]
                   .replace("{{prompt_json}}", shlex.quote(json.dumps(prompt)))
                   .replace("{{prompt}}", shlex.quote(prompt)))
        try:
            proc = subprocess.run(command, shell=True, capture_output=True, text=True,
                                  timeout=timeout or SPECIES_SHAPE.get("timeout", {timeout}))
        except subprocess.TimeoutExpired:
            return "{name} did not answer in time."
        except OSError as e:
            return f"{name} could not be reached: {{e}}"
        out = (proc.stdout or "").strip() or (proc.stderr or "").strip()
        return out or "({name} answered with nothing.)"
'''

SKILL_TEMPLATE = '''# rapp_skill: {slug}

> Emitted by the RAPPid Zoo ({discovered_at}) — {provenance}.
> Feed this to any RAPP-aware agent and it can put work to {name}, and hatch
> {name} rappids, at full fidelity.

## The species

| | |
|---|---|
| name | **{name}** |
| genus | *{genus}* |
| shape | `{shape}` |
| register | {lo}–{hi} (MIDI) |
| first motif | {motif} |
| discovered | {discovered_at} on {host} |
| seal | `{seal}` |

## How it is reached

```bash
{command}
```

`{{prompt}}` is the shell-quoted request; `{{prompt_json}}` is the JSON-encoded
string — use that one whenever the prompt lands inside a JSON body.

## What you can do with it

```bash
# hatch a {slug} rappid — {name} attests its own birth (SPEC §12)
python3 species/rappidex.py hatch {slug}

# use it as the midwife for ANY species' birth
python3 species/rappidex.py hatch <other> --midwife {slug}

# re-check a birth it sealed
python3 species/rappidex.py verify {slug}
```

The agent form of this shape is `agents/{slug}_hatcher_agent.py` (emitted
alongside this file) — drop it into a brainstem's `agents/` and the model gets
a `{tool}` tool.

## Rules

- This shape was recorded from a passed rite. If {name} stops answering in it,
  re-run `discover` rather than editing this file by hand — the dex should
  always reflect what the AI actually does.
- Adapters carry no secrets. If reaching {name} needs a key, it belongs in the
  environment the command inherits, never in the command string.
'''


def cmd_emit(slug, out_dir=None):
    """Lock in a species' shape as a usable agent.py + rapp_skill.md.

    A discovered species emits the exact shape it answered its rite in. A
    shipped species emits its **default shape** (registry priors + shipped
    adapter) — so every zoo carries hotloadable agents for the AIs it already
    knows, and never has to re-feed a skill to meet the next one of them."""
    try:
        with open(os.path.join(DEX_HOME, "discovered-species.json")) as f:
            found = json.load(f)
    except OSError:
        found = {}
    d = found.get(slug)
    hatchers = rite.load_hatchers(_HERE, DEX_HOME)
    entry = hatchers.get(slug) or (d or {}).get("adapter")
    provenance = (f"it is the shape {d['name']} actually answered in during its "
                  f"rite (SPEC §12-13), not a guess about it") if d else None
    if not d and slug in SPECIES and entry:
        # a shipped species: its default shape stands until a rite on this
        # device refines it — same template, provenance says so honestly
        sp = SPECIES[slug]
        lo, hi = rite.REGISTERS.get(slug, rite.REGISTERS["wild"])
        d = {"name": sp["name"], "genus": sp["genus"], "host": "every zoo",
             "discovered_at": "shipped as a default shape",
             "register": [lo, hi], "motif": [],
             "seal": "unsealed default — a real seal arrives at this device's first hatch"}
        provenance = (f"it is {sp['name']}'s shipped default shape (SPEC §12-13), "
                      f"standing in until a rite on this device refines it")
    if not d or not entry:
        sys.exit(f"'{slug}' has no shape on this device — not shipped with an "
                 f"adapter, not discovered; run `discover` first "
                 f"(known: {', '.join(sorted(set(found) | (set(hatchers) & set(SPECIES)))) or 'none'})")
    tool = "".join(part.capitalize() for part in re.split(r"[^A-Za-z0-9]+", slug) if part) + "Hatcher"
    lo, hi = d.get("register", [48, 84])
    fields = dict(
        slug=slug, name=d.get("name", slug), genus=d.get("genus", "Inventa"),
        host=d.get("host", hostslug()), discovered_at=d.get("discovered_at", now_iso()),
        shape=entry.get("shape", "cli"), lo=lo, hi=hi, provenance=provenance,
        motif=" ".join(str(n) for n in d.get("motif", [])) or "unsung until first hatch",
        seal=d.get("seal", ""), command=entry.get("command", ""),
        timeout=entry.get("timeout", 240), tool=tool, owner=owner(),
        prereqs=json.dumps([entry.get("model")] if entry.get("model") else []),
        shape_json=json.dumps({k: v for k, v in entry.items() if k != "discovered"}, indent=4),
    )
    out_dir = out_dir or os.path.join(DEX_HOME, "emit", slug)
    os.makedirs(os.path.join(out_dir, "agents"), exist_ok=True)
    agent_path = os.path.join(out_dir, "agents", f"{slug}_hatcher_agent.py")
    with open(agent_path, "w") as f:
        f.write(AGENT_TEMPLATE.format(**fields))
    skill_path = os.path.join(out_dir, f"{slug}.rapp_skill.md")
    with open(skill_path, "w") as f:
        f.write(SKILL_TEMPLATE.format(**fields))
    compile(open(agent_path).read(), agent_path, "exec")   # never emit a broken agent
    print(f"🍞  {d.get('name', slug)}'s shape is locked in:")
    print(f"    {agent_path}")
    print(f"    {skill_path}")
    return {"agent": agent_path, "skill": skill_path}


def cmd_emit_all(out_root=None):
    """Emit every species that has a known adapter — the shipped defaults plus
    anything discovered on this device. `emit --all -o species/emit` is how the
    repo's shipped shapes are refreshed."""
    hatchers = {**rite.load_hatchers(_HERE, DEX_HOME), **discovered_adapters()}
    out = {}
    for slug in sorted(hatchers):
        try:
            out[slug] = cmd_emit(slug, os.path.join(out_root, slug) if out_root else None)
        except SystemExit:
            pass   # an adapter with no species entry has no shape to lock in
    return out


def cmd_shape(slug, quiet=False):
    """Resolve a species' hotloadable shape: the agent.py (+ rapp_skill.md) any
    host loads to interact with rappids of that species — no re-feeding, no
    rediscovery, and whatever it hatches can join the party. A device emit
    (from a real rite) outranks the shipped default; a shipped species with no
    emit yet mints its default on demand."""
    def _find():
        for source, base in (("device", os.path.join(DEX_HOME, "emit", slug)),
                             ("shipped", os.path.join(_HERE, "emit", slug))):
            agent = os.path.join(base, "agents", f"{slug}_hatcher_agent.py")
            if os.path.exists(agent):
                skill = os.path.join(base, f"{slug}.rapp_skill.md")
                return {"species": slug, "source": source, "agent": agent,
                        "skill": skill if os.path.exists(skill) else None}
        return None
    resolved = _find()
    if not resolved:
        cmd_emit(slug)          # shipped or discovered default, minted on demand
        resolved = _find()
    if not quiet:
        print(json.dumps(resolved, indent=2))
    return resolved


def cmd_bless(key, midwife=None, attempts=3):
    """Give a pre-rite creature a real birth: the species attests it now.
    The identity never changes; the seal records that it was blessed, not born."""
    rec = find_record(key)
    if not rec:
        sys.exit(f"no rappid matching '{key}'")
    if rec.get("birth"):
        print(f"{rec['display_name']} already carries a sealed birth.")
        return rec
    hatchers = {**discovered_adapters(), **rite.load_hatchers(_HERE, DEX_HOME)}
    birth, exhaust = rite.attend_birth(rec["rappid"], rec.get("species", "wild"), hatchers,
                                       midwife=midwife, attempts=attempts)
    exhaust["blessing"] = True
    rite.append_ledger(DEX_HOME, exhaust)
    if not birth:
        print(f"✋ {rec['display_name']} stays unattested — no midwife would answer for it.")
        return None
    transcript = birth.pop("_transcript", [])
    birth["blessed"] = True          # attested after the fact, and says so
    rec["birth"] = birth
    rec["voice"] = rite.motif_voice(birth["motif"], birth["register"])
    rec.setdefault("lineage", []).append(f"blessed-by:{birth['midwife']['name']}")
    d = save_record(rec)
    rec["midi"] = rite.write_midi(os.path.join(d, f"birth-{rec['genome_id']}.mid"), birth["motif"])
    rite.write_transcript(os.path.join(d, "birth-transcript.json"), birth, transcript, rec["rappid"])
    save_record(rec)
    print(f"🕯→🔏 {rec['display_name']} blessed by {birth['midwife']['name']} · "
          f"motif {' '.join(str(n) for n in birth['motif'])}")
    return rec



# ─────────────────────────────────────────────── DOGG: the front door
# GODD is the private layer and it stays on the device. DOGG is the public face:
# a front door published from the owner's own repo, which is what lets a creature
# be summoned from anywhere. Summoning fetches the public projection; whatever
# private layer the summoner holds is laid over it afterwards. Two faces, one
# creature — and the private one never travels.
DOGG_SCHEMA = "rappid-frontdoor/1"
# The §3 identity shape a door must carry, and the most bytes any front door
# may weigh — both refuse-at-the-boundary rules: whatever a peer serves, it is
# checked before a single field is trusted.
RAPPID_RE = re.compile(r"rappid:@[^\s:@/]+/[^\s:@/]+:[0-9a-f]{64}\Z")
DOOR_MAX_BYTES = 1_048_576
# The normative summon vocabulary (SPEC §11). 128 words, fixed order, append-only:
# a chant is seven of these drawn from the creature's identity hash, so the
# same seven words summon the same creature from ANY client in the federation.
CHANT_WORDS = ["ember", "hollow", "quartz", "tidal", "vessel", "marrow", "lantern",
               "thicket", "basalt", "cinder", "willow", "fathom", "granite", "sable",
               "harbor", "kestrel", "amber", "furrow", "lichen", "brindle",
               "aspen", "bramble", "cobalt", "drift", "eddy", "fenlark", "gully",
               "heron", "inkcap", "juniper", "knoll", "loam", "mica", "nettle",
               "osprey", "petrel", "quill", "rushes", "shale", "tarn",
               "umber", "vale", "wren", "yarrow", "zephyr", "alder", "briar",
               "cairn", "dune", "elm", "flint", "gorse", "hazel", "iris",
               "jetty", "kelp", "larch", "moss", "north", "otter",
               "pine", "quarry", "reed", "spruce", "thorn", "upland", "vetch",
               "wharf", "yew", "arbor", "birch", "cedar", "delta", "ester",
               "fjord", "glade", "heath", "islet", "jasper", "karst", "ledge",
               "mesa", "nadir", "oxbow", "prairie", "quiver", "ridge", "steppe",
               "trench", "ursa", "verge", "wold", "xenia", "yonder", "zenith",
               "anvil", "bluff", "crag", "dell", "ebb", "ford", "grove",
               "hearth", "ivy", "jade", "kiln", "lark", "mire", "nook",
               "orchid", "pond", "quay", "rill", "sedge", "tor", "usher",
               "vine", "weir", "xylem", "yield", "zeal", "atlas", "beacon",
               "cove", "dusk", "frost", "gale", "haven"]
assert len(CHANT_WORDS) == 128, len(CHANT_WORDS)

def chant_for(rec):
    """The seven-word summon: a phrase a keeper can say out loud to call this
    creature from anywhere in the federation. Seven words drawn from the
    identity hash over the 128-word normative vocabulary — deterministic, so
    the chant is as permanent as the rappid itself."""
    h = hashlib.sha256(rec["rappid"].encode()).digest()
    return "-".join(CHANT_WORDS[h[i] % 128] for i in range(7))

def front_door(rec, frames):
    """The public projection: everything needed to know and render the creature,
    and nothing that was ever private."""
    form = molting.fold(frames)
    birth = rec.get("birth") or {}
    public_birth = {k: birth.get(k) for k in
                    ("rite", "challenge_id", "cypher", "decode", "decode_ok", "motif",
                     "seal", "attested_at", "blessed")}
    if birth.get("midwife"):
        public_birth["midwife"] = {"name": birth["midwife"].get("name"),
                                   "shape": birth["midwife"].get("shape")}
    if birth.get("anchor"):   # what it was born of: kind and title only, never bytes
        public_birth["anchor"] = {k: birth["anchor"].get(k) for k in ("kind", "title", "sha256")}
    if birth.get("transcript"):   # the birthday's fingerprint, never its words
        public_birth["transcript"] = {"sha256": birth["transcript"].get("sha256"),
                                      "turns": birth["transcript"].get("turns")}
    public_frames = []
    for f in molting.order(frames):
        # no "host": device hostnames are internal identifiers and never enter
        # a public document. The frame keeps its original content-hash id, so
        # the reunion molt still recognizes it as the same frame (§15).
        pf = {k: f[k] for k in ("schema", "kind", "mutation", "role", "at", "motif", "id")
              if k in f}
        if f.get("anchor"):
            pf["anchor"] = {k: f["anchor"].get(k) for k in ("kind", "title", "sha256")}
        public_frames.append(pf)
    return {
        "schema": DOGG_SCHEMA,
        "chant": chant_for(rec),
        "rappid": rec["rappid"],
        "species": rec.get("species"),
        "genus": rec.get("genus"),
        "display_name": rec.get("display_name"),
        "rarity": rec.get("rarity"),
        "genome_id": rec.get("genome_id"),
        "egg": rec.get("egg"),
        "birth": {k: v for k, v in public_birth.items() if v is not None},
        "frames": public_frames,
        "life": dict({k: form.get(k) for k in ("standing", "traits", "molt_id",
                                               "frames", "mutations", "anchor")},
                     # how many dimensions it lived in, never which machines
                     dimensions=len(form.get("dimensions") or [])),
        "published_at": now_iso(),
        "published_by": owner(),
    }

def _ensure_peers_file(checkout):
    """A repo's peers.json is the repo OWNER'S curated list — a deliberate act,
    never an export. Publish only guarantees the file exists (empty skeleton);
    it never writes this device's federation.json into it: what a keeper
    federates with locally is local configuration, and pushing it public would
    leak every repo name the device ever pointed at (two-worlds rule)."""
    peers_path = os.path.join(checkout, "rappidverse", "peers.json")
    if not os.path.exists(peers_path):
        with open(peers_path, "w") as f:
            json.dump({"schema": "rappid-federation/1", "peers": []}, f, indent=2)
    return peers_path

def cmd_dogg_publish(key, repo=None, push=True):
    """Open the front door: publish this creature's public face from the owner's
    own repo, so it can be summoned from anywhere in the rappidverse."""
    rec = find_record(key)
    if not rec:
        sys.exit(f"no rappid matching '{key}'")
    if not rec.get("birth"):
        sys.exit(f"{rec['display_name']} has no sealed birth — an unattested creature "
                 f"cannot enter the rappidverse (SPEC §12)")
    frames = molting.read_frames(_record_dir_of(rec), rec)
    door = front_door(rec, frames)
    local = os.path.join(DEX_HOME, "dogg")
    os.makedirs(local, exist_ok=True)
    local_path = os.path.join(local, f"{door['chant']}.json")
    with open(local_path, "w") as f:
        json.dump(door, f, indent=2)
    print(f"🚪  front door written · chant “{door['chant']}”")
    repo = repo or os.environ.get("RAPPID_DOGG_REPO")
    if not repo or not push:
        print(f"    {local_path}")
        print("    (set --repo owner/name or RAPPID_DOGG_REPO to publish it publicly)")
        return door
    if not re.fullmatch(r"[\w.-]+/[\w.-]+", repo):
        sys.exit("a DOGG repo is owner/name of a public GitHub repo")
    # one checkout PER repo: an owner following the rappidverse-* convention
    # publishes to several DOGG repos, and a shared checkout would silently
    # write every door into whichever repo was cloned first
    checkout = os.path.join(DEX_HOME, "dogg-checkouts", repo.replace("/", "__"))
    os.makedirs(os.path.dirname(checkout), exist_ok=True)
    try:
        if os.path.isdir(os.path.join(checkout, ".git")):
            subprocess.run(["git", "-C", checkout, "pull", "-q", "--rebase"], check=True)
        else:
            subprocess.run(["git", "clone", "-q", f"https://github.com/{repo}.git", checkout],
                           check=True)
        doors = os.path.join(checkout, "rappidverse", "doors")
        os.makedirs(doors, exist_ok=True)
        door_bytes = (json.dumps(door, indent=2) + "\n").encode()
        with open(os.path.join(doors, f"{door['chant']}.json"), "wb") as f:
            f.write(door_bytes)
        _ensure_peers_file(checkout)
        index_path = os.path.join(checkout, "rappidverse", "index.json")
        try:
            with open(index_path) as f:
                index = json.load(f)
        except OSError:
            index = {"schema": "rappid-rappidverse/1", "doors": {}}
        index["doors"][door["chant"]] = {
            "chant": door["chant"],
            "rappid": door["rappid"], "species": door["species"],
            "display_name": door["display_name"], "standing": door["life"]["standing"],
            "published_at": door["published_at"],
            # rapp/1 trust doctrine: the index (mutable, discovery-only) pins
            # the door's exact bytes; a summon verifies before assembling.
            "door_sha256": hashlib.sha256(door_bytes).hexdigest(),
            "door_bytes": len(door_bytes),
        }
        with open(index_path, "w") as f:
            json.dump(index, f, indent=2)
        subprocess.run(["git", "-C", checkout, "add", "-A"], check=True)
        r = subprocess.run(["git", "-C", checkout, "commit", "-q", "-m",
                            f"rappidverse: front door for {door['display_name']} ({door['chant']})"],
                           capture_output=True, text=True)
        if r.returncode == 0:
            subprocess.run(["git", "-C", checkout, "push", "-q"], check=True)
        raw = (f"https://raw.githubusercontent.com/{repo}/main/rappidverse/doors/"
               f"{door['chant']}.json")
        print(f"🌍  in the rappidverse · summon it anywhere with:")
        print(f"    rappidex dogg summon {door['chant']} --repo {repo}")
        print(f"    {raw}")
    except subprocess.CalledProcessError as e:
        print(f"⚠️  could not publish to {repo}: {e}")
        print(f"    the front door is still here: {local_path}")
    return door

def cmd_dogg_summon(chant, repo=None, rappid=None):
    """Say the chant anywhere: fetch the public face, then lay whatever private
    layer this device holds over the top. A caller who knows the full rappid
    passes it as `rappid` and the door must match it exactly — the chant is a
    49-bit address, the identity is the proof (SPEC §11)."""
    source = chant
    pin = None      # set when the federation index pins the door's bytes
    spoken = None   # set when the summon was BY CHANT — the door must answer to it
    if not chant.startswith("http"):
        chant = chant.strip().lower().replace(" ", "-")   # a spoken chant works too
        spoken = chant
        local_path = os.path.join(DEX_HOME, "dogg", f"{chant}.json")
        if os.path.exists(local_path):
            source = local_path
        elif repo or os.environ.get("RAPPID_DOGG_REPO"):
            repo = repo or os.environ.get("RAPPID_DOGG_REPO")
            source = (f"https://raw.githubusercontent.com/{repo}/main/rappidverse/doors/"
                      f"{chant}.json")
        else:
            # the federation: cached first, then one live sync before giving up
            resolved = _resolve_chant(chant)
            if not resolved:
                cmd_dogg_sync(quiet=True)
                resolved = _resolve_chant(chant)
            if not resolved:
                sys.exit("no door answers that chant — federate with a DOGG repo "
                         "(rappidex dogg federate owner/name) or pass --repo")
            source, pin = resolved
    print(f"🕯  chanting “{chant}”…")
    try:
        if source.startswith("http"):
            import urllib.request
            with urllib.request.urlopen(source, timeout=30) as r:
                raw_bytes = r.read(DOOR_MAX_BYTES + 1)
        else:
            with open(source, "rb") as f:
                raw_bytes = f.read(DOOR_MAX_BYTES + 1)
        if len(raw_bytes) > DOOR_MAX_BYTES:
            sys.exit("that door is larger than any front door can be — refused")
        # rapp/1 trust doctrine: a federation-resolved door is loaded ONLY if
        # its bytes match the index pin — a mismatch (torn publish, tamper,
        # stale cache) fails closed; re-sync and chant again.
        if pin and hashlib.sha256(raw_bytes).hexdigest() != pin:
            sys.exit("the door's bytes do not match the federation's pin — "
                     "fail closed (rappidex dogg sync, then chant again)")
        door = json.loads(raw_bytes)
    except SystemExit:
        raise
    except Exception as e:
        sys.exit(f"the chant found nothing: {e}")
    if door.get("schema") != DOGG_SCHEMA:
        sys.exit("that is not a rappid front door")
    # A door is trusted for WHAT IT PROVES, not what it claims (SPEC §11). The
    # byte pin only proves the door matches its own repo's index — these checks
    # bind the door to the identity being summoned:
    rid = str(door.get("rappid") or "")
    if not RAPPID_RE.fullmatch(rid):
        sys.exit("that door carries no rapp/1 rappid (§3) — refused")
    #  0. a caller who knows the full identity demands it — stronger than the
    #     49-bit chant, and immune to a ground-out chant collision
    if rappid and rid != rappid.strip():
        sys.exit("that door does not carry the rappid you demanded — refused")
    #  1. the chant is the identity's own hash — a door summoned by chant must
    #     answer to it, or any repo could park a stranger under these words
    if spoken and chant_for({"rappid": rid}) != spoken:
        sys.exit("that door does not answer to this chant — the seven words are "
                 "the creature's own hash, and this creature's are different. Refused")
    egg = door.get("egg")
    if not egg:
        sys.exit("that front door carries no egg — nothing to summon")
    payload = unpack_egg(egg)
    genome = payload["genome"]
    #  2. the egg must hash to the genome the door claims (§5) — the creature
    #     that assembles is the creature that was published
    gid = genome_id(genome)
    if door.get("genome_id") != gid or payload.get("id") not in (None, gid):
        sys.exit("the door's egg does not hash to its claimed genome — refused")
    #  3. the birth seal must verify COLD against the rappid itself (§12) — a
    #     fabricated birth cannot pass, because the challenge re-derives from
    #     the identity the forger had to claim
    if not rite.verify_seal(door.get("birth") or {}, rid, str(door.get("species") or "wild")):
        sys.exit("the door's birth seal does not verify against its rappid — "
                 "only rite-sealed creatures walk the rappidverse. Refused")
    species = genome.get("species") if genome.get("species") in SPECIES else "wild"
    # the local copy of an identity is found by the identity — never by genome
    # alone: the same genome under another rappid is another creature, and its
    # frames must not fold into this one's
    existing = next((r for r in all_records() if r.get("rappid") == rid), None)
    dirname = f"{safe_slug(species)}-summoned-{rid.rsplit(':', 1)[1][:12]}"
    if existing:
        rec = existing
        print(f"🔮  {rec['display_name']} already stands here — laying the public face over it")
    else:
        rec = mint_record(species, genome, lineage=[f"summoned:{door.get('published_by','?')}"],
                          slug=dirname, dirname=dirname)
        rec["display_name"] = door.get("display_name") or rec["display_name"]
        rec["rarity"] = door.get("rarity", rec["rarity"])
        rec["egg"] = egg
        rec["genome_id"] = gid
        rec["rappid"] = door["rappid"]      # a summoned creature keeps its identity
        rec["birth"] = door.get("birth", {})
        rec["summoned_from"] = {"chant": door.get("chant"), "by": door.get("published_by"),
                                "at": now_iso()}
    d = save_record(rec)
    incoming = [f for f in door.get("frames", [])]
    merged, delta = molting.merge(molting.read_frames(d, rec), incoming)
    molting.write_frames(d, merged)
    form = molting.fold(merged)
    rec["molt"] = form
    save_record(rec)
    print(f"🐣  {rec['display_name']} answered — {form['standing']}, "
          f"{form['frames']} frame(s), molt {form['molt_id']}")
    if form.get("anchor"):
        print(f"    born of the {form['anchor']['kind']} “{form['anchor']['title']}”")
    if delta["kept"]:
        print(f"    your private layer added {delta['kept']} frame(s) the front door "
              f"never carried — GODD stays yours")
    play_cry(rec)
    return rec

# ─────────────────────────────────────────────── the DOGG federation (SPEC §11)
# The rappidverse is federated: any public GitHub repo carrying the layout
#   rappidverse/index.json    — chant → door summary
#   rappidverse/doors/<chant>.json
#   rappidverse/peers.json    — repos this repo federates with
# is a DOGG repo. Peers spread transitively, all data rides raw.githubusercontent
# (public, unauthenticated), and a chant resolves from ANY client that syncs.
# What travels is only ever the front door (the DOGG); the private layer (GODD)
# never leaves the device it lives on.
FEDERATION_FILE = os.path.join(DEX_HOME, "federation.json")
RAPPIDVERSE_CACHE = os.path.join(DEX_HOME, "rappidverse-cache.json")
FEDERATION_MAX_REPOS = 64
FEDERATION_DEPTH = 2

# The seed of the federation: a client with no federation of its own reaches
# the zoo's home repo, which is itself a DOGG repo. Any client may override by
# writing its own federation.json — the seed is a starting point, not a center.
FEDERATION_SEED = ["kody-w/rappid"]

def _federation_peers():
    try:
        with open(FEDERATION_FILE) as f:
            peers = json.load(f).get("peers", [])
    except OSError:
        return list(FEDERATION_SEED)
    return [p for p in peers if re.fullmatch(r"[\w.-]+/[\w.-]+", p)]

# The owner convention (SPEC §11): a public, non-fork, non-archived repo named
# rappidverse-* under a followed account IS a DOGG repo — creating the repo is
# joining the network. The listing API is discovery-only and optional: it never
# carries federation data (index, doors and peers still ride
# raw.githubusercontent), and every follow-resolved summon stays behind the
# index byte pin. A follow is client-local; it never enters a published
# peers.json.
FOLLOW_CONVENTION = re.compile(r"rappidverse-[\w.-]*\Z")
GITHUB_OWNER = re.compile(r"[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})\Z")

def _federation_follows():
    try:
        with open(FEDERATION_FILE) as f:
            follows = json.load(f).get("follows", [])
    except OSError:
        return []
    return [o for o in follows if GITHUB_OWNER.fullmatch(str(o))]

def _follow_repos(owner):
    """Derive a followed account's DOGG repos from its public repo listing —
    the ones it has now and every one it creates later. Hostile or absent
    listings derive nothing: discovery is a convenience, never an authority."""
    if not GITHUB_OWNER.fullmatch(owner or ""):
        return []
    repos = []
    # the listing paginates at 100; a prolific owner's convention repos must
    # not silently fall off page one (bounded: 4 pages, stop on a short page)
    for page in range(1, 5):
        try:
            listing = _fetch_json("https://api.github.com/users/"
                                  f"{owner}/repos?per_page=100&page={page}")
        except Exception:
            break   # offline or rate-limited: the explicit peer list still works
        if not isinstance(listing, list) or not listing:
            break
        for entry in listing:
            entry = entry if isinstance(entry, dict) else {}
            name = str(entry.get("name") or "")
            if not FOLLOW_CONVENTION.fullmatch(name):
                continue
            if entry.get("fork") or entry.get("archived") or entry.get("private"):
                continue
            repos.append(f"{owner}/{name}")
        if len(listing) < 100:
            break
    return repos

def _write_federation(peers, follows):
    os.makedirs(DEX_HOME, exist_ok=True)
    with open(FEDERATION_FILE, "w") as f:
        json.dump({"schema": "rappid-federation/1",
                   "peers": peers, "follows": follows}, f, indent=2)

def cmd_dogg_follow(owner):
    """Follow a GitHub account: every rappidverse-* repo it has now — and every
    one it creates later — walks as a federation root on each sync."""
    owner = (owner or "").strip().lstrip("@").lower()
    if not GITHUB_OWNER.fullmatch(owner):
        sys.exit("an owner is a GitHub account name (rappidex dogg follow kody-w)")
    follows = _federation_follows()
    if owner in follows:
        print(f"already following @{owner}")
        return follows
    follows.append(owner)
    _write_federation(_federation_peers(), follows)
    repos = _follow_repos(owner)
    if repos:
        print(f"🐾  following @{owner} — {len(repos)} rappidverse-* repo(s) answer:")
        for r in repos:
            print(f"    {r}")
    else:
        print(f"🐾  following @{owner} — no rappidverse-* repos yet; "
              f"they join the next sync the moment they exist")
    return follows

def cmd_dogg_unfollow(owner):
    owner = (owner or "").strip().lstrip("@").lower()
    follows = [o for o in _federation_follows() if o != owner]
    _write_federation(_federation_peers(), follows)
    print(f"…  no longer following @{owner}")
    return follows

def _raw_url(repo, path):
    return f"https://raw.githubusercontent.com/{repo}/main/rappidverse/{path}"

def _fetch_json(url, timeout=20, cap=DOOR_MAX_BYTES * 8):
    """Every byte a peer serves is untrusted until parsed under a cap — an
    index the size of a hard drive is an attack, not a federation."""
    import urllib.request
    with urllib.request.urlopen(url, timeout=timeout) as r:
        raw = r.read(cap + 1)
    if len(raw) > cap:
        raise ValueError("response exceeds the federation size cap")
    return json.loads(raw)

def cmd_dogg_federate(repo):
    """Join a DOGG repo to this device's federation."""
    if not re.fullmatch(r"[\w.-]+/[\w.-]+", repo or ""):
        sys.exit("a peer is owner/name of a public GitHub repo")
    peers = _federation_peers()
    if repo in peers:
        print(f"already federated with {repo}")
        return peers
    try:
        index = _fetch_json(_raw_url(repo, "index.json"))
        doors = len(index.get("doors", {}))
        print(f"🤝  {repo} answers — {doors} door(s) in its rappidverse")
    except Exception as e:
        print(f"⚠️  {repo} has no reachable rappidverse yet ({e}) — federating anyway")
    peers.append(repo)
    _write_federation(peers, _federation_follows())
    print(f"    federation: {', '.join(peers)}")
    return peers

def cmd_dogg_unfederate(repo):
    """Leave a DOGG repo: drop it from this device's federation. Removal
    propagates the same way membership does — every sync re-walks the CURRENT
    lists, so a peer deleted here (or from a repo's curated peers.json) simply
    stops being walked; nothing remembers it."""
    peers = [p for p in _federation_peers() if p != repo]
    _write_federation(peers, _federation_follows())
    print(f"…  no longer federated with {repo}")
    print(f"    federation: {', '.join(peers) if peers else '(empty)'}")
    return peers

def cmd_dogg_sync(quiet=False):
    """Walk the federation (transitively, bounded) and cache every reachable
    door, so any chant resolves from this device without naming a repo."""
    seen, queue = [], list(_federation_peers())
    repo_env = os.environ.get("RAPPID_DOGG_REPO")
    if repo_env and repo_env not in queue:
        queue.insert(0, repo_env)
    # followed accounts: derive their rappidverse-* repos NOW, so a repo the
    # owner created since the last sync walks as a root with no re-federate
    for owner_name in _federation_follows():
        derived = _follow_repos(owner_name)
        if not quiet and derived:
            print(f"    @{owner_name}: {len(derived)} repo(s) via the owner convention")
        for repo in derived:
            if repo not in queue:
                queue.append(repo)
    cache = {"schema": "rappid-rappidverse-cache/1", "synced_at": now_iso(),
             "repos": [], "doors": {}}
    depth_left = {r: FEDERATION_DEPTH for r in queue}
    while queue and len(seen) < FEDERATION_MAX_REPOS:
        repo = queue.pop(0)
        if repo in seen:
            continue
        seen.append(repo)
        try:
            index = _fetch_json(_raw_url(repo, "index.json"))
        except Exception as e:
            if not quiet:
                print(f"    {repo}: unreachable ({e})")
            continue
        cache["repos"].append(repo)
        for chant, meta in (index.get("doors") or {}).items():
            # first repo to answer for a chant wins; later repos never override
            cache["doors"].setdefault(chant, {**(meta or {}), "repo": repo})
        if depth_left.get(repo, 0) > 0:
            try:
                more = _fetch_json(_raw_url(repo, "peers.json")).get("peers", [])
            except Exception:
                more = []
            for peer in more:
                if re.fullmatch(r"[\w.-]+/[\w.-]+", str(peer)) and peer not in seen:
                    depth_left.setdefault(peer, depth_left[repo] - 1)
                    queue.append(peer)
    os.makedirs(DEX_HOME, exist_ok=True)
    with open(RAPPIDVERSE_CACHE, "w") as f:
        json.dump(cache, f, indent=2)
    if not quiet:
        print(f"🌍  rappidverse synced — {len(cache['doors'])} door(s) "
              f"across {len(cache['repos'])} repo(s)")
    return cache

def _resolve_chant(chant):
    """chant → (raw door URL, sha256 pin) via the synced federation cache."""
    try:
        with open(RAPPIDVERSE_CACHE) as f:
            cache = json.load(f)
    except OSError:
        return None
    meta = (cache.get("doors") or {}).get(chant)
    if not meta or not meta.get("repo"):
        return None
    return (_raw_url(meta["repo"], f"doors/{chant}.json"),
            meta.get("door_sha256"))


# ─────────────────────────────────────────────── the GODD layer (private save)
GODD_REPO = os.environ.get("RAPPID_GODD_REPO") or "kody-w/RAPP-Private-Workspace"

def _godd_checkout():
    d = os.path.join(DEX_HOME, "godd-checkout")
    if os.path.isdir(os.path.join(d, ".git")):
        subprocess.run(["git", "-C", d, "pull", "-q", "--rebase"], check=True)
    else:
        subprocess.run(["git", "clone", "-q", f"https://github.com/{GODD_REPO}.git", d],
                       check=True)
    return d

def _godd_key():
    p = os.path.join(DEX_HOME, "keys", "godd.key")
    if not os.path.exists(p):
        os.makedirs(os.path.dirname(p), exist_ok=True)
        with open(p, "wb") as f:
            f.write(base64.urlsafe_b64encode(os.urandom(32)))
        os.chmod(p, 0o600)
        print(f"🔑  minted device key → {p}  (NEVER leaves the device except by hand)")
    return p

def cmd_godd_save():
    """Mirror this device's creatures + party into the private GODD repo."""
    import shutil
    d = _godd_checkout()
    dest = os.path.join(d, "godd", "rappids", hostslug())
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    if os.path.isdir(dest):
        shutil.rmtree(dest)
    shutil.copytree(RAPPIDS, dest)
    pp = _party_path()
    if os.path.exists(pp):
        shutil.copy(pp, os.path.join(dest, "party.json"))
    subprocess.run(["git", "-C", d, "add", "-A"], check=True)
    r = subprocess.run(["git", "-C", d, "commit", "-q", "-m",
                        f"godd save: {hostslug()} rappids + party"], capture_output=True, text=True)
    if r.returncode == 0:
        subprocess.run(["git", "-C", d, "push", "-q"], check=True)
        print(f"⛅  GODD save pushed → {GODD_REPO}/godd/rappids/{hostslug()}")
    else:
        print("⛅  GODD already current — nothing to save")

def cmd_godd_pull(host=None):
    """Reassimilate a host's party straight from the private GODD repo (cloud
    pull — the companion path that needs no QR, only repo access)."""
    d = _godd_checkout()
    base = os.path.join(d, "godd", "rappids")
    if not os.path.isdir(base):
        sys.exit("the GODD repo has no saves yet — run `party godd save` on a device first")
    hosts = sorted(os.listdir(base))
    host = host or (hosts[0] if len(hosts) == 1 else None)
    if not host or host not in hosts:
        sys.exit(f"pick a host with --host: {', '.join(hosts)}")
    src_dir = os.path.join(base, host)
    doc = {"schema": "rappid-party-transfer/1", "host": host,
           "exported_at": now_iso(), "party": []}
    try:
        with open(os.path.join(src_dir, "party.json")) as f:
            active = json.load(f).get("active", [])
    except OSError:
        active = []
    for entry in sorted(os.listdir(src_dir)):
        p = os.path.join(src_dir, entry, "rappid.json")
        if os.path.exists(p):
            with open(p) as f:
                rec = json.load(f)
            if not active or rec.get("rappid") in active:
                doc["party"].append(rec)
    tmp = os.path.join(DEX_HOME, "godd-pull.rappidparty")
    with open(tmp, "w") as f:
        json.dump(doc, f)
    cmd_party_import(tmp)
    os.remove(tmp)

def cmd_godd_seal(path=None):
    """Sealed tier: encrypt the party transfer with the device key and place the
    capsule in the GODD vault. Contributors without the hand-carried key hold
    ciphertext."""
    key = _godd_key()
    src_file = path or cmd_party_export(os.path.join(DEX_HOME, "party-to-seal.rappidparty"))
    d = _godd_checkout()
    vault = os.path.join(d, "godd", "vault")
    os.makedirs(vault, exist_ok=True)
    out = os.path.join(vault, f"party-{hostslug()}.sealed")
    subprocess.run(["openssl", "enc", "-aes-256-cbc", "-pbkdf2", "-salt",
                    "-pass", f"file:{key}", "-in", src_file, "-out", out], check=True)
    if src_file.endswith("party-to-seal.rappidparty"):
        os.remove(src_file)
    subprocess.run(["git", "-C", d, "add", "-A"], check=True)
    r = subprocess.run(["git", "-C", d, "commit", "-q", "-m",
                        f"godd vault: sealed party capsule from {hostslug()}"],
                       capture_output=True, text=True)
    if r.returncode == 0:
        subprocess.run(["git", "-C", d, "push", "-q"], check=True)
    print(f"🔐  sealed capsule → {GODD_REPO}/godd/vault/{os.path.basename(out)}")

def cmd_godd_unseal(name=None, out=None):
    key = _godd_key()
    d = _godd_checkout()
    vault = os.path.join(d, "godd", "vault")
    capsules = sorted(os.listdir(vault)) if os.path.isdir(vault) else []
    if not capsules:
        sys.exit("the vault is empty")
    name = name or (capsules[0] if len(capsules) == 1 else None)
    if not name or name not in capsules:
        sys.exit(f"pick a capsule: {', '.join(capsules)}")
    out = out or os.path.join(os.getcwd(), name.replace(".sealed", ".rappidparty"))
    r = subprocess.run(["openssl", "enc", "-d", "-aes-256-cbc", "-pbkdf2",
                        "-pass", f"file:{key}", "-in", os.path.join(vault, name),
                        "-out", out], capture_output=True, text=True)
    if r.returncode != 0:
        sys.exit("unseal failed — wrong or missing device key (get it by sneakernet: `party keyqr` on the sealing device)")
    print(f"🔓  unsealed → {out}   (import with: party import {out})")

def cmd_godd_keyqr(out=None):
    """Render the device key as a QR page — the sneakernet hand-transfer."""
    key = open(_godd_key()).read().strip()
    payload = f"rappidzoo://key?k={key}"
    out = out or os.path.join(os.getcwd(), f"godd-key-{hostslug()}.html")
    try:
        import io
        import qrcode
        import qrcode.image.svg
        img = qrcode.make(payload, image_factory=qrcode.image.svg.SvgPathImage,
                          box_size=14, border=3)
        buf = io.BytesIO(); img.save(buf)
        page = ("<!DOCTYPE html><html><head><meta charset='utf-8'><title>GODD key — hand-carry only</title>"
                "<style>body{background:#0e1116;color:#e6edf3;font:15px ui-monospace,monospace;display:flex;"
                "flex-direction:column;align-items:center;padding:40px}svg{background:#fff;border-radius:14px;"
                "padding:10px;width:min(70vmin,480px);height:auto}h1{color:#ff5d3c;letter-spacing:.08em}"
                "p{color:#8d96a0;max-width:56ch;text-align:center}</style></head><body>"
                "<h1>⚠ SNEAKERNET KEY</h1><p>This unlocks the sealed vault. Show it ONLY to your own "
                "companion device, in person. Never screenshot it into a chat, never commit it, never "
                "email it. Close this page when the scan is done.</p>"
                + buf.getvalue().decode() + "</body></html>")
        with open(out, "w") as f:
            f.write(page)
        os.chmod(out, 0o600)
        print(f"🔑  key QR (hand-carry only) → {out}")
    except ImportError:
        print(payload)
    return out

# ─────────────────────────────────────────────── main
def main():
    ap = argparse.ArgumentParser(prog="rappidex")
    sub = ap.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("hatch"); p.add_argument("species")
    p.add_argument("--midwife", help="which hatcher adapter attests this birth")
    p.add_argument("--attempts", type=int, default=3)
    p.add_argument("--anchor", help="a file, link or note this creature is born OF")
    p.add_argument("--anchor-title", help="what to call that thing")
    p = sub.add_parser("discover"); p.add_argument("name")
    p.add_argument("--command", required=True, help="how to call this AI ({prompt} / {prompt_json})")
    p.add_argument("--shape", default="cli"); p.add_argument("--model"); p.add_argument("--genus")
    sub.add_parser("verify").add_argument("key")
    p = sub.add_parser("emit"); p.add_argument("slug", nargs="?"); p.add_argument("-o", "--out")
    p.add_argument("--all", action="store_true", help="every species with a known adapter")
    sub.add_parser("shape").add_argument("species")
    p = sub.add_parser("bless"); p.add_argument("key"); p.add_argument("--midwife"); p.add_argument("--attempts", type=int, default=3)
    p = sub.add_parser("mutate"); p.add_argument("key")
    p.add_argument("kind", choices=sorted(molting.MUTATION_KINDS)); p.add_argument("note", nargs="?", default="")
    p.add_argument("--anchor", help="a file, link or note this mutation came from")
    p.add_argument("--anchor-title")
    p = sub.add_parser("dogg")
    p.add_argument("verb", choices=["publish", "summon", "chant", "federate", "unfederate",
                                    "follow", "unfollow", "peers", "sync"])
    p.add_argument("key", nargs="?"); p.add_argument("--repo"); p.add_argument("--no-push", action="store_true")
    p.add_argument("--rappid", help="demand this exact identity from the summoned door")
    sub.add_parser("frames").add_argument("key")
    p = sub.add_parser("molt"); p.add_argument("key"); p.add_argument("other", nargs="?")
    p = sub.add_parser("roar"); p.add_argument("species"); p.add_argument("--done", action="store_true")
    sub.add_parser("mute"); sub.add_parser("unmute")
    sub.add_parser("list")
    sub.add_parser("show").add_argument("key")
    p = sub.add_parser("export"); p.add_argument("key"); p.add_argument("-o", "--out")
    sub.add_parser("import").add_argument("path")
    p = sub.add_parser("convert"); p.add_argument("key"); p.add_argument("species")
    p = sub.add_parser("fuse"); p.add_argument("a"); p.add_argument("b"); p.add_argument("species", nargs="?")
    p = sub.add_parser("holodex"); p.add_argument("--no-open", action="store_true")
    p = sub.add_parser("party"); p.add_argument("verb", choices=["export", "import", "qr"]); p.add_argument("path", nargs="?"); p.add_argument("-o", "--out")
    p = sub.add_parser("godd"); p.add_argument("verb", choices=["save", "pull", "seal", "unseal", "keyqr"]); p.add_argument("name", nargs="?"); p.add_argument("--host"); p.add_argument("-o", "--out")
    a = ap.parse_args()
    os.makedirs(RAPPIDS, exist_ok=True)
    _load_discovered()
    if a.cmd == "hatch":
        cmd_hatch(a.species, midwife=a.midwife, attempts=a.attempts,
                  anchor=a.anchor, anchor_title=a.anchor_title)
    elif a.cmd == "discover":
        cmd_discover(a.name, a.command, shape=a.shape, model=a.model, genus=a.genus)
    elif a.cmd == "emit":
        if a.all: cmd_emit_all(a.out)
        elif a.slug: cmd_emit(a.slug, a.out)
        else: sys.exit("emit needs a species slug or --all")
    elif a.cmd == "shape": cmd_shape(a.species)
    elif a.cmd == "mutate":
        cmd_mutate(a.key, a.kind, a.note, anchor=a.anchor, anchor_title=a.anchor_title)
    elif a.cmd == "dogg":
        if a.verb in ("publish", "summon", "chant") and not a.key:
            sys.exit(f"dogg {a.verb} needs a rappid key or chant")
        if a.verb == "publish": cmd_dogg_publish(a.key, a.repo, push=not a.no_push)
        elif a.verb == "summon": cmd_dogg_summon(a.key, a.repo, rappid=a.rappid)
        elif a.verb == "federate": cmd_dogg_federate(a.key or a.repo)
        elif a.verb == "unfederate": cmd_dogg_unfederate(a.key or a.repo)
        elif a.verb == "follow": cmd_dogg_follow(a.key)
        elif a.verb == "unfollow": cmd_dogg_unfollow(a.key)
        elif a.verb == "peers":
            peers = _federation_peers()
            print("\n".join(peers) if peers else "no federation yet — rappidex dogg federate owner/name")
            for owner_name in _federation_follows():
                print(f"@{owner_name} (follows every rappidverse-* repo, present and future)")
        elif a.verb == "sync": cmd_dogg_sync()
        else:
            rec = find_record(a.key)
            if not rec: sys.exit(f"no rappid matching '{a.key}'")
            print(chant_for(rec))
    elif a.cmd == "frames": cmd_frames(a.key)
    elif a.cmd == "molt": cmd_molt(a.key, a.other)
    elif a.cmd == "bless": cmd_bless(a.key, midwife=a.midwife, attempts=a.attempts)
    elif a.cmd == "verify":
        rec = find_record(a.key)
        if not rec: sys.exit(f"no rappid matching '{a.key}'")
        b = rec.get("birth")
        if not b: sys.exit(f"{rec['display_name']} carries no birth record — it predates the rite")
        good = rite.verify_seal(b, rec.get("rappid", ""), rec.get("species", ""))
        print(f"{'✅' if good else '❌'} {rec['display_name']} — birth seal "
              f"{'verifies' if good else 'DOES NOT verify'} "
              f"(sealed by {b['midwife']['name']}, motif {' '.join(map(str, b['motif']))})")
        tpath = os.path.join(RAPPIDS, rec["dir"], "birth-transcript.json")
        if b.get("transcript"):
            if os.path.exists(tpath):
                tok = rite.verify_transcript(b, tpath)
                sess = b["transcript"]["session"]
                print(f"{'✅' if tok else '❌'} birthday transcript "
                      f"{'matches its seal' if tok else 'DOES NOT match'} — "
                      f"{b['transcript']['turns']} turn(s) with {sess.get('service')} "
                      f"({sess.get('shape')}), {tpath}")
                good = good and tok
            else:
                print(f"⚠️  birthday transcript not on this device "
                      f"(fingerprint {b['transcript']['sha256'][:12]}) — pull it with `godd pull`")
        sys.exit(0 if good else 1)
    elif a.cmd == "roar": cmd_roar(a.species, done=a.done)
    elif a.cmd == "mute": cmd_mute(True)
    elif a.cmd == "unmute": cmd_mute(False)
    elif a.cmd == "list": cmd_list()
    elif a.cmd == "show": cmd_show(a.key)
    elif a.cmd == "export": cmd_export(a.key, a.out)
    elif a.cmd == "import": cmd_import(a.path)
    elif a.cmd == "convert": cmd_convert(a.key, a.species)
    elif a.cmd == "fuse": cmd_fuse(a.a, a.b, a.species)
    elif a.cmd == "holodex": cmd_holodex(open_it=not a.no_open)
    elif a.cmd == "party":
        if a.verb == "export": cmd_party_export(a.out or a.path)
        elif a.verb == "import":
            if not a.path: sys.exit("party import needs a .rappidparty path")
            cmd_party_import(a.path)
        else: cmd_party_qr(a.out or a.path)
    elif a.cmd == "godd":
        if a.verb == "save": cmd_godd_save()
        elif a.verb == "pull": cmd_godd_pull(a.host)
        elif a.verb == "seal": cmd_godd_seal(a.name)
        elif a.verb == "unseal": cmd_godd_unseal(a.name, a.out)
        else: cmd_godd_keyqr(a.out)

if __name__ == "__main__":
    main()
