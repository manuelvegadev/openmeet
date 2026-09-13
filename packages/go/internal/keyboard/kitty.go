// Package keyboard speaks the kitty keyboard protocol, for the one thing the encoding a
// terminal has used since the seventies cannot express: a chord with Cmd in it.
//
// Measured in Ghostty on this machine, which is where the design comes from rather than from
// the specification alone:
//
//	CSI ? u                 asks what the terminal does; Ghostty answers CSI ? 0 u
//	CSI = 1 u               turns on "disambiguate escape codes", and then:
//	  Cmd+C   → CSI 99;9u   ← the whole point. Without the protocol it sends nothing at all.
//	  Esc     → CSI 27u     ← and this is the price
//	  Ctrl+C  → CSI 99;5u   ← and this
//	  Enter, Tab, arrows    unchanged
//
// So the protocol cannot simply be switched on: Esc and Ctrl+C are most of this application's
// keyboard, and Bubble Tea v1 does not know what CSI u means. A Reader sits between the tty
// and Bubble Tea, turns those sequences back into the bytes they used to be, and keeps the
// chords that never had bytes — which is the only reason any of this is here.
//
// A terminal that does not implement the protocol never answers the query and never sends a
// CSI u sequence, so on one of those this package does nothing at all.
package keyboard

import (
	"io"
	"os"
	"strconv"
	"strings"
)

// The kitty modifier bits, as they arrive (the field on the wire is one more than these).
const (
	ModShift = 1
	ModAlt   = 2
	ModCtrl  = 4
	ModSuper = 8
	ModHyper = 16
	ModMeta  = 32
)

// Chord is a key the legacy encoding has no bytes for, so it is handed to the program as
// itself rather than translated.
type Chord struct {
	Code int // the key's unicode code point: 'c' is 99
	Mods int // the bits above
}

// Super is the Command key on macOS and the Windows key elsewhere.
func (c Chord) Super() bool { return c.Mods&(ModSuper|ModHyper|ModMeta) != 0 }

// Reader is the tty with the kitty protocol decoded out of it. It embeds the file so that
// Bubble Tea still recognises its input as a terminal — it type-asserts for one before it
// will put the terminal in raw mode — and replaces only the reading.
type Reader struct {
	*os.File
	out     io.Writer // where the negotiation is written: the same writer the renderer uses
	onChord func(Chord)
	onReady func(int)

	started bool
	live    bool // the terminal has answered, so it is speaking the protocol
	scratch []byte
	pending []byte // an escape sequence split across two reads
	ready   []byte // decoded bytes waiting to be handed over
}

// New wraps a tty. onChord is called for a chord with no legacy bytes; onReady is called with
// the terminal's flags if it answers the query at all, which is how we learn it is there.
func New(tty *os.File, out io.Writer, onChord func(Chord), onReady func(int)) *Reader {
	return &Reader{File: tty, out: out, onChord: onChord, onReady: onReady,
		scratch: make([]byte, 4096)}
}

// Disable puts the terminal back the way it was found.
func (r *Reader) Disable() { io.WriteString(r.out, "\x1b[=0u") }

func (r *Reader) Read(p []byte) (int, error) {
	// The first read is the first moment the terminal is in raw mode and nobody else is
	// writing, which is when to ask it what it can do.
	if !r.started {
		r.started = true
		io.WriteString(r.out, "\x1b[?u\x1b[=1u")
	}
	for len(r.ready) == 0 {
		n, err := r.File.Read(r.scratch)
		if n > 0 {
			r.feed(r.scratch[:n])
		}
		if err != nil {
			return 0, err
		}
		// Nothing came out — a chord we swallowed, or half a sequence. Wait for more.
	}
	n := copy(p, r.ready)
	if n == len(r.ready) {
		// Drained: keep the buffer rather than walking off the end of it read after read.
		r.ready = r.ready[:0]
	} else {
		r.ready = r.ready[n:]
	}
	return n, nil
}

// feed decodes a run of input: CSI u sequences are handled, everything else — text, mouse
// reports, bracketed paste, the arrows — passes through byte for byte.
func (r *Reader) feed(b []byte) {
	// Nothing is usually half-arrived, and a drag is one of these per cell crossed: only pay
	// for the join when there is something to join.
	buf := b
	if len(r.pending) > 0 {
		buf = append(r.pending, b...)
		r.pending = nil
	}
	for i := 0; i < len(buf); {
		if buf[i] != 0x1b {
			r.ready = append(r.ready, buf[i])
			i++
			continue
		}
		end, final, ok := csiEnd(buf, i)
		if !ok {
			// Either not a CSI at all, or one that has not finished arriving. An escape by
			// itself is a key; hold anything that could still grow.
			if r.couldGrow(buf, i) {
				r.pending = append(r.pending, buf[i:]...)
				return
			}
			r.ready = append(r.ready, buf[i])
			i++
			continue
		}
		if final != 'u' {
			r.ready = append(r.ready, buf[i:end+1]...)
			i = end + 1
			continue
		}
		r.decode(string(buf[i+2 : end]))
		i = end + 1
	}
}

// csiEnd finds the end of a CSI sequence beginning at i: ESC [ params final, where final is
// any byte from @ to ~. Reports the index of the final byte.
func csiEnd(b []byte, i int) (end int, final byte, ok bool) {
	if i+1 >= len(b) || b[i+1] != '[' {
		return 0, 0, false
	}
	for j := i + 2; j < len(b); j++ {
		c := b[j]
		if c >= 0x30 && c <= 0x3f { // parameter bytes: digits ; : < = > ?
			continue
		}
		if c >= 0x20 && c <= 0x2f { // intermediate bytes
			continue
		}
		if c >= 0x40 && c <= 0x7e { // final byte
			return j, c, true
		}
		return 0, 0, false // something that cannot be part of a CSI
	}
	return 0, 0, false
}

// couldGrow: the bytes from i are the start of a sequence that is still arriving.
func (r *Reader) couldGrow(b []byte, i int) bool {
	if i+1 >= len(b) {
		// A lone escape at the end of a read. While the protocol is on it cannot be the
		// Escape key — that arrives as CSI 27 u — so it is half of something and worth
		// waiting a read for. While it is off, Escape is exactly this byte, and holding it
		// would delay every press of it until the next key.
		return r.live
	}
	if b[i+1] != '[' {
		return false
	}
	for j := i + 2; j < len(b); j++ {
		if c := b[j]; c >= 0x40 && c <= 0x7e {
			return false // it has its final byte already
		}
	}
	return true
}

// decode turns one CSI u sequence into the bytes it used to be, or into a chord.
func (r *Reader) decode(params string) {
	r.live = true
	if strings.HasPrefix(params, "?") {
		// The answer to the query: the terminal is there and says what it has on.
		if r.onReady != nil {
			flags, _ := strconv.Atoi(strings.TrimPrefix(params, "?"))
			r.onReady(flags)
		}
		return
	}
	fields := strings.Split(params, ";")
	if len(fields) == 0 || fields[0] == "" {
		return
	}
	code, err := strconv.Atoi(field(fields[0]))
	if err != nil {
		return
	}
	mods := 0
	if len(fields) > 1 {
		if m, err := strconv.Atoi(field(fields[1])); err == nil && m > 0 {
			mods = m - 1
		}
	}
	if c := (Chord{Code: code, Mods: mods}); c.Super() {
		// The reason this package exists: bytes never existed for this one.
		if r.onChord != nil {
			r.onChord(c)
		}
		return
	}
	r.ready = append(r.ready, legacy(code, mods)...)
}

// field drops a kitty sub-parameter: "99:100" is the key and the one under it, "5:1" is the
// modifiers and the event type. Only the first half has ever mattered here.
func field(s string) string {
	if i := strings.IndexByte(s, ':'); i >= 0 {
		return s[:i]
	}
	return s
}

// legacy is what the terminal would have sent for this key before the protocol was on.
func legacy(code, mods int) []byte {
	switch code {
	case 27:
		return []byte{0x1b}
	case 13:
		return []byte{0x0d}
	case 9:
		if mods&ModShift != 0 {
			return []byte("\x1b[Z") // back-tab
		}
		return []byte{0x09}
	case 127, 8:
		if mods&(ModCtrl|ModAlt) != 0 {
			// Ctrl+Backspace is "delete the word behind the caret" on every system that has
			// the key. It has no encoding of its own, so it is normalised to the byte that
			// has always meant exactly that, which is the one every terminal can send.
			return []byte{0x17} // ctrl+w
		}
		return []byte{0x7f}
	}
	if code <= 0 || code > 0x10ffff {
		return nil
	}
	r := rune(code)
	switch {
	case mods&ModCtrl != 0 && code >= '@' && code <= '~':
		// The control byte a terminal has always sent: ctrl+c is 0x03.
		b := byte(code) & 0x1f
		if mods&ModAlt != 0 {
			return []byte{0x1b, b}
		}
		return []byte{b}
	case mods&ModAlt != 0:
		return append([]byte{0x1b}, []byte(string(r))...)
	}
	return []byte(string(r))
}
