import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, interval, switchMap, takeWhile, map, EMPTY, timeout, throwError } from 'rxjs';
import { SearchResponse, StatusResponse, ResultsResponse, RepoResult } from '../models/repo.model';

const POLL_INTERVAL_MS = 2000;
const POLL_TIMEOUT_MS  = 90_000;

@Injectable({ providedIn: 'root' })
export class SearchService {
  private readonly base = '/api';

  constructor(private http: HttpClient) {}

  submit(query: string): Observable<SearchResponse> {
    return this.http.post<SearchResponse>(`${this.base}/search`, { query });
  }

  getStatus(jobId: string): Observable<StatusResponse> {
    return this.http.get<StatusResponse>(`${this.base}/search/${jobId}/status`);
  }

  getResults(jobId: string): Observable<RepoResult[]> {
    return this.http.get<ResultsResponse>(`${this.base}/search/${jobId}/results`).pipe(
      map(r => r.results),
    );
  }

  /** Poll every 2s, give up after 90s, then fetch results on done */
  pollUntilDone(jobId: string): Observable<RepoResult[]> {
    return interval(POLL_INTERVAL_MS).pipe(
      switchMap(() => this.getStatus(jobId)),
      takeWhile(s => s.status !== 'done' && s.status !== 'failed', true),
      timeout({
        each: POLL_TIMEOUT_MS,
        with: () => throwError(() => new Error('Search timed out — please try again')),
      }),
      switchMap(s => {
        if (s.status === 'done')   return this.getResults(jobId);
        if (s.status === 'failed') return throwError(() => new Error('Pipeline failed — check API logs'));
        return EMPTY;
      }),
    );
  }
}
