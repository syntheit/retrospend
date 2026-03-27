package llm

import (
	"encoding/json"
	"fmt"
	"retrospend-sidecar/importer/models"
	"log"
	"strings"
	"sync"
)

// EnrichInput represents the data sent to the LLM for enrichment.
type EnrichInput struct {
	Index   int    `json:"index"`
	RawText string `json:"raw_text"`
}

// EnrichOutput represents the enriched data returned by the LLM.
type EnrichOutput struct {
	Index    int    `json:"index"`
	Title    string `json:"title"`
	Location string `json:"location"`
	Category string `json:"category"`
}

// enrichSchema is a JSON Schema for structured enrichment output.
// Wrapping in a root object for maximum model compatibility.
var enrichSchema = map[string]interface{}{
	"type": "object",
	"properties": map[string]interface{}{
		"enriched": map[string]interface{}{
			"type": "array",
			"items": map[string]interface{}{
				"type": "object",
				"properties": map[string]interface{}{
					"index":    map[string]interface{}{"type": "integer"},
					"title":    map[string]interface{}{"type": "string"},
					"location": map[string]interface{}{"type": "string"},
					"category": map[string]interface{}{"type": "string"},
				},
				"required": []string{"index", "title", "location", "category"},
			},
		},
	},
	"required": []string{"enriched"},
}

// EnrichTransactions enhances transaction data with better titles and categories using an LLM.
// Returns enriched transactions and metadata about the enrichment process.
func EnrichTransactions(provider Provider, model string, transactions []models.NormalizedTransaction, categories []string, batchSize int, maxConcurrency int, onProgress func(float64, string)) ([]models.NormalizedTransaction, *models.ImportMetadata, int, error) {
	metadata := &models.ImportMetadata{
		Warnings: []string{},
	}
	totalTokens := 0
	if len(transactions) == 0 {
		return transactions, metadata, totalTokens, nil
	}

	// 1. Group transactions by unique raw text (cleaned for better deduplication)
	uniqueRawToIndices := make(map[string][]int)
	for i, t := range transactions {
		rawText := strings.TrimSpace(t.Title + " " + t.Location)
		if rawText == "" {
			continue
		}
		// Clean noise from merchant text before deduplication
		rawText = CleanMerchantText(rawText)
		uniqueRawToIndices[rawText] = append(uniqueRawToIndices[rawText], i)
	}

	if len(uniqueRawToIndices) == 0 {
		return transactions, metadata, totalTokens, nil
	}

	// 2. Check enrichment cache for already-known merchants
	rawToResult := make(map[string]EnrichOutput)
	var uncachedRawTexts []string
	cacheHits := 0

	for raw := range uniqueRawToIndices {
		if cached, ok := GetCachedEnrichment(raw); ok {
			rawToResult[raw] = EnrichOutput{
				Title:    cached.Title,
				Location: cached.Location,
				Category: cached.Category,
			}
			cacheHits++
		} else {
			uncachedRawTexts = append(uncachedRawTexts, raw)
		}
	}

	if cacheHits > 0 {
		log.Printf("Enrichment cache hit: %d/%d unique merchants cached, %d need LLM", cacheHits, len(uniqueRawToIndices), len(uncachedRawTexts))
	}

	// Use uncached texts for batching (may be empty if everything is cached)
	uniqueRawTexts := uncachedRawTexts

	if batchSize <= 0 {
		batchSize = 20
	}
	if maxConcurrency <= 0 {
		maxConcurrency = 3
	}

	categoriesJSON, _ := json.Marshal(categories)

	systemPrompt := "You are a data enrichment assistant for a financial app. You will receive an array of objects with an 'index' and 'raw_text', plus a list of valid categories. Return a JSON object with an 'enriched' key containing an array of objects with 'index', 'title', 'location', and 'category'. Example format: {\"enriched\": [{\"index\": 0, \"title\": \"...\", \"location\": \"...\", \"category\": \"...\"}]}. You MUST include the exact same 'index' in your response.\n\n" +
		"CRITICAL RULES:\n" +
		"1. 'title': Extract the clean business or transaction name.\n" +
		"   - If it is a transfer (e.g., 'Funds Tran', 'XFER', 'Money Transfer'), use 'Transfer'.\n" +
		"   - REMOVE person names if they appear to be the account holder or a redundant recipient in a transfer (e.g., 'Ethan Girouard Funds Tran Ethan Girouard' -> 'Transfer').\n" +
		"   - REMOVE transaction noise: city names, states, store numbers, and internal bank codes (e.g., 'Target #1234 Brooklyn NY' -> 'Target').\n" +
		"   - Keep the actual business name. If the name is 'Demoulas Super Market', keep it in 'title'.\n" +
		"   - Only use words that appear in the raw_text to construct the title.\n" +
		"2. 'location': Extract ONLY the geographic city/state/country. DO NOT put business names here.\n" +
		"3. 'category': Strictly choose the best fit from the valid list.\n" +
		"   - Use 'Transfer' for all internal transfers or money movements between accounts.\n" +
		"   - 'Groceries': Markets, supermarkets, convenience stores.\n" +
		"   - 'Dining Out': Restaurants, fast food.\n\n" +
		"EXAMPLES:\n" +
		"- Raw: 'DLO*RAPPI 7523CAP.FEDERAL' -> Title: 'Rappi', Location: 'Capital Federal', Category: 'Food Delivery'\n" +
		"- Raw: 'ETHAN GIROUARD Funds Tran ETHAN GIROUARD' -> Title: 'Transfer', Location: '', Category: 'Transfer'\n" +
		"- Raw: 'DEMOULAS SUPER M PRENOTES 0673373MUTQ' -> Title: 'Demoulas Super Market', Location: '', Category: 'Groceries'"

	var mu sync.Mutex // Protects rawToResult map and totalTokens

	// Create batches
	type batchJob struct {
		startIdx int
		endIdx   int
		chunk    []EnrichInput
	}

	var jobs []batchJob
	for i := 0; i < len(uniqueRawTexts); i += batchSize {
		end := i + batchSize
		if end > len(uniqueRawTexts) {
			end = len(uniqueRawTexts)
		}

		// Create chunk with LOCAL indices (0 to chunkSize-1)
		// This prevents LLMs from getting confused by large index numbers
		var chunk []EnrichInput
		for localIdx, globalIdx := 0, i; globalIdx < end; localIdx, globalIdx = localIdx+1, globalIdx+1 {
			chunk = append(chunk, EnrichInput{
				Index:   localIdx,
				RawText: uniqueRawTexts[globalIdx],
			})
		}

		jobs = append(jobs, batchJob{startIdx: i, endIdx: end, chunk: chunk})
	}

	// Process batches concurrently with bounded parallelism
	sem := make(chan struct{}, maxConcurrency)
	var wg sync.WaitGroup

	totalBatches := len(jobs)
	var completedBatches int
	var failedBatches int
	var progressMu sync.Mutex

	for _, job := range jobs {
		wg.Add(1)
		go func(j batchJob) {
			defer wg.Done()
			sem <- struct{}{}        // Acquire semaphore
			defer func() { <-sem }() // Release semaphore

			if onProgress != nil {
				progressMu.Lock()
				onProgress(float64(completedBatches)/float64(totalBatches), fmt.Sprintf("Enriching transactions (batch %d/%d)...", completedBatches+1, totalBatches))
				progressMu.Unlock()
			}

			chunkJSON, _ := json.Marshal(j.chunk)
			userPrompt := fmt.Sprintf("Valid Categories: %s\n\nTransactions: %s", string(categoriesJSON), string(chunkJSON))

			genReq := GenerateRequest{
				SystemPrompt: systemPrompt,
				UserPrompt:   userPrompt,
				Model:        model,
				Format:       enrichSchema,
			}

			resp, err := provider.Generate(genReq)
			if err != nil {
				errMsg := fmt.Sprintf("Enrichment failed for batch %d-%d: %v", j.startIdx, j.endIdx-1, err)
				log.Printf("WARNING: %s", errMsg)

				progressMu.Lock()
				failedBatches++
				progressMu.Unlock()

				mu.Lock()
				metadata.Warnings = append(metadata.Warnings, errMsg)
				mu.Unlock()
				return
			}

			mu.Lock()
			totalTokens += resp.TotalTokens
			mu.Unlock()

			cleanJSON := CleanJSONResponse(resp.Content)

			// Try parsing as wrapped format {"enriched": [...]} first,
			// then fall back to plain array [...] for models that ignore the schema.
			var enrichedItems []EnrichOutput
			var wrapper struct {
				Enriched []EnrichOutput `json:"enriched"`
			}

			if err := json.Unmarshal([]byte(cleanJSON), &wrapper); err == nil && len(wrapper.Enriched) > 0 {
				enrichedItems = wrapper.Enriched
			} else if err := json.Unmarshal([]byte(cleanJSON), &enrichedItems); err != nil {
				errMsg := fmt.Sprintf("Failed to parse enrichment response for batch %d-%d", j.startIdx, j.endIdx-1)
				log.Printf("WARNING: %s: %s", errMsg, resp.Content)

				progressMu.Lock()
				failedBatches++
				progressMu.Unlock()

				mu.Lock()
				metadata.Warnings = append(metadata.Warnings, errMsg)
				mu.Unlock()
				return
			}

			mu.Lock()
			for _, out := range enrichedItems {
				// Map local index back to global position
				globalIdx := j.startIdx + out.Index
				if globalIdx >= 0 && globalIdx < len(uniqueRawTexts) {
					rawText := uniqueRawTexts[globalIdx]
					rawToResult[rawText] = out
				} else {
					warnMsg := fmt.Sprintf("LLM returned out-of-bounds index %d for batch starting at %d", out.Index, j.startIdx)
					log.Printf("WARNING: %s", warnMsg)
					metadata.Warnings = append(metadata.Warnings, warnMsg)
				}
			}
			mu.Unlock()

			if onProgress != nil {
				progressMu.Lock()
				completedBatches++
				onProgress(float64(completedBatches)/float64(totalBatches), fmt.Sprintf("Enriching transactions (batch %d/%d)...", completedBatches, totalBatches))
				progressMu.Unlock()
			}
		}(job)
	}

	wg.Wait() // Wait for all batches to complete

	// Save new LLM results to enrichment cache
	newCacheEntries := make(map[string]EnrichCacheEntry)
	for _, rawText := range uniqueRawTexts {
		if result, ok := rawToResult[rawText]; ok {
			newCacheEntries[rawText] = EnrichCacheEntry{
				Title:    result.Title,
				Location: result.Location,
				Category: result.Category,
			}
		}
	}
	SaveBatchToEnrichmentCache(newCacheEntries)

	// Populate metadata
	metadata.TotalChunks = totalBatches
	metadata.SuccessfulChunks = totalBatches - failedBatches
	metadata.FailedChunks = failedBatches

	// CRITICAL: Fail loudly if >20% of batches failed
	if totalBatches > 0 {
		failureRate := float64(failedBatches) / float64(totalBatches)
		if failureRate > 0.20 {
			return nil, metadata, totalTokens, fmt.Errorf("CRITICAL: %.0f%% of enrichment batches failed (%d/%d failed). This indicates significant data quality issues. Raw transaction data is unreliable",
				failureRate*100, failedBatches, totalBatches)
		}
	}

	// 3. Apply results back to all transactions
	enrichedCount := 0
	for raw, result := range rawToResult {
		indices := uniqueRawToIndices[raw]
		for _, txIdx := range indices {
			transactions[txIdx].Title = result.Title
			transactions[txIdx].Location = result.Location
			transactions[txIdx].Category = result.Category
			enrichedCount++
		}
	}

	unenrichedCount := len(transactions) - enrichedCount
	if unenrichedCount > 0 {
		metadata.Warnings = append(metadata.Warnings, fmt.Sprintf("%d transactions could not be enriched and will use raw data", unenrichedCount))
	}

	metadata.TotalTransactions = len(transactions)

	return transactions, metadata, totalTokens, nil
}
