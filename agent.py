"""
agent.py — RAPPid Zoo as a single-file RAPP agent cartridge.

Drop into ~/.brainstem/agents/ (with species/rappidex.py importable, or set
RAPPIDZOO_ENGINE to its path). Restart the brainstem. The model gets one tool,
`RappidZoo`, and can then hatch, roar, list, export, import, convert, and fuse
the AI creatures on this machine from chat:

    User:  "hatch a copilot and fuse it with my claude"
    Model: <RappidZoo(action="hatch", species="copilot")>
           <RappidZoo(action="fuse", a="copilot", b="claude")>

Protocol: SPEC.md (rappidex/1) in kody-w/rappid.
"""
from __future__ import annotations

import importlib.util
import io
import json
import os
import sys
from contextlib import redirect_stdout

try:
    from agents.basic_agent import BasicAgent
except ImportError:
    from basic_agent import BasicAgent

__manifest__ = {
    "schema": "rapp-agent/1.0",
    "name": "@kody-w/rappid-zoo",
    "version": "1.0.0",
    "display_name": "RAPPid Zoo",
    "description": ("Species identity for every AI on the machine: hatch rapp/1 "
                    "rappids with unique species cries, export/import portable "
                    "eggs, convert between species, fuse ancestors into new "
                    "creatures, render the holodex."),
    "author": "Kody Wildfeuer",
    "tags": ["rappid", "zoo", "species", "identity", "eggs"],
    "category": "platform",
    "requires_env": [],
    "dependencies": ["@rapp/basic_agent"],
    "external_prereqs": [],
    "example_call": "Hatch a rappid for Copilot and play its call.",
}


def _load_engine():
    override = os.environ.get("RAPPIDZOO_ENGINE")
    candidates = [override] if override else []
    here = os.path.dirname(os.path.abspath(__file__))
    candidates += [
        os.path.join(here, "species", "rappidex.py"),
        os.path.join(here, "rappidex.py"),
        os.path.expanduser("~/.rappidex/rappidex.py"),
    ]
    for c in candidates:
        if c and os.path.exists(c):
            spec = importlib.util.spec_from_file_location("rappidex", c)
            mod = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(mod)
            return mod
    raise ImportError("rappidex.py not found — clone kody-w/rappid or set RAPPIDZOO_ENGINE")


class RappidZoo(BasicAgent):
    def __init__(self):
        self.name = "RappidZoo"
        self.metadata = {
            "name": self.name,
            "description": __manifest__["description"],
            "parameters": {
                "type": "object",
                "properties": {
                    "action": {"type": "string",
                               "enum": ["hatch", "roar", "list", "show", "export",
                                        "import", "convert", "fuse", "holodex", "shape"],
                               "description": "lifecycle verb (SPEC.md §7)"},
                    "species": {"type": "string", "description": "species name (hatch/roar) or target species (convert/fuse)"},
                    "key": {"type": "string", "description": "species|genome-id (show/export/convert)"},
                    "a": {"type": "string", "description": "first parent (fuse)"},
                    "b": {"type": "string", "description": "second parent (fuse)"},
                    "path": {"type": "string", "description": "egg file path (import) or output path (export)"},
                },
                "required": ["action"],
            },
        }
        super().__init__(name=self.name, metadata=self.metadata)

    def perform(self, action="", species="", key="", a="", b="", path="", **kwargs):
        rx = _load_engine()
        os.makedirs(rx.RAPPIDS, exist_ok=True)
        buf = io.StringIO()
        try:
            with redirect_stdout(buf):
                if action == "hatch":
                    rec, born = rx.cmd_hatch(species)
                    if not born:
                        print(f"{rec['display_name']} already lives here — {rec['rappid']}")
                elif action == "roar":
                    rx.cmd_roar(species or key)
                    print(f"the {species or key} call sounds across the zoo")
                elif action == "list":
                    rx.cmd_list()
                elif action == "show":
                    rx.cmd_show(key or species)
                elif action == "export":
                    rx.cmd_export(key or species, path or None)
                elif action == "import":
                    rx.cmd_import(path)
                elif action == "convert":
                    rx.cmd_convert(key, species)
                elif action == "fuse":
                    rx.cmd_fuse(a, b, species or None)
                elif action == "holodex":
                    rx.cmd_holodex(open_it=False)
                elif action == "shape":
                    # resolve the hotloadable agent.py for a species — drop it
                    # into agents/ (or load it in place) and speak to that
                    # species directly; no re-feeding, no rediscovery
                    rx.cmd_shape(species or key)
                else:
                    return f"Unknown action '{action}'. Verbs: hatch roar list show export import convert fuse holodex shape."
        except SystemExit as e:
            return f"RappidZoo refused: {e}"
        return buf.getvalue().strip() or "done"
