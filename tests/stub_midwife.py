#!/usr/bin/env python3
"""A deterministic stand-in midwife, for tests only.

It solves the cypher the same way a real LLM must, so the suite can exercise
the whole rite without spending a model call. It is NOT a way to hatch real
rappids: nothing outside tests/ references it, and a birth it seals records
midwife name "stub" in the ledger for exactly that reason.
"""
import re
import sys

ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ"
prompt = sys.argv[1] if len(sys.argv) > 1 else sys.stdin.read()
cypher = re.search(r"CYPHER:\s*([A-Z]+)", prompt).group(1)
shift = int(re.search(r"back by (\d+)", prompt, re.I).group(1))
lo, hi = (int(n) for n in re.search(r"between (\d+) and (\d+)", prompt).groups())
kept = cypher[::2][::-1]
word = "".join(ALPHABET[(ALPHABET.index(c) - shift) % 26] for c in kept)
span = max(1, hi - lo)
motif = [lo + (i * 5 + 3) % span for i in range(7)]
print(f"DECODE: {word}")
print(f"MOTIF: {' '.join(str(n) for n in motif)}")
