package processor

import "testing"

func TestNormalizeCurrency(t *testing.T) {
	tests := []struct {
		input    string
		expected string
	}{
		{"BRAZILIAN REAL", "BRL"},
		{"argentine peso", "ARS"},
		{"  EURO  ", "EUR"},
		{"British Pound Sterling", "GBP"},
		{"UNKNOWN", "UNKNOWN"},
		{"USD", "USD"},
	}

	for _, tt := range tests {
		result := NormalizeCurrency(tt.input)
		if result != tt.expected {
			t.Errorf("NormalizeCurrency(%q) = %q; expected %q", tt.input, result, tt.expected)
		}
	}
}
