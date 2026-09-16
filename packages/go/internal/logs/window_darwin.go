package logs

import (
	"fmt"
	"os"
	"os/exec"
	"strings"
)

func openWindow(exe string) error {
	switch os.Getenv("TERM_PROGRAM") {
	case "ghostty":
		// Ghostty on macOS refuses to start from the CLI and says so in its own help:
		// `open -na` is the way, and `-e` is what it runs. Verified on this machine.
		return spawn("open", "-na", "Ghostty.app", "--args", "-e", exe, "--logs")
	case "Apple_Terminal":
		return osa(fmt.Sprintf(`tell application "Terminal"
			activate
			do script %s
		end tell`, quote(Command(exe))))
	case "iTerm.app":
		return osa(fmt.Sprintf(`tell application "iTerm"
			activate
			set w to (create window with default profile)
			tell current session of w to write text %s
		end tell`, quote(Command(exe))))
	case "WezTerm":
		return spawn("wezterm", "cli", "spawn", "--new-window", "--", exe, "--logs")
	}
	return fmt.Errorf("this terminal has no way to open a window from outside")
}

// quote is an AppleScript string literal.
func quote(s string) string {
	return `"` + strings.NewReplacer(`\`, `\\`, `"`, `\"`).Replace(s) + `"`
}

func osa(script string) error {
	cmd := exec.Command("osascript", "-e", script)
	if out, err := cmd.CombinedOutput(); err != nil {
		return fmt.Errorf("%v: %s", err, strings.TrimSpace(string(out)))
	}
	return nil
}
