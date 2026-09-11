package tui

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
		cx = c.PutSpans(cx+gap, y, spans, x+width)
	}
	return rows
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
