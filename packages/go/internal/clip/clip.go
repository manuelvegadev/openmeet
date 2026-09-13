// Package clip puts text on the clipboard, by the two routes a terminal application has and
// for the two places it can be running.
//
// OSC 52 is an escape sequence: the text goes to the terminal, and the terminal puts it on
// the clipboard of the machine a person is actually sitting at. That is the only route that
// works over SSH — and this client is developed with one end on a Windows box over ssh — so
// it is always taken. Apple's Terminal is the one terminal in our matrix that ignores it;
// everything else here (Ghostty, iTerm2 with clipboard access allowed, Windows Terminal,
// WezTerm, kitty, Alacritty) takes it.
//
// The platform's own tool — pbcopy, PowerShell, wl-copy/xclip/xsel — is the other route, and
// it is taken only when the session is local, because on a remote machine it would put the
// text on a clipboard nobody is looking at. Between the two, every terminal we support is
// covered: Terminal.app by pbcopy, an SSH session by OSC 52.
package clip

import (
	"encoding/base64"
	"io"
	"os"
	"os/exec"
	"runtime"
	"strings"
	"sync"
)

// How the text got there, for the line the interface shows afterwards.
const (
	ViaNone     = ""
	ViaSystem   = "clipboard"
	ViaTerminal = "terminal"
)

var (
	mu   sync.Mutex
	term io.Writer
)

// Terminal is where OSC 52 is written. It must be the same writer the renderer draws
// through, so the sequence cannot land inside a frame: see the writer in cmd/openmeet.
// Without it nothing is written, which is deliberate — an escape sequence sent to a pipe is
// base64 printed into whatever is reading.
func Terminal(w io.Writer) {
	mu.Lock()
	defer mu.Unlock()
	term = w
}

// Remote is true when this process is not on the machine the person is sitting at.
func Remote() bool {
	return os.Getenv("SSH_TTY") != "" || os.Getenv("SSH_CONNECTION") != ""
}

// The ceiling on an OSC 52 payload. Terminals differ on what they will take and some say
// nothing when they refuse; a selection from a conversation is never near this.
const maxOSC = 64 * 1024

// Set puts text on the clipboard and says which route carried it.
func Set(text string) string {
	if text == "" {
		return ViaNone
	}
	via := ViaNone
	if writeOSC(text) {
		via = ViaTerminal
	}
	if !Remote() && writeSystem(text) {
		via = ViaSystem
	}
	return via
}

func writeOSC(text string) bool {
	enc := base64.StdEncoding.EncodeToString([]byte(text))
	if len(enc) > maxOSC {
		return false
	}
	mu.Lock()
	w := term
	mu.Unlock()
	if w == nil {
		return false
	}
	_, err := io.WriteString(w, "\x1b]52;c;"+enc+"\a")
	return err == nil
}

func writeSystem(text string) bool {
	name, args, stdin := systemCmd(text)
	if name == "" {
		return false
	}
	c := exec.Command(name, args...)
	if stdin {
		c.Stdin = strings.NewReader(text)
	}
	return c.Run() == nil
}

// systemCmd is the platform's clipboard tool. Windows goes through PowerShell with the text
// base64'd into the command rather than down a pipe, because what a pipe into clip.exe means
// depends on the console code page and a name with an accent in it comes out wrong.
func systemCmd(text string) (string, []string, bool) {
	switch runtime.GOOS {
	case "darwin":
		return "pbcopy", nil, true
	case "windows":
		enc := base64.StdEncoding.EncodeToString([]byte(text))
		script := "Set-Clipboard -Value ([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('" + enc + "')))"
		return "powershell", []string{"-NoProfile", "-NonInteractive", "-Command", script}, false
	}
	if os.Getenv("WAYLAND_DISPLAY") != "" {
		if p, err := exec.LookPath("wl-copy"); err == nil {
			return p, nil, true
		}
	}
	if os.Getenv("DISPLAY") != "" {
		if p, err := exec.LookPath("xclip"); err == nil {
			return p, []string{"-selection", "clipboard"}, true
		}
		if p, err := exec.LookPath("xsel"); err == nil {
			return p, []string{"--clipboard", "--input"}, true
		}
	}
	return "", nil, false
}
