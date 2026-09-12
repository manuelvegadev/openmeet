package tui

import "fmt"

// SettingsRow is one line of the settings menu.
//
// A row whose values are a fixed set carries all of them in Choices and draws the lot, the
// current one lit, so what a setting *could* be is on screen without opening anything and
// Enter simply moves along it. A row whose value is not a list — a device, a name — carries
// Value and opens a picker over the screen instead.
type SettingsRow struct {
	Label, Value string
	Choices      []string
	Choice       int
	// Drawn muted after the choices: "kbps", "kbps per peer at 1080p".
	Suffix string
	// One line about what the row does, shown under the list while this row is selected.
	Help       string
	Tab        string
	ValueColor string // the name row draws its value in the name's colour
	Disabled   bool
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
	// A picker, drawn as a panel over the screen rather than instead of it: its title and
	// items, or empty when the menu has the screen to itself.
	PickerTitle string
	Picker      []string
	PickerIdx   int
}

var settingsHints = []KeyHint{
	{Key: "↑↓", Label: "navigate"}, {Key: "←→", Label: "section"}, {Key: "enter", Label: "change"},
}

// Leaving is drawn beside the title, where the room draws it too, rather than in the row of
// things you do *to* the settings.
var settingsBack = []KeyHint{{Key: "esc", Label: "back"}}
var pickHints = []KeyHint{{Key: "↑↓", Label: "navigate"}, {Key: "enter", Label: "select"}, {Key: "esc", Label: "cancel"}}

const (
	settingsLabelWidth = 18
	meterLabelWidth    = 9
	meterBarWidth      = 24
	// What the dot beside the title means. Everything on this screen is read when a room is
	// joined, and the screen is only reachable from the home screen, so one mark for the
	// screen says it once instead of every row saying it again.
	joinNote = "applies when you next join a room"
	// The most rows the line under the tabs may take at a narrow width.
	maxHelpRows = 4
)

func DrawSettings(c *Canvas, s SettingsState) {
	area := Screen(c, "Settings", settingsHints)
	right := area.X + area.W
	x := area.X + Width("Settings") + 1
	x = c.Put(x, area.Y-2, "●", Style{FG: ThemeWarn}, right) + 2
	DrawHints(c, x, area.Y-2, right-x, settingsBack)
	if s.Loading {
		c.Put(area.X, area.Y, "Loading devices...", Style{FG: ThemeWarn}, right)
		return
	}
	DrawTabs(c, area.X, area.Y, right, s.Tabs, s.Tab)
	tab := ""
	if s.Tab >= 0 && s.Tab < len(s.Tabs) {
		tab = s.Tabs[s.Tab]
	}

	// From the bottom up: the rule the key hints sit under, the bars and their rule, and the
	// line that says what the dot beside the title meant.
	bottom := area.Y + area.H - 1
	Rule(c, bottom, '├', '┤', nil)
	y := bottom
	if len(s.Meters) > 0 {
		y -= len(s.Meters)
		DrawMeters(c, Rect{area.X, y, area.W, len(s.Meters)}, s.Meters)
		y--
		Rule(c, y, '├', '┤', nil)
	}
	legendY := y - 1
	noteX := right - Width(joinNote) - 2
	c.Put(noteX, legendY, "●", Style{FG: ThemeWarn}, right)
	c.Put(noteX+2, legendY, joinNote, Muted, right)

	// The selected row's line sits under the tabs, where it is read before the list rather
	// than after it, and wraps rather than running off a narrow window. The block is as tall
	// as the tallest line in this tab, so moving the selection never shifts the list under it.
	helpTop := area.Y + 2
	helpRows := 1
	for _, i := range RowsForTab(s.Rows, tab) {
		helpRows = max(helpRows, min(maxHelpRows, len(Wrap([]Span{{s.Rows[i].Help, Muted}}, area.W-2))))
	}
	if s.Selected >= 0 && s.Selected < len(s.Rows) && s.Rows[s.Selected].Help != "" {
		row := s.Rows[s.Selected]
		for i, line := range Wrap([]Span{{row.Help, Muted}}, area.W-2) {
			if i >= helpRows {
				break
			}
			c.PutSpans(area.X+2, helpTop+i, line, right)
		}
	}
	body := Rect{area.X, helpTop + helpRows + 1, area.W, legendY - 1 - (helpTop + helpRows + 1)}
	rowY := body.Y
	for _, i := range RowsForTab(s.Rows, tab) {
		row := s.Rows[i]
		if rowY >= body.Y+body.H {
			break
		}
		selected := i == s.Selected
		Pointer(c, body.X, rowY, selected)
		label := fmt.Sprintf("%-*s", settingsLabelWidth, row.Label)
		vx := c.Put(body.X+2, rowY, label, Style{Bold: selected}, right) + 1
		if len(row.Choices) > 0 {
			drawChoices(c, vx, rowY, right, row)
		} else {
			vs := Muted
			if row.ValueColor != "" {
				vs = Style{FG: row.ValueColor}
			} else if selected && !row.Disabled {
				vs = Plain
			}
			c.Put(vx, rowY, row.Value, vs, right)
		}
		rowY++
	}
	if s.PickerTitle != "" {
		DrawModal(c, s.PickerTitle, s.Picker, s.PickerIdx, pickHints)
	}
}

// drawChoices draws every value the row can take as a chip, the current one on the accent
// and the rest on the surface — the key chips' two tones, minus their second half. A setting
// reads as what it is and what else it could be, without opening anything.
func drawChoices(c *Canvas, x, y, max int, row SettingsRow) {
	for i, choice := range row.Choices {
		st := chipOff
		if i == row.Choice {
			st = chipKey
		}
		x = c.Put(x, y, " "+choice+" ", st, max) + 1
	}
	if row.Suffix != "" {
		c.Put(x, y, row.Suffix, Muted, max)
	}
}

// DrawTabs draws the sections as tabs: the names on one row and the rule under them on the
// next, with the current tab's own span of that rule picked out in the accent — the shape a
// tab bar has everywhere, and it costs the screen one row it was leaving blank anyway.
func DrawTabs(c *Canvas, x, y, max int, tabs []string, active int) {
	from, to := 0, 0
	for i, name := range tabs {
		st := Style{FG: ThemeMuted}
		if i == active {
			st = Style{FG: ThemeAccent, Bold: true}
		}
		left := x + 2
		x = c.Put(left, y, name, st, max) + 2
		if i == active {
			from, to = left-1, x-1
		}
	}
	Rule(c, y+1, '├', '┤', nil)
	for i := from; i < to; i++ {
		c.Set(i, y+1, '━', Style{FG: ThemeAccent})
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
	DrawBar(c, x, y, meterBarWidth, frac, meterColor(frac, m.Good))
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
