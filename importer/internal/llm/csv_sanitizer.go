package llm

import (
	"strings"
)

// Columns whose cell values should be masked in sample rows sent to the LLM.
// Headers are preserved so the LLM still sees column names and correct indices.
var maskedColumnNames = map[string]bool{
	"card no.":           true,
	"card no":            true,
	"card number":        true,
	"reference number":   true,
	"ref #":              true,
	"ref#":               true,
	"check or slip #":    true,
	"check number":       true,
	"check #":            true,
	"balance":            true,
	"running balance":    true,
	"type":               true,
	"transaction type":   true,
	"category":           true,
	"appears on your statement as": true,
}

// MaskCSVSampleRows replaces cell values in non-essential columns with "***".
// The header string is used to determine which columns to mask.
// sampleRows are comma-separated strings matching the header layout.
func MaskCSVSampleRows(header string, sampleRows []string) []string {
	headers := strings.Split(header, ",")

	// Determine which column indices to mask
	maskIndices := make(map[int]bool)
	for i, h := range headers {
		normalized := strings.ToLower(strings.TrimSpace(h))
		// Strip surrounding quotes
		normalized = strings.Trim(normalized, "\"'")
		if maskedColumnNames[normalized] {
			maskIndices[i] = true
		}
	}

	if len(maskIndices) == 0 {
		return sampleRows
	}

	masked := make([]string, len(sampleRows))
	for i, row := range sampleRows {
		cells := strings.Split(row, ",")
		for j := range cells {
			if maskIndices[j] {
				cells[j] = "***"
			}
		}
		masked[i] = strings.Join(cells, ",")
	}

	return masked
}
