package tui

import (
	"fmt"
	"strings"

	tea "github.com/charmbracelet/bubbletea"

	"github.com/manuelvegadev/openmeet/packages/go/internal/files"
)

// Files in the room: the chips waiting in the composer, the row in the log, and the list
// that `f` opens.
//
// No emoji. The log's gutter already speaks in single glyphs — `+` joined, `›` said, `▣`
// shared a screen, `♪` muted — and a file is `▤`. What kind of file it is goes on the same
// chip every key hint uses, as three letters: a tag asks nothing of the font, aligns in a
// column, and says the one thing the mark is for.

// Attachment is a file waiting in the composer, attached and not yet sent.
type Attachment struct {
	Path string
	Name string
	Kind string
	Size int64
}

// attachSpans is one pending attachment, drawn as the chip every other key is drawn as —
// through ChipSpans, so a chip restyled there is restyled here too.
func attachSpans(a Attachment) []Span {
	return ChipSpans(KeyHint{Key: a.Kind, Label: a.Name + " · " + files.FormatSize(a.Size)})
}

// FileRows is the list `f` opens: every file the room has seen, in the order it arrived.
func FileRows(list []*FileInfo) []string {
	out := make([]string, len(list))
	for i, p := range list {
		f := *p
		row := fmt.Sprintf("%s  %s  %s  from %s", f.Kind, f.Name, files.FormatSize(f.Size), f.From)
		if f.Mine {
			row = fmt.Sprintf("%s  %s  %s  yours", f.Kind, f.Name, files.FormatSize(f.Size))
		}
		switch f.State {
		case FileSaved:
			row += "  · saved"
		case FileReceiving:
			row += fmt.Sprintf("  · receiving %d%%", f.Percent())
		case FileSending:
			row += fmt.Sprintf("  · sending %d%%", f.Percent())
		case FileWaiting:
			row += "  · asking…"
		case FileFailed:
			row += "  · failed"
		case FileGone:
			row += "  · gone"
		}
		out[i] = row
	}
	return out
}

// FileHints are the keys under that list. What Enter does depends on the row: a file that is
// here is opened, one that is not is asked for — and a file of your own is already here.
// Where the system has no preview of its own (Windows), Enter says "open", because that is
// what it would do.
func FileHints(f *FileInfo) []KeyHint {
	open := "open"
	if HasPreview {
		open = "preview"
	}
	get := KeyHint{Key: "enter", Label: "download"}
	switch {
	case f == nil:
		get.Disabled = true
	case f.Mine || f.State == FileSaved:
		get.Label = open
	case f.State == FileGone:
		get.Disabled = true
	case f.State == FileReceiving || f.State == FileWaiting:
		get.Label, get.Disabled = "downloading", true
	}
	here := f != nil && (f.Mine || f.State == FileSaved)
	hints := []KeyHint{get}
	if HasPreview {
		// Only where previewing means something that opening does not; see files.HasPreview.
		hints = append(hints, KeyHint{Key: "o", Label: "open", Disabled: !here})
	}
	return append(hints,
		KeyHint{Key: "r", Label: "in folder", Disabled: !here},
		KeyHint{Key: "esc", Label: "close"})
}

// ── the model's half ────────────────────────────────────────────────────────

// selectedFile is the row the list is on.
func (m *Model) selectedFile() *FileInfo {
	if m.modalIdx < 0 || m.modalIdx >= len(m.files) {
		return nil
	}
	return m.files[m.modalIdx]
}

// refreshDraftFile is what makes a dropped file work whatever shape it arrives in.
//
// A terminal writes a dropped path in as *text*, and not every terminal writes it in one
// piece: Windows Terminal can deliver it as a run of ordinary key events, so watching a
// single insert — which is what this used to do, and only that — missed it and left the path
// sitting in the message. Watching what the draft has *become* catches every shape, because
// by the time the last character has landed the draft is the path.
//
// The gate is the shape of the text, so a draft that could not be a path never reaches the
// filesystem, and a path with anything else around it ("look at C:\x\y.png") is a message,
// not an attachment.
func (m *Model) refreshDraftFile() {
	if m.screen != screenRoom || m.host.Attach == nil || m.draft.value == "" {
		return
	}
	if !files.LooksLikePath(m.draft.value) {
		return
	}
	found, ok := m.host.Attach(m.draft.value)
	if !ok || len(found) == 0 {
		return
	}
	m.attach = append(m.attach, found...)
	m.draft.clear()
	m.sel.clear()
	m.clearArmed = false
}

// pressFile is a button on a file card: idx is the entry the card was drawn from, which is
// what carries the file. The buttons are the mouse's — the keyboard comes in through `f` —
// so each one does its own thing here rather than sending a key.
func (m *Model) pressFile(action string, idx int) tea.Cmd {
	if idx < 0 || idx >= len(m.rs.Entries) || m.room == nil {
		return nil
	}
	f := m.rs.Entries[idx].File
	if f == nil {
		return nil
	}
	if action == "file:get" {
		if err := m.room.GetFile(f.ID); err != nil {
			return m.toast("warn", err.Error())
		}
		return m.toast("info", "Asking for "+f.Name+"…")
	}
	how := strings.TrimPrefix(action, "file:")
	if err := m.room.OpenFile(f.ID, how); err != nil {
		return m.toast("warn", err.Error())
	}
	return nil
}

// keyFiles is the list `f` opens. Enter means the useful thing for the row it is on: ask for
// a file that is not here, look at one that is.
func (m *Model) keyFiles(msg tea.KeyMsg) tea.Cmd {
	switch {
	case msg.Type == tea.KeyEsc:
		m.modal = ""
	case msg.Type == tea.KeyUp:
		m.modalIdx = max(0, m.modalIdx-1)
	case msg.Type == tea.KeyDown:
		m.modalIdx = min(len(m.files)-1, m.modalIdx+1)
	case msg.Type == tea.KeyEnter:
		f := m.selectedFile()
		if f == nil || m.room == nil {
			return nil
		}
		if f.Mine || f.State == FileSaved {
			m.modal = ""
			return m.fileAction(f, "preview")
		}
		if err := m.room.GetFile(f.ID); err != nil {
			return m.toast("warn", err.Error())
		}
		// The list stays up: asking for one file is usually asking for two.
		return m.toast("info", "Asking for "+f.Name+"…")
	case isRune(msg, "o"):
		if f := m.selectedFile(); f != nil {
			m.modal = ""
			return m.fileAction(f, "open")
		}
	case isRune(msg, "r"):
		if f := m.selectedFile(); f != nil {
			m.modal = ""
			return m.fileAction(f, "reveal")
		}
	}
	return nil
}

func (m *Model) fileAction(f *FileInfo, how string) tea.Cmd {
	if m.room == nil {
		return nil
	}
	if err := m.room.OpenFile(f.ID, how); err != nil {
		return m.toast("warn", err.Error())
	}
	return nil
}

// attachClipboard attaches whatever is on the clipboard — a file copied in the Finder or in
// Explorer, or an image written out to one. See internal/files: a paste can never carry an
// image to a terminal application, so this reads the clipboard itself.
func (m *Model) attachClipboard() tea.Cmd {
	if m.host.AttachClipboard == nil {
		return nil
	}
	found, why := m.host.AttachClipboard()
	if len(found) == 0 {
		if why == "" {
			why = "nothing on the clipboard to attach"
		}
		return m.toast("warn", why)
	}
	m.attach = append(m.attach, found...)
	m.clearArmed = false
	return m.blink()
}
