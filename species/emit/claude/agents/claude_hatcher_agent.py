"""
claude_hatcher_agent.py — RAPP agent for the Claude Code species.

Emitted by the RAPPid Zoo (shipped as a default shape, every zoo).
The shape below is not guessed: it is Claude Code's shipped default shape (SPEC §12-13), standing in until a rite on this device refines it — cli, register 72-96,
first motif unsung until first hatch.

Hotload this file (drop into ~/.brainstem/agents/, or load it directly) and
the model gets a tool called ClaudeHatcher that puts work to Claude Code through that
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
    "name": "@rappid/claude-hatcher",
    "version": "1.0.0",
    "display_name": "Claude Code Hatcher",
    "description": (
        "Speaks to Claude Code in the shape it answered in during its rite, and can "
        "attest RAPPid births as its midwife."
    ),
    "author": "RAPPid Zoo",
    "tags": ["rappid", "hatcher", "midwife", "claude"],
    "category": "platform",
    "requires_env": [],
    "dependencies": ["@rapp/basic_agent"],
    "external_prereqs": ["claude"],
    "example_call": "Ask Claude Code to summarize this, or attest a birth as midwife.",
}

# The species' locked-in shape.
SPECIES_SHAPE = {
    "command": "claude -p {prompt}",
    "shape": "cli",
    "model": "claude",
    "timeout": 180,
    "default": true
}


class ClaudeHatcher(BasicAgent):
    def __init__(self):
        self.name = "ClaudeHatcher"
        self.metadata = {
            "name": self.name,
            "description": __manifest__["description"],
            "parameters": {
                "type": "object",
                "properties": {
                    "prompt": {"type": "string", "description": "what to put to Claude Code"},
                    "timeout": {"type": "integer", "description": "seconds (default 180)"},
                },
                "required": ["prompt"],
            },
        }
        super().__init__(name=self.name, metadata=self.metadata)

    def perform(self, prompt="", timeout=None, **kwargs):
        if not prompt:
            return "Nothing to put to Claude Code."
        command = (SPECIES_SHAPE["command"]
                   .replace("{prompt_json}", shlex.quote(json.dumps(prompt)))
                   .replace("{prompt}", shlex.quote(prompt)))
        try:
            proc = subprocess.run(command, shell=True, capture_output=True, text=True,
                                  timeout=timeout or SPECIES_SHAPE.get("timeout", 180))
        except subprocess.TimeoutExpired:
            return "Claude Code did not answer in time."
        except OSError as e:
            return f"Claude Code could not be reached: {e}"
        out = (proc.stdout or "").strip() or (proc.stderr or "").strip()
        return out or "(Claude Code answered with nothing.)"
