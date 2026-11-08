package tasks

import "testing"

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

func TestPostingForCopiesDirection(t *testing.T) {
	in := postingFor(RecurringTemplate{Direction: "IN"})
	if in.Direction != "IN" || in.InType == nil || *in.InType != "INCOME" {
		t.Fatalf("IN template: got %+v", in)
	}
	for _, direction := range []string{"OUT", ""} {
		out := postingFor(RecurringTemplate{Direction: direction})
		if out.Direction != "OUT" || out.InType != nil {
			t.Fatalf("%q template: got %+v", direction, out)
		}
	}
}
