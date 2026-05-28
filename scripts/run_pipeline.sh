#!/usr/bin/env bash
# Full pipeline: MapReduce dedup → normalize → Spark relevance → quality → health → combine
set -euo pipefail

JOB_ID="$1"
QUERY="$2"
QUERY_EMB="$3"         # JSON array string of the query embedding
DB_URL="${DATABASE_URL}"
HDFS_URL="${HDFS_URL:-http://localhost:9870}"
SPARK_MASTER="${SPARK_MASTER:-spark://localhost:7077}"
HADOOP_HOME="${HADOOP_HOME:-/opt/hadoop}"
HDFS_BIN="$HADOOP_HOME/bin/hdfs"
SPARK_SUBMIT="${SPARK_HOME:-/opt/spark}/bin/spark-submit"

RAW_PATH="/coderadar/raw/$JOB_ID"
DEDUP_OUT="/coderadar/processed/$JOB_ID/dedup"
NORM_OUT="/coderadar/processed/$JOB_ID/normalized"
REL_OUT="/coderadar/scored/$JOB_ID/relevance"
QUAL_OUT="/coderadar/scored/$JOB_ID/quality"
HLTH_OUT="/coderadar/scored/$JOB_ID/health"
FINAL_OUT="/coderadar/scored/$JOB_ID/final"

echo "[pipeline] starting job=$JOB_ID"

# --- MapReduce: Deduplication ---
$HDFS_BIN dfs -mkdir -p "$DEDUP_OUT"
$HADOOP_HOME/bin/hadoop jar \
  $HADOOP_HOME/share/hadoop/tools/lib/hadoop-streaming-*.jar \
  -input   "$RAW_PATH/*.json" \
  -output  "$DEDUP_OUT" \
  -mapper  "python3 /pipeline/mapreduce/dedup_mapper.py" \
  -reducer "python3 /pipeline/mapreduce/dedup_reducer.py" \
  -file    /pipeline/mapreduce/dedup_mapper.py \
  -file    /pipeline/mapreduce/dedup_reducer.py

echo "[pipeline] dedup done"

# --- MapReduce: Normalization ---
$HADOOP_HOME/bin/hadoop jar \
  $HADOOP_HOME/share/hadoop/tools/lib/hadoop-streaming-*.jar \
  -input   "$DEDUP_OUT/part-*" \
  -output  "$NORM_OUT" \
  -mapper  "python3 /pipeline/mapreduce/normalize_mapper.py" \
  -reducer "python3 /pipeline/mapreduce/normalize_reducer.py" \
  -file    /pipeline/mapreduce/normalize_mapper.py \
  -file    /pipeline/mapreduce/normalize_reducer.py

echo "[pipeline] normalize done"

# --- Spark: Relevance ---
$SPARK_SUBMIT --master "$SPARK_MASTER" \
  /pipeline/spark/relevance_score.py \
  "hdfs://namenode:9000$NORM_OUT" \
  "hdfs://namenode:9000$REL_OUT" \
  "$QUERY_EMB"

# --- Spark: Quality ---
$SPARK_SUBMIT --master "$SPARK_MASTER" \
  /pipeline/spark/quality_score.py \
  "hdfs://namenode:9000$REL_OUT" \
  "hdfs://namenode:9000$QUAL_OUT"

# --- Spark: Health ---
$SPARK_SUBMIT --master "$SPARK_MASTER" \
  /pipeline/spark/health_score.py \
  "hdfs://namenode:9000$QUAL_OUT" \
  "hdfs://namenode:9000$HLTH_OUT"

# --- Spark: Combine + write to PostgreSQL ---
$SPARK_SUBMIT --master "$SPARK_MASTER" \
  /pipeline/spark/combine_scores.py \
  "hdfs://namenode:9000$HLTH_OUT" \
  "$JOB_ID" \
  "$DB_URL"

echo "[pipeline] done — job=$JOB_ID"
