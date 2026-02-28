package exporter

import (
	"encoding/csv"
	"fmt"
	"importer/internal/models"
	"os"
)

// ExportToCSV writes a slice of models.NormalizedTransaction objects to a CSV file.
// The format is compatible with the Retrospend database import schema.
func ExportToCSV(transactions []models.NormalizedTransaction, filename string) error {
	file, err := os.Create(filename)
	if err != nil {
		return fmt.Errorf("failed to create file %s: %w", filename, err)
	}
	defer file.Close()

	writer := csv.NewWriter(file)
	defer writer.Flush()

	header := []string{"title", "amount", "currency", "exchangeRate", "amountInUSD", "date", "location", "description", "pricingSource", "category", "isAmortized", "amortizeDuration"}
	if err := writer.Write(header); err != nil {
		return fmt.Errorf("failed to write CSV header: %w", err)
	}

	for _, tx := range transactions {
		row := []string{
			tx.Title,
			fmt.Sprintf("%.2f", tx.Amount),
			tx.Currency,
			fmt.Sprintf("%.4f", tx.ExchangeRate),
			fmt.Sprintf("%.2f", tx.AmountInUSD),
			tx.Date,
			tx.Location,
			tx.Description,
			tx.PricingSource,
			tx.Category,
			"False", // isAmortized
			"",      // amortizeDuration
		}
		if err := writer.Write(row); err != nil {
			return fmt.Errorf("failed to write CSV row for %s: %w", tx.Title, err)
		}
	}

	return nil
}

