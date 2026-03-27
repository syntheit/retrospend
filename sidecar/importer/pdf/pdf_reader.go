package pdf

import (
	"fmt"
	"os/exec"
)

// ExtractTextFromPDF extracts all text from a PDF file located at filePath using pdftotext.
func ExtractTextFromPDF(filePath string) (string, error) {
	cmd := exec.Command("pdftotext", "-layout", filePath, "-")
	output, err := cmd.CombinedOutput()
	if err != nil {
		return "", fmt.Errorf("pdftotext failed: %v, output: %s", err, string(output))
	}
	return string(output), nil
}
