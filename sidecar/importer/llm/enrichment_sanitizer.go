package llm

import (
	"regexp"
	"strings"
)

// Noise patterns to strip from merchant strings before enrichment.
// These are internal bank codes, reference numbers, and system identifiers
// that waste LLM tokens and confuse categorization.
var merchantNoisePatterns = []*regexp.Regexp{
	// AUTH#12345 or AUTH 12345
	regexp.MustCompile(`(?i)\bAUTH#?\s*\d+\b`),
	// REF*1234567890 or REF 1234567890
	regexp.MustCompile(`(?i)\bREF\*?\s*\d+\b`),
	// SQ *1234 (Square terminal IDs)
	regexp.MustCompile(`(?i)\bSQ\s*\*?\s*\d+\b`),
	// PRENOTES 0673373MUTQ or PRENOTE ABC123
	regexp.MustCompile(`(?i)\bPRENOTES?\s+\S+\b`),
	// #12345 (4+ digits to avoid stripping "Apt #302 Cafe")
	regexp.MustCompile(`#\d{4,}`),
	// T-12345 (store/terminal IDs)
	regexp.MustCompile(`\bT-\d{4,}\b`),
	// * followed by 6+ digits (payment processor IDs like "UBER *EATS 8472916482")
	regexp.MustCompile(`\*\s*\d{6,}`),
	// POS PURCHASE, POS DEBIT, POS REFUND prefixes
	regexp.MustCompile(`(?i)^POS\s+(PURCHASE|DEBIT|REFUND|WITHDRAWAL)\s+`),
	// CHECKCARD prefix
	regexp.MustCompile(`(?i)^CHECKCARD\s+\d*\s*`),
	// Trailing transaction IDs (long alphanumeric strings that contain digits)
	regexp.MustCompile(`\s+[A-Z]*\d[A-Z0-9]{9,}$`),
}

// CleanMerchantText strips noise patterns from a merchant/transaction string
// to improve LLM enrichment quality and deduplication.
func CleanMerchantText(text string) string {
	result := text
	for _, p := range merchantNoisePatterns {
		result = p.ReplaceAllString(result, "")
	}

	// Clean up leftover whitespace
	result = strings.TrimSpace(result)
	// Collapse multiple spaces into one
	result = collapseSpaces(result)

	// If we stripped everything, return the original
	if result == "" {
		return text
	}

	return result
}

var multiSpacePattern = regexp.MustCompile(`\s{2,}`)

func collapseSpaces(s string) string {
	return multiSpacePattern.ReplaceAllString(s, " ")
}
