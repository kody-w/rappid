"""
copilot_hatcher_agent.py — RAPP agent for the GitHub Copilot species.

Emitted by the RAPPid Zoo (shipped as a default shape, every zoo).
The shape below is not guessed: it is GitHub Copilot's shipped default shape (SPEC §12-13), standing in until a rite on this device refines it — cli, register 60-84,
first motif unsung until first hatch.

Hotload this file (drop into ~/.brainstem/agents/, or load it directly) and
the model gets a tool called CopilotHatcher that puts work to GitHub Copilot through that
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
    "name": "@rappid/copilot-hatcher",
    "version": "1.0.0",
    "display_name": "GitHub Copilot Hatcher",
    "description": (
        "Speaks to GitHub Copilot in the shape it answered in during its rite, and can "
        "attest RAPPid births as its midwife."
    ),
    "author": "RAPPid Zoo",
    "tags": ["rappid", "hatcher", "midwife", "copilot"],
    "category": "platform",
    "requires_env": [],
    "dependencies": ["@rapp/basic_agent"],
    "external_prereqs": ["gh-copilot"],
    "example_call": "Ask GitHub Copilot to summarize this, or attest a birth as midwife.",
}

# The species' locked-in shape.
SPECIES_SHAPE = {
    "command": "copilot -p {prompt} --allow-all-tools",
    "shape": "cli",
    "model": "gh-copilot",
    "timeout": 240
}


class CopilotHatcher(BasicAgent):
    def __init__(self):
        self.name = "CopilotHatcher"
        self.metadata = {
            "name": self.name,
            "description": __manifest__["description"],
            "parameters": {
                "type": "object",
                "properties": {
                    "prompt": {"type": "string", "description": "what to put to GitHub Copilot"},
                    "timeout": {"type": "integer", "description": "seconds (default 240)"},
                },
                "required": ["prompt"],
            },
        }
        super().__init__(name=self.name, metadata=self.metadata)

    def perform(self, prompt="", timeout=None, **kwargs):
        if not prompt:
            return "Nothing to put to GitHub Copilot."
        command = (SPECIES_SHAPE["command"]
                   .replace("{prompt_json}", shlex.quote(json.dumps(prompt)))
                   .replace("{prompt}", shlex.quote(prompt)))
        try:
            proc = subprocess.run(command, shell=True, capture_output=True, text=True,
                                  timeout=timeout or SPECIES_SHAPE.get("timeout", 240))
        except subprocess.TimeoutExpired:
            return "GitHub Copilot did not answer in time."
        except OSError as e:
            return f"GitHub Copilot could not be reached: {e}"
        out = (proc.stdout or "").strip() or (proc.stderr or "").strip()
        return out or "(GitHub Copilot answered with nothing.)"
