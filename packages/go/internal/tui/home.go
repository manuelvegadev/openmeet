package tui

// HomeState is what the home screen shows: the version line, who you are, the keys.
type HomeState struct {
	Version  string
	Platform string // "macOS", "Windows"
	Features string // "audio, chat, video, screen share"
	Name     string
	Color    string
	// The join prompt: shown instead of the menu while joining.
	Joining  bool
	JoinCode string
	Cursor   bool // the input's cursor phase
	// Escape pressed once: the quit hint changes for two seconds.
	EscArmed bool
}

// DrawHome draws the home screen or its join prompt into the frame.
func DrawHome(c *Canvas, s HomeState) {
	inner := Frame(c, true)
	if s.Joining {
		// Ink lays these centred columns out with a row more than the tree says, after the
		// title here and after "You are" below; the frames in testdata are the authority.
		Centered(c, inner, [][]Span{
			{{"Join Room", Style{FG: ThemeAccent, Bold: true}}},
			nil,
			nil,
			append([]Span{{"Room: ", Style{Bold: true}}}, textInputSpans(s.JoinCode, "name a room", true, s.Cursor)...),
			nil,
			chipRow([]KeyHint{{Key: "enter", Label: "join"}, {Key: "esc", Label: "back"}}),
		})
		return
	}
	title := []Span{
		{"\U0001F3A5 OpenMeet Terminal ", Style{FG: ThemeAccent, Bold: true}},
		{"v" + s.Version, Style{FG: ThemeMuted, Bold: true}},
		{" ", Style{FG: ThemeAccent, Bold: true}},
		{"· " + s.Platform + ": " + s.Features, Style{FG: ThemeMuted, Bold: true}},
	}
	quit := chipRow([]KeyHint{{Key: "esc", Label: "quit"}})
	if s.EscArmed {
		quit = []Span{{"Press Esc again to quit", Style{FG: ThemeWarn}}}
	}
	Centered(c, inner, [][]Span{
		title,
		{{"Lightweight video conferencing", Muted}},
		nil,
		{{"You are ", Plain}, NameSpan(s.Name, s.Color, true)},
		nil,
		nil,
		chipRow([]KeyHint{{Key: "j", Label: "join room"}}),
		chipRow([]KeyHint{{Key: "s", Label: "settings"}}),
		nil,
		quit,
	})
}

// chipRow is a row of buttons as one line of spans, one space between.
func chipRow(hints []KeyHint) []Span {
	var out []Span
	for i, h := range hints {
		if i > 0 {
			out = append(out, Span{" ", Plain})
		}
		out = append(out, ChipSpans(h)...)
	}
	return out
}

// textInputSpans is the single-line input with the cursor at the end.
func textInputSpans(value, placeholder string, focused, cursorShown bool) []Span {
	return TextInputSpans(value, len([]rune(value)), placeholder, focused, cursorShown)
}

// TextInputSpans is the single-line input: the text with the cell under the cursor inverted
// while it is shown, the placeholder in the muted grey while the text is empty.
func TextInputSpans(value string, cursor int, placeholder string, focused, cursorShown bool) []Span {
	if !focused {
		if value == "" {
			return []Span{{placeholder, Muted}}
		}
		return []Span{{value, Plain}}
	}
	r := []rune(value)
	if cursor > len(r) {
		cursor = len(r)
	}
	if cursor < 0 {
		cursor = 0
	}
	under := " "
	rest := ""
	if cursor < len(r) {
		under = string(r[cursor])
		rest = string(r[cursor+1:])
	}
	spans := []Span{{string(r[:cursor]), Plain}, {under, Style{Inverse: cursorShown}}, {rest, Plain}}
	if value == "" && placeholder != "" {
		spans = append(spans, Span{placeholder, Muted})
	}
	return spans
}
