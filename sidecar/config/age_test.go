package config

import "testing"

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
		"AGE1QL3Z7HJY54PW3HYWW5AYYFG7ZQGVC7W3J2ELW8ZMRJ2KG5SFN9AQMCAC8P",
		"ssh-ed25519 AAAA",
	} {
		if _, err := ParseAgeRecipients(bad); err == nil {
			t.Errorf("accepted %q", bad)
		}
	}
}
