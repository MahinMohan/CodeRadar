export interface ScoreBreakdown {
  relevance: number;
  quality: number;
  health: number;
  test_file_ratio?: number;
  error_handling_density?: number;
  public_api_count?: number;
  commit_recency_days?: number;
  contributor_count?: number;
  issue_close_rate?: number;
  stars?: number;
}

export interface RepoResult {
  repo_full_name: string;
  repo_url: string;
  description: string;
  language: string;
  stars: number;
  relevance_score: number;
  quality_score: number;
  health_score: number;
  composite_score: number;
  score_breakdown: ScoreBreakdown;
}

export interface SearchResponse {
  jobId: string;
  cached: boolean;
}

export interface StatusResponse {
  status: 'pending' | 'running' | 'done' | 'failed';
}

export interface ResultsResponse {
  results: RepoResult[];
}
