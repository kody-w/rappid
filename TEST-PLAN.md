# RAPP Zoo v2 executable test plan

The release gate exits zero only when every case below is automated, unskipped,
and green. A check that cannot measure is a failure.

| ID | Surface | Acceptance case |
|---|---|---|
| R1 | RAPP/1 authority | Live `kody-w/rapp-1` and pinned `rapp-monorepo` spec bytes match the recorded 41,952-byte SHA-256 pin. |
| R2 | RAPP/1 identity | Keyless RAPPID mint hashes raw UUIDv4 octets with `Hb("rapp/1:rappid", ...)`; name hashes, short tails, uppercase, reminting, and malformed UUIDs fail. |
| R3 | I-JSON/JCS | Duplicate keys, lone surrogates, lossy binary64 tokens, depth >64, and canonical values >1 MiB fail; literal hash vectors match. |
| R4 | RAPP/1 wire | Client emits only `user_input`, optional `session_id`, and optional `idempotency_key`; exact HTTP 200 success and HTTP 422 refusal shapes are enforced. |
| E1 | Estate durability | Private estate and `rappid.json` survive restart without reminting; hostile umask still yields 0700/0600. |
| E2 | Estate ownership | One root plus multiple residents is valid; duplicate/foreign RAPPIDs and endpoint aliases fail transactionally. |
| E3 | Recovery | Interrupted membership transaction rolls forward; unexplained locks and managed symlinks fail closed. |
| E4 | Recursive estates | Child gets fresh RAPPID, home, user data, app identity, and lineage; max 32 direct children and eight generations. |
| E5 | Lifecycle | Probe/stop requires the private instance capability; no code path signals a PID as authority. |
| G1 | Global dimensions | Only full-commit raw GitHub URLs load; manifest and every dimension are byte/size/media/hash checked and privately cached. |
| G2 | Local Quantum Drill | Drill accepts only a persisted local summon receipt, re-reads saved bytes, and performs a local index lookup with zero network calls. |
| G3 | Remote refusal | URLs, streams, memory-only payloads, partial caches, corrupt receipts, and hash-drifted files return `not local` or fail closed. |
| L1 | Approved summon library | Public-eligible entries require immutable source/artifact/license URLs, SPDX license, license-text hash, local receipt, approver, approval time, and explicit public scope. |
| L2 | License refusal | Missing, unknown, ARR, mutable, hash-drifted, or private-only license records cannot enter the exported public telephone-line catalog. |
| L3 | Telephone-line dial | Dial resolves an approved immutable catalog entry, saves it locally, verifies its receipt, then invokes only local capabilities; offline re-dial uses no network. |
| F1 | Mutable prototype workspace | Factory preparation copies immutable summon inputs into a new private workspace; source cache/receipt bytes remain unchanged while the workspace may mutate. |
| F2 | Factory-neutral handoff | Export names goals, inputs, assumptions, acceptance criteria, lineage, default `rapp/1` protocol, and `stage: prototype` without depending on a specific agent factory. |
| F3 | SDLC boundary | Prototype handoff is `non_production: true`, contains no secret/customer data, and requires an explicit later productionization decision before deployment. |
| X1 | Cross-device transfer | Export/import preserves neighborhood RAPPIDs, licenses, source receipts, prototype lineage, and acceptance criteria while excluding local ports, tokens, PIDs, and user-data paths. |
| X2 | Federation materialization | A destination device/cloud estate assigns fresh runtime endpoints and capability tokens; only a fully verified RAPP/1 neighborhood/estate egg may be presented as federation-ready. |
| C1 | GitHub Issue CRUD | Structured create/update/deprecate issues are parsed as inert data, schema/license/actor validated, and converted into a catalog PR; issue text is never executed. |
| C2 | Immutable publication | Approved catalog generations and every artifact/license URL use full commit SHAs and hashes; mutable `latest` is discovery-only. |
| C3 | Append-only deletion | Delete/deprecate creates a tombstone generation and retains prior public bytes and lineage. |
| C4 | Universal summon | A clean client with public internet resolves the discovery pointer, verifies the pinned generation, saves locally, and then re-dials successfully with network denied. |
| H1 | Morning handoff | Ledger is append-only/private, rejects secret-shaped content, groups overnight work, escapes HTML, and renders US Letter output. |
| H2 | Daily print | User-approved printer/time config schedules once per local day and records the successful print date; failures remain visible and retryable. |
| U1 | Chromium virtual object | Snapshot includes URL, title, focus, viewport, app state, global object, and every visible interactive control with stable semantic IDs. |
| U2 | Bounded autopilot | CLI can `snapshot`, `invoke`, `input`, `wait`, and `screenshot` only through declared semantic controls and an authenticated loopback token. |
| U3 | No bypass | Coordinates, arbitrary JavaScript, hidden IPC, undeclared controls, stale screen revisions, foreign origins, and tokenless calls fail. |
| U4 | Real UI | Installed Electron app is driven headlessly through attach, health, chat, global load, local summon lookup, report generation/print preview, child hatch, and stop. |
| P1 | Persistence | Close/reopen retains identity, residents, global receipts, operation ledger, report config, and child registry exactly. |
| P2 | Isolation | Two installed estates run simultaneously with distinct homes, user data, app identity, control tokens, and renderer state. |
| S1 | Local-first sandbox | Real acceptance runs in disposable homes with renderer egress denied, loopback fixture neighborhoods, separate user data, and no access to another estate's files or capabilities. |
| S2 | Offline completeness | After an approved summon is saved, chat fixtures, local Drill, reports, child lifecycle, restart, and semantic autopilot remain usable with all non-loopback network unavailable. |
| M1 | Mutations | At minimum: remove UUID domain tag, permit extra wire key, permit mutable raw URL, bypass local Drill receipt, accept generic HTTP 200, bypass capability stop, or allow arbitrary autopilot JS; each mutant must be caught. |
| I1 | Install | Fresh local installer creates commands, desktop app, isolated data root, MIT/license files, and no dependency on v1 state. |
| I2 | Public smoke | Fresh clone from `kody-w/rapp-zoo-v2` installs and repeats the real autopilot acceptance flow without using the build workspace. |

## Stop condition

1. Syntax, unit, integration, mutation, real Electron, installed-autopilot, and
   public-clone gates all exit zero with no skips.
2. Two read-only critics report no unresolved BLOCKER or MAJOR finding.
3. The published commit equals the locally accepted commit.
4. The handoff names the exact public install command and first semantic CLI
   command the user can run.
