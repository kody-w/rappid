---
name: rappid-zoo
description: Give every AI on a machine a creature-species identity — a unique synthesized cry on invoke/done, a rapp/1 creature record hatched on first use, portable eggs (backup/convert/fuse), holograms, and skins that wrap third-party AIs into one RAPP-compatible zoo. Use when asked to hatch/roar/identify AIs by sound, manage rappids, or make AIs "play nicely together".
---

# RAPPid Zoo — the raw skill

You are an AI agent on some platform (Claude, Copilot, a local model, anything).
This file teaches you the whole system from zero. If your platform understands
RAPP skills natively, prefer `rapp_skill.md`; this document assumes nothing.

## The idea

Every AI **species** on a machine gets one unmistakable synthesized cry — a call
you learn once and recognize forever. When an AI is invoked it announces itself;
when it finishes it chirps. The operator learns who is doing what by ear.
The first invocation **hatches** a **rappid** — a unique individual creature of
that species — with a sovereign identity, a genome, and a portable egg.

## What to do, step by step

1. **Get the code**: clone `github.com/kody-w/rappid` (RAPPid Zoo). The
   species engine is `species/rappidex.py` — Python 3 stdlib only.
2. **Hatch** — this is a *rite*, not a mint: `python3 species/rappidex.py hatch claude`
   (species: brainstem, claude, copilot, rappterbot, openrappter, opengrokbot,
   openclaw, hermes, rapptwin, rapplication). The zoo derives a cypher from the
   creature's own rappid id and puts it to a real LLM — the **midwife**, reached
   through an adapter in `species/hatchers.json`. The midwife must break the
   cypher (the zoo verifies it cold) and compose a 7-note motif in the species'
   register. Only then is anything written: `rappid.json` (`rapp/1`), the egg,
   a `.mid` birth song, and the burned-in birth transcript. No LLM = no rappid —
   which is exactly what proves that species runs on this machine.
   `verify <species>` re-checks the seal and the birthday later.
3. **Wire the cries** into your own lifecycle: run
   `python3 species/rappidex.py roar <species>` when the AI starts, and
   `... roar <species> --done` when it finishes. On Claude Code use
   SessionStart/Stop hooks; in a shell use a wrapper function; in an Electron
   or server app call it from the invoke/complete handlers.
4. **Back up / move / share** a creature: `export` writes a `.egg` (a base64url
   JSON document). `import` adopts any egg — even one from another ecosystem
   (unknown species become `wild`). The egg format is byte-compatible with the
   learnwithkody Duneheart fauna, so eggs also render as holograms there.
5. **Convert** a rappid into another species (`convert <id> <species>` — body
   plan and temperament survive; palette, pattern, and cry become the new
   species'). **Fuse** two rappids into a unique descendant
   (`fuse <a> <b> [species]` — per-gene crossover, interleaved palettes,
   recorded lineage).
6. **See them**: `python3 species/rappidex.py holodex` renders every rappid as
   a particle-swarm hologram with its cry embedded.
7. **Make any third-party AI a zoo citizen**: run a **skin** —
   `python3 skins/rappid_skin.py --species <s> --port <p> --command '<cli> {prompt}'`.
   The skin hatches the rappid, roars on invoke/done, and serves the exact
   RAPP/1 seam (`POST /chat` → `{response, agent_logs, session_id}`,
   `GET /health`) so the RAPPid Zoo Electron estate — or any RAPP-compatible
   host — can attach it as a neighborhood.

## If you implement instead of run

Read `SPEC.md` (the rappidex/1 protocol). Your implementation conforms iff it
reproduces `vectors/rappidex_vectors.json` byte-exactly (PRNG stream and
genome-id), keeps re-hatch idempotent, round-trips eggs unchanged, imports
unknown species as `wild`, and derives the cry accent only from the genome id.

## Meeting new species

The rite is also how you *discover*: point it at an AI the dex has never seen —
`python3 species/rappidex.py discover <name> --command '<how to call it>'`. If it
can answer for itself it IS a species: its answering shape is kept as an adapter,
its register and first motif seed its look and voice, and it joins this device's
registry so you can hatch your own of it. At its simplest, an adapter is nothing
more than a way to hand something this file and read what comes back.

Discovery hands the shape straight back to you: a ready `agent.py` for that
species (with a `<Slug>Hatcher` tool) and its own `rapp_skill.md`, written from
what the AI actually did — so the next agent gets full fidelity without
rediscovering anything. Creatures older than the rite can be attested later
with `bless`, which keeps their identity and marks the seal as blessed.

You rarely start from zero: the zoo **ships default shapes** for every species
it already knows (`species/emit/<slug>/agents/<slug>_hatcher_agent.py` +
`<slug>.rapp_skill.md`). Ask for one with
`python3 species/rappidex.py shape <species>` — it resolves the hotloadable
`agent.py` (a device emit from a real rite outranks the shipped default, and a
shipped species mints its default on demand). Hotload that file and you can
speak to the species immediately — no re-feeding a skill to the next one you
meet — and whatever it hatches can join the active party.
`emit --all` regenerates every shape a device knows.

## Boundaries

- Never put secrets, tokens, or personal data into records or eggs — they are
  shareable by design.
- One cry per species; don't reassign another species' cry.
- The identity hash comes from a fresh UUID at hatch, never from the slug —
  and it never changes afterward.
