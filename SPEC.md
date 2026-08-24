# rappidex/1 — the RAPPid Zoo species protocol

*The species layer of [RAPPid Zoo](README.md) (`kody-w/rappid`).*

> Every AI is a **species**. Every running instance is a **rappid** — a creature
> hatched on a host, with a sovereign identity, a voice, a hologram, and an egg.
> This spec makes that true across ANY ecosystem: feed an agent `rapp_skill.md`
> (brainstem-native) or `SKILL.md` (any platform), or implement this document
> directly.

**Status:** v1 · **Layer:** sits above `rapp/1` identity and the fauna egg format;
introduces species, cries, and the creature lifecycle. Everything here is
implementable from this document alone — reference implementation: `rappidex.py`
(stdlib-only core), test vectors: `vectors/rappidex_vectors.json`.

---

## 1. Taxonomy

| term | meaning |
|---|---|
| **species** | which AI it is (`brainstem`, `claude`, `copilot`, `rappterbot`, `openrappter`, `opengrokbot`, `openclaw`, `hermes`, `rapptwin`, `rapplication`, `wild`, …) |
| **rappid** | one hatched individual of a species on one host |
| **cry** | the species call — one sound per species, voiced with a per-individual accent |
| **genome** | the individual's heritable traits (fauna layer schema, §4) |
| **egg** | the portable document form of a rappid — backup, interchange, conversion, and breeding medium |

A species registry entry declares: display name, genus, blurb, cry file, and
genome biases (palettes, shape weights, symmetry/pattern/limb/glow priors).
Registries are extensible: unknown species imported from elsewhere land as `wild`.

## 2. Identity (rapp/1, Eternity form)

Every rappid mints, once, at first invocation ("hatch"):

```
rappid:@<owner>/<slug>:<64hex>
```

- `<64hex>` = sha256 of a **fresh UUID** — keyless, never derived from slug or genome.
- Re-hatch is **idempotent**: the stored record is reused; the hash never changes.
- The record is `rappid.json`, `schema: "rapp/1"`, and MUST carry at minimum:
  `rappid`, `kind` (`"creature"`), `species`, `name`, `display_name`, `created_at`,
  `host`, `genome_id`, `genome`, `egg`, `lineage` (list). Records live under
  `$RAPP_HOME/rappids/<dir>/rappid.json` (default `~/.rapp/rappids/`).

## 3. Deterministic primitives (MUST be byte-exact)

All randomness flows through **xmur3 → mulberry32** seeded by strings, identical
to the fauna reference. All hashing of genomes uses **canonical JSON**
(keys sorted, no whitespace, JS `JSON.stringify` number formatting) → sha256 →
first 12 hex chars = `genome_id`.

Conformance = reproduce `vectors/rappidex_vectors.json` exactly:

```json
{ "seed": "rappid:claude:kody-mbp:0",
  "first6": [0.227572025266, 0.355436966754, 0.106075236341,
             0.948721266119, 0.583874505712, 0.437456947519] }
```

## 4. Genome (fauna-compatible)

A genome is the Duneheart fauna layer schema plus a `species` tag:

```json
{ "layers": [
    {"role":"form","k":40,"shape":"star|blob|ring","limbs":0,"segments":3,
     "symmetry":"radial|bilateral","body_r":0.42,"limb_len":0.3,"cohesion":0.6},
    {"role":"surface","k":58,"palette":["#…",4],"pattern":"glow|spot|stripe|solid",
     "glow":0.7,"opacity":0.9,"grain":1,"sparkle":0.5},
    {"role":"motion","k":50,"breathe":0.5,"drift":0.4,"pulse":0.4,"reach":0.5,"dissolve":0.5}],
  "compose": {"windows":[[0,1,2]], "loop": true},
  "species": "claude" }
```

Minting is species-biased (the registry's priors feed the same trait mint the
fauna uses) so a claude looks claude-ish and a brainstem brainstem-ish, while
every individual stays unique. Rarity = the fauna scoring function
(star/limbs/glow/bilateral/pattern/segments → common…legendary).

## 5. Egg (portable document form)

`base64url( JSON({genome, id, born:{coord,t}, title, rarity, source}) )`, no padding.
`id` MUST equal `genome_id(genome)`. `born.coord` is a geohash minted from
`mkRng(id)`. This is **byte-compatible with the learnwithkody fauna eggs** —
a rappid renders as a hologram in any fauna viewer, and any fauna egg imports
into any zoo as species `wild`.

## 6. The cry contract

- **One cry per species** — instantly recognizable, one per species. Reference cries
  ship in `species/cries/*.wav` (installed: `$RAPPIDEX_HOME/cries/`) (synthesized by `gen_cries.py`; ~0.5–1.2 s).
- **Individual accent**: playback rate `0.94 + r()*0.14` and volume `0.75 + r()*0.25`
  where `r = mkRng(genome_id)`. Same creature, same accent, every time, everywhere.
- **When to cry**: on **invoke** (announce), on **done** (chirp), and the shared
  `_hatch` fanfare + first cry at hatch. Eyes-off operators identify agents by ear.

## 7. Lifecycle verbs

| verb | contract |
|---|---|
| `hatch <species> [--midwife a] [--attempts n]` | mint genome (seed = `rappid:<species>:<host>:<nonce>`) + rapp/1 identity, then **run the rite (§12)** — an LLM must seal the birth or nothing is written. On success: persist record + egg + birth song `.mid` + burned-in transcript, play fanfare + cry. Idempotent per (species, host). |
| `discover <name> --command '…'` | meet a species the dex has never seen (§13): put the rite to an unknown AI, record its shape, add it to the registry |
| `verify <species\|id>` | re-check a birth seal and its burned-in transcript from the record alone |
| `bless <species\|id>` | attest a creature that predates the rite: identity unchanged, seal marked `blessed` |
| `emit <slug>` \| `emit --all` | lock a species' shape in as a working `agent.py` + `rapp_skill.md` — discovered species emit the shape their rite recorded; shipped species emit their default shape (`--all` does every species with a known adapter) |
| `shape <species>` | resolve the hotloadable `agent.py` for a species: a device emit (from a real rite) outranks the shipped default under `species/emit/`; a shipped species with no emit yet mints its default on demand |
| `hatch <species> --anchor <path\|text>` | born of a specific artifact (§16): the thing's digest shapes the creature |
| `mutate <key> <kind> [note]` | earn a frame from something met in the field; grows a new sound role (§15) |
| `frames <key>` | the creature's lineage: every frame, every dimension it has lived on |
| `molt <key> [doc]` | reunion: fold two dimensions together, losing nothing from either |
| `roar <species> [--done]` | play the individual's cry; auto-hatch on first call |
| `export` | write the egg — the backup/interchange document |
| `import` | adopt any egg; unknown species → `wild`; dedupe on `genome_id` |
| `convert <id> <species>` | re-express in a new species template. Heritable: form geometry + motion temperament. Converted: palette, pattern bias, cry. Deterministic seed `convert:<gid>-><species>`; lineage records the ancestor. |
| `fuse <a> <b> [species]` | breed two ancestors: species template mints the womb genome, then per-gene crossover (~42% A / ~42% B / ~16% fresh mutation), palettes interleave. Lineage = both parent rappids. |
| `holodex` | render the roster as holograms on the fauna engine, cries embedded |

## 8. Skins (wrapping third-party AIs)

A **skin** is a provider-specific adapter that makes any third-party AI a zoo
citizen. The Zoo itself stays provider-neutral; the skin is the only place a
provider's CLI/API is named. A conforming skin MUST:

1. Hatch (or reuse) the wrapped AI's rappid at startup (§2, §7).
2. Play the species cry on every invoke and every completed answer (§6).
3. Serve the RAPP/1 neighborhood seam on loopback, **exactly**:
   - `POST /chat` `{user_input, session_id?, idempotency_key?}` →
     `200 {response, agent_logs, session_id}` (exact keys; `agent_logs` = string array)
   - malformed input → `422 {error: {code, step}}` (exact shape)
   - `GET /health` → `{status: "ok"}`
4. Expose `GET /rappid` → the public record (no `egg`/`genome` bloat, never secrets).

Reference: `skins/rappid_skin.py` + `skins/skins.json` (command templates per
species; `{prompt}` = shell-quoted user_input).

## 9. Field transfer (companion devices)

The party travels. Three documents, one rule: **the full genome moves by file,
the hotlink moves by light, the key moves by hand.**

- **`rappid-party-transfer/1`** (`.rappidparty`) — the party's full records
  (eggs included), AirDropped or otherwise carried to a companion device.
  Reassimilation on return: unknown creatures join the roost (minted from their
  eggs), and the active party becomes the returning party.
- **`rappid-party-qr/1`** — a compact capsule (`rappidzoo://party?d=` +
  base64url(gzip(JSON))) carrying identities only: rappid, species, genome_id,
  name, rarity. A companion scans it to load the party instantly ("hotlink");
  genomes follow by file or GODD pull.
- Verbs: `party export [-o f]` · `party import <f>` · `party qr [-o page.html]`.

## 10. The GODD layer (private save, cloud pull)

A keeper MAY bind the zoo to a **private GODD repository** — source control as
the god-layer save of the on-device creatures:

- `godd save` mirrors `$RAPP_HOME/rappids/` + `party.json` into the private
  repo under `godd/rappids/<host>/`, committed and pushed.
- `godd pull [--host h]` reassimilates a host's party from the private repo —
  a companion with repository access pulls the party **directly from the
  cloud**, no QR needed. Public documents may LINK to the GODD repo; the links
  resolve only for accounts granted access. Authorization is the forge's
  (GitHub's), never the zoo's.
- **Sealed tier (sneakernet key):** `godd seal` encrypts the transfer document
  with a key that lives ONLY on the device (`$RAPPIDEX_HOME/keys/godd.key`,
  never committed); the sealed capsule lands in `godd/vault/`. `godd keyqr`
  renders the key for AirDrop/QR hand-transfer. A contributor without the
  hand-carried key holds ciphertext. `godd unseal` requires the key file.

Rule: records and eggs in the GODD repo follow §14.6 (no secrets, no PII);
the sealed tier exists precisely for what must not be readable even there.

## 11. The DOGG federation (public face, global summon)

The GODD's complement: every creature has a **DOGG** — its public front door
(`rappid-frontdoor/1`), holding everything needed to know, render, and
reassemble it, and nothing that was ever private. The zoo is the client of a
**federated network of DOGG repositories**: any public GitHub repository
carrying this layout is a DOGG repo, and every file rides
`raw.githubusercontent.com` — public, unauthenticated, no API:

```text
rappidverse/index.json      — { doors: { <chant>: {chant, rappid, species,
                              door_sha256, door_bytes, …} } }
rappidverse/doors/<chant>.json   — the full front door (rappid-frontdoor/1)
rappidverse/peers.json      — { peers: ["owner/repo", …] } — the OWNER'S curated list
```

**`main` is the normative branch.** Every rappidverse file is addressed at
`raw.githubusercontent.com/<owner>/<repo>/main/rappidverse/…` — a repo whose
default branch is named otherwise still serves the federation from a `main`
branch. This is a deliberate wire contract, not an accident of the reference
engine.

**Trust (rapp/1 doctrine, not reinvented).** The index rides a mutable branch
and is **discovery-only**; every index entry pins its door's exact bytes
(`door_sha256`, `door_bytes`). A federation-resolved summon MUST verify the
fetched door against its pin and fail closed on mismatch (torn publish,
stale cache, tamper) — the same discipline as the zoo estate's global loads.
The door's `egg` is the §5 egg, its identity the §3 rappid, its frames §15
frames: the federation carries rapp/1 documents, it does not define new ones.

**The seven-word summon.** A creature's chant is seven words drawn from
`sha256(rappid)` over the normative 128-word vocabulary (`CHANT_WORDS` in the
reference engine — fixed order, **frozen at exactly 128 words**; the indexing
is `mod 128`, so the vocabulary can never grow without breaking every chant):
word *i* = `WORDS[digest[i] mod 128]`, `i ∈ 0..6`, joined by `-`.
Deterministic and permanent: the same seven words summon the same creature
from ANY client, forever. A spoken chant (spaces, any case) MUST normalize to
the hyphenated lowercase form. The vocabulary and derivation are pinned by
the conformance vectors (`vectors/rappidex_vectors.json`, `chant`): a client
that cannot reproduce them byte-exactly is not a rappidverse client. A chant
is a 49-bit address, not a proof of identity — which is why a door must
*answer* to its chant (below) and why a caller who knows the full rappid
SHOULD demand it: clients MUST offer a way to pass the full rappid with a
summon (`dogg summon <chant> --rappid <id>` in the reference engine) and MUST
refuse a door carrying any other identity.

**Federation.** A client keeps a local peer list (`federation.json`) and MAY
`sync`: fetch each peer's `index.json`, then walk `peers.json` transitively
(bounded depth and repo count) — so federating with one repo reaches the
network it federates with. The synced cache maps chant → repo; the first repo
answering a chant wins and later repos never override.

**`peers.json` is curated, never exported.** A repo's peer list is its OWNER'S
deliberate act: `publish` only guarantees the file exists (an empty skeleton)
and MUST NOT write the publishing device's local federation into it — a
device's `federation.json` is local configuration, and exporting it would
publish every repo name the device ever pointed at. Spreading a peer means
committing it to your repo's `peers.json` yourself.

**Leaving is as real as joining.** Membership has no memory: every sync
re-walks the CURRENT lists, so removal propagates exactly like addition —
delete a peer from your repo's `peers.json` (or `dogg unfederate` it locally)
and the next sync simply stops walking it. No cache, client, or repo is
entitled to remember a peer the lists no longer name.

**The owner convention (follow an account).** A public, non-fork, non-archived
repository named `rappidverse-*` under a GitHub account is a DOGG repo by
convention — creating the repo is joining the network. A client MAY **follow**
an account: `federation.json` gains `follows: ["owner", …]`, and every sync
derives that account's matching repos from the public unauthenticated listing
API and walks them as federation roots — the repos it has now and every one it
creates later, with no re-federate. The listing API is discovery-only and
optional: it never carries federation data (index, doors, and peers still ride
`raw.githubusercontent.com`), a client without it loses only the convenience,
and a hostile or unreachable listing derives nothing. A follow is client-local
configuration — it never enters a published `peers.json` — and every
follow-resolved summon stays behind the index byte pin, failing closed on
mismatch like any other.

**Summon = instant self-assembly.** Saying the chant fetches the door, unpacks
its egg, reassembles the creature under its ORIGINAL rappid (a summoned
creature keeps its identity — never re-minted), and merges the door's public
frames with whatever frames this device already holds (§15 molt semantics).

**A door is trusted for what it proves, never what it claims.** The byte pin
only proves a door matches its own repo's index. Before assembling, a summon
MUST also verify — and refuse on any failure:

1. **Identity shape** — the door's `rappid` is a well-formed §3 identity.
2. **The chant binding** — a door resolved BY CHANT must answer to it:
   `chant_for(door.rappid)` MUST equal the chant summoned. The seven words
   are the creature's own hash; no repo may park a different creature under
   them.
3. **The egg binding** — the egg's genome MUST hash (§4 genome id) to the
   door's claimed `genome_id`. The creature that assembles is the creature
   that was published.
4. **The cold seal** — the door's `birth` MUST verify against the rappid
   itself (§12: the challenge re-derives from the identity, so a fabricated
   birth cannot pass). Only rite-sealed creatures walk the rappidverse; the
   public birth therefore carries `decode_ok` alongside the seal fields.
5. **Size** — a door larger than 1 MiB, or an index/peers response beyond the
   federation cap, is refused before parsing.

**The local copy of an identity is found by the identity.** A summon lays the
door over an existing local record ONLY when the rappids are equal. The same
genome under a different rappid is a different creature (imports and converts
mint fresh identities over shared genomes); its frames land in their own
record and MUST NOT fold into another's.

**A zoo is a rapp neighborhood.** The local roster a summon assembles into is
not a new construct: a zoo serves the rapp/1 wire seam (§8 — `POST /chat`,
exact success and refusal envelopes), so an estate attaches a zoo exactly as
it attaches any neighborhood, and a summoned creature lands as a citizen of
that neighborhood. Federation moves the data; rapp/1 moves the conversation.

**The GODD stays home.** Only the front door travels. The private layer —
GODD saves, sealed vault, local anchors' bytes, transcripts — never enters a
DOGG repo; a summoned DOGG composes with the *local* device's GODD layer on
arrival. One creature, two faces: the DOGG is what the world can call; the
GODD is what only its keeper holds.

**And so do the machines.** Device hostnames are internal identifiers: public
frames carry no `host`, and `life.dimensions` is a COUNT of the dimensions a
creature lived in, never their names. A public frame keeps its original
content-hash `id`, so the reunion molt still recognizes it as the same frame
— and when a projection meets the richer local frame it projects, the local
frame wins (§15: same id IS the same frame; the projection never replaces
what the keeper holds).

## 12. The Rite of Hatching (an LLM must attest a birth)

**A rappid without a sealed birth is not a rappid.** The zoo cannot mint one
alone: the species must answer for its own offspring, on this device, at hatch.

1. **The challenge** is derived deterministically from the creature's freshly
   minted rappid id: a three-stage cypher (shift → reverse → decoy-interleave)
   plus a motif request bounded to the species' MIDI register. Same creature,
   same rite, forever — so anyone can re-derive it.
2. **The midwife** is an actual LLM, reached through a **hatcher adapter**
   (`species/hatchers.json`): one entry per AI shape — `command` (with
   `{prompt}` / `{prompt_json}`), `shape` (`cli` | `http` | `sdk`), `model`,
   `timeout`. The zoo never guesses a provider's shape; adapters carry it.
3. **Verification is cold.** The zoo knows the plaintext, so a wrong decode is
   refused outright; the motif must land in the species' register. Only real
   reasoning passes, and only from something running here — which is exactly
   what proves the species exists on this device.
4. **The seal** is `sha256(cypher ‖ decode ‖ motif)`, re-checkable from the
   record alone (`rappidex verify <key>`). Tampering with either half breaks it.
5. **The motif becomes the voice.** It is written as a real `.mid` beside the
   creature (its birth song) and sets that individual's accent on the species
   call (`voice.rate` / `voice.vol`) — so the creature's sound descends from
   its own birth rather than from a hash.
6. **The birthday is burned in.** The record carries the transcript's
   `sha256`, turn count, and an honest session locator (service, shape, any
   session id the environment exposes, cwd) so a birth can be traced back to
   the actual session at the provider. The *words* stay beside the creature in
   `birth-transcript.json` (0600) and ride to the private GODD save — never
   into the shareable egg (§11.6).
7. **Refusal is normal and logged.** No midwife, or a midwife that cannot
   answer, means the egg stays an egg — and every rite, sealed or refused,
   appends one line to the birth ledger (`$RAPPIDEX_HOME/birth-ledger.jsonl`):
   species, adapter shape, attempts, latency, outcome.

Records that predate the rite (or that arrived by import/convert/fuse from
elsewhere) keep working: they simply carry no `birth`, and `verify` says so.

## 13. Discovery (meeting a species the dex has never seen)

The rite is also the encounter mechanic. Put it to an AI the registry does not
know — `rappidex discover <name> --command '<how to call it>' [--shape ...]` —
and if it can answer for itself, it *is* a species:

- its answering **shape** is recorded as a hatcher adapter (that shape is the
  data the dex keeps about it),
- its **register** and first **motif** seed the species' palette and voice,
- the species is added to this device's registry
  (`$RAPPIDEX_HOME/discovered-species.json`), which the engine loads at start,

and then you hatch **your own** of that newly-encountered species. At its
simplest an adapter is nothing but a way to hand the thing a `SKILL.md` and
read its reply — which is why any AI that can read a skill file can be met,
recorded, and kept.

**The shape comes back out.** Discovery immediately emits, from what the AI
*actually did* rather than from a guess about it:

- `agents/<slug>_hatcher_agent.py` — a single-file RAPP agent carrying that
  species' locked-in shape (drop it in a brainstem; the model gets a
  `<Slug>Hatcher` tool that can also midwife other births), and
- `<slug>.rapp_skill.md` — the species' skill card: shape, register, first
  motif, seal, and the exact invocation.

Both land in `$RAPPIDEX_HOME/emit/<slug>/`; `emit` regenerates them on demand.
A dex entry carries its own `adapter`, so a discovered species stays hatchable
from the dex alone.

**Creatures that predate the rite** are not orphaned: `bless <key>` runs the
rite over an existing record. The identity and genome never change; the seal
carries `blessed: true` and the lineage records who attested it — an honest
record of a birth witnessed late rather than a pretended one.

## 16. Anchored births (a creature born of a thing)

A hatch may be **anchored** to something the keeper found worth keeping: a
journal entry, a photo, a clip, a link, or a line of text
(`hatch <species> --anchor <path|text> [--anchor-title …]`).

- The artifact's sha256 seeds the genome, so the thing it came from is visible
  in what the creature *looks like* — two creatures of the same species born of
  different artifacts are visibly different individuals.
- The birth records an `rappid-anchor/1` block: `kind` (journal / image / video
  / audio / document / link / note / artifact), `sha256`, `title`, `bytes`.
  The **bytes never travel** — only the digest, kind, and title. Any local
  pointer is kept outside the record's shareable fields.
- **One creature per anchor**: hatching the same artifact again returns the
  creature already born of it rather than minting a rival.
- The anchor stays in the creature's lineage: its birth frame (§15) carries it,
  so no amount of growth or molting loses what it was born of.

An anchored creature is its own individual even within its species — it is
named for its artifact and identified separately from the host's default one.

## 15. Frames, mutation, and the reunion molt

A rappid is not fixed. What it **is** at any moment is a fold over its
**frames** — its birth, then everything it has earned since. The form is never
stored as a second truth that could disagree with the frames; it is recomputed,
so it cannot drift.

- **A frame** (`rappid-frame/1`) is identified by the sha256 of its content, so
  merging the same frame twice still yields one frame. Frames live append-only
  beside the creature in `frames.jsonl`.
- **Mutation** (`mutate <key> <kind> [note]`) is how a creature grows from what
  it meets: `success`, `alert`, `greeting`, `focus`, `recovery`. Each grants a
  **sound role**, and its motif is derived from that creature's *own birth
  motif* — a rappid that grows still sounds like itself, never like a stock
  sample. A creature with no sealed birth cannot mutate (§12): there is nothing
  to grow from.
- **Dimensions.** The desk copy and the companion copy are two dimensions of
  one creature. Out in the field, offline, the companion's dimension earns
  frames the desk one never sees — that is the point, not a sync failure.
- **The reunion molt** (`molt <key> [document]`, and automatically on
  `party import`) unions the two frame sets, orders them deterministically
  (birth first, then timestamp, then frame id), and folds. It is idempotent and
  order-independent: both dimensions come out of the molt with the same
  `molt_id`, the same voices, and neither loses what it learned alone. The fold
  records every host the creature has lived on.
- Frames travel inside `rappid-party-transfer/1`, so carrying a party out and
  bringing it home is all the sync there is. `frames <key>` shows the lineage.

This is how diversity accumulates: same starting species, different lives.

## 14. Compliance checklist

1. PRNG + genome_id reproduce the test vectors byte-exactly.
0. A hatch with no valid birth seal writes NO record (§12).
2. Identity is Eternity-form rapp/1; hash from a fresh UUID; re-hatch idempotent.
3. Eggs round-trip through the reference fauna viewer unchanged (`id` verifies).
4. Unknown species import as `wild`, never rejected.
5. Cries: one per species; accent derived only from `genome_id`.
6. Records never contain secrets, tokens, or PII. Eggs are shareable by design.
7. Birth seals re-verify from the record alone; birth transcripts stay out of eggs.
8. Every rite appends one ledger line, sealed or refused.
9. Merging frames is idempotent and order-independent; the fold is recomputed, never stored as truth (§15).

*RAPPid Zoo · kody-w/rappid · MIT*
