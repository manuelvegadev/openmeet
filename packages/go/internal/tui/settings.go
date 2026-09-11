package tui

import "fmt"

// SettingsRow is one line of the settings menu: label, value, and whether Enter does anything.
type SettingsRow struct {
	Label, Value string
	ValueColor   string // the name row draws its value in the name's colour
	Disabled     bool
}

type SettingsState struct {
	Rows     []SettingsRow
	Selected int
	Loading  bool
	// A picker over the menu: its title and items, or empty when the menu is showing.
	PickerTitle string
	Picker      []string
	PickerIdx   int
}

var settingsHints = []KeyHint{{Key: "↑↓", Label: "navigate"}, {Key: "enter", Label: "change"}, {Key: "esc", Label: "back"}}
var pickHints = []KeyHint{{Key: "↑↓", Label: "navigate"}, {Key: "enter", Label: "select"}, {Key: "esc", Label: "cancel"}}

const settingsLabelWidth = 18

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
	for i, row := range s.Rows {
		y := area.Y + i
		if y >= area.Y+area.H {
			break
		}
		selected := i == s.Selected
		Pointer(c, area.X, y, selected)
		label := fmt.Sprintf("%-*s", settingsLabelWidth, row.Label)
		x := c.Put(area.X+2, y, label, Style{Bold: selected}, area.X+area.W)
		vs := Muted
		if row.ValueColor != "" {
			vs = Style{FG: row.ValueColor}
		} else if selected && !row.Disabled {
			vs = Plain
		}
		c.Put(x+1, y, row.Value, vs, area.X+area.W)
	}
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
