package github

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"time"
)

type Repo struct {
	FullName        string `json:"full_name"`
	HTMLURL         string `json:"html_url"`
	CloneURL        string `json:"clone_url"`
	Description     string `json:"description"`
	Language        string `json:"language"`
	StargazersCount int    `json:"stargazers_count"`
	ForksCount      int    `json:"forks_count"`
	OpenIssues      int    `json:"open_issues_count"`
	Topics          []string
}

type ContributorStats struct {
	ContributorCount int
	CommitRecency    int // days since last commit
	IssueCloseRate   float64
}

type Client struct {
	token  string
	http   *http.Client
}

func NewClient(token string) *Client {
	return &Client{
		token: token,
		http:  &http.Client{Timeout: 15 * time.Second},
	}
}

func (c *Client) Search(query string, limit int) ([]Repo, error) {
	q := url.QueryEscape(query)
	apiURL := fmt.Sprintf("https://api.github.com/search/repositories?q=%s&sort=stars&per_page=%d", q, limit)

	req, _ := http.NewRequest("GET", apiURL, nil)
	req.Header.Set("Authorization", "Bearer "+c.token)
	req.Header.Set("Accept", "application/vnd.github+json")

	resp, err := c.http.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	var result struct {
		Items []Repo `json:"items"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, err
	}
	return result.Items, nil
}

func (c *Client) GetContributorStats(fullName string) ContributorStats {
	stats := ContributorStats{}

	// Contributor count
	req, _ := http.NewRequest("GET",
		fmt.Sprintf("https://api.github.com/repos/%s/contributors?per_page=1&anon=true", fullName), nil)
	req.Header.Set("Authorization", "Bearer "+c.token)
	resp, err := c.http.Do(req)
	if err == nil {
		defer resp.Body.Close()
		var contributors []any
		json.NewDecoder(resp.Body).Decode(&contributors)
		stats.ContributorCount = len(contributors)
	}

	// Last commit date
	req2, _ := http.NewRequest("GET",
		fmt.Sprintf("https://api.github.com/repos/%s/commits?per_page=1", fullName), nil)
	req2.Header.Set("Authorization", "Bearer "+c.token)
	resp2, err := c.http.Do(req2)
	if err == nil {
		defer resp2.Body.Close()
		var commits []struct {
			Commit struct {
				Committer struct {
					Date time.Time `json:"date"`
				} `json:"committer"`
			} `json:"commit"`
		}
		json.NewDecoder(resp2.Body).Decode(&commits)
		if len(commits) > 0 {
			stats.CommitRecency = int(time.Since(commits[0].Commit.Committer.Date).Hours() / 24)
		}
	}

	// Issue close rate
	req3, _ := http.NewRequest("GET",
		fmt.Sprintf("https://api.github.com/repos/%s/issues?state=closed&per_page=20", fullName), nil)
	req3.Header.Set("Authorization", "Bearer "+c.token)
	resp3, err := c.http.Do(req3)
	if err == nil {
		defer resp3.Body.Close()
		var issues []any
		json.NewDecoder(resp3.Body).Decode(&issues)
		closed := float64(len(issues))
		if closed > 0 {
			stats.IssueCloseRate = closed / (closed + float64(0))
		}
	}

	return stats
}
