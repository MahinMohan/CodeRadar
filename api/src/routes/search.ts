import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { embed } from '../services/embeddings';
import { findCachedJob, saveQuery, getJobStatus } from '../services/cache';
import { runFullPipeline, runLitePipeline } from '../services/pipeline';
import pool from '../db/postgres';

const router = Router();

const isLiteMode = process.env.NODE_ENV === 'production' || process.env.LITE_MODE === 'true';

/** POST /api/search — submit a query, returns jobId */
router.post('/', async (req: Request, res: Response) => {
  const { query } = req.body as { query?: string };
  if (!query?.trim()) {
    return res.status(400).json({ error: 'query is required' });
  }

  try {
    const embedding = isLiteMode ? [] : await embed(query);
    const cached    = embedding.length ? await findCachedJob(embedding) : null;

    if (cached) {
      return res.json({ jobId: cached, cached: true });
    }

    const jobId = uuidv4();
    await saveQuery(jobId, query, embedding);

    // Fire-and-forget — pipeline runs async
    const run = isLiteMode ? runLitePipeline : runFullPipeline;
    run(jobId, query, embedding).catch(err =>
      console.error(`[pipeline] job ${jobId} failed:`, err),
    );

    return res.status(202).json({ jobId, cached: false });
  } catch (err) {
    console.error('[search]', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/** GET /api/search/:jobId/status */
router.get('/:jobId/status', async (req: Request, res: Response) => {
  const status = await getJobStatus(req.params.jobId);
  if (!status) return res.status(404).json({ error: 'Job not found' });
  return res.json({ status });
});

/** GET /api/search/:jobId/results */
router.get('/:jobId/results', async (req: Request, res: Response) => {
  const { rows } = await pool.query(
    `SELECT repo_full_name, repo_url, description, language, stars,
            relevance_score, quality_score, health_score,
            composite_score, score_breakdown
     FROM results
     WHERE job_id = $1
     ORDER BY composite_score DESC
     LIMIT 10`,
    [req.params.jobId],
  );
  return res.json({ results: rows });
});

export default router;
