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
rx.play_cry = lambda *a, **k: None            # silence for CI
rx.play_hatch_fanfare = lambda *a, **k: None
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
egg, gid, _ = rx.pack_egg(g, "Claude Code", "rare")
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
env = dict(os.environ)
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

print(f"\nSPECIES TESTS: {PASS}/{PASS} PASS")
