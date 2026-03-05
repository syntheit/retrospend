package llm

import (
	"strings"
	"testing"
)

func TestMaskCSVSampleRows_CapitalOne(t *testing.T) {
	header := "Transaction Date,Posted Date,Card No.,Description,Category,Debit,Credit"
	sampleRows := []string{
		"2025-11-01,2025-11-02,1234,UBER EATS,Dining,9.37,",
		"2025-11-03,2025-11-05,1234,AMAZON.COM,Shopping,45.99,",
		"2025-11-10,2025-11-10,1234,STARBUCKS,Dining,5.50,",
	}

	masked := MaskCSVSampleRows(header, sampleRows)

	for i, row := range masked {
		cells := strings.Split(row, ",")
		// Card No. (idx 2) should be masked
		if cells[2] != "***" {
			t.Errorf("Row %d: Card No. not masked: %s", i, cells[2])
		}
		// Category (idx 4) should be masked
		if cells[4] != "***" {
			t.Errorf("Row %d: Category not masked: %s", i, cells[4])
		}
		// Description (idx 3) should NOT be masked
		if cells[3] == "***" {
			t.Errorf("Row %d: Description was incorrectly masked", i)
		}
		// Date (idx 0) should NOT be masked
		if cells[0] == "***" {
			t.Errorf("Row %d: Date was incorrectly masked", i)
		}
		// Debit (idx 5) should NOT be masked
		if cells[5] == "***" {
			t.Errorf("Row %d: Debit was incorrectly masked", i)
		}
	}
}

func TestMaskCSVSampleRows_WithBalanceAndRefNumber(t *testing.T) {
	header := "Date,Description,Amount,Reference Number,Balance"
	sampleRows := []string{
		"11/01,WALMART,-45.23,REF123456,1234.56",
	}

	masked := MaskCSVSampleRows(header, sampleRows)

	cells := strings.Split(masked[0], ",")
	// Reference Number (idx 3) should be masked
	if cells[3] != "***" {
		t.Errorf("Reference Number not masked: %s", cells[3])
	}
	// Balance (idx 4) should be masked
	if cells[4] != "***" {
		t.Errorf("Balance not masked: %s", cells[4])
	}
	// Date, Description, Amount should NOT be masked
	if cells[0] == "***" || cells[1] == "***" || cells[2] == "***" {
		t.Error("Essential column was incorrectly masked")
	}
}

func TestMaskCSVSampleRows_NoMatchingColumns(t *testing.T) {
	header := "Date,Description,Amount"
	sampleRows := []string{
		"11/01,WALMART,-45.23",
		"11/02,TARGET,-12.99",
	}

	masked := MaskCSVSampleRows(header, sampleRows)

	// Should be unchanged
	for i, row := range masked {
		if row != sampleRows[i] {
			t.Errorf("Row %d was modified when no columns should match", i)
		}
	}
}

func TestMaskCSVSampleRows_EmptyInput(t *testing.T) {
	masked := MaskCSVSampleRows("Date,Amount", []string{})
	if len(masked) != 0 {
		t.Error("Expected empty result for empty input")
	}
}

func TestMaskCSVSampleRows_CheckAndType(t *testing.T) {
	header := "Date,Check or Slip #,Description,Amount,Transaction Type"
	sampleRows := []string{
		"11/01,12345,WALMART,-45.23,POS",
	}

	masked := MaskCSVSampleRows(header, sampleRows)

	cells := strings.Split(masked[0], ",")
	// Check or Slip # (idx 1) should be masked
	if cells[1] != "***" {
		t.Errorf("Check number not masked: %s", cells[1])
	}
	// Transaction Type (idx 4) should be masked
	if cells[4] != "***" {
		t.Errorf("Transaction Type not masked: %s", cells[4])
	}
}

func TestMaskCSVSampleRows_QuotedHeaders(t *testing.T) {
	header := `"Date","Card No.","Description","Amount"`
	sampleRows := []string{
		`2025-01-01,1234,STORE,10.00`,
	}

	masked := MaskCSVSampleRows(header, sampleRows)

	cells := strings.Split(masked[0], ",")
	// Card No. (idx 1) should be masked even with quoted header
	if cells[1] != "***" {
		t.Errorf("Quoted Card No. header not matched: %s", cells[1])
	}
}
