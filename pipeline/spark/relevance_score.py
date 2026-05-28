"""
Spark Job 1 — Semantic Relevance Score
Computes cosine similarity between the query embedding and each repo's
embedded text (description + top function names).
"""
import sys
import json
import requests
from pyspark.sql import SparkSession
from pyspark.sql.functions import udf, col
from pyspark.sql.types import FloatType, ArrayType, DoubleType

EMBEDDINGS_URL = sys.argv[3] if len(sys.argv) > 3 else "http://localhost:8001"


def embed_texts(texts: list[str]) -> list[list[float]]:
    r = requests.post(f"{EMBEDDINGS_URL}/embed/batch", json={"texts": texts}, timeout=30)
    r.raise_for_status()
    return r.json()["embeddings"]


def cosine_sim(a: list[float], b: list[float]) -> float:
    import math
    dot = sum(x * y for x, y in zip(a, b))
    mag_a = math.sqrt(sum(x * x for x in a))
    mag_b = math.sqrt(sum(x * x for x in b))
    if mag_a == 0 or mag_b == 0:
        return 0.0
    return dot / (mag_a * mag_b)


def main(input_path: str, output_path: str, query_embedding_json: str):
    spark = SparkSession.builder.appName("CodeRadar-Relevance").getOrCreate()
    spark.sparkContext.setLogLevel("WARN")

    query_emb = json.loads(query_embedding_json)

    df = spark.read.json(input_path)

    # Build text to embed per repo
    def build_text(description, signatures):
        parts = [description or ""]
        if signatures:
            parts.extend(signatures[:10])
        return " ".join(parts)

    rows = df.collect()
    texts = [build_text(r.description, r.ast.function_signatures if r.ast else []) for r in rows]

    embeddings = embed_texts(texts)
    scores = [cosine_sim(query_emb, emb) for emb in embeddings]

    # Attach scores back and write
    import pyspark.sql.functions as F
    from pyspark.sql import Row

    scored_rows = []
    for i, row in enumerate(rows):
        d = row.asDict(recursive=True)
        d["relevance_score"] = round(float(scores[i]), 4)
        scored_rows.append(d)

    scored_df = spark.read.json(spark.sparkContext.parallelize([json.dumps(r) for r in scored_rows]))
    scored_df.write.mode("overwrite").parquet(output_path)

    spark.stop()


if __name__ == "__main__":
    if len(sys.argv) < 4:
        print("Usage: relevance_score.py <input_path> <output_path> <query_embedding_json>")
        sys.exit(1)
    main(sys.argv[1], sys.argv[2], sys.argv[3])
