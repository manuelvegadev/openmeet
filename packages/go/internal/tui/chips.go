package tui

import "strings"

// KeyHint is a footer button: the key on a gold keycap, what it does on a grey pill.
type KeyHint struct {
	Key, Label string
	Disabled   bool
}

var (
	chipKey   = Style{FG: ThemeOnAccent, BG: ThemeAccent, Bold: true}
	chipLabel = Style{FG: ThemeText, BG: ThemeSurface}
	chipOff   = Style{FG: ThemeMuted, BG: ThemeSurface}
)

// ChipSpans is one button as spans: ` m ` then ` mute `.
func ChipSpans(h KeyHint) []Span {
	k, l := chipKey, chipLabel
	if h.Disabled {
		k, l = chipOff, chipOff
		k.Bold = true
	}
	return []Span{{" " + h.Key + " ", k}, {" " + h.Label + " ", l}}
}

// KeyChip is one key inside a sentence.
func KeyChip(key string) Span { return Span{" " + key + " ", chipKey} }

// DrawHints draws a row of buttons from (x, y), one space between, wrapping whole buttons
// onto the next row when the width runs out. Returns the rows used.
//
// Every button it draws is also registered as clickable, which is the whole of the mouse
// support for the key hints: a click sends the key the chip already shows, so the behaviour
// is stated once, in the key handler, and a disabled chip registers nothing.
func DrawHints(c *Canvas, x, y, width int, hints []KeyHint) int {
	cx, rows := x, 1
	for i, h := range hints {
		spans := ChipSpans(h)
		w := spansWidth(spans)
		gap := 0
		if i > 0 {
			gap = 1
		}
		if cx-x+gap+w > width && cx > x {
			y++
			rows++
			cx = x
			gap = 0
		}
		from := cx + gap
		cx = c.PutSpans(from, y, spans, x+width)
		hotChip(c, Rect{from, y, cx - from, 1}, h)
	}
	return rows
}

// hintKeys is what a chip sends. Most send one key; the pairs a chip puts on one cap send
// one each, the left half the left key — clicking `↑↓` where the ↑ is means up.
func hintKeys(key string) []string {
	switch key {
	case "↑↓":
		return []string{"up", "down"}
	case "←→":
		return []string{"left", "right"}
	case "-/+":
		return []string{"-", "+"}
	}
	return []string{key}
}

// hotChip registers a drawn button, splitting it down the middle when its cap carries a pair.
func hotChip(c *Canvas, r Rect, h KeyHint) {
	if h.Disabled || r.W <= 0 {
		return
	}
	keys := hintKeys(h.Key)
	if len(keys) == 1 {
		c.Hot(r, Action{Kind: ActKey, Key: keys[0]})
		return
	}
	half := r.W / 2
	c.Hot(Rect{r.X, r.Y, half, 1}, Action{Kind: ActKey, Key: keys[0]})
	c.Hot(Rect{r.X + half, r.Y, r.W - half, 1}, Action{Kind: ActKey, Key: keys[1]})
}

// HotChips registers the buttons inside a line of spans that was drawn in one go — the home
// screen's rows, the room's header, the composer. A gold cap and the grey label after it are
// one button. It is called where chips are known to be rather than over every line, because
// a settings row draws its values on the same gold and those are not keys.
func HotChips(c *Canvas, x, y int, spans []Span) {
	for i := 0; i < len(spans); i++ {
		if spans[i].St != chipKey {
			x += Width(spans[i].Text)
			continue
		}
		key := strings.TrimSpace(spans[i].Text)
		w := Width(spans[i].Text)
		if i+1 < len(spans) && spans[i+1].St == chipLabel {
			w += Width(spans[i+1].Text)
			i++
		}
		hotChip(c, Rect{x, y, w, 1}, KeyHint{Key: key})
		x += w
	}
}

// HintsWidth is the width a row of buttons takes on one line.
func HintsWidth(hints []KeyHint) int {
	w := 0
	for i, h := range hints {
		if i > 0 {
			w++
		}
		w += spansWidth(ChipSpans(h))
	}
	return w
}
