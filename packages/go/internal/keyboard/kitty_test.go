package keyboard

import (
	"bytes"
	"testing"
)

// The decoding is a pure function of a byte stream, so it is tested as one. What goes in is
// what Ghostty was measured sending on this machine (see the package comment); what has to
// come out is what Bubble Tea has always been handed.

func decode(t *testing.T, chunks ...string) (string, []Chord) {
	t.Helper()
	return decodeLive(t, false, chunks...)
}

// live is a reader whose terminal has already answered the query, which is the state any
// reader is in by the time a chord can arrive: the query goes out on the first read.
func decodeLive(t *testing.T, live bool, chunks ...string) (string, []Chord) {
	t.Helper()
	var chords []Chord
	r := &Reader{live: live, onChord: func(c Chord) { chords = append(chords, c) }}
	for _, chunk := range chunks {
		r.feed([]byte(chunk))
	}
	return string(r.ready), chords
}

func TestEscapeAndControlKeysComeBackAsTheirBytes(t *testing.T) {
	cases := []struct {
		name string
		in   string
		want string
	}{
		{"escape", "\x1b[27u", "\x1b"},
		{"ctrl+c", "\x1b[99;5u", "\x03"},
		{"ctrl+a", "\x1b[97;5u", "\x01"},
		{"enter", "\x1b[13u", "\r"},
		{"tab", "\x1b[9u", "\t"},
		{"shift+tab", "\x1b[9;2u", "\x1b[Z"},
		{"backspace", "\x1b[127u", "\x7f"},
		{"a plain letter", "\x1b[113u", "q"},
		{"alt+a", "\x1b[97;3u", "\x1ba"},
		{"ctrl+alt+c", "\x1b[99;7u", "\x1b\x03"},
		{"an event type is ignored", "\x1b[99;5:1u", "\x03"},
		{"an alternate key is ignored", "\x1b[99:99;5u", "\x03"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got, chords := decode(t, c.in)
			if got != c.want {
				t.Errorf("%q decoded to %q, want %q", c.in, got, c.want)
			}
			if len(chords) != 0 {
				t.Errorf("%q was taken for a chord", c.in)
			}
		})
	}
}

// The whole reason for the package: Cmd+C has no bytes, so it is handed over as itself and
// nothing is written into the stream.
func TestCmdCArrivesAsAChordAndNothingElse(t *testing.T) {
	got, chords := decode(t, "\x1b[99;9u")
	if got != "" {
		t.Errorf("a chord put %q into the stream", got)
	}
	if len(chords) != 1 {
		t.Fatalf("got %d chords, want 1", len(chords))
	}
	if c := chords[0]; c.Code != 'c' || !c.Super() {
		t.Errorf("got %+v, want the letter c with super", c)
	}
}

// Everything that is not a CSI u sequence is none of this package's business and must come
// through untouched — text, the arrows, a mouse report, a bracketed paste.
func TestEverythingElsePassesThroughByteForByte(t *testing.T) {
	for _, in := range []string{
		"hola",
		"\x1b[A",                              // up
		"\x1b[1;5A",                           // ctrl+up
		"\x1b[<0;12;7M",                       // a mouse press, SGR
		"\x1b[<0;12;7m",                       // and its release
		"\x1b[200~pegado\ncon salto\x1b[201~", // a bracketed paste, newline and all
		"\x1b",                                // a lone escape
		"\x03",                                // ctrl+c the old way, from a terminal without the protocol
		"\x1b[?1000h",                         // a mode nobody here sets
	} {
		got, chords := decode(t, in)
		if got != in {
			t.Errorf("%q came through as %q", in, got)
		}
		if len(chords) != 0 {
			t.Errorf("%q was taken for a chord", in)
		}
	}
}

// Input arrives in whatever sizes the tty feels like. A sequence split across two reads must
// survive: half of an escape sequence handed to Bubble Tea is a keypress nobody pressed.
func TestASequenceSplitAcrossReads(t *testing.T) {
	for _, at := range []int{1, 2, 3, 4, 5, 6} {
		full := "\x1b[99;5u"
		got, _ := decodeLive(t, true, full[:at], full[at:])
		if got != "\x03" {
			t.Errorf("split after %d bytes gave %q, want ctrl+c", at, got)
		}
	}
	// And the same for a chord, which must not leak a stray byte while it is incomplete. A
	// chord only reaches a reader whose terminal has answered, so that is the reader here.
	full := "\x1b[99;9u"
	for at := 1; at < len(full); at++ {
		got, chords := decodeLive(t, true, full[:at], full[at:])
		if got != "" {
			t.Errorf("split after %d bytes leaked %q", at, got)
		}
		if len(chords) != 1 {
			t.Errorf("split after %d bytes gave %d chords", at, len(chords))
		}
	}
}

func TestAMixedStream(t *testing.T) {
	got, chords := decode(t, "ho\x1b[99;9ula\x1b[27u\x1b[A\x1b[99;5u")
	if want := "hola\x1b\x1b[A\x03"; got != want {
		t.Errorf("got %q, want %q", got, want)
	}
	if len(chords) != 1 {
		t.Errorf("got %d chords, want 1", len(chords))
	}
}

// The terminal's answer to the query is the terminal saying it is there. It is consumed, not
// passed on: it is an answer to us, not a keypress.
func TestTheQueryAnswerIsConsumed(t *testing.T) {
	var flags = -1
	r := &Reader{onReady: func(f int) { flags = f }}
	r.feed([]byte("\x1b[?1u"))
	if len(r.ready) != 0 {
		t.Errorf("the answer put %q into the stream", r.ready)
	}
	if flags != 1 {
		t.Errorf("flags = %d, want 1", flags)
	}
}

// A terminal with no idea what any of this is never sends a CSI u sequence, so its input is
// untouched from end to end.
func TestATerminalWithoutTheProtocolIsUnaffected(t *testing.T) {
	in := "\x1b\x03hola\x1b[A\x1b[200~x\x1b[201~\x1b[<0;1;1M"
	got, chords := decode(t, in)
	if got != in {
		t.Errorf("got %q, want it untouched", got)
	}
	if len(chords) != 0 {
		t.Error("a chord appeared out of nowhere")
	}
}

// Read hands the decoded bytes over in whatever size it is asked for, and loses none.
func TestReadServesTheDecodedBytesInAnySizeOfBuffer(t *testing.T) {
	r := &Reader{}
	r.feed([]byte("\x1b[99;5uhola"))
	var out []byte
	p := make([]byte, 2)
	for len(r.ready) > 0 {
		n := copy(p, r.ready)
		r.ready = r.ready[n:]
		out = append(out, p[:n]...)
	}
	if want := "\x03hola"; !bytes.Equal(out, []byte(want)) {
		t.Errorf("got %q, want %q", out, want)
	}
}

// A lone escape at the end of a read is the one genuinely ambiguous byte, and the answer
// depends on whether the terminal is speaking the protocol. While it is, Escape arrives as
// CSI 27 u, so a bare escape is half of something and waiting a read for the rest is right.
// While it is not, this byte *is* the Escape key, and holding it would delay every press of
// it until the next key — which is worse than anything it could buy.
func TestALoneEscapeDependsOnWhetherTheProtocolIsOn(t *testing.T) {
	if got, _ := decodeLive(t, false, "\x1b"); got != "\x1b" {
		t.Errorf("without the protocol a lone escape came out as %q, want it passed straight through", got)
	}
	if got, _ := decodeLive(t, true, "\x1b"); got != "" {
		t.Errorf("with the protocol on a lone escape came out as %q, want it held", got)
	}
	// Held, and then completed by the next read.
	if got, _ := decodeLive(t, true, "\x1b", "[27u"); got != "\x1b" {
		t.Errorf("a held escape plus its sequence gave %q, want one escape", got)
	}
}

// Ctrl+Backspace has no encoding of its own, and measured in Ghostty it arrives only through
// the protocol. It means the same thing ctrl+w has always meant, so it is normalised to it
// rather than given a key of its own that half the terminals could never send.
func TestCtrlBackspaceBecomesDeleteWord(t *testing.T) {
	for _, in := range []string{"\x1b[127;5u", "\x1b[127;3u", "\x1b[8;5u"} {
		got, _ := decodeLive(t, true, in)
		if got != "\x17" {
			t.Errorf("%q decoded to %q, want ctrl+w", in, got)
		}
	}
	// And a backspace with nothing held is still a backspace.
	if got, _ := decodeLive(t, true, "\x1b[127u"); got != "\x7f" {
		t.Errorf("plain backspace decoded to %q", got)
	}
}
