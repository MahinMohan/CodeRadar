package hdfs

import (
	"bytes"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"time"
)

type Writer struct {
	baseURL string
	user    string
	client  *http.Client
}

func NewWriter(baseURL, user string) *Writer {
	if user == "" {
		user = "root"
	}
	return &Writer{
		baseURL: baseURL,
		user:    user,
		client:  &http.Client{Timeout: 30 * time.Second},
	}
}

// Write creates or overwrites a file in HDFS via WebHDFS REST API.
// Uses the two-step WebHDFS PUT: first gets redirect URL, then streams data.
func (w *Writer) Write(hdfsPath string, data []byte) error {
	if err := w.mkdirs(parentDir(hdfsPath)); err != nil {
		return fmt.Errorf("mkdirs: %w", err)
	}

	// Step 1: initiate CREATE — follow=false, get redirect
	createURL := fmt.Sprintf("%s/webhdfs/v1%s?op=CREATE&user.name=%s&overwrite=true",
		w.baseURL, hdfsPath, url.QueryEscape(w.user))

	req, _ := http.NewRequest("PUT", createURL, nil)
	// We need to NOT follow the redirect to get the DataNode URL
	noRedirectClient := &http.Client{
		Timeout: 10 * time.Second,
		CheckRedirect: func(*http.Request, []*http.Request) error {
			return http.ErrUseLastResponse
		},
	}
	resp, err := noRedirectClient.Do(req)
	if err != nil {
		return fmt.Errorf("CREATE initiate: %w", err)
	}
	resp.Body.Close()

	dataNodeURL := resp.Header.Get("Location")
	if dataNodeURL == "" {
		// Some setups respond directly — fall back to direct write
		dataNodeURL = createURL
	}

	// Step 2: PUT data to DataNode URL
	req2, _ := http.NewRequest("PUT", dataNodeURL, bytes.NewReader(data))
	req2.Header.Set("Content-Type", "application/octet-stream")
	resp2, err := w.client.Do(req2)
	if err != nil {
		return fmt.Errorf("CREATE data: %w", err)
	}
	defer resp2.Body.Close()
	io.Copy(io.Discard, resp2.Body)

	if resp2.StatusCode != http.StatusCreated && resp2.StatusCode != http.StatusOK {
		return fmt.Errorf("unexpected status %d", resp2.StatusCode)
	}
	return nil
}

func (w *Writer) mkdirs(path string) error {
	mkdirURL := fmt.Sprintf("%s/webhdfs/v1%s?op=MKDIRS&user.name=%s",
		w.baseURL, path, url.QueryEscape(w.user))
	req, _ := http.NewRequest("PUT", mkdirURL, nil)
	resp, err := w.client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	io.Copy(io.Discard, resp.Body)
	return nil
}

func parentDir(path string) string {
	for i := len(path) - 1; i >= 0; i-- {
		if path[i] == '/' {
			return path[:i]
		}
	}
	return "/"
}
