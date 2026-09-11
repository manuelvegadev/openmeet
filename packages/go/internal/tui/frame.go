package tui

// The chrome every screen shares, drawn the way the Node client's Ink tree drew it: a rounded
// frame in the accent the size of the terminal, section rules that join it with ├ and ┤, and
// a title row, a rule, padded content and a hint row for every screen but the room.

var frameStyle = Style{FG: ThemeAccent}
var ruleStyle = Style{FG: ThemeAccent}

// Frame paints the background and the border. closeBottom=false leaves the last row to the
// caller, which is how the room draws its own bottom edge with the divider's junction in it.
func Frame(c *Canvas, closeBottom bool) Rect {
	c.Fill(Rect{0, 0, c.W, c.H}, Plain)
	c.Set(0, 0, '╭', frameStyle)
	c.Set(c.W-1, 0, '╮', frameStyle)
	for x := 1; x < c.W-1; x++ {
		c.Set(x, 0, '─', frameStyle)
	}
	last := c.H - 1
	if !closeBottom {
		last = c.H
	}
	for y := 1; y < last; y++ {
		c.Set(0, y, '│', frameStyle)
		c.Set(c.W-1, y, '│', frameStyle)
	}
	if closeBottom {
		c.Set(0, c.H-1, '╰', frameStyle)
		c.Set(c.W-1, c.H-1, '╯', frameStyle)
		for x := 1; x < c.W-1; x++ {
			c.Set(x, c.H-1, '─', frameStyle)
		}
	}
	return Rect{1, 1, c.W - 2, c.H - 2}
}

// Rule draws a section rule across row y from the frame's left border to its right one,
// with start and end on the border cells, and junctions at the given inner columns.
func Rule(c *Canvas, y int, start, end rune, junctions map[int]rune) {
	c.Set(0, y, start, ruleStyle)
	for x := 1; x < c.W-1; x++ {
		c.Set(x, y, '─', ruleStyle)
	}
	for x, r := range junctions {
		c.Set(x, y, r, ruleStyle)
	}
	c.Set(c.W-1, y, end, ruleStyle)
}

// Divider is a rule inside a panel, as wide as the area and no wider, in the surface grey.
func Divider(c *Canvas, x, y, width int) {
	for i := 0; i < width; i++ {
		c.Set(x+i, y, '─', Style{FG: ThemeSurface})
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
	Rule(c, inner.Y+1, '├', '┤', nil)
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
