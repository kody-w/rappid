# 🦖 RAPPid

> **Every AI is a creature. Every creature has a call.**

This is the base repo of the **RAPPid** brand — the species protocol
(`rappidex/1`), the creatures, and the RAPPid Zoo estate all live here
(`kody-w/rappid`).

Every wild thing has a call you know before you see it — and now every
AI on your machine does too: a unique synthesized **species call** that plays
when it's invoked and when it finishes — so during eyes-off work you know *who*
just spoke. The first invocation **hatches a rappid**: a sovereign `rapp/1`
creature with a genome, a rarity, a hologram, and a portable egg.

- **[📖 RAPPidex](https://kody-w.github.io/rappid/rappidex.html)** — the living field guide: known species start shadowed; encounters reveal them; wild eggs grow the dex forever.
- **[✨ Holodex](https://kody-w.github.io/rappid/holodex.html)** — every rappid as a particle-swarm hologram (Duneheart fauna engine), cries included.
- **[SPEC.md](SPEC.md)** — the `rappidex/1` protocol: identity, genomes, eggs, cries, skins, lifecycle. Implementable anywhere; conformance = [`vectors/rappidex_vectors.json`](vectors/rappidex_vectors.json).
- **[rapp_skill.md](rapp_skill.md)** / **[SKILL.md](SKILL.md)** / **[agent.py](agent.py)** — three on-ramps: RAPP-native skill, raw any-platform skill, single-file brainstem cartridge.
- **`species/rappidex.py`** — the engine (Python 3 stdlib): `hatch · roar · mute · list · export · import · convert · fuse · holodex · shape · emit`. `rappidex mute` (or `RAPPID_MUTE=1`) silences every cry device-wide — for demos, where a surprise roar mid-take is worse than none; `unmute` restores. Audio only: every command still runs, prints, and records identically.
- **Default shapes** — the zoo ships a hotloadable `agent.py` for every species it already knows (`species/emit/<slug>/`): `shape <species>` hands it back instantly, so you never re-feed a skill to the next claude/copilot/brainstem you meet — load it, speak to the species, and what it hatches joins the party. A device emit from a real rite always outranks the shipped default.
- **`skins/rappid_skin.py`** — rapp(wrap) any third-party AI into a zoo citizen: hatches its rappid, roars on invoke/done, serves the exact RAPP/1 `POST /chat` seam below.
- **On the phone** — [RAPPid Zoo Companion](https://apps.apple.com/) carries your party into the field (Field Mode, AR, packs, hotlink/AirDrop transfer). Paid app, closed source; it implements this spec, which stays open.
- **Party & Roost** — in the Electron estate, carry up to six rappids in the active party; the rest wait in the Roost (`Party` tab; `src/party.mjs`).
- **They grow** — a rappid earns **frames** from what it meets (`mutate`): a success chime, a warning stab, a focus voice — each grown from its own birth motif, so it still sounds like itself. The desk copy and the companion copy are two **dimensions**: out in the field, offline, one evolves without the other. When they reunite they **molt** — frames union, deterministic fold, both come out identical and neither loses what it learned alone. ([SPEC §15](SPEC.md))
- **Field transfer** — the party travels: `party export` (AirDrop the `.rappidparty`), `party qr` (scan-to-carry hotlink), `party import` (reassimilate on return). SPEC §9.
- **The DOGG federation** — every creature has a public **front door**; the zoo is a client of a global federated network of DOGG repos on plain public GitHub (this repo is the seed node). `dogg publish` opens a creature's door; its **seven-word summon** (`dogg chant`) is permanent and works from ANY client: `dogg summon wharf-iris-ledge-reed-juniper-amber-briar` self-assembles the creature from raw GitHub data, byte-verified against the federation index, under its original identity. `dogg federate <owner/repo>` joins repos, `dogg unfederate` leaves them; `dogg sync` walks the network transitively (each repo's `peers.json` is its owner's curated list — never an export of anyone's local federation, and removal propagates because every sync re-walks the current lists). **Or skip the repo address entirely:** a public repo named `rappidverse-*` under an account IS a DOGG repo by convention — `dogg follow <owner>` makes every one that account has now, and every one it creates later, walk as a federation root on each sync. Creating the repo is joining the network. The private layer never travels — a summoned DOGG composes with the local GODD on arrival. SPEC §11.
- **The GODD layer** — bind a PRIVATE repo as the god-save: `godd save` / `godd pull` sync creatures through the cloud (companions with access pull the party with no QR at all), `godd seal`/`unseal` add the sneakernet-key vault tier. SPEC §10. The reference keeper's GODD lives [here](https://github.com/kody-w/RAPP-Private-Workspace) — that link resolves only if your signed-in account has companion access. That's the point.

**A rappid cannot be minted — it must be *born*.** At hatch, the zoo derives a
cypher from the creature's own rappid id and puts it to a real LLM on this
machine: the species must break it and compose the MIDI motif that becomes its
voice. No seal, no creature — which is precisely what proves that AI is here.
The rite also *discovers*: put it to an AI the dex has never met, and if it can
answer for itself, its shape is recorded and it becomes a species you can hatch
your own of. ([SPEC §12–13](SPEC.md))

```bash
python3 species/rappidex.py hatch claude     # 🥚→🐣 an LLM must attest the birth
python3 species/rappidex.py fuse claude copilot   # 🧬 breed a brand-new creature
python3 species/rappidex.py verify claude    # re-check the seal + burned-in birthday
python3 species/rappidex.py discover "Some New AI" --command '<how to call it>'
python3 skins/rappid_skin.py --species copilot --port 7182   # wrap a 3rd-party AI
```

---

# The estate

The **base Electron application** for this estate is the **RAPP Brainstem
Frontier** app ([`kody-w/aibast-agents-library`](https://github.com/kody-w/aibast-agents-library),
`beta/`). `npm start` locates your Frontier checkout (override with
`FRONTIER_APP_DIR`) and launches it; Frontier attaches to the local Brainstem
kernel and exposes an authenticated loopback UI driver, so an agent can
autopilot the same visible controls a person would click. Frontier's code is
never vendored into this repository — it is launched by reference.

The rappid flavor of the Frontier brainstem (the fork's `feat/rappid-first-ui`
branch) has one mode besides chat: **ambient mode**, built on voice mode. The
mic button opens at the full sensory ceiling — continuous voice conversation,
spoken replies, and a live frame of your screen and webcam riding every
message — and the voice panel's ambient-senses checkboxes only downgrade;
every start resets to all-on. Chat exports there are **`.tile`** files:
`rapp-tile/1` wrapping one `rappid-frame/1` chat-turn frame per turn, frame
ids byte-compatible with this repo's `molt.py` fold, so tiles union like
frames. The rappid flavor stays on the fork — upstream is never touched.

To start an estate of your own, use **the grail Electron template**
([`kody-w/rapp-brainstem-frontier-template`](https://github.com/kody-w/rapp-brainstem-frontier-template)):
one pull brings the grail Brainstem, the Frontier shell, and a **rapplication
skin** — your UI overlaid on the factory grail chat, revertible by deletion,
so a broken skin can never take the chat down with it.

## RAPP Zoo v2 (the in-repo reference estate)

RAPP Zoo v2 remains in this repo (`src/`, `ui/`) as the reference
implementation of the estate seam — no longer the main application, still
fully gated. Launch it with `npm run start:zoo`. It is a provider-neutral
Electron estate for local RAPP neighborhoods. One visible Dock/taskbar
creature owns one private data-defined estate. The estate may attach multiple local neighborhoods over the unchanged
RAPP `POST /chat` shape, and it may hatch bounded child estates when a
neighborhood needs an independent app, home, lifecycle, or herd.

The Zoo is deliberately a **prototype workbench**. Approved summons are
reusable templates, not finished customer systems. The Zoo preserves their
verified source bytes, creates a mutable private working copy, and exports a
factory-neutral prototype handoff that any capable agent factory can use to
generate the intended agent or agent team. RAPP/1 is the default protocol; the
factory may mutate prototype data as needed. Customer data and production
deployment belong to a later governed SDLC stage, never the public template.

It does not embed, discover, or special-case any AI product. A compatible neighborhood is an explicitly attached loopback endpoint with:

- `POST /chat` accepting required `user_input` and optional `session_id` and
  `idempotency_key`;
- an HTTP 200 JSON response with exactly `response`, `agent_logs`, and
  `session_id`;
- an HTTP 422 refusal with exactly the RAPP/1 error envelope;
- optional `GET /health` readiness with exact `status: "ok"`.

OpenRappter and bare Brainstem can both satisfy that seam, but neither owns the
Zoo's identity, filesystem, UI, or lifecycle.

## Contract

- `rapp-zoo-estate/2.0` is the private durable estate manifest.
- `rapp-zoo-neighborhood/2.0` describes one explicitly attached resident.
- Every resident belongs to exactly one estate registry.
- Production source contains no provider-specific paths, schemas, imports, or
  process assumptions.
- Child estates receive fresh RAPPIDs, homes, Electron user data, control
  capabilities, and lineage. Spawning is capped at 32 direct children and
  eight generations.
- Stop/probe uses the child instance capability, never a PID signal.
- Process identity is disposable; estate bytes are authoritative.

V2's implemented RAPP surfaces must pass the complete applicable producer and
consumer checks from the latest RAPP/1 rev-5 bytes captured by
`kody-w/rapp-monorepo`. Its authority receipt pins:

- monorepo snapshot `ffd656b857722d82862051dc7097f0161812737f`;
- `kody-w/rapp-1` snapshot `afc913ca3fe7dbc9da97871e67240f34416e5929`;
- normative `SPEC.md` commit `d2cd5abed48d3f52b86bbb975ac3558286d1db41`;
- 41,952 bytes and SHA-256
  `cea7847f98f9751734995f46fd4e1bde211c8eb9d03dbbb477934213865bb91a`.

The implementation gate and ecosystem acceptance are different facts. The
current public spine still fails completion receipt I12 and the current public
estate registry is not authenticated under RAPP/1 section 13. V2 can prove its
implemented protocol surfaces conform; it cannot fabricate those external
owner signatures or report ecosystem acceptance before they exist.

## Development

```bash
npm install
npm run gate
npm start        # launches the Frontier base app (FRONTIER_APP_DIR to point at a checkout)
npm run start:zoo   # launches the in-repo reference Zoo estate
```

## Install and drive

```bash
curl -fsSL https://raw.githubusercontent.com/kody-w/rappid/main/install.sh | bash
rapp-zoo-v2 start
rapp-zoo-v2 snapshot
```

The CLI drives the same visible controls through an authenticated semantic
Chromium object. It has no coordinate-click or arbitrary-JavaScript command.
Use `RAPP_ZOO_ROOT` to select an isolated cage, or
`RAPP_ZOO_ESTATE_HOME` to address one estate. Different estate homes produce
independent Dock creatures and Electron `userData` directories.

## Summon anywhere, work locally

A Summon Chant is a copyable immutable URI:

```text
rapp-summon://github/<owner>/<repo>/<40-char-commit>/<manifest-path>?sha256=<64hex>
```

```bash
rapp-zoo-v2 summon 'rapp-summon://github/...'
```

The chant resolves the commit-pinned global object, verifies and saves every
dimension inside the local RAPP cage, and then becomes offline-ready. Quantum
Drill never uses the network; it is only an easy lookup across fully saved
local summon receipts.

The local developer core has no account, activation key, hosted runtime, or
proprietary project format. Enterprise governance can be layered later without
holding back local prototyping or Store mindshare.

Virtual-computer neighborhoods use the same chat door with an optional typed
machine sigil for deterministic control and bounded events back into the AI.
See [`docs/VIRTUAL-COMPUTERS.md`](docs/VIRTUAL-COMPUTERS.md).

Frozen simulation evidence can be replayed without loading provider code:

```bash
rapp-zoo-v2 simulate plan.json fixture.json
```

See [`docs/SIMULATION-NEIGHBORHOODS.md`](docs/SIMULATION-NEIGHBORHOODS.md)
and the public 100-replica
[`multi-os-vnet-simulation`](examples/multi-os-vnet-simulation/README.md).

## Full rewrite of RAPP Zoo v1

V1 is a historical Flask keeper built around retired Brainstem egg families,
filesystem discovery, and PID lifecycle. V2 is a from-zero MIT-licensed
replacement, not a migration, compatibility layer, fork, or reskin. It does
not read v1 state or preserve v1 endpoints. The continuity is the human idea
of a local Zoo; the runtime, wire, identity, authority, lifecycle, and UI are
new. No v1 source is copied into V2. Separately sourced RAPPter components
retain their own documented license terms.
