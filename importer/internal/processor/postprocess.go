package processor

import (
	"fmt"
	"importer/internal/models"
	"strings"
	"time"
)

// ApplyExchangeRates calculates and applies exchange rates for transactions that were
// originally in a foreign currency. It updates the transaction's main amount and currency
// with the foreign data while preserving the USD value.
func ApplyExchangeRates(transactions []models.NormalizedTransaction) {
	for i := range transactions {
		transactions[i].PricingSource = "IMPORTED"

		if transactions[i].OriginalAmount > 0 && transactions[i].OriginalCurrency != "" {
			// Calculate rate based on USD amount (Amount) vs Foreign amount (OriginalAmount)
			transactions[i].ExchangeRate = transactions[i].OriginalAmount / transactions[i].Amount
			transactions[i].AmountInUSD = transactions[i].Amount
			transactions[i].Amount = transactions[i].OriginalAmount
			transactions[i].Currency = transactions[i].OriginalCurrency
		} else {
			transactions[i].ExchangeRate = 1.0
			transactions[i].AmountInUSD = transactions[i].Amount
			transactions[i].Currency = "USD"
		}
	}
}

// NormalizeDate ensures dates are in YYYY-MM-DD format (zero-padded).
// LLMs sometimes emit "2025-12-6" instead of "2025-12-06".
func NormalizeDate(transactions []models.NormalizedTransaction) {
	for i, t := range transactions {
		parsed, err := time.Parse("2006-1-2", t.Date)
		if err != nil {
			// Try already-correct format; if it still fails, leave it as-is
			if _, err2 := time.Parse("2006-01-02", t.Date); err2 != nil {
				// Try with month names e.g. "Jan 2, 2006"
				if p, err3 := time.Parse("Jan 2, 2006", t.Date); err3 == nil {
					transactions[i].Date = p.Format("2006-01-02")
				}
			}
			continue
		}
		transactions[i].Date = parsed.Format("2006-01-02")
	}
}

// FilterPayments removes transactions that are payments or credits rather than expenses.
// The primary signal is a negative AmountInUSD (the payment value from the PDF parser
// will be negative since the statement shows payments as "- $167.97").
// Keyword matching is used as a secondary filter only for very specific, unambiguous terms.
func FilterPayments(transactions []models.NormalizedTransaction) []models.NormalizedTransaction {
	// Only match clear payment descriptions, not broad substrings like "payment" which
	// would incorrectly remove "Uber Payment" (a ride-share expense).
	exactKeywords := []string{"autopay", "mobile pymt", "online pymt", "thank you", "bill pay"}
	filtered := make([]models.NormalizedTransaction, 0, len(transactions))
	for _, t := range transactions {
		// Primary filter: negative USD amount means it's a credit/payment
		if t.AmountInUSD < 0 || t.Amount < 0 {
			continue
		}
		titleLower := strings.ToLower(t.Title)
		skip := false
		for _, kw := range exactKeywords {
			if strings.Contains(titleLower, kw) {
				skip = true
				break
			}
		}
		if !skip {
			filtered = append(filtered, t)
		}
	}
	return filtered
}

// FormatExchangeRate formats the exchange rate for display
func FormatExchangeRate(rate float64) string {
	return fmt.Sprintf("%.6f", rate)
}
