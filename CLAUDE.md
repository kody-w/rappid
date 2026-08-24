# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Two layers in one repo:

1. **The species layer (`rappidex/1`)** — Python 3 stdlib, `species/rappidex.py` plus `birth.py` (the Rite of Hatching) and `molt.py` (frames/mutation/reunion molt). Every AI on a machine is a **species**; its first invocation hatches a **rappid** — a sovereign `rapp/1` creature with a genome, a cry, a hologram, and a portable egg. `SPEC.md` is the protocol authority; conformance means reproducing `vectors/rappidex_vectors.json` byte-exactly.
2. **The estate** — the **base Electron application is the RAPP Brainstem Frontier app** (`kody-w/aibast-agents-library`, `beta/`), launched by reference via `npm start` → `scripts/launch-frontier.mjs` (override the checkout with `FRONTIER_APP_DIR`; Frontier/AIBAST code is NEVER vendored into this repo — two-worlds boundary). The in-repo **RAPP Zoo v2** (Node ESM, `src/*.mjs`, entry `src/main.mjs`, `npm run start:zoo`) remains as the reference implementation of the estate seam and stays fully gated. `docs/ARCHITECTURE.md` covers authority and wire rules; `TEST-PLAN.md` enumerates the acceptance cases the gates automate.

## Commands

Node ≥24.19.0, npm ≥11.6.0 (see `package.json` engines). Python side is stdlib-only.

```bash
npm start                # launch the Frontier base app (by reference; FRONTIER_APP_DIR overrides)
npm run start:zoo        # launch the in-repo reference Zoo estate
npm run check            # node --check every module (syntax gate)
npm run test:unit        # node --test tests/*.test.mjs
node --test tests/party.test.mjs        # a single unit test file
npm run test:e2e         # real Electron (tests/e2e/installed-autopilot.test.mjs)
npm run test:rapp1       # RAPP/1 spec-pin conformance
npm run test:licenses    # license gate for the public catalog
npm run test:mutations   # mutation gate — each seeded mutant must be caught
npm test                 # rapp1 → licenses → unit → e2e → mutations
npm run gate             # full acceptance gate (the release bar; CONTRIBUTING requires it)

python3 tests/test_species.py   # species-layer suite (stdlib only, isolated tmp homes, no model calls)
```

CI (`.github/workflows/ci.yml`): check + rapp1 + licenses + unit + mutations on ubuntu; e2e on macos.

## Initializing for rappid / rapp/1 compatibility

When Claude itself should be a zoo citizen on this machine (the on-ramps: `SKILL.md` for any platform, `rapp_skill.md` for RAPP-native, `agent.py` as a brainstem cartridge):

```bash
python3 species/rappidex.py hatch claude          # 🥚→🐣 first invocation hatches this host's claude rappid
python3 species/rappidex.py roar claude           # announce on invoke (SessionStart hook)
python3 species/rappidex.py roar claude --done    # chirp on completion (Stop hook)
python3 species/rappidex.py mute                  # 🔇 demo-safe: silence every cry device-wide (unmute restores)
python3 species/rappidex.py verify claude         # re-check the seal + burned-in birthday
```

- **Hatch is a rite, not a mint.** The zoo derives a cypher from the fresh rappid id and puts it to a real LLM midwife (adapter shapes in `species/hatchers.json`). The midwife must break the cypher and compose a 7-note motif; seal = sha256(challenge ‖ answer ‖ motif). No seal, no record. Never bypass this — `tests/stub_midwife.py` is the ONLY sanctioned stand-in and only inside tests (its births are ledgered as midwife "stub").
- **Identity is keyless and permanent**: `rappid:@<owner>/<slug>:<64hex>` where the hash is sha256 of a fresh UUID — never derived from the slug or genome; re-hatch is idempotent (stored record reused). Records live at `$RAPP_HOME/rappids/…/rappid.json` (default `~/.rapp/`); dex state at `$RAPPIDEX_HOME` (default `~/.rappidex`). Tests MUST isolate by pointing `RAPPIDEX_HOME`, `RAPP_HOME`, and `RAPPIDEX_OWNER` at tmp dirs and silencing `play_cry`/`play_hatch_fanfare` (see `tests/test_species.py`).
- **The rapp/1 wire seam** (what any neighborhood — including a skinned Claude via `python3 skins/rappid_skin.py --species claude --port <p> --command '…{prompt}'` — must serve): `POST /chat` accepting only `user_input` + optional `session_id`/`idempotency_key`; success is HTTP 200 with exactly `{response, agent_logs, session_id}`; refusal is HTTP 422 with exactly `{error:{code, step|null}}`; optional `GET /health` returns exact `status: "ok"` and never substitutes for a chat turn. The estate emits/accepts nothing else.
- New AIs join via `discover <name> --command '<how to call it>'` (records the answering shape as an adapter and emits that species' own `agent.py` + skill); pre-rite creatures are attested with `bless`.
- **Default shapes**: the repo ships hotloadable agents for known species under `species/emit/<slug>/`. `shape <species>` resolves the right `agent.py` (device emit from a real rite beats the shipped default; shipped species mint on demand); `emit --all -o species/emit` regenerates the shipped set (run it with an isolated `RAPPIDEX_HOME` and `RAPPIDEX_OWNER=rappid` so local discoveries don't leak in). Never re-feed `SKILL.md` to a known species — hotload its shape instead.

## Architecture — what you must not break

- **Determinism is the contract.** All randomness flows through xmur3 → mulberry32 seeded by strings; genome ids are sha256 of canonical JSON (sorted keys, no whitespace, JS number formatting), first 12 hex. Any change here must still reproduce `vectors/rappidex_vectors.json` exactly. Eggs are base64url JSON (no padding), byte-compatible with the learnwithkody Duneheart fauna format; unknown imported species land as `wild`.
- **Frames, not snapshots** (`molt.py`): a rappid's current form is a deterministic fold over its frames (birth + earned mutations), never stored as a second truth. Diverged copies reunite by unioning frames (content-hash identity) and re-folding — both sides come out identical.
- **Estate authority** (`src/estate-store.mjs`): `estate.json` is the sole authority for identity/lineage/membership — private, atomically replaced, 0700/0600 even under hostile umask. A PID is never identity or lifecycle authority; stop/probe uses the private instance capability. One neighborhood belongs to exactly one estate (claim registry under file locks).
- **Trust boundaries fail closed.** Global dimension loads accept only full-commit raw GitHub URLs with byte/size/hash checks; the Local Quantum Drill (`src/local-drill.mjs`) accepts only persisted local receipts with zero network; mutable branches are discovery-only. The autopilot (`src/autopilot-server.mjs`, U1–U3) drives only declared semantic controls over an authenticated loopback token — no coordinates, no arbitrary JS.
- **Prototype ≠ production**: factory handoffs (`src/prototype-handoff.mjs`) stay `non_production: true`, factory-neutral, no customer/secret data; productionization is a separate governed decision.
- Child estates get fresh RAPPIDs/homes/user-data/lineage; capped at 32 direct children, eight generations.

## Rules from CONTRIBUTING.md

- Keep the local developer core MIT, account-free, and offline-capable after import.
- Never copy source from RAPP Zoo v1; never commit customer/private data (records and eggs are shareable by design — no secrets in them, ever).
- Run `npm run gate` before calling work done; **add a mutation to the mutation gate whenever you introduce a new trust boundary**.
- One cry per species; the identity hash never changes after hatch.
