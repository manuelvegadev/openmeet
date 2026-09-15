package files

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

// Reading the clipboard needs a desktop session, so this one is asked for rather than
// assumed:
//
//	OPENMEET_CLIPBOARD_TEST=1 go test ./internal/files -run Clipboard -v
//
// It puts a real screenshot on the clipboard the way the system does and reads it back,
// which is the path a shared screenshot actually takes.
func TestClipboardTurnsAScreenshotIntoAFile(t *testing.T) {
	if os.Getenv("OPENMEET_CLIPBOARD_TEST") == "" {
		t.Skip("set OPENMEET_CLIPBOARD_TEST=1 to run this on a machine with a desktop")
	}
	if err := exec.Command("screencapture", "-c", "-x", "-R0,0,320,240").Run(); err != nil {
		t.Skip("no screen to capture:", err)
	}
	path, err := Clipboard()
	if err != nil {
		t.Fatal(err)
	}
	defer os.Remove(path)
	if !strings.HasSuffix(path, ".png") {
		t.Errorf("a screenshot should arrive as a png, got %q", path)
	}
	m, err := Inspect(path)
	if err != nil {
		t.Fatal(err)
	}
	if m.Size == 0 || m.Kind != KindImage {
		t.Errorf("meta = %+v", m)
	}
}

// A file copied in the Finder is a reference, and attaches as that file rather than as a
// copy of its bytes.
func TestClipboardTakesAFileReference(t *testing.T) {
	if os.Getenv("OPENMEET_CLIPBOARD_TEST") == "" {
		t.Skip("set OPENMEET_CLIPBOARD_TEST=1 to run this on a machine with a desktop")
	}
	path := filepath.Join(t.TempDir(), "clipped.txt")
	if err := os.WriteFile(path, []byte("hello"), 0o644); err != nil {
		t.Fatal(err)
	}
	set := `set the clipboard to (POSIX file "` + path + `")`
	if out, err := exec.Command("osascript", "-e", set).CombinedOutput(); err != nil {
		t.Fatalf("could not put a file on the clipboard: %v\n%s", err, out)
	}
	got, err := Clipboard()
	if err != nil {
		t.Fatal(err)
	}
	if got != path {
		t.Fatalf("clipboard gave %q, want %q", got, path)
	}
}
