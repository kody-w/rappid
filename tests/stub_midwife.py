#!/usr/bin/env python3
"""A deterministic stand-in midwife, for tests only.

It solves the cypher the same way a real LLM must — including working out the
shift for itself now that the rite no longer states it — so the suite can
exercise the whole rite without spending a model call. It is NOT a way to
hatch real rappids: nothing outside tests/ references it, and a birth it seals
records midwife name "stub" in the ledger for exactly that reason.
"""
import os
import re
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "species"))
from birth import STEMS  # noqa: E402  the "real English word" the rite expects

ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ"
prompt = sys.argv[1] if len(sys.argv) > 1 else sys.stdin.read()
cypher = re.search(r"CYPHER:\s*([A-Z]+)", prompt).group(1)
lo, hi = (int(n) for n in re.search(r"note numbers\s+between (\d+) and (\d+)", prompt).groups())
kept = cypher[::2][::-1]
# The rite says only: the shift is between 2 and 24 and exactly one yields a
# real word. Do what a reasoning midwife does — try them all, keep the word.
word = next(
    cand for shift in range(2, 25)
    for cand in ["".join(ALPHABET[(ALPHABET.index(c) - shift) % 26] for c in kept)]
    if cand in STEMS
)
span = max(1, hi - lo)
motif = [lo + (i * 5 + 3) % span for i in range(7)]
print(f"DECODE: {word}")
print(f"MOTIF: {' '.join(str(n) for n in motif)}")
