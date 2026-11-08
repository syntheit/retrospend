package usertext

import (
	"fmt"
	"testing"
)

func TestStripControlsRemovesC0ExceptTabLineFeedCarriageReturn(t *testing.T) {
	for code := 0; code < 0x20; code++ {
		in := fmt.Sprintf("a%cb", rune(code))
		want := "ab"
		if code == 0x09 || code == 0x0a || code == 0x0d {
			want = in
		}
		if got := StripControls(in); got != want {
			t.Errorf("U+%04X: got %q, want %q", code, got, want)
		}
	}
}

func TestStripControlsDropsInvalidUTF8AndEncodedSurrogates(t *testing.T) {
	cases := map[string]string{
		"a\xffb":         "ab",
		"x\xed\xa0\x80y": "xy", // U+D800 as three bytes is not valid UTF-8
		"\xc3(":          "(",
	}
	for in, want := range cases {
		if got := StripControls(in); got != want {
			t.Errorf("%q: got %q, want %q", in, got, want)
		}
	}
}

func TestStripControlsChangesNothingElse(t *testing.T) {
	// No trim, no case folding, and every other character is kept, including
	// DEL, NEL, a real U+FFFD, emoji, right-to-left text and a combining mark.
	text := "  Café Ñ שלום \u007f\u0085� \U0001F600 é\r\n\t "
	if got := StripControls(text); got != text {
		t.Errorf("got %q, want %q", got, text)
	}
	if got := StripControls("ABC\vdef "); got != "ABCdef " {
		t.Errorf("got %q", got)
	}
	if got := StripControls(""); got != "" {
		t.Errorf("empty: got %q", got)
	}
}
