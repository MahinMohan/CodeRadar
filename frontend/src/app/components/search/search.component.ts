import { Component, EventEmitter, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { SearchService } from '../../services/search.service';
import { RepoResult } from '../../models/repo.model';

const EXAMPLES = [
  'Python library for PDF parsing with table extraction',
  'Rust HTTP client with async support and retry logic',
  'TypeScript ORM for PostgreSQL with migrations',
  'Go concurrency patterns for distributed systems',
];

@Component({
  selector: 'app-search',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './search.component.html',
  styleUrls: ['./search.component.scss'],
})
export class SearchComponent {
  @Output() searchStarted = new EventEmitter<void>();
  @Output() results = new EventEmitter<RepoResult[]>();
  @Output() searchError = new EventEmitter<string>();

  query = '';
  examples = EXAMPLES;

  constructor(private svc: SearchService) {}

  submit() {
    if (!this.query.trim()) return;
    this.searchStarted.emit();

    this.svc.submit(this.query).subscribe({
      next: ({ jobId }) => {
        this.svc.pollUntilDone(jobId).subscribe({
          next: res => { if (res?.length) this.results.emit(res); },
          error: err => this.searchError.emit(err.message ?? 'Search failed'),
        });
      },
      error: err => this.searchError.emit(err.error?.error ?? 'Failed to start search'),
    });
  }

  useExample(ex: string) {
    this.query = ex;
    this.submit();
  }
}
