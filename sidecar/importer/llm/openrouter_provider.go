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

const openRouterBaseURL = "https://openrouter.ai/api/v1/chat/completions"

// OpenRouterProvider implements the Provider interface using the OpenRouter API
// (OpenAI-compatible chat completions).
type OpenRouterProvider struct {
	APIKey string
}

func NewOpenRouterProvider(apiKey string) *OpenRouterProvider {
	return &OpenRouterProvider{APIKey: apiKey}
}

func (p *OpenRouterProvider) Name() string {
	return "openrouter"
}

// OpenAI-compatible request/response types

type chatMessage struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

type chatRequest struct {
	Model          string                 `json:"model"`
	Messages       []chatMessage          `json:"messages"`
	ResponseFormat map[string]interface{} `json:"response_format,omitempty"`
	Temperature    *float64               `json:"temperature,omitempty"`
	Stream         bool                   `json:"stream"`
}

type chatResponse struct {
	Choices []struct {
		Message struct {
			Content string `json:"content"`
		} `json:"message"`
	} `json:"choices"`
	Usage struct {
		PromptTokens     int `json:"prompt_tokens"`
		CompletionTokens int `json:"completion_tokens"`
		TotalTokens      int `json:"total_tokens"`
	} `json:"usage"`
}

func (p *OpenRouterProvider) Generate(req GenerateRequest) (GenerateResponse, error) {
	maxRetries := 1
	baseDelay := 2 * time.Second

	var lastErr error
	for attempt := 0; attempt <= maxRetries; attempt++ {
		if attempt > 0 {
			delay := baseDelay * time.Duration(1<<uint(attempt-1))
			time.Sleep(delay)
		}

		resp, err := p.generateOnce(req)
		if err == nil {
			return resp, nil
		}

		lastErr = err
		if !isRetryableError(err) {
			break
		}
	}

	return GenerateResponse{}, lastErr
}

func (p *OpenRouterProvider) generateOnce(req GenerateRequest) (GenerateResponse, error) {
	messages := []chatMessage{}
	if req.SystemPrompt != "" {
		messages = append(messages, chatMessage{Role: "system", Content: req.SystemPrompt})
	}
	messages = append(messages, chatMessage{Role: "user", Content: req.UserPrompt})

	body := chatRequest{
		Model:    req.Model,
		Messages: messages,
		Stream:   false,
	}

	// Map temperature from Options
	if req.Options != nil {
		if temp, ok := req.Options["temperature"]; ok {
			if t, ok := temp.(float64); ok {
				body.Temperature = &t
			} else if t, ok := temp.(int); ok {
				f := float64(t)
				body.Temperature = &f
			}
		}
	}

	// Map Format to response_format
	if req.Format != nil {
		switch f := req.Format.(type) {
		case map[string]interface{}:
			// Structured JSON schema: use json_schema response format
			// strict is false because schemas don't include additionalProperties: false
			body.ResponseFormat = map[string]interface{}{
				"type": "json_schema",
				"json_schema": map[string]interface{}{
					"name":   "response",
					"strict": false,
					"schema": f,
				},
			}
		case string:
			if f == "json" {
				body.ResponseFormat = map[string]interface{}{
					"type": "json_object",
				}
			}
		}
	}

	jsonData, err := json.Marshal(body)
	if err != nil {
		return GenerateResponse{}, fmt.Errorf("failed to marshal openrouter request: %w", err)
	}

	httpReq, err := http.NewRequest("POST", openRouterBaseURL, bytes.NewBuffer(jsonData))
	if err != nil {
		return GenerateResponse{}, fmt.Errorf("failed to create openrouter request: %w", err)
	}

	httpReq.Header.Set("Content-Type", "application/json")
	httpReq.Header.Set("Authorization", "Bearer "+p.APIKey)
	httpReq.Header.Set("HTTP-Referer", "https://retrospend.app")
	httpReq.Header.Set("X-Title", "Retrospend")

	client := &http.Client{Timeout: 120 * time.Second}
	resp, err := client.Do(httpReq)
	if err != nil {
		return GenerateResponse{}, fmt.Errorf("failed to connect to openrouter: %w", err)
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return GenerateResponse{}, fmt.Errorf("failed to read openrouter response: %w", err)
	}

	if resp.StatusCode != http.StatusOK {
		return GenerateResponse{}, fmt.Errorf("openrouter API failed with status %d: %s", resp.StatusCode, string(respBody))
	}

	var chatResp chatResponse
	if err := json.Unmarshal(respBody, &chatResp); err != nil {
		return GenerateResponse{}, fmt.Errorf("failed to decode openrouter response: %w (raw: %s)", err, string(respBody))
	}

	if len(chatResp.Choices) == 0 {
		return GenerateResponse{}, fmt.Errorf("openrouter returned no choices")
	}

	content := strings.TrimSpace(chatResp.Choices[0].Message.Content)

	return GenerateResponse{
		Content:          content,
		PromptTokens:     chatResp.Usage.PromptTokens,
		CompletionTokens: chatResp.Usage.CompletionTokens,
		TotalTokens:      chatResp.Usage.TotalTokens,
	}, nil
}
