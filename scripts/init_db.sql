CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS queries (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  text        TEXT NOT NULL,
  embedding   vector(384) NULL,
  job_id      TEXT UNIQUE NOT NULL,
  created_at  TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS results (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id            TEXT NOT NULL REFERENCES queries(job_id) ON DELETE CASCADE,
  repo_full_name    TEXT NOT NULL,
  repo_url          TEXT NOT NULL,
  description       TEXT,
  language          TEXT,
  stars             INT DEFAULT 0,
  relevance_score   FLOAT NOT NULL DEFAULT 0,
  quality_score     FLOAT NOT NULL DEFAULT 0,
  health_score      FLOAT NOT NULL DEFAULT 0,
  composite_score   FLOAT NOT NULL DEFAULT 0,
  score_breakdown   JSONB,
  created_at        TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_results_job_id    ON results(job_id);
CREATE INDEX IF NOT EXISTS idx_results_composite ON results(composite_score DESC);
CREATE INDEX IF NOT EXISTS idx_queries_embedding ON queries USING ivfflat (embedding vector_cosine_ops);

CREATE TABLE IF NOT EXISTS jobs (
  job_id      TEXT PRIMARY KEY,
  status      TEXT NOT NULL DEFAULT 'pending',  -- pending | running | done | failed
  query       TEXT NOT NULL,
  created_at  TIMESTAMPTZ DEFAULT now(),
  updated_at  TIMESTAMPTZ DEFAULT now()
);
