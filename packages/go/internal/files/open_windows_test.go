package files

import (
	"os"
	"testing"
)

// Nothing is spawned by bare name here: a window opened from a desktop shortcut inherits
// Explorer's stale environment (gotcha 21), so the three tools are taken from %SystemRoot%.
// This is the test that they are where we look for them.
func TestTheToolsAreWhereWeLookForThem(t *testing.T) {
	for _, path := range []string{system32("cmd.exe"), winPath("explorer.exe"), powershell()} {
		if _, err := os.Stat(path); err != nil {
			t.Errorf("%s: %v", path, err)
		}
	}
}

// Revealing starts Explorer with a command line it parses itself; over SSH it lands in
// session 0 and shows nothing, but starting at all is what this checks.
func TestRevealStarts(t *testing.T) {
	if os.Getenv("OPENMEET_CLIPBOARD_TEST") == "" {
		t.Skip("set OPENMEET_CLIPBOARD_TEST=1 to run this on a machine with a desktop")
	}
	f, err := os.CreateTemp(t.TempDir(), "reveal-*.txt")
	if err != nil {
		t.Fatal(err)
	}
	f.Close()
	if err := Reveal(f.Name()); err != nil {
		t.Fatalf("Reveal: %v", err)
	}
}
