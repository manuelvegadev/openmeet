package tui

import (
	"strings"
	"time"

	tea "github.com/charmbracelet/bubbletea"

	"github.com/manuelvegadev/openmeet/packages/go/internal/clip"
)

// The mouse. A click is answered by sending the key the thing under it already shows, so
// every button in this interface has exactly one behaviour and it lives in the key handler
// it always lived in. What the mouse adds is a way to reach it, and two things the keyboard
// could not do at all: a wheel that knows which pane it is over, and a selection of the
// conversation rather than of the screen.
//
// Mode 1002 (tea.WithMouseCellMotion) is what we ask the terminal for: presses, releases,
// the wheel, and motion only while a button is down. Nothing is reported while the pointer
// merely crosses the screen, so an idle window costs exactly what it did before — which is
// why there is no hover here.

const (
	wheelRows     = 3
	doubleClickMs = 500
)

type copiedMsg struct {
	lines int
	via   string
}

func (m *Model) mouse(e tea.MouseEvent) tea.Cmd {
	if m.frame == nil {
		return nil
	}
	if e.IsWheel() {
		return m.wheel(e)
	}
	if e.Button == tea.MouseButtonRight || e.Button == tea.MouseButtonMiddle {
		// Left to the terminal: middle-click paste and the context menu are its business.
		return nil
	}
	switch e.Action {
	case tea.MouseActionPress:
		return m.press(e)
	case tea.MouseActionMotion:
		return m.drag(e)
	case tea.MouseActionRelease:
		return m.release()
	}
	return nil
}

// ── the wheel ───────────────────────────────────────────────────────────────

func (m *Model) wheel(e tea.MouseEvent) tea.Cmd {
	d := wheelRows
	if e.Button == tea.MouseButtonWheelUp || e.Button == tea.MouseButtonWheelLeft {
		d = -wheelRows
	}
	a, ok := m.frame.HitTest(e.X, e.Y, ActScroll)
	if !ok {
		return nil
	}
	switch a.ID {
	case "chat":
		m.scroll(d)
	case "settings":
		m.settingsMove(d)
	default:
		if at, n := m.listCursor(a.ID); at != nil {
			*at = clampInt(*at+d, 0, max(0, n-1))
		}
	}
	return nil
}

// listCursor is where a list keeps its selection and how long the list is. The wheel and a
// click on a row both move the same thing, so both ask here rather than each keeping its own
// copy of the table — a new list is one line, not three.
func (m *Model) listCursor(id string) (*int, int) {
	switch id {
	case "peers":
		return &m.rs.SelectedPeer, len(m.rs.Peers)
	case "picker":
		return &m.pickerIdx, len(m.pickerItems)
	case "devices":
		return &m.devIdx, len(m.devItems)
	case "modal":
		return &m.modalIdx, len(m.modalItems)
	case "colors":
		return &m.profile.ColorIdx, len(NamePalette)
	}
	return nil, 0
}

// ── pressing things ─────────────────────────────────────────────────────────

func (m *Model) press(e tea.MouseEvent) tea.Cmd {
	// Text first, but only inside a text region: that is the one place a press means
	// something other than pressing a thing.
	if a, ok := m.frame.HitTest(e.X, e.Y, ActText); ok {
		if row, ok := m.frame.TextAt(a.ID, e.Y); ok {
			return m.pressText(e, a.ID, row)
		}
		m.sel.clear()
		return nil
	}
	m.sel.clear()
	if a, ok := m.frame.HitTest(e.X, e.Y, ActKey); ok {
		return m.sendKey(a.Key)
	}
	if a, ok := m.frame.HitTest(e.X, e.Y, ActRow); ok {
		return m.pickRow(a)
	}
	if a, ok := m.frame.HitTest(e.X, e.Y, ActTab); ok {
		return m.pickTab(a.Idx)
	}
	if a, ok := m.frame.HitTest(e.X, e.Y, ActFocus); ok {
		return m.focus(a.ID)
	}
	return nil
}

// sendKey runs the key a chip shows through the ordinary key handler, which is the whole
// trick: a click cannot drift from what the key does because it *is* what the key does.
func (m *Model) sendKey(key string) tea.Cmd {
	msg, ok := keyMsg(key)
	if !ok {
		return nil
	}
	_, cmd := m.Update(msg)
	return cmd
}

func keyMsg(key string) (tea.KeyMsg, bool) {
	switch key {
	case "tab":
		return tea.KeyMsg{Type: tea.KeyTab}, true
	case "esc":
		return tea.KeyMsg{Type: tea.KeyEsc}, true
	case "enter":
		return tea.KeyMsg{Type: tea.KeyEnter}, true
	case "up":
		return tea.KeyMsg{Type: tea.KeyUp}, true
	case "down":
		return tea.KeyMsg{Type: tea.KeyDown}, true
	case "left":
		return tea.KeyMsg{Type: tea.KeyLeft}, true
	case "right":
		return tea.KeyMsg{Type: tea.KeyRight}, true
	}
	if r := []rune(key); len(r) == 1 {
		return tea.KeyMsg{Type: tea.KeyRunes, Runes: r}, true
	}
	return tea.KeyMsg{}, false
}

// pickRow: a list of choices is picked and confirmed by one click, because it is a question
// with an Escape on it. A settings row is only picked, and acted on by the next click — the
// first one is how you bring its line of help up, which is what you came to read.
func (m *Model) pickRow(a Action) tea.Cmd {
	if a.ID == "settings" {
		if a.Idx == m.settingsIdx {
			return m.sendKey("enter")
		}
		m.settingsIdx = a.Idx
		return nil
	}
	at, n := m.listCursor(a.ID)
	if at == nil {
		return nil
	}
	*at = clampInt(a.Idx, 0, max(0, n-1))
	if a.ID == "peers" {
		// Reaching for a participant is working the controls, which is what tab does.
		m.rs.InputFocused = false
	}
	if a.Go {
		return m.sendKey("enter")
	}
	return nil
}

func (m *Model) pickTab(idx int) tea.Cmd {
	rows := m.host.Settings.Rows()
	tabs := settingsTabs(rows)
	if idx < 0 || idx >= len(tabs) {
		return nil
	}
	m.settingsTab = idx
	m.settingsIdx = firstOfTab(rows, tabs, idx)
	return nil
}

func (m *Model) focus(id string) tea.Cmd {
	if m.screen != screenRoom {
		return nil
	}
	want := id == "input"
	if m.rs.InputFocused == want {
		return nil
	}
	m.rs.InputFocused = want
	if want {
		return m.blink()
	}
	return nil
}

// settingsMove walks the rows of the tab being shown and nothing else, the way ↑↓ do.
func (m *Model) settingsMove(delta int) {
	rows := m.host.Settings.Rows()
	m.settingsMoveIn(rows, settingsTabs(rows), delta)
}

// settingsMoveIn is the same, for a caller that has already built the rows: Rows() allocates
// every choice list it describes, and a wheel over the settings would otherwise rebuild the
// lot once per notch.
func (m *Model) settingsMoveIn(rows []SettingsRow, tabs []string, delta int) {
	tab := min(m.settingsTab, max(0, len(tabs)-1))
	if tab >= len(tabs) {
		return
	}
	visible := RowsForTab(rows, tabs[tab])
	if len(visible) == 0 {
		return
	}
	at := 0
	for i, idx := range visible {
		if idx == m.settingsIdx {
			at = i
		}
	}
	m.settingsIdx = visible[clampInt(at+delta, 0, len(visible)-1)]
}

// ── selecting the conversation ──────────────────────────────────────────────

func (m *Model) pressText(e tea.MouseEvent, region string, row TextRow) tea.Cmd {
	p := row.PosAt(e.X)
	now := time.Now()
	if now.Sub(m.lastClick) < doubleClickMs*time.Millisecond && m.lastClickPos == p && m.lastClickRegion == region {
		m.clickCount++
	} else {
		m.clickCount = 1
	}
	m.lastClick, m.lastClickPos, m.lastClickRegion = now, p, region
	m.sel = selection{active: true, region: region, anchor: p, cursor: p, dragging: true}
	if region == "input" {
		// The caret goes where the pointer went, which is the whole of what a click in a
		// text field means; the focus follows it so the next key lands here.
		m.draft.cursor = clampInt(p.Off, 0, m.draft.length())
		m.rs.InputFocused = true
	}
	switch m.clickCount {
	case 2:
		m.sel.unit = "word"
	case 3:
		m.sel.unit = "line"
		m.clickCount = 0
	}
	m.extend(p)
	return nil
}

func (m *Model) drag(e tea.MouseEvent) tea.Cmd {
	if !m.sel.dragging {
		return nil
	}
	rows := m.frame.TextRows(m.sel.region)
	if len(rows) == 0 {
		return nil
	}
	first, last := rows[0], rows[len(rows)-1]
	switch {
	case e.Y < first.Y:
		// Off the top: keep going, and pull the log with it.
		m.extend(TextPos{first.Src, first.Off})
		if m.sel.region == "chat" {
			m.scroll(-1)
		}
	case e.Y > last.Y:
		m.extend(TextPos{last.Src, last.Off + rowRunes(last)})
		if m.sel.region == "chat" {
			m.scroll(1)
		}
	default:
		if row, ok := m.frame.TextAt(m.sel.region, e.Y); ok {
			m.extend(row.PosAt(e.X))
			if m.sel.region == "input" {
				m.draft.cursor = clampInt(m.sel.cursor.Off, 0, m.draft.length())
			}
		}
	}
	return nil
}

func rowRunes(row TextRow) int {
	n := 0
	for _, sp := range row.Spans {
		n += len([]rune(sp.Text))
	}
	return n
}

func (m *Model) release() tea.Cmd {
	if !m.sel.dragging {
		return nil
	}
	m.sel.dragging = false
	if m.sel.empty() {
		// A click that selected nothing is a click: put the selection away.
		m.sel.clear()
		return nil
	}
	if !m.host.Settings.CopyOnSelect() {
		// The selection stays up, and ctrl+c is what puts it on the clipboard. Copying on
		// release means every stray drag overwrites whatever someone was carrying.
		return nil
	}
	return m.copySelection()
}

// copySelection reads the selection now and hands the clipboard to a command, so spawning
// pbcopy or PowerShell happens off the thread that draws — and nowhere near the 20 ms pump.
func (m *Model) copySelection() tea.Cmd {
	text := m.SelectedText()
	if strings.TrimSpace(text) == "" {
		return nil
	}
	lines := strings.Count(text, "\n") + 1
	return func() tea.Msg { return copiedMsg{lines: lines, via: clip.Set(text)} }
}

// copyNow puts the selection on the clipboard and takes it down, or reports that there was
// nothing to copy — which is how ctrl+c knows whether it still means leaving the room.
func (m *Model) copyNow() tea.Cmd {
	if m.sel.empty() {
		return nil
	}
	cmd := m.copySelection()
	m.sel.clear()
	return cmd
}

func (m *Model) copied(msg copiedMsg) tea.Cmd {
	if msg.via == clip.ViaNone {
		return m.toast("warn", "Nothing could reach the clipboard from here")
	}
	what := "Copied 1 line"
	if msg.lines > 1 {
		what = "Copied " + itoa(msg.lines) + " lines"
	}
	if msg.via == clip.ViaTerminal {
		// Worth saying: this is the route that carries a copy home over SSH, and the route
		// a terminal can be configured to refuse.
		what += " · sent to your terminal"
	}
	return m.toast("ok", what)
}
