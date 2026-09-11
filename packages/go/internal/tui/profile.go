package tui

import "fmt"

// ProfileState is the two-step first start: a name, then a colour picked on that name.
type ProfileState struct {
	Step     string // "name" | "color"
	Name     string // as typed
	Finished string // clamped and trimmed
	Color    string // the current colour, for the preview and the picker's start
	ColorIdx int
	Cursor   bool
	// Escape leaves, when there is somewhere to leave to.
	CanCancel bool
}

func DrawProfile(c *Canvas, s ProfileState) {
	if s.Step == "color" {
		area := Screen(c, "Your colour", []KeyHint{{Key: "↑↓", Label: "colour"}, {Key: "enter", Label: "pick"}, {Key: "esc", Label: "back to name"}})
		c.Put(area.X, area.Y, fmt.Sprintf("How %s shows up for everyone. ↑↓ to look, enter to pick.", s.Finished), Muted, area.X+area.W)
		for i, pc := range NamePalette {
			y := area.Y + 2 + i
			Pointer(c, area.X, y, i == s.ColorIdx)
			x := c.PutSpans(area.X+2, y, []Span{NameSpan(s.Finished, pc.Hex, i == s.ColorIdx)}, area.X+area.W)
			c.Put(x+1, y, pc.Name, Muted, area.X+area.W)
		}
		return
	}
	hints := []KeyHint{{Key: "enter", Label: "next: colour"}}
	if s.CanCancel {
		hints = append(hints, KeyHint{Key: "esc", Label: "cancel"})
	}
	area := Screen(c, "Your name", hints)
	c.Put(area.X, area.Y, fmt.Sprintf("What others will read and say. Up to %d characters; you can change it later in settings.", NameMaxCells), Muted, area.X+area.W)
	c.PutSpans(area.X, area.Y+2, append([]Span{{"Name: ", Style{Bold: true}}}, textInputSpans(s.Name, "Mario", true, s.Cursor)...), area.X+area.W)
	if s.Finished != "" {
		c.PutSpans(area.X, area.Y+4, []Span{{"You will show up as ", Muted}, NameSpan(s.Finished, s.Color, false)}, area.X+area.W)
	} else {
		c.Put(area.X, area.Y+4, "Type a name to continue", Muted, area.X+area.W)
	}
}
