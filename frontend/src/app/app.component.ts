import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpClientModule } from '@angular/common/http';
import { SearchComponent } from './components/search/search.component';
import { ResultsComponent } from './components/results/results.component';
import { RepoResult } from './models/repo.model';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, HttpClientModule, SearchComponent, ResultsComponent],
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.scss'],
})
export class AppComponent {
  results: RepoResult[] = [];
  loading = false;
  error = '';

  onSearchStarted() {
    this.results = [];
    this.loading = true;
    this.error = '';
  }

  onResults(results: RepoResult[]) {
    this.results = results;
    this.loading = false;
  }

  onError(msg: string) {
    this.error = msg;
    this.loading = false;
  }
}
