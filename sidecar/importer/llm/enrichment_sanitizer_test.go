package llm

import (
	"testing"
)

func TestCleanMerchantText(t *testing.T) {
	tests := []struct {
		name     string
		input    string
		expected string
	}{
		{
			name:     "AUTH code",
			input:    "WALMART AUTH#12345",
			expected: "WALMART",
		},
		{
			name:     "AUTH without hash",
			input:    "WALMART AUTH 67890",
			expected: "WALMART",
		},
		{
			name:     "REF code",
			input:    "AMAZON REF*1234567890",
			expected: "AMAZON",
		},
		{
			name:     "Square terminal ID",
			input:    "SQ *1234 COFFEE SHOP",
			expected: "COFFEE SHOP",
		},
		{
			name:     "PRENOTES code",
			input:    "DEMOULAS SUPER M PRENOTES 0673373MUTQ",
			expected: "DEMOULAS SUPER M",
		},
		{
			name:     "Hash with 4+ digits",
			input:    "TARGET #1234 BROOKLYN NY",
			expected: "TARGET BROOKLYN NY",
		},
		{
			name:     "Short hash preserved",
			input:    "APT #302 CAFE",
			expected: "APT #302 CAFE",
		},
		{
			name:     "Terminal ID with T-prefix",
			input:    "TARGET T-1234",
			expected: "TARGET",
		},
		{
			name:     "Payment processor ID",
			input:    "UBER *EATS 8472916482",
			expected: "UBER *EATS",
		},
		{
			name:     "Uber with star and long ID",
			input:    "UBER* TRIP 847291648290",
			expected: "UBER* TRIP",
		},
		{
			name:     "POS PURCHASE prefix",
			input:    "POS PURCHASE WALMART",
			expected: "WALMART",
		},
		{
			name:     "CHECKCARD prefix",
			input:    "CHECKCARD 1234 STARBUCKS",
			expected: "STARBUCKS",
		},
		{
			name:     "Trailing transaction ID",
			input:    "STARBUCKS CARD 8274619ABC2",
			expected: "STARBUCKS CARD",
		},
		{
			name:     "Multiple noise patterns",
			input:    "POS PURCHASE AUTH#12345 WALMART #5678 REF*999",
			expected: "WALMART",
		},
		{
			name:     "No noise - unchanged",
			input:    "WALMART SUPERCENTER",
			expected: "WALMART SUPERCENTER",
		},
		{
			name:     "Empty string",
			input:    "",
			expected: "",
		},
		{
			name:     "Only noise - returns original",
			input:    "AUTH#12345",
			expected: "AUTH#12345",
		},
		{
			name:     "Transfer text preserved",
			input:    "FUNDS TRAN JOHN DOE",
			expected: "FUNDS TRAN JOHN DOE",
		},
		{
			name:     "Mixed case AUTH",
			input:    "TARGET auth#99999",
			expected: "TARGET",
		},
		{
			name:     "SQ with various spacing",
			input:    "SQ*5678 LOCAL BAKERY",
			expected: "LOCAL BAKERY",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := CleanMerchantText(tt.input)
			if got != tt.expected {
				t.Errorf("CleanMerchantText(%q) = %q, want %q", tt.input, got, tt.expected)
			}
		})
	}
}

func TestCleanMerchantText_DoesNotStripShortNumbers(t *testing.T) {
	// Numbers with fewer than 4 digits after # should be preserved
	inputs := []string{
		"UNIT #12",
		"APT #302 CAFE",
		"STORE #99",
	}

	for _, input := range inputs {
		got := CleanMerchantText(input)
		if got != input {
			t.Errorf("CleanMerchantText(%q) = %q, want unchanged", input, got)
		}
	}
}

func TestCleanMerchantText_CollapsesSpaces(t *testing.T) {
	// After removing a pattern from the middle, spaces should be collapsed
	input := "WALMART   AUTH#12345   STORE"
	got := CleanMerchantText(input)
	if got != "WALMART STORE" {
		t.Errorf("CleanMerchantText(%q) = %q, want %q", input, got, "WALMART STORE")
	}
}
