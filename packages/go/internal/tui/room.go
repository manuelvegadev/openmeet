package tui

import (
	"fmt"
	"strings"
	"time"

	"github.com/mattn/go-runewidth"
)

// The room, drawn as room-view.tsx drew it: the header, then the chat on the left and the
// participants on the right, split by a divider that the rules join with ┬ and ┴, and the
// frame's own bottom edge as the room's last line.

// ParticipantsWidth is the people pane, from the widest row it can hold — a name at
// NameMaxCells with every tag, three-digit numbers, a volume — plus a cell of padding each
// side. It is what participant-list.tsx computes, so the divider lands where Node's did.
const ParticipantsWidth = 37

// EntryKind is what a chat line is: a message, or something that happened in the room.
type EntryKind string

const (
	KindMessage EntryKind = "message"
	KindJoin    EntryKind = "join"
	KindLeave   EntryKind = "leave"
	KindScreen  EntryKind = "screen"
	KindMute    EntryKind = "mute"
	KindInfo    EntryKind = "info"
	KindFile    EntryKind = "file"
)

// The states a file passes through, as the row says them.
const (
	FileOffered   = "offered"   // someone shared it; nobody here has asked for it
	FileWaiting   = "waiting"   // we asked, the sender has not started
	FileReceiving = "receiving" // it is arriving
	FileSending   = "sending"   // ours, and somebody is taking it
	FileSaved     = "saved"     // it is on this disk, at Saved
	FileFailed    = "failed"    // Error says why
	FileGone      = "gone"      // whoever had it left the room
)

// FileInfo is a file somebody shared, as the room draws it. It hangs off the entry that
// announced it, so the log stays the record of what happened and the state of a transfer
// lives in one place rather than in a list beside it.
type FileInfo struct {
	ID    string
	Name  string
	Size  int64
	Kind  string // "aud" | "vid" | "img" | "zip" | "doc"
	From  string // who shared it
	Mine  bool
	State string
	Done  int64  // bytes moved so far
	Saved string // where it landed, once it has
	Error string
}

// Percent is how far along a transfer is, 0–100.
func (f FileInfo) Percent() int {
	if f.Size <= 0 {
		return 0
	}
	p := int(f.Done * 100 / f.Size)
	return clampInt(p, 0, 100)
}

// ChatEntry is one line of the conversation.
type ChatEntry struct {
	At    time.Time
	Kind  EntryKind
	Who   string // empty for a notice about nobody
	Color string
	Text  string
	// Set on a KindFile entry: what was shared and where its transfer has got to.
	File *FileInfo
}

type Peer struct {
	ID, Name, Color string
	Speaking        bool
	Muted           bool
	CamOn           bool // they send a camera
	CamOpen         bool // and we are watching it
	Screen          bool
	ScreenOpen      bool
	Volume          float64 // 1 when untouched
	RecvKbps        int     // -1 when unknown
	LatencyMs       int     // -1 when unknown
}

type Stats struct {
	SendKbps, RecvKbps int
	RTTMs              int
	LossPercent        float64
}

type RoomState struct {
	Version, Platform string
	Room              string
	Connected         bool
	JoinedAt          time.Time
	Now               time.Time
	Stats             *Stats

	Me            Peer
	VideoEnabled  bool
	WebcamEnabled bool
	ScreenSharing bool
	Peers         []Peer
	SelectedPeer  int

	Entries []ChatEntry
	// How many files the room has seen — enough to decide whether `f` is worth offering.
	// The list itself is built where it is drawn, not copied into every frame.
	FileCount int
	// Files attached to the draft and not yet sent.
	Attachments []Attachment
	// The last visible entry's index while scrolled up, -1 to follow the tail.
	Anchor int

	InputFocused bool
	Draft        string
	DraftCursor  int
	Cursor       bool
	ClearArmed   bool // Escape pressed once on a draft
	LeaveArmed   bool // q pressed once

	Error string
	// The debug panel under the participants, when on.
	Debug      bool
	DebugLines []ChatEntry

	// A line of transient feedback on the notice row over the composer: a share that
	// started, a device that changed, a selection that went to the clipboard. The room log
	// is the record of what happened in the room; this is the receipt for what you just did.
	Toast     string
	ToastKind string // "ok" | "warn" | "info"
	// Something is selected in the conversation, so the key that copies it is worth showing,
	// by the name of the chord this terminal can actually send.
	Selecting bool
	CopyKey   string
	// The chord that attaches what is on the clipboard, by the name this terminal can send.
	AttachKey string
}

// FormatClock is HH:MM, or HH:MM:SS.
func FormatClock(t time.Time, seconds bool) string {
	if seconds {
		return t.Format("15:04:05")
	}
	return t.Format("15:04")
}

// FormatElapsed: seconds for the first minute, then minutes, then hours and minutes.
func FormatElapsed(d time.Duration) string {
	s := int(d.Seconds())
	h, m := s/3600, (s%3600)/60
	switch {
	case h > 0:
		return fmt.Sprintf("%dh%02dm", h, m)
	case m > 0:
		return fmt.Sprintf("%dm", m)
	}
	return fmt.Sprintf("%ds", s)
}

func latencyColor(ms int) string {
	switch {
	case ms > 150:
		return ThemeDanger
	case ms > 80:
		return ThemeWarn
	}
	return ""
}

// DrawRoom draws the whole room. Returns nothing the caller needs: keys are the model's.
func DrawRoom(c *Canvas, s RoomState) {
	inner := Frame(c, false)
	chatW := inner.W - ParticipantsWidth - 1
	dividerX := inner.X + chatW
	peopleX := dividerX + 1
	bottom := c.H - 1

	drawRoomHeader(c, inner, s)
	Rule(c, inner.Y+1, '├', '┤', map[int]rune{dividerX: '┬'})
	// The divider: the chat pane's right border, from under the rule to the bottom edge.
	for y := inner.Y + 2; y < bottom; y++ {
		c.Set(dividerX, y, '│', frameStyle)
	}
	// The bottom edge, with the divider's junction.
	Rule(c, bottom, '╰', '╯', map[int]rune{dividerX: '┴'})

	panes := Rect{inner.X, inner.Y + 2, chatW, bottom - (inner.Y + 2)}
	drawChat(c, panes, dividerX, s)
	drawPeople(c, Rect{peopleX, panes.Y, ParticipantsWidth, panes.H}, dividerX, s)

	if s.Error != "" {
		// Ink put it under the panes; with the panes reaching the edge it lands on the last
		// content row, over the input, which is where a Node client shows it too.
		c.Put(inner.X+1, bottom-1, "Error: "+s.Error, Style{FG: ThemeDanger}, inner.X+inner.W-1)
	}
}

func drawRoomHeader(c *Canvas, inner Rect, s RoomState) {
	y := inner.Y
	x := inner.X + 1
	right := inner.X + inner.W - 1
	headBold := Style{FG: ThemeAccent, Bold: true}
	left := []Span{
		{"OpenMeet ", headBold}, {"v" + s.Version, Style{FG: ThemeMuted, Bold: true}}, {" ", headBold},
		{"(" + s.Platform + ")", Style{FG: ThemeMuted, Bold: true}}, {" ", Plain},
	}
	leaveLabel := "leave"
	if s.LeaveArmed {
		leaveLabel = "again to leave"
	}
	left = append(left, ChipSpans(KeyHint{Key: "q", Label: leaveLabel, Disabled: s.InputFocused})...)
	left = append(left, Span{" ", Plain}, Span{"|", Muted}, Span{" ", Plain},
		Span{"Room: ", Plain}, Span{s.Room, Style{Bold: true}}, Span{" ", Plain}, Span{"|", Muted}, Span{" ", Plain},
		Span{fmt.Sprintf("%dp", len(s.Peers)+1), Plain})
	if !s.JoinedAt.IsZero() {
		left = append(left, Span{" ", Plain}, Span{"|", Muted}, Span{" ", Plain}, Span{FormatElapsed(s.Now.Sub(s.JoinedAt)), Muted})
	}
	c.PutSpans(x, y, left, right)
	HotChips(c, x, y, left)

	var rs []Span
	if st := s.Stats; st != nil {
		rttColor := ""
		if st.RTTMs > 150 {
			rttColor = ThemeDanger
		} else if st.RTTMs > 80 {
			rttColor = ThemeWarn
		}
		lossColor := ""
		if st.LossPercent > 5 {
			lossColor = ThemeDanger
		} else if st.LossPercent > 1 {
			lossColor = ThemeWarn
		}
		rs = append(rs,
			Span{fmt.Sprintf("↑%dk", st.SendKbps), Style{FG: ThemeOK}}, Span{" ", Plain},
			Span{fmt.Sprintf("↓%dk", st.RecvKbps), Style{FG: ThemeInfo}}, Span{" ", Plain},
			Span{"|", Muted}, Span{" ", Plain},
			Span{fmt.Sprintf("RTT:%dms", st.RTTMs), Style{FG: rttColor}}, Span{" ", Plain},
			Span{fmt.Sprintf("Loss:%s%%", trimFloat(st.LossPercent)), Style{FG: lossColor}}, Span{" ", Plain},
			Span{"|", Muted}, Span{" ", Plain})
	}
	dot := Style{FG: ThemeDanger}
	if s.Connected {
		dot = Style{FG: ThemeOK}
	}
	rs = append(rs, Span{"●", dot})
	c.PutSpans(right-spansWidth(rs), y, rs, right)
}

// trimFloat prints a percentage the way JS does: 0 → "0", 1.5 → "1.5".
func trimFloat(f float64) string {
	s := fmt.Sprintf("%.1f", f)
	return strings.TrimSuffix(s, ".0")
}

// ── the chat pane ────────────────────────────────────────────────────────────

// debugSpans is one line of the debug panel: the single definition of
// what that line reads as, so what is drawn and what a selection counts its offsets in are
// the same string.
func debugSpans(l ChatEntry) []Span {
	return []Span{{"[" + FormatClock(l.At, true) + "] ", Muted}, {l.Text, Style{FG: ThemeAccentAlt}}}
}

func drawChat(c *Canvas, pane Rect, dividerX int, s RoomState) {
	textX := pane.X + 1
	textW := pane.W - 2

	// The composer is measured first, because how tall it is decides where the log ends. It
	// is the one row it always was while the draft fits on one, and grows upward as the draft
	// wraps — up to a cap, past which it scrolls to keep the cursor in view. A message you
	// cannot read while you write it is a message you cannot write.
	chipLabel := "chat"
	if s.InputFocused {
		chipLabel = "controls"
	}
	chip := ChipSpans(KeyHint{Key: "tab", Label: chipLabel})
	chipW := spansWidth(chip)
	// The composer floats: a rounded box of its own, off the pane's bottom edge, with the
	// draft inside it. So the width a draft has is the box's inside, less the prompt.
	draftW := max(1, textW-5)
	rows, cy, cx := wrapDraft([]rune(s.Draft), draftW, s.DraftCursor)
	shown := min(len(rows), composerRows(pane.H))
	scrolled, skipped := false, 0
	if top := cy - shown + 1; top > 0 {
		for _, row := range rows[:top] {
			skipped += len(row)
		}
		rows = rows[top : top+shown]
		cy -= top
		scrolled = true
	} else {
		rows = rows[:shown]
	}

	// The box sits on the pane's last row. What makes it read as floating is the box itself
	// and the clear row above it, not a gap underneath: a gap there is just a gap, with the
	// frame's own bottom edge right below it.
	boxBottom := pane.Y + pane.H - 1
	inputY := boxBottom - 1
	inputTop := inputY - (shown - 1)
	// Attachments go inside the box, above the draft: they are part of the message being
	// written, not part of the log above it.
	attachY := -1
	boxTop := inputTop - 1
	if len(s.Attachments) > 0 && boxTop-1 > pane.Y {
		attachY = boxTop
		boxTop--
	}
	noticeY := boxTop - 1
	logRows := noticeY - pane.Y

	// The log: blocks up to the anchor, bottom-aligned, the newest at the bottom. A block is
	// a bubble, a file or an event (bubbles.go); it is laid out whole and never split, so a
	// pane too short to hold one simply starts further down it.
	last := len(s.Entries) - 1
	end := last
	if s.Anchor >= 0 && s.Anchor < last {
		end = s.Anchor
	}
	below := last - end

	var lines []logRow
	if len(s.Entries) == 0 {
		lines = []logRow{{spans: []Span{{"No messages yet", Muted}}, src: -1}}
	} else {
		// Only as many blocks as can be shown: the work of a repaint is the size of the pane,
		// not the size of the room's history.
		for _, blk := range logRowsUpTo(s.Entries, s.Me.Name, textW, end, logRows) {
			lines = append(lines, blk...)
		}
	}
	if below > 0 {
		word := "entries"
		if below == 1 {
			word = "entry"
		}
		lines = append(lines, logRow{spans: []Span{{fmt.Sprintf("↓ %d more %s below", below, word), Muted}}, src: -1})
	}
	if len(lines) > logRows {
		lines = lines[len(lines)-logRows:]
	}
	logArea := Rect{textX, pane.Y, textW, logRows}
	c.Hot(logArea, Action{Kind: ActScroll, ID: "chat"})
	c.Hot(logArea, Action{Kind: ActText, ID: "chat"})
	y := noticeY - len(lines)
	for _, line := range lines {
		c.PutSpans(textX, y, line.spans, textX+textW)
		if line.src >= 0 {
			c.MarkText("chat", TextRow{X: textX + line.textX, Y: y, MaxX: textX + line.textX + line.textW,
				Spans: line.text, Src: line.src, Off: line.off})
		}
		// A file's buttons are registered after the text region, and press() looks for them
		// first: they sit inside the log, which is selectable, and they are the one thing in
		// there that is a thing to press.
		for _, h := range line.hots {
			c.Hot(Rect{textX + h.x, y, h.w, 1}, Action{Kind: ActRow, ID: h.id, Idx: h.idx})
		}
		y++
	}

	// The composer.
	switch {
	case s.Toast != "":
		c.Put(textX, noticeY, toastMark(s.ToastKind)+s.Toast, toastStyle(s.ToastKind), textX+textW)
	case s.Selecting:
		// Copying is a key here rather than a side effect of letting go of the button, so the
		// key has to be on screen while there is something to press it on.
		c.PutSpans(textX, noticeY, []Span{KeyChip(s.CopyKey), {" copy selection", Muted}}, textX+textW)
	case s.InputFocused && s.Draft == "" && len(s.Attachments) == 0 && s.AttachKey != "":
		// An empty composer is where there is room to say how a file gets into a message,
		// and the gesture nobody would guess — dragging one in — goes with the key. It says
		// "from the clipboard" rather than "attach", because the system's own paste is a
		// different key doing a different thing and is left alone.
		c.PutSpans(textX, noticeY, []Span{KeyChip(s.AttachKey), {" attach from the clipboard, or drag a file in", Muted}}, textX+textW)
	}
	if s.ClearArmed {
		msg := "esc again to clear"
		c.Put(textX+textW-Width(msg), noticeY, msg, Muted, textX+textW)
	}
	// No rule under the log any more: the box below is its own edge, and the divider now
	// runs unbroken from the header to the frame's bottom.

	// The box. Rounded, and it takes the accent when it has the focus, because tab moving
	// between the conversation and the composer is otherwise only visible in the prompt's one
	// character — and because the accent is what this room already means by "yours".
	boxStyle := Style{FG: ThemeMuted}
	if s.InputFocused {
		boxStyle = Style{FG: ThemeAccent}
	}
	right := textX + textW - 1
	RoundedBox(c, Rect{textX, boxTop, textW, boxBottom - boxTop + 1}, boxStyle)
	// The key that swaps focus lives on the bottom edge, the way a bubble's time does.
	c.PutSpans(right-chipW-1, boxBottom, chip, right)
	HotChips(c, right-chipW-1, boxBottom, chip)

	if attachY >= 0 {
		spans := []Span{}
		for i, a := range s.Attachments {
			if i > 0 {
				spans = append(spans, Span{" ", Plain})
			}
			spans = append(spans, attachSpans(a)...)
		}
		hint := "⌫ removes"
		if spansWidth(spans)+Width(hint)+4 <= textW-4 {
			c.PutSpans(textX+2, attachY, spans, right-Width(hint)-2)
			c.Put(right-Width(hint)-1, attachY, hint, Muted, right)
		} else {
			c.PutSpans(textX+2, attachY, spans, right)
		}
	}

	promptStyle := Style{FG: ThemeMuted, Bold: true}
	if s.InputFocused {
		// The same accent as the box around it. It was green, from the single-row composer
		// the Node client had, where there was no box for the focus to show on.
		promptStyle = Style{FG: ThemeAccent, Bold: true}
	}
	// The prompt marks where the draft begins; once it has scrolled past, it says so instead
	// of claiming the middle of a message is the start of one.
	if scrolled {
		c.Put(textX+2, inputTop, "… ", Muted, right)
	} else {
		c.Put(textX+2, inputTop, "> ", promptStyle, right)
	}
	maxX := textX + 4 + draftW
	// The draft is text too, and its own selectable region: a click in it moves the caret,
	// a drag selects, and what is selected is replaced by the next thing typed or pasted.
	c.Hot(Rect{textX + 4, inputTop, draftW, shown}, Action{Kind: ActText, ID: "input"})
	placeholder := ""
	if s.Draft == "" {
		placeholder = "Type message..."
	}
	at := 0
	for i, row := range rows {
		y := inputTop + i
		c.MarkText("input", TextRow{X: textX + 4, Y: y, MaxX: maxX, Spans: []Span{{string(row), Plain}}, Src: 0, Off: skipped + at})
		at += len(row)
		onCaret := s.InputFocused && i == cy
		c.PutSpans(textX+4, y, TextInputSpans(string(row), cx, placeholder, onCaret, s.Cursor), maxX)
	}
	c.Hot(Rect{textX, boxTop, textW, boxBottom - boxTop + 1}, Action{Kind: ActFocus, ID: "input"})
}

// The composer will not take more than this many rows, nor more than a third of the pane:
// the conversation is what the pane is for.
const maxComposerRows = 6

func composerRows(paneH int) int {
	return max(1, min(maxComposerRows, min(paneH/3, paneH-3)))
}

// wrapDraft breaks the draft into rows of at most width cells and says which row the cursor
// is on and how many runes into it. Unlike Wrap, which is the log's and follows Ink's rules,
// this one keeps every rune: an editor may not quietly drop what was typed into it.
func wrapDraft(text []rune, width, cursor int) (rows [][]rune, cy, cx int) {
	if width < 1 {
		width = 1
	}
	type span struct{ from, to int }
	var spans []span
	for i := 0; i < len(text); {
		w, j := 0, i
		for j < len(text) {
			rw := runeCells(text[j])
			if w+rw > width {
				break
			}
			w += rw
			j++
		}
		// Break after the last space on the row rather than through a word, when there is one.
		if j < len(text) && text[j] != ' ' {
			for k := j - 1; k > i; k-- {
				if text[k] == ' ' {
					j = k + 1
					break
				}
			}
		}
		// A space that did not fit hangs off the end of the row it follows. The canvas clips
		// it and nothing is lost; opening the next row with it would indent the line instead.
		for j < len(text) && text[j] == ' ' {
			j++
		}
		spans = append(spans, span{i, j})
		i = j
	}
	if len(spans) == 0 {
		spans = append(spans, span{0, 0})
	}
	cursor = clampInt(cursor, 0, len(text))
	last := spans[len(spans)-1]
	if cursor >= last.to {
		cy, cx = len(spans)-1, last.to-last.from
	} else {
		for r, sp := range spans {
			if cursor >= sp.from && cursor < sp.to {
				cy, cx = r, cursor-sp.from
				break
			}
		}
	}
	// A cursor at or past the edge of its row shows at the start of the next one, which is
	// where the next character will go — and is the only place it can be seen.
	if sp := spans[cy]; cellsOf(text[sp.from:sp.from+cx]) >= width {
		if cy == len(spans)-1 {
			spans = append(spans, span{sp.to, sp.to})
		}
		cy, cx = cy+1, 0
	}
	rows = make([][]rune, len(spans))
	for r, sp := range spans {
		rows[r] = text[sp.from:sp.to]
	}
	return rows, cy, cx
}

// runeCells is how wide one rune is drawn, counted without turning it into a string: this
// runs over every rune of the draft on every repaint, and Width would allocate each time.
// A control rune is one cell either way — the canvas draws it as a space.
func runeCells(r rune) int {
	if w := runewidth.RuneWidth(r); w > 0 {
		return w
	}
	return 1
}

func cellsOf(rs []rune) int {
	n := 0
	for _, r := range rs {
		n += runeCells(r)
	}
	return n
}

// ── the people pane ──────────────────────────────────────────────────────────

const (
	tagMuted  = "m"
	tagCam    = "c"
	tagScreen = "s"
)

func tagSpans(muted, cam, camOpen, screen, screenOpen bool) []Span {
	var out []Span
	if muted {
		out = append(out, Span{tagMuted, Style{FG: ThemeWarn}})
	}
	if cam {
		t := tagCam
		if camOpen {
			t = strings.ToUpper(t)
		}
		out = append(out, Span{t, Style{FG: ThemeAccentAlt}})
	}
	if screen {
		t := tagScreen
		if screenOpen {
			t = strings.ToUpper(t)
		}
		out = append(out, Span{t, Style{FG: ThemeInfo}})
	}
	if len(out) > 0 {
		out = append([]Span{{" ", Plain}}, out...)
	}
	return out
}

func dotSpan(on bool) Span {
	if on {
		return Span{"● ", Style{FG: ThemeOK}}
	}
	return Span{"○ ", Plain}
}

func drawPeople(c *Canvas, pane Rect, dividerX int, s RoomState) {
	x := pane.X + 1
	w := pane.W - 2
	right := x + w
	y := pane.Y

	// Clicking anywhere in this pane is asking to work the controls, which is what tab does.
	c.Hot(pane, Action{Kind: ActFocus, ID: "controls"})

	// You: the dot, the name, your tags; your send rate on the right.
	me := []Span{dotSpan(s.Me.Speaking && !s.Me.Muted), NameSpan(s.Me.Name, s.Me.Color, false)}
	me = append(me, tagSpans(s.Me.Muted, s.VideoEnabled && s.WebcamEnabled && s.Me.CamOn, false, s.ScreenSharing, false)...)
	c.PutSpans(x, y, me, right)
	if s.Stats != nil {
		up := fmt.Sprintf("↑%dk", s.Stats.SendKbps)
		c.Put(right-Width(up), y, up, Muted, right)
	}
	y++
	Divider(c, x, y, w)
	y++
	mine := []KeyHint{{Key: "m", Label: muteLabel(s.Me.Muted)}, {Key: "d", Label: "devices"}}
	if s.VideoEnabled {
		mine = append(mine, KeyHint{Key: "s", Label: shareLabel(s.ScreenSharing)})
	}
	if s.WebcamEnabled {
		mine = append(mine, KeyHint{Key: "v", Label: camLabel(s.Me.CamOn)})
	}
	if s.FileCount > 0 {
		mine = append(mine, KeyHint{Key: "f", Label: "files"})
	}
	y += DrawHints(c, x, y, w, disable(mine, s.InputFocused))
	// The section break: a rule from the divider to the frame.
	c.Set(dividerX, y, '├', ruleStyle)
	for i := dividerX + 1; i < c.W-1; i++ {
		c.Set(i, y, '─', ruleStyle)
	}
	c.Set(c.W-1, y, '┤', ruleStyle)
	y++

	// The peers.
	peersTop := y
	for i, p := range s.Peers {
		if y >= pane.Y+pane.H {
			break
		}
		c.Hot(Rect{pane.X, y, pane.W, 1}, Action{Kind: ActRow, ID: "peers", Idx: i})
		line := []Span{dotSpan(p.Speaking && !p.Muted)}
		if i == s.SelectedPeer {
			line = append(line, Span{"▸ ", Style{FG: ThemeAccent}})
		} else {
			line = append(line, Span{"  ", Plain})
		}
		line = append(line, NameSpan(p.Name, p.Color, false))
		line = append(line, tagSpans(p.Muted, p.CamOn, p.CamOpen, p.Screen, p.ScreenOpen)...)
		c.PutSpans(x, y, line, right)
		var nums []Span
		if p.RecvKbps >= 0 {
			nums = append(nums, Span{fmt.Sprintf("↓%dk ", p.RecvKbps), Muted})
		}
		if p.LatencyMs >= 0 {
			st := Muted
			if lc := latencyColor(p.LatencyMs); lc != "" {
				st = Style{FG: lc}
			}
			sep := ""
			if p.Volume != 1 {
				sep = " "
			}
			nums = append(nums, Span{fmt.Sprintf("~%dms%s", p.LatencyMs, sep), st})
		}
		if p.Volume != 1 {
			nums = append(nums, Span{fmt.Sprintf("%d%%", int(p.Volume*100+0.5)), Muted})
		}
		c.PutSpans(right-spansWidth(nums), y, nums, right)
		y++
	}
	if y > peersTop {
		c.Hot(Rect{pane.X, peersTop, pane.W, y - peersTop}, Action{Kind: ActScroll, ID: "peers"})
	}

	// Pinned to the bottom: the divider and the keys that act on the selected peer.
	peerHints := []KeyHint{{Key: "↑↓", Label: "select", Disabled: len(s.Peers) == 0}, {Key: "-/+", Label: "vol", Disabled: len(s.Peers) == 0}}
	if s.VideoEnabled {
		camOK, screenOK := false, false
		if s.SelectedPeer < len(s.Peers) {
			p := s.Peers[s.SelectedPeer]
			camOK = p.CamOpen || p.CamOn
			screenOK = p.Screen
		}
		peerHints = append(peerHints, KeyHint{Key: "w", Label: "cam", Disabled: !camOK}, KeyHint{Key: "e", Label: "screen", Disabled: !screenOK})
	}
	peerHints = disable(peerHints, s.InputFocused)
	rows := hintRows(peerHints, w)
	by := pane.Y + pane.H - rows - 1
	blockTop := by
	if s.Debug {
		// The debug panel takes what is left between the list and the keys.
		c.Set(dividerX, y, '├', ruleStyle)
		for i := dividerX + 1; i < c.W-1; i++ {
			c.Set(i, y, '─', ruleStyle)
		}
		c.Set(c.W-1, y, '┤', ruleStyle)
		y++
		c.Put(x, y, "Debug", Style{Bold: true}, right)
		avail := blockTop - (y + 1)
		lines := s.DebugLines
		if len(lines) > avail {
			lines = lines[len(lines)-avail:]
		}
		dy := blockTop - len(lines)
		if len(lines) == 0 {
			c.Put(x, blockTop-1, "Nothing yet", Muted, right)
		} else {
			c.Hot(Rect{x, dy, w, len(lines)}, Action{Kind: ActText, ID: "debug"})
		}
		// The panel shows the tail of a ring, so a row's index is into the whole of it.
		base := len(s.DebugLines) - len(lines)
		for i, l := range lines {
			spans := debugSpans(l)
			c.PutSpans(x, dy, spans, right)
			// A debug line is drawn clipped rather than wrapped, so what is copied is the
			// whole line and what is painted stops at the pane.
			c.MarkText("debug", TextRow{X: x, Y: dy, MaxX: right, Spans: spans, Src: base + i})
			dy++
		}
	}
	Divider(c, x, by, w)
	DrawHints(c, x, by+1, w, peerHints)
}

func hintRows(hints []KeyHint, width int) int {
	rows, cx := 1, 0
	for i, h := range hints {
		w := spansWidth(ChipSpans(h))
		gap := 0
		if i > 0 {
			gap = 1
		}
		if cx+gap+w > width && cx > 0 {
			rows++
			cx = 0
			gap = 0
		}
		cx += gap + w
	}
	return rows
}

func disable(hints []KeyHint, off bool) []KeyHint {
	if !off {
		return hints
	}
	out := make([]KeyHint, len(hints))
	for i, h := range hints {
		h.Disabled = true
		out[i] = h
	}
	return out
}

func muteLabel(muted bool) string {
	if muted {
		return "unmute"
	}
	return "mute"
}
func shareLabel(sharing bool) string {
	if sharing {
		return "stop share"
	}
	return "share"
}
func camLabel(on bool) string {
	if on {
		return "stop cam"
	}
	return "cam"
}

// DrawModal paints a panel over the room, centred: a rounded frame in the accent, the
// title, the list, the hints, on the theme background — opaque, so the room shows around
// it and not through it (modal.tsx). Padding two cells across, one down, as Ink had it.
func DrawModal(c *Canvas, title string, items []string, idx int, hints []KeyHint, list string) {
	// The screen behind it stands down for the mouse as it does for the keys.
	c.Modal()
	w := Width(title)
	for _, it := range items {
		if lw := Width(it) + 2; lw > w {
			w = lw
		}
	}
	if hw := HintsWidth(hints); hw > w {
		w = hw
	}
	innerW := w + 2
	innerH := 1 + 1 + len(items) + 1 + 1 // title, gap, items, gap, hints
	x := (c.W - (innerW + 2)) / 2
	y := (c.H - (innerH + 2)) / 2
	box := Rect{x, y, innerW + 2, innerH + 2}
	// A ring of background around the panel, which blanks whatever it is standing on: a
	// terminal has no way to dim what is behind, so the margin is what separates them.
	c.Fill(box.Inset(-1, -1), Style{BG: ThemeBG})
	c.Fill(box, Plain)
	RoundedBox(c, box, Style{FG: ThemeAccent})
	cx, cy := box.X+2, box.Y+1
	c.Put(cx, cy, title, Style{FG: ThemeAccent, Bold: true}, box.X+box.W-3)
	cy += 2
	DrawSelect(c, Rect{cx, cy, w, len(items)}, items, idx, list)
	cy += len(items) + 1
	DrawHints(c, cx, cy, w, hints)
}
