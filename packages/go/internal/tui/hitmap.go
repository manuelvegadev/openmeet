package tui

// The hit map: what the mouse can land on, recorded by the screens as they draw.
//
// Nothing here is painted. A screen marks a region while it is already drawing it — a chip
// where DrawHints lays the chip out, a row where the list draws the row — and a click is
// then answered by the code the key press already goes through. So a button that is drawn
// disabled registers nothing and is unclickable for free, a chip added tomorrow is clickable
// the day it is added, and the frames in testdata do not move a cell.

// Action kinds.
const (
	ActKey    = "key"    // send the key this chip shows
	ActRow    = "row"    // move a list's selection to Idx, and confirm it when Go
	ActTab    = "tab"    // pick section Idx
	ActScroll = "scroll" // the pane the wheel belongs to
	ActText   = "text"   // selectable text
	ActFocus  = "focus"  // move the room's focus to ID
)

// Action is what the mouse does where it lands.
type Action struct {
	Kind string
	Key  string // ActKey: the key to send, spelt as a KeyHint spells it
	ID   string // ActRow, ActScroll, ActText, ActFocus: which list or pane
	Idx  int    // ActRow, ActTab
	Go   bool   // ActRow: a click also confirms the row, as a menu does
}

type hotspot struct {
	r Rect
	a Action
}

// Hot marks a rectangle as belonging to an action.
func (c *Canvas) Hot(r Rect, a Action) { c.hots = append(c.hots, hotspot{r, a}) }

// Modal puts everything registered so far out of the mouse's reach. It is the rule the keys
// already follow — a modal takes every key while it is up and the screen behind it stands
// down — and without it a click could work a button the keyboard cannot reach, or start
// selecting a conversation that is behind a panel.
func (c *Canvas) Modal() {
	c.barrier = len(c.hots)
	c.textsBlocked = true
}

// HitTest is the action of the given kind under a cell, searched newest first so a modal
// drawn over a screen takes the clicks that land on it.
func (c *Canvas) HitTest(x, y int, kind string) (Action, bool) {
	for i := len(c.hots) - 1; i >= c.barrier; i-- {
		h := c.hots[i]
		if h.a.Kind == kind && h.r.Contains(x, y) {
			return h.a, true
		}
	}
	return Action{}, false
}

// ── the text map ────────────────────────────────────────────────────────────

// TextPos is a place in the text behind the screen rather than on it: which item of a
// region's source, and how many runes into that item's own text. A selection is two of
// these, so a message wrapped over four rows is still one line, and the frame it was drawn
// in — borders, timestamps, the pane beside it — is not part of anything.
type TextPos struct {
	Src int
	Off int
}

func (p TextPos) before(q TextPos) bool {
	return p.Src < q.Src || (p.Src == q.Src && p.Off < q.Off)
}

// Order returns the two positions the way they read.
func Order(a, b TextPos) (TextPos, TextPos) {
	if b.before(a) {
		return b, a
	}
	return a, b
}

// TextRow is one screen row of a selectable region: what is on it, and where it came from.
// MaxX is where the row was clipped, which is not always where its text ends — a debug line
// runs past the pane — so the selection paints to the edge and no further while a copy still
// takes the whole line.
type TextRow struct {
	X, Y  int
	MaxX  int
	Spans []Span
	Src   int
	Off   int
}

// MarkText records a drawn row as part of a selectable region. Rows with Src < 0 — a
// placeholder, the "more below" line — are not text and are left out.
func (c *Canvas) MarkText(id string, row TextRow) {
	if row.Src < 0 {
		return
	}
	if c.texts == nil {
		c.texts = make(map[string][]TextRow, 3)
	}
	c.texts[id] = append(c.texts[id], row)
}

// TextAt is the row of a region on a screen line. A region is one column of rows, so the line
// is the whole of what identifies one.
func (c *Canvas) TextAt(id string, y int) (TextRow, bool) {
	for _, row := range c.TextRows(id) {
		if row.Y == y {
			return row, true
		}
	}
	return TextRow{}, false
}

// TextRows is a region's rows in screen order, or none at all while a modal stands in front
// of it.
func (c *Canvas) TextRows(id string) []TextRow {
	if c.textsBlocked {
		return nil
	}
	return c.texts[id]
}

// PosAt maps a cell to the place in the text under it. A click past the end of a row lands
// after its last rune, which is what makes dragging off the right edge select the line.
func (row TextRow) PosAt(x int) TextPos {
	off := row.Off
	cx := row.X
	for _, sp := range row.Spans {
		for _, r := range sp.Text {
			w := runeCells(r)
			if x < cx+w {
				return TextPos{row.Src, off}
			}
			cx += w
			off++
		}
	}
	return TextPos{row.Src, off}
}

// PaintSelection puts a background on every cell of a region that falls inside the range.
// It runs over the rows the frame already drew, so nothing on the drawing path knows a
// selection exists and a frame without one costs exactly what it did before.
func (c *Canvas) PaintSelection(id string, from, to TextPos, bg string) {
	if !from.before(to) {
		return
	}
	for _, row := range c.TextRows(id) {
		off := row.Off
		cx := row.X
		max := row.MaxX
		if max <= 0 || max > c.W {
			max = c.W
		}
	clipped:
		for _, sp := range row.Spans {
			for _, r := range sp.Text {
				w := runeCells(r)
				if cx+w > max {
					break clipped
				}
				p := TextPos{row.Src, off}
				if !p.before(from) && p.before(to) {
					for i := 0; i < w; i++ {
						if x := cx + i; x >= 0 && x < c.W && row.Y >= 0 && row.Y < c.H {
							c.cells[row.Y][x].st.BG = bg
						}
					}
				}
				cx += w
				off++
			}
		}
	}
}
