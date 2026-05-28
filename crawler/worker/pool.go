package worker

import (
	"fmt"
	"log"
	"os"
	"path/filepath"
	"sync"

	gogit "github.com/go-git/go-git/v5"

	"github.com/coderadar/crawler/ast"
	"github.com/coderadar/crawler/github"
)

type RepoAnalysis struct {
	FullName         string                `json:"full_name"`
	URL              string                `json:"url"`
	Description      string                `json:"description"`
	Language         string                `json:"language"`
	Stars            int                   `json:"stars"`
	Forks            int                   `json:"forks"`
	AST              ast.AnalysisResult    `json:"ast"`
	ContributorStats github.ContributorStats `json:"contributor_stats"`
}

func RunPool(numWorkers int, repos []github.Repo, cloneDir string, gh *github.Client) []RepoAnalysis {
	jobs := make(chan github.Repo, len(repos))
	out := make(chan RepoAnalysis, len(repos))

	var wg sync.WaitGroup
	for i := 0; i < numWorkers; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for repo := range jobs {
				result, err := processRepo(repo, cloneDir, gh)
				if err != nil {
					log.Printf("[worker] skip %s: %v", repo.FullName, err)
					continue
				}
				out <- result
			}
		}()
	}

	for _, r := range repos {
		jobs <- r
	}
	close(jobs)

	go func() {
		wg.Wait()
		close(out)
	}()

	var results []RepoAnalysis
	for r := range out {
		results = append(results, r)
	}
	return results
}

func processRepo(repo github.Repo, cloneDir string, gh *github.Client) (RepoAnalysis, error) {
	dest := filepath.Join(cloneDir, sanitize(repo.FullName))
	defer os.RemoveAll(dest)

	_, err := gogit.PlainClone(dest, false, &gogit.CloneOptions{
		URL:   repo.CloneURL,
		Depth: 1,
	})
	if err != nil {
		return RepoAnalysis{}, fmt.Errorf("clone: %w", err)
	}

	astResult := ast.AnalyzeRepo(dest)
	contribStats := gh.GetContributorStats(repo.FullName)

	return RepoAnalysis{
		FullName:         repo.FullName,
		URL:              repo.HTMLURL,
		Description:      repo.Description,
		Language:         repo.Language,
		Stars:            repo.StargazersCount,
		Forks:            repo.ForksCount,
		AST:              astResult,
		ContributorStats: contribStats,
	}, nil
}

func sanitize(name string) string {
	result := make([]byte, len(name))
	for i := range name {
		if name[i] == '/' {
			result[i] = '_'
		} else {
			result[i] = name[i]
		}
	}
	return string(result)
}
