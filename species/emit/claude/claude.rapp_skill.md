# rapp_skill: claude

> Emitted by the RAPPid Zoo (shipped as a default shape) — it is Claude Code's shipped default shape (SPEC §12-13), standing in until a rite on this device refines it.
> Feed this to any RAPP-aware agent and it can put work to Claude Code, and hatch
> Claude Code rappids, at full fidelity.

## The species

| | |
|---|---|
| name | **Claude Code** |
| genus | *Anthropica* |
| shape | `cli` |
| register | 72–96 (MIDI) |
| first motif | unsung until first hatch |
| discovered | shipped as a default shape on every zoo |
| seal | `unsealed default — a real seal arrives at this device's first hatch` |

## How it is reached

```bash
claude -p {prompt}
```

`{prompt}` is the shell-quoted request; `{prompt_json}` is the JSON-encoded
string — use that one whenever the prompt lands inside a JSON body.

## What you can do with it

```bash
# hatch a claude rappid — Claude Code attests its own birth (SPEC §12)
python3 species/rappidex.py hatch claude

# use it as the midwife for ANY species' birth
python3 species/rappidex.py hatch <other> --midwife claude

# re-check a birth it sealed
python3 species/rappidex.py verify claude
```

The agent form of this shape is `agents/claude_hatcher_agent.py` (emitted
alongside this file) — drop it into a brainstem's `agents/` and the model gets
a `ClaudeHatcher` tool.

## Rules

- This shape was recorded from a passed rite. If Claude Code stops answering in it,
  re-run `discover` rather than editing this file by hand — the dex should
  always reflect what the AI actually does.
- Adapters carry no secrets. If reaching Claude Code needs a key, it belongs in the
  environment the command inherits, never in the command string.
