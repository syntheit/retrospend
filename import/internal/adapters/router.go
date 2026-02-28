package adapters

import (
	"fmt"
	"importer/internal/llm"
	"importer/internal/models"
	"log"
	"strings"
)

func DetectAdapter(endpoint string, model string, headerRow []string, sampleRows []string) (BankAdapter, error) {
	headerStr := strings.Join(headerRow, ",")

	// Check if common header-based banks (e.g. Lighthouse, BNH)
	if strings.Contains(headerStr, "Post Date") && strings.Contains(headerStr, "Description") &&
		(strings.Contains(headerStr, "Debit") || strings.Contains(headerStr, "Credit")) {
		schema := models.CSVSchema{DateFormat: "1/2/2006", InvertAmounts: false, DateColIdx: -1, MerchantColIdx: -1}
		for i, h := range headerRow {
			hStr := strings.TrimSpace(h)
			if hStr == "Post Date" || hStr == "Posting Date" || hStr == "Date" {
				schema.DateColIdx = i
			} else if hStr == "Description" || hStr == "Payee" || hStr == "Merchant" {
				schema.MerchantColIdx = i
			} else if hStr == "Debit" {
				idx := i
				schema.DebitColIdx = &idx
			} else if hStr == "Credit" {
				idx := i
				schema.CreditColIdx = &idx
			} else if hStr == "Amount" {
				idx := i
				schema.AmountColIdx = &idx
			}
		}
		// If both date and merchant were found, we can use this schema
		if schema.DateColIdx != -1 && schema.MerchantColIdx != -1 && (schema.AmountColIdx != nil || schema.DebitColIdx != nil) {
			return NewDynamicAdapter(schema), nil
		}
	}

	// Check if Capital One (Debit/Credit separate)
	if strings.Contains(headerStr, "Debit") && strings.Contains(headerStr, "Credit") && strings.Contains(headerStr, "Card No.") {
		schema := models.CSVSchema{DateFormat: "2006-01-02", InvertAmounts: false, DateColIdx: -1, MerchantColIdx: -1}
		for i, h := range headerRow {
			hStr := strings.TrimSpace(h)
			if hStr == "Transaction Date" {
				schema.DateColIdx = i
			} else if hStr == "Description" {
				schema.MerchantColIdx = i
			} else if hStr == "Debit" {
				idx := i
				schema.DebitColIdx = &idx
			} else if hStr == "Credit" {
				idx := i
				schema.CreditColIdx = &idx
			}
		}
		return NewDynamicAdapter(schema), nil
	}

	// Check if Chase
	if (strings.Contains(headerStr, "Posting Date") && strings.Contains(headerStr, "Details")) ||
		(strings.Contains(headerStr, "Post Date") && strings.Contains(headerStr, "Description") && strings.Contains(headerStr, "Category")) {
		schema := models.CSVSchema{DateFormat: "01/02/2006", InvertAmounts: false, DateColIdx: -1, MerchantColIdx: -1}
		for i, h := range headerRow {
			hStr := strings.TrimSpace(h)
			if hStr == "Posting Date" || hStr == "Post Date" || hStr == "Transaction Date" {
				schema.DateColIdx = i
			} else if hStr == "Description" {
				schema.MerchantColIdx = i
			} else if hStr == "Amount" {
				idx := i
				schema.AmountColIdx = &idx
			}
		}
		// Fallbacks for Chase if indices weren't found precisely match legacy
		if schema.DateColIdx == -1 && schema.MerchantColIdx == -1 {
			schema.DateColIdx = 1
			schema.MerchantColIdx = 2
			idx := 3
			schema.AmountColIdx = &idx
		}
		return NewDynamicAdapter(schema), nil
	}

	// Check if BoA
	if strings.Contains(headerStr, "Payee") && strings.Contains(headerStr, "Posted Date") {
		schema := models.CSVSchema{DateFormat: "01/02/2006", InvertAmounts: false, DateColIdx: -1, MerchantColIdx: -1}
		for i, h := range headerRow {
			hStr := strings.TrimSpace(h)
			if hStr == "Posted Date" {
				schema.DateColIdx = i
			} else if hStr == "Payee" {
				schema.MerchantColIdx = i
			} else if hStr == "Amount" {
				idx := i
				schema.AmountColIdx = &idx
			}
		}
		return NewDynamicAdapter(schema), nil
	}

	// Check if Fidelity
	if strings.Contains(headerStr, "Transaction Date") && strings.Contains(headerStr, "Memo") {
		schema := models.CSVSchema{DateFormat: "2006-01-02", InvertAmounts: false, DateColIdx: -1, MerchantColIdx: -1}
		for i, h := range headerRow {
			hStr := strings.TrimSpace(h)
			if hStr == "Transaction Date" {
				schema.DateColIdx = i
			} else if hStr == "Name" || hStr == "Description" {
				schema.MerchantColIdx = i
			} else if hStr == "Amount" {
				idx := i
				schema.AmountColIdx = &idx
			}
		}
		// Fidelity fallback
		if schema.MerchantColIdx == -1 {
			schema.MerchantColIdx = 1
		}
		return NewDynamicAdapter(schema), nil
	}

	// Fallback: Use LLM to discover schema
	// Check cache first
	if cachedSchema, exists := llm.GetCachedSchema(headerStr); exists {
		log.Println("Known schema found in cache")
		return NewDynamicAdapter(cachedSchema), nil
	}

	log.Print("Unknown CSV format. Identifying schema via LLM...")
	schema, err := llm.DiscoverCSVSchema(endpoint, model, headerStr, sampleRows)
	if err != nil {
		log.Println("Schema discovery FAILED")
		return nil, fmt.Errorf("unsupported CSV format and LLM discovery failed: %w", err)
	}
	log.Println("Schema discovery complete")

	// Save to cache for future use
	llm.SaveSchemaToCache(headerStr, schema)

	return NewDynamicAdapter(schema), nil
}
