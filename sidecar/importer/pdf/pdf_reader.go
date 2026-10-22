package pdf

import (
	"bytes"
	"fmt"
	"os/exec"
)

// ExtractTextFromPDF extracts all text from a PDF file located at filePath using pdftotext.
func ExtractTextFromPDF(filePath string) (string, error) {
	cmd := exec.Command("pdftotext", "-layout", filePath, "-")
	// pdftotext prints warnings (for example "Syntax Warning: ...") to stderr
	// even when it succeeds. Keep them apart so they never become statement text.
	var stderr bytes.Buffer
	cmd.Stderr = &stderr
	output, err := cmd.Output()
	if err != nil {
		return "", fmt.Errorf("pdftotext failed: %w, stderr: %s", err, stderr.String())
	}
	return string(output), nil
}
