#!/usr/bin/env python3
"""
Reducer: Compute min/max for each feature, then emit normalized repos.
Two-pass: first collect stats, then normalize. Here we do it in one pass
by buffering (acceptable at this scale — tens of repos per job).
"""
import sys
import json
import math

feature_vals: dict[str, list[float]] = {}
repos: dict[str, dict] = {}

for line in sys.stdin:
    line = line.strip()
    if not line:
        continue
    parts = line.split("\t", 1)
    if len(parts) != 2:
        continue
    key, value = parts

    if key.startswith("__repo__"):
        name = key[len("__repo__"):]
        try:
            repos[name] = json.loads(value)
        except json.JSONDecodeError:
            pass
    else:
        try:
            feature_vals.setdefault(key, []).append(float(value))
        except ValueError:
            pass


def minmax(vals: list[float]) -> tuple[float, float]:
    if not vals:
        return 0.0, 1.0
    lo, hi = min(vals), max(vals)
    return lo, hi if hi != lo else lo + 1.0


def normalize(val: float, lo: float, hi: float) -> float:
    return round((val - lo) / (hi - lo), 4)


stats = {feat: minmax(vals) for feat, vals in feature_vals.items()}

for name, repo in repos.items():
    ast = repo.get("ast", {})
    normalized = {}
    for feat, (lo, hi) in stats.items():
        raw = ast.get(feat, 0)
        normalized[f"{feat}_norm"] = normalize(float(raw), lo, hi)
    repo["normalized"] = normalized
    print(json.dumps(repo))
