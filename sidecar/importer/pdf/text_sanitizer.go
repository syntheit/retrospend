package pdf

import (
	"log"
	"os"
	"regexp"
	"strings"
)

// SanitizePDFText removes non-transaction content from raw PDF text to reduce
// token usage and hallucination risk before sending to the LLM.
// It never removes lines that look like transactions (date + dollar amount).
func SanitizePDFText(text string) string {
	lines := strings.Split(text, "\n")
	var result []string
	var stripped []string
	blankRun := 0
	inLegalBlock := false

	for i := 0; i < len(lines); i++ {
		line := lines[i]
		trimmed := strings.TrimSpace(line)

		// Always preserve lines containing form-feed characters (\f):
		// these are page boundaries needed by the downstream chunking logic.
		if strings.Contains(line, "\f") {
			inLegalBlock = false
			blankRun = 0
			result = append(result, line)
			continue
		}

		// Always preserve transaction lines (date + dollar amount on same line)
		if isTransactionLine(trimmed) {
			inLegalBlock = false
			blankRun = 0
			result = append(result, line)
			continue
		}

		// Always preserve foreign currency data lines
		if isForeignCurrencyLine(trimmed) {
			blankRun = 0
			result = append(result, line)
			continue
		}

		// Collapse blank/decorative lines.
		// A blank line also ends any active legal block (acts as paragraph break).
		if isBlankOrDecorative(trimmed) {
			inLegalBlock = false
			blankRun++
			if blankRun <= 1 {
				result = append(result, "")
			}
			continue
		}
		blankRun = 0

		// Strip all lines within a legal block until a transaction, currency,
		// or blank line ends the block (those are handled above).
		if inLegalBlock {
			stripped = append(stripped, trimmed)
			continue
		}

		// Filter: account numbers
		if matchAccountNumber(trimmed) {
			stripped = append(stripped, trimmed)
			continue
		}

		// Filter: page headers/footers
		if matchPageHeaderFooter(trimmed) {
			stripped = append(stripped, trimmed)
			continue
		}

		// Filter: legal/disclosure text (enters block mode)
		if isLegalText(trimmed) {
			inLegalBlock = true
			stripped = append(stripped, trimmed)
			continue
		}

		// Filter: account summary lines (strip line + up to 3 following non-transaction lines)
		if matchAccountSummary(trimmed) {
			stripped = append(stripped, trimmed)
			// Strip up to 3 following lines if they're not transactions
			for j := 0; j < 3 && i+1 < len(lines); j++ {
				nextTrimmed := strings.TrimSpace(lines[i+1])
				if isTransactionLine(nextTrimmed) || isForeignCurrencyLine(nextTrimmed) {
					break
				}
				stripped = append(stripped, nextTrimmed)
				i++
			}
			continue
		}

		// Filter: customer PII (address blocks near top of content)
		if matchCustomerPII(trimmed, i, lines) {
			stripped = append(stripped, trimmed)
			continue
		}

		result = append(result, line)
	}

	if len(stripped) > 0 && isDebugLog() {
		log.Printf("[sanitizer] Stripped %d lines from PDF text", len(stripped))
		for _, s := range stripped {
			log.Printf("[sanitizer]   - %s", truncate(s, 80))
		}
	}

	return strings.Join(result, "\n")
}

// --- Transaction line detector (safety mechanism) ---

var (
	// Date pattern: M/D, MM/DD, M/DD, MM/D formats
	datePattern = regexp.MustCompile(`\d{1,2}/\d{1,2}`)
	// Dollar amount: $1,234.56 or $12.34
	dollarPattern = regexp.MustCompile(`\$[\d,]+\.\d{2}`)
)

// isTransactionLine returns true if a line contains both a date and a dollar amount,
// indicating it's likely a transaction that must never be stripped.
func isTransactionLine(line string) bool {
	return datePattern.MatchString(line) && dollarPattern.MatchString(line)
}

// --- Foreign currency preservation ---

var (
	// Standalone dollar amount on its own line
	standaloneDollar = regexp.MustCompile(`^\s*\$[\d,]+\.\d{2}\s*$`)
	// 3-letter uppercase currency code on its own line
	currencyCode = regexp.MustCompile(`^\s*[A-Z]{3}\s*$`)
	// Exchange rate line
	exchangeRate = regexp.MustCompile(`(?i)exchange\s+rate`)
)

func isForeignCurrencyLine(line string) bool {
	return standaloneDollar.MatchString(line) ||
		currencyCode.MatchString(line) ||
		exchangeRate.MatchString(line)
}

// --- Filter patterns ---

var (
	accountNumberPatterns = []*regexp.Regexp{
		regexp.MustCompile(`(?i)(account\s*(number|#|ending|no\.?))`),
		regexp.MustCompile(`(?i)(card\s*(no\.?|number|ending))`),
		regexp.MustCompile(`(?i)(member\s*(number|#|no\.?))`),
		regexp.MustCompile(`xxxx[\s-]*\d{4}`),
		regexp.MustCompile(`\*{4,}[\s-]*\d{4}`),
	}

	pageHeaderPatterns = []*regexp.Regexp{
		regexp.MustCompile(`(?i)page\s+\d+\s+(of|/)\s+\d+`),
		regexp.MustCompile(`(?i)statement\s+(period|date|closing)`),
		regexp.MustCompile(`(?i)billing\s+(period|cycle|date)`),
		regexp.MustCompile(`(?i)^(continued|cont['.]d)\s+(on\s+)?(next\s+)?page`),
	}

	legalPatterns = []*regexp.Regexp{
		regexp.MustCompile(`(?i)(annual\s+percentage\s+rate|APR\s+for)`),
		regexp.MustCompile(`(?i)FDIC`),
		regexp.MustCompile(`(?i)(terms\s+and\s+conditions|subject\s+to\s+change)`),
		regexp.MustCompile(`(?i)(interest\s+charge\s+calculation|finance\s+charge)`),
		regexp.MustCompile(`(?i)(dispute\s+a\s+transaction|billing\s+rights)`),
		regexp.MustCompile(`(?i)(important\s+(information|notice|disclosure))`),
		regexp.MustCompile(`(?i)(call\s+us\s+at|visit\s+us\s+at|www\.)`),
	}

	summaryPatterns = []*regexp.Regexp{
		regexp.MustCompile(`(?i)(previous\s+balance)`),
		regexp.MustCompile(`(?i)(new\s+(charges|balance))`),
		regexp.MustCompile(`(?i)(credit\s+limit)`),
		regexp.MustCompile(`(?i)(available\s+credit)`),
		regexp.MustCompile(`(?i)(minimum\s+payment)`),
		regexp.MustCompile(`(?i)(amount\s+due)`),
		regexp.MustCompile(`(?i)(total\s+(credits|debits|charges|payments))`),
		regexp.MustCompile(`(?i)(opening\s+balance|closing\s+balance)`),
		regexp.MustCompile(`(?i)(payment\s+due\s+date)`),
		regexp.MustCompile(`(?i)(days\s+in\s+billing)`),
	}

	zipPattern = regexp.MustCompile(`\d{5}(-\d{4})?$`)
)

func matchAccountNumber(line string) bool {
	for _, p := range accountNumberPatterns {
		if p.MatchString(line) {
			return true
		}
	}
	return false
}

func matchPageHeaderFooter(line string) bool {
	for _, p := range pageHeaderPatterns {
		if p.MatchString(line) {
			return true
		}
	}
	return false
}

func isLegalText(line string) bool {
	for _, p := range legalPatterns {
		if p.MatchString(line) {
			return true
		}
	}
	return false
}

func matchAccountSummary(line string) bool {
	for _, p := range summaryPatterns {
		if p.MatchString(line) {
			return true
		}
	}
	return false
}

// matchCustomerPII detects address blocks: clusters of short lines near page top
// with a ZIP code pattern.
func matchCustomerPII(line string, idx int, lines []string) bool {
	// Only check near the top of a page (within first 15 lines or after a form-feed)
	if idx > 15 {
		// Check if there was a form-feed recently
		nearPageBreak := false
		for j := max(0, idx-15); j < idx; j++ {
			if strings.Contains(lines[j], "\f") {
				nearPageBreak = true
				break
			}
		}
		if !nearPageBreak {
			return false
		}
	}

	// Short line with ZIP code is likely an address line
	if len(line) < 60 && zipPattern.MatchString(line) {
		return true
	}

	return false
}

// --- Helpers ---

func isBlankOrDecorative(line string) bool {
	if line == "" {
		return true
	}
	// Lines that are only dashes, underscores, equals, or dots
	cleaned := strings.Map(func(r rune) rune {
		if r == '-' || r == '_' || r == '=' || r == '.' || r == ' ' || r == '*' {
			return -1
		}
		return r
	}, line)
	return cleaned == ""
}

func isDebugLog() bool {
	return strings.EqualFold(os.Getenv("LOG_LEVEL"), "debug")
}

func truncate(s string, maxLen int) string {
	if len(s) <= maxLen {
		return s
	}
	return s[:maxLen] + "..."
}
