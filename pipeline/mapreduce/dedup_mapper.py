#!/usr/bin/env python3
"""
Mapper: Emit (minhash_bucket, repo_json) pairs for deduplication.
Repos sharing a bucket are near-duplicate candidates.
"""
import sys
import json

BAND_SIZE = 8   # rows per band for LSH banding
NUM_BANDS = 16  # 128 hash values / 8 per band


def band_keys(fingerprint: list[int]) -> list[str]:
    keys = []
    for b in range(NUM_BANDS):
        band = tuple(fingerprint[b * BAND_SIZE:(b + 1) * BAND_SIZE])
        keys.append(f"band{b}_{hash(band)}")
    return keys


for line in sys.stdin:
    line = line.strip()
    if not line:
        continue
    try:
        repo = json.loads(line)
        fp = repo.get("ast", {}).get("minhash_fingerprint", [])
        if not fp:
            print(f"UNIQUE\t{json.dumps(repo)}")
            continue
        for key in band_keys(fp):
            print(f"{key}\t{json.dumps(repo)}")
    except json.JSONDecodeError:
        continue
