import pool from '../db/postgres';

const SIMILARITY_THRESHOLD = 0.92;

/**
 * Returns a cached job_id if a semantically equivalent query exists,
 * otherwise null.
 */
export async function findCachedJob(embedding: number[]): Promise<string | null> {
  if (!embedding.length) return null;
  const vec = `[${embedding.join(',')}]`;
  const { rows } = await pool.query<{ job_id: string; similarity: number }>(
    `SELECT job_id, 1 - (embedding <=> $1::vector) AS similarity
     FROM queries
     WHERE embedding IS NOT NULL
     ORDER BY embedding <=> $1::vector
     LIMIT 1`,
    [vec],
  );
  if (rows.length && rows[0].similarity >= SIMILARITY_THRESHOLD) {
    return rows[0].job_id;
  }
  return null;
}

export async function saveQuery(
  jobId: string,
  text: string,
  embedding: number[],
): Promise<void> {
  const vec = embedding.length ? `[${embedding.join(',')}]` : null;
  await pool.query(
    `INSERT INTO queries (job_id, text, embedding)
     VALUES ($1, $2, $3::vector)
     ON CONFLICT (job_id) DO NOTHING`,
    [jobId, text, vec],
  );
  await pool.query(
    `INSERT INTO jobs (job_id, query, status) VALUES ($1, $2, 'pending')
     ON CONFLICT (job_id) DO NOTHING`,
    [jobId, text],
  );
}

export async function getJobStatus(jobId: string): Promise<string | null> {
  const { rows } = await pool.query<{ status: string }>(
    'SELECT status FROM jobs WHERE job_id = $1',
    [jobId],
  );
  return rows[0]?.status ?? null;
}
