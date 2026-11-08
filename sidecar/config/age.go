package config

import (
	"errors"
	"strings"

	"filippo.io/age"
)

// ErrInvalidAgeRecipient is the stable error for a bad BACKUP_AGE_RECIPIENT. The
// value is never repeated, in the error or anywhere else.
var ErrInvalidAgeRecipient = errors.New("BACKUP_AGE_RECIPIENT is invalid: every entry must be an age public key (age1...)")

// ParseAgeRecipients splits a comma or whitespace separated list of age public
// keys and checks each one, including its checksum, so a typo stops the sidecar
// at start instead of producing a backup nobody can open.
func ParseAgeRecipients(raw string) ([]string, error) {
	var out []string
	for _, part := range strings.FieldsFunc(raw, func(r rune) bool {
		return r == ',' || r == ' ' || r == '\n' || r == '\r' || r == '\t'
	}) {
		if _, err := age.ParseX25519Recipient(part); err != nil {
			return nil, ErrInvalidAgeRecipient
		}
		out = append(out, part)
	}
	return out, nil
}
