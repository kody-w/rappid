# rapp_skill: rappid-zoo

> Drop this file into any RAPP-aware agent's skills directory (or paste it into
> its context). It teaches the agent to run the RAPPid Zoo species layer with
> the tools it already has. Brainstem-native form; if your platform can't use
> this, read `SKILL.md` instead — it teaches the same thing from zero.

## What this skill does

Gives every AI on the machine a **species identity**: a unique creature-call
("cry") on invoke and done, a rapp/1 rappid record hatched on first use, a
portable `.egg`, holographic rendering, and the skin adapter that wraps any
third-party AI into the Zoo's `POST /chat` seam.

## When to use

The user says: "hatch <ai>", "roar", "play its call", "who is talking",
"export/import a rappid", "convert X into a Y", "fuse A and B", "show the
holodex", "skin <ai> so it can join the zoo".

## Commands (the engine is `species/rappidex.py`, stdlib-only)

```bash
python3 species/rappidex.py hatch <species>     # THE RITE: an LLM must seal the birth (§12)
python3 species/rappidex.py hatch <species> --midwife claude   # choose who attends
python3 species/rappidex.py verify <species>    # re-check the seal + burned-in birthday
python3 species/rappidex.py discover <name> --command '<how to call that AI>'  # meet a new species
python3 species/rappidex.py emit <slug>         # its shape → a working agent.py + rapp_skill.md
python3 species/rappidex.py emit --all          # every species with a known adapter (the shipped defaults)
python3 species/rappidex.py shape <species>     # resolve the hotloadable agent.py — device emit beats shipped default
python3 species/rappidex.py bless <species|id>  # attest a creature that predates the rite
python3 species/rappidex.py roar <species>      # play the species call, individual accent
python3 species/rappidex.py list                # the dex
python3 species/rappidex.py export <species|id> -o backup.egg
python3 species/rappidex.py import backup.egg   # any fauna egg; unknown species → wild
python3 species/rappidex.py convert <id> <newspecies>
python3 species/rappidex.py fuse <a> <b> [species]
python3 species/rappidex.py holodex             # regenerate + open the hologram viewer
python3 skins/rappid_skin.py --species claude --port 7181   # wrap a 3rd-party AI
```

## Environment

`RAPPIDEX_HOME` (default `~/.rappidex`), `RAPP_HOME` (default `~/.rapp`,
records at `$RAPP_HOME/rappids/`), `RAPPIDEX_OWNER` (rappid owner, default `local`).
Cries ship in `species/cries/`; regenerate with `python3 species/gen_cries.py` (numpy).

## Rules

- **No LLM, no rappid.** `hatch` runs the Rite of Hatching: the species breaks a cypher derived from its own rappid id and composes the MIDI motif that becomes its voice. An unsealed birth writes NOTHING. Adapters live in `species/hatchers.json` — at its simplest an adapter is just "hand this thing the prompt and read the reply".
- Every rite appends a line to `$RAPPIDEX_HOME/birth-ledger.jsonl` (species, shape, attempts, latency, outcome). The birthday transcript sits beside the creature and syncs privately with `godd save`; it never enters an egg.
- Re-hatch NEVER re-mints: the stored `rappid.json` is authoritative (rapp/1).
- Species not in the registry import as `wild` — never reject an egg.
- The cry accent comes only from `genome_id` — same creature, same voice, everywhere.
- Records and eggs must never contain secrets or PII.
- Full protocol: `SPEC.md` (rappidex/1). Conformance: `vectors/rappidex_vectors.json`.
