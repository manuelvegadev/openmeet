package files

import (
	"os"
	"os/exec"
	"path/filepath"
	"testing"
)

// The clipboard needs a window station, which a test runner does not always have, so this
// one is asked for rather than assumed:
//
//	GOOS=windows go test -c ./internal/files && OPENMEET_CLIPBOARD_TEST=1 files.test.exe -test.run Clipboard -test.v
//
// It round-trips a file through the same PowerShell the reader uses, which is what proves
// the encoding: the script goes over as base64 UTF-16, and getting that wrong looks exactly
// like an empty clipboard.
func TestClipboardReadsAFileFromIt(t *testing.T) {
	if os.Getenv("OPENMEET_CLIPBOARD_TEST") == "" {
		t.Skip("set OPENMEET_CLIPBOARD_TEST=1 to run this on a machine with a desktop")
	}
	dir := t.TempDir()
	path := filepath.Join(dir, "clipped.txt")
	if err := os.WriteFile(path, []byte("hello"), 0o644); err != nil {
		t.Fatal(err)
	}
	set := `Add-Type -AssemblyName System.Windows.Forms
$c = New-Object System.Collections.Specialized.StringCollection
$c.Add('` + path + `') | Out-Null
[Windows.Forms.Clipboard]::SetFileDropList($c)`
	cmd := exec.Command(powershell(), "-NoProfile", "-NonInteractive", "-STA", "-EncodedCommand", encodeUTF16(set))
	if out, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("could not put a file on the clipboard: %v\n%s", err, out)
	}
	got, err := clipboardFile()
	if err != nil {
		t.Fatal(err)
	}
	if got != path {
		t.Fatalf("clipboard gave %q, want %q", got, path)
	}
}
