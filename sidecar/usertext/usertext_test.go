package usertext

import (
	"errors"
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
		got, err := StripControls(in)
		if err != nil || got != want {
			t.Errorf("U+%04X: got %q, %v, want %q", code, got, err, want)
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
		got, err := StripControls(in)
		if err != nil || got != want {
			t.Errorf("%q: got %q, %v, want %q", in, got, err, want)
		}
	}
}

func TestStripControlsChangesNothingElse(t *testing.T) {
	// No trim, no case folding, and every other character is kept, including
	// DEL, NEL, a real U+FFFD, emoji, right-to-left text and a combining mark.
	text := "  Café Ñ שלום \u007f\u0085� \U0001F600 é\r\n\t "
	if got, err := StripControls(text); err != nil || got != text {
		t.Errorf("got %q, %v, want %q", got, err, text)
	}
	if got, err := StripControls("ABC\vdef "); err != nil || got != "ABCdef " {
		t.Errorf("got %q, %v", got, err)
	}
	if got, err := StripControls(""); err != nil || got != "" {
		t.Errorf("empty: got %q, %v", got, err)
	}
}

func TestStripControlsRefusesTextThatStartsWithU0001(t *testing.T) {
	for _, in := range []string{"\x01k1:AAAA", "\x01", "\x01\x07x"} {
		got, err := StripControls(in)
		if !errors.Is(err, ErrSealedText) || got != "" {
			t.Errorf("%q: got %q, %v, want ErrSealedText", in, got, err)
		}
	}
}

func TestStripControlsStillStripsU0001ThatIsNotFirst(t *testing.T) {
	if got, err := StripControls("a\x01k1:b"); err != nil || got != "ak1:b" {
		t.Errorf("got %q, %v", got, err)
	}
	if got, err := StripControls(" \x01b"); err != nil || got != " b" {
		t.Errorf("got %q, %v", got, err)
	}
}
