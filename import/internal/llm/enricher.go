package llm

import (
	"encoding/json"
	"fmt"
	"importer/internal/models"
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
func EnrichTransactions(endpoint string, model string, transactions []models.NormalizedTransaction, categories []string, onProgress func(float64, string)) ([]models.NormalizedTransaction, error) {
	if len(transactions) == 0 {
		return transactions, nil
	}

	// 1. Group transactions by unique raw text
	uniqueRawToIndices := make(map[string][]int)
	for i, t := range transactions {
		rawText := strings.TrimSpace(t.Title + " " + t.Location)
		if rawText == "" {
			continue
		}
		uniqueRawToIndices[rawText] = append(uniqueRawToIndices[rawText], i)
	}

	if len(uniqueRawToIndices) == 0 {
		return transactions, nil
	}

	// 2. Prepare unique inputs (just raw texts, we'll index them locally per batch)
	var uniqueRawTexts []string
	for raw := range uniqueRawToIndices {
		uniqueRawTexts = append(uniqueRawTexts, raw)
	}

	categoriesJSON, _ := json.Marshal(categories)
	batchSize := 10 // Can be larger since we have fewer unique items

	systemPrompt := "You are a data enrichment assistant for a financial app. You will receive an array of objects with an 'index' and 'raw_text', plus a list of valid categories. Return a JSON array of objects containing 'index', 'title', 'location', and 'category'. You MUST include the exact same 'index' in your response.\n\n" +
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

	rawToResult := make(map[string]EnrichOutput)
	var mu sync.Mutex // Protects rawToResult map

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
	maxConcurrency := 3 // Configurable concurrency limit
	sem := make(chan struct{}, maxConcurrency)
	var wg sync.WaitGroup

	totalBatches := len(jobs)
	var completedBatches int
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

			reqBody := OllamaRequest{
				Model:  model,
				System: systemPrompt,
				Prompt: userPrompt,
				Stream: false,
				Format: enrichSchema,
			}

			response, err := CallOllama(endpoint, reqBody)
			if err != nil {
				log.Printf("WARNING: chunk enrichment failed (batch %d-%d): %v", j.startIdx, j.endIdx-1, err)
				return
			}

			cleanJSON := CleanJSONResponse(response)
			var wrapper struct {
				Enriched []EnrichOutput `json:"enriched"`
			}

			if err := json.Unmarshal([]byte(cleanJSON), &wrapper); err == nil {
				mu.Lock()
				for _, out := range wrapper.Enriched {
					// Map local index back to global position
					globalIdx := j.startIdx + out.Index
					if globalIdx >= 0 && globalIdx < len(uniqueRawTexts) {
						rawText := uniqueRawTexts[globalIdx]
						rawToResult[rawText] = out
					} else {
						log.Printf("WARNING: LLM returned out-of-bounds index %d for chunk starting at %d", out.Index, j.startIdx)
					}
				}
				mu.Unlock()

				if onProgress != nil {
					progressMu.Lock()
					completedBatches++
					onProgress(float64(completedBatches)/float64(totalBatches), fmt.Sprintf("Enriching transactions (batch %d/%d)...", completedBatches, totalBatches))
					progressMu.Unlock()
				}
			} else {
				log.Printf("WARNING: failed to parse enrichment response for batch %d-%d: %s", j.startIdx, j.endIdx-1, response)
			}
		}(job)
	}

	wg.Wait() // Wait for all batches to complete

	// 3. Apply results back to all transactions
	for raw, result := range rawToResult {
		indices := uniqueRawToIndices[raw]
		for _, txIdx := range indices {
			transactions[txIdx].Title = result.Title
			transactions[txIdx].Location = result.Location
			transactions[txIdx].Category = result.Category
		}
	}

	return transactions, nil
}
