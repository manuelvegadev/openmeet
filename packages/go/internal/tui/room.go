package tui

import (
	"fmt"
	"strings"
	"time"
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
)

var entryIcons = map[EntryKind]string{KindMessage: "›", KindJoin: "+", KindLeave: "-", KindScreen: "▣", KindMute: "♪", KindInfo: "·"}
var entryIconColors = map[EntryKind]string{KindMessage: ThemeMuted, KindJoin: ThemeOK, KindLeave: ThemeDanger, KindScreen: ThemeInfo, KindMute: ThemeWarn, KindInfo: ThemeAccent}

// ChatEntry is one line of the conversation.
type ChatEntry struct {
	At    time.Time
	Kind  EntryKind
	Who   string // empty for a notice about nobody
	Color string
	Text  string
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

func entrySpans(e ChatEntry) []Span {
	spans := []Span{
		{"[" + FormatClock(e.At, false) + "] ", Muted},
		{entryIcons[e.Kind] + " ", Style{FG: entryIconColors[e.Kind]}},
	}
	textStyle := Plain
	if e.Kind != KindMessage {
		textStyle = Muted
	}
	if e.Who != "" {
		spans = append(spans, NameSpan(e.Who, e.Color, e.Kind == KindMessage), Span{" " + e.Text, textStyle})
	} else {
		spans = append(spans, Span{e.Text, textStyle})
	}
	return spans
}

func drawChat(c *Canvas, pane Rect, dividerX int, s RoomState) {
	textX := pane.X + 1
	textW := pane.W - 2
	// The composer takes the last three rows: the notice row, its rule, the input.
	inputY := pane.Y + pane.H - 1
	ruleY := inputY - 1
	noticeY := ruleY - 1
	logRows := noticeY - pane.Y

	// The log: entries up to the anchor, bottom-aligned, the newest at the bottom.
	last := len(s.Entries) - 1
	end := last
	if s.Anchor >= 0 && s.Anchor < last {
		end = s.Anchor
	}
	below := last - end
	var lines [][]Span
	if len(s.Entries) == 0 {
		lines = [][]Span{{{"No messages yet", Muted}}}
	} else {
		first := end + 1 - logRows
		if first < 0 {
			first = 0
		}
		for _, e := range s.Entries[first : end+1] {
			lines = append(lines, Wrap(entrySpans(e), textW)...)
		}
	}
	if below > 0 {
		word := "entries"
		if below == 1 {
			word = "entry"
		}
		lines = append(lines, []Span{{fmt.Sprintf("↓ %d more %s below", below, word), Muted}})
	}
	if len(lines) > logRows {
		lines = lines[len(lines)-logRows:]
	}
	y := noticeY - len(lines)
	for _, line := range lines {
		c.PutSpans(textX, y, line, textX+textW)
		y++
	}

	// The composer.
	if s.ClearArmed {
		msg := "esc again to clear"
		c.Put(textX+textW-Width(msg), noticeY, msg, Muted, textX+textW)
	}
	// Its rule ends on the divider.
	c.Set(0, ruleY, '├', ruleStyle)
	for x := 1; x < dividerX; x++ {
		c.Set(x, ruleY, '─', ruleStyle)
	}
	c.Set(dividerX, ruleY, '┤', ruleStyle)

	promptStyle := Style{FG: ThemeMuted, Bold: true}
	if s.InputFocused {
		promptStyle = Style{FG: ThemeOK, Bold: true}
	}
	chipLabel := "chat"
	if s.InputFocused {
		chipLabel = "controls"
	}
	chip := ChipSpans(KeyHint{Key: "tab", Label: chipLabel})
	chipW := spansWidth(chip)
	x := c.Put(textX, inputY, "> ", promptStyle, textX+textW)
	c.PutSpans(x, inputY, TextInputSpans(s.Draft, s.DraftCursor, "Type message...", s.InputFocused, s.Cursor), textX+textW-chipW-1)
	c.PutSpans(textX+textW-chipW, inputY, chip, textX+textW)
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
	y += DrawHints(c, x, y, w, disable(mine, s.InputFocused))
	// The section break: a rule from the divider to the frame.
	c.Set(dividerX, y, '├', ruleStyle)
	for i := dividerX + 1; i < c.W-1; i++ {
		c.Set(i, y, '─', ruleStyle)
	}
	c.Set(c.W-1, y, '┤', ruleStyle)
	y++

	// The peers.
	for i, p := range s.Peers {
		if y >= pane.Y+pane.H {
			break
		}
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
		}
		for _, l := range lines {
			c.PutSpans(x, dy, []Span{{"[" + FormatClock(l.At, true) + "] ", Muted}, {l.Text, Style{FG: ThemeAccentAlt}}}, right)
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
