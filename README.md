# RAPP Zoo v2

RAPP Zoo v2 is a provider-neutral Electron estate for local RAPP
neighborhoods. One visible Dock/taskbar creature owns one private data-defined
estate. The estate may attach multiple local neighborhoods over the unchanged
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
npm start
```

## Install and drive

```bash
curl -fsSL https://raw.githubusercontent.com/kody-w/rapp-zoo-v2/main/install.sh | bash
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
