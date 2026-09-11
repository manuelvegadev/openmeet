package tui

// DevicesState is the audio setup: input, then output, then the test with the meter.
type DevicesState struct {
	Title  string // "Audio Setup" on the way in, "Change Audio Device" from the room
	Step   string // "loading" | "none" | "input" | "output" | "test"
	Items  []string
	Idx    int
	Input  string // chosen names, "System Default" when none
	Output string
	Level  float64 // mic RMS for the test meter
	Hint   string  // the Broadcast line, when there is one
}

// The mic-test meter: 30 cells in eighth-blocks, green to 40%, amber to 75%, red above.
const micBarWidth = 30
const vuMaxRMS = 8000.0

var eighths = []rune{' ', '▏', '▎', '▍', '▌', '▋', '▊', '▉', '█'}

func levelColor(level float64) string {
	n := level / vuMaxRMS
	switch {
	case n > 0.75:
		return ThemeDanger
	case n > 0.4:
		return ThemeWarn
	}
	return ThemeOK
}

func DrawMicBar(c *Canvas, x, y int, level float64) {
	frac := level / vuMaxRMS
	if frac > 1 {
		frac = 1
	}
	if frac < 0 {
		frac = 0
	}
	units := int(frac*float64(micBarWidth*8) + 0.5)
	full, part := units/8, units%8
	st := Style{FG: levelColor(level), BG: ThemeSurface}
	for i := 0; i < micBarWidth; i++ {
		r := ' '
		if i < full {
			r = '█'
		} else if i == full && part > 0 {
			r = eighths[part]
		}
		c.Set(x+i, y, r, st)
	}
}

func DrawDevices(c *Canvas, s DevicesState) {
	switch s.Step {
	case "loading":
		inner := Frame(c, true)
		Centered(c, inner, [][]Span{{{"Audio Setup", Style{FG: ThemeAccent, Bold: true}}}, {{"Loading audio devices...", Plain}}})
		return
	case "none":
		inner := Frame(c, true)
		Centered(c, inner, [][]Span{
			{{"Audio Setup", Style{FG: ThemeAccent, Bold: true}}},
			nil,
			{{"No specific audio devices found.", Plain}},
			{{"Using system default devices.", Plain}},
			nil,
			{{"Press ", Muted}, KeyChip("enter"), {" to continue", Muted}},
		})
		return
	case "test":
		area := Screen(c, "Audio Test", []KeyHint{{Key: "t", Label: "test tone"}, {Key: "enter", Label: "confirm"}, {Key: "esc", Label: "re-select"}})
		c.PutSpans(area.X, area.Y, []Span{{"Input: ", Plain}, {s.Input, Style{Bold: true}}}, area.X+area.W)
		c.PutSpans(area.X, area.Y+1, []Span{{"Output: ", Plain}, {s.Output, Style{Bold: true}}}, area.X+area.W)
		c.Put(area.X, area.Y+2, "Mic level:", Style{Bold: true}, area.X+area.W)
		DrawMicBar(c, area.X, area.Y+3, s.Level)
		return
	}
	hints := []KeyHint{{Key: "↑↓", Label: "navigate"}, {Key: "enter", Label: "select"}}
	if s.Title != "Audio Setup" {
		hints = append(hints, KeyHint{Key: "esc", Label: "cancel"})
	}
	area := Screen(c, s.Title, hints)
	y := area.Y
	if s.Step == "output" {
		c.PutSpans(area.X, y, []Span{{"Input: ", Plain}, {s.Input, Style{Bold: true}}}, area.X+area.W)
		y++
		c.Put(area.X, y, "Output (Speakers):", Style{Bold: true}, area.X+area.W)
	} else {
		c.Put(area.X, y, "Input (Microphone):", Style{Bold: true}, area.X+area.W)
	}
	y++
	n := DrawSelect(c, Rect{area.X, y, area.W, area.Y + area.H - y}, s.Items, s.Idx)
	if s.Hint != "" {
		for i, line := range Wrap([]Span{{s.Hint, Style{FG: ThemeInfo}}}, area.W) {
			c.PutSpans(area.X, y+n+i, line, area.X+area.W)
		}
	}
}
