package llm

// Provider is the interface for LLM backends (Ollama, OpenRouter, etc.)
type Provider interface {
	Generate(req GenerateRequest) (GenerateResponse, error)
	Name() string
}

// GenerateRequest is a provider-agnostic LLM request.
type GenerateRequest struct {
	SystemPrompt string
	UserPrompt   string
	Model        string
	Format       interface{} // JSON schema map or "json" string
	Options      map[string]interface{}
}

// GenerateResponse is a provider-agnostic LLM response.
type GenerateResponse struct {
	Content          string
	PromptTokens     int
	CompletionTokens int
	TotalTokens      int
}

// EstimateTokenCount provides a rough estimate of token count (4 chars per token).
func EstimateTokenCount(text string) int {
	return len(text) / 4
}
