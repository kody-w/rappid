"""
brainstem_hatcher_agent.py — RAPP agent for the Brainstem species.

Emitted by the RAPPid Zoo (shipped as a default shape, every zoo).
The shape below is not guessed: it is Brainstem's shipped default shape (SPEC §12-13), standing in until a rite on this device refines it — http, register 24-48,
first motif unsung until first hatch.

Hotload this file (drop into ~/.brainstem/agents/, or load it directly) and
the model gets a tool called BrainstemHatcher that puts work to Brainstem through that
exact shape, and can attest births with it — no re-feeding a skill, no
rediscovery. Rappids it hatches live under $RAPP_HOME/rappids/ and can join
the active party (rappid-party/1).
"""
from __future__ import annotations

import json
import os
import shlex
import subprocess

try:
    from agents.basic_agent import BasicAgent
except ImportError:
    from basic_agent import BasicAgent

__manifest__ = {
    "schema": "rapp-agent/1.0",
    "name": "@rappid/brainstem-hatcher",
    "version": "1.0.0",
    "display_name": "Brainstem Hatcher",
    "description": (
        "Speaks to Brainstem in the shape it answered in during its rite, and can "
        "attest RAPPid births as its midwife."
    ),
    "author": "RAPPid Zoo",
    "tags": ["rappid", "hatcher", "midwife", "brainstem"],
    "category": "platform",
    "requires_env": [],
    "dependencies": ["@rapp/basic_agent"],
    "external_prereqs": ["brainstem"],
    "example_call": "Ask Brainstem to summarize this, or attest a birth as midwife.",
}

# The species' locked-in shape.
SPECIES_SHAPE = {
    "command": "python3 -c 'import json,sys,urllib.request;r=urllib.request.urlopen(urllib.request.Request(\"http://127.0.0.1:7071/chat\",json.dumps({\"user_input\":json.loads(sys.argv[1])}).encode(),{\"Content-Type\":\"application/json\"}),timeout=240);print(json.load(r).get(\"response\",\"\"))' {prompt_json}",
    "shape": "http",
    "model": "brainstem",
    "timeout": 260
}


class BrainstemHatcher(BasicAgent):
    def __init__(self):
        self.name = "BrainstemHatcher"
        self.metadata = {
            "name": self.name,
            "description": __manifest__["description"],
            "parameters": {
                "type": "object",
                "properties": {
                    "prompt": {"type": "string", "description": "what to put to Brainstem"},
                    "timeout": {"type": "integer", "description": "seconds (default 260)"},
                },
                "required": ["prompt"],
            },
        }
        super().__init__(name=self.name, metadata=self.metadata)

    def perform(self, prompt="", timeout=None, **kwargs):
        if not prompt:
            return "Nothing to put to Brainstem."
        command = (SPECIES_SHAPE["command"]
                   .replace("{prompt_json}", shlex.quote(json.dumps(prompt)))
                   .replace("{prompt}", shlex.quote(prompt)))
        try:
            proc = subprocess.run(command, shell=True, capture_output=True, text=True,
                                  timeout=timeout or SPECIES_SHAPE.get("timeout", 260))
        except subprocess.TimeoutExpired:
            return "Brainstem did not answer in time."
        except OSError as e:
            return f"Brainstem could not be reached: {e}"
        out = (proc.stdout or "").strip() or (proc.stderr or "").strip()
        return out or "(Brainstem answered with nothing.)"
