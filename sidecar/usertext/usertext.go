// Package usertext cleans free text the sidecar writes on a person's behalf
// (imported titles, recurring posts) so the app can always edit the row.
//
// It mirrors stripUserTextControls in packages/api-contract/src/common/user-text.ts:
// the app refuses C0 control characters other than tab, line feed and
// carriage return, and lone surrogates, in every user-text field. Text from a
// bank file or an old recurring template can hold them, and one such row
// would fail every later edit. Nothing else changes: no trim, no case folding.
package usertext

import (
	"strings"
	"unicode/utf8"
)

// StripControls removes C0 control characters (U+0000 to U+001F) except tab,
// line feed and carriage return, and bytes that are not valid UTF-8. A lone
// surrogate has no valid UTF-8 form, so it is dropped with the invalid bytes.
func StripControls(text string) string {
	if !needsStrip(text) {
		return text
	}
	var out strings.Builder
	out.Grow(len(text))
	for i := 0; i < len(text); {
		r, size := utf8.DecodeRuneInString(text[i:])
		if r == utf8.RuneError && size == 1 {
			i++
			continue
		}
		if !forbidden(r) {
			out.WriteString(text[i : i+size])
		}
		i += size
	}
	return out.String()
}

func forbidden(r rune) bool {
	return r < 0x20 && r != '\t' && r != '\n' && r != '\r'
}

func needsStrip(text string) bool {
	if !utf8.ValidString(text) {
		return true
	}
	for _, r := range text {
		if forbidden(r) {
			return true
		}
	}
	return false
}
