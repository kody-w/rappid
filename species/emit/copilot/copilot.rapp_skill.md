# rapp_skill: copilot

> Emitted by the RAPPid Zoo (shipped as a default shape) — it is GitHub Copilot's shipped default shape (SPEC §12-13), standing in until a rite on this device refines it.
> Feed this to any RAPP-aware agent and it can put work to GitHub Copilot, and hatch
> GitHub Copilot rappids, at full fidelity.

## The species

| | |
|---|---|
| name | **GitHub Copilot** |
| genus | *Machina* |
| shape | `cli` |
| register | 60–84 (MIDI) |
| first motif | unsung until first hatch |
| discovered | shipped as a default shape on every zoo |
| seal | `unsealed default — a real seal arrives at this device's first hatch` |

## How it is reached

```bash
copilot -p {prompt} --allow-all-tools
```

`{prompt}` is the shell-quoted request; `{prompt_json}` is the JSON-encoded
string — use that one whenever the prompt lands inside a JSON body.

## What you can do with it

```bash
# hatch a copilot rappid — GitHub Copilot attests its own birth (SPEC §12)
python3 species/rappidex.py hatch copilot

# use it as the midwife for ANY species' birth
python3 species/rappidex.py hatch <other> --midwife copilot

# re-check a birth it sealed
python3 species/rappidex.py verify copilot
```

The agent form of this shape is `agents/copilot_hatcher_agent.py` (emitted
alongside this file) — drop it into a brainstem's `agents/` and the model gets
a `CopilotHatcher` tool.

## Rules

- This shape was recorded from a passed rite. If GitHub Copilot stops answering in it,
  re-run `discover` rather than editing this file by hand — the dex should
  always reflect what the AI actually does.
- Adapters carry no secrets. If reaching GitHub Copilot needs a key, it belongs in the
  environment the command inherits, never in the command string.
