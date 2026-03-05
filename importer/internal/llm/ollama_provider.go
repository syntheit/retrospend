package llm

// OllamaProvider wraps the existing Ollama HTTP API into the Provider interface.
type OllamaProvider struct {
	Endpoint string
}

func NewOllamaProvider(endpoint string) *OllamaProvider {
	return &OllamaProvider{Endpoint: endpoint}
}

func (p *OllamaProvider) Name() string {
	return "ollama"
}

func (p *OllamaProvider) Generate(req GenerateRequest) (GenerateResponse, error) {
	ollamaReq := OllamaRequest{
		Model:   req.Model,
		System:  req.SystemPrompt,
		Prompt:  req.UserPrompt,
		Stream:  false,
		Format:  req.Format,
		Options: req.Options,
	}

	content, err := CallOllama(p.Endpoint, ollamaReq)
	if err != nil {
		return GenerateResponse{}, err
	}

	// Ollama doesn't return token counts; estimate them
	promptTokens := EstimateTokenCount(req.SystemPrompt + req.UserPrompt)
	completionTokens := EstimateTokenCount(content)

	return GenerateResponse{
		Content:          content,
		PromptTokens:     promptTokens,
		CompletionTokens: completionTokens,
		TotalTokens:      promptTokens + completionTokens,
	}, nil
}

