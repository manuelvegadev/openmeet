package logs

import (
	"fmt"
	"os"
	"path/filepath"
)

func openWindow(exe string) error {
	if os.Getenv("WT_SESSION") == "" {
		// The old console: a window, but not one this can steer.
		return fmt.Errorf("this console has no way to open a window from outside")
	}
	// Never by bare name (gotcha 21): a window opened from a shortcut inherits Explorer's
	// stale PATH, and wt.exe lives in the per-user WindowsApps folder.
	wt := filepath.Join(os.Getenv("LOCALAPPDATA"), "Microsoft", "WindowsApps", "wt.exe")
	if _, err := os.Stat(wt); err != nil {
		return fmt.Errorf("wt.exe is not where it should be")
	}
	return spawn(wt, "-w", "new", exe, "--logs")
}
