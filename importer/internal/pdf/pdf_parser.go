package pdf

import (
	"encoding/json"
	"fmt"
	"importer/internal/llm"
	"importer/internal/models"
	"importer/internal/processor"
	"log"
	"strings"
	"sync"
	"sync/atomic"
)

// transactionSchema is a JSON Schema that constrains Ollama's structured output.
// We wrap the array in a root object because qwen2.5 (and most models) handle
// root-object schemas more reliably than root-array schemas.
var transactionSchema = map[string]interface{}{
	"type": "object",
	"properties": map[string]interface{}{
		"transactions": map[string]interface{}{
			"type": "array",
			"items": map[string]interface{}{
				"type": "object",
				"properties": map[string]interface{}{
					"title":             map[string]interface{}{"type": "string"},
					"amount":            map[string]interface{}{"type": "number"},
					"currency":          map[string]interface{}{"type": "string"},
					"date":              map[string]interface{}{"type": "string"},
					"category":          map[string]interface{}{"type": "string"},
					"location":          map[string]interface{}{"type": "string"},
					"description":       map[string]interface{}{"type": "string"},
					"original_currency": map[string]interface{}{"type": "string"},
					"original_amount":   map[string]interface{}{"type": "number"},
				},
				"required": []string{
					"title", "amount", "currency", "date",
					"category", "location", "description",
					"original_currency", "original_amount",
				},
			},
		},
	},
	"required": []string{"transactions"},
}

// estimateTokenCount provides a rough estimate of token count (4 chars per token)
func estimateTokenCount(text string) int {
	return len(text) / 4
}

// deduplicateTransactions removes duplicate transactions based on date, title, and amount
func deduplicateTransactions(transactions []models.NormalizedTransaction) []models.NormalizedTransaction {
	seen := make(map[string]bool)
	var result []models.NormalizedTransaction

	for _, tx := range transactions {
		// Create a unique key from date + title + amount
		key := fmt.Sprintf("%s|%s|%.2f", tx.Date, tx.Title, tx.Amount)
		if !seen[key] {
			seen[key] = true
			result = append(result, tx)
		}
	}
	return result
}

// ParsePDFTransactions extracts transaction data from raw PDF text using an LLM.
// It automatically chunks large PDFs by page boundaries to avoid context limit issues.
// Returns transactions and metadata about the parsing process.
func ParsePDFTransactions(endpoint string, model string, rawText string, maxConcurrency int, onProgress func(float64, string)) ([]models.NormalizedTransaction, *models.ImportMetadata, error) {
	metadata := &models.ImportMetadata{
		Warnings: []string{},
	}
	// Sanitize text before token estimation (may reduce chunk count)
	rawText = SanitizePDFText(rawText)

	// Check if we need to chunk the input
	estimatedTokens := estimateTokenCount(rawText)
	const maxContextTokens = 8192 // Conservative limit for most models
	const systemPromptTokens = 500 // Approximate system prompt size

	// If the text is small enough, process it all at once
	if estimatedTokens+systemPromptTokens < maxContextTokens {
		if onProgress != nil {
			onProgress(0.1, "Parsing bank statement...")
		}
		transactions, err := parsePDFChunk(endpoint, model, rawText)
		if err != nil {
			return nil, metadata, err
		}
		metadata.TotalChunks = 1
		metadata.SuccessfulChunks = 1
		metadata.TotalTransactions = len(transactions)
		return transactions, metadata, nil
	}

	// Split by page boundaries (form-feed character)
	pages := strings.Split(rawText, "\f")
	if len(pages) <= 1 {
		// No form-feed characters, but text is large - split by estimated token count
		log.Printf("WARNING: Large PDF (%d estimated tokens) without page boundaries, processing as single chunk", estimatedTokens)
		metadata.Warnings = append(metadata.Warnings, "Large PDF processed as single chunk - some transactions may be missed")
		transactions, err := parsePDFChunk(endpoint, model, rawText)
		if err != nil {
			return nil, metadata, err
		}
		metadata.TotalChunks = 1
		metadata.SuccessfulChunks = 1
		metadata.TotalTransactions = len(transactions)
		return transactions, metadata, nil
	}

	if maxConcurrency <= 0 {
		maxConcurrency = 3
	}

	log.Printf("PDF has %d pages, processing in chunks to avoid context limits", len(pages))

	// Process pages in overlapping chunks (2 pages at a time, 1 page overlap)
	chunkSize := 2
	overlap := 1

	// Build chunk jobs
	type pdfChunkJob struct {
		index     int
		startPage int
		endPage   int
		text      string
	}

	type pdfChunkResult struct {
		transactions []models.NormalizedTransaction
		warning      string
	}

	var jobs []pdfChunkJob
	for i := 0; i < len(pages); i += chunkSize - overlap {
		end := i + chunkSize
		if end > len(pages) {
			end = len(pages)
		}
		chunkText := strings.Join(pages[i:end], "\f")
		jobs = append(jobs, pdfChunkJob{
			index:     len(jobs),
			startPage: i,
			endPage:   end,
			text:      chunkText,
		})
	}

	totalChunks := len(jobs)
	results := make([]pdfChunkResult, totalChunks)
	var atomicFailedChunks int32

	// Process chunks concurrently with bounded parallelism
	sem := make(chan struct{}, maxConcurrency)
	var wg sync.WaitGroup
	var completedChunks int32
	var progressMu sync.Mutex // Protects onProgress calls (writes to HTTP response)

	for _, job := range jobs {
		wg.Add(1)
		go func(j pdfChunkJob) {
			defer wg.Done()
			sem <- struct{}{}        // Acquire semaphore
			defer func() { <-sem }() // Release semaphore

			chunkTokens := estimateTokenCount(j.text)
			log.Printf("Processing pages %d-%d (%d estimated tokens)", j.startPage+1, j.endPage, chunkTokens)

			if onProgress != nil {
				progressMu.Lock()
				completed := atomic.LoadInt32(&completedChunks)
				onProgress(float64(completed)/float64(totalChunks), fmt.Sprintf("Parsing bank statement (pages %d-%d)...", j.startPage+1, j.endPage))
				progressMu.Unlock()
			}

			transactions, err := parsePDFChunk(endpoint, model, j.text)
			if err != nil {
				atomic.AddInt32(&atomicFailedChunks, 1)
				warningMsg := fmt.Sprintf("Failed to parse pages %d-%d: %v", j.startPage+1, j.endPage, err)
				log.Printf("WARNING: %s", warningMsg)
				results[j.index] = pdfChunkResult{warning: warningMsg}
			} else {
				results[j.index] = pdfChunkResult{transactions: transactions}
			}

			completed := atomic.AddInt32(&completedChunks, 1)
			if onProgress != nil {
				progressMu.Lock()
				onProgress(float64(completed)/float64(totalChunks), fmt.Sprintf("Parsing bank statement (%d/%d chunks)...", completed, totalChunks))
				progressMu.Unlock()
			}
		}(job)
	}

	wg.Wait()

	// Collect results in order
	var allTransactions []models.NormalizedTransaction
	for _, r := range results {
		if r.warning != "" {
			metadata.Warnings = append(metadata.Warnings, r.warning)
		}
		allTransactions = append(allTransactions, r.transactions...)
	}

	failedChunks := int(atomicFailedChunks)

	metadata.TotalChunks = totalChunks
	metadata.SuccessfulChunks = totalChunks - failedChunks
	metadata.FailedChunks = failedChunks

	// CRITICAL: Fail loudly if >20% of chunks failed
	failureRate := float64(failedChunks) / float64(totalChunks)
	if failureRate > 0.20 {
		return nil, metadata, fmt.Errorf("CRITICAL: %.0f%% of PDF chunks failed to parse (%d/%d failed). This indicates significant data loss. Please check the PDF format or try a different file",
			failureRate*100, failedChunks, totalChunks)
	}

	// Deduplicate transactions that may have appeared in overlapping chunks
	beforeDedup := len(allTransactions)
	allTransactions = deduplicateTransactions(allTransactions)
	afterDedup := len(allTransactions)

	if beforeDedup > afterDedup {
		metadata.Warnings = append(metadata.Warnings, fmt.Sprintf("Removed %d duplicate transactions from overlapping chunks", beforeDedup-afterDedup))
	}

	metadata.TotalTransactions = len(allTransactions)

	// Fail loudly if no transactions were extracted
	if len(allTransactions) == 0 {
		return nil, metadata, fmt.Errorf("CRITICAL: No transactions extracted from PDF. The file may be empty, corrupted, or in an unsupported format")
	}

	log.Printf("Extracted %d unique transactions from %d pages (%d chunks, %d failed)", len(allTransactions), len(pages), totalChunks, failedChunks)

	return allTransactions, metadata, nil
}

// parsePDFChunk processes a single chunk of PDF text
func parsePDFChunk(endpoint string, model string, rawText string) ([]models.NormalizedTransaction, error) {
	systemPrompt := `You are a highly precise financial data extraction tool. Extract individual debit transactions from bank statement text and output them as a JSON object with a "transactions" key.

CRITICAL RULES:
1. EXPENSES ONLY: Only include actual purchases/charges (debit transactions). Skip payments, credits, refunds, and "THANK YOU" entries.
2. DATE: Use the Trans Date (first date column). Format as YYYY-MM-DD. Use the statement year shown in the text (e.g. if billing period is Nov 2025 - Dec 2025, use 2025 for Nov/Dec dates).
3. AMOUNT: The USD charge amount listed on the same line as the merchant name. Output as a positive number (e.g. 9.37, not "$9.37").
4. TITLE: The merchant/description text. Clean it up (remove exchange rate text).
5. LOCATION: Extract city/country if present at the end of the merchant string, e.g. "FLORIANOPOLIS BR". Otherwise "".
6. CURRENCY: Always "USD".
7. FOREIGN DATA: A foreign currency appears on the lines AFTER the USD amount, like:
     $49.96
     BRL
     5.331910352 Exchange Rate
   In this case, original_amount = 49.96, original_currency = "BRL".
   If no foreign currency lines follow, use original_currency = "" and original_amount = 0.
8. CATEGORY and DESCRIPTION: Leave as empty strings "".

Example - given this raw text segment:
  Nov 21   Nov 21   UBER* TRIPOSASCOSP   $9.37
  $49.96
  BRL
  5.331910352 Exchange Rate
  Nov 21   Nov 24   PAYU*AR*UBERCAP.FEDERAL   $12.10
  $16,322.00
  ARS
  1348.925619835 Exchange Rate

Output:
{"transactions":[
  {"title":"Uber Triposasco SP","amount":9.37,"currency":"USD","date":"2025-11-21","category":"","location":"SP","description":"","original_currency":"BRL","original_amount":49.96},
  {"title":"PayU AR Uber Cap Federal","amount":12.10,"currency":"USD","date":"2025-11-21","category":"","location":"","description":"","original_currency":"ARS","original_amount":16322.00}
]}`

	prompt := "EXTRACT ALL EXPENSE TRANSACTIONS FROM THE FOLLOWING BANK STATEMENT TEXT:\n\n" + rawText

	reqBody := llm.OllamaRequest{
		Model:  model,
		Prompt: prompt,
		System: systemPrompt,
		Stream: false,
		Format: transactionSchema,
		Options: map[string]interface{}{
			"temperature": 0,
			"num_ctx":     16384, // Set explicit context window size
		},
	}

	response, err := llm.CallOllama(endpoint, reqBody)
	if err != nil {
		return nil, err
	}

	cleanJSON := llm.CleanJSONResponse(response)

	var transactions []models.NormalizedTransaction
	// Primary parse: expect {"transactions": [...]}
	var wrapper struct {
		Transactions []models.NormalizedTransaction `json:"transactions"`
	}
	if err := json.Unmarshal([]byte(cleanJSON), &wrapper); err == nil {
		transactions = wrapper.Transactions
	} else {
		// Fallback: try parsing as a bare array
		if err2 := json.Unmarshal([]byte(cleanJSON), &transactions); err2 != nil {
			return nil, fmt.Errorf("LLM did not output a JSON object with a 'transactions' key containing an array of expense transaction objects. Fallback to bare array also failed: %w (raw response: %s)", err2, response)
		}
	}

	if len(transactions) == 0 {
		return transactions, nil
	}

	for i := range transactions {
		transactions[i].OriginalCurrency = processor.NormalizeCurrency(transactions[i].OriginalCurrency)
	}

	return transactions, nil
}
