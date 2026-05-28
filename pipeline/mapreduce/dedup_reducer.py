#!/usr/bin/env python3
"""
Reducer: Within each band bucket, keep only the repo with the most stars.
Emits deduplicated repos with a 'is_duplicate' flag for dropped ones.
"""
import sys
import json
from itertools import groupby

current_key = None
bucket: list[dict] = []


def emit_bucket(key: str, repos: list[dict]):
    if key == "UNIQUE" or len(repos) == 1:
        for r in repos:
            r["is_duplicate"] = False
            print(json.dumps(r))
        return

    # Keep the repo with highest stars; mark others as duplicates
    repos.sort(key=lambda r: r.get("stars", 0), reverse=True)
    repos[0]["is_duplicate"] = False
    print(json.dumps(repos[0]))
    for dup in repos[1:]:
        dup["is_duplicate"] = True
        print(json.dumps(dup))


for line in sys.stdin:
    line = line.strip()
    if not line:
        continue
    parts = line.split("\t", 1)
    if len(parts) != 2:
        continue

    key, value = parts
    try:
        repo = json.loads(value)
    except json.JSONDecodeError:
        continue

    if key != current_key:
        if current_key is not None:
            emit_bucket(current_key, bucket)
        current_key = key
        bucket = [repo]
    else:
        bucket.append(repo)

if current_key is not None:
    emit_bucket(current_key, bucket)
