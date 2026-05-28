"""
Spark Job 3 — Ecosystem Health Score
Weights: commit_recency * 0.4 + contributor_count_norm * 0.35 + issue_close_rate * 0.25
"""
import sys
import json
import math
from pyspark.sql import SparkSession

MAX_DAYS = 365  # repos older than 1 year get 0 recency score
MAX_CONTRIBUTORS = 50


def recency_score(days_since_commit: int) -> float:
    if days_since_commit <= 0:
        return 1.0
    return max(0.0, 1.0 - days_since_commit / MAX_DAYS)


def contributor_norm(count: int) -> float:
    # Log scale: 1 → 0, 50+ → 1
    return min(math.log1p(count) / math.log1p(MAX_CONTRIBUTORS), 1.0)


def health(days: int, contributors: int, issue_close_rate: float) -> float:
    r = recency_score(days)
    c = contributor_norm(contributors)
    i = float(issue_close_rate or 0)
    return round(0.40 * r + 0.35 * c + 0.25 * i, 4)


def main(input_path: str, output_path: str):
    spark = SparkSession.builder.appName("CodeRadar-Health").getOrCreate()
    spark.sparkContext.setLogLevel("WARN")

    rows = spark.read.parquet(input_path).collect()
    scored = []
    for row in rows:
        d = row.asDict(recursive=True)
        cs = d.get("contributor_stats") or {}
        score = health(
            cs.get("commit_recency", 365),
            cs.get("contributor_count", 0),
            cs.get("issue_close_rate", 0),
        )
        d["health_score"] = score
        scored.append(d)

    out_df = spark.read.json(spark.sparkContext.parallelize([json.dumps(r) for r in scored]))
    out_df.write.mode("overwrite").parquet(output_path)
    spark.stop()


if __name__ == "__main__":
    if len(sys.argv) < 3:
        print("Usage: health_score.py <input_path> <output_path>")
        sys.exit(1)
    main(sys.argv[1], sys.argv[2])
