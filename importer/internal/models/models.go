package models

// NormalizedTransaction represents a single financial transaction in a standard format
// compatible with the Retrospend database schema.
type NormalizedTransaction struct {
	Title            string  `json:"title"`            // Merchant or description
	Amount           float64 `json:"amount"`           // Amount in the transaction's currency
	Currency         string  `json:"currency"`         // ISO 3-letter currency code
	ExchangeRate     float64 `json:"exchangeRate"`     // Rate used to convert from USD or to USD
	AmountInUSD      float64 `json:"amountInUSD"`      // Normalized amount in US Dollars
	Date             string  `json:"date"`             // YYYY-MM-DD
	Location         string  `json:"location"`         // City/Country if available
	Description      string  `json:"description"`      // Extra context
	PricingSource    string  `json:"pricingSource"`    // Source of the data (e.g., "IMPORTED")
	Category         string  `json:"category"`         // Transaction category (e.g., "Groceries")
	OriginalCurrency string  `json:"original_currency"` // Raw currency before normalization
	OriginalAmount   float64 `json:"original_amount"`   // Raw amount before normalization
}
type CSVSchema struct {
	DateColIdx     int    `json:"date_col_idx"`
	AmountColIdx   *int   `json:"amount_col_idx,omitempty"` // nil if using debit/credit
	DebitColIdx    *int   `json:"debit_col_idx,omitempty"`  // nil if using unified amount
	CreditColIdx   *int   `json:"credit_col_idx,omitempty"` // nil if using unified amount
	MerchantColIdx int    `json:"merchant_col_idx"`
	DateFormat     string `json:"date_format"`
	InvertAmounts  bool   `json:"invert_amounts"`
}

// ImportMetadata tracks success/failure statistics for import operations
type ImportMetadata struct {
	TotalChunks         int      `json:"totalChunks"`         // Total PDF chunks or enrichment batches
	SuccessfulChunks    int      `json:"successfulChunks"`    // Successfully processed chunks
	FailedChunks        int      `json:"failedChunks"`        // Failed chunks
	TotalTransactions   int      `json:"totalTransactions"`   // Total transactions returned
	SkippedTransactions int      `json:"skippedTransactions"` // Transactions skipped due to validation
	Warnings            []string `json:"warnings"`            // User-facing warning messages
}

// ImportResult wraps transactions with metadata about the import process
type ImportResult struct {
	Transactions []NormalizedTransaction `json:"transactions"`
	Metadata     ImportMetadata          `json:"metadata"`
}
