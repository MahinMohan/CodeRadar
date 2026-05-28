# CodeRadar — Distributed Repository Discovery Engine

Type a natural language problem statement. Get back a ranked list of GitHub repositories scored by **semantic relevance**, **code quality**, and **ecosystem health** — with transparent score breakdowns, not just a rank number.

![Search UI](assets/screenshots/search.png)
![Results](assets/screenshots/results.png)

---

## What it does

Most repository search tools return results based on stars or keyword matching. CodeRadar does something different — it crawls and analyzes the actual code, runs it through a distributed scoring pipeline, and ranks repos based on three dimensions:

- **Relevance** — how semantically similar is the repo to your problem statement
- **Quality** — test coverage ratio, error handling density, public API surface
- **Health** — commit recency, contributor count, issue close rate

The final score is `0.5 × relevance + 0.3 × quality + 0.2 × health`.

---

## Architecture

```
User (Angular frontend)
        │
        ▼
Node.js REST API  ──── Cache hit? ──── PostgreSQL (return instantly)
        │
        ▼  (cache miss)
Go Crawler Agent
  · GitHub Search API        — fetch candidate repos
  · git clone --depth=1      — one per repo, concurrently
  · AST parser               — function signatures, test ratio,
                               error handling density, MinHash fingerprint
  · GitHub metadata API      — contributors, commit recency, issue close rate
        │ raw JSON
        ▼
HDFS Data Lake
        │
        ├── Hadoop MapReduce ── dedup (LSH MinHash banding)
        │                   ── feature normalization (min-max)
        │
        └── Apache Spark ───── Job 1: relevance  (cosine similarity on embeddings)
                               Job 2: quality    (AST-derived metrics)
                               Job 3: health     (GitHub metadata)
                               Job 4: combine    → writes to PostgreSQL
        │
        ▼
PostgreSQL ──── Node.js API ──── Angular (ranked cards + score breakdown)
```

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | Angular 17 (standalone components) |
| API | Node.js + Express + TypeScript |
| Crawler | Go 1.22 — goroutines, channels, concurrent worker pool |
| Embeddings | Python FastAPI + `sentence-transformers` (`all-MiniLM-L6-v2`) |
| Storage | Apache HDFS (WebHDFS REST API), PostgreSQL + pgvector |
| Batch | Hadoop MapReduce (Python Streaming) |
| Scoring | Apache Spark 3.5 (PySpark) |

---

## Components

### Angular Frontend
Search input with example queries. Results rendered as cards showing repo name, language, stars, description, and animated score bars for relevance, quality, and health. Expandable breakdown shows the raw metrics behind each score.

### Node.js REST API
Accepts the query, embeds it using the embeddings service, checks PostgreSQL for a cached result (using pgvector cosine similarity). On a cache miss, triggers the Go crawler and starts the pipeline asynchronously. Polls return status and results once scoring is complete.

### Go Crawler Agent
Spins up a 20-goroutine worker pool. Each worker hits the GitHub Search API, clones the repo (`--depth=1`), walks the source files, and extracts:
- Function signatures (Python, Go, JavaScript, Java)
- Test file ratio
- Error handling density (`if err != nil`, `except`, `catch`)
- MinHash fingerprint (128 hashes) for deduplication
- GitHub metadata: contributors, last commit date, issue close rate

All results are serialized as JSON and written to HDFS via the WebHDFS REST API.

### Hadoop MapReduce
Two Python Streaming jobs run over the raw HDFS data:
1. **Dedup** — LSH banding on MinHash fingerprints, keeps the highest-starred repo from each near-duplicate cluster
2. **Normalize** — min-max normalization of numeric features across the batch

### Apache Spark
Four PySpark jobs run sequentially:
1. **Relevance** — embeds each repo's description + top function names, computes cosine similarity against the query embedding
2. **Quality** — weighted score: test ratio (40%) + error handling density (35%) + public API count (25%)
3. **Health** — weighted score: commit recency (40%) + contributor count log-normalized (35%) + issue close rate (25%)
4. **Combine** — merges all three scores, writes top results as Parquet to HDFS and syncs to PostgreSQL

### PostgreSQL + pgvector
Stores query embeddings (for semantic cache lookup), job status, and final scored results. The `pgvector` extension enables cosine similarity search on stored embeddings so repeated similar queries are served instantly.

---

## Running locally

**Prerequisites:** Docker Desktop, Go 1.22+, Python 3.11+, Node.js 20+, a GitHub Personal Access Token

### 1. Build the Go crawler
```bash
cd crawler
go mod tidy
go build -o bin/crawler .
cd ..
```

### 2. Configure environment
```bash
cp .env.example .env
# Set GITHUB_TOKEN in api/.env
```

Create `api/.env`:
```
DATABASE_URL=postgresql://coderadar:coderadar@localhost:5432/coderadar
GITHUB_TOKEN=ghp_your_token_here
LITE_MODE=true
PORT=3000
```

### 3. Start infrastructure
```bash
docker-compose up -d
```
Starts: PostgreSQL · HDFS NameNode + DataNode · Spark Master + Worker · Embeddings API · Node.js API

### 4. Run the frontend
```bash
cd frontend
npm install
npm start
```

Open **http://localhost:4200**

### Full pipeline mode (Hadoop + Spark)
Set `LITE_MODE=false` in `api/.env`, install Python deps (`pip install -r requirements.txt`), and ensure the Go crawler binary is built. The pipeline runs automatically on each cache-miss query.

---

## API

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/api/search` | Submit query → `{ jobId, cached }` |
| `GET` | `/api/search/:jobId/status` | Poll: `pending \| running \| done \| failed` |
| `GET` | `/api/search/:jobId/results` | Fetch ranked results when done |
| `GET` | `/api/health` | Health check |

---
