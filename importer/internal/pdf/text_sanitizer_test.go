package pdf

import (
	"strings"
	"testing"
)

func TestSanitizePDFText_TransactionLinesPreserved(t *testing.T) {
	input := `Account Number: xxxx-1234
Page 1 of 3
11/21   11/21   UBER* TRIPOSASCO SP   $9.37
Previous Balance                    $1,234.56
11/22   11/24   PAYU*AR*UBER CAP.FEDERAL   $12.10`

	result := SanitizePDFText(input)

	// Transaction lines must be preserved
	if !strings.Contains(result, "UBER* TRIPOSASCO SP   $9.37") {
		t.Error("Transaction line 1 was stripped")
	}
	if !strings.Contains(result, "PAYU*AR*UBER CAP.FEDERAL   $12.10") {
		t.Error("Transaction line 2 was stripped")
	}

	// Non-transaction lines should be stripped
	if strings.Contains(result, "Account Number") {
		t.Error("Account number line was not stripped")
	}
	if strings.Contains(result, "Page 1 of 3") {
		t.Error("Page header was not stripped")
	}
	if strings.Contains(result, "Previous Balance") {
		t.Error("Account summary was not stripped")
	}
}

func TestSanitizePDFText_ForeignCurrencyPreserved(t *testing.T) {
	input := `11/21   11/21   UBER* TRIPOSASCO SP   $9.37
$49.96
BRL
5.331910352 Exchange Rate
11/22   11/24   PAYU*AR*UBER CAP.FEDERAL   $12.10
$16,322.00
ARS
1348.925619835 Exchange Rate`

	result := SanitizePDFText(input)

	// All foreign currency lines must be preserved
	if !strings.Contains(result, "$49.96") {
		t.Error("Foreign currency amount was stripped")
	}
	if !strings.Contains(result, "BRL") {
		t.Error("Currency code BRL was stripped")
	}
	if !strings.Contains(result, "Exchange Rate") {
		t.Error("Exchange rate line was stripped")
	}
	if !strings.Contains(result, "$16,322.00") {
		t.Error("Large foreign currency amount was stripped")
	}
	if !strings.Contains(result, "ARS") {
		t.Error("Currency code ARS was stripped")
	}
}

func TestSanitizePDFText_AccountSummaryStripped(t *testing.T) {
	input := `Previous Balance                    $1,234.56
+ New Charges                       $567.89
- Payments                          $1,234.56
= New Balance                       $567.89
Credit Limit                        $5,000.00
Available Credit                    $4,432.11
11/21   11/21   ACTUAL TRANSACTION   $9.37`

	result := SanitizePDFText(input)

	if strings.Contains(result, "Previous Balance") {
		t.Error("Previous Balance was not stripped")
	}
	if strings.Contains(result, "New Charges") {
		t.Error("New Charges was not stripped")
	}
	if strings.Contains(result, "New Balance") {
		t.Error("New Balance was not stripped")
	}
	if strings.Contains(result, "Credit Limit") {
		t.Error("Credit Limit was not stripped")
	}
	if strings.Contains(result, "Available Credit") {
		t.Error("Available Credit was not stripped")
	}

	// Transaction must survive
	if !strings.Contains(result, "ACTUAL TRANSACTION   $9.37") {
		t.Error("Transaction line was incorrectly stripped")
	}
}

func TestSanitizePDFText_LegalTextStripped(t *testing.T) {
	input := `11/21   11/21   GROCERY STORE   $45.00
Annual Percentage Rate (APR) for purchases: 24.99%
This rate is determined by adding a margin of 12.74%
to the Prime Rate published in the Wall Street Journal.
FDIC insured. Terms and conditions subject to change.
11/22   11/22   GAS STATION   $30.00`

	result := SanitizePDFText(input)

	if strings.Contains(result, "Annual Percentage Rate") {
		t.Error("APR text was not stripped")
	}
	// Middle-of-paragraph lines must also be stripped (legal block mode)
	if strings.Contains(result, "margin of 12.74") {
		t.Error("Legal block continuation line was not stripped")
	}
	if strings.Contains(result, "Prime Rate") {
		t.Error("Legal block continuation line was not stripped")
	}
	if strings.Contains(result, "FDIC") {
		t.Error("FDIC text was not stripped")
	}
	if strings.Contains(result, "Terms and conditions") {
		t.Error("Terms text was not stripped")
	}

	// Transactions preserved
	if !strings.Contains(result, "GROCERY STORE   $45.00") {
		t.Error("Transaction was stripped")
	}
	if !strings.Contains(result, "GAS STATION   $30.00") {
		t.Error("Transaction was stripped")
	}
}

func TestSanitizePDFText_PageHeadersStripped(t *testing.T) {
	input := `Page 1 of 5
Statement Period: 11/01/2025 - 11/30/2025
Billing Period: November 2025
11/21   11/21   COFFEE SHOP   $4.50`

	result := SanitizePDFText(input)

	if strings.Contains(result, "Page 1 of 5") {
		t.Error("Page header was not stripped")
	}
	if strings.Contains(result, "Statement Period") {
		t.Error("Statement period was not stripped")
	}
	if strings.Contains(result, "Billing Period") {
		t.Error("Billing period was not stripped")
	}
	if !strings.Contains(result, "COFFEE SHOP   $4.50") {
		t.Error("Transaction was stripped")
	}
}

func TestSanitizePDFText_BlankLinesCollapsed(t *testing.T) {
	input := `11/21   11/21   STORE ONE   $10.00



---___===...

11/22   11/22   STORE TWO   $20.00`

	result := SanitizePDFText(input)

	// Should not have runs of 3+ blank lines
	if strings.Contains(result, "\n\n\n") {
		t.Error("Multiple blank lines were not collapsed")
	}

	// Both transactions preserved
	if !strings.Contains(result, "STORE ONE") {
		t.Error("Transaction 1 stripped")
	}
	if !strings.Contains(result, "STORE TWO") {
		t.Error("Transaction 2 stripped")
	}
}

func TestSanitizePDFText_EdgeCase_KeywordsInMerchant(t *testing.T) {
	// "CHASE CREDIT PAYMENT" contains "credit" but is a transaction line with date+amount
	input := `11/15   11/15   CHASE CREDIT PAYMENT   $500.00`

	result := SanitizePDFText(input)

	if !strings.Contains(result, "CHASE CREDIT PAYMENT") {
		t.Error("Transaction with 'credit' keyword was incorrectly stripped")
	}
}

func TestSanitizePDFText_EmptyInput(t *testing.T) {
	result := SanitizePDFText("")
	if result != "" {
		t.Errorf("Expected empty string, got: %q", result)
	}
}

func TestSanitizePDFText_MinimalInput(t *testing.T) {
	input := "Just some text"
	result := SanitizePDFText(input)
	if result != input {
		t.Errorf("Expected unchanged text, got: %q", result)
	}
}

func TestSanitizePDFText_NoOpWhenNothingMatches(t *testing.T) {
	input := `11/01   11/01   WALMART   $45.23
11/02   11/02   TARGET   $12.99
11/03   11/03   AMAZON   $89.00`

	result := SanitizePDFText(input)

	if result != input {
		t.Error("Sanitizer modified pure-transaction input")
	}
}

func TestSanitizePDFText_AccountNumberVariants(t *testing.T) {
	tests := []string{
		"Account Number: 1234567890",
		"Account #: xxxx-1234",
		"Account ending in 1234",
		"Card No. xxxx xxxx xxxx 1234",
		"Card Number: ****1234",
		"Member Number: 12345678",
	}

	for _, test := range tests {
		input := test + "\n11/01   11/01   STORE   $10.00"
		result := SanitizePDFText(input)
		if strings.Contains(result, test) {
			t.Errorf("Account number variant was not stripped: %s", test)
		}
	}
}

func TestSanitizePDFText_RealWorldStatement(t *testing.T) {
	input := `CHASE CREDIT CARD STATEMENT
Account Number: xxxx-xxxx-xxxx-1234
Page 1 of 3
Statement Period: 11/01/2025 - 11/30/2025

John Doe
123 Main Street
Anytown, ST 12345-6789

Account Summary
Previous Balance                    $1,234.56
New Charges                         $567.89
Payments                            -$1,234.56
New Balance                         $567.89
Minimum Payment Due                 $25.00
Payment Due Date                    12/15/2025

Transactions

11/01   11/01   UBER* TRIPOSASCO SP   $9.37
$49.96
BRL
5.331910352 Exchange Rate
11/03   11/05   AMAZON.COM   $45.99
11/15   11/15   TARGET #1234 BROOKLYN NY   $89.50

Annual Percentage Rate (APR) for purchases: 24.99%
Visit us at www.chase.com for more details.
FDIC insured.

Page 2 of 3
Continued on next page`

	result := SanitizePDFText(input)

	// Transactions preserved
	if !strings.Contains(result, "UBER* TRIPOSASCO SP   $9.37") {
		t.Error("Uber transaction stripped")
	}
	if !strings.Contains(result, "AMAZON.COM   $45.99") {
		t.Error("Amazon transaction stripped")
	}
	if !strings.Contains(result, "TARGET #1234 BROOKLYN NY   $89.50") {
		t.Error("Target transaction stripped")
	}

	// Foreign currency preserved
	if !strings.Contains(result, "$49.96") {
		t.Error("Foreign amount stripped")
	}
	if !strings.Contains(result, "BRL") {
		t.Error("BRL code stripped")
	}
	if !strings.Contains(result, "Exchange Rate") {
		t.Error("Exchange rate stripped")
	}

	// Noise stripped
	if strings.Contains(result, "Account Number") {
		t.Error("Account number not stripped")
	}
	if strings.Contains(result, "Page 1 of 3") {
		t.Error("Page header not stripped")
	}
	if strings.Contains(result, "12345-6789") {
		t.Error("ZIP code address not stripped")
	}
	if strings.Contains(result, "Previous Balance") {
		t.Error("Previous Balance not stripped")
	}
	if strings.Contains(result, "Minimum Payment") {
		t.Error("Minimum Payment not stripped")
	}
	if strings.Contains(result, "Annual Percentage") {
		t.Error("APR not stripped")
	}
	if strings.Contains(result, "FDIC") {
		t.Error("FDIC not stripped")
	}
	if strings.Contains(result, "Continued on next") {
		t.Error("Page footer not stripped")
	}
}

func TestSanitizePDFText_FormFeedPreserved(t *testing.T) {
	// Form-feed characters are page boundaries used by the chunking logic.
	// They MUST survive sanitization.

	// Case 1: form-feed on its own line
	input := "page 1 content\n\f\npage 2 content"
	result := SanitizePDFText(input)
	if !strings.Contains(result, "\f") {
		t.Error("Form-feed on its own line was lost")
	}

	// Case 2: form-feed at start of a line
	input = "page 1 content\n\fpage 2 content"
	result = SanitizePDFText(input)
	if !strings.Contains(result, "\f") {
		t.Error("Form-feed at start of line was lost")
	}

	// Case 3: form-feed between noise content — the \f itself must survive
	// even if surrounding lines are stripped
	input = "Page 1 of 2\n\f\nPage 2 of 2"
	result = SanitizePDFText(input)
	if !strings.Contains(result, "\f") {
		t.Error("Form-feed between stripped lines was lost")
	}
}

func TestSanitizePDFText_LegalBlockEndsAtBlankLine(t *testing.T) {
	// Legal block should end when a blank line is encountered
	input := `Annual Percentage Rate (APR) for purchases: 24.99%
This rate is variable and may change.
Some other legal text here.

This normal text should NOT be stripped.
11/22   11/22   STORE   $30.00`

	result := SanitizePDFText(input)

	// Legal lines should be stripped
	if strings.Contains(result, "Annual Percentage Rate") {
		t.Error("APR text was not stripped")
	}
	if strings.Contains(result, "variable and may change") {
		t.Error("Legal continuation was not stripped")
	}

	// After blank line, normal text should be preserved
	if !strings.Contains(result, "normal text should NOT be stripped") {
		t.Error("Text after legal block blank line was incorrectly stripped")
	}
	if !strings.Contains(result, "STORE   $30.00") {
		t.Error("Transaction after legal block was stripped")
	}
}

func TestSanitizePDFText_LegalBlockEndsAtTransaction(t *testing.T) {
	// Legal block must end when a transaction line is encountered (no blank line between)
	input := `Annual Percentage Rate (APR) for purchases: 24.99%
This rate is variable and may change.
11/22   11/22   STORE   $30.00`

	result := SanitizePDFText(input)

	if strings.Contains(result, "Annual Percentage") {
		t.Error("APR text was not stripped")
	}
	if strings.Contains(result, "variable") {
		t.Error("Legal continuation was not stripped")
	}
	if !strings.Contains(result, "STORE   $30.00") {
		t.Error("Transaction after legal block was stripped")
	}
}

func TestIsTransactionLine(t *testing.T) {
	tests := []struct {
		line     string
		expected bool
	}{
		{"11/21   11/21   UBER   $9.37", true},
		{"1/5   1/7   STORE   $1,234.56", true},
		{"Previous Balance   $1,234.56", false}, // no date
		{"11/21   PAYMENT RECEIVED", false},      // no amount
		{"Just some text", false},
		{"$49.96", false}, // amount but no date
	}

	for _, tt := range tests {
		got := isTransactionLine(tt.line)
		if got != tt.expected {
			t.Errorf("isTransactionLine(%q) = %v, want %v", tt.line, got, tt.expected)
		}
	}
}

func TestIsForeignCurrencyLine(t *testing.T) {
	tests := []struct {
		line     string
		expected bool
	}{
		{"$49.96", true},
		{"  $16,322.00  ", true},
		{"BRL", true},
		{"ARS", true},
		{"USD", true},
		{"5.331910352 Exchange Rate", true},
		{"1348.925619835 exchange rate", true},
		{"UBER EATS", false},
		{"$49.96 something else", false}, // not standalone
	}

	for _, tt := range tests {
		got := isForeignCurrencyLine(tt.line)
		if got != tt.expected {
			t.Errorf("isForeignCurrencyLine(%q) = %v, want %v", tt.line, got, tt.expected)
		}
	}
}
