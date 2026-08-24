#!/usr/bin/env python3
"""
rappid_skin.py — a RAPPid "skin": rapp(wrap) any third-party AI so it plays
nicely in the RAPPid Zoo.

A skin gives an AI three things it doesn't have on its own:

  1. A SPECIES IDENTITY — first launch hatches a rapp/1 rappid for the wrapped
     AI (see SPEC.md); its cry plays on every invoke and every completed answer,
     so the operator can tell WHO is talking with their eyes closed.
  2. THE ZOO SEAM — the exact RAPP/1 neighborhood contract the Zoo attaches to:
        POST /chat  {user_input, session_id?, idempotency_key?}
                 -> 200 {response, agent_logs, session_id}   (exactly)
                 -> 422 {error: {code, step}}                (exactly)
        GET  /health -> {status: "ok"}
  3. NEUTRALITY — the Zoo never special-cases a provider; the skin is the
     provider-specific part, outside the Zoo, per the estate doctrine.

Usage:
    python3 skins/rappid_skin.py --species claude --port 7181 \
        --command 'claude -p {prompt}'
    python3 skins/rappid_skin.py --species copilot --port 7182   # from skins.json

`{prompt}` is replaced with the user_input, shell-quoted for an argv slot.
`{prompt_json}` is replaced with the JSON-encoded string — use that one whenever
the prompt lands inside a JSON body, because shell quoting is not JSON quoting.
With no --command, the species entry in skins.json supplies it. Stdlib only.
"""
import argparse
import json
import os
import shlex
import subprocess
import sys
import threading
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(os.path.dirname(HERE), "species"))
import rappidex  # the species engine


def load_registry():
    p = os.path.join(HERE, "skins.json")
    if os.path.exists(p):
        with open(p) as f:
            return json.load(f)
    return {}


class Skin:
    def __init__(self, species, command, timeout=300):
        self.species = species
        self.command = command
        self.timeout = timeout
        self.rec, hatched = rappidex.cmd_hatch(species, quiet=True)
        if self.rec is None:
            raise SystemExit(
                f"✋ '{species}' has no rappid on this device and none could be hatched — "
                "the rite needs an LLM to attest the birth (SPEC §12). Add an adapter to "
                "species/hatchers.json, or point RAPPID_HATCHERS/RAPPID_MIDWIFE at one.")
        if hatched:
            rappidex.play_hatch_fanfare(self.rec)
        self.sessions = {}

    def chat(self, user_input, session_id):
        rappidex.play_cry(self.rec)                      # announce: the species call
        cmd = (self.command
               .replace("{prompt_json}", shlex.quote(json.dumps(user_input)))
               .replace("{prompt}", shlex.quote(user_input)))
        try:
            proc = subprocess.run(cmd, shell=True, capture_output=True,
                                  text=True, timeout=self.timeout)
        except subprocess.TimeoutExpired:
            return 422, {"error": {"code": "unknown-session", "step": None}}
        rappidex.play_cry(self.rec)                      # done: the chirp
        out = (proc.stdout or "").strip() or (proc.stderr or "").strip()
        logs = [f"rappid_skin species={self.species} rappid={self.rec['rappid']}",
                f"command exit={proc.returncode}"]
        return 200, {"response": out, "agent_logs": logs, "session_id": session_id}


def make_handler(skin):
    class H(BaseHTTPRequestHandler):
        def log_message(self, *a):  # quiet
            pass

        def _send(self, status, obj):
            body = json.dumps(obj).encode()
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def do_GET(self):
            if self.path == "/health":
                self._send(200, {"status": "ok"})
            elif self.path == "/rappid":
                pub = {k: v for k, v in skin.rec.items() if k not in ("egg", "genome")}
                self._send(200, pub)
            else:
                self._send(404, {"error": {"code": "unknown-session", "step": None}})

        def do_POST(self):
            if self.path != "/chat":
                self._send(404, {"error": {"code": "unknown-session", "step": None}})
                return
            try:
                n = int(self.headers.get("Content-Length", "0"))
                payload = json.loads(self.rfile.read(n) or b"{}")
                allowed = {"user_input", "session_id", "idempotency_key"}
                if not isinstance(payload, dict) or set(payload) - allowed \
                        or not isinstance(payload.get("user_input"), str):
                    raise ValueError
            except Exception:
                self._send(422, {"error": {"code": "unknown-session", "step": None}})
                return
            sid = payload.get("session_id") or uuid.uuid4().hex
            status, obj = skin.chat(payload["user_input"], sid)
            self._send(status, obj)
    return H


def main():
    ap = argparse.ArgumentParser(prog="rappid_skin")
    ap.add_argument("--species", required=True)
    ap.add_argument("--port", type=int, required=True)
    ap.add_argument("--command", help="shell template; {prompt} = the user_input")
    ap.add_argument("--timeout", type=int, default=300)
    a = ap.parse_args()
    reg = load_registry()
    command = a.command or (reg.get(a.species) or {}).get("command")
    if not command:
        sys.exit(f"no command for species '{a.species}' — pass --command or add to skins.json")
    skin = Skin(a.species, command, a.timeout)
    srv = ThreadingHTTPServer(("127.0.0.1", a.port), make_handler(skin))
    print(f"🦎 {skin.rec['display_name']} skinned on http://127.0.0.1:{a.port} "
          f"({a.species} → `{command}`)")
    print(f"   {skin.rec['rappid']}")
    srv.serve_forever()


if __name__ == "__main__":
    main()
