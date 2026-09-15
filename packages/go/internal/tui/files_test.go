package tui

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	tea "github.com/charmbracelet/bubbletea"
)

// Sharing a file, from the composer to the row in the log.

// withFiles is a model in a room whose host resolves paths the way the real one does.
func withFiles(t *testing.T) (*Model, *fakeRoom, string) {
	t.Helper()
	dir := t.TempDir()
	path := filepath.Join(dir, "notes.txt")
	if err := os.WriteFile(path, []byte("hello"), 0o644); err != nil {
		t.Fatal(err)
	}
	m, room := inRoom(t, nil, nil)
	m.host.AttachKey = "ctrl+v"
	m.host.Attach = func(raw string) ([]Attachment, bool) {
		if raw == path {
			return []Attachment{{Path: path, Name: "notes.txt", Kind: "doc", Size: 5}}, true
		}
		return nil, false
	}
	m.rs.InputFocused = true
	m.View()
	return m, room, path
}

func typeText(m *Model, s string) {
	m.Update(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune(s)})
}

// ── the composer ────────────────────────────────────────────────────────────

func TestDroppingAFileAttachesItInsteadOfTyping(t *testing.T) {
	m, _, path := withFiles(t)
	typeText(m, path)
	if len(m.attach) != 1 || m.attach[0].Path != path {
		t.Fatalf("attachments = %+v", m.attach)
	}
	if m.draft.value != "" {
		t.Errorf("the path was typed as well: %q", m.draft.value)
	}
}

func TestTextThatIsNotAPathIsStillText(t *testing.T) {
	m, _, _ := withFiles(t)
	typeText(m, "hola mundo")
	if len(m.attach) != 0 {
		t.Fatalf("attachments = %+v", m.attach)
	}
	if m.draft.value != "hola mundo" {
		t.Errorf("draft = %q", m.draft.value)
	}
}

// One rune is never a path, and must never cost a look at the disk.
func TestOneRuneNeverAsksTheDisk(t *testing.T) {
	m, _, _ := withFiles(t)
	asked := false
	m.host.Attach = func(string) ([]Attachment, bool) { asked = true; return nil, false }
	typeText(m, "a")
	if asked {
		t.Error("a single keystroke went to the filesystem")
	}
}

func TestEnterSendsTheAttachmentsAndTheMessage(t *testing.T) {
	m, room, path := withFiles(t)
	typeText(m, path)
	typeText(m, "look at this")
	key(m, tea.KeyEnter)
	if len(room.shared) != 1 || room.shared[0] != path {
		t.Errorf("shared = %v", room.shared)
	}
	if len(room.sent) != 1 || room.sent[0] != "look at this" {
		t.Errorf("sent = %v", room.sent)
	}
	if len(m.attach) != 0 || m.draft.value != "" {
		t.Error("the composer kept something after sending")
	}
}

func TestEnterWithOnlyAnAttachmentSendsNoEmptyMessage(t *testing.T) {
	m, room, path := withFiles(t)
	typeText(m, path)
	key(m, tea.KeyEnter)
	if len(room.shared) != 1 {
		t.Errorf("shared = %v", room.shared)
	}
	if len(room.sent) != 0 {
		t.Errorf("it sent a message too: %v", room.sent)
	}
}

func TestBackspaceOnAnEmptyDraftTakesTheAttachmentOff(t *testing.T) {
	m, _, path := withFiles(t)
	typeText(m, path)
	key(m, tea.KeyBackspace)
	if len(m.attach) != 0 {
		t.Errorf("attachments = %+v", m.attach)
	}
}

func TestBackspaceWithADraftEditsTheDraftFirst(t *testing.T) {
	m, _, path := withFiles(t)
	typeText(m, path)
	typeText(m, "hola")
	key(m, tea.KeyBackspace)
	if m.draft.value != "hol" {
		t.Errorf("draft = %q", m.draft.value)
	}
	if len(m.attach) != 1 {
		t.Error("it took the attachment off instead of a letter")
	}
}

func TestTheClipboardKeyAttachesWhatIsOnIt(t *testing.T) {
	m, _, _ := withFiles(t)
	m.host.AttachClipboard = func() ([]Attachment, string) {
		return []Attachment{{Path: "/tmp/shot.png", Name: "shot.png", Kind: "doc", Size: 12}}, ""
	}
	m.Update(tea.KeyMsg{Type: tea.KeyCtrlV})
	if len(m.attach) != 1 || m.attach[0].Name != "shot.png" {
		t.Fatalf("attachments = %+v", m.attach)
	}
	// Windows Terminal keeps ctrl+v for itself, so the other chord does the same thing.
	m.Update(tea.KeyMsg{Type: tea.KeyCtrlP})
	if len(m.attach) != 2 {
		t.Errorf("ctrl+p attached nothing: %+v", m.attach)
	}
}

func TestAnEmptyClipboardSaysSoRatherThanAttachingNothing(t *testing.T) {
	m, _, _ := withFiles(t)
	m.host.AttachClipboard = func() ([]Attachment, string) { return nil, "nothing on the clipboard to attach" }
	m.Update(tea.KeyMsg{Type: tea.KeyCtrlV})
	if len(m.attach) != 0 {
		t.Fatal("it attached something")
	}
	if !strings.Contains(m.toastText, "nothing on the clipboard") {
		t.Errorf("toast = %q", m.toastText)
	}
}

func TestTheComposerSaysHowToAttach(t *testing.T) {
	m, _, _ := withFiles(t)
	if !strings.Contains(frameText(m), "attach from the clipboard, or drag a file in") {
		t.Error("an empty focused composer does not say how a file gets in")
	}
}

func TestTheAttachmentChipIsOnScreen(t *testing.T) {
	m, _, path := withFiles(t)
	typeText(m, path)
	m.View()
	text := frameText(m)
	if !strings.Contains(text, "notes.txt") || !strings.Contains(text, "doc") {
		t.Error("the attachment chip is not drawn")
	}
	if !strings.Contains(text, "⌫ removes") {
		t.Error("nothing says how to take it off again")
	}
}

// ── the row and the list ────────────────────────────────────────────────────

func shareInto(m *Model, id, name string, mine bool) {
	m.Update(FileShared{At: time.Now(), Who: "sofia", Color: "#22D3EE", File: FileInfo{
		ID: id, Name: name, Size: 1572864, Kind: "aud", From: "sofia", Mine: mine, State: FileOffered,
	}})
}

func TestAFileSharedBecomesACardInTheLog(t *testing.T) {
	m, _, _ := withFiles(t)
	shareInto(m, "abc", "nota.m4a", false)
	m.View()
	text := frameText(m)
	for _, want := range []string{"[sofia] shared", " aud ", "nota.m4a", "1.5 MB", "download", "╭", "╰"} {
		if !strings.Contains(text, want) {
			t.Errorf("the card does not show %q:\n%s", want, text)
		}
	}
}

func TestATransferMovesTheCardItIsOn(t *testing.T) {
	m, _, _ := withFiles(t)
	shareInto(m, "abc", "nota.m4a", false)
	m.Update(FileUpdate{ID: "abc", State: FileReceiving, Done: 786432})
	m.View()
	text := frameText(m)
	if !strings.Contains(text, "50%") || !strings.Contains(text, "█") {
		t.Errorf("the card does not show progress:\n%s", text)
	}
	m.Update(FileUpdate{ID: "abc", State: FileSaved, Done: 1572864, Saved: "/Users/x/Downloads/openmeet/nota.m4a"})
	m.View()
	text = frameText(m)
	if !strings.Contains(text, "✓") {
		t.Error("no green mark once it is here")
	}
	for _, want := range []string{"open", "in folder"} {
		if !strings.Contains(text, want) {
			t.Errorf("the card does not offer %q", want)
		}
	}
	// The path was the complaint: it is the button's job now, not the row's.
	if strings.Contains(text, "Downloads") {
		t.Errorf("the card still prints a path:\n%s", text)
	}
}

func TestTheFilesKeyOnlyAppearsOnceThereIsOne(t *testing.T) {
	m, _, _ := withFiles(t)
	m.rs.InputFocused = false
	m.View()
	if strings.Contains(frameText(m), " files ") {
		t.Error("an empty room advertises a list with nothing in it")
	}
	shareInto(m, "abc", "nota.m4a", false)
	m.View()
	if !strings.Contains(frameText(m), " files ") {
		t.Error("the key never appears")
	}
}

func TestTheListAsksForAFileAndOpensOneThatIsHere(t *testing.T) {
	m, room, _ := withFiles(t)
	m.rs.InputFocused = false
	shareInto(m, "abc", "nota.m4a", false)
	m.Update(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune("f")})
	if m.modal != "files" {
		t.Fatalf("modal = %q", m.modal)
	}
	m.View()
	if !strings.Contains(frameText(m), "Files in this room") {
		t.Error("the list is not on screen")
	}
	key(m, tea.KeyEnter)
	if len(room.got) != 1 || room.got[0] != "abc" {
		t.Fatalf("asked for %v", room.got)
	}
	// It stays up: asking for one file is usually asking for two.
	if m.modal != "files" {
		t.Error("the list closed after asking")
	}
	m.Update(FileUpdate{ID: "abc", State: FileSaved, Saved: "/tmp/nota.m4a"})
	key(m, tea.KeyEnter)
	if len(room.opened) != 1 || room.opened[0] != [2]string{"abc", "preview"} {
		t.Fatalf("opened %v", room.opened)
	}
	if m.modal != "" {
		t.Error("the list stayed up after opening a window over it")
	}
}

func TestTheListRevealsAndOpens(t *testing.T) {
	m, room, _ := withFiles(t)
	m.rs.InputFocused = false
	shareInto(m, "abc", "nota.m4a", true)
	m.Update(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune("f")})
	m.Update(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune("r")})
	if len(room.opened) != 1 || room.opened[0][1] != "reveal" {
		t.Fatalf("opened %v", room.opened)
	}
	m.Update(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune("f")})
	m.Update(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune("o")})
	if len(room.opened) != 2 || room.opened[1][1] != "open" {
		t.Fatalf("opened %v", room.opened)
	}
}

func TestYourOwnFileIsNotSomethingToDownload(t *testing.T) {
	m, room, _ := withFiles(t)
	m.rs.InputFocused = false
	shareInto(m, "mine", "nota.m4a", true)
	m.Update(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune("f")})
	key(m, tea.KeyEnter)
	if len(room.got) != 0 {
		t.Errorf("it asked the room for our own file: %v", room.got)
	}
	if len(room.opened) != 1 || room.opened[0][1] != "preview" {
		t.Errorf("opened %v", room.opened)
	}
}

func hintFor(hints []KeyHint, key string) (KeyHint, bool) {
	for _, h := range hints {
		if h.Key == key {
			return h, true
		}
	}
	return KeyHint{}, false
}

func TestTheHintsSayWhatEnterWillDo(t *testing.T) {
	enter := func(f *FileInfo) KeyHint {
		h, ok := hintFor(FileHints(f), "enter")
		if !ok {
			t.Fatal("no enter hint")
		}
		return h
	}
	if enter(&FileInfo{State: FileOffered}).Label != "download" {
		t.Error("a file that is not here should offer to download")
	}
	here := enter(&FileInfo{State: FileSaved}).Label
	if HasPreview && here != "preview" {
		t.Errorf("with Quick Look, enter should preview; got %q", here)
	}
	if !HasPreview && here != "open" {
		t.Errorf("without a preview of its own, enter should open; got %q", here)
	}
	if !enter(&FileInfo{State: FileGone}).Disabled {
		t.Error("a file nobody has should not offer anything")
	}
	if o, ok := hintFor(FileHints(&FileInfo{State: FileOffered}), "o"); ok && !o.Disabled {
		t.Error("open should be off for a file that is not on this disk")
	}
	// Windows has no preview of its own, so there is no second key for one.
	if _, ok := hintFor(FileHints(&FileInfo{State: FileSaved}), "o"); ok != HasPreview {
		t.Errorf("an open key separate from enter: %v, want %v", ok, HasPreview)
	}
}

// The card draws the third button only where the system means something by it.
func TestThePreviewButtonFollowsThePlatform(t *testing.T) {
	f := FileInfo{ID: "a", Name: "a.png", Kind: "img", Size: 10, State: FileSaved}
	was := HasPreview
	defer func() { HasPreview = was }()

	HasPreview = true
	if !strings.Contains(PlainText(fileButtonSpans(f)), "preview") {
		t.Error("macOS should draw a preview button")
	}
	HasPreview = false
	if strings.Contains(PlainText(fileButtonSpans(f)), "preview") {
		t.Error("Windows drew a preview button, where opening and previewing are the same act")
	}
}

// withPreview draws the card the way macOS draws it, whatever machine the test is on: a
// reference frame is a contract about the design, and a frame that changed with the platform
// could not be one.
func withPreview(t *testing.T) func() {
	t.Helper()
	was := HasPreview
	HasPreview = true
	return func() { HasPreview = was }
}

func fileButtonSpans(f FileInfo) []Span {
	var out []Span
	for _, b := range fileButtons(f) {
		out = append(out, b.span)
	}
	return out
}

// frameText is the last frame as plain text, for asking what is on screen.
func frameText(m *Model) string {
	var b strings.Builder
	c := m.frame
	for y := 0; y < c.H; y++ {
		for x := 0; x < c.W; x++ {
			b.WriteRune(runeAt(c, x, y))
		}
		b.WriteByte('\n')
	}
	return b.String()
}

// poseFiles is the room with files in it: one being received, one saved, one of our own, an
// attachment waiting in the composer, and the key that lists them. The frame is ours rather
// than Node's — the Node client had no such thing — so it is here for the layout, which is
// what a composer that grows a row is easy to get wrong about.
func poseFiles() (RoomState, []*FileInfo) {
	s := poseRoom()
	at := s.JoinedAt.Add(20 * time.Minute)
	files := []*FileInfo{
		{ID: "1", Name: "trace.zip", Size: 4718592, Kind: "zip", From: "sofia", State: FileReceiving, Done: 1179648},
		{ID: "2", Name: "nota.m4a", Size: 1572864, Kind: "aud", From: "diego", State: FileSaved, Saved: "/Users/mvega/Downloads/openmeet/nota.m4a"},
		{ID: "3", Name: "capture.mov", Size: 20971520, Kind: "vid", From: "mvega", Mine: true, State: FileOffered},
	}
	who := []struct{ name, color string }{{"sofia", "#22D3EE"}, {"diego", "#4ADE80"}, {"mvega", "#FACC15"}}
	for i, f := range files {
		s.Entries = append(s.Entries, ChatEntry{At: at.Add(time.Duration(i) * time.Minute), Kind: KindFile, Who: who[i].name, Color: who[i].color, File: f})
		s.FileCount++
	}
	s.InputFocused = true
	s.Attachments = []Attachment{{Path: "/tmp/build.log", Name: "build.log", Kind: "doc", Size: 8421}}
	s.AttachKey = "ctrl+v"
	return s, files
}

func TestRoomWithFilesFrame(t *testing.T) {
	defer withPreview(t)()
	c := NewCanvas(120, 34)
	s, _ := poseFiles()
	DrawRoom(c, s)
	compare(t, "room-files", c)
}

func TestFilesModalFrame(t *testing.T) {
	defer withPreview(t)()
	s, list := poseFiles()
	c := NewCanvas(120, 34)
	DrawRoom(c, s)
	DrawModal(c, "Files in this room", FileRows(list), 0, FileHints(list[0]), "modal")
	compare(t, "files-modal", c)
}

func TestANewRoomStartsWithNoFiles(t *testing.T) {
	m, _, path := withFiles(t)
	typeText(m, path)
	shareInto(m, "abc", "nota.m4a", false)
	m.modal = "files"
	m.host.Join = func(_, _, _, _, _ string) (Room, error) { return &fakeRoom{}, nil }
	m.pendingRoom = "somewhere-else"
	m.joinRoom()
	if len(m.files) != 0 || len(m.attach) != 0 || m.modal != "" {
		t.Fatalf("the last room came along: files=%d attach=%d modal=%q", len(m.files), len(m.attach), m.modal)
	}
	m.View()
	if strings.Contains(frameText(m), "nota.m4a") {
		t.Error("a file from the last room is still on screen")
	}
}

// The card's buttons are the mouse's, so each one has to do its own thing rather than open
// a list: with two cards on screen there is no key that could mean both.
func TestTheCardsButtonsDoTheirOwnThing(t *testing.T) {
	defer withPreview(t)()
	m, room, _ := withFiles(t)
	m.rs.InputFocused = false
	shareInto(m, "abc", "nota.m4a", false)
	m.View()
	r, ok := hotFor(m.frame, func(a Action) bool { return a.ID == "file:get" })
	if !ok {
		t.Fatal("the download button registered nothing to click")
	}
	click(m, r.X+1, r.Y)
	if len(room.got) != 1 || room.got[0] != "abc" {
		t.Fatalf("asked for %v", room.got)
	}

	m.Update(FileUpdate{ID: "abc", State: FileSaved, Saved: "/tmp/nota.m4a"})
	m.View()
	for _, c := range []struct{ id, how string }{{"file:open", "open"}, {"file:reveal", "reveal"}, {"file:preview", "preview"}} {
		r, ok := hotFor(m.frame, func(a Action) bool { return a.ID == c.id })
		if !ok {
			t.Fatalf("%s registered nothing", c.id)
		}
		room.opened = nil
		click(m, r.X+1, r.Y)
		if len(room.opened) != 1 || room.opened[0][1] != c.how {
			t.Errorf("%s did %v", c.id, room.opened)
		}
	}
}

// A card is not prose: none of it is selectable, so a drag across one cannot put a border or
// a button on the clipboard.
func TestAFileCardIsNotText(t *testing.T) {
	m, _, _ := withFiles(t)
	m.rs.InputFocused = false
	shareInto(m, "abc", "nota.m4a", false)
	m.View()
	for _, r := range m.frame.TextRows("chat") {
		if e := m.rs.Entries[r.Src]; e.Kind == KindFile {
			t.Fatalf("a file card marked text at row %d", r.Y)
		}
	}
}

// Windows Terminal writes a dropped path in as ordinary key events, which need not arrive as
// one. Typed a character at a time, the draft still becomes an attachment the moment it is a
// whole path — this is the case that shipped broken.
func TestAPathTypedOneRuneAtATimeStillAttaches(t *testing.T) {
	m, _, path := withFiles(t)
	quoted := `"` + path + `"`
	m.host.Attach = func(raw string) ([]Attachment, bool) {
		if strings.Trim(raw, " \t\r\n") == quoted {
			return []Attachment{{Path: path, Name: "notes.txt", Kind: "doc", Size: 5}}, true
		}
		return nil, false
	}
	for _, r := range quoted {
		typeText(m, string(r))
	}
	if len(m.attach) != 1 {
		t.Fatalf("attachments = %+v, draft = %q", m.attach, m.draft.value)
	}
	if m.draft.value != "" {
		t.Errorf("the path stayed in the message: %q", m.draft.value)
	}
}

// A path with a sentence around it is a message, and must never reach the filesystem.
func TestAPathInsideASentenceIsAMessage(t *testing.T) {
	m, _, path := withFiles(t)
	asked := 0
	m.host.Attach = func(string) ([]Attachment, bool) { asked++; return nil, false }
	for _, r := range "look at " + path {
		typeText(m, string(r))
	}
	if len(m.attach) != 0 {
		t.Fatal("it attached something")
	}
	if asked != 0 {
		t.Errorf("it went to the filesystem %d times for a sentence", asked)
	}
}

// The one that shipped broken twice over: a file dropped while the controls have focus. The
// path is written in one key at a time, and this keymap reads `s` as share, `m` as mute and
// `d` as devices — a single drop started a screen share, muted, and opened the device picker.
func TestADropOntoTheControlsDoesNotFireThem(t *testing.T) {
	m, room, path := withFiles(t)
	m.rs.InputFocused = false // a drag crossing the participants pane is enough to do this
	quoted := `"` + path + `"`
	m.host.Attach = func(raw string) ([]Attachment, bool) {
		if strings.Trim(raw, " \t\r\n") == quoted {
			return []Attachment{{Path: path, Name: "notes.txt", Kind: "doc", Size: 5}}, true
		}
		return nil, false
	}
	for _, r := range quoted {
		typeText(m, string(r))
	}
	if len(room.screens) != 0 || room.stopped {
		t.Errorf("it started or stopped a screen share: %v %v", room.screens, room.stopped)
	}
	if room.muted {
		t.Error("it muted")
	}
	if m.screen != screenRoom {
		t.Errorf("it left the room for screen %v (the device picker)", m.screen)
	}
	if len(m.attach) != 1 {
		t.Fatalf("and it did not attach the file: %+v draft=%q", m.attach, m.draft.value)
	}
	if !m.rs.InputFocused {
		t.Error("the composer did not take the focus")
	}
}

// The same, unquoted, which is the other way a path can arrive: the drive letter starts it,
// so a capital has to be taken as the start of a message too.
func TestAnUnquotedDropOntoTheControlsAttachesToo(t *testing.T) {
	m, room, _ := withFiles(t)
	m.rs.InputFocused = false
	raw := `C:\Users\mvega\Downloads\shot.png`
	m.host.Attach = func(s string) ([]Attachment, bool) {
		if s == raw {
			return []Attachment{{Path: raw, Name: "shot.png", Kind: "img", Size: 9}}, true
		}
		return nil, false
	}
	for _, r := range raw {
		typeText(m, string(r))
	}
	if len(room.screens) != 0 || room.muted || room.stopped {
		t.Error("a bare path still worked the controls")
	}
	if m.screen != screenRoom {
		t.Errorf("it left the room for screen %v", m.screen)
	}
	if len(m.attach) != 1 {
		t.Fatalf("attachments = %+v draft = %q", m.attach, m.draft.value)
	}
}

// The keys the room already had keep working: this must not turn letters into typing.
func TestTheControlsStillWork(t *testing.T) {
	m, room, _ := withFiles(t)
	m.rs.InputFocused = false
	typeText(m, "m")
	if !room.muted {
		t.Error("m no longer mutes")
	}
	if m.rs.InputFocused {
		t.Error("a control key took the focus into the composer")
	}
}

// The hole the old fix left behind: a drop while a modal is up ran the path through *that*
// modal's keys, which could open a file window. A drop is the terminal writing text into us
// whatever has the focus, so it closes the modal and goes to the composer.
func TestADropWhileAModalIsUpStillAttaches(t *testing.T) {
	m, room, path := withFiles(t)
	m.rs.InputFocused = false
	shareInto(m, "abc", "nota.m4a", false)
	quoted := `"` + path + `"`
	m.host.Attach = func(raw string) ([]Attachment, bool) {
		if strings.Trim(raw, " \t\r\n") == quoted {
			return []Attachment{{Path: path, Name: "notes.txt", Kind: "doc", Size: 5}}, true
		}
		return nil, false
	}
	m.Update(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune("f")})
	if m.modal != "files" {
		t.Fatal("the list did not open")
	}
	for _, r := range quoted {
		typeText(m, string(r))
	}
	if m.modal != "" {
		t.Errorf("the list stayed up: %q", m.modal)
	}
	if len(room.opened) != 0 {
		t.Errorf("the path worked the list's keys: %v", room.opened)
	}
	if len(m.attach) != 1 {
		t.Fatalf("attachments = %+v draft = %q", m.attach, m.draft.value)
	}
}
