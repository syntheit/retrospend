package adapters

import (
	"encoding/csv"
	"fmt"
	"importer/internal/models"
	"io"
	"log"
	"strconv"
	"strings"
	"time"
)

// DynamicAdapter implements the BankAdapter interface using a discovered schema.
type DynamicAdapter struct {
	Schema models.CSVSchema
}

// NewDynamicAdapter creates a new DynamicAdapter with the given schema.
func NewDynamicAdapter(schema models.CSVSchema) *DynamicAdapter {
	return &DynamicAdapter{Schema: schema}
}

// Parse implements the BankAdapter interface.
func (a *DynamicAdapter) Parse(reader io.Reader) ([]models.NormalizedTransaction, error) {
	return ParseDynamicCSV(reader, a.Schema)
}

// ParseDynamicCSV parses a CSV file using the provided schema mapping.
func ParseDynamicCSV(reader io.Reader, schema models.CSVSchema) ([]models.NormalizedTransaction, error) {
	// Validate required schema fields
	if schema.DateColIdx < 0 {
		return nil, fmt.Errorf("schema validation failed: DateColIdx is not set")
	}
	if schema.MerchantColIdx < 0 {
		return nil, fmt.Errorf("schema validation failed: MerchantColIdx is not set")
	}
	if schema.AmountColIdx == nil && schema.DebitColIdx == nil && schema.CreditColIdx == nil {
		return nil, fmt.Errorf("schema validation failed: no amount column specified")
	}

	csvReader := csv.NewReader(reader)

	// Read and skip the header row.
	_, err := csvReader.Read()
	if err != nil {
		return nil, fmt.Errorf("failed to read header in dynamic parser: %w", err)
	}

	var transactions []models.NormalizedTransaction
	rowNum := 1 // Header was row 0

	for {
		record, err := csvReader.Read()
		if err != nil {
			if err == io.EOF {
				break
			}
			return nil, fmt.Errorf("failed to read record at row %d: %w", rowNum, err)
		}
		rowNum++

		// Basic validation: ensure indices are within bounds
		maxIdx := schema.DateColIdx
		if schema.MerchantColIdx > maxIdx {
			maxIdx = schema.MerchantColIdx
		}
		if schema.AmountColIdx != nil && *schema.AmountColIdx > maxIdx {
			maxIdx = *schema.AmountColIdx
		}
		if schema.DebitColIdx != nil && *schema.DebitColIdx > maxIdx {
			maxIdx = *schema.DebitColIdx
		}
		if schema.CreditColIdx != nil && *schema.CreditColIdx > maxIdx {
			maxIdx = *schema.CreditColIdx
		}

		if len(record) <= maxIdx {
			log.Printf("Warning: row %d has insufficient columns for discovered schema (skipping)", rowNum)
			continue
		}

		dateStr := strings.TrimSpace(record[schema.DateColIdx])
		merchant := strings.TrimSpace(record[schema.MerchantColIdx])

		// 1. Parse Date - be flexible with leading zeros
		var date time.Time
		var parseErr error

		// Try the format provided by LLM first
		date, parseErr = time.Parse(schema.DateFormat, dateStr)

		// Fallback: try common formats if LLM format fails
		if parseErr != nil {
			formats := []string{
				"1/2/2006",   // M/D/YYYY
				"01/02/2006", // MM/DD/YYYY
				"2006-01-02", // YYYY-MM-DD
				"1/2/06",     // M/D/YY
				"01/02/06",   // MM/DD/YY
			}
			for _, f := range formats {
				if d, err := time.Parse(f, dateStr); err == nil {
					date = d
					parseErr = nil
					break
				}
			}
		}

		if parseErr != nil {
			log.Printf("Warning: failed to parse date '%s' at row %d: %v", dateStr, rowNum, parseErr)
			continue
		}

		// 2. Parse Amount
		var amount float64
		var amountParsed bool

		if schema.AmountColIdx != nil {
			amountStr := strings.TrimSpace(record[*schema.AmountColIdx])
			if amountStr != "" {
				cleanAmount := strings.ReplaceAll(amountStr, "$", "")
				cleanAmount = strings.ReplaceAll(cleanAmount, ",", "")
				cleanAmount = strings.TrimSpace(cleanAmount)
				if val, err := strconv.ParseFloat(cleanAmount, 64); err == nil {
					amountParsed = true
					// Default: negative means expense (common in CSVs). If 'invert_amounts' is true, positive means expense.
					// We need expenses to be POSITIVE returning from this function.
					if schema.InvertAmounts {
						amount = val
					} else {
						amount = -val
					}
				}
			}
		} else {
			// Try Debit
			if schema.DebitColIdx != nil {
				debitStr := strings.TrimSpace(record[*schema.DebitColIdx])
				if debitStr != "" {
					cleanDebit := strings.ReplaceAll(debitStr, "$", "")
					cleanDebit = strings.ReplaceAll(cleanDebit, ",", "")
					if val, err := strconv.ParseFloat(strings.TrimSpace(cleanDebit), 64); err == nil {
						amount = val // Debits are expenses. Output as positive.
						amountParsed = true
					}
				}
			}
			// Try Credit
			if !amountParsed && schema.CreditColIdx != nil {
				creditStr := strings.TrimSpace(record[*schema.CreditColIdx])
				if creditStr != "" {
					cleanCredit := strings.ReplaceAll(creditStr, "$", "")
					cleanCredit = strings.ReplaceAll(cleanCredit, ",", "")
					if val, err := strconv.ParseFloat(strings.TrimSpace(cleanCredit), 64); err == nil {
						amount = -val // Credits are income/payments. Output as negative so they get filtered out.
						amountParsed = true
					}
				}
			}
		}

		if !amountParsed {
			continue // skip rows where amount could not be parsed
		}

		transactions = append(transactions, models.NormalizedTransaction{
			Date:        date.Format("2006-01-02"),
			Amount:      amount,
			Title:       merchant,
			Description: merchant,
			Currency:    "USD",
		})
	}

	return transactions, nil
}
