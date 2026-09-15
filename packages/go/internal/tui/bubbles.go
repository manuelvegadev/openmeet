package tui

import (
	"fmt"
	"strings"
	"time"

	"github.com/manuelvegadev/openmeet/packages/go/internal/files"
)

// The conversation, drawn as bubbles.
//
// A message is a box on the side it came from: yours on the right in the accent, theirs on
// the left in grey, the name in brackets on the outer edge and the time on the opposite
// corner, so the box points at its own side without needing a tail. A run from one person
// shares a box. A file is not somebody talking, so it takes the whole width. A room event is
// not anybody's at all, so it is centred, dim, and has no box.
//
// What this replaces is the Node client's log — one line per entry, timestamp, icon, name,
// text. `testdata/room.txt` was that frame, cell for cell, and regenerating it is the
// decision recorded in golden_test.go: the second screen to diverge on purpose.
//
// The selection survives it untouched, because a selection here was never cells on screen:
// it is which entry and how many runes into that entry's own text (see selection.go). Only
// the rows that carry text are marked, and they are marked with the text alone — never the
// frame around it — so a bubble that wrapped over four rows still copies as the one line it
// is, and a border can never end up on the clipboard.

const (
	// How much of the column a bubble may take, and the width below which it stops trying:
	// on a narrow pane everything goes full width, the way a phone draws a conversation,
	// because two columns of forty cells are not two columns, they are a mess.
	bubbleShare  = 80
	bubbleNarrow = 60
	// A run from one person shares a box only while it is still the same moment. Anything in
	// between — an event, a file, anybody else — closes it regardless.
	groupWindow = 2 * time.Minute
)

// bubbleWidth is the widest a bubble may be drawn in a column of this width.
func bubbleWidth(width int) int {
	if width < bubbleNarrow {
		return width
	}
	return max(bubbleNarrow/2, width*bubbleShare/100)
}

// logBlock is what gets drawn as one thing.
type logBlock struct {
	kind string // "msg" | "file" | "event"
	from int    // first entry, inclusive
	to   int    // last entry, inclusive
	mine bool
}

// groups is the whole of the rule: a run from one person shares a box while it is still the
// same moment, and anything in between — an event, a file, anybody else — closes it, because
// those are never the same block.
func groups(prev, next ChatEntry) bool {
	return prev.Kind == KindMessage && next.Kind == KindMessage &&
		prev.Who == next.Who && next.At.Sub(prev.At) <= groupWindow &&
		next.At.After(prev.At.Add(-time.Second))
}

// blockEndingAt is the block whose last entry is `i`, found by walking *backwards* — which is
// what lets the conversation be laid out from the newest end and stopped once the pane is
// full, instead of grouping the whole history to draw the last screenful of it. `cut` is a
// run that continues past `i`, which only happens where the scroll stopped inside one.
func blockEndingAt(entries []ChatEntry, me string, i int) (b logBlock, cut bool) {
	e := entries[i]
	switch {
	case e.Kind == KindFile:
		return logBlock{"file", i, i, e.File != nil && e.File.Mine}, false
	case e.Kind != KindMessage:
		return logBlock{"event", i, i, false}, false
	}
	from := i
	for from > 0 && groups(entries[from-1], entries[from]) {
		from--
	}
	cut = i+1 < len(entries) && groups(entries[i], entries[i+1])
	return logBlock{"msg", from, i, e.Who != "" && e.Who == me}, cut
}

// entryText is the line one entry reads as: the string the selection counts its offsets in,
// and the string a copy puts on the clipboard. None of how it was drawn is in it.
func entryText(e ChatEntry) string {
	switch {
	case e.Kind == KindFile && e.File != nil:
		return fileCardText(*e.File, e.Who)
	case e.Kind == KindMessage:
		if e.Who == "" {
			return e.Text
		}
		return Bracketed(e.Who) + " " + e.Text
	}
	return eventText(e)
}

func eventText(e ChatEntry) string {
	if e.Who == "" {
		return "— " + e.Text + " —"
	}
	return "— " + Bracketed(e.Who) + " " + e.Text + " —"
}

func fileCardText(f FileInfo, who string) string {
	return Bracketed(who) + " shared " + f.Kind + " " + f.Name + "  " + files.FormatSize(f.Size)
}

// logRow is one drawn row of the conversation: everything to paint, the slice of it that is
// text — which is what the selection and a copy work in — and anything on it the mouse can
// press.
type logRow struct {
	spans []Span
	// The selectable part. src < 0 is a row that is not text: a border, a spacer, a file.
	textX, textW int
	text         []Span
	src, off     int
	hots         []logHot
}

// logHot is a button drawn into a row: where it is, and what it does. The ids are the ones
// press() knows (see mouse.go); a file's buttons are the mouse's, because a gold key cap in
// this interface means "this key does this" and with two cards on screen one key cannot mean
// both.
type logHot struct {
	id   string
	idx  int
	x, w int
}

func frameRow(spans []Span) logRow { return logRow{spans: spans, src: -1} }

// ── the pieces ──────────────────────────────────────────────────────────────

func bubbleEdge(mine bool) Style {
	if mine {
		return Style{FG: ThemeAccent}
	}
	return Style{FG: ThemeMuted}
}

// messageRows draws one block of messages as a single bubble. `cut` is a box whose run does
// not end here — the conversation is scrolled to a point inside it — and it is drawn without
// a bottom edge, because a closed box says "this is all of it" and that would be a lie.
func messageRows(entries []ChatEntry, b logBlock, width int, cut bool) []logRow {
	first := entries[b.from]
	last := entries[b.to]
	edge := bubbleEdge(b.mine)
	name := Bracketed(first.Who)
	when := FormatClock(last.At, false)

	maxBox := bubbleWidth(width)

	// Every line of every message in the block, each remembering where it came from.
	type textLine struct {
		spans []Span
		src   int
		off   int
	}
	body := make([]textLine, 0, b.to-b.from+1)
	textW := max(1, maxBox-4)
	for i := b.from; i <= b.to; i++ {
		e := entries[i]
		prefix := 0
		if e.Who != "" {
			prefix = len([]rune(Bracketed(e.Who))) + 1 // entryText puts the name in front
		}
		lines, offs := WrapOffsets([]Span{{e.Text, Plain}}, textW)
		for j, l := range lines {
			body = append(body, textLine{l, i, prefix + offs[j]})
		}
	}

	// The time sits beside the name, on the outer edge — the side the bubble belongs to — so
	// it is the first thing read on a message that arrived and the last on one that was sent.
	tag := when + " " + name
	if b.mine {
		tag = name + " " + when
	}
	inner := 0
	for _, l := range body {
		inner = max(inner, spansWidth(l.spans)+2)
	}
	inner = max(inner, Width(tag)+3)
	inner = min(inner, max(4, min(maxBox-2, width-2)))
	box := inner + 2
	left := 0
	if b.mine {
		left = max(0, width-box)
	}

	pad := max(0, inner-Width(tag)-3)
	whenSpan := Span{when, Muted}
	nameSpan := NameSpan(first.Who, first.Color, true)
	var top []Span
	nameX := left + 3 + Width(when) + 1
	if b.mine {
		nameX = left + 1 + pad + 2
		top = []Span{{strings.Repeat(" ", left), Plain}, {"╭", edge}, {strings.Repeat("─", pad), edge},
			{"─ ", edge}, nameSpan, {" ", edge}, whenSpan, {" ", edge}, {"╮", edge}}
	} else {
		top = []Span{{strings.Repeat(" ", left), Plain}, {"╭", edge}, {"─ ", edge}, whenSpan,
			{" ", edge}, nameSpan, {" ", edge}, {strings.Repeat("─", pad), edge}, {"╮", edge}}
	}
	// The name is drawn on the edge, so it is where the entry's first runes are: selecting a
	// bubble from its top-left corner copies `[ana] what ana said`, the way the log did when
	// the name was part of the line. The border and the time around it are not text.
	rows := []logRow{{spans: top, textX: nameX, textW: Width(name), text: []Span{nameSpan}, src: b.from, off: 0}}
	for _, l := range body {
		fill := max(0, inner-2-spansWidth(l.spans))
		row := []Span{{strings.Repeat(" ", left), Plain}, {"│", edge}, {" ", Plain}}
		row = append(row, l.spans...)
		row = append(row, Span{strings.Repeat(" ", fill), Plain}, Span{" ", Plain}, Span{"│", edge})
		rows = append(rows, logRow{spans: row, textX: left + 2, textW: inner - 2, text: l.spans, src: l.src, off: l.off})
	}
	if cut {
		return rows
	}
	bot := []Span{{strings.Repeat(" ", left), Plain}, {"╰", edge},
		{strings.Repeat("─", inner), edge}, {"╯", edge}}
	return append(rows, frameRow(bot))
}

// eventRows is a room event: centred, dim, no box. Nobody said it, so it is nobody's bubble.
func eventRows(e ChatEntry, width int) []logRow {
	text := eventText(e)
	pad := max(0, (width-Width(text))/2)
	spans := []Span{{text, Muted}}
	row := append([]Span{{strings.Repeat(" ", pad), Plain}}, spans...)
	return []logRow{{spans: row, textX: pad, textW: Width(text), text: spans, src: -1}}
}

// fileRows is a file: the whole width, because a file is not somebody talking. The buttons
// are the mouse's — a grey pill with no gold cap, since a cap in this interface means "this
// key does this", and with two cards on screen one key cannot mean both.
func fileRows(e ChatEntry, idx, width int) []logRow {
	f := e.File
	edge := bubbleEdge(f.Mine)
	inner := max(8, width-2)
	name := Bracketed(e.Who)
	when := FormatClock(e.At, false)
	head := name + " shared"
	pad := max(0, inner-Width(head)-Width(when)-6)
	top := []Span{{"╭", edge}, {"─ ", edge}, NameSpan(e.Who, e.Color, true), {" shared", Muted},
		{" ", edge}, {strings.Repeat("─", pad), edge}, {" ", edge}, {when, Muted}, {" ─", edge}, {"╮", edge}}

	body := []Span{{" " + f.Kind + " ", chipKey}, {" " + f.Name + " ", chipLabel}}
	if f.State == FileSaved {
		body = append(body, Span{" ✓", Style{FG: ThemeOK}})
	}
	body = append(body, Span{"  " + files.FormatSize(f.Size), Muted})

	// The buttons, laid out left to right so each one knows where it landed: a click has to
	// reach the pill under it, not the row it sits on.
	btns := fileButtons(*f)
	var bspans []Span
	var hots []logHot
	bw := 0
	for i, b := range btns {
		if i > 0 {
			bspans = append(bspans, Span{" ", Plain})
			bw++
		}
		bspans = append(bspans, b.span)
		if b.id != "" {
			hots = append(hots, logHot{id: b.id, idx: idx, x: bw, w: Width(b.span.Text)})
		}
		bw += Width(b.span.Text)
	}
	space := max(1, inner-2-spansWidth(body)-bw)
	at := 2 + spansWidth(body) + space
	for i := range hots {
		hots[i].x += at
	}

	content := append([]Span{{"│", edge}, {" ", Plain}}, body...)
	content = append(content, Span{strings.Repeat(" ", space), Plain})
	content = append(content, bspans...)
	content = append(content, Span{" ", Plain}, Span{"│", edge})

	bot := []Span{{"╰", edge}, {strings.Repeat("─", inner), edge}, {"╯", edge}}
	return []logRow{
		frameRow(top),
		{spans: content, src: -1, hots: hots},
		frameRow(bot),
	}
}

// fileButton is a drawn pill and what pressing it does. An empty id is not a button: it is
// the progress bar, or a line of state with nothing to press.
type fileButton struct {
	span Span
	id   string
}

// fileButtons is what can be done with a file here, in the order it is drawn.
func fileButtons(f FileInfo) []fileButton {
	pill := func(s, id string) fileButton { return fileButton{Span{" " + s + " ", chipLabel}, id} }
	switch f.State {
	case FileReceiving, FileSending:
		return []fileButton{
			{Span{progressBar(f.Percent(), 20), Style{FG: ThemeInfo}}, ""},
			{Span{" " + itoa(f.Percent()) + "%", Style{FG: ThemeInfo}}, ""},
		}
	case FileWaiting:
		return []fileButton{{Span{"asking…", Muted}, ""}}
	case FileGone:
		return []fileButton{{Span{"no longer available", Style{FG: ThemeDanger}}, ""}}
	case FileSaved:
		out := []fileButton{pill("open", "file:open"), pill("in folder", "file:reveal")}
		if HasPreview {
			out = append(out, pill("preview", "file:preview"))
		}
		return out
	}
	if f.Mine {
		return []fileButton{pill("in folder", "file:reveal")}
	}
	return []fileButton{pill("download", "file:get")}
}

// HasPreview is whether this system means something by previewing a file that it does not
// mean by opening one. macOS has Quick Look; Windows does not, so the button is not drawn.
// A var rather than the constant it mirrors, so a test can draw either platform's card.
var HasPreview = files.HasPreview

func progressBar(pct, width int) string {
	n := clampInt(pct*width/100, 0, width)
	return strings.Repeat("█", n) + strings.Repeat("░", width-n)
}

// logRowsUpTo lays the conversation out, oldest first, up to and including entry `end` —
// where the room has been scrolled to, or the last entry when it is following the tail; -1
// for all of them. `maxRows` is how many rows the caller can show (0 for no limit): blocks
// are built backwards from `end` and stop as soon as there are enough, so the work of a
// repaint is the size of the pane and not the size of the room's history.
//
// The reason `end` is here rather than the caller slicing the entries first: a run from one
// person is one box, and scrolling can stop in the middle of one. Sliced beforehand, the box
// closes under the last visible message and reads as a complete bubble with the rest of the
// run missing. Given `end`, it knows it was cut and leaves itself open.
func logRowsUpTo(entries []ChatEntry, me string, width, end, maxRows int) [][]logRow {
	if end < 0 || end >= len(entries) {
		end = len(entries) - 1
	}
	if end < 0 {
		return nil
	}
	var out [][]logRow
	rows := 0
	for i := end; i >= 0; {
		b, cut := blockEndingAt(entries, me, i)
		var block []logRow
		switch b.kind {
		case "event":
			block = eventRows(entries[b.from], width)
		case "file":
			block = fileRows(entries[b.from], b.from, width)
		default:
			block = messageRows(entries, b, width, cut)
		}
		out = append(out, block)
		rows += len(block) + 1 // the blank row between blocks
		if maxRows > 0 && rows >= maxRows {
			break
		}
		i = b.from - 1
	}
	// Built backwards; the conversation reads forwards.
	for l, r := 0, len(out)-1; l < r; l, r = l+1, r-1 {
		out[l], out[r] = out[r], out[l]
	}
	return out
}

// ── the window, when it is too small ────────────────────────────────────────

// The smallest window the room is drawn in. The participants pane is a fixed 37 cells and
// the frame takes two, so a bubble of any use needs the rest; the height is four bubbles and
// the composer. Provisional: measured against the design rather than against anybody using
// it, and the sort of number that should move once somebody has.
const (
	MinWidth  = 90
	MinHeight = 28
)

// TooSmall is whether the room would be drawn into a window it does not fit.
func TooSmall(w, h int) bool { return w < MinWidth || h < MinHeight }

// DrawTooSmall replaces the room with the reason it is not there. Drawing the room anyway is
// what happened before — a frame with its middle squeezed out — which reads as a bug rather
// than as a window that wants pulling wider.
func DrawTooSmall(c *Canvas, w, h int) {
	Centered(c, Rect{0, 0, c.W, c.H}, [][]Span{
		{{"OpenMeet", Style{FG: ThemeAccent, Bold: true}}},
		nil,
		{{"Please make the window bigger.", Plain}},
		nil,
		{{fmt.Sprintf("It is %d×%d; this needs at least %d×%d.", w, h, MinWidth, MinHeight), Muted}},
	})
}
