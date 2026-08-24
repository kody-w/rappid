# rapp_skill: brainstem

> Emitted by the RAPPid Zoo (shipped as a default shape) — it is Brainstem's shipped default shape (SPEC §12-13), standing in until a rite on this device refines it.
> Feed this to any RAPP-aware agent and it can put work to Brainstem, and hatch
> Brainstem rappids, at full fidelity.

## The species

| | |
|---|---|
| name | **Brainstem** |
| genus | *Truncus* |
| shape | `http` |
| register | 24–48 (MIDI) |
| first motif | unsung until first hatch |
| discovered | shipped as a default shape on every zoo |
| seal | `unsealed default — a real seal arrives at this device's first hatch` |

## How it is reached

```bash
python3 -c 'import json,sys,urllib.request;r=urllib.request.urlopen(urllib.request.Request("http://127.0.0.1:7071/chat",json.dumps({"user_input":json.loads(sys.argv[1])}).encode(),{"Content-Type":"application/json"}),timeout=240);print(json.load(r).get("response",""))' {prompt_json}
```

`{prompt}` is the shell-quoted request; `{prompt_json}` is the JSON-encoded
string — use that one whenever the prompt lands inside a JSON body.

## What you can do with it

```bash
# hatch a brainstem rappid — Brainstem attests its own birth (SPEC §12)
python3 species/rappidex.py hatch brainstem

# use it as the midwife for ANY species' birth
python3 species/rappidex.py hatch <other> --midwife brainstem

# re-check a birth it sealed
python3 species/rappidex.py verify brainstem
```

The agent form of this shape is `agents/brainstem_hatcher_agent.py` (emitted
alongside this file) — drop it into a brainstem's `agents/` and the model gets
a `BrainstemHatcher` tool.

## Rules

- This shape was recorded from a passed rite. If Brainstem stops answering in it,
  re-run `discover` rather than editing this file by hand — the dex should
  always reflect what the AI actually does.
- Adapters carry no secrets. If reaching Brainstem needs a key, it belongs in the
  environment the command inherits, never in the command string.
