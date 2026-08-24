#!/usr/bin/env python3
"""Species-layer tests: vectors, lifecycle, egg round-trip, skin envelope.

Run:  python3 tests/test_species.py     (stdlib only; isolated tmp homes)
"""
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
ok("seal verifies", rite.verify_seal(b))
bad = dict(b); bad["motif"] = [1, 2, 3, 4, 5, 6, 7]
ok("forged motif breaks the seal", not rite.verify_seal(bad))
bad = dict(b); bad["decode"] = "WRONG"
ok("forged decode breaks the seal", not rite.verify_seal(bad))

none, exhaust2 = rite.attend_birth(probe, "claude", {}, attempts=1, log=lambda *a: None)
ok("no midwife = no birth", none is None and exhaust2["outcome"] == "no-midwife")
liar = {"liar": {"command": "echo 'DECODE: NOPE\nMOTIF: 1 2 3 4 5 6 7'", "shape": "cli"}}
none2, exhaust3 = rite.attend_birth(probe, "claude", liar, midwife="liar", attempts=1, log=lambda *a: None)
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

print(f"\nSPECIES TESTS: {PASS}/{PASS} PASS")
