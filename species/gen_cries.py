#!/usr/bin/env python3
"""
gen_cries.py — synthesize the AI species calls of the RAPPid Zoo.

Each AI on this machine is a species. Each species has ONE cry, unique in timbre,
pitch contour, and rhythm, so it can be identified by ear alone with no screen.

Run:  python3 species/gen_cries.py
Out:  $RAPPIDEX_HOME/cries/<species>.wav (default ~/.rappidex)
"""
import json
import math
import os
import struct
import wave

import numpy as np

SR = 44100
_HOME = os.environ.get("RAPPIDEX_HOME") or os.path.expanduser("~/.rappidex")
OUT = os.path.join(_HOME, "cries")


# ---------------------------------------------------------------- primitives
def env_bp(dur, points):
    """Breakpoint envelope. points = [(t_frac, value), ...] linear between."""
    n = int(dur * SR)
    t = np.linspace(0, 1, n)
    ts = np.array([p[0] for p in points])
    vs = np.array([p[1] for p in points])
    return np.interp(t, ts, vs)


def glide(dur, points, expo=True):
    """Pitch contour in Hz. Exponential interpolation = musical glide."""
    if expo:
        n = int(dur * SR)
        t = np.linspace(0, 1, n)
        ts = np.array([p[0] for p in points])
        vs = np.log(np.array([p[1] for p in points], dtype=float))
        return np.exp(np.interp(t, ts, vs))
    return env_bp(dur, points)


def osc(freq, shape="sine", duty=0.5, phase0=0.0):
    """Phase-accumulating oscillator over a per-sample frequency array."""
    ph = np.cumsum(2 * np.pi * freq / SR) + phase0
    if shape == "sine":
        return np.sin(ph)
    if shape == "square":
        return np.sign(np.sin(ph))
    if shape == "saw":
        return 2.0 * ((ph / (2 * np.pi)) % 1.0) - 1.0
    if shape == "tri":
        return 2.0 / np.pi * np.arcsin(np.clip(np.sin(ph), -1, 1))
    if shape == "pulse":
        return np.where(((ph / (2 * np.pi)) % 1.0) < duty, 1.0, -1.0)
    raise ValueError(shape)


def svf_bandpass(x, fc, q=4.0):
    """Time-varying 2-pole state-variable bandpass. fc: scalar or per-sample."""
    n = len(x)
    fc = np.full(n, fc, dtype=float) if np.isscalar(fc) else np.asarray(fc, dtype=float)
    f = 2.0 * np.sin(np.pi * np.clip(fc, 20, SR * 0.45) / SR)
    damp = 1.0 / q
    lp = bp = 0.0
    out = np.empty(n)
    for i in range(n):
        hp = x[i] - lp - damp * bp
        bp += f[i] * hp
        lp += f[i] * bp
        out[i] = bp
    return out


def noise(n, seed):
    return np.random.default_rng(seed).uniform(-1, 1, n)


def softclip(x, drive=2.0):
    return np.tanh(x * drive) / np.tanh(drive)


def bitcrush(x, bits=5, hold_sr=8000):
    step = 2.0 ** bits
    hold = max(1, int(SR / hold_sr))
    y = np.repeat(x[::hold], hold)[: len(x)]
    if len(y) < len(x):
        y = np.pad(y, (0, len(x) - len(y)), mode="edge")
    return np.round(y * step) / step


def echo(x, delay_s, feedback, taps=3, wet=0.5):
    d = int(delay_s * SR)
    y = x.copy()
    for k in range(1, taps + 1):
        g = wet * (feedback ** k)
        shifted = np.zeros_like(x)
        if d * k < len(x):
            shifted[d * k:] = x[: len(x) - d * k]
        y += g * shifted
    return y


def place(buf, sig, at_s, gain=1.0):
    i = int(at_s * SR)
    n = min(len(sig), len(buf) - i)
    if n > 0:
        buf[i:i + n] += gain * sig[:n]
    return buf


def finish(x, peak=0.86, fade_ms=6):
    f = int(SR * fade_ms / 1000)
    x = x.astype(float)
    if f * 2 < len(x):
        x[:f] *= np.linspace(0, 1, f)
        x[-f:] *= np.linspace(1, 0, f)
    m = np.max(np.abs(x)) or 1.0
    return x / m * peak


def write(name, x):
    path = os.path.join(OUT, f"{name}.wav")
    pcm = (np.clip(x, -1, 1) * 32767).astype("<i2")
    with wave.open(path, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(pcm.tobytes())
    return path


# ------------------------------------------------------------------ species
def cry_brainstem():
    """BRAINSTEM — the ancient one. Deep two-syllable reptilian growl, falling."""
    dur = 1.05
    n = int(dur * SR)
    f = glide(dur, [(0, 62), (0.05, 118), (0.30, 104), (0.60, 92),
                    (0.66, 99), (0.85, 78), (1.0, 66)])
    vib = 1.0 + 0.035 * np.sin(2 * np.pi * 5.4 * np.arange(n) / SR)
    f = f * vib
    body = 0.75 * osc(f, "saw") + 0.55 * osc(f / 2, "sine") + 0.18 * osc(f * 2, "tri")
    grit = svf_bandpass(noise(n, 11), fc=np.clip(f * 5, 250, 1400), q=3.0)
    x = body + 0.30 * grit
    growl = 1.0 - 0.42 * (0.5 + 0.5 * np.sin(2 * np.pi * 33 * np.arange(n) / SR))
    x *= growl
    x = softclip(x, 2.2)
    amp = env_bp(dur, [(0, 0), (0.03, 1.0), (0.45, 0.92), (0.60, 0.75),
                       (0.645, 0.10), (0.68, 0.95), (0.88, 0.55), (1.0, 0.0)])
    return finish(x * amp)


def cry_claude():
    """CLAUDE CODE — the spark. Clean crystalline three-note ascent + shimmer."""
    dur = 0.72
    buf = np.zeros(int(dur * SR))

    def ping(f0, f1, d, decay):
        f = glide(d, [(0, f0), (0.18, f1), (1.0, f1)])
        n = int(d * SR)
        s = (osc(f, "sine")
             + 0.26 * osc(f * 3, "sine")
             + 0.10 * osc(f * 5, "sine")
             + 0.05 * osc(f * 8, "sine"))
        a = env_bp(d, [(0, 0), (0.012, 1.0), (0.35, 0.55), (1.0, 0.0)]) * np.exp(
            -np.linspace(0, decay, n))
        return s * a

    buf = place(buf, ping(624, 659.3, 0.16, 3.4), 0.00, 0.85)   # E5
    buf = place(buf, ping(940, 987.8, 0.16, 3.4), 0.115, 0.90)  # B5
    buf = place(buf, ping(1255, 1318.5, 0.34, 2.6), 0.23, 1.0)  # E6

    tail_d = 0.40
    nt = int(tail_d * SR)
    tvib = 1.0 + 0.010 * np.sin(2 * np.pi * 6.5 * np.arange(nt) / SR)
    tail = (0.55 * osc(np.full(nt, 1318.5) * tvib, "sine")
            + 0.28 * osc(np.full(nt, 1976.0) * tvib, "sine")
            + 0.12 * osc(np.full(nt, 2637.0), "sine"))
    tail *= np.exp(-np.linspace(0, 5.0, nt))
    buf = place(buf, tail, 0.30, 0.42)
    return finish(buf)


def cry_copilot():
    """COPILOT — the machine. Stepped square-wave boops, down then back up. Dry."""
    dur = 0.46
    buf = np.zeros(int(dur * SR))

    def boop(hz, d, duty=0.32):
        n = int(d * SR)
        s = osc(np.full(n, hz), "pulse", duty=duty)
        s += 0.22 * osc(np.full(n, hz * 2), "square")
        a = env_bp(d, [(0, 0), (0.008, 1.0), (0.80, 1.0), (1.0, 0.0)])
        return bitcrush(s * a, bits=5, hold_sr=7350)

    buf = place(buf, boop(784.0, 0.115), 0.00, 0.85)   # G5
    buf = place(buf, boop(523.3, 0.115), 0.145, 0.85)  # C5
    buf = place(buf, boop(784.0, 0.150), 0.290, 0.95)  # G5
    return finish(buf * 0.98)


def cry_rappterbot():
    """RAPPTERBOT — the raptor. Aggressive rising screech with a downward snap."""
    dur = 0.78
    n = int(dur * SR)
    f = glide(dur, [(0, 400), (0.30, 1480), (0.42, 1560), (0.62, 1430),
                    (0.80, 620), (1.0, 300)])
    vib = 1.0 + 0.075 * np.sin(2 * np.pi * 23 * np.arange(n) / SR)
    f = f * vib
    body = osc(f, "saw") + 0.35 * osc(f * 1.5, "square")
    scr = svf_bandpass(noise(n, 7), fc=np.clip(f * 1.6, 300, 9000), q=6.0)
    x = 0.62 * body + 0.85 * scr
    x *= 1.0 - 0.26 * (0.5 + 0.5 * np.sin(2 * np.pi * 61 * np.arange(n) / SR))
    x = softclip(x, 4.0)
    amp = env_bp(dur, [(0, 0), (0.015, 1.0), (0.55, 0.95), (0.78, 0.85),
                       (0.92, 0.40), (1.0, 0.0)])
    return finish(x * amp)


def cry_openrappter():
    """OPENRAPPTER — same raptor genus, open-winged. Call, then a lower answer, echoing."""
    dur = 1.18
    buf = np.zeros(int(dur * SR))

    def cry(f0, fp, f1, d, seed, drive, vibhz, vibd, noise_mix):
        nn = int(d * SR)
        f = glide(d, [(0, f0), (0.28, fp), (0.60, fp * 0.97), (1.0, f1)])
        f = f * (1.0 + vibd * np.sin(2 * np.pi * vibhz * np.arange(nn) / SR))
        body = osc(f, "saw") + 0.30 * osc(f * 2, "tri")
        air = svf_bandpass(noise(nn, seed), fc=np.clip(f * 1.9, 300, 9000), q=4.0)
        s = softclip(0.8 * body + noise_mix * air, drive)
        a = env_bp(d, [(0, 0), (0.03, 1.0), (0.55, 0.90), (0.85, 0.55), (1.0, 0.0)])
        return s * a

    buf = place(buf, cry(660, 1265, 1055, 0.34, 5, 2.0, 12.0, 0.042, 0.60), 0.00, 1.0)
    buf = place(buf, cry(500, 905, 775, 0.30, 9, 1.7, 10.0, 0.036, 0.55), 0.44, 0.58)

    nn = len(buf)
    shimmer = svf_bandpass(noise(nn, 21), fc=4200, q=1.2)
    shimmer *= env_bp(dur, [(0, 0), (0.10, 0.35), (0.45, 0.20), (1.0, 0.0)])
    buf = buf + 0.10 * shimmer

    buf = echo(buf, delay_s=0.155, feedback=0.44, taps=3, wet=0.55)
    return finish(buf)


SPECIES = [
    ("brainstem",   "Brainstem",        "The ancient one. Deep two-syllable reptilian growl, falling.",        cry_brainstem),
    ("claude",      "Claude Code",      "The spark. Clean crystalline three-note ascent with a shimmer tail.", cry_claude),
    ("copilot",     "GitHub Copilot",   "The machine. Stepped square-wave boops, down then back up. Dry.",     cry_copilot),
    ("rappterbot",  "RAPPterBot",       "The raptor. Aggressive rising screech with a downward snap.",         cry_rappterbot),
    ("openrappter", "OpenRAPPter",      "Raptor genus, open-winged. A call, then a lower answer, echoing.",    cry_openrappter),
]

# ------------------------------------------------------- second wave species
def cry_opengrokbot():
    """OPENGROKBOT — the questioner. FM wobble rising to an interrogative up-note."""
    dur = 0.85
    n = int(dur * SR)
    f = glide(dur, [(0, 180), (0.45, 210), (0.62, 250), (0.85, 460), (1.0, 560)])
    wob = 1.0 + 0.10 * np.sin(2 * np.pi * 9.0 * np.arange(n) / SR)
    f = f * wob
    x = osc(f, "tri") + 0.4 * osc(f * 2.01, "sine") + 0.22 * osc(f * 0.5, "sine")
    x = softclip(x, 1.8)
    amp = env_bp(dur, [(0, 0), (0.05, 0.8), (0.55, 0.85), (0.80, 1.0), (0.95, 0.7), (1.0, 0)])
    return finish(x * amp)


def cry_openclaw():
    """OPENCLAW — the pincer. Two sharp claw snaps and a short hiss."""
    dur = 0.55
    buf = np.zeros(int(dur * SR))

    def snap(seed):
        d = 0.055
        nn = int(d * SR)
        click = noise(nn, seed) * np.exp(-np.linspace(0, 60, nn))
        body = svf_bandpass(click, fc=2600, q=8.0) * 3.0
        thump = osc(glide(d, [(0, 300), (1.0, 90)]), "sine") * np.exp(-np.linspace(0, 40, nn))
        return softclip(body + 0.8 * thump, 3.0)

    buf = place(buf, snap(3), 0.00, 1.0)
    buf = place(buf, snap(17), 0.14, 0.95)
    nh = int(0.30 * SR)
    hiss = svf_bandpass(noise(nh, 29), fc=glide(0.30, [(0, 5200), (1.0, 2800)]), q=2.0)
    hiss *= env_bp(0.30, [(0, 0), (0.10, 1.0), (1.0, 0)])
    buf = place(buf, hiss, 0.235, 0.55)
    return finish(buf)


def cry_hermes():
    """HERMES — the messenger. Fast fluttering whistle sweeping up and away."""
    dur = 0.70
    n = int(dur * SR)
    f = glide(dur, [(0, 900), (0.35, 1900), (0.70, 2500), (1.0, 3400)])
    flut = 1.0 + 0.06 * np.sign(np.sin(2 * np.pi * 26 * np.arange(n) / SR))
    f = f * flut
    x = osc(f, "sine") + 0.25 * osc(f * 2, "sine")
    doppler = env_bp(dur, [(0, 0.4), (0.35, 1.0), (0.75, 0.8), (1.0, 0.15)])
    x = x * doppler
    x = echo(x, delay_s=0.09, feedback=0.35, taps=2, wet=0.4)
    amp = env_bp(dur, [(0, 0), (0.03, 1.0), (0.85, 0.8), (1.0, 0)])
    return finish(x * amp)


def cry_rapptwin():
    """RAPPTWIN — the mirror. One note that answers itself, slightly detuned."""
    dur = 0.95
    buf = np.zeros(int(dur * SR))

    def note(hz, d, detune=0.0):
        nn = int(d * SR)
        f = np.full(nn, hz * (1 + detune))
        s = osc(f, "sine") + 0.30 * osc(f * 2, "tri") + 0.12 * osc(f * 3, "sine")
        a = env_bp(d, [(0, 0), (0.04, 1.0), (0.60, 0.6), (1.0, 0)])
        return s * a

    buf = place(buf, note(587.3, 0.38), 0.00, 0.95)           # D5 — the call
    buf = place(buf, note(587.3, 0.42, detune=-0.012), 0.44, 0.80)  # the twin answers, flat by 12 cents
    return finish(buf)


def cry_rapplication():
    """RAPPLICATION — the hatched artifact. Two bubbly pops and a chord bloom."""
    dur = 0.80
    buf = np.zeros(int(dur * SR))

    def pop(hz, seed):
        d = 0.07
        nn = int(d * SR)
        s = osc(glide(d, [(0, hz), (1.0, hz * 2.2)]), "sine") * np.exp(-np.linspace(0, 30, nn))
        return s + 0.3 * svf_bandpass(noise(nn, seed), fc=hz * 3, q=5.0) * np.exp(-np.linspace(0, 50, nn))

    buf = place(buf, pop(320, 41), 0.00, 0.9)
    buf = place(buf, pop(480, 43), 0.11, 0.9)
    nc = int(0.55 * SR)
    chord = np.zeros(nc)
    for hz, g in [(523.3, 0.9), (659.3, 0.7), (784.0, 0.6), (1046.5, 0.35)]:  # C major bloom
        chord += g * osc(np.full(nc, hz), "sine")
    chord *= env_bp(0.55, [(0, 0), (0.08, 1.0), (0.55, 0.5), (1.0, 0)]) * np.exp(-np.linspace(0, 3.2, nc))
    buf = place(buf, chord, 0.22, 0.7)
    return finish(buf)


def cry_hatch():
    """The hatch fanfare — shared by all species; the moment an egg cracks."""
    dur = 1.0
    buf = np.zeros(int(dur * SR))
    nn = int(0.12 * SR)
    crack = svf_bandpass(noise(nn, 51), fc=1800, q=3.0) * np.exp(-np.linspace(0, 30, nn))
    buf = place(buf, softclip(crack * 2.5, 3.0), 0.0, 0.8)
    for i, hz in enumerate([392.0, 523.3, 659.3, 784.0]):    # G4 C5 E5 G5 — rising arpeggio
        d = 0.30
        nd = int(d * SR)
        s = osc(np.full(nd, hz), "sine") + 0.3 * osc(np.full(nd, hz * 2), "sine")
        s *= env_bp(d, [(0, 0), (0.03, 1.0), (1.0, 0)]) * np.exp(-np.linspace(0, 3.5, nd))
        buf = place(buf, s, 0.13 + i * 0.11, 0.75)
    return finish(buf)


SPECIES += [
    ("opengrokbot",  "OpenGrokBot",  "The questioner. FM wobble rising to an interrogative up-note.", cry_opengrokbot),
    ("openclaw",     "OpenClaw",     "The pincer. Two sharp claw snaps and a short hiss.",            cry_openclaw),
    ("hermes",       "Hermes",       "The messenger. Fluttering whistle sweeping up and away.",        cry_hermes),
    ("rapptwin",     "RAPP Twin",    "The mirror. One note that answers itself, slightly detuned.",    cry_rapptwin),
    ("rapplication", "RAPPlication", "The hatched artifact. Two bubbly pops and a chord bloom.",       cry_rapplication),
    ("_hatch",       "(hatch fanfare)", "Shared: the moment any egg cracks open.",                     cry_hatch),
]


if __name__ == "__main__":
    os.makedirs(OUT, exist_ok=True)
    dex = {}
    for slug, title, blurb, fn in SPECIES:
        x = fn()
        p = write(slug, x)
        dex[slug] = {
            "name": title,
            "cry": p,
            "description": blurb,
            "seconds": round(len(x) / SR, 3),
        }
        print(f"{slug:12s} {len(x)/SR:5.2f}s  {p}")
    with open(os.path.join(_HOME, "dex.json"), "w") as f:
        json.dump(dex, f, indent=2)
    print("\ndex ->", os.path.join(_HOME, "dex.json"))


