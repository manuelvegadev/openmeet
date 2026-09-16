package tui

// The chrome every screen shares, drawn the way the Node client's Ink tree drew it: a frame
// in the accent the size of the terminal, section rules that join it with tees, and a title
// row, a rule, padded content and a hint row for every screen but the room.

var frameStyle = Style{FG: ThemeAccent}
var ruleStyle = Style{FG: ThemeAccent}

// BorderSet is every glyph a frame is drawn from, so that a box, a rule and the junction
// where they meet cannot be chosen separately and end up in different weights. The two sets
// are complete in both directions: whatever the borders are, a vertical divider meeting a
// horizontal rule has a glyph of its own and never falls back to a cross of the wrong weight.
type BorderSet struct {
	TL, TR, BL, BR rune // the corners
	H, V           rune // the runs
	TeeL, TeeR     rune // a rule meeting the frame's left and right edge
	TeeD, TeeU     rune // a divider leaving a rule downward, and arriving at one from above
}

var (
	// Single, with the rounded corners this interface has always had.
	borderSingle = BorderSet{'╭', '╮', '╰', '╯', '─', '│', '├', '┤', '┬', '┴'}
	// Double. Unicode has no rounded double corner, so a double frame is square whatever
	// the corner setting says — which is why the Corners row goes dim next to it rather
	// than offering something that cannot be drawn.
	borderDouble = BorderSet{'╔', '╗', '╚', '╝', '═', '║', '╠', '╣', '╦', '╩'}
)

// Weights and Corners are the two halves of the frame's shape, each its own settings row.
var (
	Weights = []string{"single", "double"}
	Corners = []string{"rounded", "square"}
)

// RoundableWeight answers whether a corner choice means anything at this weight. Only single
// can be rounded.
func RoundableWeight(weight string) bool { return weight != "double" }

// B is the border set in force. Drawing reads it; only setBorders writes it.
var B = borderSingle

func setBorders(weight, corners string) {
	if weight == "double" {
		B = borderDouble
		return
	}
	B = borderSingle
	if corners == "square" {
		B.TL, B.TR, B.BL, B.BR = '┌', '┐', '└', '┘'
	}
}

// Box draws the box every panel in this interface is drawn in: the corners, and a rule
// between them. One definition, so the glyphs are chosen once — the room's frame, a modal,
// a message bubble and the composer are all this shape.
func Box(c *Canvas, r Rect, st Style) {
	right, bottom := r.X+r.W-1, r.Y+r.H-1
	c.Set(r.X, r.Y, B.TL, st)
	c.Set(right, r.Y, B.TR, st)
	c.Set(r.X, bottom, B.BL, st)
	c.Set(right, bottom, B.BR, st)
	for x := r.X + 1; x < right; x++ {
		c.Set(x, r.Y, B.H, st)
		c.Set(x, bottom, B.H, st)
	}
	for y := r.Y + 1; y < bottom; y++ {
		c.Set(r.X, y, B.V, st)
		c.Set(right, y, B.V, st)
	}
}

// Frame paints the background and the border. closeBottom=false leaves the last row to the
// caller, which is how the room draws its own bottom edge with the divider's junction in it.
func Frame(c *Canvas, closeBottom bool) Rect {
	c.Fill(Rect{0, 0, c.W, c.H}, Plain)
	if closeBottom {
		Box(c, Rect{0, 0, c.W, c.H}, frameStyle)
		return Rect{1, 1, c.W - 2, c.H - 2}
	}
	c.Set(0, 0, B.TL, frameStyle)
	c.Set(c.W-1, 0, B.TR, frameStyle)
	for x := 1; x < c.W-1; x++ {
		c.Set(x, 0, B.H, frameStyle)
	}
	// Open at the bottom: the screen's own last row is the edge.
	for y := 1; y < c.H; y++ {
		c.Set(0, y, B.V, frameStyle)
		c.Set(c.W-1, y, B.V, frameStyle)
	}
	return Rect{1, 1, c.W - 2, c.H - 2}
}

// Rule draws a section rule across row y, from the frame's left border to its right one.
// bottom makes it the frame's closing edge — corners at the ends instead of tees — and it is
// also what decides which way a divider's junction points: a rule in the middle of a screen
// has the divider leaving it downward, the bottom edge has it arriving from above. dividers
// are the inner columns a vertical divider crosses at.
func Rule(c *Canvas, y int, bottom bool, dividers ...int) {
	start, end, junction := B.TeeL, B.TeeR, B.TeeD
	if bottom {
		start, end, junction = B.BL, B.BR, B.TeeU
	}
	c.Set(0, y, start, ruleStyle)
	for x := 1; x < c.W-1; x++ {
		c.Set(x, y, B.H, ruleStyle)
	}
	for _, x := range dividers {
		c.Set(x, y, junction, ruleStyle)
	}
	c.Set(c.W-1, y, end, ruleStyle)
}

// RuleFrom draws a rule across one pane only: from a vertical divider at x to the frame's
// right edge, joining both. The people pane's section breaks are these.
func RuleFrom(c *Canvas, x, y int) {
	c.Set(x, y, B.TeeL, ruleStyle)
	for i := x + 1; i < c.W-1; i++ {
		c.Set(i, y, B.H, ruleStyle)
	}
	c.Set(c.W-1, y, B.TeeR, ruleStyle)
}

// Divider is a rule inside a panel, as wide as the area and no wider, in the surface grey.
func Divider(c *Canvas, x, y, width int) {
	for i := 0; i < width; i++ {
		c.Set(x+i, y, B.H, Style{FG: ThemeSurface})
	}
}

// Pointer draws the list marker cell: ▸ in the accent on the current row, blank otherwise.
func Pointer(c *Canvas, x, y int, on bool) {
	if on {
		c.Set(x, y, '▸', Style{FG: ThemeAccent})
	}
}

// Screen draws the chrome of every full-height screen but the room: the title on the first
// row, a rule, and the hints on the last row. Returns the padded content area.
func Screen(c *Canvas, title string, hints []KeyHint) Rect {
	inner := Frame(c, true)
	c.Put(inner.X+1, inner.Y, title, Style{FG: ThemeAccent, Bold: true}, 0)
	Rule(c, inner.Y+1, false)
	content := Rect{inner.X + 1, inner.Y + 2, inner.W - 2, inner.H - 2}
	if hints != nil {
		DrawHints(c, inner.X+1, inner.Y+inner.H-1, inner.W-2, hints)
		content.H--
	}
	return content
}

// Centered draws lines centred in an area, the block itself centred vertically — the home
// screen's and the audio setup's layout. Each line is spans; nil is a blank row.
func Centered(c *Canvas, area Rect, lines [][]Span) {
	y := area.Y + (area.H-len(lines))/2
	for _, line := range lines {
		if line != nil {
			// Ink centres a Text with the odd column on the right and a Box (a row of
			// buttons) with it on the left; the frames in testdata are the authority.
			w := spansWidth(line)
			x := area.X + (area.W-w)/2
			if isChipRow(line) {
				x = area.X + (area.W-w+1)/2
			}
			c.PutSpans(x, y, line, area.X+area.W)
			HotChips(c, x, y, line)
		}
		y++
	}
}

// isChipRow: every span carries a background, which only buttons do.
func isChipRow(line []Span) bool {
	for _, sp := range line {
		if sp.St.BG == "" && sp.Text != " " {
			return false
		}
	}
	return true
}
