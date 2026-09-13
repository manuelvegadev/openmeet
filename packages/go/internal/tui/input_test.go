package tui

import (
	"strings"
	"testing"
	"time"

	tea "github.com/charmbracelet/bubbletea"
)

// The composer as a text field: a caret you can put anywhere, a selection you can make with
// the pointer, and the edits that a selection changes the meaning of.

func composing(t *testing.T, text string, cursor int) *Model {
	t.Helper()
	m, _ := inRoom(t, []ChatEntry{{At: time.Now(), Kind: KindMessage, Who: "ana", Text: "hola"}}, nil)
	m.rs.InputFocused = true
	m.draft = textField{value: text, cursor: cursor}
	m.View()
	return m
}

// inputRow is the composer's first marked row, and where a given rune sits on screen.
func inputRow(t *testing.T, m *Model) TextRow {
	t.Helper()
	rows := m.frame.TextRows("input")
	if len(rows) == 0 {
		t.Fatal("the composer marked no text")
	}
	return rows[0]
}

func key(m *Model, k tea.KeyType) { m.Update(tea.KeyMsg{Type: k}) }

// ── the caret ───────────────────────────────────────────────────────────────

func TestClickingInTheDraftMovesTheCaret(t *testing.T) {
	m := composing(t, "hola mundo", 10)
	row := inputRow(t, m)
	click(m, row.X+5, row.Y) // the sixth cell: "hola |mundo"
	if m.draft.cursor != 5 {
		t.Errorf("caret at %d, want 5", m.draft.cursor)
	}
	// Past the end of the text the caret lands after the last rune, not beyond it.
	click(m, row.X+40, row.Y)
	if m.draft.cursor != 10 {
		t.Errorf("a click past the end put the caret at %d, want 10", m.draft.cursor)
	}
}

func TestClickingTheDraftAlsoFocusesIt(t *testing.T) {
	m := composing(t, "hola", 4)
	m.rs.InputFocused = false
	m.View()
	row := inputRow(t, m)
	click(m, row.X+2, row.Y)
	if !m.rs.InputFocused {
		t.Error("clicking the draft did not focus the composer")
	}
}

// ── selecting ───────────────────────────────────────────────────────────────

func dragInDraft(m *Model, row TextRow, from, to int) {
	// Each call is a gesture of its own: without this, two drags from the same cell in the
	// same test are a double click, which is a different thing and would be right to be.
	m.lastClick = time.Time{}
	click(m, row.X+from, row.Y)
	m.mouse(tea.MouseEvent{X: row.X + to, Y: row.Y, Action: tea.MouseActionMotion, Button: tea.MouseButtonLeft})
	m.mouse(tea.MouseEvent{X: row.X + to, Y: row.Y, Action: tea.MouseActionRelease, Button: tea.MouseButtonLeft})
}

// Two clicks in the same place are a double click, and that selects the word under them.
func TestDoubleClickingTheDraftSelectsAWord(t *testing.T) {
	m := composing(t, "hola mundo entero", 17)
	row := inputRow(t, m)
	click(m, row.X+6, row.Y)
	click(m, row.X+6, row.Y)
	if got := m.SelectedText(); got != "mundo" {
		t.Errorf("double click selected %q, want %q", got, "mundo")
	}
}

func TestDraggingInTheDraftSelectsIt(t *testing.T) {
	m := composing(t, "hola mundo", 10)
	dragInDraft(m, inputRow(t, m), 0, 4)
	from, to, ok := m.draftSelection()
	if !ok {
		t.Fatal("the drag selected nothing")
	}
	if from != 0 || to != 4 {
		t.Errorf("selected [%d,%d), want [0,4)", from, to)
	}
	if got := m.SelectedText(); got != "hola" {
		t.Errorf("the selection reads %q, want %q", got, "hola")
	}
}

func TestBackspaceDeletesTheSelection(t *testing.T) {
	m := composing(t, "hola mundo", 10)
	dragInDraft(m, inputRow(t, m), 0, 5) // "hola "
	key(m, tea.KeyBackspace)
	if m.draft.value != "mundo" {
		t.Errorf("draft is %q, want %q", m.draft.value, "mundo")
	}
	if m.draft.cursor != 0 {
		t.Errorf("caret at %d, want 0", m.draft.cursor)
	}
	if !m.sel.empty() {
		t.Error("the selection outlived what it was selecting")
	}
}

func TestTypingOverASelectionReplacesIt(t *testing.T) {
	m := composing(t, "hola mundo", 10)
	dragInDraft(m, inputRow(t, m), 5, 10) // "mundo"
	m.Update(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune("gente")})
	if m.draft.value != "hola gente" {
		t.Errorf("draft is %q, want %q", m.draft.value, "hola gente")
	}
}

// A paste is one key event carrying everything, so it lands in the same place typing does —
// and so it replaces a selection for the same reason.
func TestPastingOverASelectionReplacesIt(t *testing.T) {
	m := composing(t, "hola mundo", 10)
	dragInDraft(m, inputRow(t, m), 0, 4)
	m.Update(tea.KeyMsg{Type: tea.KeyRunes, Paste: true, Runes: []rune("adios\namigo")})
	if want := "adios amigo mundo"; m.draft.value != want {
		t.Errorf("draft is %q, want %q", m.draft.value, want)
	}
}

func TestAnArrowCollapsesTheSelectionToItsEdge(t *testing.T) {
	m := composing(t, "hola mundo", 10)
	row := inputRow(t, m)
	dragInDraft(m, row, 2, 7)
	key(m, tea.KeyLeft)
	if m.draft.cursor != 2 || !m.sel.empty() {
		t.Errorf("left gave caret %d, selection empty=%v; want 2 and empty", m.draft.cursor, m.sel.empty())
	}
	dragInDraft(m, row, 2, 7)
	key(m, tea.KeyRight)
	if m.draft.cursor != 7 || !m.sel.empty() {
		t.Errorf("right gave caret %d, selection empty=%v; want 7 and empty", m.draft.cursor, m.sel.empty())
	}
}

func TestShiftArrowsGrowASelectionFromTheCaret(t *testing.T) {
	m := composing(t, "hola mundo", 10)
	key(m, tea.KeyShiftLeft)
	key(m, tea.KeyShiftLeft)
	if got := m.SelectedText(); got != "do" {
		t.Errorf("shift+left twice selected %q, want %q", got, "do")
	}
	key(m, tea.KeyShiftRight)
	if got := m.SelectedText(); got != "o" {
		t.Errorf("shift+right then selected %q, want %q", got, "o")
	}
}

// ── deleting by word ────────────────────────────────────────────────────────

// ctrl+h is what Windows Terminal sends for ctrl+backspace: measured on the real machine,
// where plain Backspace is 0x7f, so the two can never be confused for one another.
func TestCtrlHDeletesAWordToo(t *testing.T) {
	m := composing(t, "hola mundo entero", 17)
	key(m, tea.KeyCtrlH)
	if m.draft.value != "hola mundo " {
		t.Errorf("ctrl+h gave %q, want %q", m.draft.value, "hola mundo ")
	}
	// And a plain backspace is still a plain backspace.
	m2 := composing(t, "hola", 4)
	key(m2, tea.KeyBackspace)
	if m2.draft.value != "hol" {
		t.Errorf("backspace gave %q, want %q", m2.draft.value, "hol")
	}
}

func TestCtrlWDeletesTheWordBehindTheCaret(t *testing.T) {
	cases := []struct{ in, want string }{
		{"hola mundo entero", "hola mundo "},
		{"hola mundo ", "hola "},
		{"hola", ""},
		{"", ""},
	}
	for _, c := range cases {
		m := composing(t, c.in, len([]rune(c.in)))
		key(m, tea.KeyCtrlW)
		if m.draft.value != c.want {
			t.Errorf("ctrl+w on %q gave %q, want %q", c.in, m.draft.value, c.want)
		}
	}
}

// What Ghostty sends for cmd+backspace, and what ctrl+u has always meant.
func TestCtrlUDeletesBackToTheStart(t *testing.T) {
	m := composing(t, "hola mundo entero", 10)
	key(m, tea.KeyCtrlU)
	if m.draft.value != " entero" {
		t.Errorf("draft is %q, want %q", m.draft.value, " entero")
	}
	if m.draft.cursor != 0 {
		t.Errorf("caret at %d, want 0", m.draft.cursor)
	}
}

// option+← and option+→ reach a terminal application as alt+b and alt+f.
func TestOptionArrowsMoveByWord(t *testing.T) {
	m := composing(t, "hola mundo entero", 17)
	m.Update(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune("b"), Alt: true})
	if m.draft.cursor != 11 {
		t.Errorf("alt+b put the caret at %d, want 11", m.draft.cursor)
	}
	m.Update(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune("f"), Alt: true})
	if m.draft.cursor != 17 {
		t.Errorf("alt+f put the caret at %d, want 17", m.draft.cursor)
	}
}

// ctrl+a is select all, which is what it means everywhere else — and on Windows, where it
// reaches the application, it is what anyone pressing it expects.
func TestCtrlASelectsTheWholeDraft(t *testing.T) {
	m := composing(t, "hola mundo entero", 5)
	key(m, tea.KeyCtrlA)
	if got := m.SelectedText(); got != "hola mundo entero" {
		t.Errorf("ctrl+a selected %q, want the whole draft", got)
	}
	if m.draft.cursor != 17 {
		t.Errorf("the caret is at %d, want the end", m.draft.cursor)
	}
	// And what is selected is what the next thing typed replaces.
	m.Update(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune("otra cosa")})
	if m.draft.value != "otra cosa" {
		t.Errorf("typing over ctrl+a gave %q", m.draft.value)
	}
	// On an empty draft it selects nothing rather than an empty range.
	m2 := composing(t, "", 0)
	key(m2, tea.KeyCtrlA)
	if !m2.sel.empty() {
		t.Error("ctrl+a on an empty draft made a selection")
	}
}

// ── copying, and what it is drawn like ──────────────────────────────────────

func TestCopyingTheDraftSelection(t *testing.T) {
	m := composing(t, "hola mundo", 10)
	dragInDraft(m, inputRow(t, m), 5, 10)
	m.Update(Copy{})
	if !m.sel.empty() {
		t.Error("the selection stayed up after being copied")
	}
	if m.draft.value != "hola mundo" {
		t.Error("copying changed the draft")
	}
}

func TestTheDraftSelectionIsPainted(t *testing.T) {
	m := composing(t, "hola mundo", 10)
	row := inputRow(t, m)
	dragInDraft(m, row, 0, 4)
	m.View()
	if got := m.frame.StyleAt(row.X, row.Y).BG; got != ThemeSelection {
		t.Errorf("the first selected cell has background %q", got)
	}
	if got := m.frame.StyleAt(row.X+6, row.Y).BG; got == ThemeSelection {
		t.Error("a cell outside the selection was painted")
	}
}

// A selection that spans the rows a long draft wrapped onto is still one range of the one
// line the draft is.
func TestSelectingAcrossTheWrappedDraft(t *testing.T) {
	text := strings.TrimSpace(strings.Repeat("palabra ", 20))
	m := composing(t, text, len([]rune(text)))
	rows := m.frame.TextRows("input")
	if len(rows) < 2 {
		t.Fatalf("the draft wrapped onto %d rows; the test needs more", len(rows))
	}
	first, last := rows[0], rows[len(rows)-1]
	click(m, first.X, first.Y)
	m.mouse(tea.MouseEvent{X: last.X + 400, Y: last.Y, Action: tea.MouseActionMotion, Button: tea.MouseButtonLeft})
	got := m.SelectedText()
	if strings.Contains(got, "\n") {
		t.Error("the draft's selection came back with a line break in it")
	}
	if !strings.HasSuffix(text, got) || len(got) < 10 {
		t.Errorf("selected %q, which is not the tail of the draft", got)
	}
}

// Windows sends a rune event carrying a NUL for the Ctrl key itself, immediately before every
// ctrl chord. Measured on the real machine: it used to be taken for typing, so it deleted the
// selection and ctrl+c then found nothing to copy and left the room instead.
func TestAKeyCarryingNothingPrintableIsNotTyping(t *testing.T) {
	m := composing(t, "copiame esto", 12)
	key(m, tea.KeyShiftLeft)
	key(m, tea.KeyShiftLeft)
	if m.SelectedText() != "to" {
		t.Fatalf("the selection is %q, want %q", m.SelectedText(), "to")
	}
	m.Update(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{0}})
	if m.draft.value != "copiame esto" {
		t.Errorf("a NUL changed the draft to %q", m.draft.value)
	}
	if m.SelectedText() != "to" {
		t.Errorf("a NUL took the selection away; it is now %q", m.SelectedText())
	}
	// And so ctrl+c still has something to copy, rather than leaving the room.
	_, cmd := m.Update(tea.KeyMsg{Type: tea.KeyCtrlC})
	if cmd == nil || m.quit {
		t.Error("ctrl+c quit instead of copying")
	}
}
