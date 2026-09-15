package files

import (
	"os"
	"path/filepath"
	"runtime"
	"strings"
)

// Attaching by dropping. A file dragged onto a terminal is not a file as far as the
// application is concerned: the terminal writes its *path* in as text, the way a paste
// arrives. So the composer stats what was written, and text that turns out to name a file
// becomes an attachment instead of a line of the message.
//
// Every terminal escapes that path differently. Terminal.app puts a backslash before each
// space, Windows Terminal wraps the whole thing in quotes, and several files dropped at once
// arrive as one string with spaces between them — which is ambiguous with a single path that
// has spaces in it, so the whole string is tried first and only then split.

// StartsAPath is the first character of a path, in every form a terminal writes one: quoted,
// absolute (`/`, or `\\` for a share), from the home directory, or a drive letter — which is
// why a capital is here too.
//
// It exists because a drop is written in one key at a time (gotcha 39), so the *first* one is
// all there is to go on: seen in a keymap of bare letters, it means the room is being written
// to rather than commanded. Deliberately looser than LooksLikePath, which asks of a whole
// string whether it is worth a stat — one character cannot tell a drive letter from a capital,
// and taking a capital for the start of a message costs nothing where no key is a capital.
func StartsAPath(r rune) bool {
	return strings.ContainsRune(`"'/~\:`, r) || (r >= 'A' && r <= 'Z')
}

// LooksLikePath is the cheap question asked before the disk is: does this text even have the
// shape of a path? It is what lets the composer watch a draft as it is typed without a stat
// per keystroke — a dropped path does not always arrive in one piece, and the only thing that
// catches every shape is looking at what the draft has become.
func LooksLikePath(s string) bool {
	s = strings.Trim(s, " \t\r\n")
	if len(s) < 4 || strings.ContainsAny(s, "\n\r") {
		return false
	}
	switch {
	case strings.HasPrefix(s, "/"), strings.HasPrefix(s, "~/"), strings.HasPrefix(s, `~\`):
		return true
	case strings.HasPrefix(s, `"`), strings.HasPrefix(s, "'"):
		return true
	case strings.HasPrefix(s, `\\`): // a UNC share
		return true
	case s[1] == ':' && (s[2] == '\\' || s[2] == '/'): // a drive
		return true
	}
	return false
}

// Inspect is a file's name, size and kind without reading it. Describe is the one that
// hashes, and that waits until something is actually being sent.
func Inspect(path string) (Meta, error) {
	info, err := os.Stat(path)
	if err != nil {
		return Meta{}, err
	}
	if info.IsDir() || !info.Mode().IsRegular() {
		return Meta{}, os.ErrInvalid
	}
	name := filepath.Base(path)
	return Meta{Path: path, Name: name, Size: info.Size(), Kind: Kind(name)}, nil
}

// Attach turns what the terminal wrote into the files it names, or says it named none.
func Attach(raw string) ([]Meta, bool) {
	// Trim the ends rather than refusing them: a terminal that writes a dropped path may put
	// a space, a carriage return or both around it, and that is still one path. An interior
	// newline is a different matter — that is two lines of something, not a file.
	raw = strings.Trim(raw, " \t\r\n")
	if raw == "" || strings.ContainsAny(raw, "\n\r") {
		return nil, false
	}
	// One path, spaces and all, is the common case and the one that is ambiguous.
	if m, err := Inspect(expand(unquote(raw))); err == nil {
		return []Meta{m}, true
	}
	tokens := splitPaths(raw)
	if len(tokens) < 2 {
		return nil, false
	}
	out := make([]Meta, 0, len(tokens))
	for _, t := range tokens {
		m, err := Inspect(expand(t))
		if err != nil {
			// All of them or none: half a drop turning into text and half into chips would
			// be worse than treating the whole thing as what was typed.
			return nil, false
		}
		out = append(out, m)
	}
	return out, true
}

// splitPaths breaks a drop into its paths, honouring quotes, and backslash escapes only
// where a backslash is an escape: on Windows it is the path separator, and unescaping there
// would turn C:\Users\me into C:Usersme.
func splitPaths(raw string) []string {
	escapes := runtime.GOOS != "windows"
	var out []string
	var cur strings.Builder
	quote := rune(0)
	flush := func() {
		if cur.Len() > 0 {
			out = append(out, cur.String())
			cur.Reset()
		}
	}
	runes := []rune(raw)
	for i := 0; i < len(runes); i++ {
		r := runes[i]
		switch {
		case quote != 0:
			if r == quote {
				quote = 0
				continue
			}
			cur.WriteRune(r)
		case r == '"' || r == '\'':
			quote = r
		case escapes && r == '\\' && i+1 < len(runes):
			i++
			cur.WriteRune(runes[i])
		case r == ' ' || r == '\t':
			flush()
		default:
			cur.WriteRune(r)
		}
	}
	flush()
	return out
}

func unquote(s string) string {
	if len(s) >= 2 {
		if (s[0] == '"' && s[len(s)-1] == '"') || (s[0] == '\'' && s[len(s)-1] == '\'') {
			s = s[1 : len(s)-1]
		}
	}
	if runtime.GOOS != "windows" {
		// A single escaped path, as Terminal.app writes one.
		if strings.Contains(s, `\ `) {
			s = strings.ReplaceAll(s, `\ `, " ")
		}
	}
	return s
}

// expand turns a leading ~ into the home directory, which is how a path gets pasted as often
// as it gets dropped.
func expand(s string) string {
	if s == "~" || strings.HasPrefix(s, "~/") || (runtime.GOOS == "windows" && strings.HasPrefix(s, `~\`)) {
		if home, err := os.UserHomeDir(); err == nil {
			return filepath.Join(home, strings.TrimPrefix(strings.TrimPrefix(s, "~"), string(filepath.Separator)))
		}
	}
	return s
}
