// Package tui is the interface, drawn the way Ink drew it: the whole screen as cells, the
// background painted everywhere, every colour a 24-bit value of ours. Screens draw into a
// Canvas; Bubble Tea gets the canvas as text and writes only the lines that changed.
package tui

import (
	"strings"

	"github.com/mattn/go-runewidth"
)

// Style is what a cell is drawn with. Empty FG/BG mean the theme's text and background.
type Style struct {
	FG, BG  string
	Bold    bool
	Inverse bool
}

// Text and Muted are the two foregrounds most cells use.
var (
	Plain = Style{}
	Muted = Style{FG: ThemeMuted}
)

func (s Style) WithFG(fg string) Style { s.FG = fg; return s }
func (s Style) WithBG(bg string) Style { s.BG = bg; return s }
func (s Style) WithBold() Style        { s.Bold = true; return s }

type cell struct {
	r    rune
	wide bool // the second half of a two-cell character
	st   Style
}

type Canvas struct {
	W, H  int
	cells [][]cell
	// What the mouse can land on, in the order it was drawn: see the hit map in hitmap.go.
	// barrier is where a modal drew over everything before it.
	hots         []hotspot
	barrier      int
	texts        map[string][]TextRow
	textsBlocked bool
}

func NewCanvas(w, h int) *Canvas {
	// The hit map is rebuilt every frame; sized once here it never has to grow.
	c := &Canvas{W: w, H: h, cells: make([][]cell, h), hots: make([]hotspot, 0, 64)}
	for y := range c.cells {
		c.cells[y] = make([]cell, w)
		for x := range c.cells[y] {
			c.cells[y][x] = cell{r: ' '}
		}
	}
	return c
}

// Rect is a drawing area: x, y of the top-left, and the size.
type Rect struct{ X, Y, W, H int }

func (r Rect) Inset(dx, dy int) Rect { return Rect{r.X + dx, r.Y + dy, r.W - 2*dx, r.H - 2*dy} }

func (r Rect) Contains(x, y int) bool {
	return x >= r.X && x < r.X+r.W && y >= r.Y && y < r.Y+r.H
}

// Fill paints a rectangle with a style, keeping spaces.
func (c *Canvas) Fill(r Rect, st Style) {
	for y := r.Y; y < r.Y+r.H && y < c.H; y++ {
		if y < 0 {
			continue
		}
		for x := r.X; x < r.X+r.W && x < c.W; x++ {
			if x >= 0 {
				c.cells[y][x] = cell{r: ' ', st: st}
			}
		}
	}
}

// Set puts one character at a cell, wide characters taking two. A control character never
// reaches the grid: it would be written into the frame as itself, and a newline in the middle
// of a row shifts every row after it.
func (c *Canvas) Set(x, y int, r rune, st Style) int {
	if isControl(r) {
		r = ' '
	}
	w := runewidth.RuneWidth(r)
	if w == 0 {
		w = 1
	}
	if y < 0 || y >= c.H || x < 0 || x+w > c.W {
		return w
	}
	c.cells[y][x] = cell{r: r, st: st}
	if w == 2 {
		c.cells[y][x+1] = cell{r: 0, wide: true, st: st}
	}
	return w
}

// Put writes a string from (x, y), clipped at maxX (exclusive; the canvas width when 0).
// Returns the x after the last cell written.
func (c *Canvas) Put(x, y int, s string, st Style, maxX int) int {
	if maxX <= 0 || maxX > c.W {
		maxX = c.W
	}
	s = Clean(s)
	for _, r := range s {
		w := runewidth.RuneWidth(r)
		if w == 0 {
			w = 1
		}
		if x+w > maxX {
			break
		}
		c.Set(x, y, r, st)
		x += w
	}
	return x
}

// Span is a run of text in one style; a line is a slice of them.
type Span struct {
	Text string
	St   Style
}

func (c *Canvas) PutSpans(x, y int, spans []Span, maxX int) int {
	for _, sp := range spans {
		x = c.Put(x, y, sp.Text, sp.St, maxX)
	}
	return x
}

// Width of a string in cells, measured on what would actually be drawn — so what the layout
// counts and what the canvas paints cannot disagree about a string nobody here wrote.
func Width(s string) int { return runewidth.StringWidth(Clean(s)) }

// Clean makes a run of text safe to draw and to measure. Text arrives here from places with
// no reason to be printable — the clipboard, a message from another client — and a newline
// written into a cell is written into the frame, which moves every row after it. Newlines and
// tabs become a space, because they were separating something; the rest go.
func Clean(s string) string {
	if !hasControl(s) {
		return s
	}
	var b strings.Builder
	b.Grow(len(s))
	for _, r := range s {
		switch {
		case r == '\n' || r == '\t':
			b.WriteRune(' ')
		case isControl(r):
		default:
			b.WriteRune(r)
		}
	}
	return b.String()
}

// isControl covers C0, DEL and C1 — everything a terminal would read as an instruction
// rather than as a character.
func isControl(r rune) bool { return r < 0x20 || r == 0x7f || (r >= 0x80 && r <= 0x9f) }

// hasControl answers the same question over a whole string without decoding it. Clean sits
// in front of every Width and every Put, so this runs a few hundred times a frame: C0 and DEL
// are single bytes, and a C1 can only appear in valid UTF-8 behind the lead byte 0xC2, which
// also leads U+00A0..U+00BF — those merely fall through to the rune loop, which is correct.
func hasControl(s string) bool {
	for i := 0; i < len(s); i++ {
		if c := s[i]; c < 0x20 || c == 0x7f || c == 0xc2 {
			return true
		}
	}
	return false
}

func spansWidth(spans []Span) int {
	w := 0
	for _, sp := range spans {
		w += Width(sp.Text)
	}
	return w
}

// Wrap breaks spans into lines of at most width cells the way Ink does — at spaces, keeping a
// space at the end of the line it closes, and through the middle of a word longer than the
// width. Styles survive the breaks.
func Wrap(spans []Span, width int) [][]Span {
	lines, _ := WrapOffsets(spans, width)
	return lines
}

// WrapOffsets is Wrap, and also where each line it produced began: the rune offset into the
// spans' own text, counted as if they were one string. That is the only bridge a selection
// needs between the rows on screen and the line they are all part of — click a row, land in
// the text, and a message wrapped over four rows copies as the one line it is.
func WrapOffsets(spans []Span, width int) ([][]Span, []int) {
	if width <= 0 {
		return [][]Span{spans}, []int{0}
	}
	// Flatten into styled words, where a word is a run of non-spaces or a run of spaces.
	type piece struct {
		text  string
		st    Style
		space bool
		off   int
	}
	var pieces []piece
	at := 0
	for _, sp := range spans {
		cur := strings.Builder{}
		curSpace := false
		curOff := at
		flush := func() {
			if cur.Len() > 0 {
				pieces = append(pieces, piece{cur.String(), sp.St, curSpace, curOff})
				curOff = at
				cur.Reset()
			}
		}
		for _, r := range sp.Text {
			isSpace := r == ' '
			if cur.Len() > 0 && isSpace != curSpace {
				flush()
			}
			curSpace = isSpace
			cur.WriteRune(r)
			at++
		}
		flush()
	}
	var lines [][]Span
	var offs []int
	var line []Span
	lineW := 0
	lineOff := 0
	started := false
	push := func(text string, st Style, off int) {
		if !started {
			lineOff, started = off, true
		}
		if len(line) > 0 && line[len(line)-1].St == st {
			line[len(line)-1].Text += text
		} else {
			line = append(line, Span{text, st})
		}
		lineW += Width(text)
	}
	newline := func() {
		lines = append(lines, line)
		offs = append(offs, lineOff)
		line = nil
		lineW = 0
		lineOff = 0
		started = false
	}
	for _, p := range pieces {
		w := Width(p.text)
		if p.space {
			// Spaces stay on the line they follow; ones that overflow just vanish at the edge.
			if lineW+w <= width {
				push(p.text, p.st, p.off)
			} else if lineW < width {
				push(p.text[:width-lineW], p.st, p.off)
			}
			continue
		}
		if lineW+w <= width {
			push(p.text, p.st, p.off)
			continue
		}
		if w <= width {
			// Whole word to the next line. A trailing space on this line is harmless.
			if lineW > 0 {
				newline()
			}
			push(p.text, p.st, p.off)
			continue
		}
		// Longer than a line: break through it.
		i := 0
		for _, r := range p.text {
			rw := runewidth.RuneWidth(r)
			if lineW+rw > width {
				newline()
			}
			push(string(r), p.st, p.off+i)
			i++
		}
	}
	if len(line) > 0 || len(lines) == 0 {
		lines = append(lines, line)
		offs = append(offs, lineOff)
	}
	return lines, offs
}

// PlainText is what a line of spans reads as, with nothing of how it was drawn: the string a
// selection counts its offsets in and a copy puts on the clipboard.
func PlainText(spans []Span) string {
	var b strings.Builder
	for _, sp := range spans {
		b.WriteString(sp.Text)
	}
	return b.String()
}

// Render serialises the canvas: one line per row, SGR runs, a reset at the end of each.
func (c *Canvas) Render() string {
	var b strings.Builder
	b.Grow(c.W * c.H * 4)
	for y := 0; y < c.H; y++ {
		var cur Style
		open := false
		for x := 0; x < c.W; x++ {
			cl := c.cells[y][x]
			if cl.wide {
				continue
			}
			if !open || cl.st != cur {
				if open {
					b.WriteString("\x1b[0m")
				}
				writeSGR(&b, cl.st)
				cur, open = cl.st, true
			}
			if cl.r == 0 {
				b.WriteRune(' ')
			} else {
				b.WriteRune(cl.r)
			}
		}
		b.WriteString("\x1b[0m")
		if y < c.H-1 {
			b.WriteByte('\n')
		}
	}
	return b.String()
}

func writeSGR(b *strings.Builder, st Style) {
	fg := st.FG
	if fg == "" {
		fg = ThemeText
	}
	bg := st.BG
	if bg == "" {
		bg = ThemeBG
	}
	b.WriteString("\x1b[")
	if st.Bold {
		b.WriteString("1;")
	}
	if st.Inverse {
		b.WriteString("7;")
	}
	// A transparent background is 39/49 — the terminal's own colours — and not an RGB
	// triple, because there is no triple that means "whatever is behind this window".
	if fg == ThemeDefault {
		b.WriteString("39;")
	} else {
		b.WriteString("38;2;")
		b.WriteString(rgb(fg))
		b.WriteByte(';')
	}
	if bg == ThemeDefault {
		b.WriteString("49")
	} else {
		b.WriteString("48;2;")
		b.WriteString(rgb(bg))
	}
	b.WriteByte('m')
}

func rgb(hex string) string {
	if len(hex) != 7 {
		return "0;0;0"
	}
	h := func(s string) int {
		v := 0
		for _, r := range s {
			v *= 16
			switch {
			case r >= '0' && r <= '9':
				v += int(r - '0')
			case r >= 'a' && r <= 'f':
				v += int(r-'a') + 10
			case r >= 'A' && r <= 'F':
				v += int(r-'A') + 10
			}
		}
		return v
	}
	return itoa(h(hex[1:3])) + ";" + itoa(h(hex[3:5])) + ";" + itoa(h(hex[5:7]))
}

func itoa(n int) string {
	if n == 0 {
		return "0"
	}
	var d [4]byte
	i := len(d)
	for n > 0 {
		i--
		d[i] = byte('0' + n%10)
		n /= 10
	}
	return string(d[i:])
}

// Text returns the canvas as plain text, for tests against the Node frames.
func (c *Canvas) Text() string {
	var b strings.Builder
	for y := 0; y < c.H; y++ {
		line := strings.Builder{}
		for x := 0; x < c.W; x++ {
			cl := c.cells[y][x]
			if cl.wide {
				continue
			}
			if cl.r == 0 {
				line.WriteRune(' ')
			} else {
				line.WriteRune(cl.r)
			}
		}
		b.WriteString(strings.TrimRight(line.String(), " "))
		if y < c.H-1 {
			b.WriteByte('\n')
		}
	}
	return b.String()
}

// StyleAt is the style of a cell, for the colour checks in tests.
func (c *Canvas) StyleAt(x, y int) Style { return c.cells[y][x].st }
