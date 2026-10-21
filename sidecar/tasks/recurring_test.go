package tasks

import (
	"testing"
	"time"
)

func TestAddMonthsClampedKeepsAnchor(t *testing.T) {
	anchor := 31
	d := time.Date(2026, 1, 31, 3, 0, 0, 0, time.UTC)
	want := []string{"2026-02-28", "2026-03-31", "2026-04-30", "2026-05-31"}
	for _, w := range want {
		d = calculateNextDueDate(d, "MONTHLY", &anchor)
		if got := d.Format("2006-01-02"); got != w {
			t.Fatalf("got %s, want %s", got, w)
		}
		if d.Hour() != 3 {
			t.Fatalf("time of day changed: %v", d)
		}
	}
}

func TestAddMonthsClampedLeapYearAndQuarterly(t *testing.T) {
	anchor := 31
	if got := calculateNextDueDate(time.Date(2028, 1, 31, 0, 0, 0, 0, time.UTC), "MONTHLY", &anchor).Format("2006-01-02"); got != "2028-02-29" {
		t.Fatalf("leap: got %s", got)
	}
	thirty := 30
	if got := calculateNextDueDate(time.Date(2025, 11, 30, 0, 0, 0, 0, time.UTC), "QUARTERLY", &thirty).Format("2006-01-02"); got != "2026-02-28" {
		t.Fatalf("quarterly: got %s", got)
	}
	if got := calculateNextDueDate(time.Date(2026, 3, 15, 0, 0, 0, 0, time.UTC), "MONTHLY", nil).Format("2006-01-02"); got != "2026-04-15" {
		t.Fatalf("no anchor: got %s", got)
	}
}

func TestAmountToUSDUsesCurrencyNotRateType(t *testing.T) {
	// ARS "crypto" rate type is still ARS per USD: divide.
	if got := amountToUSD(159468, "ARS", 1594.68); got != 100 {
		t.Fatalf("ARS: got %v", got)
	}
	if got := amountToUSD(0.001, "BTC", 64545.9); got != 64.55 {
		t.Fatalf("BTC: got %v", got)
	}
	if got := amountToUSD(12.5, "USD", 1); got != 12.5 {
		t.Fatalf("USD: got %v", got)
	}
}
