#!/usr/bin/env python3
"""
Mapper: Extract numeric features from each repo for normalization.
Emits (feature_name, value) pairs plus the full repo for the reducer.
"""
import sys
import json

FEATURES = ["test_file_ratio", "error_handling_density", "public_api_count", "total_lines"]

for line in sys.stdin:
    line = line.strip()
    if not line:
        continue
    try:
        repo = json.loads(line)
    except json.JSONDecodeError:
        continue

    if repo.get("is_duplicate"):
        continue

    ast = repo.get("ast", {})
    for feat in FEATURES:
        val = ast.get(feat, 0)
        print(f"{feat}\t{val}")

    # Also pass through the full repo tagged with its name
    print(f"__repo__{repo['full_name']}\t{json.dumps(repo)}")
