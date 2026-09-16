package tui

import (
	"strings"
	"testing"
	"time"
)

// The conversation as bubbles: which side a message is on, when a run shares a box, and what
// a selection can and cannot reach.

func at(min int) time.Time {
	return time.Date(2026, 9, 14, 15, min/60, min%60, 0, time.Local)
}

func msg(who string, sec int, text string) ChatEntry {
	return ChatEntry{At: at(sec), Kind: KindMessage, Who: who, Color: "#22D3EE", Text: text}
}

// leftEdge is the column the block's first row starts drawing at.
func leftEdge(rows []logRow) int {
	return len(PlainText(rows[0].spans)) - len(strings.TrimLeft(PlainText(rows[0].spans), " "))
}

func TestYoursIsOnTheRightAndTheirsOnTheLeft(t *testing.T) {
	blocks := logRowsUpTo([]ChatEntry{msg("sofia", 10, "hola"), msg("mvega", 20, "hola")}, "mvega", 78, -1, 0)
	if len(blocks) != 2 {
		t.Fatalf("blocks = %d", len(blocks))
	}
	if leftEdge(blocks[0]) != 0 {
		t.Errorf("theirs starts at column %d, want 0", leftEdge(blocks[0]))
	}
	if leftEdge(blocks[1]) == 0 {
		t.Error("yours is not pushed to the right")
	}
	// And it ends at the right edge of the column.
	if w := Width(PlainText(blocks[1][0].spans)); w != 78 {
		t.Errorf("yours ends at %d, want the full 78", w)
	}
}

func TestARunFromOnePersonSharesABox(t *testing.T) {
	blocks := logRowsUpTo([]ChatEntry{
		msg("sofia", 10, "one"), msg("sofia", 20, "two"), msg("sofia", 30, "three"),
	}, "mvega", 78, -1, 0)
	if len(blocks) != 1 {
		t.Fatalf("blocks = %d, want one box", len(blocks))
	}
	// Two rows of frame and three of text, not nine rows of three boxes.
	if len(blocks[0]) != 5 {
		t.Fatalf("rows = %d, want 5", len(blocks[0]))
	}
	// The time beside the name is the last message's, so a box says when it was last added
	// to rather than when it was opened.
	if !strings.Contains(PlainText(blocks[0][0].spans), "15:00") {
		t.Errorf("top edge = %q", PlainText(blocks[0][0].spans))
	}
}

func TestAGapClosesTheBox(t *testing.T) {
	blocks := logRowsUpTo([]ChatEntry{
		msg("sofia", 10, "one"), msg("sofia", 10+int(groupWindow.Seconds())+1, "much later"),
	}, "mvega", 78, -1, 0)
	if len(blocks) != 2 {
		t.Errorf("blocks = %d, want two: the second is not the same moment", len(blocks))
	}
}

func TestAnythingInBetweenClosesTheBox(t *testing.T) {
	for _, between := range []ChatEntry{
		{At: at(15), Kind: KindJoin, Who: "amara", Text: "joined"},
		msg("diego", 15, "interrupting"),
		{At: at(15), Kind: KindFile, Who: "diego", File: &FileInfo{ID: "x", Name: "a.png", Kind: "img"}},
	} {
		entries := []ChatEntry{msg("sofia", 10, "one"), between, msg("sofia", 20, "two")}
		blocks := logRowsUpTo(entries, "mvega", 78, -1, 0)
		if len(blocks) != 3 {
			t.Errorf("%v in between gave %d blocks, want 3", between.Kind, len(blocks))
		}
	}
}

func TestAnEventIsNobodysBubble(t *testing.T) {
	blocks := logRowsUpTo([]ChatEntry{{At: at(10), Kind: KindJoin, Who: "amara", Text: "joined the room"}}, "mvega", 78, -1, 0)
	if len(blocks) != 1 || len(blocks[0]) != 1 {
		t.Fatalf("an event should be one row, got %d rows", len(blocks[0]))
	}
	line := PlainText(blocks[0][0].spans)
	if strings.ContainsAny(line, "╭│╰") {
		t.Errorf("an event was drawn in a box: %q", line)
	}
	if !strings.Contains(line, "— [amara] joined the room —") {
		t.Errorf("event = %q", line)
	}
	// Centred, so there is as much space after it as before.
	before := len(line) - len(strings.TrimLeft(line, " "))
	if before < 20 {
		t.Errorf("it is not centred: %d cells of margin", before)
	}
}

// The border must never reach the clipboard: only the name and the text are marked.
func TestOnlyTheWordsInABubbleAreText(t *testing.T) {
	e := msg("sofia", 10, "hola mundo")
	blocks := logRowsUpTo([]ChatEntry{e}, "mvega", 78, -1, 0)
	var marked []string
	for _, r := range blocks[0] {
		if r.src >= 0 {
			marked = append(marked, PlainText(r.text))
		}
	}
	want := []string{"[sofia]", "hola mundo"}
	if len(marked) != len(want) {
		t.Fatalf("marked %q, want %q", marked, want)
	}
	for i := range want {
		if marked[i] != want[i] {
			t.Errorf("marked[%d] = %q, want %q", i, marked[i], want[i])
		}
	}
	// And what a copy of the whole thing reads as.
	if got := entryText(e); got != "[sofia] hola mundo" {
		t.Errorf("entryText = %q", got)
	}
}

func TestAWindowTooSmallSaysSo(t *testing.T) {
	if !TooSmall(MinWidth-1, MinHeight) || !TooSmall(MinWidth, MinHeight-1) {
		t.Error("the minimum is not enforced")
	}
	if TooSmall(MinWidth, MinHeight) {
		t.Error("the minimum itself should be allowed")
	}
	c := NewCanvas(60, 20)
	DrawTooSmall(c, 60, 20)
	text := c.Text()
	if !strings.Contains(text, "make the window bigger") || !strings.Contains(text, "60×20") {
		t.Errorf("it does not say what is wrong:\n%s", text)
	}
}

// A bubble is a rectangle: every row of a block starts at the same column and ends at the
// same column. A box whose rows disagree by a cell puts a ragged edge down the conversation,
// and the eye sees that long before anybody works out why.
func TestABubbleIsARectangle(t *testing.T) {
	entries := []ChatEntry{
		msg("sofia", 10, "here's the trace from this morning, it has the spike at the end"),
		msg("mvega", 70, "yeah, four minutes on the i7. rebuilding wrtc is most of it"),
		msg("mvega", 75, "short"),
		{At: at(90), Kind: KindFile, Who: "diego", Color: "#4ADE80",
			File: &FileInfo{ID: "f", Name: "trace.zip", Kind: "zip", Size: 4718592, State: FileOffered}},
	}
	for _, width := range []int{40, 50, 60, 78, 100} {
		for bi, b := range logRowsUpTo(entries, "mvega", width, -1, 0) {
			var left, right = -1, -1
			for ri, r := range b {
				line := PlainText(r.spans)
				l := Width(line) - Width(strings.TrimLeft(line, " "))
				w := Width(line)
				if ri == 0 {
					left, right = l, w
					if w > width {
						t.Errorf("width %d, block %d: %d cells is wider than the column", width, bi, w)
					}
					continue
				}
				if l != left || w != right {
					t.Errorf("width %d, block %d row %d: starts at %d ends at %d, want %d and %d\n%q",
						width, bi, ri, l, w, left, right, line)
				}
			}
		}
	}
}

// One that is yours ends exactly at the column's edge; one that arrived starts at its left.
func TestABubbleIsFlushWithItsOwnSide(t *testing.T) {
	for _, width := range []int{50, 78, 100} {
		blocks := logRowsUpTo([]ChatEntry{msg("sofia", 10, "hola"), msg("mvega", 70, "hola")}, "mvega", width, -1, 0)
		theirs, mine := PlainText(blocks[0][0].spans), PlainText(blocks[1][0].spans)
		if strings.HasPrefix(theirs, " ") {
			t.Errorf("width %d: theirs is not flush left: %q", width, theirs)
		}
		if Width(mine) != width {
			t.Errorf("width %d: yours ends at %d, not at the edge", width, Width(mine))
		}
	}
}

// Scrolling can stop in the middle of a run, and a box that closes under the last visible
// message reads as a complete bubble with the rest of the run simply missing. It has to stay
// open instead. Cut at the top — which is what scrolling to the bottom of a tall box does —
// already reads as cut, because the top edge and the name are what is gone.
func TestABubbleCutInTheMiddleOfItsRunStaysOpen(t *testing.T) {
	entries := []ChatEntry{
		msg("sofia", 10, "one"), msg("sofia", 20, "two"), msg("sofia", 30, "three"),
	}
	whole := logRowsUpTo(entries, "mvega", 78, -1, 0)[0]
	if !strings.HasPrefix(strings.TrimLeft(PlainText(whole[len(whole)-1].spans), " "), "╰") {
		t.Fatal("a complete box should have a bottom edge")
	}

	cut := logRowsUpTo(entries, "mvega", 78, 1, 0)[0]
	last := strings.TrimLeft(PlainText(cut[len(cut)-1].spans), " ")
	if strings.HasPrefix(last, "╰") {
		t.Errorf("a box cut mid-run closed itself: %q", last)
	}
	// And it shows exactly the messages up to the scroll, with its top edge intact.
	if !strings.Contains(PlainText(cut[0].spans), "[sofia]") {
		t.Error("the cut box lost its name")
	}
	if len(cut) != 3 { // top, "one", "two"
		t.Errorf("rows = %d, want 3", len(cut))
	}
}

// The entry the room is scrolled to is the last one drawn, whatever kind it is.
func TestNothingBelowTheScrollIsDrawn(t *testing.T) {
	entries := []ChatEntry{
		msg("sofia", 10, "one"),
		{At: at(20), Kind: KindJoin, Who: "amara", Text: "joined"},
		msg("diego", 30, "three"),
	}
	if n := len(logRowsUpTo(entries, "mvega", 78, 0, 0)); n != 1 {
		t.Errorf("blocks = %d, want 1", n)
	}
	if n := len(logRowsUpTo(entries, "mvega", 78, 1, 0)); n != 2 {
		t.Errorf("blocks = %d, want 2", n)
	}
	if n := len(logRowsUpTo(entries, "mvega", 78, -1, 0)); n != 3 {
		t.Errorf("blocks = %d, want all 3", n)
	}
}

// The bar is drawn in eighth blocks, which is what gives twenty cells the resolution to say
// anything: a percent that moves by one has to be visible somewhere.
func TestTheProgressBarHasEighthResolution(t *testing.T) {
	seen := map[string]bool{}
	for pct := 0; pct <= 100; pct++ {
		f := FileInfo{ID: "a", Kind: "zip", Size: 1000, Done: int64(pct) * 10, State: FileReceiving}
		seen[PlainText(fileButtonSpansFor(f))] = true
	}
	// Twenty cells at eight steps each is 160 distinguishable positions, so a hundred
	// percentages must all look different. A whole-block bar would give twenty-one.
	if len(seen) < 100 {
		t.Errorf("%d distinguishable bars across 101 percentages — the eighths are not being used", len(seen))
	}
}

// The speed sits beside it, and goes when the transfer does.
func TestTheSpeedIsShownWhileItMoves(t *testing.T) {
	moving := PlainText(fileButtonSpansFor(FileInfo{Size: 1000, Done: 250, Rate: 1887436, State: FileReceiving}))
	if !strings.Contains(moving, "1.8 MB/s") {
		t.Errorf("no speed on a transfer in flight: %q", moving)
	}
	still := PlainText(fileButtonSpansFor(FileInfo{Size: 1000, Done: 250, State: FileReceiving}))
	if strings.Contains(still, "/s") {
		t.Errorf("a speed with nothing to measure: %q", still)
	}
}

func fileButtonSpansFor(f FileInfo) []Span {
	var out []Span
	for _, b := range fileButtons(f) {
		out = append(out, b.span)
	}
	return out
}
