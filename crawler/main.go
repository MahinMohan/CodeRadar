package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"log"
	"os"
	"path/filepath"

	"github.com/coderadar/crawler/github"
	"github.com/coderadar/crawler/hdfs"
	"github.com/coderadar/crawler/worker"
)

func main() {
	query := flag.String("query", "", "Natural language query")
	jobID := flag.String("job", "", "Job ID")
	workers := flag.Int("workers", 20, "Goroutine pool size")
	flag.Parse()

	if *query == "" || *jobID == "" {
		log.Fatal("--query and --job are required")
	}

	token := os.Getenv("GITHUB_TOKEN")
	if token == "" {
		log.Fatal("GITHUB_TOKEN not set")
	}

	hdfsURL := os.Getenv("HDFS_URL")
	if hdfsURL == "" {
		hdfsURL = "http://localhost:9870"
	}

	cloneDir := os.Getenv("CLONE_DIR")
	if cloneDir == "" {
		cloneDir = filepath.Join(os.TempDir(), "coderadar_repos")
	}
	os.MkdirAll(cloneDir, 0755)

	log.Printf("[crawler] job=%s query=%q workers=%d", *jobID, *query, *workers)

	ghClient := github.NewClient(token)
	repos, err := ghClient.Search(*query, 40)
	if err != nil {
		log.Fatalf("GitHub search failed: %v", err)
	}
	log.Printf("[crawler] found %d candidate repos", len(repos))

	hdfsWriter := hdfs.NewWriter(hdfsURL, os.Getenv("HDFS_USER"))

	results := worker.RunPool(*workers, repos, cloneDir, ghClient)

	for _, r := range results {
		data, _ := json.Marshal(r)
		path := fmt.Sprintf("/coderadar/raw/%s/%s.json", *jobID, r.FullName)
		if err := hdfsWriter.Write(path, data); err != nil {
			log.Printf("[hdfs] write failed for %s: %v", r.FullName, err)
		}
	}

	log.Printf("[crawler] done. wrote %d results to HDFS", len(results))

	// Write a manifest so downstream jobs know input is ready
	manifest := map[string]any{"job_id": *jobID, "count": len(results)}
	data, _ := json.Marshal(manifest)
	hdfsWriter.Write(fmt.Sprintf("/coderadar/raw/%s/_manifest.json", *jobID), data)
}
