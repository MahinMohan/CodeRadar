import { spawn } from 'child_process';
import path from 'path';
import pool from '../db/postgres';
import axios from 'axios';

const GITHUB_TOKEN = process.env.GITHUB_TOKEN ?? '';
const PIPELINE_SCRIPT = path.resolve(__dirname, '../../../scripts/run_pipeline.sh');

/**
 * Full mode (local/Docker): runs the Go crawler then the Spark/MapReduce pipeline.
 */
export async function runFullPipeline(
  jobId: string,
  query: string,
  queryEmbedding: number[],
): Promise<void> {
  await pool.query(`UPDATE jobs SET status='running', updated_at=now() WHERE job_id=$1`, [jobId]);

  const crawlerBin = process.env.CRAWLER_BIN ?? path.resolve(__dirname, '../../../crawler/bin/crawler');

  // Step 1: Go crawler
  await runProcess(crawlerBin, ['--query', query, '--job', jobId], {
    GITHUB_TOKEN,
    HDFS_URL: process.env.HDFS_URL ?? 'http://localhost:9870',
    CLONE_DIR: process.env.CLONE_DIR ?? '/tmp/coderadar_repos',
  });

  // Step 2: Pipeline (MapReduce + Spark)
  const embStr = JSON.stringify(queryEmbedding);
  await runProcess('bash', [PIPELINE_SCRIPT, jobId, query, embStr], {
    DATABASE_URL: process.env.DATABASE_URL ?? '',
    HDFS_URL: process.env.HDFS_URL ?? 'http://localhost:9870',
  });
}

/**
 * Lite mode (Vercel / production): scoring done inline, no HDFS/Spark.
 * Searches GitHub directly and scores repos without the distributed pipeline.
 */
export async function runLitePipeline(
  jobId: string,
  query: string,
  queryEmbedding: number[],
): Promise<void> {
  try {
  await pool.query(`UPDATE jobs SET status='running', updated_at=now() WHERE job_id=$1`, [jobId]);

  const repos = await searchGitHub(query);
  const results = repos.length ? await scoreInline(repos, query, queryEmbedding) : [];

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const r of results.slice(0, 10)) {
      await client.query(
        `INSERT INTO results
           (job_id, repo_full_name, repo_url, description, language, stars,
            relevance_score, quality_score, health_score, composite_score, score_breakdown)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
         ON CONFLICT DO NOTHING`,
        [
          jobId, r.full_name, r.html_url, r.description, r.language, r.stargazers_count,
          r.relevance, r.quality, r.health,
          0.5 * r.relevance + 0.3 * r.quality + 0.2 * r.health,
          JSON.stringify({ relevance: r.relevance, quality: r.quality, health: r.health, ...r.breakdown }),
        ],
      );
    }
    await client.query(`UPDATE jobs SET status='done', updated_at=now() WHERE job_id=$1`, [jobId]);
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    await pool.query(`UPDATE jobs SET status='failed', updated_at=now() WHERE job_id=$1`, [jobId]);
    throw e;
  } finally {
    client.release();
  }
  } catch (err) {
    // Top-level catch: covers searchGitHub / scoreInline failures too
    console.error(`[pipeline] job ${jobId} failed:`, err);
    await pool.query(`UPDATE jobs SET status='failed', updated_at=now() WHERE job_id=$1`, [jobId]);
  }
}

// ---------- helpers ----------

/** Strip filler words and send only meaningful keywords to GitHub search */
function buildSearchQuery(query: string): string {
  const stopWords = new Set([
    'a','an','the','for','with','and','or','of','to','in','on','at','by',
    'i','need','want','looking','find','get','some','good','best','using',
    'that','has','have','can','is','are','my','me','please','library','tool',
  ]);
  const keywords = query
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .split(/\s+/)
    .filter(w => w.length > 2 && !stopWords.has(w));
  return keywords.slice(0, 5).join('+');
}

async function searchGitHub(query: string) {
  const q = buildSearchQuery(query);
  console.log(`[github] search query: "${q}"`);
  const { data } = await axios.get(
    `https://api.github.com/search/repositories?q=${q}&sort=stars&per_page=20`,
    {
      headers: {
        Authorization: `Bearer ${GITHUB_TOKEN}`,
        Accept: 'application/vnd.github+json',
      },
    },
  );
  const items: any[] = data.items ?? [];
  console.log(`[github] returned ${items.length} repos`);
  return items;
}

async function scoreInline(repos: any[], query: string, queryEmb: number[]) {
  const EMBEDDINGS_URL = process.env.EMBEDDINGS_URL;

  const texts = repos.map(r =>
    [r.description ?? '', ...(r.topics ?? [])].join(' '),
  );

  let embeddings: number[][] = [];
  if (EMBEDDINGS_URL) {
    const { data } = await axios.post(`${EMBEDDINGS_URL}/embed/batch`, { texts });
    embeddings = data.embeddings;
  }

  return repos.map((r, i) => {
    const relevance = embeddings[i] ? cosineSim(queryEmb, embeddings[i]) : 0.5;
    const quality   = scoreQuality(r);
    const health    = scoreHealth(r);
    return { ...r, relevance, quality, health, breakdown: { stars: r.stargazers_count } };
  });
}

function cosineSim(a: number[], b: number[]): number {
  let dot = 0, magA = 0, magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  return magA && magB ? dot / (Math.sqrt(magA) * Math.sqrt(magB)) : 0;
}

function scoreQuality(repo: any): number {
  // Heuristic from public metadata when AST data isn't available
  const hasTests = (repo.description ?? '').toLowerCase().includes('test') ? 0.3 : 0;
  const starNorm  = Math.min(repo.stargazers_count / 5000, 1.0) * 0.4;
  const forkNorm  = Math.min(repo.forks_count / 1000, 1.0) * 0.3;
  return parseFloat((hasTests + starNorm + forkNorm).toFixed(4));
}

function scoreHealth(repo: any): number {
  const updated = new Date(repo.updated_at);
  const daysSince = (Date.now() - updated.getTime()) / 86400000;
  const recency = Math.max(0, 1 - daysSince / 365);
  const issues  = repo.open_issues_count > 0 ? 0.5 : 0.3;
  return parseFloat((0.6 * recency + 0.4 * issues).toFixed(4));
}

function runProcess(
  cmd: string,
  args: string[],
  env: Record<string, string>,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, {
      env: { ...process.env, ...env },
      stdio: 'inherit',
    });
    proc.on('close', code => (code === 0 ? resolve() : reject(new Error(`exit ${code}`))));
    proc.on('error', reject);
  });
}
