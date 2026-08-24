#!/usr/bin/env python3
"""Species-layer tests: vectors, lifecycle, egg round-trip, skin envelope.

Run:  python3 tests/test_species.py     (stdlib only; isolated tmp homes)
"""
import hashlib
import json
import os
import subprocess
import sys
import tempfile
import time
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "species"))

TMP = tempfile.mkdtemp(prefix="rappidzoo-test-")
os.environ["RAPPIDEX_HOME"] = os.path.join(TMP, "dex")
os.environ["RAPPIDEX_OWNER"] = "test"
os.environ["RAPP_HOME"] = os.path.join(TMP, "rapp")

import rappidex as rx  # noqa: E402
import birth as rite  # noqa: E402
rx.play_cry = lambda *a, **k: None            # silence for CI
rx.play_hatch_fanfare = lambda *a, **k: None

# The rite is real, but the suite must never spend a model call: every hatch in
# these tests is attended by the deterministic stub midwife.
STUB = os.path.join(ROOT, "tests", "stub_midwife.py")
STUB_HATCHERS = {"stub": {"command": f"{sys.executable} {STUB} {{prompt}}",
                          "shape": "test-stub", "model": "deterministic",
                          "timeout": 30, "default": True}}
_real_load_hatchers = rite.load_hatchers
rite.load_hatchers = lambda *a, **k: dict(STUB_HATCHERS)
_real_hatch = rx.cmd_hatch
rx.cmd_hatch = lambda species, quiet=True, midwife="stub", attempts=1: _real_hatch(
    species, quiet=quiet, midwife=midwife, attempts=attempts)
os.makedirs(rx.RAPPIDS, exist_ok=True)

PASS = 0

def ok(name, cond):
    global PASS
    assert cond, f"FAIL: {name}"
    PASS += 1
    print(f"  ok {name}")

# ── 1. conformance vectors ──
v = json.load(open(os.path.join(ROOT, "vectors", "rappidex_vectors.json")))
r = rx.mk_rng(v["prng"][0]["seed"])
ok("prng vector 1", [r() for _ in range(6)] == v["prng"][0]["first6"])
r = rx.mk_rng(v["prng"][1]["seed"])
ok("prng vector 2", [r() for _ in range(3)] == v["prng"][1]["first3"])
g = rx.generate_genome(v["genome"]["species"], v["genome"]["seed"])
ok("genome mint deterministic", g == v["genome"]["genome"])
ok("genome id vector", rx.genome_id(g) == v["genome"]["genome_id"])
egg, gid, _ = rx.pack_egg(g, "Claude Code", rx.rarity_for(g))
ok("rarity vector", rx.rarity_for(g) == v["genome"]["rarity"])
ok("egg vector", egg == v["genome"]["egg"])

# ── 2. lifecycle ──
rec, born = rx.cmd_hatch("claude", quiet=True)
ok("hatch", born and rec["schema"] == "rapp/1" and rec["rappid"].startswith("rappid:@test/"))
ok("identity is 64hex", len(rec["rappid"].rsplit(":", 1)[1]) == 64)
rec2, born2 = rx.cmd_hatch("claude", quiet=True)
ok("re-hatch idempotent", not born2 and rec2["rappid"] == rec["rappid"])

# ── 3. egg round-trip + import ──
p = rx.unpack_egg(rec["egg"])
ok("egg round-trip", p["id"] == rec["genome_id"] and p["genome"] == rec["genome"])
foreign = rx.pack_egg(dict(rx.generate_genome("wild", "foreign-1"), species="duneheart-x"),
                      "Duneheart", "epic", source="learnwithkody-fauna")[0]
fp = os.path.join(TMP, "foreign.egg")
open(fp, "w").write(foreign)
imp = rx.cmd_import(fp)
ok("foreign import → wild", imp["species"] == "wild")

# ── 4. convert + fuse ──
conv = rx.cmd_convert("claude", "copilot")
ok("convert keeps body plan", conv["genome"]["layers"][0]["shape"] == rec["genome"]["layers"][0]["shape"])
ok("convert lineage", conv["lineage"] == [f"converted-from:{rec['rappid']}"])
child = rx.cmd_fuse("claude", conv["genome_id"][:8])
ok("fuse lineage", set(child["lineage"]) == {rec["rappid"], conv["rappid"]})
ok("fuse is new", child["genome_id"] not in {rec["genome_id"], conv["genome_id"]})

# ── 5. skin seam (echo provider) ──
stub_path = os.path.join(TMP, "stub-hatchers.json")
with open(stub_path, "w") as f:
    json.dump(STUB_HATCHERS, f)
env = dict(os.environ, RAPPID_HATCHERS=stub_path, RAPPID_MIDWIFE="stub")
proc = subprocess.Popen([sys.executable, os.path.join(ROOT, "skins", "rappid_skin.py"),
                         "--species", "copilot", "--port", "7955",
                         "--command", "echo skin:{prompt}"],
                        env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
try:
    for _ in range(50):
        try:
            urllib.request.urlopen("http://127.0.0.1:7955/health", timeout=1)
            break
        except OSError:
            time.sleep(0.2)
    req = urllib.request.Request("http://127.0.0.1:7955/chat",
                                 json.dumps({"user_input": "zoo"}).encode(),
                                 {"Content-Type": "application/json"})
    resp = json.loads(urllib.request.urlopen(req, timeout=30).read())
    ok("skin envelope exact", set(resp) == {"response", "agent_logs", "session_id"})
    ok("skin response", resp["response"].startswith("skin:"))
    ok("skin logs carry rappid", any("rappid:@" in l for l in resp["agent_logs"]))
finally:
    proc.terminate()

# ── 6. the rite of hatching (stub midwife — no model calls in CI) ──
hatchers = dict(STUB_HATCHERS)
probe = "0" * 64
ch = rite.derive_challenge(probe, "claude")
ok("challenge is deterministic", rite.derive_challenge(probe, "claude") == ch)
ok("challenge hides its answer", ch["expected"] not in ch["prompt"])

b, exhaust = rite.attend_birth(probe, "claude", hatchers, midwife="stub", attempts=1, log=lambda *a: None)
ok("stub midwife seals a birth", b is not None and exhaust["outcome"] == "sealed")
ok("seal verifies", rite.verify_seal(b, probe, "claude"))
bad = dict(b); bad["motif"] = [1, 2, 3, 4, 5, 6, 7]
ok("forged motif breaks the seal", not rite.verify_seal(bad, probe, "claude"))
bad = dict(b); bad["decode"] = "WRONG"
ok("forged decode breaks the seal", not rite.verify_seal(bad, probe, "claude"))

# a WHOLE self-consistent forgery must also fail: the cypher is re-derived from
# the creature's identity, so a hand-authored birth cannot pass verification
forged_ch = {"cypher": "FORGEDCYPHER"}
forged_ans = {"decode": "NOTREAL", "motif": [72, 74, 76, 78, 80, 82, 84]}
forged = {"rite": rite.RITE, "cypher": "FORGEDCYPHER", "decode": "NOTREAL",
          "motif": forged_ans["motif"], "decode_ok": True, "register": [72, 96],
          "seal": rite.seal_of(forged_ch, forged_ans),
          "midwife": {"name": "nobody", "shape": "cli"}}
ok("a hand-authored birth cannot pass", not rite.verify_seal(forged, probe, "claude"))
ok("verification without identity is refused", not rite.verify_seal(b))
ok("another creature's real seal does not transfer",
   not rite.verify_seal(b, "f" * 64, "claude"))

none, exhaust2 = rite.attend_birth(probe, "claude", {}, attempts=1, log=lambda *a: None)
ok("no midwife = no birth", none is None and exhaust2["outcome"] == "no-midwife")
liar = {"liar": {"command": "echo 'DECODE: NOPE\nMOTIF: 1 2 3 4 5 6 7'", "shape": "cli"}}
none2, exhaust3 = rite.attend_birth(probe, "claude", liar, midwife="liar", attempts=1, log=lambda *a: None)
# and a stranger cannot quietly stand in for a species that has its own name
strangers = {"someoneelse": {"command": "echo x", "shape": "cli", "default": True}}
declined, exhaust4 = rite.attend_birth(probe, "claude", strangers, attempts=1, log=lambda *a: None)
ok("standing in must be deliberate", declined is None and exhaust4["outcome"] == "no-own-midwife")
ok("a wrong answer is refused", none2 is None and exhaust3["outcome"] == "refused")

# an unsealed hatch must write NOTHING
before = set(os.listdir(rx.RAPPIDS))
rec_none, born_none = _real_hatch("rapplication", quiet=True, midwife="nobody", attempts=1)
ok("unsealed hatch writes no record", rec_none is None and not born_none
   and set(os.listdir(rx.RAPPIDS)) == before)

# ── 7. path traversal containment (untrusted interchange documents) ──
evil_doc = {"schema": "rappid-party-transfer/1", "host": "attacker", "exported_at": "x",
            "party": [{"schema": "rapp/1", "rappid": "rappid:@x/pwn:" + "a" * 64,
                       "kind": "creature", "species": "../../../../ESCAPED",
                       "display_name": "PWNED", "genome_id": "../../evil", "egg": "x"}]}
ep = os.path.join(TMP, "evil.rappidparty")
with open(ep, "w") as f:
    json.dump(evil_doc, f)
rx.cmd_party_import(ep)
escaped = [p for p in os.listdir(os.path.dirname(rx.RAPPIDS)) if "ESCAPED" in p]
ok("traversal cannot escape the zoo", not escaped)
ok("traversal record is contained", any("ESCAPED" not in d for d in os.listdir(rx.RAPPIDS)))

# ── 8. a hotlink-born (egg-less) record survives the trip home ──
silhouette = {"schema": "rappid-party-transfer/1", "host": "companion", "exported_at": "x",
              "party": [{"schema": "rapp/1", "rappid": "rappid:@f/sil:" + "b" * 64,
                         "kind": "creature", "species": "claude", "display_name": "Silhouette",
                         "genome_id": "c0ffee123456", "hotlink_only": True}]}
sp_path = os.path.join(TMP, "sil.rappidparty")
with open(sp_path, "w") as f:
    json.dump(silhouette, f)
rx.cmd_party_import(sp_path)   # must not raise
ok("egg-less record reassimilates", any(r.get("genome_id") == "c0ffee123456" for r in rx.all_records()))

# ── 9. bless: a pre-rite creature can be attested after the fact ──
pre = mint_pre_rite = rx.mint_record("hermes", rx.generate_genome("hermes", "pre-rite-1"))
pre["dir"] = "hermes-prerite"
rx.save_record(pre)
ok("pre-rite record has no birth", "birth" not in pre)
blessed = rx.cmd_bless(pre["genome_id"], midwife="stub", attempts=1)
ok("bless seals it", blessed is not None and rite.verify_seal(
    blessed["birth"], blessed["rappid"], blessed["species"]))
ok("bless says it was blessed", blessed["birth"].get("blessed") is True)
ok("bless keeps the identity", blessed["rappid"] == pre["rappid"])
ok("bless records lineage", any("blessed-by:" in x for x in blessed["lineage"]))
ok("bless is idempotent", rx.cmd_bless(pre["genome_id"], midwife="stub")["birth"]["seal"]
   == blessed["birth"]["seal"])

# ── 10. discovery emits a usable agent + skill ──
disc = rx.cmd_discover("Test Species", f"{sys.executable} {STUB} {{prompt}}",
                       shape="test-stub", model="deterministic", genus="Probata")
ok("discovery records the species", disc is not None and disc["genus"] == "Probata")
emitted = rx.cmd_emit("testspecies")
ok("emitted agent compiles", os.path.exists(emitted["agent"]))
src_text = open(emitted["agent"]).read()
compile(src_text, emitted["agent"], "exec")
ok("emitted agent carries the real shape", "test-stub" in src_text)
ok("emitted skill carries the seal", disc["seal"][:16] in open(emitted["skill"]).read())
ok("emitted agent names a tool class", "class TestspeciesHatcher" in src_text)
ok("discovered species is hatchable", rx.cmd_hatch("testspecies", quiet=True,
   midwife="testspecies", attempts=1)[0] is not None)

# ── 10b. default shapes: shipped species are hotloadable with no discovery ──
rite.load_hatchers = _real_load_hatchers   # the real shipped adapter registry
pre = rx.cmd_shape("openrappter", quiet=True)   # nothing emitted on-device yet
ok("the repo ships a default shape", pre is not None and pre["source"] == "shipped"
   and os.path.exists(pre["agent"]))
shipped = rx.cmd_emit("claude")                 # no rite, no discovery, no model call
src_text = open(shipped["agent"]).read()
compile(src_text, shipped["agent"], "exec")
ok("shipped species emits without discovery", "class ClaudeHatcher" in src_text)
ok("shipped shape carries the shipped adapter", "claude -p" in src_text)
ok("shipped shape says it is a default", "default shape" in src_text)
shape = rx.cmd_shape("claude", quiet=True)
ok("a device emit outranks the shipped default",
   shape["source"] == "device" and shape["agent"] == shipped["agent"]
   and shape["skill"] and os.path.exists(shape["skill"]))
allout = rx.cmd_emit_all()
ok("emit --all covers every shipped adapter",
   {"brainstem", "claude", "copilot", "openrappter"} <= set(allout))
ondemand = rx.cmd_shape("copilot", quiet=True)
ok("shape resolves on demand", ondemand is not None and os.path.exists(ondemand["agent"]))
rite.load_hatchers = lambda *a, **k: dict(STUB_HATCHERS)

# ── 11. frames, mutation, and the reunion molt ──
import molt as molting  # noqa: E402

grower, _ = rx.cmd_hatch("copilot", quiet=True, midwife="stub", attempts=1)
gdir = os.path.join(rx.RAPPIDS, grower["dir"])
base = molting.read_frames(gdir, grower)
ok("a creature starts at its birth frame", len(base) == 1 and base[0]["kind"] == "birth")

rx.cmd_mutate(grower["genome_id"], "success", "shipped something")
frames_a = molting.read_frames(gdir, grower)
ok("mutation appends a frame", len(frames_a) == 2)
ok("mutation grows from the birth motif",
   frames_a[-1]["motif"] != grower["birth"]["motif"] and len(frames_a[-1]["motif"]) >= 3)

# the same encounter twice is still one frame — a re-sync never duplicates
dup = molting.mutate(grower, "success", "shipped something", grower["host"],
                     at=frames_a[-1]["at"])
merged_dup, delta_dup = molting.merge(frames_a, [dup])
ok("identical frames merge to one", len(merged_dup) == len(frames_a) and delta_dup["gained"] == 0)

# two dimensions that grew apart
field = molting.mutate(grower, "alert", "caught a bad deploy", "kodys-iphone")
home = molting.mutate(grower, "recovery", "recovered a migration", "kodys-laptop")
left, _ = molting.merge(frames_a, [home])
right, _ = molting.merge(frames_a, [field])
reunited_a, da = molting.merge(left, right)
reunited_b, db = molting.merge(right, left)
ok("reunion is order-independent",
   molting.fold(reunited_a)["molt_id"] == molting.fold(reunited_b)["molt_id"])
ok("reunion keeps both dimensions' gains",
   set(molting.fold(reunited_a)["traits"]) == {"success", "alert", "recovery"})
ok("reunion records where it lived",
   "kodys-iphone" in molting.fold(reunited_a)["dimensions"])
ok("merging is idempotent",
   molting.fold(molting.merge(reunited_a, reunited_a)[0])["molt_id"]
   == molting.fold(reunited_a)["molt_id"])
ok("a role keeps one voice", len(molting.fold(reunited_a)["voices"]) == 3)
ok("mutating without a birth is refused",
   molting.mutate(grower, "focus", "x", "h")["kind"] == "mutation")
try:
    molting.mutate(grower, "not-a-kind", "x", "h")
    ok("unknown mutation refused", False)
except ValueError:
    ok("unknown mutation refused", True)

# frames travel with the party and molt on return
molting.write_frames(gdir, reunited_a)
with open(os.path.join(os.path.dirname(rx.RAPPIDS), "party.json"), "w") as f:
    json.dump({"schema": "rappid-party/1", "active": [grower["rappid"]], "max": 6}, f)
carried = rx.cmd_party_export(os.path.join(TMP, "carry.rappidparty"))
with open(carried) as f:
    doc = json.load(f)
ok("frames travel with the party", len(doc["party"][0].get("frames", [])) == len(reunited_a))

# ── 12. anchored births: a creature born OF something ──
art = os.path.join(TMP, "keepsake.md")
with open(art, "w") as f:
    f.write("# a day worth keeping\nthe zoo became real\n")
anchored, born_anchored = _real_hatch("hermes", quiet=True, midwife="stub", attempts=1,
                                      anchor=art, anchor_title="keepsake.md")
ok("anchored hatch is born", born_anchored and anchored is not None)
ok("the anchor rides in the birth",
   anchored["birth"]["anchor"]["sha256"]
   == hashlib.sha256(open(art, "rb").read()).hexdigest())
ok("the anchor names its kind", anchored["birth"]["anchor"]["kind"] == "journal")
ok("the creature is named for it", "keepsake" in anchored["display_name"])
ok("the artifact's location stays local, not in the egg",
   "held_at" not in anchored["birth"]["anchor"]
   and "anchor_held_at" not in json.loads(rx.b64dec(anchored["egg"]))["genome"])
again, born_again = _real_hatch("hermes", quiet=True, midwife="stub", attempts=1, anchor=art)
ok("one creature per anchor", not born_again and again["genome_id"] == anchored["genome_id"])
noted, _ = _real_hatch("claude", quiet=True, midwife="stub", attempts=1,
                       anchor="a thought worth keeping")
ok("a thought can anchor a birth", noted["birth"]["anchor"]["kind"] == "note")
ok("different anchors are different creatures", noted["genome_id"] != anchored["genome_id"])
bframe = molting.birth_frame(anchored)
ok("lineage remembers the origin",
   bframe.get("anchor", {}).get("sha256") == anchored["birth"]["anchor"]["sha256"])

# ── 13. standing: what it has adapted to, never how long it sat ──
def lived(mutation_kinds):
    frames = [{"schema": "rappid-frame/1", "kind": "birth", "at": "2020-01-01T00:00:00Z",
               "host": "h", "motif": [60]}]
    for i, kind in enumerate(mutation_kinds):
        frames.append({"schema": "rappid-frame/1", "kind": "mutation", "mutation": kind,
                       "role": kind, "at": f"2020-01-0{(i % 8) + 1}T00:00:00Z",
                       "host": "h", "motif": [60 + i]})
    return molting.fold(frames)

ok("a creature that has met nothing is newly hatched", lived([])["standing"] == "newly hatched")
ok("one encounter starts it adapting", lived(["focus"])["standing"].startswith("adapting"))
ok("several make it capable", lived(["focus", "alert", "success"])["standing"].startswith("capable"))
ok("many make it storied", lived(["focus", "alert", "success", "recovery",
                                  "greeting", "focus"])["standing"].startswith("storied"))
ok("breadth is called out", "broad" in lived(["focus", "alert", "success", "recovery"])["standing"])
ok("depth in one thing is called out",
   "specialised" in lived(["focus", "focus", "focus", "focus"])["standing"])
ok("standing counts adaptations, not elapsed time",
   lived(["focus", "alert", "success"])["standing"]
   == molting.fold([dict(f, at="1999-01-01T00:00:00Z")
                    for f in molting.order([{"schema": "rappid-frame/1", "kind": "birth",
                                             "at": "1999-01-01T00:00:00Z", "host": "h", "motif": [60]}]
                                           + [{"schema": "rappid-frame/1", "kind": "mutation",
                                               "mutation": k, "role": k, "at": "1999-01-02T00:00:00Z",
                                               "host": "h", "motif": [61]}
                                              for k in ("focus", "alert", "success")])])["standing"])
ok("nothing in the fold measures age", "age_days" not in lived([]) and "anniversaries" not in lived([]))
ok("the anchor survives every fold",
   molting.fold([molting.birth_frame(anchored)])["anchor"]["sha256"]
   == anchored["birth"]["anchor"]["sha256"])

print(f"\nSPECIES TESTS: {PASS}/{PASS} PASS")
