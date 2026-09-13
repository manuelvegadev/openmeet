package clip

import (
	"bytes"
	"strings"
	"testing"
)

// Every test here forces a remote session, which is also the one case that matters most:
// the client is developed with one end on a Windows box over ssh, and OSC 52 is the only
// route that puts a copy on the clipboard of the machine the person is sitting at.
func remoteSession(t *testing.T) *bytes.Buffer {
	t.Helper()
	t.Setenv("SSH_TTY", "/dev/ttys000")
	buf := &bytes.Buffer{}
	Terminal(buf)
	t.Cleanup(func() { Terminal(nil) })
	return buf
}

func TestOSC52CarriesTheTextThroughTheTerminal(t *testing.T) {
	buf := remoteSession(t)
	if via := Set("hola"); via != ViaTerminal {
		t.Errorf("via = %q, want %q", via, ViaTerminal)
	}
	// OSC 52, the system clipboard, base64, terminated by BEL.
	if got, want := buf.String(), "\x1b]52;c;aG9sYQ==\a"; got != want {
		t.Errorf("wrote %q, want %q", got, want)
	}
}

// Without a writer nothing is written at all, which is the point: an escape sequence sent to
// a pipe is base64 printed into whatever is reading it.
func TestNoTerminalMeansNoEscape(t *testing.T) {
	t.Setenv("SSH_TTY", "/dev/ttys000")
	Terminal(nil)
	if via := Set("hola"); via != ViaNone {
		t.Errorf("via = %q, want nothing", via)
	}
}

func TestAHugeSelectionIsNotSentAsAnEscape(t *testing.T) {
	buf := remoteSession(t)
	Set(strings.Repeat("x", maxOSC))
	if buf.Len() != 0 {
		t.Errorf("wrote %d bytes for a payload past the ceiling", buf.Len())
	}
}

func TestEmptyCopiesNothing(t *testing.T) {
	buf := remoteSession(t)
	if via := Set(""); via != ViaNone || buf.Len() != 0 {
		t.Errorf("an empty selection wrote %q and reported %q", buf.String(), via)
	}
}
