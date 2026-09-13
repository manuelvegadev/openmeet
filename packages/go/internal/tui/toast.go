package tui

import (
	"time"

	tea "github.com/charmbracelet/bubbletea"
)

// A toast is one line of transient feedback, drawn on the notice row the room already keeps
// over the composer. It costs two repaints — one to appear, one to go — because it carries
// no countdown and nothing in it changes while it is up (gotcha 24).
//
// What earns one: something you did here whose only other confirmation is a chip's label
// changing, or a failure. What does not: anything the room log already records for everyone,
// which is where a room's history belongs and where it stays.

const toastMs = 3000

type toastMsg struct{ gen int }

func toastMark(kind string) string {
	switch kind {
	case "warn":
		return "! "
	case "info":
		return "· "
	}
	return "✓ "
}

func toastStyle(kind string) Style {
	switch kind {
	case "warn":
		return Style{FG: ThemeWarn}
	case "info":
		return Style{FG: ThemeInfo}
	}
	return Style{FG: ThemeOK}
}

// Toast is an engine event: something happened out there worth saying here. The interface
// raises its own for what it did itself; this is for what it could not have known.
type Toast struct {
	Text string
	Kind string
}

// toast puts one up and arms the timer that takes it down. Generations, like the blink and
// the armed keys, so a toast replaced early is not cleared by the timer of the one before.
func (m *Model) toast(kind, text string) tea.Cmd {
	m.toastText, m.toastKind = text, kind
	m.toastGen++
	gen := m.toastGen
	return tea.Tick(toastMs*time.Millisecond, func(time.Time) tea.Msg { return toastMsg{gen} })
}
