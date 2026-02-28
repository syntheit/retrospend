package pdf

import (
	"testing"
)

func TestExtractTextFromPDF(t *testing.T) {
	// Using an existing PDF from the data folder for testing
	filePath := "../../data/Capital One REI Mastercard CC/Statement_012026_5258.pdf"

	text, err := ExtractTextFromPDF(filePath)
	if err != nil {
		t.Fatalf("Failed to extract text from PDF: %v", err)
	}

	if len(text) == 0 {
		t.Error("Extracted text is empty, expected content")
	}
}
