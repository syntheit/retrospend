package processor

import (
	"fmt"
	"importer/internal/models"
	"strings"
	"time"
)

// ValidationError represents a validation failure for a transaction
type ValidationError struct {
	Field   string
	Message string
}

func (e ValidationError) Error() string {
	return fmt.Sprintf("%s: %s", e.Field, e.Message)
}

// ValidateTransaction validates a single transaction and returns an error if invalid.
// Performs sanity checks on LLM-generated data to prevent silent corruption.
func ValidateTransaction(tx models.NormalizedTransaction) error {
	// Validate title
	if strings.TrimSpace(tx.Title) == "" {
		return ValidationError{Field: "title", Message: "title cannot be empty"}
	}

	// Validate amount (must be positive and reasonable)
	if tx.Amount <= 0 {
		return ValidationError{Field: "amount", Message: fmt.Sprintf("amount must be positive, got %.2f", tx.Amount)}
	}
	if tx.Amount > 1000000 {
		return ValidationError{Field: "amount", Message: fmt.Sprintf("amount exceeds maximum (1,000,000), got %.2f", tx.Amount)}
	}

	// Validate currency (must be 3 uppercase letters)
	if len(tx.Currency) != 3 {
		return ValidationError{Field: "currency", Message: fmt.Sprintf("currency must be 3 letters, got '%s'", tx.Currency)}
	}
	if strings.ToUpper(tx.Currency) != tx.Currency {
		return ValidationError{Field: "currency", Message: fmt.Sprintf("currency must be uppercase, got '%s'", tx.Currency)}
	}

	// Validate date format and range
	dateVal, err := time.Parse("2006-01-02", tx.Date)
	if err != nil {
		// Try parsing with single-digit month/day
		dateVal, err = time.Parse("2006-1-2", tx.Date)
		if err != nil {
			return ValidationError{Field: "date", Message: fmt.Sprintf("invalid date format '%s', expected YYYY-MM-DD", tx.Date)}
		}
	}

	// Date must be after 1970 and not in the future
	minDate := time.Date(1970, 1, 1, 0, 0, 0, 0, time.UTC)
	maxDate := time.Now().AddDate(0, 0, 7) // Allow up to 7 days in future for timezone issues
	if dateVal.Before(minDate) {
		return ValidationError{Field: "date", Message: fmt.Sprintf("date %s is before 1970", tx.Date)}
	}
	if dateVal.After(maxDate) {
		return ValidationError{Field: "date", Message: fmt.Sprintf("date %s is in the future", tx.Date)}
	}

	return nil
}

// ValidateTransactions validates all transactions and returns valid ones + warnings for invalid ones.
// Invalid transactions are skipped and a warning is added to metadata.
func ValidateTransactions(transactions []models.NormalizedTransaction, metadata *models.ImportMetadata) []models.NormalizedTransaction {
	valid := make([]models.NormalizedTransaction, 0, len(transactions))

	for i, tx := range transactions {
		if err := ValidateTransaction(tx); err != nil {
			warning := fmt.Sprintf("Skipped transaction #%d: %v (title: '%s', amount: %.2f, date: '%s')",
				i+1, err, tx.Title, tx.Amount, tx.Date)
			metadata.Warnings = append(metadata.Warnings, warning)
			metadata.SkippedTransactions++
			continue
		}
		valid = append(valid, tx)
	}

	return valid
}

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
