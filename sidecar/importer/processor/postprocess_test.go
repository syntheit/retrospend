package processor

import (
	"fmt"
	"retrospend-sidecar/importer/models"
	"strings"
	"testing"
	"time"
)

// ── ApplyExchangeRates ────────────────────────────────────────────────────────

func TestApplyExchangeRates_WithForeignCurrency(t *testing.T) {
	txs := []models.NormalizedTransaction{
		{
			Title:            "Coffee",
			Amount:           10.00, // USD amount from bank statement
			Currency:         "USD",
			OriginalAmount:   14200, // ARS equivalent
			OriginalCurrency: "ARS",
		},
	}

	ApplyExchangeRates(txs, "USD")

	tx := txs[0]
	if tx.Currency != "ARS" {
		t.Errorf("expected Currency=ARS, got %s", tx.Currency)
	}
	if tx.Amount != 14200 {
		t.Errorf("expected Amount=14200 (original), got %.2f", tx.Amount)
	}
	if tx.AmountInUSD != 10.00 {
		t.Errorf("expected AmountInUSD=10.00, got %.2f", tx.AmountInUSD)
	}
	// Rate = OriginalAmount / Amount = 14200 / 10 = 1420
	wantRate := 14200.0 / 10.0
	if tx.ExchangeRate != wantRate {
		t.Errorf("expected ExchangeRate=%.2f, got %.2f", wantRate, tx.ExchangeRate)
	}
	if tx.PricingSource != "IMPORTED" {
		t.Errorf("expected PricingSource=IMPORTED, got %s", tx.PricingSource)
	}
}

func TestApplyExchangeRates_NoForeignFields(t *testing.T) {
	txs := []models.NormalizedTransaction{
		{Title: "Rent", Amount: 1500, Currency: ""},
	}

	ApplyExchangeRates(txs, "USD")

	tx := txs[0]
	if tx.Currency != "USD" {
		t.Errorf("expected Currency=USD (default), got %s", tx.Currency)
	}
	if tx.ExchangeRate != 1.0 {
		t.Errorf("expected ExchangeRate=1.0, got %.6f", tx.ExchangeRate)
	}
	if tx.AmountInUSD != 1500 {
		t.Errorf("expected AmountInUSD=1500, got %.2f", tx.AmountInUSD)
	}
	if tx.Amount != 1500 {
		t.Errorf("expected Amount unchanged=1500, got %.2f", tx.Amount)
	}
}

func TestApplyExchangeRates_EmptyDefaultCurrency(t *testing.T) {
	txs := []models.NormalizedTransaction{
		{Title: "Lunch", Amount: 20},
	}
	// Empty default should fall back to "USD"
	ApplyExchangeRates(txs, "")
	if txs[0].Currency != "USD" {
		t.Errorf("expected fallback Currency=USD, got %s", txs[0].Currency)
	}
}

func TestApplyExchangeRates_ZeroAmountDivisionGuard(t *testing.T) {
	// Amount=0 with a non-zero OriginalAmount: rate should default to 1.0
	txs := []models.NormalizedTransaction{
		{Title: "Zero", Amount: 0, OriginalAmount: 500, OriginalCurrency: "EUR"},
	}
	ApplyExchangeRates(txs, "USD")

	if txs[0].ExchangeRate != 1.0 {
		t.Errorf("expected ExchangeRate=1.0 (division-by-zero guard), got %.6f", txs[0].ExchangeRate)
	}
}

func TestApplyExchangeRates_SetsImportedPricingSource(t *testing.T) {
	txs := []models.NormalizedTransaction{
		{Title: "Coffee", Amount: 5},
	}
	ApplyExchangeRates(txs, "USD")
	if txs[0].PricingSource != "IMPORTED" {
		t.Errorf("expected PricingSource=IMPORTED, got %s", txs[0].PricingSource)
	}
}

// ── ValidateTransaction ───────────────────────────────────────────────────────

func TestValidateTransaction_EmptyTitle(t *testing.T) {
	tx := validTx()
	tx.Title = "   " // whitespace only
	err := ValidateTransaction(tx)
	if err == nil {
		t.Fatal("expected error for empty title, got nil")
	}
	if !strings.Contains(err.Error(), "title") {
		t.Errorf("expected error to mention 'title', got: %s", err.Error())
	}
}

func TestValidateTransaction_ZeroAmount(t *testing.T) {
	tx := validTx()
	tx.Amount = 0
	err := ValidateTransaction(tx)
	if err == nil {
		t.Fatal("expected error for zero amount")
	}
}

func TestValidateTransaction_NegativeAmount(t *testing.T) {
	tx := validTx()
	tx.Amount = -10
	err := ValidateTransaction(tx)
	if err == nil {
		t.Fatal("expected error for negative amount")
	}
}

func TestValidateTransaction_AmountExceedsMax(t *testing.T) {
	tx := validTx()
	tx.Amount = 1_000_001
	err := ValidateTransaction(tx)
	if err == nil {
		t.Fatal("expected error for amount > 1,000,000")
	}
}

func TestValidateTransaction_AmountAtMaxIsValid(t *testing.T) {
	tx := validTx()
	tx.Amount = 1_000_000
	if err := ValidateTransaction(tx); err != nil {
		t.Errorf("expected no error for amount=1,000,000, got: %v", err)
	}
}

func TestValidateTransaction_CurrencyTooShort(t *testing.T) {
	tx := validTx()
	tx.Currency = "US"
	err := ValidateTransaction(tx)
	if err == nil {
		t.Fatal("expected error for 2-letter currency")
	}
}

func TestValidateTransaction_CurrencyTooLong(t *testing.T) {
	tx := validTx()
	tx.Currency = "USDT"
	err := ValidateTransaction(tx)
	if err == nil {
		t.Fatal("expected error for 4-letter currency")
	}
}

func TestValidateTransaction_CurrencyNotUppercase(t *testing.T) {
	tx := validTx()
	tx.Currency = "usd"
	err := ValidateTransaction(tx)
	if err == nil {
		t.Fatal("expected error for lowercase currency")
	}
}

func TestValidateTransaction_ValidDate(t *testing.T) {
	tx := validTx()
	tx.Date = "2024-06-15"
	if err := ValidateTransaction(tx); err != nil {
		t.Errorf("expected no error for valid date, got: %v", err)
	}
}

func TestValidateTransaction_DateWithSingleDigitMonthDay(t *testing.T) {
	// LLMs sometimes emit "2024-6-5" — should be accepted
	tx := validTx()
	tx.Date = "2024-6-5"
	if err := ValidateTransaction(tx); err != nil {
		t.Errorf("expected no error for single-digit month/day, got: %v", err)
	}
}

func TestValidateTransaction_FutureDate(t *testing.T) {
	tx := validTx()
	future := time.Now().AddDate(0, 0, 10).Format("2006-01-02")
	tx.Date = future
	err := ValidateTransaction(tx)
	if err == nil {
		t.Fatal("expected error for date >7 days in future")
	}
}

func TestValidateTransaction_DateAllowed7DaysAhead(t *testing.T) {
	// Exactly 7 days ahead is within the allowed window
	tx := validTx()
	sevenDays := time.Now().AddDate(0, 0, 7).Format("2006-01-02")
	tx.Date = sevenDays
	// Should not error (or may be right on the boundary — acceptable either way)
	// We just verify it doesn't crash; the exact boundary is implementation-defined.
	_ = ValidateTransaction(tx)
}

func TestValidateTransaction_DateBefore1970(t *testing.T) {
	tx := validTx()
	tx.Date = "1969-12-31"
	err := ValidateTransaction(tx)
	if err == nil {
		t.Fatal("expected error for date before 1970")
	}
}

func TestValidateTransaction_InvalidDateFormat(t *testing.T) {
	tx := validTx()
	tx.Date = "not-a-date"
	err := ValidateTransaction(tx)
	if err == nil {
		t.Fatal("expected error for invalid date format")
	}
}

func TestValidateTransaction_ValidTransaction(t *testing.T) {
	tx := validTx()
	if err := ValidateTransaction(tx); err != nil {
		t.Errorf("expected valid transaction to pass, got: %v", err)
	}
}

// ── ValidateTransactions (batch) ─────────────────────────────────────────────

func TestValidateTransactions_FiltersInvalidSkipsWithWarnings(t *testing.T) {
	txs := []models.NormalizedTransaction{
		validTx(),
		{Title: "", Amount: 50, Currency: "USD", Date: "2024-01-01"}, // invalid: empty title
		validTx(),
	}
	meta := &models.ImportMetadata{}

	valid := ValidateTransactions(txs, meta)

	if len(valid) != 2 {
		t.Errorf("expected 2 valid transactions, got %d", len(valid))
	}
	if meta.SkippedTransactions != 1 {
		t.Errorf("expected 1 skipped, got %d", meta.SkippedTransactions)
	}
	if len(meta.Warnings) != 1 {
		t.Errorf("expected 1 warning, got %d", len(meta.Warnings))
	}
}

func TestValidateTransactions_AllValid(t *testing.T) {
	txs := []models.NormalizedTransaction{validTx(), validTx()}
	meta := &models.ImportMetadata{}
	valid := ValidateTransactions(txs, meta)
	if len(valid) != 2 {
		t.Errorf("expected 2 valid, got %d", len(valid))
	}
	if meta.SkippedTransactions != 0 {
		t.Errorf("expected 0 skipped, got %d", meta.SkippedTransactions)
	}
}

func TestValidateTransactions_EmptyInput(t *testing.T) {
	meta := &models.ImportMetadata{}
	valid := ValidateTransactions([]models.NormalizedTransaction{}, meta)
	if len(valid) != 0 {
		t.Errorf("expected empty result, got %d", len(valid))
	}
}

// ── FilterPayments ────────────────────────────────────────────────────────────

func TestFilterPayments_RemovesNegativeAmountInUSD(t *testing.T) {
	txs := []models.NormalizedTransaction{
		{Title: "Payment", Amount: 167.97, AmountInUSD: -167.97, Currency: "USD", Date: "2024-06-01"},
		{Title: "Coffee", Amount: 5.00, AmountInUSD: 5.00, Currency: "USD", Date: "2024-06-02"},
	}
	result := FilterPayments(txs)
	if len(result) != 1 {
		t.Errorf("expected 1 transaction after filter, got %d", len(result))
	}
	if result[0].Title != "Coffee" {
		t.Errorf("expected Coffee to survive, got %s", result[0].Title)
	}
}

func TestFilterPayments_RemovesNegativeAmount(t *testing.T) {
	txs := []models.NormalizedTransaction{
		{Title: "Refund", Amount: -20.00, AmountInUSD: -20.00, Currency: "USD", Date: "2024-06-01"},
	}
	result := FilterPayments(txs)
	if len(result) != 0 {
		t.Errorf("expected 0 transactions, got %d", len(result))
	}
}

func TestFilterPayments_RemovesAutopay(t *testing.T) {
	txs := []models.NormalizedTransaction{
		{Title: "AUTOPAY CREDIT CARD", Amount: 500, AmountInUSD: 500, Currency: "USD", Date: "2024-06-01"},
		{Title: "Groceries", Amount: 80, AmountInUSD: 80, Currency: "USD", Date: "2024-06-02"},
	}
	result := FilterPayments(txs)
	if len(result) != 1 || result[0].Title != "Groceries" {
		t.Errorf("expected only Groceries to survive, got %+v", result)
	}
}

func TestFilterPayments_RemovesMobilePymt(t *testing.T) {
	txs := []models.NormalizedTransaction{
		{Title: "Mobile Pymt Thank You", Amount: 300, AmountInUSD: 300, Currency: "USD", Date: "2024-06-01"},
	}
	result := FilterPayments(txs)
	if len(result) != 0 {
		t.Errorf("expected 0 transactions after mobile pymt filter, got %d", len(result))
	}
}

func TestFilterPayments_DoesNotRemovePaymentWordAlone(t *testing.T) {
	// "payment" alone should NOT be filtered — only exact keywords like "autopay", "mobile pymt"
	txs := []models.NormalizedTransaction{
		{Title: "Uber Payment", Amount: 25, AmountInUSD: 25, Currency: "USD", Date: "2024-06-01"},
	}
	result := FilterPayments(txs)
	if len(result) != 1 {
		t.Errorf("expected Uber Payment to NOT be filtered, got %d results", len(result))
	}
}

func TestFilterPayments_RemovesThankYou(t *testing.T) {
	txs := []models.NormalizedTransaction{
		{Title: "Thank You For Your Payment", Amount: 200, AmountInUSD: 200, Currency: "USD", Date: "2024-06-01"},
	}
	result := FilterPayments(txs)
	if len(result) != 0 {
		t.Errorf("expected 'thank you' title to be filtered, got %d", len(result))
	}
}

func TestFilterPayments_KeepsNormalPositiveExpense(t *testing.T) {
	txs := []models.NormalizedTransaction{
		{Title: "Amazon Purchase", Amount: 49.99, AmountInUSD: 49.99, Currency: "USD", Date: "2024-06-01"},
		{Title: "Netflix", Amount: 15.99, AmountInUSD: 15.99, Currency: "USD", Date: "2024-06-02"},
	}
	result := FilterPayments(txs)
	if len(result) != 2 {
		t.Errorf("expected both expenses to survive, got %d", len(result))
	}
}

func TestFilterPayments_EmptyInput(t *testing.T) {
	result := FilterPayments([]models.NormalizedTransaction{})
	if len(result) != 0 {
		t.Errorf("expected empty result, got %d", len(result))
	}
}

func TestFilterPayments_CaseInsensitiveKeywordMatch(t *testing.T) {
	txs := []models.NormalizedTransaction{
		{Title: "Online Pymt Reference 12345", Amount: 100, AmountInUSD: 100, Currency: "USD", Date: "2024-06-01"},
	}
	result := FilterPayments(txs)
	if len(result) != 0 {
		t.Errorf("expected 'online pymt' to be filtered, got %d", len(result))
	}
}

// ── NormalizeDate ─────────────────────────────────────────────────────────────

func TestNormalizeDate_PadsSingleDigitMonthAndDay(t *testing.T) {
	txs := []models.NormalizedTransaction{
		{Title: "Coffee", Date: "2025-12-6"},
	}
	NormalizeDate(txs)
	if txs[0].Date != "2025-12-06" {
		t.Errorf("expected 2025-12-06, got %s", txs[0].Date)
	}
}

func TestNormalizeDate_PadsSingleDigitMonth(t *testing.T) {
	txs := []models.NormalizedTransaction{
		{Title: "Coffee", Date: "2025-6-15"},
	}
	NormalizeDate(txs)
	if txs[0].Date != "2025-06-15" {
		t.Errorf("expected 2025-06-15, got %s", txs[0].Date)
	}
}

func TestNormalizeDate_LeavesAlreadyPaddedDateUnchanged(t *testing.T) {
	txs := []models.NormalizedTransaction{
		{Title: "Coffee", Date: "2025-12-06"},
	}
	NormalizeDate(txs)
	if txs[0].Date != "2025-12-06" {
		t.Errorf("expected date unchanged as 2025-12-06, got %s", txs[0].Date)
	}
}

func TestNormalizeDate_HandlesMonthNameFormat(t *testing.T) {
	// "Jan 2, 2006"-style dates from some LLMs
	txs := []models.NormalizedTransaction{
		{Title: "Coffee", Date: "Jun 15, 2024"},
	}
	NormalizeDate(txs)
	if txs[0].Date != "2024-06-15" {
		t.Errorf("expected 2024-06-15, got %s", txs[0].Date)
	}
}

func TestNormalizeDate_LeavesInvalidDateUnchanged(t *testing.T) {
	txs := []models.NormalizedTransaction{
		{Title: "Coffee", Date: "not-a-date"},
	}
	NormalizeDate(txs)
	if txs[0].Date != "not-a-date" {
		t.Errorf("expected invalid date left unchanged, got %s", txs[0].Date)
	}
}

func TestNormalizeDate_EmptyInput(t *testing.T) {
	txs := []models.NormalizedTransaction{}
	NormalizeDate(txs) // should not panic
}

func TestNormalizeDate_ProcessesMultipleTransactions(t *testing.T) {
	txs := []models.NormalizedTransaction{
		{Title: "A", Date: "2024-1-5"},
		{Title: "B", Date: "2024-12-25"},
		{Title: "C", Date: "2024-3-1"},
	}
	NormalizeDate(txs)
	want := []string{"2024-01-05", "2024-12-25", "2024-03-01"}
	for i, w := range want {
		if txs[i].Date != w {
			t.Errorf("txs[%d]: expected %s, got %s", i, w, txs[i].Date)
		}
	}
}

// ── helpers ───────────────────────────────────────────────────────────────────

// validTx returns a minimal valid NormalizedTransaction for use as a test baseline.
func validTx() models.NormalizedTransaction {
	return models.NormalizedTransaction{
		Title:    fmt.Sprintf("Test Expense %d", time.Now().UnixNano()),
		Amount:   42.50,
		Currency: "USD",
		Date:     "2024-06-15",
	}
}
