package logs

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func read(t *testing.T, p string) string {
	t.Helper()
	b, err := os.ReadFile(p)
	if err != nil {
		t.Fatal(err)
	}
	return string(b)
}

func TestItWritesWhatItIsGiven(t *testing.T) {
	p := filepath.Join(t.TempDir(), "debug.log")
	w, err := Open(p, "9.9.9")
	if err != nil {
		t.Fatal(err)
	}
	w.Print("audio devices changed")
	w.Close()
	s := read(t, p)
	if !strings.Contains(s, "openmeet 9.9.9 started") {
		t.Error("no header saying which run this is")
	}
	if !strings.Contains(s, "audio devices changed") {
		t.Errorf("the line is missing:\n%s", s)
	}
	// Every line carries a clock and the process, so two runs in one file stay apart.
	for _, line := range strings.Split(strings.TrimSpace(s), "\n") {
		if !strings.Contains(line, "[") || len(line) < 14 {
			t.Errorf("line without a clock or a pid: %q", line)
		}
	}
}

// The whole point of a cap: it never becomes the largest thing in a home directory.
func TestItNeverGrowsPastTheCap(t *testing.T) {
	p := filepath.Join(t.TempDir(), "debug.log")
	w, err := Open(p, "9.9.9")
	if err != nil {
		t.Fatal(err)
	}
	long := strings.Repeat("x", 4096)
	for i := 0; i < 4000; i++ { // ~16 MB of lines into a 4 MB cap
		w.Print(long)
		if i%500 == 0 {
			time.Sleep(5 * time.Millisecond) // let the writer keep up
		}
	}
	w.Close()
	st, err := os.Stat(p)
	if err != nil {
		t.Fatal(err)
	}
	if st.Size() > MaxBytes {
		t.Errorf("the log reached %d bytes, past the cap of %d", st.Size(), MaxBytes)
	}
	if st.Size() == 0 {
		t.Error("it trimmed everything")
	}
	// And what is left starts at a whole line, not halfway through one.
	if s := read(t, p); strings.HasPrefix(s, "x") {
		t.Error("the trim cut a line in half")
	}
}

func TestTrimKeepsTheNewest(t *testing.T) {
	p := filepath.Join(t.TempDir(), "debug.log")
	if err := os.WriteFile(p, []byte("one\ntwo\nthree\nfour\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := trim(p, 10); err != nil {
		t.Fatal(err)
	}
	s := read(t, p)
	if strings.Contains(s, "one") {
		t.Errorf("it kept the oldest: %q", s)
	}
	if !strings.Contains(s, "four") {
		t.Errorf("it lost the newest: %q", s)
	}
}

// Nothing in this application may wait on a disk, so a queue that is full drops rather than
// blocks — and a writer with nowhere to write does not block either.
func TestPrintNeverBlocks(t *testing.T) {
	w := &Writer{path: filepath.Join(t.TempDir(), "x.log"), ch: make(chan string, 1), done: make(chan struct{})}
	close(w.done) // no reader at all
	done := make(chan struct{})
	go func() {
		for i := 0; i < 10000; i++ {
			w.Print("line")
		}
		close(done)
	}()
	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Fatal("Print blocked")
	}
	var nilw *Writer
	nilw.Print("and a writer that was never opened is not a crash")
}

func TestPaintLeavesTheTextAlone(t *testing.T) {
	line := "17:51:44.897 [123] sending bench.bin"
	if got := paint(line, false); got != line {
		t.Errorf("without colour it should be untouched: %q", got)
	}
	got := paint(line, true)
	if !strings.Contains(got, "sending bench.bin") {
		t.Errorf("the text was lost: %q", got)
	}
	if !strings.Contains(paint("17:51:44.897 [123] could not open", true), "\x1b[38;2;248;113;113m") {
		t.Error("a failure is not marked")
	}
}

// A window opens on what just happened, not on an afternoon of somebody else's call.
func TestItOpensOnTheTail(t *testing.T) {
	p := filepath.Join(t.TempDir(), "debug.log")
	var b strings.Builder
	for i := 0; i < 1000; i++ {
		b.WriteString("line ")
		b.WriteString(strings.Repeat("y", 40))
		b.WriteByte('\n')
	}
	if err := os.WriteFile(p, []byte(b.String()), 0o644); err != nil {
		t.Fatal(err)
	}
	at := tailFrom(p, TailLines)
	if at == 0 {
		t.Fatal("it starts at the beginning of a thousand-line file")
	}
	rest, err := os.ReadFile(p)
	if err != nil {
		t.Fatal(err)
	}
	shown := strings.Count(string(rest[at:]), "\n")
	if shown < TailLines-1 || shown > TailLines+1 {
		t.Errorf("it opens on %d lines, want about %d", shown, TailLines)
	}
	// And on a whole line, never halfway through one.
	if !strings.HasPrefix(string(rest[at:]), "line ") {
		t.Errorf("it starts mid-line: %q", string(rest[at:at+20]))
	}
	// A short file is shown whole.
	if err := os.WriteFile(p, []byte("one\ntwo\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if at := tailFrom(p, TailLines); at != 0 {
		t.Errorf("a short file should be shown whole, started at %d", at)
	}
}

// The window is opened in the terminal you are already in, never one chosen for you — so
// what matters is that an unknown terminal is a normal answer and not a failure.
func TestTerminalDetection(t *testing.T) {
	for env, want := range map[string]string{
		"ghostty": "Ghostty", "Apple_Terminal": "Terminal", "iTerm.app": "iTerm",
		"WezTerm": "WezTerm", "": "", "some-new-terminal-2029": "",
	} {
		t.Setenv("WT_SESSION", "")
		t.Setenv("TERM_PROGRAM", env)
		if got := Terminal(); got != want {
			t.Errorf("TERM_PROGRAM=%q gave %q, want %q", env, got, want)
		}
	}
	t.Setenv("TERM_PROGRAM", "")
	t.Setenv("WT_SESSION", "abc")
	if got := Terminal(); got != "Windows Terminal" {
		t.Errorf("WT_SESSION gave %q", got)
	}
}

// What somebody is handed when there is no way in: a command that runs.
func TestTheCommandIsRunnable(t *testing.T) {
	if got := Command("/usr/local/bin/openmeet"); got != "/usr/local/bin/openmeet --logs" {
		t.Errorf("Command = %q", got)
	}
	if got := Command(`/Users/a b/openmeet`); got != `"/Users/a b/openmeet" --logs` {
		t.Errorf("a path with a space must be quoted, got %q", got)
	}
}
