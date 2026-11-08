package config

import (
	"errors"
	"strings"
	"testing"
)

const validRecipient = "age1ql3z7hjy54pw3hyww5ayyfg7zqgvc7w3j2elw8zmrj2kg5sfn9aqmcac8p"

func TestParseAgeRecipients(t *testing.T) {
	got, err := ParseAgeRecipients(validRecipient + ",\n " + validRecipient)
	if err != nil || len(got) != 2 || got[0] != validRecipient {
		t.Fatalf("got %v, %v", got, err)
	}
	if got, err := ParseAgeRecipients(""); err != nil || len(got) != 0 {
		t.Fatalf("empty must mean no encryption: %v, %v", got, err)
	}
}

func TestParseAgeRecipientsRejectsAnythingElse(t *testing.T) {
	for _, bad := range []string{
		"--identity=/etc/passwd",
		"/etc/passwd",
		"age1short",
		validRecipient + "x",
		validRecipient[:len(validRecipient)-1] + "q", // bad checksum
		"AGE-SECRET-KEY-1QQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQ",
		"ssh-ed25519 AAAA",
	} {
		_, err := ParseAgeRecipients(bad)
		if !errors.Is(err, ErrInvalidAgeRecipient) {
			t.Errorf("accepted %q", bad)
			continue
		}
		if strings.Contains(err.Error(), bad) {
			t.Errorf("error repeats the value %q", bad)
		}
	}
}
