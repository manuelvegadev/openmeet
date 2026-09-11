package tui

import "fmt"

// SettingsRow is one line of the settings menu: label, value, the tab it lives under, and
// whether Enter does anything.
type SettingsRow struct {
	Label, Value string
	Tab          string
	ValueColor   string // the name row draws its value in the name's colour
	Disabled     bool
}

// Meter is one bar under the settings: what the choices on this tab cost and what they buy,
// the way a game shows what a part does to a car before you fit it. Fill is 0..1; Good marks
// the bar where more is better, so the colour can mean the same thing on every row.
//
// The numbers behind them are estimates anchored on what we have measured (docs/performance.md):
// Apple's unit against raw devices, a hardware H.264 encoder against a software one, what the
// voice gate saves on a real call. They are there to make a choice's price visible before it
// is made, not to predict a machine.
type Meter struct {
	Label string
	Fill  float64
	Note  string
	Good  bool
}

type SettingsState struct {
	Rows []SettingsRow
	// Selected indexes Rows, not the visible subset: the store acts on the row's own index.
	Selected int
	Tabs     []string
	Tab      int
	Meters   []Meter
	Loading  bool
	// A picker over the menu: its title and items, or empty when the menu is showing.
	PickerTitle string
	Picker      []string
	PickerIdx   int
}

var settingsHints = []KeyHint{
	{Key: "↑↓", Label: "navigate"}, {Key: "←→", Label: "section"},
	{Key: "enter", Label: "change"}, {Key: "esc", Label: "back"},
}
var pickHints = []KeyHint{{Key: "↑↓", Label: "navigate"}, {Key: "enter", Label: "select"}, {Key: "esc", Label: "cancel"}}

const (
	settingsLabelWidth = 18
	meterLabelWidth    = 9
	meterBarWidth      = 24
)

func DrawSettings(c *Canvas, s SettingsState) {
	if s.PickerTitle != "" {
		area := Screen(c, "Settings > "+s.PickerTitle, pickHints)
		DrawSelect(c, area, s.Picker, s.PickerIdx)
		return
	}
	area := Screen(c, "Settings", settingsHints)
	if s.Loading {
		c.Put(area.X, area.Y, "Loading devices...", Style{FG: ThemeWarn}, area.X+area.W)
		return
	}
	DrawTabs(c, area.X, area.Y, area.X+area.W, s.Tabs, s.Tab)
	body := Rect{area.X, area.Y + 2, area.W, area.H - 2}
	if len(s.Meters) > 0 {
		top := area.Y + area.H - len(s.Meters) - 1
		Rule(c, top, '├', '┤', nil)
		DrawMeters(c, Rect{area.X, top + 1, area.W, len(s.Meters)}, s.Meters)
		body.H = top - body.Y
	}
	tab := ""
	if s.Tab >= 0 && s.Tab < len(s.Tabs) {
		tab = s.Tabs[s.Tab]
	}
	y := body.Y
	for i, row := range s.Rows {
		if row.Tab != tab || y >= body.Y+body.H {
			continue
		}
		selected := i == s.Selected
		Pointer(c, body.X, y, selected)
		label := fmt.Sprintf("%-*s", settingsLabelWidth, row.Label)
		x := c.Put(body.X+2, y, label, Style{Bold: selected}, body.X+body.W)
		vs := Muted
		if row.ValueColor != "" {
			vs = Style{FG: row.ValueColor}
		} else if selected && !row.Disabled {
			vs = Plain
		}
		c.Put(x+1, y, row.Value, vs, body.X+body.W)
		y++
	}
}

// DrawTabs draws the section bar: the current one on the accent keycap, the rest on the
// surface, the same two tones as the key chips so the screen has one vocabulary.
func DrawTabs(c *Canvas, x, y, max int, tabs []string, active int) {
	for i, name := range tabs {
		st := Style{FG: ThemeMuted, BG: ThemeSurface}
		if i == active {
			st = Style{FG: ThemeOnAccent, BG: ThemeAccent, Bold: true}
		}
		x = c.Put(x, y, " "+name+" ", st, max) + 1
	}
}

// DrawMeters draws the cost/quality bars, one per row: label, a bar in eighth-blocks over
// the surface, and the number behind it where there is one.
func DrawMeters(c *Canvas, area Rect, meters []Meter) {
	for i, m := range meters {
		y := area.Y + i
		if y >= area.Y+area.H {
			return
		}
		c.Put(area.X, y, fmt.Sprintf("%-*s", meterLabelWidth, m.Label), Muted, area.X+area.W)
		DrawMeterBar(c, area.X+meterLabelWidth, y, m)
		c.Put(area.X+meterLabelWidth+meterBarWidth+2, y, m.Note, Muted, area.X+area.W)
	}
}

func DrawMeterBar(c *Canvas, x, y int, m Meter) {
	frac := min(1, max(0, m.Fill))
	units := int(frac*float64(meterBarWidth*8) + 0.5)
	full, part := units/8, units%8
	st := Style{FG: meterColor(frac, m.Good), BG: ThemeSurface}
	for i := range meterBarWidth {
		r := ' '
		if i < full {
			r = '█'
		} else if i == full && part > 0 {
			r = eighths[part]
		}
		c.Set(x+i, y, r, st)
	}
}

// meterColor: on a cost bar a full bar is bad, on a quality bar an empty one is.
func meterColor(frac float64, good bool) string {
	if good {
		if frac < 0.35 {
			return ThemeWarn
		}
		return ThemeOK
	}
	switch {
	case frac > 0.7:
		return ThemeDanger
	case frac > 0.4:
		return ThemeWarn
	}
	return ThemeOK
}

// DrawSelect draws a list the way the pickers do: the marker cell, a space, the label, bold
// on the current row. Returns the rows used.
func DrawSelect(c *Canvas, area Rect, items []string, idx int) int {
	for i, label := range items {
		y := area.Y + i
		if y >= area.Y+area.H {
			return i
		}
		Pointer(c, area.X, y, i == idx)
		c.Put(area.X+2, y, label, Style{Bold: i == idx}, area.X+area.W)
	}
	return len(items)
}
