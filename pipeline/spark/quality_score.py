"""
Spark Job 2 — Code Quality Score
Weights: test_ratio * 0.4 + error_handling_density * 0.35 + public_api_norm * 0.25
"""
import sys
import json
from pyspark.sql import SparkSession
from pyspark.sql.functions import col, when


def quality(test_ratio, err_density, api_norm):
    t = float(test_ratio or 0)
    e = float(err_density or 0)
    a = float(api_norm or 0)
    # Cap error density at a reasonable ceiling (0.1 = 10% of lines are error handling)
    e_norm = min(e / 0.10, 1.0)
    return round(0.40 * t + 0.35 * e_norm + 0.25 * a, 4)


def main(input_path: str, output_path: str):
    spark = SparkSession.builder.appName("CodeRadar-Quality").getOrCreate()
    spark.sparkContext.setLogLevel("WARN")

    rows = spark.read.parquet(input_path).collect()
    scored = []
    for row in rows:
        d = row.asDict(recursive=True)
        norm = d.get("normalized") or {}
        ast = d.get("ast") or {}
        score = quality(
            ast.get("test_file_ratio", 0),
            ast.get("error_handling_density", 0),
            norm.get("public_api_count_norm", 0),
        )
        d["quality_score"] = score
        scored.append(d)

    out_df = spark.read.json(spark.sparkContext.parallelize([json.dumps(r) for r in scored]))
    out_df.write.mode("overwrite").parquet(output_path)
    spark.stop()


if __name__ == "__main__":
    if len(sys.argv) < 3:
        print("Usage: quality_score.py <input_path> <output_path>")
        sys.exit(1)
    main(sys.argv[1], sys.argv[2])
