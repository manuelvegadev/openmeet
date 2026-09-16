package tui

import (
	"math"
	"slices"
)

// The palette. Its default values are copied colour for colour from the retired Node
// client's src/lib/theme.ts (git show terminal-v0.5.2:packages/terminal/src/lib/theme.ts) —
// every one a 24-bit hex, for the reason written there: a named ANSI colour is a palette
// index and renders as a different hue in every terminal.
//
// They are variables rather than constants because the accent, the background and the
// borders are the user's (Settings ▸ Look). Everything else on this screen is derived from
// those three, here, once: a screen asks for ThemeAccent and gets whatever the accent is,
// and nothing else in the interface knows a theme exists. SetTheme is called before the
// first frame and again on every change, from the one goroutine that draws.
var (
	ThemeBG        = "#0B0B0B"
	ThemeText      = "#E8E8E8"
	ThemeMuted     = "#8A8A8A"
	ThemeAccent    = "#E8B900"
	ThemeOnAccent  = "#0B0B0B"
	ThemeAccentAlt = "#C084FC"
	ThemeSurface   = "#222222"
	// Text drawn on ThemeSurface — a chip's label, a meter's number. It is its own colour
	// and not ThemeText, because a transparent background leaves the text to the terminal
	// while the surface stays a colour we chose: the two cannot be the same value there.
	ThemeOnSurface = "#E8E8E8"
	ThemeOK        = "#4ADE80"
	ThemeWarn      = "#FB923C"
	ThemeDanger    = "#F87171"
	ThemeInfo      = "#7DD3FC"
	// Ours, with no equivalent in theme.ts: the Node client never selected anything. The
	// accent at a background's luminance, so a selection reads as this application's and not
	// as the terminal's own blue.
	ThemeSelection = "#3A2F00"
	// What a selected cell's text becomes when it had no colour of its own — which under a
	// transparent background means the terminal's, and the band has just painted over the
	// ground that made it readable. A cell that carries a colour keeps it: a name inside a
	// selection is still that person's.
	ThemeSelectionText = "#E8E8E8"
)

// ThemeDefault is not a colour: it is the terminal's own, which is what a transparent
// background means. A cell carrying it is written with SGR 39/49 rather than an RGB triple,
// so whatever is behind the window — a wallpaper, a blur, another pane — shows through.
const ThemeDefault = "default"

// Accent is one of the accents a user can choose: the colour itself, and the companion the
// room's events and tags are drawn in, which has to differ from it.
type Accent struct{ Name, Hex, Alt string }

// Accents are the choices, in the order the settings row draws them: white, then once round
// the wheel — the same thirteen, in the same order, at the same values as NamePalette below,
// because a room should have one palette in it and not two, and a test holds the two lists to
// each other. Yellow is the single exception, and deliberately: the accent has always been
// #E8B900 and every golden frame in testdata is drawn in it.
//
// There is no pale entry beside a full one — no lilac next to purple. A pale or a deeper
// version of a colour is what the Tone row is for, and it can do it to any of the thirteen
// rather than to the one somebody thought to add.
var Accents = []Accent{
	{"white", "#E8E8E8", "#C084FC"},
	{"red", "#F87171", "#22D3EE"},
	{"orange", "#FB923C", "#60A5FA"},
	{"yellow", "#E8B900", "#C084FC"},
	{"lime", "#A3E635", "#E879F9"},
	{"green", "#4ADE80", "#F472B6"},
	{"teal", "#2DD4BF", "#FB923C"},
	{"cyan", "#22D3EE", "#FB923C"},
	{"blue", "#60A5FA", "#FBBF24"},
	{"indigo", "#818CF8", "#FACC15"},
	{"purple", "#C084FC", "#A3E635"},
	{"fuchsia", "#E879F9", "#4ADE80"},
	{"pink", "#F472B6", "#22D3EE"},
}

// DefaultAccent is what an unrecognised name falls back to — the interface's own colour, not
// whatever happens to be first in the wheel.
const DefaultAccent = "yellow"

// Backgrounds are the choices for what the window is painted on. "transparent" paints
// nothing, leaving the terminal's own background — and with it, the terminal's own idea of
// what the text colour should be.
var Backgrounds = []string{"black", "white", "transparent"}

// Tones are how strongly an accent is drawn: the colour as it is in the table, the same hue
// at full saturation, or the same hue washed out. The hue never changes — a tone is the same
// colour said louder or more quietly, which is why the row is separate from the accent's.
var Tones = []string{"base", "vivid", "pastel"}

// AccentNames is the accents as the settings row wants them for its chips.
func AccentNames() []string {
	out := make([]string, len(Accents))
	for i, a := range Accents {
		out[i] = a.Name
	}
	return out
}

// AccentSwatches is the colour to draw each accent's chip in: the accent **at the tone in
// force**, so the row shows what choosing it would actually give you rather than a colour
// the tone would then change.
func AccentSwatches() []string {
	out := make([]string, len(Accents))
	for i, a := range Accents {
		out[i] = toneOf(a.Hex, themeTone)
	}
	return out
}

// ToneSwatches is the same for the tone row: the accent you have, at each of the three, so
// the choice is three shades of your own colour side by side.
func ToneSwatches() []string {
	out := make([]string, len(Tones))
	for i, t := range Tones {
		out[i] = toneOf(themeAccentBase, t)
	}
	return out
}

// AccentByName is the named accent, or the default for a name nobody here wrote —
// settings.json is a file on disk and can say anything.
func AccentByName(name string) Accent {
	for _, a := range Accents {
		if a.Name == name {
			return a
		}
	}
	if name != DefaultAccent {
		return AccentByName(DefaultAccent)
	}
	return Accents[0]
}

// What the rest of the palette was built for, kept so that the two swatch rows can answer
// "what would this look like" without the caller having to say: the ground (a light
// background needs dark text, darker semantic colours, and names darkened enough to be read
// on white), the tone in force, and the accent before the tone was applied to it.
var (
	themeLight      bool
	themeTone       = "base"
	themeAccentBase = AccentByName(DefaultAccent).Hex
)

// SetTheme rebuilds the palette from the choices and re-derives every style that was
// computed from it.
func SetTheme(accent, tone, background, borders, corners string) {
	a := AccentByName(accent)
	themeAccentBase = a.Hex
	themeTone = "base"
	if slices.Contains(Tones, tone) {
		themeTone = tone
	}

	switch background {
	case "white":
		themeLight = true
		ThemeBG = "#F5F5F5"
		ThemeText = "#1A1A1A"
	case "transparent":
		// Nothing is known about what is behind the window, so nothing is assumed: the
		// ground and the plain text are the terminal's own, and every colour this interface
		// paints a background with carries its own foreground, so it stays readable over a
		// terminal of either kind. The rest of the palette is the dark one, which is what
		// transparent is chosen for — a light terminal wants white.
		themeLight = false
		ThemeBG = ThemeDefault
		ThemeText = ThemeDefault
	default:
		themeLight = false
		ThemeBG = "#0B0B0B"
		ThemeText = "#E8E8E8"
	}
	if themeLight {
		ThemeMuted, ThemeSurface, ThemeOnSurface = "#6B6B6B", "#DEDEDE", "#1A1A1A"
		ThemeOK, ThemeWarn, ThemeDanger, ThemeInfo = "#15803D", "#C2410C", "#DC2626", "#0369A1"
	} else {
		ThemeMuted, ThemeSurface, ThemeOnSurface = "#8A8A8A", "#222222", "#E8E8E8"
		ThemeOK, ThemeWarn, ThemeDanger, ThemeInfo = "#4ADE80", "#FB923C", "#F87171", "#7DD3FC"
	}

	// The tone is applied after the ground is known, because both directions of it — full
	// saturation and washed out — can land on a colour that cannot be read on the ground
	// they are drawn against, and the floor that stops that needs to know which ground.
	ground := "#0B0B0B"
	if themeLight {
		ground = "#FFFFFF"
	}
	ThemeAccent = readable(toneOf(a.Hex, themeTone), ground)
	ThemeAccentAlt = readable(toneOf(a.Alt, themeTone), ground)

	// What a chip's key reads as: whichever end of the scale the accent is furthest from.
	// Yellow and every accent here are light enough to take dark text, but the rule is what
	// decides rather than the table, so an accent added later cannot arrive unreadable.
	ThemeOnAccent = onColor(ThemeAccent)
	// The selection: the accent pulled almost all the way to the ground it sits on, so the
	// band reads as this application's and the text over it stays the text's own colour.
	ThemeSelection = mix(ThemeAccent, ground, 0.21)
	ThemeSelectionText = "#E8E8E8"
	if themeLight {
		ThemeSelectionText = "#1A1A1A"
	}

	setBorders(borders, corners)
	restyle()
}

// toneOf is the accent said louder or more quietly, with its hue untouched. vivid takes the
// hue to full saturation and to the lightness where a hue carries the most colour; pastel
// halves the saturation and lifts it towards white. A grey has no hue to purify, so vivid
// leaves white alone rather than turning it red, which is where a naive saturation would
// send a colour whose hue is undefined.
func toneOf(hex, tone string) string {
	h, sat, l := toHSL(hex)
	switch tone {
	case "vivid":
		if sat < 0.05 {
			return hex
		}
		return fromHSL(h, 1, 0.55+(l-0.55)*0.35)
	case "pastel":
		return fromHSL(h, sat*0.5, l+(1-l)*0.45)
	}
	return hex
}

// readable is the floor under both tones: a colour that cannot be told from the ground it is
// drawn on is not a choice, it is a broken screen. It walks the lightness away from the
// ground until the contrast is there — which is what makes pastel on a white background come
// out as a dusty shade of the same hue instead of invisible, and vivid yellow likewise.
func readable(hex, ground string) string {
	const floor = 3.0
	if contrast(hex, ground) >= floor {
		return hex
	}
	h, sat, l := toHSL(hex)
	step := 0.04
	if luminance(ground) > 0.5 {
		step = -step
	}
	for i := 0; i < 25; i++ {
		l = min(1, max(0, l+step))
		hex = fromHSL(h, sat, l)
		if contrast(hex, ground) >= floor || l <= 0 || l >= 1 {
			break
		}
	}
	return hex
}

// onColor is what text written on a colour should be: whichever of black and white the
// colour is furthest from. What decides ThemeOnAccent, for any other colour that is used as
// a background — the chips on the accent row are each their own.
func onColor(hex string) string {
	if contrast(hex, "#0B0B0B") < contrast(hex, "#FFFFFF") {
		return "#FFFFFF"
	}
	return "#0B0B0B"
}

// restyle rebuilds the styles that are held as package variables because they are the same
// on every cell that uses them. They are the only values in this package computed from the
// palette ahead of a frame rather than inside one.
func restyle() {
	Muted = Style{FG: ThemeMuted}
	chipKey = Style{FG: ThemeOnAccent, BG: ThemeAccent, Bold: true}
	chipLabel = Style{FG: ThemeOnSurface, BG: ThemeSurface}
	chipOff = Style{FG: ThemeMuted, BG: ThemeSurface}
	frameStyle = Style{FG: ThemeAccent}
	ruleStyle = Style{FG: ThemeAccent}
}

// Chat usernames by hash, for a peer whose client sent no colour.
var themeUsers = []string{"#F472B6", "#60A5FA", "#A3E635", "#2DD4BF", "#E879F9", "#818CF8"}

// NameMaxCells is the name's ceiling in terminal cells (lib/identity.ts).
const NameMaxCells = 8

type PaletteColor struct{ Name, Hex string }

// NamePalette is what a name can be, in the picker's order: white, then round the wheel.
var NamePalette = []PaletteColor{
	{"white", "#E8E8E8"}, {"red", "#F87171"}, {"orange", "#FB923C"}, {"yellow", "#FACC15"},
	{"lime", "#A3E635"}, {"green", "#4ADE80"}, {"teal", "#2DD4BF"}, {"cyan", "#22D3EE"},
	{"blue", "#60A5FA"}, {"indigo", "#818CF8"}, {"purple", "#C084FC"}, {"fuchsia", "#E879F9"},
	{"pink", "#F472B6"},
}

func isNameColor(v string) bool {
	if len(v) != 7 || v[0] != '#' {
		return false
	}
	for _, r := range v[1:] {
		if !((r >= '0' && r <= '9') || (r >= 'a' && r <= 'f') || (r >= 'A' && r <= 'F')) {
			return false
		}
	}
	return true
}

// ColorForName is the chosen colour when valid, otherwise one hashed from the name — the
// same hash the Node client uses, so a peer looks the same from both.
//
// A name's colour belongs to the person, not to this window: it travels with join-room and
// everyone in the room draws it. On a light background the whole palette it comes from is
// too pale to read, so it is darkened here, which keeps the hue — the thing you recognise a
// person by — and changes only what it takes to see it.
func ColorForName(name, chosen string) string {
	c := chosen
	if !isNameColor(c) {
		var hash int32
		for _, r := range name {
			hash = (hash<<5 - hash + int32(r))
		}
		if hash < 0 {
			hash = -hash
		}
		c = themeUsers[int(hash)%len(themeUsers)]
	}
	if themeLight {
		return mix(c, "#000000", 0.55)
	}
	return c
}

// Bracketed is the form every name is shown in.
func Bracketed(name string) string {
	if name == "" {
		name = "?"
	}
	return "[" + name + "]"
}

// NameSpan is `[name]` in its colour.
func NameSpan(name, color string, bold bool) Span {
	return Span{Bracketed(name), Style{FG: ColorForName(name, color), Bold: bold}}
}

// mix blends two hexes, t being how much of the first survives.
func mix(a, b string, t float64) string {
	ar, ag, ab := parseHex(a)
	br, bg, bb := parseHex(b)
	f := func(x, y int) int { return int(float64(y) + t*float64(x-y) + 0.5) }
	return "#" + hex2(f(ar, br)) + hex2(f(ag, bg)) + hex2(f(ab, bb))
}

// contrast is WCAG's ratio between two colours, 1 to 21. It answers one question here —
// which of black and white to write on the accent — and that is all it is for.
func contrast(a, b string) float64 {
	la, lb := luminance(a)+0.05, luminance(b)+0.05
	if la < lb {
		la, lb = lb, la
	}
	return la / lb
}

func luminance(hex string) float64 {
	r, g, b := parseHex(hex)
	return 0.2126*linear(r) + 0.7152*linear(g) + 0.0722*linear(b)
}

func linear(v int) float64 {
	c := float64(v) / 255
	if c <= 0.04045 {
		return c / 12.92
	}
	return math.Pow((c+0.055)/1.055, 2.4)
}

func parseHex(s string) (int, int, int) {
	if len(s) != 7 || s[0] != '#' {
		return 0, 0, 0
	}
	h := func(i int) int {
		v := 0
		for _, r := range s[i : i+2] {
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
	return h(1), h(3), h(5)
}

// toHSL and fromHSL are the round trip a tone is computed in. Hue, saturation and lightness
// are the three things a tone talks about — "the same colour, purer" is a saturation and
// nothing else — and in RGB none of them is a coordinate you can move on its own.
func toHSL(hex string) (h, s, l float64) {
	ri, gi, bi := parseHex(hex)
	r, g, b := float64(ri)/255, float64(gi)/255, float64(bi)/255
	maxc, minc := max(r, max(g, b)), min(r, min(g, b))
	l = (maxc + minc) / 2
	d := maxc - minc
	if d == 0 {
		return 0, 0, l
	}
	if l > 0.5 {
		s = d / (2 - maxc - minc)
	} else {
		s = d / (maxc + minc)
	}
	switch maxc {
	case r:
		h = (g - b) / d
		if g < b {
			h += 6
		}
	case g:
		h = (b-r)/d + 2
	default:
		h = (r-g)/d + 4
	}
	return h / 6, s, l
}

func fromHSL(h, s, l float64) string {
	l = min(1, max(0, l))
	s = min(1, max(0, s))
	if s == 0 {
		v := int(l*255 + 0.5)
		return "#" + hex2(v) + hex2(v) + hex2(v)
	}
	q := l * (1 + s)
	if l >= 0.5 {
		q = l + s - l*s
	}
	p := 2*l - q
	ch := func(t float64) int {
		if t < 0 {
			t++
		}
		if t > 1 {
			t--
		}
		switch {
		case t < 1.0/6:
			return int((p+(q-p)*6*t)*255 + 0.5)
		case t < 1.0/2:
			return int(q*255 + 0.5)
		case t < 2.0/3:
			return int((p+(q-p)*(2.0/3-t)*6)*255 + 0.5)
		}
		return int(p*255 + 0.5)
	}
	return "#" + hex2(ch(h+1.0/3)) + hex2(ch(h)) + hex2(ch(h-1.0/3))
}

func hex2(v int) string {
	v = min(255, max(0, v))
	const digits = "0123456789ABCDEF"
	return string([]byte{digits[v>>4], digits[v&15]})
}
