package pdf

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestExtractTextFromPDF(t *testing.T) {
	text, err := ExtractTextFromPDF("testdata/hello.pdf")
	if err != nil {
		t.Fatalf("Failed to extract text from PDF: %v", err)
	}

	if got := strings.TrimSpace(text); got != "Hello Retrospend" {
		t.Errorf("extracted text = %q, want %q", got, "Hello Retrospend")
	}
}

func TestExtractTextFromPDFKeepsWarningsOut(t *testing.T) {
	// A stand-in pdftotext that succeeds but also warns on stderr, as the
	// real one does for slightly broken statements.
	dir := t.TempDir()
	script := "#!/bin/sh\necho 'Syntax Warning: bad xref' >&2\necho 'Statement text'\n"
	if err := os.WriteFile(filepath.Join(dir, "pdftotext"), []byte(script), 0o755); err != nil {
		t.Fatal(err)
	}
	t.Setenv("PATH", dir)

	text, err := ExtractTextFromPDF("ignored.pdf")
	if err != nil {
		t.Fatalf("Failed to extract text from PDF: %v", err)
	}
	if text != "Statement text\n" {
		t.Errorf("extracted text = %q, want only stdout", text)
	}
}

func TestExtractTextFromPDFReportsStderrOnFailure(t *testing.T) {
	dir := t.TempDir()
	script := "#!/bin/sh\necho 'I/O Error: Couldn'\\''t open file' >&2\nexit 1\n"
	if err := os.WriteFile(filepath.Join(dir, "pdftotext"), []byte(script), 0o755); err != nil {
		t.Fatal(err)
	}
	t.Setenv("PATH", dir)

	_, err := ExtractTextFromPDF("missing.pdf")
	if err == nil || !strings.Contains(err.Error(), "Couldn't open file") {
		t.Fatalf("error = %v, want it to include pdftotext's stderr", err)
	}
}

func TestExtractTextFromPrivateStatement(t *testing.T) {
	// A real bank statement, kept out of the repo because it is private data.
	// It runs only where a local copy exists.
	filePath := "../../data/Capital One REI Mastercard CC/Statement_012026_5258.pdf"
	if _, err := os.Stat(filePath); err != nil {
		t.Skipf("private statement not present: %v", err)
	}

	text, err := ExtractTextFromPDF(filePath)
	if err != nil {
		t.Fatalf("Failed to extract text from PDF: %v", err)
	}
	if len(text) == 0 {
		t.Error("Extracted text is empty, expected content")
	}
}
