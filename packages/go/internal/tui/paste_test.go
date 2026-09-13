package tui

import (
	"strings"
	"testing"
	"time"

	tea "github.com/charmbracelet/bubbletea"
)

// A frame is a grid: as many rows as the canvas is tall, and not one newline more. Anything
// that can put a newline into a cell can shift the whole screen, so this is the invariant
// worth stating on its own.
func assertIntactFrame(t *testing.T, m *Model) {
	t.Helper()
	out := m.View()
	if got, want := strings.Count(out, "\n"), m.height-1; got != want {
		t.Fatalf("the frame carries %d newlines, want %d — something wrote one into a cell", got, want)
	}
	for i, line := range strings.Split(m.frame.Text(), "\n") {
		if Width(line) > m.width {
			t.Fatalf("row %d is %d cells wide on a canvas of %d", i, Width(line), m.width)
		}
	}
}

// Pasting into the composer. Bracketed paste hands the whole clipboard over as one key
// message with every rune in it, newlines and all.
func TestPastingMultipleLinesIntoTheComposer(t *testing.T) {
	m, _ := inRoom(t, []ChatEntry{{At: time.Now(), Kind: KindMessage, Who: "ana", Text: "hola"}}, nil)
	m.rs.InputFocused = true
	m.Update(tea.KeyMsg{Type: tea.KeyRunes, Paste: true, Runes: []rune("uno\ndos\ttres\r\ncuatro")})
	assertIntactFrame(t, m)
	if strings.ContainsAny(m.draft.value, "\n\r\t") {
		t.Errorf("the draft kept a control character: %q", m.draft.value)
	}
	if want := "uno dos tres cuatro"; m.draft.value != want {
		t.Errorf("the draft reads %q, want %q", m.draft.value, want)
	}
}

// The same defence has to hold for text this client did not type: a message from another
// client is data, and a newline in one would otherwise redraw everyone's screen wrong.
func TestAMessageFromAPeerCannotBreakTheFrame(t *testing.T) {
	m, _ := inRoom(t, nil, nil)
	m.Update(Line{At: time.Now(), Kind: KindMessage, Who: "ana", Text: "hola\nmundo\x1b[2J"})
	assertIntactFrame(t, m)
	m.Update(DebugLine{At: time.Now(), Text: "pump\nlate"})
	m.rs.Debug = true
	m.rs.DebugLines = m.debugLines
	assertIntactFrame(t, m)
}

// And the canvas itself refuses one, whoever hands it over: it is the last place a control
// character can be stopped before it is in the frame.
func TestTheCanvasNeverHoldsAControlCharacter(t *testing.T) {
	c := NewCanvas(20, 3)
	c.Put(0, 0, "a\nb\tc\x00d", Plain, 0)
	if strings.Count(c.Render(), "\n") != 2 {
		t.Error("a control character reached the rendered frame")
	}
	if strings.ContainsAny(c.Text(), "\n\t\x00") && strings.Count(c.Text(), "\n") != 2 {
		t.Error("a control character is sitting in a cell")
	}
}

// Pasting into the other fields this interface has, which take text the same way.
func TestPastingIntoTheJoinAndNameFields(t *testing.T) {
	m := New(Host{Settings: &fakeStore{mouse: true}, Devices: fakeDevices{}})
	m.width, m.height = 120, 34
	m.Update(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune("j")})
	m.Update(tea.KeyMsg{Type: tea.KeyRunes, Paste: true, Runes: []rune("sala\nrota")})
	assertIntactFrame(t, m)
	if strings.ContainsAny(m.joinField.value, "\n\r\t") {
		t.Errorf("the join field kept a control character: %q", m.joinField.value)
	}
}
