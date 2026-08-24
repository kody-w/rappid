# rappidex/1 — the RAPPid Zoo species protocol

*The species layer of [RAPPid Zoo](README.md) (`kody-w/rapp-zoo-v2`).*

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

- **One cry per species** — as recognizable as a Pokémon's call. Reference cries
  ship in `~/.pokedex/cries/*.wav` (synthesized by `gen_cries.py`; ~0.5–1.2 s).
- **Individual accent**: playback rate `0.94 + r()*0.14` and volume `0.75 + r()*0.25`
  where `r = mkRng(genome_id)`. Same creature, same accent, every time, everywhere.
- **When to cry**: on **invoke** (announce), on **done** (chirp), and the shared
  `_hatch` fanfare + first cry at hatch. Eyes-off operators identify agents by ear.

## 7. Lifecycle verbs

| verb | contract |
|---|---|
| `hatch <species>` | mint genome (seed = `rappid:<species>:<host>:<nonce>`), mint rapp/1 identity, persist record + egg, play fanfare + cry. Idempotent per (species, host). |
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

## 9. Compliance checklist

1. PRNG + genome_id reproduce the test vectors byte-exactly.
2. Identity is Eternity-form rapp/1; hash from a fresh UUID; re-hatch idempotent.
3. Eggs round-trip through the reference fauna viewer unchanged (`id` verifies).
4. Unknown species import as `wild`, never rejected.
5. Cries: one per species; accent derived only from `genome_id`.
6. Records never contain secrets, tokens, or PII. Eggs are shareable by design.

*RAPPid Zoo · kody-w/rapp-zoo-v2 · MIT*
