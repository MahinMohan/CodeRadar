import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RepoResult } from '../../models/repo.model';

@Component({
  selector: 'app-results',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './results.component.html',
  styleUrls: ['./results.component.scss'],
})
export class ResultsComponent {
  @Input() results: RepoResult[] = [];

  truncate(text: string, limit = 160): string {
    if (!text || text.length <= limit) return text;
    return text.slice(0, limit).trimEnd() + '…';
  }

  pct(score: number): string {
    return `${Math.round(score * 100)}%`;
  }

  scoreClass(score: number): string {
    if (score >= 0.7) return 'high';
    if (score >= 0.4) return 'mid';
    return 'low';
  }

  languageColor(lang: string): string {
    const map: Record<string, string> = {
      Python: '#3572A5', TypeScript: '#2b7489', JavaScript: '#f1e05a',
      Go: '#00ADD8', Java: '#b07219', Rust: '#dea584', Ruby: '#701516',
      'C++': '#f34b7d', C: '#555555', Swift: '#F05138',
    };
    return map[lang] ?? '#6b7280';
  }
}
