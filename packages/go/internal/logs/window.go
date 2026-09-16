package logs

import (
	"fmt"
	"os"
	"os/exec"
	"strings"
)

// Opening the log in a window of its own.
//
// It never picks a terminal for you — the installers deliberately register nothing for the
// same reason. It asks which one you are already in and uses that; every terminal exposes a
// different way in, and several expose none, so a terminal it does not know is not a failure
// but a command to paste. The table will age: treat an unknown answer as normal.
//
// Over SSH there is no local window at all, and the caller knows it (clip.Remote).

// Command is what to run in the window, and what to hand somebody when we cannot open one.
func Command(exe string) string {
	if strings.ContainsAny(exe, " \t") {
		return `"` + exe + `" --logs`
	}
	return exe + " --logs"
}

// Terminal is what this session is running in, as a name worth showing.
func Terminal() string {
	if os.Getenv("WT_SESSION") != "" {
		return "Windows Terminal"
	}
	switch os.Getenv("TERM_PROGRAM") {
	case "ghostty":
		return "Ghostty"
	case "Apple_Terminal":
		return "Terminal"
	case "iTerm.app":
		return "iTerm"
	case "WezTerm":
		return "WezTerm"
	case "vscode":
		return "Visual Studio Code"
	}
	return ""
}

// OpenWindow opens a new window of this terminal following the log. The error names the
// command when it cannot, so the caller can offer it instead.
func OpenWindow(exe string) error {
	if err := openWindow(exe); err != nil {
		return fmt.Errorf("%w — run %s yourself", err, Command(exe))
	}
	return nil
}

func spawn(name string, args ...string) error {
	cmd := exec.Command(name, args...)
	if err := cmd.Start(); err != nil {
		return err
	}
	go cmd.Wait()
	return nil
}
