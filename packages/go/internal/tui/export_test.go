package tui

// The website's terminal, exported from the one that draws it.
//
// `packages/website` used to carry a hand-written copy of this room: the same bubbles, the
// same cards, the same composer, built out of HTML by somebody reading the Go. It was never
// quite right and it went out of date every time the room changed, quietly, in the direction
// nobody checks.
//
// So it is generated instead. The demo script (`internal/demo`) is played against a canvas,
// the canvas is written out as cells, and the page paints those cells. What the page shows
// is what this package drew — not a drawing of it.
//
// Two things make that cheap enough to ship:
//
//   - Colours go out as **names**, not values. A cell is `accent` or `muted`, and the page
//     decides what those are, which is how the Look panel still reaches inside the terminal.
//     `SetTheme` is the only thing that knows the numbers, here and there.
//   - Only what changes is written. The frame, the rule and the divider are drawn once; the
//     header, the participants, the composer and each block of the conversation carry a list
//     of versions with the moment each one takes over. A run of 5 500 cells thirty seconds
//     long comes to a couple of kilobytes over the wire.
//
// Regenerate with:
//
//	OPENMEET_REGEN=1 go test ./internal/tui -run WebsiteTerminal
//
// TestWebsiteTerminalIsCurrent runs the same export and compares, so changing how the room
// draws without regenerating fails here rather than on the landing page.

import (
	"encoding/json"
	"fmt"
	"os"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/manuelvegadev/openmeet/packages/go/internal/demo"
)

// The window the page draws. Wide enough for the conversation to wrap where a real one does
// — 138 columns leaves 99 for the chat beside the fixed 37 of the participants — and 33 rows,
// which is a terminal somebody has not resized.
const (
	exportCols = 138
	exportRows = 33
)

// How much of the script the page carries. The last transfer is five gigabytes and the demo
// lets it run for a minute, then starts it again; the page keeps the first stretch of it,
// which is enough to watch the bar move and the rate settle.
const exportBudget = 36 * time.Second

// terminalJSON is where it lands, from this directory.
const terminalJSON = "../../../website/src/content/terminal.json"

// ── the file ────────────────────────────────────────────────────────────────

// span is one run of text in one style: [text], [text, fg], [text, fg, bg] or
// [text, fg, bg, 1] for bold. The tail is dropped when it says nothing, because a frame is
// mostly text in no style at all and the shortest form is most of the file.
type span []any

type version struct {
	From float64  `json:"from"`
	To   float64  `json:"to,omitempty"` // 0 = to the end
	Rows [][]span `json:"rows"`
	// Set on a draft that is being typed: how many cells the text is, so the page can reveal
	// it a character at a time instead of shipping a frame per keystroke.
	Type int `json:"type,omitempty"`
	// Where the caret sits in the composer, in cells from the left of the draft. The room
	// draws it as an inverted cell and blinks it from the model's own clock, which is not a
	// thing to export a frame of: the page draws it, and on a version being typed it rides
	// the reveal instead of standing at the end of a message not written yet.
	Caret int `json:"caret,omitempty"`
}

// area is one rectangle of the screen and every version of it, in the order they take over.
type area struct {
	X int       `json:"x"`
	Y int       `json:"y"`
	W int       `json:"w"`
	H int       `json:"h"`
	V []version `json:"v"`
}

func areaOf(tr *tracked) area {
	return area{tr.rect.X, tr.rect.Y, tr.rect.W, tr.rect.H, tr.versions}
}

type terminal struct {
	Cols     int     `json:"cols"`
	Rows     int     `json:"rows"`
	Duration float64 `json:"duration"`
	// The frame, the rule and the divider — the part of the screen no region covers.
	Chrome area `json:"chrome"`
	Header area `json:"header"`
	People area `json:"people"`
	// The conversation: one list of versions per block, in the order they are stacked. The
	// page stacks them against the bottom of `log` and clips at the top, which is what the
	// room does with them.
	Log [][]version `json:"log"`
	// Where the conversation is drawn. Only a rectangle: the blocks in Log stack inside it.
	LogRect  area `json:"logRect"`
	Composer area `json:"composer"`
	Draft    area `json:"draft"`
}

// ── colours by name ─────────────────────────────────────────────────────────

// A colour goes out as the name of the thing it means. The page holds one custom property
// per name, so choosing an accent or a light ground repaints the terminal exactly as
// Settings ▸ Look repaints the application.
func bgToken(bg string) (string, bool) {
	switch bg {
	case "":
		return "", true
	case ThemeBG:
		return "bg", true
	case ThemeSurface:
		return "surface", true
	case ThemeAccent:
		return "accent", true
	case ThemeSelection:
		return "selection", true
	}
	return "", false
}

// A cell that paints its own background carries its own foreground (gotcha 40), so which
// name a foreground has depends on what is behind it.
func fgToken(fg, bg string) (string, bool) {
	switch bg {
	case ThemeAccent:
		if fg == ThemeOnAccent {
			return "on-accent", true
		}
	case ThemeSurface:
		if fg == ThemeOnSurface {
			return "on-surface", true
		}
	case ThemeSelection:
		if fg == ThemeSelectionText {
			return "selection-text", true
		}
	}
	switch fg {
	case "":
		return "", true
	case ThemeText:
		return "text", true
	case ThemeMuted:
		return "muted", true
	case ThemeSurface:
		// The unfilled half of a progress bar: a block character in the colour a surface is,
		// rather than a surface behind a space, so the bar is one run of ████ either way.
		return "surface", true
	case ThemeAccent:
		return "accent", true
	case ThemeAccentAlt:
		return "accent-alt", true
	case ThemeOK:
		return "ok", true
	case ThemeWarn:
		return "warn", true
	case ThemeDanger:
		return "danger", true
	case ThemeInfo:
		return "info", true
	}
	for _, p := range NamePalette {
		if p.Hex == fg {
			return "name-" + p.Name, true
		}
	}
	return "", false
}

// The characters the page can draw: the union of every `unicode-range` in the stylesheet
// that declares the faces, read from the stylesheet rather than copied out of it.
//
// A character outside them is drawn by whatever monospace the reader's machine has, at that
// font's advance rather than JetBrains Mono's 0.6 em — and a terminal is a grid, so one
// character in the wrong font throws a whole row's columns out. It fails the export instead.
const websiteFonts = "../../../website/src/styles/_fonts.scss"

var unicodeRange = regexp.MustCompile(`unicode-range:([^;]+);`)
var unicodeSpan = regexp.MustCompile(`U\+([0-9A-Fa-f]+)(?:-([0-9A-Fa-f]+))?`)

func websiteRunes(t *testing.T) [][2]rune {
	t.Helper()
	src, err := os.ReadFile(websiteFonts)
	if err != nil {
		return nil // no website package here: nothing to hold the export to
	}
	var out [][2]rune
	for _, decl := range unicodeRange.FindAllStringSubmatch(string(src), -1) {
		for _, m := range unicodeSpan.FindAllStringSubmatch(decl[1], -1) {
			lo, _ := strconv.ParseInt(m[1], 16, 32)
			hi := lo
			if m[2] != "" {
				hi, _ = strconv.ParseInt(m[2], 16, 32)
			}
			out = append(out, [2]rune{rune(lo), rune(hi)})
		}
	}
	if len(out) == 0 {
		t.Fatalf("%s declares no unicode-range: the export cannot tell what the page can draw", websiteFonts)
	}
	return out
}

func (e *exporter) drawable(r rune) bool {
	if e.fontRanges == nil {
		return true
	}
	for _, rg := range e.fontRanges {
		if r >= rg[0] && r <= rg[1] {
			return true
		}
	}
	return false
}

// span turns one drawn run into what the page carries, and notes anything the page could not
// reproduce: a colour the theme has no name for, and a character it has no glyph for. Both
// fail the export rather than reaching the page as a cell the Look panel cannot touch or a
// run in a font of the wrong width.
func (e *exporter) span(sp Span) span {
	for _, r := range sp.Text {
		if !e.drawable(r) {
			e.stray[r] = true
		}
	}
	st := sp.St
	fg, bg := st.FG, st.BG
	if st.Inverse {
		if fg == "" {
			fg = ThemeText
		}
		if bg == "" {
			bg = ThemeBG
		}
		fg, bg = bg, fg
	}
	fgName, okFG := fgToken(fg, bg)
	bgName, okBG := bgToken(bg)
	if !okFG {
		e.un[fg] = true
	}
	if !okBG {
		e.un[bg] = true
	}
	switch {
	case st.Bold:
		return span{sp.Text, fgName, bgName, 1}
	case bgName != "":
		return span{sp.Text, fgName, bgName}
	case fgName != "":
		return span{sp.Text, fgName}
	}
	return span{sp.Text}
}

func (e *exporter) rows(in [][]Span) [][]span {
	out := make([][]span, 0, len(in))
	for _, row := range in {
		r := make([]span, 0, len(row))
		// A row's trailing blank in no style paints nothing, and there are 138 columns of it
		// in places. The page lays cells out as text, so dropping it costs nothing.
		for len(row) > 0 {
			last := row[len(row)-1]
			if last.St == (Style{}) && strings.TrimRight(last.Text, " ") == "" {
				row = row[:len(row)-1]
				continue
			}
			break
		}
		for _, sp := range row {
			r = append(r, e.span(sp))
		}
		out = append(out, r)
	}
	return out
}

// ── the stage ───────────────────────────────────────────────────────────────

// exporter plays the demo script against a canvas and keeps what changed. It is the same
// Stage the application implements, so the two are watching the same call.
type exporter struct {
	t     *testing.T
	base  time.Time
	now   time.Time
	rs    RoomState
	files map[string]*FileInfo
	// Everything the page could not reproduce, collected as the frames are built: a colour
	// the theme has no name for, and a character the shipped font has no glyph for.
	un    map[string]bool
	stray map[rune]bool
	// What the page's own @font-face rules say it can draw, read from the stylesheet.
	fontRanges [][2]rune

	toastAt time.Time

	chrome   *tracked
	header   *tracked
	people   *tracked
	composer *tracked
	draft    *tracked
	logRect  Rect
	blocks   []*tracked

	// A draft is written one character at a time and goes out as one animation: where the
	// run started, and the longest the text got.
	typingFrom float64
	typing     string
}

var _ demo.Stage = (*exporter)(nil)

// tracked is one rectangle of the screen and every version of it, each with the moment it
// took over from the one before.
type tracked struct {
	rect     Rect
	versions []version
	last     string // the last version, serialized, to notice a change
}

// set files a version, unless it says exactly what the one before it says. The whole export
// is this: draw, look at each rectangle, and keep it only when it has changed.
func (tr *tracked) set(at float64, rows [][]span, typed, caret int) {
	b, _ := json.Marshal(rows) // [][]span is strings and ints; it cannot fail
	key := fmt.Sprint(typed, caret, string(b))
	if tr.last == key {
		return
	}
	if n := len(tr.versions); n > 0 {
		tr.versions[n-1].To = at
	}
	tr.versions = append(tr.versions, version{From: at, Rows: rows, Type: typed, Caret: caret})
	tr.last = key
}

func (e *exporter) at() float64 {
	return float64(e.now.Sub(e.base)) / float64(time.Second)
}

// draw renders the room as it stands and files away everything that moved.
func (e *exporter) draw() {
	c := NewCanvas(exportCols, exportRows)
	s := e.rs
	s.Now = e.now
	DrawRoom(c, s)
	e.record(c, e.at())
}

func (e *exporter) region(c *Canvas, name string) Rect {
	r, ok := c.RegionOf(name)
	if !ok {
		e.t.Fatalf("the room drew no %q region", name)
	}
	return r
}

func (e *exporter) track(c *Canvas, tr **tracked, name string, r Rect, at float64) {
	if *tr == nil {
		*tr = &tracked{rect: r}
	} else if (*tr).rect != r {
		// Every version of a region is drawn in one place, because the page positions it once
		// and the versions are stacked there. Nothing in this script moves one — the composer
		// only moves when a draft wraps past one row, which none of these do. A script that
		// does needs the rectangle to move to the version, and this is what says so out loud
		// rather than coming out misplaced.
		e.t.Fatalf("the %q region moved from %+v to %+v: a moving region needs its rectangle "+
			"on each version rather than on the area", name, (*tr).rect, r)
	}
	(*tr).set(at, e.rows(c.SpansIn(r)), 0, 0)
}

// record takes every rectangle the room registered as it drew, and then what is left.
//
// Innermost first, blanking each as it is taken: the draft is drawn inside the composer and
// the composer inside the frame, so a region read after one it contains would carry a stale
// copy of it — the line being typed, printed underneath the one being typed over it. Sorting
// by area is enough to get that order, since a rectangle inside another is smaller than it.
func (e *exporter) record(c *Canvas, at float64) {
	e.logRect = e.region(c, "log")
	regions := []struct {
		name string
		at   **tracked
	}{
		{"draft", &e.draft}, {"header", &e.header}, {"composer", &e.composer}, {"people", &e.people},
	}
	sort.SliceStable(regions, func(i, j int) bool {
		a, b := e.region(c, regions[i].name), e.region(c, regions[j].name)
		return a.W*a.H < b.W*b.H
	})
	for _, reg := range regions {
		r := e.region(c, reg.name)
		e.track(c, reg.at, reg.name, r, at)
		c.Fill(r, Style{})
	}
	c.Fill(e.logRect, Style{})

	// What is left is the frame, the rule and the divider — drawn once and never again, which
	// is an observation here rather than an assumption: it is tracked like anything else and
	// simply only ever has one version.
	e.track(c, &e.chrome, "chrome", Rect{0, 0, exportCols, exportRows}, at)

	// The conversation, block by block. A block is a bubble, a file card or an event, and it
	// is where the room already cuts the log up (bubbles.go); a run of messages from one
	// person is one block that grows, which arrives here as a new version of it.
	blocks := logRowsUpTo(e.rs.Entries, e.rs.Me.Name, e.logRect.W, -1, 0)
	for i, blk := range blocks {
		rows := make([][]Span, 0, len(blk))
		for _, ln := range blk {
			rows = append(rows, ln.spans)
		}
		for len(e.blocks) <= i {
			e.blocks = append(e.blocks, &tracked{})
		}
		e.blocks[i].set(at, e.rows(rows), 0, 0)
	}
}

// ── what the script does to it ──────────────────────────────────────────────

func (e *exporter) Snapshot(speaking bool) {
	e.rs.Me.Speaking = speaking
	e.draw()
}

func (e *exporter) Say(who, colour, text string) {
	e.rs.Entries = append(e.rs.Entries, ChatEntry{At: e.now, Kind: KindMessage, Who: who, Color: colour, Text: text})
	e.draw()
}

func (e *exporter) Event(kind, who, text string) {
	e.rs.Entries = append(e.rs.Entries, ChatEntry{At: e.now, Kind: EntryKind(kind), Who: who, Text: text})
	e.draw()
}

func (e *exporter) Share(who, colour string, f demo.File) {
	info := &FileInfo{ID: f.ID, Name: f.Name, Size: f.Size, Kind: f.Kind, From: f.From, Mine: f.Mine,
		State: f.State, Saved: f.Saved}
	if f.State == FileSaved {
		info.Done = f.Size
	}
	e.files[f.ID] = info
	e.rs.FileCount = len(e.files)
	e.rs.Entries = append(e.rs.Entries, ChatEntry{At: e.now, Kind: KindFile, Who: who, Color: colour, File: info})
	e.draw()
}

func (e *exporter) Update(id, state string, done, rate int64, saved string) {
	f, ok := e.files[id]
	if !ok {
		e.t.Fatalf("the script updated a file it never shared: %q", id)
	}
	f.State, f.Done, f.Rate = state, done, rate
	if saved != "" {
		f.Saved = saved
	}
	e.draw()
}

func (e *exporter) Toast(kind, text string) {
	e.rs.Toast, e.rs.ToastKind, e.toastAt = text, kind, e.now
	e.draw()
}

// Draft is called once per character. The page gets one version of the composer with the
// finished text and a count of cells, and reveals it a step at a time — the same animation,
// for the size of one frame instead of seventy.
func (e *exporter) Draft(text string) {
	if text == "" {
		e.finishTyping()
		return
	}
	if e.typing == "" {
		e.typingFrom = e.at()
	}
	e.typing = text
}

func (e *exporter) finishTyping() {
	if e.typing == "" {
		return
	}
	text, from := e.typing, e.typingFrom
	e.typing = ""

	c := NewCanvas(exportCols, exportRows)
	s := e.rs
	s.Now, s.Draft, s.DraftCursor = e.now, text, len([]rune(text))
	DrawRoom(c, s)
	rows := e.rows(c.SpansIn(e.region(c, "draft")))

	// Two versions, not one: the message being written, which the page reveals a character
	// at a time over exactly as long as the typing took, and then the finished message
	// sitting in the composer for the beat before it is sent. Without the second, the reveal
	// would have to stretch over the pause and the typing would come out slower than it is.
	typed, cells := len([]rune(text)), Width(text)
	e.draft.set(from, rows, typed, cells)
	e.draft.set(from+float64(typed)*demo.TypeDelay.Seconds(), rows, 0, cells)
	e.draw()
}

func (e *exporter) Wait(d time.Duration) bool {
	e.now = e.now.Add(d)
	if e.rs.Toast != "" && e.now.Sub(e.toastAt) >= toastMs*time.Millisecond {
		e.rs.Toast, e.rs.ToastKind = "", ""
		e.draw()
	}
	if e.typing != "" {
		// Nothing else is going to move while a message is being typed, and the version that
		// covers it is written when it ends.
		return e.now.Sub(e.base) < exportBudget
	}
	e.draw()
	return e.now.Sub(e.base) < exportBudget
}

// ── running it ──────────────────────────────────────────────────────────────

func exportTerminal(t *testing.T) []byte {
	t.Helper()

	// The defaults every golden frame is drawn in: the page ships the room as it comes out
	// of the box, and its Look panel does the rest.
	SetTheme(DefaultAccent, "base", "black", "single", "rounded")

	version, err := os.ReadFile("../../VERSION")
	if err != nil {
		t.Fatal(err)
	}

	// A fixed instant in a fixed zone: the header says how long the call has been going and
	// every bubble carries a clock, and neither may depend on where the test ran.
	base := time.Date(2026, 9, 15, 14, 51, 50, 0, time.UTC)
	st := demo.Call()
	e := &exporter{
		t: t, base: base, now: base, files: map[string]*FileInfo{}, un: map[string]bool{}, stray: map[rune]bool{},
		fontRanges: websiteRunes(t),
		rs: RoomState{
			Version: strings.TrimSpace(string(version)), Platform: "macOS", Room: demo.Room,
			Connected: true, JoinedAt: base.Add(-demo.Elapsed),
			Stats:        &Stats{SendKbps: st.SendKbps, RecvKbps: st.RecvKbps, RTTMs: st.RTTMs, LossPercent: st.LossPercent},
			Me:           Peer{Name: demo.Me, Color: demo.MeColor},
			VideoEnabled: true, WebcamEnabled: true,
			Anchor: -1, InputFocused: true,
			AttachKey: "ctrl+v",
		},
	}
	for _, p := range demo.Peers() {
		e.rs.Peers = append(e.rs.Peers, Peer{ID: p.ID, Name: p.Name, Color: p.Color, Muted: p.Muted,
			Screen: p.Screen, ScreenOpen: p.ScreenOpen, Volume: p.Volume, RecvKbps: p.RecvKbps,
			LatencyMs: p.LatencyMs})
	}

	demo.Run(e)
	e.finishTyping()

	if len(e.stray) > 0 {
		var chars []string
		for r := range e.stray {
			chars = append(chars, fmt.Sprintf("%q (U+%04X)", r, r))
		}
		sort.Strings(chars)
		t.Fatalf("the room drew characters the page has no glyph for: %s — add them to both "+
			"unicode-ranges in packages/website/src/styles/_fonts.scss and re-cut "+
			"src/fonts/jetbrains-mono-box.woff2 (its README has the command), or the page "+
			"draws them in a font of the wrong width", strings.Join(chars, ", "))
	}
	if len(e.un) > 0 {
		var names []string
		for hex := range e.un {
			names = append(names, hex)
		}
		t.Fatalf("the room drew colours the theme has no name for: %v — every colour on screen "+
			"has to come from theme.go, or the page cannot repaint it", names)
	}

	out := terminal{
		Cols: exportCols, Rows: exportRows, Duration: e.at(),
		Chrome:   areaOf(e.chrome),
		Header:   areaOf(e.header),
		People:   areaOf(e.people),
		Composer: areaOf(e.composer),
		Draft:    areaOf(e.draft),
		LogRect:  area{X: e.logRect.X, Y: e.logRect.Y, W: e.logRect.W, H: e.logRect.H},
	}
	for _, b := range e.blocks {
		out.Log = append(out.Log, b.versions)
	}

	b, err := json.Marshal(out)
	if err != nil {
		t.Fatal(err)
	}
	return append(b, '\n')
}

// TestWebsiteTerminal writes the export when it is asked to. It is a decision to change what
// the landing page shows, which is why it does not happen on its own.
func TestWebsiteTerminal(t *testing.T) {
	if os.Getenv("OPENMEET_REGEN") == "" {
		t.Skip("set OPENMEET_REGEN=1 to write " + terminalJSON)
	}
	b := exportTerminal(t)
	if err := os.WriteFile(terminalJSON, b, 0o644); err != nil {
		t.Fatal(err)
	}
	t.Logf("wrote %s — %d bytes", terminalJSON, len(b))
}

// TestWebsiteTerminalIsCurrent is the reason any of this is worth doing: the landing page
// cannot go out of date without this failing.
func TestWebsiteTerminalIsCurrent(t *testing.T) {
	want, err := os.ReadFile(terminalJSON)
	if err != nil {
		t.Skip("no exported terminal: " + err.Error())
	}
	got := exportTerminal(t)
	if string(got) == string(want) {
		return
	}
	t.Errorf("the room no longer draws what the landing page shows (%d bytes exported, %d on disk).\n"+
		"If the room was meant to change, the page changes with it:\n"+
		"\tOPENMEET_REGEN=1 go test ./internal/tui -run WebsiteTerminal", len(got), len(want))
	fmt.Println(firstDiff(string(want), string(got)))
}

func firstDiff(a, b string) string {
	i := 0
	for i < len(a) && i < len(b) && a[i] == b[i] {
		i++
	}
	lo := max(0, i-60)
	return fmt.Sprintf("first difference at byte %d:\n  on disk: …%s…\n  drawn:   …%s…",
		i, a[lo:min(len(a), i+60)], b[lo:min(len(b), i+60)])
}
