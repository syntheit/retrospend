package tasks

import (
	"context"
	"fmt"
	"log"
	"math"
	"strconv"
	"time"

	"retrospend-sidecar/db"
)

type RecurringTemplate struct {
	ID     string
	UserID string
	Name   string
	// Amount is the exact decimal text of recurring_template.amount, written
	// back as is so the posted row never goes through a float.
	Amount      string
	Currency    string
	CategoryID  *string
	Frequency   string
	NextDueDate time.Time
	AnchorDay   *int
	// Direction is OUT (a recurring expense) or IN (recurring income).
	Direction string
}

// posting is what a due template writes to expense besides its amount.
type posting struct {
	Direction string
	// InType is INCOME for money in and nil for spending, matching the
	// expense_in_type_check constraint (IN STANDARD rows always carry one).
	InType *string
}

// postingFor copies the template's direction onto the posted row. Recurring
// money in is always income: a refund or a transfer never repeats on a
// schedule. Anything but IN posts as spending, the column's default.
func postingFor(t RecurringTemplate) posting {
	if t.Direction == "IN" {
		income := "INCOME"
		return posting{Direction: "IN", InType: &income}
	}
	return posting{Direction: "OUT"}
}

// addMonthsClamped adds months to t, landing on anchorDay (default: t's own
// day) or the last day of the target month when that month is shorter.
// Jan 31 + 1 month is Feb 28, and Feb 28 + 1 month with anchor 31 is Mar 31.
// Mirrors addMonthsClamped in src/lib/recurring.ts.
func addMonthsClamped(t time.Time, months int, anchorDay *int) time.Time {
	day := t.Day()
	if anchorDay != nil && *anchorDay > 0 {
		day = *anchorDay
	}
	firstOfTarget := time.Date(t.Year(), t.Month(), 1, t.Hour(), t.Minute(), t.Second(), t.Nanosecond(), t.Location()).AddDate(0, months, 0)
	lastDay := firstOfTarget.AddDate(0, 1, -1).Day()
	if day > lastDay {
		day = lastDay
	}
	return firstOfTarget.AddDate(0, 0, day-1)
}

func calculateNextDueDate(current time.Time, frequency string, anchorDay *int) time.Time {
	switch frequency {
	case "WEEKLY":
		return current.AddDate(0, 0, 7)
	case "BIWEEKLY":
		return current.AddDate(0, 0, 14)
	case "MONTHLY":
		return addMonthsClamped(current, 1, anchorDay)
	case "QUARTERLY":
		return addMonthsClamped(current, 3, anchorDay)
	case "YEARLY":
		return addMonthsClamped(current, 12, anchorDay)
	}
	return current
}

// isCryptoCurrency decides the rate direction by currency code, never by the
// rate type: ARS has a "crypto" rate type that is still ARS per USD.
func isCryptoCurrency(currency string) bool {
	return supportedCryptoCurrencies[currency]
}

// amountToUSD follows the stored convention in src/lib/money.ts: fiat rates
// are units per USD, crypto rates are USD per coin. Rounded to cents.
func amountToUSD(amount float64, currency string, rate float64) float64 {
	var usd float64
	switch {
	case currency == "USD":
		usd = amount
	case isCryptoCurrency(currency):
		usd = amount * rate
	default:
		usd = amount / rate
	}
	return math.Round(usd*100) / 100
}

// getBestExchangeRate mirrors pickBestRate in src/lib/money.ts: the latest
// rate on or before the date, else the nearest one after it; types ranked
// blue > official > crypto > the rest. Never falls back to 1.
func getBestExchangeRate(ctx context.Context, database *db.DB, currency string, date time.Time) (float64, string, error) {
	if currency == "USD" {
		return 1.0, "official", nil
	}

	var rate float64
	var rateType string
	err := database.Pool.QueryRow(ctx, `
		SELECT rate, type FROM exchange_rate
		WHERE currency = $1 AND rate > 0
		ORDER BY
			CASE WHEN date <= $2 THEN 0 ELSE 1 END,
			CASE WHEN date <= $2 THEN date END DESC,
			CASE WHEN date > $2 THEN date END ASC,
			CASE type WHEN 'blue' THEN 0 WHEN 'official' THEN 1 WHEN 'crypto' THEN 2 ELSE 3 END,
			type
		LIMIT 1
	`, currency, date).Scan(&rate, &rateType)

	if err != nil {
		return 0, "", fmt.Errorf("no exchange rate found for %s: %w", currency, err)
	}

	return rate, rateType, nil
}

func ProcessRecurringExpenses(database *db.DB) error {
	log.Println("[RECURRING] Processing due expenses...")

	ctx := context.Background()
	now := time.Now()

	// Get all due templates. "Amount varies: ask me" (amountMode ASK) never
	// posts on its own: the user confirms the real amount in the app.
	// Note: using camelCase "userId", "categoryId", "nextDueDate", "isActive", "autoPay"
	rows, err := database.Pool.Query(ctx, `
		SELECT id, "userId", name, amount::text, currency, "categoryId", frequency, "nextDueDate", "anchorDay",
		       direction::text
		FROM recurring_template
		WHERE "isActive" = true
		  AND "autoPay" = true
		  AND "amountMode" = 'FIXED'
		  AND "nextDueDate" <= $1
	`, now)
	if err != nil {
		return fmt.Errorf("failed to query templates: %w", err)
	}
	defer rows.Close()

	var templates []RecurringTemplate
	for rows.Next() {
		var t RecurringTemplate
		if err := rows.Scan(&t.ID, &t.UserID, &t.Name, &t.Amount, &t.Currency, &t.CategoryID, &t.Frequency, &t.NextDueDate, &t.AnchorDay, &t.Direction); err != nil {
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
		exchangeRate, _, err := getBestExchangeRate(ctx, database, template.Currency, template.NextDueDate)
		if err != nil {
			log.Printf("[RECURRING] Warning: %v, skipping template %s", err, template.ID)
			continue
		}

		amount, err := strconv.ParseFloat(template.Amount, 64)
		if err != nil {
			log.Printf("[RECURRING] Warning: bad amount %q, skipping template %s", template.Amount, template.ID)
			continue
		}
		amountInUSD := amountToUSD(amount, template.Currency, exchangeRate)
		post := postingFor(template)

		// Wrap UPDATE + INSERT in a transaction for atomicity
		tx, err := database.Pool.Begin(ctx)
		if err != nil {
			log.Printf("[RECURRING] Error starting transaction for template %s: %v", template.ID, err)
			continue
		}

		// Advance the template first, only if nobody else did since we read it
		// (a manual confirm or an overlapping run), so each period is booked once.
		anchorDay := template.AnchorDay
		if anchorDay == nil {
			day := template.NextDueDate.Day()
			anchorDay = &day
		}
		nextDueDate := calculateNextDueDate(template.NextDueDate, template.Frequency, anchorDay)
		tag, err := tx.Exec(ctx, `
			UPDATE recurring_template
			SET "nextDueDate" = $1, "anchorDay" = $2, "updatedAt" = NOW()
			WHERE id = $3 AND "nextDueDate" = $4
		`, nextDueDate, *anchorDay, template.ID, template.NextDueDate)

		if err != nil {
			tx.Rollback(ctx)
			log.Printf("[RECURRING] Error updating template %s: %v", template.ID, err)
			continue
		}
		if tag.RowsAffected() == 0 {
			tx.Rollback(ctx)
			log.Printf("[RECURRING] Template %s was already advanced, skipping", template.ID)
			continue
		}

		// Create the expense or money-in row, with the template's direction
		_, err = tx.Exec(ctx, `
			INSERT INTO expense (
				id, "userId", title, amount, currency, date, "categoryId",
				"amountInUSD", "exchangeRate", "pricingSource", "recurringTemplateId",
				status, direction, "inType", "createdAt", "updatedAt"
			) VALUES (
				gen_random_uuid()::text, $1, $2, $3::numeric, $4, $5, $6, $7, $8, 'RECURRING', $9, 'FINALIZED',
				$10::"ExpenseDirection", $11::"InType", NOW(), NOW()
			)
		`, template.UserID, template.Name, template.Amount, template.Currency, template.NextDueDate,
			template.CategoryID, amountInUSD, exchangeRate, template.ID, post.Direction, post.InType)

		if err != nil {
			tx.Rollback(ctx)
			log.Printf("[RECURRING] Error creating expense for template %s: %v", template.ID, err)
			continue
		}

		if err := tx.Commit(ctx); err != nil {
			log.Printf("[RECURRING] Error committing transaction for template %s: %v", template.ID, err)
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
