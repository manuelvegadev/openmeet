package tui

import (
	"strings"

	"github.com/mattn/go-runewidth"
)

// ClampName cuts a name to what is allowed while it is typed: no control characters, no
// brackets, whitespace collapsed, at most NameMaxCells cells (lib/identity.ts).
func ClampName(raw string) string {
	clean := strings.Map(func(r rune) rune {
		if r < 32 || r == 127 || r == '[' || r == ']' {
			return -1
		}
		return r
	}, raw)
	clean = strings.Join(strings.Fields(clean), " ")
	if strings.HasPrefix(raw, " ") && clean != "" {
		// Fields drops the leading space too, which is what the Node client does.
	}
	if strings.HasSuffix(raw, " ") && clean != "" && !strings.HasSuffix(clean, " ") {
		clean += " " // a space typed mid-name stays until finishName trims it
	}
	out := ""
	for _, r := range clean {
		if runewidth.StringWidth(out+string(r)) > NameMaxCells {
			break
		}
		out += string(r)
	}
	return out
}

// FinishName is the name as saved: clamped and trimmed.
func FinishName(raw string) string { return strings.TrimSpace(ClampName(raw)) }
