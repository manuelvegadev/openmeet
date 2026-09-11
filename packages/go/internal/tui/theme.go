package tui

// The palette, copied value for value from packages/terminal/src/lib/theme.ts — every
// colour a 24-bit hex, for the reasons written there: a named ANSI colour is a palette
// index and renders as a different hue in every terminal.
const (
	ThemeBG        = "#0B0B0B"
	ThemeText      = "#E8E8E8"
	ThemeMuted     = "#8A8A8A"
	ThemeAccent    = "#E8B900"
	ThemeOnAccent  = "#0B0B0B"
	ThemeAccentAlt = "#C084FC"
	ThemeSurface   = "#222222"
	ThemeOK        = "#4ADE80"
	ThemeWarn      = "#FB923C"
	ThemeDanger    = "#F87171"
	ThemeInfo      = "#7DD3FC"
)

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
func ColorForName(name, chosen string) string {
	if isNameColor(chosen) {
		return chosen
	}
	var hash int32
	for _, r := range name {
		hash = (hash<<5 - hash + int32(r))
	}
	if hash < 0 {
		hash = -hash
	}
	return themeUsers[int(hash)%len(themeUsers)]
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
