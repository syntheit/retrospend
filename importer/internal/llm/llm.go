package llm

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

// OllamaRequest represents the payload for the Ollama API
type OllamaRequest struct {
	Model   string                 `json:"model"`
	Prompt  string                 `json:"prompt"`
	System  string                 `json:"system"`
	Format  interface{}            `json:"format,omitempty"`
	Stream  bool                   `json:"stream"`
	Options map[string]interface{} `json:"options,omitempty"`
}

// OllamaResponse represents the response from the Ollama API
type OllamaResponse struct {
	Response string `json:"response"`
}

// CallOllama sends a request to an Ollama instance and returns the response string.
// It automatically retries once after 2 seconds on transient failures.
func CallOllama(endpoint string, request OllamaRequest) (string, error) {
	maxRetries := 1
	baseDelay := 2 * time.Second

	var lastErr error
	for attempt := 0; attempt <= maxRetries; attempt++ {
		if attempt > 0 {
			// Exponential backoff: 2s, 4s, 8s, etc.
			delay := baseDelay * time.Duration(1<<uint(attempt-1))
			time.Sleep(delay)
		}

		response, err := callOllamaOnce(endpoint, request)
		if err == nil {
			return response, nil
		}

		lastErr = err

		// Don't retry on non-retryable errors (e.g., 400 Bad Request)
		if !isRetryableError(err) {
			break
		}
	}

	return "", lastErr
}

// callOllamaOnce makes a single attempt to call Ollama
func callOllamaOnce(endpoint string, request OllamaRequest) (string, error) {
	jsonData, err := json.Marshal(request)
	if err != nil {
		return "", fmt.Errorf("failed to marshal ollama request: %w", err)
	}

	// Create HTTP client with timeout to prevent hung requests
	client := &http.Client{
		Timeout: 120 * time.Second,
	}

	resp, err := client.Post(endpoint, "application/json", bytes.NewBuffer(jsonData))
	if err != nil {
		return "", fmt.Errorf("failed to connect to ollama: %w", err)
	}
	defer resp.Body.Close()

	bodyBytes, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", fmt.Errorf("failed to read ollama response: %w", err)
	}

	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("ollama API failed with status %d: %s", resp.StatusCode, string(bodyBytes))
	}

	var ollamaResp OllamaResponse
	if err := json.Unmarshal(bodyBytes, &ollamaResp); err != nil {
		return "", fmt.Errorf("failed to decode ollama response: %w (raw: %s)", err, string(bodyBytes))
	}

	return strings.TrimSpace(ollamaResp.Response), nil
}

// isRetryableError determines if an error should trigger a retry
func isRetryableError(err error) bool {
	if err == nil {
		return false
	}

	errStr := err.Error()

	// Retry on connection errors
	if strings.Contains(errStr, "failed to connect") {
		return true
	}

	// Retry on timeout errors
	if strings.Contains(errStr, "timeout") {
		return true
	}

	// Retry on 5xx server errors
	if strings.Contains(errStr, "status 5") {
		return true
	}

	// Don't retry on 4xx client errors (bad request, etc.)
	return false
}

// CleanJSONResponse strips markdown code blocks and whitespace from a string, finding the actual JSON data
func CleanJSONResponse(input string) string {
	res := strings.TrimSpace(input)
	// Try to find markdown code block first
	startIdx := strings.Index(res, "```json")
	if startIdx != -1 {
		endIdx := strings.LastIndex(res, "```")
		if endIdx > startIdx+7 {
			return strings.TrimSpace(res[startIdx+7 : endIdx])
		}
	}
	startIdx = strings.Index(res, "```")
	if startIdx != -1 {
		endIdx := strings.LastIndex(res, "```")
		if endIdx > startIdx+3 {
			// Ensure we are mostly grabbing JSON
			block := strings.TrimSpace(res[startIdx+3 : endIdx])
			if (strings.HasPrefix(block, "[") && strings.HasSuffix(block, "]")) || (strings.HasPrefix(block, "{") && strings.HasSuffix(block, "}")) {
				return block
			}
		}
	}

	// Fallback to finding the first array or object boundaries
	firstBracket := strings.Index(res, "[")
	lastBracket := strings.LastIndex(res, "]")
	firstBrace := strings.Index(res, "{")
	lastBrace := strings.LastIndex(res, "}")

	// Determine if it's an array or object
	isArr := firstBracket != -1 && lastBracket > firstBracket
	isObj := firstBrace != -1 && lastBrace > firstBrace

	if isArr && (!isObj || firstBracket < firstBrace) && lastBracket > lastBrace {
        return strings.TrimSpace(res[firstBracket : lastBracket+1])
    } else if isObj && (!isArr || firstBrace < firstBracket) && lastBrace > lastBracket {
        return strings.TrimSpace(res[firstBrace : lastBrace+1])
    }

	// Just return it cleaned if none found
	return res
}
