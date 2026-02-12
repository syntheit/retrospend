package tasks

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"regexp"
	"strings"
	"time"

	"retrospend-worker/db"
)

const (
	exchangeRateURL = "https://raw.githubusercontent.com/syntheit/exchange-rates/refs/heads/main/rates.json"
	maxRateEntries  = 2000
	fetchTimeout    = 8 * time.Second
)

var (
	validCurrency = regexp.MustCompile(`^[A-Z]{3}$`)
	validType     = regexp.MustCompile(`^[a-z0-9_-]{1,32}$`)
)

type OracleRatesResponse struct {
	UpdatedAt string             `json:"updatedAt"`
	Base      string             `json:"base"`
	Rates     map[string]float64 `json:"rates"`
}

type ParsedRate struct {
	Currency string
	Type     string
	Rate     float64
}

type ExistingRate struct {
	ID            string
	Currency      string
	Type          string
	FavoriteCount int
}

func parseRateKey(key string) (currency, rateType string) {
	parts := strings.Split(key, "_")
	if len(parts) == 1 {
		return key, "official"
	}

	currency = parts[0]
	rateType = strings.ToLower(strings.Join(parts[1:], "_"))
	return
}

func SyncExchangeRates(database *db.DB) error {
	log.Println("[EXCHANGE_RATES] Starting sync...")

	// Fetch rates from GitHub
	ctx, cancel := context.WithTimeout(context.Background(), fetchTimeout)
	defer cancel()

	req, err := http.NewRequestWithContext(ctx, "GET", exchangeRateURL, nil)
	if err != nil {
		return fmt.Errorf("failed to create request: %w", err)
	}

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return fmt.Errorf("failed to fetch rates: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("unexpected status code: %d", resp.StatusCode)
	}

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return fmt.Errorf("failed to read response: %w", err)
	}

	var data OracleRatesResponse
	if err := json.Unmarshal(body, &data); err != nil {
		return fmt.Errorf("failed to parse JSON: %w", err)
	}

	if data.Rates == nil {
		return fmt.Errorf("invalid response: missing rates object")
	}

	// Parse and validate rates
	var rateEntries []ParsedRate
	
	// Parse the date from the JSON response
	effectiveDate, err := time.Parse(time.RFC3339, data.UpdatedAt)
	if err != nil {
		// Try alternative format if standard RFC3339 fails (sometimes APIs are finicky)
		// Assuming standard for now, but falling back to Now() with a log is safer than crashing
		log.Printf("[EXCHANGE_RATES] Warning: failed to parse UpdatedAt '%s': %v. Using current time.", data.UpdatedAt, err)
		effectiveDate = time.Now().UTC()
	}
	effectiveDate = effectiveDate.Truncate(24 * time.Hour)

	for key, rate := range data.Rates {
		currency, rateType := parseRateKey(key)
		currency = strings.ToUpper(currency)
		rateType = strings.ToLower(rateType)

		if !validCurrency.MatchString(currency) || !validType.MatchString(rateType) {
			continue
		}

		rateEntries = append(rateEntries, ParsedRate{
			Currency: currency,
			Type:     rateType,
			Rate:     rate,
		})
	}

	if len(rateEntries) == 0 {
		return fmt.Errorf("no valid rate entries found")
	}

	if len(rateEntries) > maxRateEntries {
		return fmt.Errorf("too many rate entries: %d", len(rateEntries))
	}

	// Execute database transaction
	tx, err := database.Pool.Begin(context.Background())
	if err != nil {
		return fmt.Errorf("failed to begin transaction: %w", err)
	}
	defer tx.Rollback(context.Background())

	// Get existing rates with favorite counts
	rows, err := tx.Query(context.Background(), `
		SELECT er.id, er.currency, er.type, 
			COALESCE((SELECT COUNT(*) FROM exchange_rate_favorite WHERE "exchangeRateId" = er.id), 0) as fav_count
		FROM exchange_rate er
	`)
	if err != nil {
		return fmt.Errorf("failed to query existing rates: %w", err)
	}

	existingMap := make(map[string][]ExistingRate)
	for rows.Next() {
		var rate ExistingRate
		if err := rows.Scan(&rate.ID, &rate.Currency, &rate.Type, &rate.FavoriteCount); err != nil {
			rows.Close()
			return fmt.Errorf("failed to scan existing rate: %w", err)
		}
		key := rate.Currency + "_" + rate.Type
		existingMap[key] = append(existingMap[key], rate)
	}
	rows.Close()

	validIDs := make(map[string]bool)
	var idsToDelete []string
	updated := 0
	created := 0

	for _, entry := range rateEntries {
		key := entry.Currency + "_" + entry.Type
		existing := existingMap[key]

		if len(existing) > 0 {
			// Find best candidate to keep (highest favorite count)
			keeper := existing[0]
			for _, e := range existing[1:] {
				if e.FavoriteCount > keeper.FavoriteCount {
					keeper = e
				}
			}

			// Update the keeper
			// Note: "updatedAt" is quoted because it's camelCase in DB
			_, err := tx.Exec(context.Background(), `
				UPDATE exchange_rate 
				SET rate = $1, date = $2, "updatedAt" = NOW() 
				WHERE id = $3
			`, entry.Rate, effectiveDate, keeper.ID)
			if err != nil {
				return fmt.Errorf("failed to update rate: %w", err)
			}

			validIDs[keeper.ID] = true
			updated++

			// Mark duplicates for deletion
			for _, e := range existing {
				if e.ID != keeper.ID {
					idsToDelete = append(idsToDelete, e.ID)
				}
			}
		} else {
			// Create new rate
			// Note: "createdAt" and "updatedAt" are quoted
			_, err := tx.Exec(context.Background(), `
				INSERT INTO exchange_rate (id, date, currency, type, rate, "createdAt", "updatedAt")
				VALUES (gen_random_uuid()::text, $1, $2, $3, $4, NOW(), NOW())
			`, effectiveDate, entry.Currency, entry.Type, entry.Rate)
			if err != nil {
				return fmt.Errorf("failed to insert rate: %w", err)
			}
			created++
		}
	}

	// Delete stale rates (not in new payload)
	for _, rates := range existingMap {
		for _, rate := range rates {
			if !validIDs[rate.ID] {
				idsToDelete = append(idsToDelete, rate.ID)
			}
		}
	}

	if len(idsToDelete) > 0 {
		_, err := tx.Exec(context.Background(), `
			DELETE FROM exchange_rate WHERE id = ANY($1)
		`, idsToDelete)
		if err != nil {
			return fmt.Errorf("failed to delete stale rates: %w", err)
		}
	}

	if err := tx.Commit(context.Background()); err != nil {
		return fmt.Errorf("failed to commit transaction: %w", err)
	}

	log.Printf("[EXCHANGE_RATES] ✓ Synced %d rates (created: %d, updated: %d, deleted: %d)",
		len(rateEntries), created, updated, len(idsToDelete))

	// Update worker status
	if err := database.UpdateWorkerStatus(context.Background(), "exchange_rates", true); err != nil {
		log.Printf("[EXCHANGE_RATES] Failed to update worker status: %v", err)
	}

	return nil
}
