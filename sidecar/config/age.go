package config

import (
	"fmt"
	"regexp"
	"strings"
)

// An age X25519 public key: "age1" plus 58 bech32 characters.
var ageRecipientPattern = regexp.MustCompile(`^age1[02-9ac-hj-np-z]{58}$`)

// ParseAgeRecipients splits a comma or whitespace separated list of age public
// keys and rejects anything else, so a value can never reach the age command
// line as a flag or a file path. The error never repeats the value.
func ParseAgeRecipients(raw string) ([]string, error) {
	var out []string
	for _, part := range strings.FieldsFunc(raw, func(r rune) bool {
		return r == ',' || r == ' ' || r == '\n' || r == '\r' || r == '\t'
	}) {
		if !ageRecipientPattern.MatchString(part) {
			return nil, fmt.Errorf("BACKUP_AGE_RECIPIENT has an entry that is not an age public key (age1...)")
		}
		out = append(out, part)
	}
	return out, nil
}
