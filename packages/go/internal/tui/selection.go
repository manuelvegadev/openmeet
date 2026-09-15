package tui

import (
	"strings"
	"unicode"
)

// The selection is ours, not the terminal's, and that is the point rather than a compromise.
//
// A terminal selects cells, so it takes the frame with the text: the borders, the rule, the
// pane of participants beside the conversation, and a message that wrapped over three rows
// comes out as three lines that were never three lines. This one is two positions in the
// conversation — which entry, how many runes in — so it can only ever contain conversation,
// and a wrapped message copies as the single line it is.
//
// The bridge between the two worlds is the wrap map the chat records while it draws (see
// WrapOffsets and Canvas.MarkText): screen row → entry and offset, and back again.

type selection struct {
	active bool
	// Which pane it lives in: the conversation, or the debug panel beside it. A selection
	// belongs to one region and cannot reach out of it, which is the whole idea.
	region string
	anchor TextPos
	cursor TextPos
	// A drag in progress: motion moves the cursor until the button comes up.
	dragging bool
	// What a click does next, from how many landed in the same place in a row: 2 is a word,
	// 3 the whole entry. Anchored so a double click that began one keeps extending by words.
	unit string // "" | "word" | "line"
}

func (s *selection) empty() bool { return !s.active || s.anchor == s.cursor }

func (s *selection) clear() { *s = selection{} }

// rng is the selection the way it reads, whichever end it was started from.
func (s *selection) rng() (TextPos, TextPos) { return Order(s.anchor, s.cursor) }

// SelectionRange is what the model hands the canvas to paint. Empty when there is nothing.
func (m *Model) SelectionRange() (TextPos, TextPos, bool) {
	if m.sel.empty() {
		return TextPos{}, TextPos{}, false
	}
	from, to := m.sel.rng()
	return from, to, true
}

// lineText is one line of whichever region the selection is in, as its own text.
func (m *Model) lineText(src int) string {
	switch m.sel.region {
	case "input":
		// The composer is one logical line however many rows it wrapped onto.
		if src != 0 {
			return ""
		}
		return m.draft.value
	case "debug":
		if src < 0 || src >= len(m.debugLines) {
			return ""
		}
		return PlainText(debugSpans(m.debugLines[src]))
	default:
		if src < 0 || src >= len(m.rs.Entries) {
			return ""
		}
		return entryText(m.rs.Entries[src])
	}
}

func (m *Model) regionLen() int {
	switch m.sel.region {
	case "input":
		return 1
	case "debug":
		return len(m.debugLines)
	}
	return len(m.rs.Entries)
}

// draftSelection is the range the composer has selected, if the selection is the composer's.
func (m *Model) draftSelection() (from, to int, ok bool) {
	if m.sel.region != "input" || m.sel.empty() {
		return 0, 0, false
	}
	a, b := m.sel.rng()
	return a.Off, b.Off, true
}

// dropDraftSelection removes what is selected in the composer and reports whether it did.
// Every edit goes through it first, which is what makes typing, pasting and backspace all
// replace a selection the way a field does everywhere else.
func (m *Model) dropDraftSelection() bool {
	from, to, ok := m.draftSelection()
	if !ok {
		return false
	}
	m.draft.cut(from, to)
	m.sel.clear()
	return true
}

// SelectedText is the conversation the selection covers. One entry is one line however many
// rows it took, and entries are joined by newlines, because that is what was selected: lines
// of a conversation, not rows of a terminal.
func (m *Model) SelectedText() string {
	from, to, ok := m.SelectionRange()
	if !ok {
		return ""
	}
	var out []string
	for i := from.Src; i <= to.Src && i < m.regionLen(); i++ {
		if i < 0 {
			continue
		}
		r := []rune(m.lineText(i))
		lo, hi := 0, len(r)
		if i == from.Src {
			lo = clampInt(from.Off, 0, len(r))
		}
		if i == to.Src {
			hi = clampInt(to.Off, 0, len(r))
		}
		if lo > hi {
			lo = hi
		}
		out = append(out, strings.TrimRight(string(r[lo:hi]), " "))
	}
	return strings.Join(out, "\n")
}

func clampInt(v, lo, hi int) int { return min(hi, max(lo, v)) }

// extend moves the loose end of the selection to a position, snapping both ends out to the
// word or the entry when the click that started it asked for one.
func (m *Model) extend(p TextPos) {
	switch m.sel.unit {
	case "word":
		aw := m.wordAt(m.sel.anchor)
		pw := m.wordAt(p)
		if p.before(m.sel.anchor) {
			m.sel.anchor, m.sel.cursor = TextPos{aw.Src, aw.Off + aw.Len}, TextPos{pw.Src, pw.Off}
		} else {
			m.sel.anchor, m.sel.cursor = TextPos{aw.Src, aw.Off}, TextPos{pw.Src, pw.Off + pw.Len}
		}
	case "line":
		lo, hi := m.sel.anchor.Src, p.Src
		if hi < lo {
			lo, hi = hi, lo
		}
		m.sel.anchor = TextPos{lo, 0}
		m.sel.cursor = TextPos{hi, m.entryLen(hi)}
	default:
		m.sel.cursor = p
	}
}

func (m *Model) entryLen(src int) int { return len([]rune(m.lineText(src))) }

type wordSpan struct{ Src, Off, Len int }

// wordAt is the run under a position: letters, digits and underscores together, and any
// other run of non-spaces together too, so a name in brackets or a URL comes out whole.
func (m *Model) wordAt(p TextPos) wordSpan {
	r := []rune(m.lineText(p.Src))
	if len(r) == 0 {
		return wordSpan{p.Src, 0, 0}
	}
	i := clampInt(p.Off, 0, len(r)-1)
	if r[i] == ' ' {
		start, end := i, i
		for start > 0 && r[start-1] == ' ' {
			start--
		}
		for end < len(r)-1 && r[end+1] == ' ' {
			end++
		}
		return wordSpan{p.Src, start, end - start + 1}
	}
	word := isWordRune(r[i])
	start, end := i, i
	for start > 0 && r[start-1] != ' ' && isWordRune(r[start-1]) == word {
		start--
	}
	for end < len(r)-1 && r[end+1] != ' ' && isWordRune(r[end+1]) == word {
		end++
	}
	return wordSpan{p.Src, start, end - start + 1}
}

func isWordRune(r rune) bool {
	return unicode.IsLetter(r) || unicode.IsDigit(r) || r == '_'
}
