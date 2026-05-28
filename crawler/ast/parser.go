package ast

import (
	"bufio"
	"math"
	"os"
	"path/filepath"
	"regexp"
	"strings"

	"github.com/spaolacci/murmur3"
)

type AnalysisResult struct {
	FunctionSignatures  []string `json:"function_signatures"`
	PublicAPICount      int      `json:"public_api_count"`
	TestFileRatio       float64  `json:"test_file_ratio"`
	ErrorHandlingDensity float64 `json:"error_handling_density"`
	MinHashFingerprint  []uint32 `json:"minhash_fingerprint"`
	TotalFiles          int      `json:"total_files"`
	TotalLines          int      `json:"total_lines"`
	Language            string   `json:"language"`
}

var (
	rePyFunc    = regexp.MustCompile(`^def\s+([a-zA-Z_]\w*)\s*\(`)
	reGoFunc    = regexp.MustCompile(`^func\s+(\w+)\s*\(`)
	reJSFunc    = regexp.MustCompile(`(?:function\s+(\w+)|const\s+(\w+)\s*=\s*(?:async\s*)?\()`)
	reJavaFunc  = regexp.MustCompile(`(?:public|protected)\s+\w+\s+(\w+)\s*\(`)
	reGoErr     = regexp.MustCompile(`if err != nil`)
	rePyErr     = regexp.MustCompile(`except\s+`)
	reJSErr     = regexp.MustCompile(`catch\s*\(`)
)

func AnalyzeRepo(repoPath string) AnalysisResult {
	var (
		result     AnalysisResult
		totalFiles int
		testFiles  int
		totalLines int
		errLines   int
		tokens     []string
	)

	// Detect primary language
	langCount := map[string]int{}
	filepath.WalkDir(repoPath, func(path string, d os.DirEntry, _ error) error {
		if d == nil || d.IsDir() {
			return nil
		}
		ext := strings.ToLower(filepath.Ext(path))
		switch ext {
		case ".py":
			langCount["Python"]++
		case ".go":
			langCount["Go"]++
		case ".js", ".ts":
			langCount["JavaScript"]++
		case ".java":
			langCount["Java"]++
		}
		return nil
	})
	result.Language = dominantLang(langCount)

	filepath.WalkDir(repoPath, func(path string, d os.DirEntry, _ error) error {
		if d == nil || d.IsDir() {
			return nil
		}
		ext := strings.ToLower(filepath.Ext(path))
		if !isSupportedExt(ext) {
			return nil
		}

		totalFiles++
		base := strings.ToLower(filepath.Base(path))
		if isTestFile(base) {
			testFiles++
		}

		f, err := os.Open(path)
		if err != nil {
			return nil
		}
		defer f.Close()

		scanner := bufio.NewScanner(f)
		for scanner.Scan() {
			line := scanner.Text()
			trimmed := strings.TrimSpace(line)
			totalLines++

			// Function extraction
			if sig := extractSig(trimmed, ext); sig != "" {
				result.FunctionSignatures = append(result.FunctionSignatures, sig)
				if isPublicSig(sig, ext) {
					result.PublicAPICount++
				}
			}

			// Error handling
			if matchesErrorPattern(trimmed, ext) {
				errLines++
			}

			// MinHash tokens
			words := strings.Fields(trimmed)
			tokens = append(tokens, words...)
		}
		return nil
	})

	result.TotalFiles = totalFiles
	result.TotalLines = totalLines

	if totalFiles > 0 {
		result.TestFileRatio = float64(testFiles) / float64(totalFiles)
	}
	if totalLines > 0 {
		result.ErrorHandlingDensity = float64(errLines) / float64(totalLines)
	}

	result.MinHashFingerprint = minHash(tokens, 128)

	// Cap signatures at 50 to keep JSON lean
	if len(result.FunctionSignatures) > 50 {
		result.FunctionSignatures = result.FunctionSignatures[:50]
	}

	return result
}

func extractSig(line, ext string) string {
	switch ext {
	case ".py":
		if m := rePyFunc.FindStringSubmatch(line); len(m) > 1 {
			return m[1]
		}
	case ".go":
		if m := reGoFunc.FindStringSubmatch(line); len(m) > 1 {
			return m[1]
		}
	case ".js", ".ts":
		if m := reJSFunc.FindStringSubmatch(line); len(m) > 0 {
			for _, g := range m[1:] {
				if g != "" {
					return g
				}
			}
		}
	case ".java":
		if m := reJavaFunc.FindStringSubmatch(line); len(m) > 1 {
			return m[1]
		}
	}
	return ""
}

func isPublicSig(sig, ext string) bool {
	switch ext {
	case ".py":
		return !strings.HasPrefix(sig, "_")
	case ".go":
		return sig != "" && sig[0] >= 'A' && sig[0] <= 'Z'
	case ".java":
		return true // already filtered to public/protected above
	}
	return true
}

func matchesErrorPattern(line, ext string) bool {
	switch ext {
	case ".go":
		return reGoErr.MatchString(line)
	case ".py":
		return rePyErr.MatchString(line)
	case ".js", ".ts":
		return reJSErr.MatchString(line)
	}
	return false
}

func isTestFile(name string) bool {
	return strings.HasPrefix(name, "test_") ||
		strings.HasSuffix(name, "_test.go") ||
		strings.HasSuffix(name, ".test.ts") ||
		strings.HasSuffix(name, ".spec.ts") ||
		strings.HasSuffix(name, "_test.py") ||
		strings.Contains(name, "test")
}

func isSupportedExt(ext string) bool {
	switch ext {
	case ".py", ".go", ".js", ".ts", ".java":
		return true
	}
	return false
}

func dominantLang(counts map[string]int) string {
	best, max := "", 0
	for lang, n := range counts {
		if n > max {
			max, best = n, lang
		}
	}
	return best
}

// minHash generates a MinHash fingerprint for near-duplicate detection.
func minHash(tokens []string, numHashes int) []uint32 {
	sig := make([]uint32, numHashes)
	for i := range sig {
		sig[i] = math.MaxUint32
	}
	for _, tok := range tokens {
		for i := 0; i < numHashes; i++ {
			h := murmur3.Sum32WithSeed([]byte(tok), uint32(i))
			if h < sig[i] {
				sig[i] = h
			}
		}
	}
	return sig
}
