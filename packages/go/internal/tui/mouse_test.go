package tui

import (
	"strings"
	"testing"
	"time"

	tea "github.com/charmbracelet/bubbletea"
)

// ── the doubles ─────────────────────────────────────────────────────────────

type fakeStore struct {
	mouse    bool
	copyOnUp bool
	rows     []SettingsRow
	ran      []int
}

func (f *fakeStore) Name() string            { return "mvega" }
func (f *fakeStore) Color() string           { return "#A3E635" }
func (f *fakeStore) SetIdentity(_, _ string) {}
func (f *fakeStore) InputID() string         { return "" }
func (f *fakeStore) OutputID() string        { return "" }
func (f *fakeStore) CameraID() string        { return "" }
func (f *fakeStore) DevicesConfigured() bool { return true }
func (f *fakeStore) SetDevices(_, _ string)  {}
func (f *fakeStore) Mouse() bool             { return f.mouse }
func (f *fakeStore) CopyOnSelect() bool      { return f.copyOnUp }
func (f *fakeStore) SetCamera(_ string)      {}
func (f *fakeStore) Rows() []SettingsRow     { return f.rows }
func (f *fakeStore) Meters(_ string) []Meter { return nil }
func (f *fakeStore) Run(idx int) string      { f.ran = append(f.ran, idx); return "" }

type fakeDevices struct{}

func (fakeDevices) Inputs() []string                          { return nil }
func (fakeDevices) Outputs() []string                         { return nil }
func (fakeDevices) Label(n string) string                     { return n }
func (fakeDevices) IsBluetooth(string) bool                   { return false }
func (fakeDevices) EffectsSibling(string, []string) string    { return "" }
func (fakeDevices) StartMicTest(_, _ string) (MicTest, error) { return nil, nil }
func (fakeDevices) Resolve(saved string, _ []string) string   { return saved }

type fakeRoom struct {
	muted    bool
	sent     []string
	screens  []string
	stopped  bool
	shared   []string
	got      []string
	opened   [][2]string
	shareErr error
}

func (r *fakeRoom) ToggleMute()                        { r.muted = !r.muted }
func (r *fakeRoom) SendChat(t string)                  { r.sent = append(r.sent, t) }
func (r *fakeRoom) SetVolume(string, float64)          {}
func (r *fakeRoom) ToggleDebug()                       {}
func (r *fakeRoom) UpdateDevices(_, _ string) error    { return nil }
func (r *fakeRoom) StartScreen(id string) error        { r.screens = append(r.screens, id); return nil }
func (r *fakeRoom) StopScreen()                        { r.stopped = true }
func (r *fakeRoom) StartCamera(string) error           { return nil }
func (r *fakeRoom) StopCamera()                        {}
func (r *fakeRoom) TogglePeerWindow(_, _ string) error { return nil }
func (r *fakeRoom) ShareFile(path string) error {
	if r.shareErr != nil {
		return r.shareErr
	}
	r.shared = append(r.shared, path)
	return nil
}
func (r *fakeRoom) GetFile(id string) error { r.got = append(r.got, id); return nil }
func (r *fakeRoom) OpenFile(id, how string) error {
	r.opened = append(r.opened, [2]string{id, how})
	return nil
}
func (r *fakeRoom) Close() {}

// inRoom is a model sitting in a room, drawn once so it has a frame for the mouse to work on.
func inRoom(t *testing.T, entries []ChatEntry, peers []Peer) (*Model, *fakeRoom) {
	t.Helper()
	room := &fakeRoom{}
	m := New(Host{Settings: &fakeStore{mouse: true}, Devices: fakeDevices{}})
	m.width, m.height = 120, 34
	m.screen = screenRoom
	m.room = room
	m.rs = RoomState{Version: "0.6.0", Platform: "macOS", Room: "test", Connected: true,
		Anchor: -1, Entries: entries, Peers: peers, VideoEnabled: true}
	m.View()
	return m, room
}

// hotFor is where a registered action lives, so a test can click what the screen drew rather
// than a column somebody counted once.
func hotFor(c *Canvas, match func(Action) bool) (Rect, bool) {
	for i := len(c.hots) - 1; i >= 0; i-- {
		if match(c.hots[i].a) {
			return c.hots[i].r, true
		}
	}
	return Rect{}, false
}

// runeAt is the character a cell is showing, for reading a frame back.
func runeAt(c *Canvas, x, y int) rune {
	if r := c.cells[y][x].r; r != 0 {
		return r
	}
	return ' '
}

func click(m *Model, x, y int) tea.Cmd {
	return m.mouse(tea.MouseEvent{X: x, Y: y, Action: tea.MouseActionPress, Button: tea.MouseButtonLeft})
}

// ── the hit map ─────────────────────────────────────────────────────────────

// A click on a chip is the key the chip shows, and nothing else: the behaviour stays in the
// key handler, so there is only ever one of it.
func TestClickingAChipSendsItsKey(t *testing.T) {
	m, room := inRoom(t, nil, nil)
	m.rs.InputFocused = false
	m.View()
	r, ok := hotFor(m.frame, func(a Action) bool { return a.Kind == ActKey && a.Key == "m" })
	if !ok {
		t.Fatal("the mute chip registered nothing to click")
	}
	click(m, r.X+1, r.Y)
	if !room.muted {
		t.Error("clicking the mute chip did not mute")
	}
}

// A chip drawn disabled is drawn, and is not a button: the drawing already knew, so the hit
// map does not need telling twice.
func TestDisabledChipsAreNotClickable(t *testing.T) {
	m, _ := inRoom(t, nil, nil)
	m.rs.InputFocused = true // which greys the room's controls
	m.View()
	if _, ok := hotFor(m.frame, func(a Action) bool { return a.Kind == ActKey && a.Key == "m" }); ok {
		t.Error("a greyed chip is still registered as clickable")
	}
}

func TestClickingAPeerSelectsIt(t *testing.T) {
	peers := []Peer{{ID: "a", Name: "ana"}, {ID: "b", Name: "beto"}, {ID: "c", Name: "cris"}}
	m, _ := inRoom(t, nil, peers)
	r, ok := hotFor(m.frame, func(a Action) bool { return a.Kind == ActRow && a.ID == "peers" && a.Idx == 2 })
	if !ok {
		t.Fatal("no row registered for the third peer")
	}
	click(m, r.X+2, r.Y)
	if m.rs.SelectedPeer != 2 {
		t.Errorf("selected peer = %d, want 2", m.rs.SelectedPeer)
	}
	if m.rs.InputFocused {
		t.Error("clicking a peer should be working the controls, not the composer")
	}
}

// ── the wheel ───────────────────────────────────────────────────────────────

// The wheel belongs to the pane under the pointer, which is the thing the keyboard could
// never do: ↑↓ mean the log or the participants depending on where the focus is, and the
// pointer is already pointing at the answer.
func TestWheelScrollsThePaneUnderThePointer(t *testing.T) {
	var entries []ChatEntry
	for i := 0; i < 60; i++ {
		entries = append(entries, ChatEntry{At: time.Now(), Kind: KindMessage, Who: "ana", Text: "line"})
	}
	peers := []Peer{{ID: "a", Name: "ana"}, {ID: "b", Name: "beto"}}
	m, _ := inRoom(t, entries, peers)

	chat, ok := hotFor(m.frame, func(a Action) bool { return a.Kind == ActScroll && a.ID == "chat" })
	if !ok {
		t.Fatal("the log is not a scroll region")
	}
	m.mouse(tea.MouseEvent{X: chat.X + 2, Y: chat.Y + 2, Action: tea.MouseActionPress, Button: tea.MouseButtonWheelUp})
	if m.anchor == -1 {
		t.Error("the wheel over the log did not scroll it back")
	}
	if m.rs.SelectedPeer != 0 {
		t.Error("the wheel over the log moved the participant selection")
	}

	people, ok := hotFor(m.frame, func(a Action) bool { return a.Kind == ActScroll && a.ID == "peers" })
	if !ok {
		t.Fatal("the participants are not a scroll region")
	}
	m.mouse(tea.MouseEvent{X: people.X + 2, Y: people.Y, Action: tea.MouseActionPress, Button: tea.MouseButtonWheelDown})
	if m.rs.SelectedPeer != 1 {
		t.Errorf("the wheel over the participants gave selected = %d, want 1", m.rs.SelectedPeer)
	}
}

// ── the selection ───────────────────────────────────────────────────────────

// The point of owning the selection: a message that wrapped over several rows is one line,
// and comes back as the one line it is rather than as the rows it was drawn on.
func TestSelectingAWrappedMessageCopiesOneLine(t *testing.T) {
	long := strings.TrimSpace(strings.Repeat("una frase bastante larga que no cabe en una fila ", 4))
	entries := []ChatEntry{{At: time.Now(), Kind: KindMessage, Who: "ana", Color: "#A3E635", Text: long}}
	m, _ := inRoom(t, entries, nil)

	rows := m.frame.TextRows("chat")
	if len(rows) < 3 {
		t.Fatalf("the message was drawn on %d rows; the test needs it wrapped", len(rows))
	}
	first, last := rows[0], rows[len(rows)-1]
	click(m, first.X, first.Y)
	m.mouse(tea.MouseEvent{X: last.X + 200, Y: last.Y, Action: tea.MouseActionMotion, Button: tea.MouseButtonLeft})

	got := m.SelectedText()
	if strings.Contains(got, "\n") {
		t.Errorf("a wrapped message came back as %d lines:\n%q", strings.Count(got, "\n")+1, got)
	}
	if want := entryText(entries[0]); got != want {
		t.Errorf("copied\n %q\nwant\n %q", got, want)
	}
}

// And the other half of the point: what is copied is the conversation, never the frame it
// was drawn in. The pane of participants is not part of any selectable region at all.
func TestTheFrameIsNotSelectable(t *testing.T) {
	entries := []ChatEntry{{At: time.Now(), Kind: KindMessage, Who: "ana", Text: "hola"}}
	peers := []Peer{{ID: "a", Name: "beto"}}
	m, _ := inRoom(t, entries, peers)
	for _, row := range m.frame.TextRows("chat") {
		if row.X == 0 {
			t.Error("a selectable row starts on the frame's border")
		}
		if strings.Contains(PlainText(row.Spans), "beto") {
			t.Error("the participants pane is inside the selectable region")
		}
	}
	// Pressing on the border is not the start of a selection.
	click(m, 0, 10)
	if m.sel.active {
		t.Error("pressing the frame started a selection")
	}
}

// cellOf is where a given rune offset of an entry ended up on screen. A bubble draws the
// name on its top edge and the text on the rows under it, so a row no longer begins at
// offset zero — the row that carries the offset has to be found rather than assumed.
func cellOf(t *testing.T, m *Model, src, off int) (x, y int) {
	t.Helper()
	text := []rune(m.lineText(src))
	for _, r := range m.frame.TextRows("chat") {
		if r.Src != src {
			continue
		}
		n := rowRunes(r)
		if off >= r.Off && off < r.Off+n {
			return r.X + Width(string(text[r.Off:off])), r.Y
		}
	}
	t.Fatalf("offset %d of entry %d was not drawn", off, src)
	return 0, 0
}

func TestDoubleClickSelectsAWord(t *testing.T) {
	entries := []ChatEntry{{At: time.Now(), Kind: KindMessage, Who: "ana", Text: "hola mundo entero"}}
	m, _ := inRoom(t, entries, nil)
	// The cell where "mundo" starts, found in the text rather than counted by hand.
	text := entryText(entries[0])
	at := len([]rune(text[:strings.Index(text, "mundo")])) + 1
	x, y := cellOf(t, m, 0, at)

	click(m, x, y)
	click(m, x, y) // the second, inside the double-click window
	if got := m.SelectedText(); got != "mundo" {
		t.Errorf("double click selected %q, want %q", got, "mundo")
	}
}

func TestTripleClickSelectsTheWholeEntry(t *testing.T) {
	entries := []ChatEntry{{At: time.Now(), Kind: KindMessage, Who: "ana", Text: "hola mundo entero"}}
	m, _ := inRoom(t, entries, nil)
	row := m.frame.TextRows("chat")[0]
	for i := 0; i < 3; i++ {
		click(m, row.X+8, row.Y)
	}
	if got, want := m.SelectedText(), entryText(entries[0]); got != want {
		t.Errorf("triple click selected %q, want %q", got, want)
	}
}

// A key puts the selection away — it was made to be copied, and by then it has been.
func TestAKeyClearsTheSelection(t *testing.T) {
	entries := []ChatEntry{{At: time.Now(), Kind: KindMessage, Who: "ana", Text: "hola mundo"}}
	m, _ := inRoom(t, entries, nil)
	row := m.frame.TextRows("chat")[0]
	click(m, row.X, row.Y)
	m.mouse(tea.MouseEvent{X: row.X + 10, Y: row.Y, Action: tea.MouseActionMotion, Button: tea.MouseButtonLeft})
	if m.sel.empty() {
		t.Fatal("the drag selected nothing")
	}
	m.Update(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune("x")})
	if !m.sel.empty() {
		t.Error("a key left the selection up")
	}
}

// The selection is painted over the frame rather than into it, so a frame without one is
// exactly the frame that was drawn before any of this existed.
func TestSelectionPaintsOnlyTheSelectedCells(t *testing.T) {
	entries := []ChatEntry{{At: time.Now(), Kind: KindMessage, Who: "ana", Text: "hola mundo"}}
	m, _ := inRoom(t, entries, nil)
	row := m.frame.TextRows("chat")[0]
	click(m, row.X, row.Y)
	m.mouse(tea.MouseEvent{X: row.X + 4, Y: row.Y, Action: tea.MouseActionMotion, Button: tea.MouseButtonLeft})
	m.View()
	if got := m.frame.StyleAt(row.X, row.Y).BG; got != ThemeSelection {
		t.Errorf("the first selected cell has background %q, want the selection colour", got)
	}
	if got := m.frame.StyleAt(row.X+10, row.Y).BG; got == ThemeSelection {
		t.Error("a cell past the end of the selection was painted")
	}
	if got := m.frame.StyleAt(0, row.Y).BG; got == ThemeSelection {
		t.Error("the frame's border was painted as selected")
	}
}

// ── wrapping, which is what makes all of the above possible ─────────────────

func TestWrapOffsetsPointBackAtTheText(t *testing.T) {
	spans := []Span{{"[12:34] ", Muted}, {"› ", Plain}, {"[ana] ", Plain}, {"palabra otra ultima y mas texto aqui", Plain}}
	plain := []rune(PlainText(spans))
	lines, offs := WrapOffsets(spans, 20)
	if len(lines) != len(offs) {
		t.Fatalf("%d lines but %d offsets", len(lines), len(offs))
	}
	if offs[0] != 0 {
		t.Errorf("the first line starts at %d, want 0", offs[0])
	}
	for i, line := range lines {
		text := PlainText(line)
		if text == "" {
			continue
		}
		first := []rune(text)[0]
		if offs[i] >= len(plain) {
			t.Fatalf("line %d claims offset %d, past the end of %d runes", i, offs[i], len(plain))
		}
		if plain[offs[i]] != first {
			t.Errorf("line %d starts with %q but its offset %d points at %q", i, first, offs[i], plain[offs[i]])
		}
	}
}

// ── the toast ───────────────────────────────────────────────────────────────

func TestToastUsesTheNoticeRowAndGoesAway(t *testing.T) {
	m, _ := inRoom(t, nil, nil)
	m.toast("ok", "Sharing your screen")
	m.View()
	if !strings.Contains(m.frame.Text(), "Sharing your screen") {
		t.Error("the toast was not drawn")
	}
	// The timer's own message, rather than the command that sleeps for three seconds first.
	m.Update(toastMsg{gen: m.toastGen})
	m.View()
	if strings.Contains(m.frame.Text(), "Sharing your screen") {
		t.Error("the toast stayed up past its timer")
	}
}

// A toast replaced before its timer runs out is not taken down by the timer of the one it
// replaced — the same generation rule the blinking cursor and the armed keys use.
func TestAStaleToastTimerLeavesTheNewOneAlone(t *testing.T) {
	m, _ := inRoom(t, nil, nil)
	m.toast("ok", "first")
	stale := m.toastGen
	m.toast("warn", "second")
	m.Update(toastMsg{gen: stale})
	if m.toastText != "second" {
		t.Errorf("toast is %q, want the second one still up", m.toastText)
	}
}

// The debug panel is text too, and its own region: a selection started in the conversation
// cannot wander into it, and a line the panel drew clipped still copies whole.
func TestTheDebugPanelIsItsOwnSelectableRegion(t *testing.T) {
	m, _ := inRoom(t, []ChatEntry{{At: time.Now(), Kind: KindMessage, Who: "ana", Text: "hola"}}, nil)
	long := "pump late by " + strings.Repeat("x", 120) + " ms"
	m.debugLines = []ChatEntry{{At: time.Now(), Text: long}}
	m.rs.Debug = true
	m.rs.DebugLines = m.debugLines
	m.View()

	rows := m.frame.TextRows("debug")
	if len(rows) != 1 {
		t.Fatalf("the debug panel marked %d rows, want 1", len(rows))
	}
	click(m, rows[0].X, rows[0].Y)
	m.mouse(tea.MouseEvent{X: rows[0].X + 400, Y: rows[0].Y, Action: tea.MouseActionMotion, Button: tea.MouseButtonLeft})
	if m.sel.region != "debug" {
		t.Fatalf("the selection is in %q, want the debug panel", m.sel.region)
	}
	if got := m.SelectedText(); !strings.HasSuffix(got, long) {
		t.Errorf("copied %q, which is not the whole clipped line", got)
	}
	// And it painted no further than the pane it was drawn in.
	if m.frame.StyleAt(m.frame.W-1, rows[0].Y).BG == ThemeSelection {
		t.Error("the selection painted over the frame's right border")
	}
}

// A modal takes the mouse as it takes the keys: the room behind it stands down, so a click
// cannot work a button the keyboard cannot reach, or start selecting a conversation that is
// behind a panel.
func TestAModalStandsTheRoomDown(t *testing.T) {
	entries := []ChatEntry{{At: time.Now(), Kind: KindMessage, Who: "ana", Text: "hola mundo"}}
	m, room := inRoom(t, entries, nil)
	chatRow := m.frame.TextRows("chat")[0]
	muteChip, ok := hotFor(m.frame, func(a Action) bool { return a.Kind == ActKey && a.Key == "m" })
	if !ok {
		t.Fatal("no mute chip before the modal")
	}

	m.modal, m.modalItems, m.modalIdx = "screen", []VideoChoice{{ID: "1", Label: "Display 1"}, {ID: "2", Label: "Display 2"}}, 0
	m.View()

	click(m, chatRow.X+2, chatRow.Y)
	if m.sel.active {
		t.Error("a click behind the modal started a selection")
	}
	click(m, muteChip.X+1, muteChip.Y)
	if room.muted {
		t.Error("a click behind the modal worked the room's controls")
	}
	// And the modal's own rows are live.
	r, ok := hotFor(m.frame, func(a Action) bool { return a.Kind == ActRow && a.ID == "modal" && a.Idx == 1 })
	if !ok {
		t.Fatal("the modal registered no rows")
	}
	click(m, r.X+2, r.Y)
	if len(room.screens) != 1 || room.screens[0] != "2" {
		t.Errorf("clicking the second screen shared %v", room.screens)
	}
	if m.modal != "" {
		t.Error("the modal stayed up after a choice")
	}
}

// ── the composer ────────────────────────────────────────────────────────────

// typing puts a draft in the composer with the cursor at its end and draws a frame.
func typing(t *testing.T, text string) *Model {
	t.Helper()
	m, _ := inRoom(t, []ChatEntry{{At: time.Now(), Kind: KindMessage, Who: "ana", Text: "hola"}}, nil)
	m.rs.InputFocused = true
	m.draft = textField{value: text, cursor: len([]rune(text))}
	m.blinkOn = true
	m.View()
	return m
}

// composer is where the input block is and how tall it grew.
// composer is where the draft itself is drawn — the rows inside the box, not the box. The
// box is what a click focuses, and it is two rows taller; what these tests are about is how
// many rows the draft took.
func composer(t *testing.T, m *Model) Rect {
	t.Helper()
	rows := m.frame.TextRows("input")
	if len(rows) == 0 {
		t.Fatal("the composer marked no rows")
	}
	first := rows[0]
	return Rect{first.X, first.Y, first.MaxX - first.X, len(rows)}
}

// composerBox is the floating box around it, which is what a click lands on.
func composerBox(t *testing.T, m *Model) Rect {
	t.Helper()
	r, ok := hotFor(m.frame, func(a Action) bool { return a.Kind == ActFocus && a.ID == "input" })
	if !ok {
		t.Fatal("the composer registered no area")
	}
	return r
}

// cursorOn says whether the inverted cell — which is how this interface has always drawn a
// cursor — is somewhere in the composer. If it is not, you cannot see what you are typing.
func cursorOn(m *Model, area Rect) bool {
	for y := area.Y; y < area.Y+area.H; y++ {
		for x := area.X; x < area.X+area.W; x++ {
			if m.frame.StyleAt(x, y).Inverse {
				return true
			}
		}
	}
	return false
}

func TestAShortDraftKeepsTheComposerOneRow(t *testing.T) {
	m := typing(t, "hola")
	if area := composer(t, m); area.H != 1 {
		t.Errorf("the composer took %d rows for a short draft, want 1", area.H)
	}
}

// The symptom this fixes: type past the width of the pane and the text used to run off the
// edge, so you stopped seeing what you were writing.
func TestALongDraftGrowsTheComposerAndStaysReadable(t *testing.T) {
	long := strings.TrimSpace(strings.Repeat("palabras de un mensaje largo que no cabe en una sola fila ", 3))
	m := typing(t, long)
	area := composer(t, m)
	if area.H < 2 {
		t.Fatalf("the composer stayed at %d row(s) for a draft of %d characters", area.H, len([]rune(long)))
	}
	if !cursorOn(m, area) {
		t.Error("the cursor is not on screen, so the end of the draft cannot be seen")
	}
	// Every word of it is on screen, in order, across the rows it took.
	var got strings.Builder
	for y := area.Y; y < area.Y+area.H; y++ {
		for x := area.X; x < area.X+area.W; x++ {
			got.WriteString(strings.TrimSpace(string(runeAt(m.frame, x, y))))
		}
	}
	if want := strings.ReplaceAll(long, " ", ""); !strings.Contains(got.String(), want) {
		t.Error("the draft is not all on screen")
	}
}

// Past the cap it scrolls instead of growing, and what it shows is the end you are typing.
func TestAVeryLongDraftScrollsRatherThanEatingTheRoom(t *testing.T) {
	m := typing(t, strings.Repeat("palabra ", 200))
	area := composer(t, m)
	if area.H > maxComposerRows {
		t.Errorf("the composer took %d rows, past the cap of %d", area.H, maxComposerRows)
	}
	if !cursorOn(m, area) {
		t.Error("the cursor scrolled out of view")
	}
	if !strings.Contains(m.frame.Text(), "hola") {
		t.Error("the conversation was pushed off the screen entirely")
	}
}

// An editor may not quietly drop what was typed into it — which is why the composer does not
// use the log's wrap, whose rules let a space at a line's end vanish.
func TestWrapDraftKeepsEveryRune(t *testing.T) {
	for _, text := range []string{"", "hola", "hola  mundo", "unapalabramuylargasinespacios", strings.Repeat("a b ", 30), "  "} {
		runes := []rune(text)
		rows, _, _ := wrapDraft(runes, 10, len(runes))
		var back strings.Builder
		for _, r := range rows {
			back.WriteString(string(r))
			// Trailing spaces are allowed to hang past the edge; the canvas clips them.
			if w := Width(strings.TrimRight(string(r), " ")); w > 10 {
				t.Errorf("a row of %d cells for a width of 10: %q", w, string(r))
			}
		}
		if back.String() != text {
			t.Errorf("wrapping %q gave back %q", text, back.String())
		}
	}
}

func TestTheCursorFollowsTheDraftThroughTheRows(t *testing.T) {
	runes := []rune("aaaa bbbb cccc dddd")
	for cursor := 0; cursor <= len(runes); cursor++ {
		rows, cy, cx := wrapDraft(runes, 10, cursor)
		if cy < 0 || cy >= len(rows) {
			t.Fatalf("cursor %d landed on row %d of %d", cursor, cy, len(rows))
		}
		if cx < 0 || cx > len(rows[cy]) {
			t.Fatalf("cursor %d landed at rune %d of a row of %d", cursor, cx, len(rows[cy]))
		}
	}
}

// ── copying on purpose ──────────────────────────────────────────────────────

// Letting go of the button does not touch the clipboard: a stray drag must not overwrite
// what someone was carrying. The selection waits, and says which key takes it.
func TestReleaseDoesNotCopyByDefault(t *testing.T) {
	entries := []ChatEntry{{At: time.Now(), Kind: KindMessage, Who: "ana", Text: "hola mundo"}}
	m, _ := inRoom(t, entries, nil)
	row := m.frame.TextRows("chat")[0]
	click(m, row.X, row.Y)
	m.mouse(tea.MouseEvent{X: row.X + 8, Y: row.Y, Action: tea.MouseActionMotion, Button: tea.MouseButtonLeft})
	if cmd := m.mouse(tea.MouseEvent{X: row.X + 8, Y: row.Y, Action: tea.MouseActionRelease, Button: tea.MouseButtonLeft}); cmd != nil {
		t.Error("releasing the button went to the clipboard on its own")
	}
	if m.sel.empty() {
		t.Fatal("the selection was thrown away on release")
	}
	m.View()
	if !strings.Contains(m.frame.Text(), "copy selection") {
		t.Error("nothing on screen says which key copies")
	}
	// And ctrl+c is what does it.
	_, cmd := m.Update(tea.KeyMsg{Type: tea.KeyCtrlC})
	if cmd == nil {
		t.Fatal("ctrl+c with a selection up did not copy")
	}
	if !m.sel.empty() {
		t.Error("the selection stayed up after being copied")
	}
	if m.quit {
		t.Error("ctrl+c with a selection up left the room")
	}
}

func TestCopyOnSelectCopiesOnRelease(t *testing.T) {
	entries := []ChatEntry{{At: time.Now(), Kind: KindMessage, Who: "ana", Text: "hola mundo"}}
	m, _ := inRoom(t, entries, nil)
	m.host.Settings.(*fakeStore).copyOnUp = true
	row := m.frame.TextRows("chat")[0]
	click(m, row.X, row.Y)
	m.mouse(tea.MouseEvent{X: row.X + 8, Y: row.Y, Action: tea.MouseActionMotion, Button: tea.MouseButtonLeft})
	if cmd := m.mouse(tea.MouseEvent{X: row.X + 8, Y: row.Y, Action: tea.MouseActionRelease, Button: tea.MouseButtonLeft}); cmd == nil {
		t.Error("with the setting on, releasing the button did not copy")
	}
}

// The Ctrl key's own phantom event, again — this time against a selection in the
// conversation. The composer's selection is exempt from the rule that any key puts a
// selection away; the conversation's is not, so the phantom used to take it and ctrl+c then
// left the room instead of copying. It is not a key at all, and now nothing sees it.
func TestThePhantomCtrlKeyLeavesAChatSelectionAlone(t *testing.T) {
	entries := []ChatEntry{{At: time.Now(), Kind: KindMessage, Who: "ana", Text: "hola mundo"}}
	m, _ := inRoom(t, entries, nil)
	row := m.frame.TextRows("chat")[0]
	click(m, row.X, row.Y)
	m.mouse(tea.MouseEvent{X: row.X + 8, Y: row.Y, Action: tea.MouseActionMotion, Button: tea.MouseButtonLeft})
	m.mouse(tea.MouseEvent{X: row.X + 8, Y: row.Y, Action: tea.MouseActionRelease, Button: tea.MouseButtonLeft})
	want := m.SelectedText()
	if want == "" {
		t.Fatal("the drag selected nothing")
	}

	m.Update(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{0}})
	if got := m.SelectedText(); got != want {
		t.Errorf("the phantom took the selection: %q, want %q", got, want)
	}
	_, cmd := m.Update(tea.KeyMsg{Type: tea.KeyCtrlC})
	if cmd == nil || m.quit {
		t.Error("ctrl+c left the room instead of copying")
	}
	// And a real key still puts a conversation's selection away.
	m2, _ := inRoom(t, entries, nil)
	r2 := m2.frame.TextRows("chat")[0]
	click(m2, r2.X, r2.Y)
	m2.mouse(tea.MouseEvent{X: r2.X + 8, Y: r2.Y, Action: tea.MouseActionMotion, Button: tea.MouseButtonLeft})
	m2.Update(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune("x")})
	if !m2.sel.empty() {
		t.Error("a real key left the selection up")
	}
}

// The interface draws the chord it is given rather than deciding what a platform calls it.
func TestTheCopyHintNamesTheChordTheHostGave(t *testing.T) {
	m, _ := inRoom(t, []ChatEntry{{At: time.Now(), Kind: KindMessage, Who: "ana", Text: "hola"}}, nil)
	m.host.CopyKey = "Ctrl+C"
	m.copyKey = "Ctrl+C"
	row := m.frame.TextRows("chat")[0]
	click(m, row.X, row.Y)
	m.mouse(tea.MouseEvent{X: row.X + 8, Y: row.Y, Action: tea.MouseActionMotion, Button: tea.MouseButtonLeft})
	m.View()
	if !strings.Contains(m.frame.Text(), "Ctrl+C") {
		t.Error("the hint does not name the chord the host gave")
	}
	// And the terminal can still say it has a better one.
	m.Update(CopyKey{Name: "⌘C"})
	m.View()
	if !strings.Contains(m.frame.Text(), "⌘C") {
		t.Error("the hint ignored the chord the terminal said it can send")
	}
}
