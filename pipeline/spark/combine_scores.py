"""
Spark Job 4 — Combine Scores + Write to PostgreSQL
composite = 0.50 * relevance + 0.30 * quality + 0.20 * health
"""
import sys
import json
import os
from pyspark.sql import SparkSession


def composite(rel: float, qual: float, health: float) -> float:
    return round(0.50 * rel + 0.30 * qual + 0.20 * health, 4)


def build_breakdown(row: dict) -> dict:
    ast = row.get("ast") or {}
    cs = row.get("contributor_stats") or {}
    return {
        "relevance":            row.get("relevance_score", 0),
        "quality":              row.get("quality_score", 0),
        "health":               row.get("health_score", 0),
        "test_file_ratio":      ast.get("test_file_ratio", 0),
        "error_handling_density": ast.get("error_handling_density", 0),
        "public_api_count":     ast.get("public_api_count", 0),
        "commit_recency_days":  cs.get("commit_recency", 0),
        "contributor_count":    cs.get("contributor_count", 0),
        "issue_close_rate":     cs.get("issue_close_rate", 0),
    }


def main(input_path: str, job_id: str, db_url: str):
    spark = SparkSession.builder \
        .appName("CodeRadar-Combine") \
        .config("spark.jars.packages", "org.postgresql:postgresql:42.7.3") \
        .getOrCreate()
    spark.sparkContext.setLogLevel("WARN")

    rows = spark.read.parquet(input_path).collect()
    final = []
    for row in rows:
        d = row.asDict(recursive=True)
        rel   = float(d.get("relevance_score", 0))
        qual  = float(d.get("quality_score", 0))
        hlth  = float(d.get("health_score", 0))
        d["composite_score"] = composite(rel, qual, hlth)
        d["score_breakdown"]  = build_breakdown(d)
        d["job_id"]           = job_id
        final.append(d)

    final.sort(key=lambda r: r["composite_score"], reverse=True)

    # Write top results to PostgreSQL
    import psycopg2, psycopg2.extras
    conn = psycopg2.connect(db_url)
    cur  = conn.cursor()

    for r in final[:20]:
        cur.execute("""
            INSERT INTO results
              (job_id, repo_full_name, repo_url, description, language, stars,
               relevance_score, quality_score, health_score, composite_score, score_breakdown)
            VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
            ON CONFLICT DO NOTHING
        """, (
            job_id,
            r.get("full_name", ""),
            r.get("url", ""),
            r.get("description", ""),
            r.get("language", ""),
            r.get("stars", 0),
            r.get("relevance_score", 0),
            r.get("quality_score", 0),
            r.get("health_score", 0),
            r.get("composite_score", 0),
            json.dumps(r.get("score_breakdown", {})),
        ))

    cur.execute("UPDATE jobs SET status='done', updated_at=now() WHERE job_id=%s", (job_id,))
    conn.commit()
    cur.close()
    conn.close()

    spark.stop()
    print(f"[combine] wrote {min(len(final), 20)} results for job {job_id}")


if __name__ == "__main__":
    if len(sys.argv) < 4:
        print("Usage: combine_scores.py <input_path> <job_id> <db_url>")
        sys.exit(1)
    main(sys.argv[1], sys.argv[2], sys.argv[3])
