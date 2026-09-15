package files

import (
	"os"
	"testing"
)

// StartsAPath is one character, and deliberately loose: in a keymap of bare lowercase letters
// a capital can only be someone writing.
func TestStartsAPath(t *testing.T) {
	for _, r := range []rune{'"', '\'', '/', '~', '\\', ':', 'C', 'D'} {
		if !StartsAPath(r) {
			t.Errorf("StartsAPath(%q) = false", r)
		}
	}
	for _, r := range []rune{'a', 'm', 's', 'd', 'q', '1', ' ', '-'} {
		if StartsAPath(r) {
			t.Errorf("StartsAPath(%q) = true, and %q is a key this room uses", r, r)
		}
	}
}

// The shape test is what decides whether a draft is worth a stat at all, so it has to say no
// to ordinary typing and yes to every way a terminal writes a dropped path.
func TestLooksLikePath(t *testing.T) {
	yes := []string{
		"/Users/mvega/notes.txt",
		"~/Downloads/a.png",
		`"C:\\Users\\mvega\\Downloads\\a.png"`,
		`C:\\Users\\mvega\\a.png`,
		"C:/Users/mvega/a.png",
		`\\\\nas\\share\\a.png`,
		"  /tmp/a.txt  ",
	}
	for _, s := range yes {
		if !LooksLikePath(s) {
			t.Errorf("LooksLikePath(%q) = false", s)
		}
	}
	no := []string{
		"", "hi", "look at /tmp/a.txt", "vale", "C:", "no/such",
		"line one\nline two", "/ab",
		// A capital starts a sentence far more often than a drive, and a draft being typed
		// must not reach the filesystem on every keystroke.
		"Hello there", "Buenos dias a todos", "Cuando llegues avisa",
	}
	for _, s := range no {
		if LooksLikePath(s) {
			t.Errorf("LooksLikePath(%q) = true", s)
		}
	}
}

// A terminal may put a space or a carriage return around a dropped path; that is still one
// path, and refusing it was the bug that left the path sitting in the message.
func TestAttachIgnoresWhatATerminalPutsAroundThePath(t *testing.T) {
	dir := t.TempDir()
	path := dir + "/notes.txt"
	if err := writeFile(path); err != nil {
		t.Fatal(err)
	}
	for _, raw := range []string{path, path + " ", path + "\r\n", " " + path + "\r", `"` + path + `" `} {
		got, ok := Attach(raw)
		if !ok || len(got) != 1 || got[0].Path != path {
			t.Errorf("Attach(%q) = %v %v", raw, got, ok)
		}
	}
	if _, ok := Attach(path + "\nsomething else"); ok {
		t.Error("two lines is not one path")
	}
}

func writeFile(path string) error {
	return os.WriteFile(path, []byte("hello"), 0o644)
}
