package llm

import (
	"encoding/json"
	"fmt"
	"importer/internal/models"
	"strings"
)

// DiscoverCSVSchema uses an LLM to identify the mapping of columns in a CSV file.
func DiscoverCSVSchema(endpoint string, model string, header string, sampleRows []string) (models.CSVSchema, error) {
	payload := header + "\n" + strings.Join(sampleRows, "\n")

	systemPrompt := `You are a CSV schema analyzer for a financial application. You will receive a CSV header and 3 sample rows. Identify the column indices (0-indexed) for the Date, Amount, and Merchant/Payee. 
  
  CRITICAL RULES:
  1. 'date_col_idx': The index of the transaction date. Look for 'Date', 'Post Date', 'Posting Date', 'Transaction Date'.
  2. 'merchant_col_idx': The index of the merchant, description, or payee name. This is usually named 'Description', 'Payee', 'Merchant', 'Details', or 'Narrative'. Choose the column that actually contains text descriptions in the sample rows.
  3. 'amount_col_idx': The index of the transaction amount. Omit this if there are separate debit and credit columns.
  4. 'debit_col_idx': The index of the debit amount column. Omit if single amount column.
  5. 'credit_col_idx': The index of the credit amount column. Omit if single amount column.
  6. 'date_format': Provide the exact Go time package layout string. Use '1/2/2006' for M/D/YYYY formats, or '2006-01-02' for YYYY-MM-DD.
  7. 'invert_amounts': Return true if the sample EXPENSES are represented as positive numbers (e.g. a charge of $10 is listed as 10.00), or false if they are negative. Use false if using separate debit/credit columns.
  
  Return ONLY a valid JSON object matching these exact keys.`

	reqBody := OllamaRequest{
		Model:  model,
		System: systemPrompt,
		Prompt: payload,
		Stream: false,
		Format: "json",
	}

	response, err := CallOllama(endpoint, reqBody)
	if err != nil {
		return models.CSVSchema{}, fmt.Errorf("failed to discover CSV schema: %w", err)
	}

	cleanJSON := CleanJSONResponse(response)

	var schema models.CSVSchema
	if err := json.Unmarshal([]byte(cleanJSON), &schema); err != nil {
		return models.CSVSchema{}, fmt.Errorf("failed to parse CSV schema from LLM: %w (raw response: %s)", err, response)
	}

	return schema, nil
}
