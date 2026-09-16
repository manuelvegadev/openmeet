package tui

import (
	"math"
	"strings"
	"testing"
)

// theme puts the palette back the way every other test in this package expects to find it.
// The palette is package state, which is what lets a screen ask for ThemeAccent and get
// whatever the user chose; a test that changes it has to put it back.
func theme(t *testing.T, accent, background, borders string) {
	t.Helper()
	themeAs(t, accent, "base", background, borders, "rounded")
}

func themeAs(t *testing.T, accent, tone, background, borders, corners string) {
	t.Helper()
	t.Cleanup(func() { SetTheme("yellow", "base", "black", "single", "rounded") })
	SetTheme(accent, tone, background, borders, corners)
}

func TestDefaultThemeIsWhatTheGoldenFramesWereDrawnIn(t *testing.T) {
	theme(t, "yellow", "black", "single")
	for _, c := range []struct{ got, want string }{
		{ThemeAccent, "#E8B900"}, {ThemeAccentAlt, "#C084FC"}, {ThemeBG, "#0B0B0B"},
		{ThemeText, "#E8E8E8"}, {ThemeMuted, "#8A8A8A"}, {ThemeOnAccent, "#0B0B0B"},
		{ThemeSurface, "#222222"},
	} {
		if c.got != c.want {
			t.Errorf("default palette: got %s, want %s", c.got, c.want)
		}
	}
	if B != borderSingle {
		t.Error("default borders are not single")
	}
}

// An unknown accent is yellow rather than nothing: settings.json is a file on disk.
func TestUnknownAccentFallsBackToYellow(t *testing.T) {
	theme(t, "chartreuse", "black", "single")
	if ThemeAccent != "#E8B900" {
		t.Errorf("accent %s, want the default", ThemeAccent)
	}
}

func TestAccentReachesEveryStyleBuiltFromIt(t *testing.T) {
	theme(t, "blue", "black", "single")
	if ThemeAccent != "#60A5FA" {
		t.Fatalf("accent %s", ThemeAccent)
	}
	if chipKey.BG != "#60A5FA" || frameStyle.FG != "#60A5FA" || ruleStyle.FG != "#60A5FA" {
		t.Errorf("styles held as package variables were not rebuilt: %+v %+v", chipKey, frameStyle)
	}
	if ThemeAccentAlt == ThemeAccent {
		t.Error("the companion colour is the accent itself")
	}
	c := NewCanvas(120, 34)
	DrawHome(c, HomeState{Version: "0.6.0", Platform: "macOS", Name: "mvega"})
	if st := c.StyleAt(0, 0); st.FG != "#60A5FA" {
		t.Errorf("the frame is drawn in %s, not the accent", st.FG)
	}
}

// Every accent has to be readable with the text the chips put on it. The rule decides, not
// the table, so an accent added later cannot arrive unreadable.
func TestEveryAccentTakesReadableText(t *testing.T) {
	for _, a := range Accents {
		theme(t, a.Name, "black", "single")
		if r := contrast(a.Hex, ThemeOnAccent); r < 4.5 {
			t.Errorf("%s: text on the accent is %.1f:1, want 4.5 or better", a.Name, r)
		}
	}
}

func TestLightBackgroundDarkensTheTextAndTheNames(t *testing.T) {
	theme(t, "yellow", "white", "single")
	if luminance(ThemeText) > luminance(ThemeBG) {
		t.Error("the text is lighter than the ground it is on")
	}
	if r := contrast(ThemeText, ThemeBG); r < 7 {
		t.Errorf("text on the ground is %.1f:1", r)
	}
	// A name's colour travels with the person; on white the palette it comes from is too
	// pale to read, so it is darkened here and the hue survives.
	pale := "#FACC15"
	got := ColorForName("mvega", pale)
	if got == pale {
		t.Fatal("the name kept its colour on a light background")
	}
	if r := contrast(got, ThemeBG); r < 3 {
		t.Errorf("the name is %.1f:1 against the ground", r)
	}
	pr, pg, pb := parseHex(pale)
	gr, gg, gb := parseHex(got)
	if !(gr < pr && gg < pg && gb <= pb) {
		t.Errorf("darkening %s gave %s", pale, got)
	}
}

// A transparent background is the terminal's own, which is SGR 49 and not a colour.
func TestTransparentLeavesTheGroundToTheTerminal(t *testing.T) {
	theme(t, "yellow", "transparent", "single")
	if ThemeBG != ThemeDefault || ThemeText != ThemeDefault {
		t.Fatalf("bg %s, text %s", ThemeBG, ThemeText)
	}
	c := NewCanvas(20, 3)
	c.Fill(Rect{0, 0, 20, 3}, Plain)
	c.Put(0, 0, "hello", Plain, 0)
	out := c.Render()
	if !strings.Contains(out, "\x1b[39;49m") {
		t.Errorf("plain text is not left to the terminal: %q", out)
	}
	if strings.Contains(out, "48;2;") {
		t.Errorf("a transparent frame still paints a background: %q", out)
	}
	// Everything that paints its own background keeps a foreground of its own, so a chip is
	// readable whichever kind of terminal it lands on.
	if chipLabel.FG == ThemeDefault || chipOff.FG == ThemeDefault || chipKey.FG == ThemeDefault {
		t.Error("a chip left its text to the terminal while painting over it")
	}
}

// A selection paints a colour we chose over text that had none; the text has to come with it.
func TestSelectionOverTransparentTextGetsAColour(t *testing.T) {
	theme(t, "yellow", "transparent", "single")
	c := NewCanvas(20, 1)
	c.Fill(Rect{0, 0, 20, 1}, Plain)
	spans := []Span{{"hello", Plain}}
	c.PutSpans(0, 0, spans, 0)
	c.MarkText("log", TextRow{X: 0, Y: 0, MaxX: 20, Spans: spans})
	c.PaintSelection("log", TextPos{0, 0}, TextPos{0, 5}, ThemeSelection)
	st := c.StyleAt(0, 0)
	if st.BG != ThemeSelection {
		t.Fatalf("the band was not painted: %+v", st)
	}
	if st.FG == ThemeDefault {
		t.Error("the selected text was left to the terminal over a band of ours")
	}
}

func TestDoubleBordersDrawEveryJunctionInTheSameWeight(t *testing.T) {
	theme(t, "yellow", "black", "double")
	c := NewCanvas(120, 34)
	DrawRoom(c, poseRoom())
	rows := strings.Split(c.Text(), "\n")
	if !strings.HasPrefix(rows[0], "╔") || !strings.HasSuffix(strings.TrimRight(rows[0], " "), "╗") {
		t.Errorf("top row: %q", rows[0])
	}
	last := rows[len(rows)-1]
	if !strings.HasPrefix(last, "╚") || !strings.HasSuffix(strings.TrimRight(last, " "), "╝") {
		t.Errorf("bottom row: %q", last)
	}
	// The junction the divider makes with a rule — the T the frame is most likely to get
	// wrong — points down at the header's rule and up at the bottom edge, in the same weight.
	if !strings.Contains(rows[2], "╦") {
		t.Errorf("the header's rule has no double junction: %q", rows[2])
	}
	if !strings.Contains(last, "╩") {
		t.Errorf("the bottom edge has no double junction: %q", last)
	}
	for i, row := range rows {
		for _, bad := range []string{"─", "│", "├", "┤", "┬", "┴", "╭", "╮", "╰", "╯"} {
			if strings.Contains(row, bad) {
				t.Errorf("row %d still has a single-weight %s: %q", i, bad, row)
			}
		}
	}
}

func TestSingleBordersAreUnchanged(t *testing.T) {
	theme(t, "yellow", "black", "single")
	c := NewCanvas(120, 34)
	DrawRoom(c, poseRoom())
	rows := strings.Split(c.Text(), "\n")
	if !strings.HasPrefix(rows[0], "╭") {
		t.Errorf("top row: %q", rows[0])
	}
	if !strings.Contains(rows[2], "┬") || !strings.Contains(rows[len(rows)-1], "┴") {
		t.Error("the divider's junctions are not where they were")
	}
}

// The accent row is the one place where the choice is a colour, so the chips are drawn in
// the colours they name: you pick one by looking at it rather than by reading it.
func TestAccentChipsAreDrawnInTheColoursTheyName(t *testing.T) {
	theme(t, "yellow", "black", "single")
	c := NewCanvas(120, 3)
	row := SettingsRow{Label: "Accent", Choices: AccentNames(), ChoiceColors: AccentSwatches(), Choice: 3}
	drawChoices(c, 0, 0, 120, row)
	x := 0
	for i, name := range row.Choices {
		st := c.StyleAt(x+1, 0)
		want := Accents[i].Hex
		if i == row.Choice {
			if st.BG != want || st.FG != onColor(want) {
				t.Errorf("%s is the chosen chip: got fg %s on %s, want %s on %s", name, st.FG, st.BG, onColor(want), want)
			}
		} else if st.FG != want || st.BG != ThemeSurface {
			t.Errorf("%s: got fg %s on %s, want %s on the surface", name, st.FG, st.BG, want)
		}
		x += Width(name) + 3
	}
}

// A tone is the same colour said louder or more quietly: the hue is what a person recognises
// the accent by, so it is the one thing neither direction may move.
func TestToneKeepsTheHueAndMovesTheSaturation(t *testing.T) {
	for _, a := range Accents {
		h, s, _ := toHSL(a.Hex)
		if s < 0.05 {
			continue // white has no hue to keep
		}
		for _, tone := range []string{"vivid", "pastel"} {
			got := toneOf(a.Hex, tone)
			gh, gs, _ := toHSL(got)
			if diff := math.Abs(gh - h); diff > 0.01 && diff < 0.99 {
				t.Errorf("%s %s: hue moved from %.3f to %.3f", a.Name, tone, h, gh)
			}
			if tone == "vivid" && gs <= s && s < 0.99 {
				t.Errorf("%s vivid: saturation %.2f is not above the base %.2f", a.Name, gs, s)
			}
			if tone == "pastel" && gs >= s {
				t.Errorf("%s pastel: saturation %.2f is not below the base %.2f", a.Name, gs, s)
			}
		}
	}
}

// Vivid has no meaning for a colour with no hue, and a naive saturation would send it to red.
func TestVividLeavesWhiteAlone(t *testing.T) {
	white := AccentByName("white").Hex
	if got := toneOf(white, "vivid"); got != white {
		t.Errorf("white went vivid as %s", got)
	}
}

// Both tones can land on a colour that cannot be told from the ground; the floor is what
// stops a screen being unreadable because of a setting.
func TestEveryToneStaysReadableOnEveryBackground(t *testing.T) {
	for _, bg := range Backgrounds {
		for _, tone := range Tones {
			for _, a := range Accents {
				themeAs(t, a.Name, tone, bg, "single", "rounded")
				ground := "#0B0B0B"
				if themeLight {
					ground = "#FFFFFF"
				}
				if r := contrast(ThemeAccent, ground); r < 2.9 {
					t.Errorf("%s %s on %s: the accent is %.1f:1 against the ground", a.Name, tone, bg, r)
				}
				if r := contrast(ThemeOnAccent, ThemeAccent); r < 4.5 {
					t.Errorf("%s %s on %s: a key cap is %.1f:1", a.Name, tone, bg, r)
				}
			}
		}
	}
}

// Pastel on white is the case the floor exists for: a wash of the accent over near-white is
// the same colour as the page.
func TestPastelOnWhiteIsPulledBackRatherThanLeftInvisible(t *testing.T) {
	themeAs(t, "yellow", "pastel", "white", "single", "rounded")
	naive := toneOf(AccentByName("yellow").Hex, "pastel")
	if contrast(naive, "#FFFFFF") >= 3 {
		t.Skip("the naive pastel was already readable; nothing to pull back")
	}
	if ThemeAccent == naive {
		t.Errorf("the accent was left at %s, %.1f:1 on white", naive, contrast(naive, "#FFFFFF"))
	}
	h1, _, _ := toHSL(naive)
	h2, _, _ := toHSL(ThemeAccent)
	if math.Abs(h1-h2) > 0.01 {
		t.Errorf("pulling it back changed the hue: %.3f to %.3f", h1, h2)
	}
}

func TestCornersSquareOffTheSingleFrame(t *testing.T) {
	themeAs(t, "yellow", "base", "black", "single", "square")
	c := NewCanvas(120, 34)
	DrawRoom(c, poseRoom())
	rows := strings.Split(c.Text(), "\n")
	if !strings.HasPrefix(rows[0], "┌") || !strings.HasSuffix(strings.TrimRight(rows[0], " "), "┐") {
		t.Errorf("top row: %q", rows[0])
	}
	last := strings.TrimRight(rows[len(rows)-1], " ")
	if !strings.HasPrefix(last, "└") || !strings.HasSuffix(last, "┘") {
		t.Errorf("bottom row: %q", last)
	}
	// The bubbles are the same box, so they square off with it.
	if strings.Contains(c.Text(), "╭") || strings.Contains(c.Text(), "╯") {
		t.Error("something is still drawn with a rounded corner")
	}
	// Only the corners change: the runs and the junctions are the single set as before.
	if !strings.Contains(rows[2], "┬") || !strings.Contains(last, "┴") {
		t.Error("the divider's junctions changed with the corners")
	}
}

// A double line has no rounded corner in Unicode, so the corner setting cannot apply — and
// the row that offers it says so rather than drawing something that does not exist.
func TestDoubleIgnoresTheCornerChoice(t *testing.T) {
	themeAs(t, "yellow", "base", "black", "double", "rounded")
	if B != borderDouble {
		t.Error("asking for rounded double corners changed the set")
	}
	if RoundableWeight("double") {
		t.Error("double claims to be roundable")
	}
	if !RoundableWeight("single") {
		t.Error("single claims not to be roundable")
	}
}

// The palette is a wheel and the accents are the same wheel the names come from, so a room
// has one palette in it and not two. Yellow is the one entry that differs, because the accent
// has always been #E8B900 and the golden frames are drawn in it.
func TestTheAccentsAreTheNamePaletteWheel(t *testing.T) {
	if len(Accents) != len(NamePalette) {
		t.Fatalf("%d accents against %d name colours", len(Accents), len(NamePalette))
	}
	for i, a := range Accents {
		n := NamePalette[i]
		if a.Name != n.Name {
			t.Errorf("%d: accent %q, name colour %q — the two wheels are out of step", i, a.Name, n.Name)
		}
		if a.Hex != n.Hex && a.Name != "yellow" {
			t.Errorf("%s: accent %s, name colour %s", a.Name, a.Hex, n.Hex)
		}
	}
	if AccentByName("yellow").Hex != "#E8B900" {
		t.Error("the default accent is no longer the colour the golden frames are drawn in")
	}
	// A name this build has never heard of — an older settings.json, a hand edit — is the
	// default, which is not whatever happens to be first in the wheel.
	if got := AccentByName("lilac"); got.Name != DefaultAccent {
		t.Errorf("an unknown accent fell back to %q", got.Name)
	}
	// Every companion differs from the accent it belongs to: the room's tags and log lines
	// are drawn in it precisely so they are not the accent.
	for _, a := range Accents {
		if a.Alt == a.Hex {
			t.Errorf("%s: the companion colour is the accent itself", a.Name)
		}
	}
}

// Thirteen chips do not fit on one line at 120 cells, so the row wraps and says how tall it
// became — otherwise the rows under it are drawn over.
func TestAChoiceRowTooWideForTheWindowWraps(t *testing.T) {
	theme(t, "yellow", "black", "single")
	row := SettingsRow{Label: "Accent", Choices: AccentNames(), ChoiceColors: AccentSwatches(), Choice: 3}
	c := NewCanvas(60, 6)
	used := drawChoices(c, 4, 0, 56, row)
	if used < 2 {
		t.Fatalf("the row fitted in %d line(s) at 56 cells", used)
	}
	rows := strings.Split(c.Text(), "\n")
	for i := 0; i < used; i++ {
		if strings.TrimSpace(rows[i]) == "" {
			t.Errorf("line %d of the wrapped row is empty", i)
		}
		if Width(rows[i]) > 56 {
			t.Errorf("line %d runs to %d cells: %q", i, Width(rows[i]), rows[i])
		}
	}
	// Every chip is on one line or the other, whole.
	all := strings.Join(rows[:used], " ")
	for _, name := range row.Choices {
		if !strings.Contains(all, name) {
			t.Errorf("%q was dropped by the wrap", name)
		}
	}
	// The continuation lines start under the first chip, not at the label.
	if strings.HasPrefix(rows[1], " "+row.Choices[0]) {
		t.Error("the second line did not keep the row's left margin")
	}
}

// A wrapped row pushes the rows under it down instead of being drawn over by them.
func TestWrappedRowsDoNotOverlapTheRowsBelow(t *testing.T) {
	theme(t, "yellow", "black", "single")
	rows := []SettingsRow{
		{Tab: "Look", Label: "Accent", Choices: AccentNames(), ChoiceColors: AccentSwatches(), Choice: 3, Live: true, Help: "the colour"},
		{Tab: "Look", Label: "Borders", Choices: Weights, Choice: 0, Live: true, Help: "one line or two"},
	}
	c := NewCanvas(120, 34)
	DrawSettings(c, SettingsState{Rows: rows, Selected: 0, Tabs: []string{"Look"}, Tab: 0})
	text := c.Text()
	accentLine, bordersLine := -1, -1
	for i, line := range strings.Split(text, "\n") {
		if strings.Contains(line, "Accent") {
			accentLine = i
		}
		if strings.Contains(line, "Borders") {
			bordersLine = i
		}
	}
	if accentLine < 0 || bordersLine < 0 {
		t.Fatal("a row is missing from the screen")
	}
	if bordersLine-accentLine < 2 {
		t.Errorf("Borders is %d line(s) under Accent, which wrapped", bordersLine-accentLine)
	}
}
