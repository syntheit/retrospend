package tasks

import (
	"context"
	"fmt"
	"log"
	"time"

	"retrospend-worker/db"
)

type RecurringTemplate struct {
	ID          string
	UserID      string
	Name        string
	Amount      float64
	Currency    string
	CategoryID  *string
	Frequency   string
	NextDueDate time.Time
}

func calculateNextDueDate(current time.Time, frequency string) time.Time {
	next := current
	switch frequency {
	case "WEEKLY":
		next = next.AddDate(0, 0, 7)
	case "MONTHLY":
		next = next.AddDate(0, 1, 0)
	case "YEARLY":
		next = next.AddDate(1, 0, 0)
	}
	return next
}

func getBestExchangeRate(ctx context.Context, database *db.DB, currency string, date time.Time) (float64, error) {
	if currency == "USD" {
		return 1.0, nil
	}

	var rate float64
	err := database.Pool.QueryRow(ctx, `
		SELECT rate FROM exchange_rate 
		WHERE currency = $1 AND date <= $2
		ORDER BY 
			CASE WHEN type = 'blue' THEN 0 WHEN type = 'official' THEN 1 ELSE 2 END,
			date DESC
		LIMIT 1
	`, currency, date).Scan(&rate)

	if err != nil {
		return 0, fmt.Errorf("no exchange rate found for %s: %w", currency, err)
	}

	return rate, nil
}

func ProcessRecurringExpenses(database *db.DB) error {
	log.Println("[RECURRING] Processing due expenses...")

	ctx := context.Background()
	now := time.Now()

	// Get all due templates
	// Note: using camelCase "userId", "categoryId", "nextDueDate", "isActive", "autoPay"
	rows, err := database.Pool.Query(ctx, `
		SELECT id, "userId", name, amount, currency, "categoryId", frequency, "nextDueDate"
		FROM recurring_template
		WHERE "isActive" = true 
		  AND "autoPay" = true 
		  AND "nextDueDate" <= $1
	`, now)
	if err != nil {
		return fmt.Errorf("failed to query templates: %w", err)
	}
	defer rows.Close()

	var templates []RecurringTemplate
	for rows.Next() {
		var t RecurringTemplate
		if err := rows.Scan(&t.ID, &t.UserID, &t.Name, &t.Amount, &t.Currency, &t.CategoryID, &t.Frequency, &t.NextDueDate); err != nil {
			return fmt.Errorf("failed to scan template: %w", err)
		}
		templates = append(templates, t)
	}

	if len(templates) == 0 {
		log.Println("[RECURRING] No due expenses found")
		// Still update status to show we checked
		if err := database.UpdateWorkerStatus(ctx, "recurring_expenses", true); err != nil {
			log.Printf("[RECURRING] Failed to update worker status: %v", err)
		}
		return nil
	}

	createdCount := 0

	for _, template := range templates {
		// Get exchange rate
		exchangeRate, err := getBestExchangeRate(ctx, database, template.Currency, template.NextDueDate)
		if err != nil {
			log.Printf("[RECURRING] Warning: %v, skipping template %s", err, template.ID)
			continue
		}

		amountInUSD := template.Amount / exchangeRate

		// Create expense
		// Note: "userId", "categoryId", "amountInUSD", "exchangeRate", "pricingSource", "recurringTemplateId", etc
		_, err = database.Pool.Exec(ctx, `
			INSERT INTO expense (
				id, "userId", title, amount, currency, date, "categoryId",
				"amountInUSD", "exchangeRate", "pricingSource", "recurringTemplateId", 
				status, "createdAt", "updatedAt"
			) VALUES (
				gen_random_uuid()::text, $1, $2, $3, $4, $5, $6, $7, $8, 'RECURRING', $9, 'FINALIZED', NOW(), NOW()
			)
		`, template.UserID, template.Name, template.Amount, template.Currency, template.NextDueDate,
			template.CategoryID, amountInUSD, exchangeRate, template.ID)

		if err != nil {
			log.Printf("[RECURRING] Error creating expense for template %s: %v", template.ID, err)
			continue
		}

		// Update next due date
		nextDueDate := calculateNextDueDate(template.NextDueDate, template.Frequency)
		_, err = database.Pool.Exec(ctx, `
			UPDATE recurring_template 
			SET "nextDueDate" = $1, "updatedAt" = NOW() 
			WHERE id = $2
		`, nextDueDate, template.ID)

		if err != nil {
			log.Printf("[RECURRING] Error updating template %s: %v", template.ID, err)
			continue
		}

		createdCount++
	}
	
	log.Printf("[RECURRING] ✓ Processed %d templates, created %d expenses", len(templates), createdCount)
	
	// Update worker status
	if err := database.UpdateWorkerStatus(ctx, "recurring_expenses", true); err != nil {
		log.Printf("[RECURRING] Failed to update worker status: %v", err)
	}

	return nil
}
