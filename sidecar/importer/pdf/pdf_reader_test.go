package pdf

import (
	"os"
	"testing"
)

func TestExtractTextFromPDF(t *testing.T) {
	// A real bank statement, kept out of the repo because it is private data.
	// The test runs only where a local copy exists.
	filePath := "../../data/Capital One REI Mastercard CC/Statement_012026_5258.pdf"
	if _, err := os.Stat(filePath); err != nil {
		t.Skipf("statement fixture not present: %v", err)
	}

	text, err := ExtractTextFromPDF(filePath)
	if err != nil {
		t.Fatalf("Failed to extract text from PDF: %v", err)
	}

	if len(text) == 0 {
		t.Error("Extracted text is empty, expected content")
	}
}
