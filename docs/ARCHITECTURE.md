# RAPP Zoo v2 architecture

> **Status:** RAPP Zoo v2 is no longer this repo's main Electron application —
> the base app is the RAPP Brainstem Frontier app
> (`kody-w/aibast-agents-library`, `beta/`), launched by reference via
> `npm start`. The Zoo remains in-repo as the reference implementation of the
> estate seam described below, launched with `npm run start:zoo`, and every
> rule in this document still binds it.

## Authority

`estate.json` is the authority for identity, lineage, and resident membership.
It is private, atomically replaced, and rooted in one canonical non-symlink
home. A process may materialize the estate, but a PID never becomes identity or
lifecycle authority.

Each estate also emits `rappid.json` with exact `schema: "rapp/1"` and a
keyless mint computed from the 16 raw UUIDv4 octets using
`Hb("rapp/1:rappid", octets)`. It never hashes a name and never remints an
existing estate.

The global claim registry records which local estate claims each
`neighborhood_id`. Attach and detach update the estate and claim registry under
exclusive file locks. A neighborhood cannot silently appear in two estates.

## Neutral wire

The sole capability adapter is `rapp1-chat`:

```http
POST /chat
Content-Type: application/json

{"user_input":"...","session_id":"...","idempotency_key":"..."}
```

The Zoo emits no other request members. Success must be HTTP 200 with exactly
`{response:string, agent_logs:[string], session_id:string}`. Refusal must be
HTTP 422 with exactly `{error:{code:string, step:string|null}}`; every other
status or shape is refused. Readiness is an application extension and remains
separate: when configured, `GET /health` must return a JSON object with exact
`status: "ok"`. A successful health response never substitutes for a successful
RAPP/1 chat turn.

V2 accepts only explicit loopback HTTP endpoints. It does not scan ports,
processes, homes, or foreign estate registries.

## Lifecycle

Resident neighborhoods are externally owned processes reached over `/chat`.
The Zoo does not guess how to start or stop them.

Detached child estates are Zoo-owned Electron containers. Hatching:

1. mints a fresh estate RAPPID;
2. creates a canonical private child home and user-data directory;
3. persists parent estate ID, parent neighborhood ID, and generation;
4. starts the same generic Electron materializer;
5. records a random instance capability and loopback control endpoint.

Probe and stop require that capability. A live PID without a valid capability
fails closed. A parent may have at most 32 direct children; generation may not
exceed eight.

## Compliance boundary

`conformance/authority.json` pins the byte-identical live and monorepo snapshot
of the latest RAPP/1 rev-5 specification. The V2 gate tests every RAPP surface
it implements against that pin: I-JSON/JCS refusal, domain separation, keyless
identity minting, exact synchronous wire success/refusal, and no legacy output.

This is a full rewrite. The gate also refuses every v1 runtime primitive:
Flask hosting, `brainstem-egg/*`, implicit filesystem discovery, direct PID
signals, and product-specific routes.

Protocol implementation conformance does not create external owner authority.
The current captured public estate still lacks an authenticated section 13
registry, the public spine fails I12 completion, and `rapp-estate/1.1` lacks an
exact canonical material URL. V2 therefore records both facts independently:

```json
{
  "rapp1_implementation": "conformant-after-gate",
  "ecosystem_acceptance": "blocked-on-external-owner-evidence"
}
```

No UI label, health response, evidence receipt, or release text may turn the
second value into acceptance without a complete independently verified public
receipt.

## Morning shift handoff

The estate keeps an append-only operational ledger and generates a print-ready
morning report containing: actions completed, evidence, decisions, blockers,
work still in progress, and the exact overnight-to-primary-team continuation
point. Printing is explicit and capability-scoped; report generation never
silently sends a job to a printer.

## GitHub-native federation

GitHub Issues is the public CRUD/control plane; Git history and
`raw.githubusercontent.com` are the data plane.

1. A structured create/update/deprecate issue declares inert intent.
2. A deterministic workflow validates the actor, schemas, MIT license evidence,
   artifact hashes, prototype boundary, and test receipt. It never executes
   issue content.
3. The workflow opens a catalog PR. Approval publishes a new append-only
   generation whose artifact and license URLs contain full 40-character commit
   SHAs.
4. `library/latest.json` is a mutable discovery pointer only. A client resolves
   it to the immutable generation and never executes or drills the pointer
   itself.
5. Deprecation appends a tombstone. It does not erase prior bytes or rewrite
   lineage.
6. A client anywhere with public internet can fetch the pinned generation,
   verify and save it locally, then operate with no network.

GitHub availability is therefore required for global discovery/delivery, not
for local chat, Drill, prototype mutation, reports, or runtime lifecycle.
