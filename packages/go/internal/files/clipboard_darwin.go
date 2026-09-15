package files

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"
)

// AppleScript rather than AppKit: reading NSPasteboard would mean linking AppKit into a
// terminal process and touching it off the main thread, for something that happens once when
// a key is pressed. osascript is already on every Mac and costs a subprocess.

func clipboardFile() (string, error) {
	// A file copied in the Finder is a reference; send that file, not a copy of its bytes.
	if out, err := osa(`POSIX path of (the clipboard as «class furl»)`); err == nil {
		if p := strings.TrimSpace(out); p != "" {
			if _, err := os.Stat(p); err == nil {
				return p, nil
			}
		}
	}
	dst := filepath.Join(os.TempDir(), fmt.Sprintf("openmeet-clip-%d.png", time.Now().Unix()))
	// A screenshot is on the clipboard as TIFF, and often as PNG as well. Ask for PNG first
	// because that is what anyone wants to receive; fall back through sips, which is standard.
	if _, err := osa(writeScript(dst, "«class PNGf»")); err == nil {
		if _, err := os.Stat(dst); err == nil {
			return dst, nil
		}
	}
	tiff := strings.TrimSuffix(dst, ".png") + ".tiff"
	if _, err := osa(writeScript(tiff, "«class TIFF»")); err != nil {
		return "", nil
	}
	if _, err := os.Stat(tiff); err != nil {
		return "", nil
	}
	if err := exec.Command("sips", "-s", "format", "png", tiff, "--out", dst).Run(); err == nil {
		if _, err := os.Stat(dst); err == nil {
			os.Remove(tiff)
			return dst, nil
		}
	}
	return tiff, nil
}

func writeScript(path, class string) string {
	return `set d to (the clipboard as ` + class + `)
set f to open for access (POSIX file "` + path + `") with write permission
set eof f to 0
write d to f
close access f`
}

func osa(script string) (string, error) {
	out, err := exec.Command("osascript", "-e", script).Output()
	return string(out), err
}
