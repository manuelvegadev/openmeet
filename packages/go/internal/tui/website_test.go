package tui

import (
	"fmt"
	"os"
	"regexp"
	"strconv"
	"strings"
	"testing"
)

// The landing page carries the same Look settings as this screen: the same thirteen accents,
// the same three tones, and a TypeScript port of the rules in theme.go. The rules are stable;
// the *table* is the part that will change, because somebody adds an accent — so this holds
// the two lists to each other from the side that would be doing the adding.
//
// It reads the file rather than generating it, so the page stays something a person edits.
// A checkout without the website is not a failure: it skips.
const websiteTheme = "../../../website/src/lib/theme.ts"

var accentLine = regexp.MustCompile(`\{\s*name:\s*'([^']+)',\s*hex:\s*'([^']+)',\s*alt:\s*'([^']+)'\s*\}`)

func TestTheWebsitePaletteMatches(t *testing.T) {
	src, err := os.ReadFile(websiteTheme)
	if err != nil {
		t.Skip("no website package here: " + err.Error())
	}
	found := accentLine.FindAllStringSubmatch(string(src), -1)
	if len(found) != len(Accents) {
		t.Fatalf("%s lists %d accents, this package has %d — add it in both or in neither",
			websiteTheme, len(found), len(Accents))
	}
	for i, m := range found {
		got := Accent{m[1], strings.ToUpper(m[2]), strings.ToUpper(m[3])}
		if want := Accents[i]; got != want {
			t.Errorf("accent %d: the page says %+v, this package says %+v", i, got, want)
		}
	}
	// The tones have to line up too: the page's row cycles the same three words, and a value
	// it wrote into localStorage is read back by name.
	tones := regexp.MustCompile(`export const TONES = \[([^\]]+)\]`).FindStringSubmatch(string(src))
	if tones == nil {
		t.Fatal("the page no longer declares TONES")
	}
	if got, want := quoted(tones[1]), fmt.Sprint(Tones); got != want {
		t.Errorf("the page's tones are %s, this package's are %s", got, want)
	}
}

// quoted pulls the single-quoted words out of a TypeScript array literal, in order.
func quoted(list string) string {
	out := regexp.MustCompile(`'([^']+)'`).FindAllStringSubmatch(list, -1)
	names := make([]string, len(out))
	for i, m := range out {
		names[i] = m[1]
	}
	return fmt.Sprint(names)
}

// The frame's glyphs are the other table that will change, and the page has its own copy:
// the terminal on the landing page is exported drawn in one border set, and the Look panel
// rewrites those characters into another when the visitor picks double or square. A glyph
// changed in frame.go without the page knowing leaves it rewriting cells into characters the
// export no longer contains, with nothing failing anywhere.
func TestTheWebsiteBorderSetsMatch(t *testing.T) {
	src, err := os.ReadFile(websiteTheme)
	if err != nil {
		t.Skip("no website package here: " + err.Error())
	}
	// The page writes them as escapes, one line per set, in the order of BorderSet's fields.
	want := map[string]BorderSet{
		"rounded": borderSingle,
		"square":  {'┌', '┐', '└', '┘', '─', '│', '├', '┤', '┬', '┴'},
		"double":  borderDouble,
	}
	for name, set := range want {
		line := regexp.MustCompile(name + `: '([^']+)'`).FindStringSubmatch(string(src))
		if line == nil {
			t.Errorf("the page declares no %q border set", name)
			continue
		}
		got, err := strconv.Unquote(`"` + line[1] + `"`)
		if err != nil {
			t.Errorf("%s: %v", name, err)
			continue
		}
		if b := []rune(got); string(b) != string(runesOf(set)) {
			t.Errorf("the page's %s border is %q, this package's is %q", name, got, string(runesOf(set)))
		}
	}
	// And the two rows that choose between them.
	for _, row := range []struct {
		decl string
		ours []string
	}{{"BORDERS", Weights}, {"CORNERS", Corners}} {
		m := regexp.MustCompile(`export const ` + row.decl + ` = \[([^\]]+)\]`).FindStringSubmatch(string(src))
		if m == nil {
			t.Errorf("the page no longer declares %s", row.decl)
			continue
		}
		if got, want := quoted(m[1]), fmt.Sprint(row.ours); got != want {
			t.Errorf("the page's %s are %s, this package's are %s", row.decl, got, want)
		}
	}
}

// runesOf is a border set in the order the page writes it: corners, runs, tees.
func runesOf(b BorderSet) []rune {
	return []rune{b.TL, b.TR, b.BL, b.BR, b.H, b.V, b.TeeL, b.TeeR, b.TeeD, b.TeeU}
}

// The light page darkens a name's colour the way ColorForName darkens it on a light ground,
// and the page states the result rather than computing it — thirteen hexes written by hand in
// _look.scss, with the dark thirteen in _base.scss above them. Both are NamePalette.
func TestTheWebsiteNameColoursMatch(t *testing.T) {
	for _, sheet := range []struct {
		path  string
		light bool
	}{{"../../../website/src/styles/_base.scss", false}, {"../../../website/src/styles/_look.scss", true}} {
		src, err := os.ReadFile(sheet.path)
		if err != nil {
			t.Skip("no website package here: " + err.Error())
		}
		found := map[string]string{}
		for _, m := range regexp.MustCompile(`--n-([a-z]+):\s*(#[0-9a-fA-F]{6})`).FindAllStringSubmatch(string(src), -1) {
			found[m[1]] = strings.ToUpper(m[2])
		}
		if len(found) != len(NamePalette) {
			t.Errorf("%s declares %d name colours, this package has %d", sheet.path, len(found), len(NamePalette))
		}
		for _, p := range NamePalette {
			want := strings.ToUpper(p.Hex)
			if sheet.light {
				want = strings.ToUpper(mix(p.Hex, "#000000", 0.55))
			}
			if got := found[p.Name]; got != want {
				t.Errorf("%s: --n-%s is %s, ColorForName gives %s", sheet.path, p.Name, got, want)
			}
		}
	}
}
